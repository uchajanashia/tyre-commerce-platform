import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import {
  MOCK_MAKES,
  mockModels,
  mockTrims,
  mockYears,
} from "./fitment-mock.data";
import { FitmentUpstreamError } from "./fitment-upstream.error";
import {
  FitmentLookupResult,
  FitmentMake,
  FitmentModel,
  FitmentTrim,
} from "./fitment.types";
import { WheelSizeClientService } from "./wheel-size-client.service";

function isFresh(cachedAt: Date | null, ttlDays: number): boolean {
  if (!cachedAt) return false;
  return Date.now() - cachedAt.getTime() < ttlDays * 24 * 60 * 60 * 1000;
}

/**
 * Cache-or-fetch orchestration in front of the Wheel-Size API (see
 * wheel-size-client.service.ts). Vehicle fitment data barely changes, so every
 * method serves from Postgres when the cache is fresh, and only calls the
 * upstream API — then persists the result — on a miss or a stale entry. When
 * an upstream refresh fails but a stale cache entry exists, that stale entry
 * is served rather than surfacing an error (better a 30-day-old tire size
 * than none at all).
 *
 * FITMENT_MOCK=true bypasses both the cache and the API entirely, serving
 * static realistic data (fitment-mock.data.ts) so frontend work isn't
 * blocked on a sandbox key.
 */
@Injectable()
export class FitmentService {
  private readonly logger = new Logger(FitmentService.name);
  private readonly explicitMockMode =
    process.env.FITMENT_MOCK?.trim().toLowerCase() === "true";
  private readonly allowDevelopmentFallback =
    (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development")
      .trim()
      .toLowerCase() !== "production";
  private readonly hasUpstreamKey = Boolean(
    process.env.WHEEL_SIZE_API_KEY?.trim(),
  );
  private readonly mockMode = this.explicitMockMode;
  /** Without an upstream key, development remains useful by serving the full
   * persisted catalog first and filling only genuinely missing cached branches
   * from fixtures. It must never replace the persisted make list wholesale. */
  private readonly offlineCacheMode =
    this.allowDevelopmentFallback && !this.hasUpstreamKey && !this.mockMode;
  private readonly ttlDays = this.readTtlDays();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: WheelSizeClientService,
  ) {
    if (this.offlineCacheMode) {
      this.logger.warn(
        "No Wheel-Size key is configured; using the persisted fitment catalog in offline cache mode.",
      );
    }
  }

  async getMakes(): Promise<FitmentMake[]> {
    if (this.mockMode) {
      return MOCK_MAKES;
    }

    let cached;
    try {
      cached = await this.prisma.vehicleMake.findMany({
        orderBy: { name: "asc" },
      });
    } catch (error) {
      if (!this.offlineCacheMode) throw error;
      this.logger.warn(
        "Fitment database is unavailable in offline cache mode; serving fixture makes.",
      );
      return MOCK_MAKES;
    }

    if (this.offlineCacheMode) {
      return this.mergeNamed(
        cached.map((make) => ({ slug: make.slug, name: make.name })),
        MOCK_MAKES,
      );
    }
    if (
      cached.length > 0 &&
      cached.every((m) => isFresh(m.cachedAt, this.ttlDays))
    ) {
      return cached.map((m) => ({ slug: m.slug, name: m.name }));
    }
    if (cached.length > 0) {
      this.refreshInBackground("makes", () => this.refreshMakes());
      return cached.map((m) => ({ slug: m.slug, name: m.name }));
    }
    return this.refreshMakes();
  }

  private refreshMakes(): Promise<FitmentMake[]> {
    return this.coalesce("makes", async () => {
      const makes = await this.client.getMakes();
      const refreshedAt = new Date();
      await this.prisma.$transaction([
        // `cachedAt` represents the full /makes snapshot. Touch retained rows
        // too, otherwise one discontinued stale make would trigger a refresh
        // on every request forever.
        this.prisma.vehicleMake.updateMany({ data: { cachedAt: refreshedAt } }),
        ...makes.map((m) =>
          this.prisma.vehicleMake.upsert({
            where: { slug: m.slug },
            create: { slug: m.slug, name: m.name, cachedAt: refreshedAt },
            update: { name: m.name, cachedAt: refreshedAt },
          }),
        ),
      ]);
      return makes;
    });
  }

  async getModels(makeSlug: string): Promise<FitmentModel[]> {
    if (this.mockMode) {
      return mockModels(makeSlug);
    }

    if (this.offlineCacheMode) {
      try {
        const make = await this.prisma.vehicleMake.findUnique({
          where: { slug: makeSlug },
          include: { models: true },
        });
        const cachedModels = (make?.models ?? []).filter(
          (model) => Array.isArray(model.years) && model.years.length > 0,
        );
        const fixtureModels = mockModels(makeSlug).filter(
          (model) => mockYears(makeSlug, model.slug).length > 0,
        );
        return this.mergeNamed(
          cachedModels.map((model) => ({
            slug: model.slug,
            name: model.name,
          })),
          fixtureModels,
        );
      } catch {
        this.logger.warn(
          `Fitment database is unavailable for models:${makeSlug}; serving fixture models.`,
        );
        return mockModels(makeSlug);
      }
    }

    const make = await this.prisma.vehicleMake.findUnique({
      where: { slug: makeSlug },
      include: { models: true },
    });
    if (make && isFresh(make.modelsCachedAt, this.ttlDays)) {
      return make.models.map((m) => ({ slug: m.slug, name: m.name }));
    }
    if (make?.modelsCachedAt) {
      this.refreshInBackground(`models:${makeSlug}`, () =>
        this.refreshModels(makeSlug, make.name),
      );
      return make.models.map((m) => ({ slug: m.slug, name: m.name }));
    }
    return this.refreshModels(makeSlug, make?.name);
  }

  private refreshModels(
    makeSlug: string,
    makeName?: string,
  ): Promise<FitmentModel[]> {
    return this.coalesce(`models:${makeSlug}`, async () => {
      const models = await this.client.getModels(makeSlug);
      const makeRow = await this.prisma.vehicleMake.upsert({
        where: { slug: makeSlug },
        create: { slug: makeSlug, name: makeName ?? makeSlug },
        update: {},
      });
      await this.prisma.$transaction(
        models.map((m) =>
          this.prisma.vehicleModel.upsert({
            where: { makeId_slug: { makeId: makeRow.id, slug: m.slug } },
            create: { makeId: makeRow.id, slug: m.slug, name: m.name },
            update: { name: m.name, cachedAt: new Date() },
          }),
        ),
      );
      await this.prisma.vehicleMake.update({
        where: { id: makeRow.id },
        data: { modelsCachedAt: new Date() },
      });
      return models;
    });
  }

  async getYears(makeSlug: string, modelSlug: string): Promise<number[]> {
    if (this.mockMode) {
      return mockYears(makeSlug, modelSlug);
    }

    if (this.offlineCacheMode) {
      try {
        const model = await this.prisma.vehicleModel.findFirst({
          where: { slug: modelSlug, make: { slug: makeSlug } },
        });
        const years = this.mergeYears(
          model?.years ?? [],
          mockYears(makeSlug, modelSlug),
        );
        if (years.length === 0) {
          throw new FitmentUpstreamError(
            "Vehicle year data is not cached and the Wheel-Size API is not configured.",
          );
        }
        return years;
      } catch {
        const fallback = mockYears(makeSlug, modelSlug);
        if (fallback.length === 0) {
          throw new FitmentUpstreamError(
            "Vehicle year data is not cached and the Wheel-Size API is not configured.",
          );
        }
        this.logger.warn(
          `Fitment database is unavailable for years:${makeSlug}:${modelSlug}; serving fixture years.`,
        );
        return fallback;
      }
    }

    const model = await this.prisma.vehicleModel.findFirst({
      where: { slug: modelSlug, make: { slug: makeSlug } },
    });
    if (model && isFresh(model.yearsCachedAt, this.ttlDays)) {
      return [...model.years].sort((a, b) => b - a);
    }
    if (model?.yearsCachedAt) {
      this.refreshInBackground(`years:${makeSlug}:${modelSlug}`, () =>
        this.refreshYears(makeSlug, modelSlug, model.name),
      );
      return [...model.years].sort((a, b) => b - a);
    }
    return this.refreshYears(makeSlug, modelSlug, model?.name);
  }

  private refreshYears(
    makeSlug: string,
    modelSlug: string,
    modelName?: string,
  ): Promise<number[]> {
    return this.coalesce(`years:${makeSlug}:${modelSlug}`, async () => {
      const years = await this.client.getYears(makeSlug, modelSlug);
      const makeRow = await this.prisma.vehicleMake.upsert({
        where: { slug: makeSlug },
        create: { slug: makeSlug, name: makeSlug },
        update: {},
      });
      await this.prisma.vehicleModel.upsert({
        where: { makeId_slug: { makeId: makeRow.id, slug: modelSlug } },
        create: {
          makeId: makeRow.id,
          slug: modelSlug,
          name: modelName ?? modelSlug,
          years,
          yearsCachedAt: new Date(),
        },
        update: { years, yearsCachedAt: new Date() },
      });
      return years;
    });
  }

  /** Returns null when nothing matches (unknown combo, or an unknown trim slug). */
  async lookup(
    makeSlug: string,
    modelSlug: string,
    year: number,
    trimSlug?: string,
  ): Promise<FitmentLookupResult | null> {
    const trims = await this.lookupTrims(makeSlug, modelSlug, year);
    if (trims.length === 0) {
      return null;
    }

    const filtered = trimSlug
      ? trims.filter((t) => t.trimSlug === trimSlug)
      : trims;
    if (filtered.length === 0) {
      return null;
    }

    return { make: makeSlug, model: modelSlug, year, trims: filtered };
  }

  private async lookupTrims(
    makeSlug: string,
    modelSlug: string,
    year: number,
  ): Promise<FitmentTrim[]> {
    if (this.mockMode) {
      return mockTrims(makeSlug, modelSlug, year);
    }

    if (this.offlineCacheMode) {
      try {
        const cached = await this.prisma.vehicleFitment.findUnique({
          where: { makeSlug_modelSlug_year: { makeSlug, modelSlug, year } },
        });
        const cachedTrims = Array.isArray(cached?.payload)
          ? (cached.payload as unknown as FitmentTrim[])
          : [];
        return this.mergeTrims(
          cachedTrims,
          mockTrims(makeSlug, modelSlug, year),
        );
      } catch {
        this.logger.warn(
          `Fitment database is unavailable for trims:${makeSlug}:${modelSlug}:${year}; serving fixture trims.`,
        );
        return mockTrims(makeSlug, modelSlug, year);
      }
    }

    const cached = await this.prisma.vehicleFitment.findUnique({
      where: { makeSlug_modelSlug_year: { makeSlug, modelSlug, year } },
    });
    if (cached && isFresh(cached.cachedAt, this.ttlDays)) {
      return cached.payload as unknown as FitmentTrim[];
    }
    if (cached) {
      this.refreshInBackground(`trims:${makeSlug}:${modelSlug}:${year}`, () =>
        this.refreshTrims(makeSlug, modelSlug, year),
      );
      return cached.payload as unknown as FitmentTrim[];
    }
    return this.refreshTrims(makeSlug, modelSlug, year);
  }

  private refreshTrims(
    makeSlug: string,
    modelSlug: string,
    year: number,
  ): Promise<FitmentTrim[]> {
    return this.coalesce(`trims:${makeSlug}:${modelSlug}:${year}`, async () => {
      const trims = await this.client.searchByModel(makeSlug, modelSlug, year);
      await this.prisma.vehicleFitment.upsert({
        where: { makeSlug_modelSlug_year: { makeSlug, modelSlug, year } },
        create: {
          makeSlug,
          modelSlug,
          year,
          payload: trims as unknown as Prisma.InputJsonValue,
        },
        update: {
          payload: trims as unknown as Prisma.InputJsonValue,
          cachedAt: new Date(),
        },
      });
      return trims;
    });
  }

  private coalesce<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const active = this.inFlight.get(key) as Promise<T> | undefined;
    if (active) return active;

    const request = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  private refreshInBackground(
    label: string,
    operation: () => Promise<unknown>,
  ): void {
    void operation().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Fitment background refresh failed (${label}): ${message}`,
      );
    });
  }

  private mergeNamed<T extends { slug: string; name: string }>(
    primary: T[],
    fallback: T[],
  ): T[] {
    const merged = new Map<string, T>();
    const names = new Set<string>();
    for (const item of [...primary, ...fallback]) {
      const normalizedName = item.name.trim().toLocaleLowerCase("en");
      if (merged.has(item.slug) || names.has(normalizedName)) continue;
      merged.set(item.slug, item);
      names.add(normalizedName);
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private mergeYears(primary: number[], fallback: number[]): number[] {
    return [...new Set([...primary, ...fallback])].sort((a, b) => b - a);
  }

  private mergeTrims(
    primary: FitmentTrim[],
    fallback: FitmentTrim[],
  ): FitmentTrim[] {
    const merged = new Map<string, FitmentTrim>();
    for (const trim of [...fallback, ...primary])
      merged.set(trim.trimSlug, trim);
    return [...merged.values()];
  }

  private readTtlDays(): number {
    const value = Number(process.env.FITMENT_CACHE_TTL_DAYS ?? 30);
    if (!Number.isFinite(value) || value <= 0) {
      this.logger.warn("Invalid FITMENT_CACHE_TTL_DAYS; using 30 days.");
      return 30;
    }
    return value;
  }
}
