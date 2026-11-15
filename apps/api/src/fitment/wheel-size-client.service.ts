import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { lastValueFrom } from "rxjs";

import { FitmentUpstreamError } from "./fitment-upstream.error";
import {
  FitmentMake,
  FitmentModel,
  FitmentOemByRim,
  FitmentTireSize,
  FitmentTrim,
} from "./fitment.types";
import { slugify } from "./slug.util";

const MAX_ATTEMPTS = 2;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;
const KNOWN_SPEED_RATINGS = new Set(["Q", "R", "S", "T", "H", "V", "W", "Y"]);

/**
 * Thin wrapper around the Wheel-Size Fitment API (https://api.wheel-size.com).
 *
 * Base URL is the SAME host for sandbox and production keys — there is no
 * separate "-demo" API host (that domain is only a marketing/demo website).
 * The plan tier is entirely a function of the `user_key`. Every endpoint also
 * requires a `region` query param (WHEEL_SIZE_REGION, default "eudm" — most
 * vehicles sold in Georgia are EU-spec; change per catalog if that's wrong).
 *
 * Field names below were verified against a live authenticated call (not
 * guessed from docs): `/makes/` and `/models/` return `{slug, name}`;
 * `/generations/` returns `{..., years: number[]}` per generation (used to
 * answer "years available" since there's no dedicated years endpoint);
 * `/search/by_model/` returns one item per trim with `slug` (the trim's own
 * stable id), `trim`/`name`, and a `wheels[]` array where only entries with
 * `is_stock: true` are genuine OEM fitments — everything else is an
 * aftermarket/optional/winter-only alternative and is intentionally excluded.
 */
@Injectable()
export class WheelSizeClientService {
  private readonly logger = new Logger(WheelSizeClientService.name);
  private readonly baseUrl = (
    process.env.WHEEL_SIZE_API_BASE_URL ?? "https://api.wheel-size.com/v2/"
  ).replace(/\/+$/, "");
  private readonly apiKey = process.env.WHEEL_SIZE_API_KEY ?? "";
  private readonly region = process.env.WHEEL_SIZE_REGION ?? "eudm";
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly http: HttpService) {}

  async getMakes(): Promise<FitmentMake[]> {
    const items = await this.get<unknown[]>("/makes/");
    return items
      .map((item) => this.normalizeNamedItem(item))
      .filter((m): m is FitmentMake => m != null);
  }

  async getModels(makeSlug: string): Promise<FitmentModel[]> {
    const items = await this.get<unknown[]>("/models/", { make: makeSlug });
    return items
      .map((item) => this.normalizeNamedItem(item))
      .filter((m): m is FitmentModel => m != null);
  }

  /** No dedicated years endpoint exists — /generations/ carries an explicit
   *  `years` array per generation, which is unioned across all generations. */
  async getYears(makeSlug: string, modelSlug: string): Promise<number[]> {
    const items = await this.get<unknown[]>("/generations/", {
      make: makeSlug,
      model: modelSlug,
    });
    const years = new Set<number>();
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const arr = (item as Record<string, unknown>).years;
      if (Array.isArray(arr)) {
        for (const y of arr) {
          if (typeof y === "number" && Number.isInteger(y)) {
            years.add(y);
          }
        }
      }
    }
    return [...years].sort((a, b) => b - a);
  }

  async searchByModel(
    makeSlug: string,
    modelSlug: string,
    year: number,
  ): Promise<FitmentTrim[]> {
    const items = await this.get<unknown[]>("/search/by_model/", {
      make: makeSlug,
      model: modelSlug,
      year,
    });
    return items
      .map((item, index) => this.normalizeSearchItem(item, index))
      .filter((t): t is FitmentTrim => t != null);
  }

  private normalizeNamedItem(
    item: unknown,
  ): { slug: string; name: string } | null {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : null;
    if (!name) return null;
    const slug = typeof record.slug === "string" ? record.slug : slugify(name);
    return { slug, name };
  }

  private normalizeWheelSize(side: unknown): FitmentTireSize | null {
    if (typeof side !== "object" || side === null) return null;
    const s = side as Record<string, unknown>;
    if (typeof s.rim_diameter !== "number") return null;
    return {
      rimDiameterInch: s.rim_diameter,
      raw:
        typeof s.tire_full === "string"
          ? s.tire_full
          : typeof s.tire === "string"
            ? s.tire
            : "",
      ...(typeof s.tire_width === "number" ? { widthMm: s.tire_width } : {}),
      ...(typeof s.tire_aspect_ratio === "number"
        ? { aspect: s.tire_aspect_ratio }
        : {}),
    };
  }

  private normalizeSearchItem(
    item: unknown,
    index: number,
  ): FitmentTrim | null {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as Record<string, any>;
    const trimSlug: string =
      typeof record.slug === "string" ? record.slug : `trim-${index}`;
    const trimName: string = record.trim ?? record.name ?? `Trim ${index + 1}`;

    const wheels: unknown[] = Array.isArray(record.wheels) ? record.wheels : [];
    const stockWheels = wheels.filter(
      (w) =>
        typeof w === "object" &&
        w !== null &&
        (w as Record<string, unknown>).is_stock === true,
    );

    const oemBySize: FitmentOemByRim[] = [];
    const loadIndexes: number[] = [];
    const speedRatings: string[] = [];

    for (const wheel of stockWheels) {
      const w = wheel as Record<string, any>;
      const front = this.normalizeWheelSize(w.front);
      if (!front) continue;
      if (oemBySize.some((o) => o.rimDiameterInch === front.rimDiameterInch))
        continue;

      const rear = this.normalizeWheelSize(w.rear);
      oemBySize.push({
        rimDiameterInch: front.rimDiameterInch,
        front,
        ...(rear ? { rear } : {}),
      });

      const frontLoadIndex = w.front?.load_index;
      const rearLoadIndex = w.rear?.load_index;
      if (typeof frontLoadIndex === "number") loadIndexes.push(frontLoadIndex);
      if (typeof rearLoadIndex === "number") loadIndexes.push(rearLoadIndex);
      if (typeof w.front?.speed_index === "string")
        speedRatings.push(w.front.speed_index.toUpperCase());
      if (typeof w.rear?.speed_index === "string")
        speedRatings.push(w.rear.speed_index.toUpperCase());
    }

    const oemSpeedRating = speedRatings.find((rating) =>
      KNOWN_SPEED_RATINGS.has(rating),
    );
    if (oemBySize.length === 0 || loadIndexes.length === 0 || !oemSpeedRating) {
      return null;
    }

    const staggered = oemBySize.some(
      (o) =>
        o.rear &&
        (o.rear.widthMm !== o.front.widthMm ||
          o.rear.aspect !== o.front.aspect ||
          o.rear.rimDiameterInch !== o.front.rimDiameterInch),
    );

    return {
      trimSlug,
      trimName,
      rimDiametersInch: oemBySize.map((o) => o.rimDiameterInch),
      oemBySize,
      staggered,
      minLoadIndex: Math.min(...loadIndexes),
      oemSpeedRating,
    };
  }

  private async get<T>(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<T> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new FitmentUpstreamError(
        "Wheel-Size API circuit is temporarily open.",
        true,
      );
    }
    let lastError: FitmentUpstreamError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await lastValueFrom(
          this.http.get<{ data: T }>(`${this.baseUrl}${path}`, {
            params: { ...params, region: this.region, user_key: this.apiKey },
          }),
        );
        if (response.data?.data === undefined) {
          throw new FitmentUpstreamError(
            `Wheel-Size returned an invalid payload for ${path}`,
            false,
            response.status,
          );
        }
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = 0;
        return response.data.data;
      } catch (err) {
        lastError =
          err instanceof FitmentUpstreamError
            ? err
            : this.toUpstreamError(path, err);
        if (!lastError.retryable || attempt === MAX_ATTEMPTS) {
          this.logger.error(
            `Wheel-Size request failed (${path}; status=${lastError.upstreamStatus ?? "network"}; attempts=${attempt}).`,
          );
          this.recordFailure(lastError);
          throw lastError;
        }
        const delayMs = this.retryDelayMs(err, attempt);
        this.logger.warn(
          `Wheel-Size transient failure (${path}; status=${lastError.upstreamStatus ?? "network"}); retrying in ${delayMs}ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw (
      lastError ??
      new FitmentUpstreamError(`Wheel-Size API request failed: ${path}`)
    );
  }

  private toUpstreamError(path: string, err: unknown): FitmentUpstreamError {
    const record =
      typeof err === "object" && err !== null
        ? (err as Record<string, any>)
        : {};
    const rawStatus = record.response?.status;
    const status = typeof rawStatus === "number" ? rawStatus : undefined;
    const retryable =
      status === undefined ||
      status === 408 ||
      status === 425 ||
      status === 429 ||
      status >= 500;
    return new FitmentUpstreamError(
      `Wheel-Size API request failed: ${path}`,
      retryable,
      status,
    );
  }

  private retryDelayMs(err: unknown, attempt: number): number {
    const record =
      typeof err === "object" && err !== null
        ? (err as Record<string, any>)
        : {};
    const retryAfter = record.response?.headers?.["retry-after"];
    const retryAfterMs = this.parseRetryAfterMs(retryAfter);
    const exponential = Math.min(
      RETRY_MAX_MS,
      RETRY_BASE_MS * 2 ** (attempt - 1),
    );
    return (
      Math.min(RETRY_MAX_MS, retryAfterMs ?? exponential) +
      Math.floor(Math.random() * 100)
    );
  }

  private parseRetryAfterMs(value: unknown): number | null {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1_000;
    }
    if (typeof value === "string") {
      const dateMs = Date.parse(value);
      if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
    }
    return null;
  }

  private recordFailure(error: FitmentUpstreamError): void {
    this.consecutiveFailures += 1;
    if (
      !error.retryable ||
      this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
    ) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      this.logger.warn(`Wheel-Size circuit opened for ${CIRCUIT_OPEN_MS}ms.`);
    }
  }
}
