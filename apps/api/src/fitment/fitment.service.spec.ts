import assert from "node:assert/strict";
import test from "node:test";

import { PrismaService } from "../prisma/prisma.service";
import { FitmentUpstreamError } from "./fitment-upstream.error";
import { MOCK_MAKES } from "./fitment-mock.data";
import { FitmentService } from "./fitment.service";
import { FitmentMake, FitmentModel, FitmentTrim } from "./fitment.types";
import { WheelSizeClientService } from "./wheel-size-client.service";

interface FakeMakeRow {
  id: string;
  slug: string;
  name: string;
  cachedAt: Date;
  modelsCachedAt: Date | null;
}
interface FakeModelRow {
  id: string;
  makeId: string;
  slug: string;
  name: string;
  years: number[];
  yearsCachedAt: Date | null;
  cachedAt: Date;
}
interface FakeFitmentRow {
  makeSlug: string;
  modelSlug: string;
  year: number;
  payload: unknown;
  cachedAt: Date;
}

function fakePrisma(
  seed: {
    makes?: FakeMakeRow[];
    models?: FakeModelRow[];
    fitments?: FakeFitmentRow[];
  } = {},
) {
  const makes = [...(seed.makes ?? [])];
  const models = [...(seed.models ?? [])];
  const fitments = [...(seed.fitments ?? [])];
  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;

  const vehicleMake = {
    findMany: async () => makes,
    findUnique: async ({ where, include }: any) => {
      const row = makes.find((m) => m.slug === where.slug);
      if (!row) return null;
      if (include?.models) {
        return { ...row, models: models.filter((mo) => mo.makeId === row.id) };
      }
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      let row = makes.find((m) => m.slug === where.slug);
      if (!row) {
        row = {
          id: nextId(),
          cachedAt: new Date(),
          modelsCachedAt: null,
          ...create,
        } as FakeMakeRow;
        makes.push(row);
      } else {
        Object.assign(row, update);
      }
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = makes.find((m) => m.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ data }: any) => {
      makes.forEach((row) => Object.assign(row, data));
      return { count: makes.length };
    },
  };

  const vehicleModel = {
    findFirst: async ({ where }: any) => {
      const makeRow = makes.find((m) => m.slug === where.make.slug);
      if (!makeRow) return null;
      return (
        models.find(
          (mo) => mo.slug === where.slug && mo.makeId === makeRow.id,
        ) ?? null
      );
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.makeId_slug;
      let row = models.find(
        (mo) => mo.makeId === key.makeId && mo.slug === key.slug,
      );
      if (!row) {
        row = {
          id: nextId(),
          years: [],
          yearsCachedAt: null,
          cachedAt: new Date(),
          ...create,
        } as FakeModelRow;
        models.push(row);
      } else {
        Object.assign(row, update);
      }
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = models.find((mo) => mo.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  };

  const vehicleFitment = {
    findUnique: async ({ where }: any) => {
      const key = where.makeSlug_modelSlug_year;
      return (
        fitments.find(
          (f) =>
            f.makeSlug === key.makeSlug &&
            f.modelSlug === key.modelSlug &&
            f.year === key.year,
        ) ?? null
      );
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.makeSlug_modelSlug_year;
      let row = fitments.find(
        (f) =>
          f.makeSlug === key.makeSlug &&
          f.modelSlug === key.modelSlug &&
          f.year === key.year,
      );
      if (!row) {
        row = { cachedAt: new Date(), ...create } as FakeFitmentRow;
        fitments.push(row);
      } else {
        Object.assign(row, update);
      }
      return row;
    },
  };

  const prisma = {
    vehicleMake,
    vehicleModel,
    vehicleFitment,
    $transaction: async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as () => unknown)(),
  } as unknown as PrismaService;

  return { prisma, makes, models, fitments };
}

function fakeClient(overrides: Partial<WheelSizeClientService> = {}): {
  client: WheelSizeClientService;
  calls: {
    getMakes: number;
    getModels: number;
    getYears: number;
    searchByModel: number;
  };
} {
  const calls = { getMakes: 0, getModels: 0, getYears: 0, searchByModel: 0 };
  const client = {
    getMakes: async () => {
      calls.getMakes += 1;
      return overrides.getMakes ? (overrides.getMakes as any)() : [];
    },
    getModels: async (makeSlug: string) => {
      calls.getModels += 1;
      return overrides.getModels ? (overrides.getModels as any)(makeSlug) : [];
    },
    getYears: async (makeSlug: string, modelSlug: string) => {
      calls.getYears += 1;
      return overrides.getYears
        ? (overrides.getYears as any)(makeSlug, modelSlug)
        : [];
    },
    searchByModel: async (
      makeSlug: string,
      modelSlug: string,
      year: number,
    ) => {
      calls.searchByModel += 1;
      return overrides.searchByModel
        ? (overrides.searchByModel as any)(makeSlug, modelSlug, year)
        : [];
    },
  } as unknown as WheelSizeClientService;
  return { client, calls };
}

function withEnv(
  values: Record<string, string | undefined>,
  run: () => void | Promise<void>,
) {
  const previous = new Map(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.entries(values).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  return Promise.resolve(run()).finally(() => {
    previous.forEach((v, k) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });
}

const SAMPLE_TRIM: FitmentTrim = {
  trimSlug: "320i",
  trimName: "320i",
  rimDiametersInch: [17],
  oemBySize: [
    {
      rimDiameterInch: 17,
      front: {
        widthMm: 225,
        aspect: 45,
        rimDiameterInch: 17,
        raw: "225/45R17 91V",
      },
    },
  ],
  staggered: false,
  minLoadIndex: 91,
  oemSpeedRating: "V",
};

test("mock mode serves static data without touching Prisma or the Wheel-Size client", async () => {
  await withEnv({ FITMENT_MOCK: "true" }, async () => {
    const { prisma } = fakePrisma();
    const { client, calls } = fakeClient();
    const service = new FitmentService(prisma, client);

    const makes = await service.getMakes();
    assert.deepEqual(makes, MOCK_MAKES);
    assert.equal(calls.getMakes, 0);

    const trims = await service.lookup("bmw", "3-series", 2021);
    assert.ok(trims);
    assert.ok(trims!.trims.length > 0);
  });
});

test("development without a Wheel-Size key preserves every persisted make", async () => {
  await withEnv(
    {
      APP_ENV: "development",
      NODE_ENV: undefined,
      FITMENT_MOCK: undefined,
      WHEEL_SIZE_API_KEY: undefined,
    },
    async () => {
      const cached = Array.from({ length: 139 }, (_, index) => ({
        id: `id-${index}`,
        slug: index === 0 ? "mercedes" : `make-${index}`,
        name: index === 0 ? "Mercedes-Benz" : `Make ${index}`,
        cachedAt: new Date(),
        modelsCachedAt: null,
      }));
      const { prisma } = fakePrisma({ makes: cached });
      const { client, calls } = fakeClient({
        getMakes: async () => [{ slug: "unexpected", name: "Unexpected" }],
      });
      const service = new FitmentService(prisma, client);

      const result = await service.getMakes();
      assert.equal(result.length, cached.length + MOCK_MAKES.length - 1);
      assert.ok(result.some((make) => make.slug === "make-138"));
      assert.ok(result.some((make) => make.slug === "audi"));
      assert.deepEqual(
        result.filter((make) => make.name === "Mercedes-Benz"),
        [{ slug: "mercedes", name: "Mercedes-Benz" }],
      );
      assert.equal(calls.getMakes, 0);
    },
  );
});

test("offline cache mode merges persisted and fixture descendants without upstream calls", async () => {
  await withEnv(
    {
      APP_ENV: "development",
      NODE_ENV: undefined,
      FITMENT_MOCK: undefined,
      WHEEL_SIZE_API_KEY: undefined,
    },
    async () => {
      const now = new Date();
      const { prisma } = fakePrisma({
        makes: [
          {
            id: "audi-id",
            slug: "audi",
            name: "Audi",
            cachedAt: now,
            modelsCachedAt: now,
          },
        ],
        models: [
          {
            id: "cached-model-id",
            makeId: "audi-id",
            slug: "cached-special",
            name: "Cached Special",
            years: [2024],
            yearsCachedAt: now,
            cachedAt: now,
          },
          {
            id: "uncached-model-id",
            makeId: "audi-id",
            slug: "uncached-special",
            name: "Uncached Special",
            years: [],
            yearsCachedAt: null,
            cachedAt: now,
          },
        ],
      });
      const { client, calls } = fakeClient();
      const service = new FitmentService(prisma, client);

      const models = await service.getModels("audi");
      const years = await service.getYears("audi", "cached-special");

      assert.ok(models.some((model) => model.slug === "cached-special"));
      assert.ok(models.some((model) => model.slug === "a4"));
      assert.ok(!models.some((model) => model.slug === "uncached-special"));
      assert.deepEqual(years, [2024]);
      await assert.rejects(
        service.getYears("audi", "uncached-special"),
        FitmentUpstreamError,
      );
      assert.deepEqual(calls, {
        getMakes: 0,
        getModels: 0,
        getYears: 0,
        searchByModel: 0,
      });
    },
  );
});

test("database failure in development falls back to mock data", async () => {
  await withEnv(
    {
      APP_ENV: "development",
      FITMENT_MOCK: "false",
      WHEEL_SIZE_API_KEY: undefined,
    },
    async () => {
      const { prisma } = fakePrisma();
      (prisma.vehicleMake.findMany as any) = async () => {
        throw new Error("database unavailable");
      };
      const { client, calls } = fakeClient();
      const service = new FitmentService(prisma, client);

      assert.deepEqual(await service.getMakes(), MOCK_MAKES);
      assert.equal(calls.getMakes, 0);
    },
  );
});

test("database failure in production is not hidden by mock fallback", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      FITMENT_MOCK: "false",
      WHEEL_SIZE_API_KEY: "production-key",
    },
    async () => {
      const { prisma } = fakePrisma();
      (prisma.vehicleMake.findMany as any) = async () => {
        throw new Error("database unavailable");
      };
      const { client, calls } = fakeClient();
      const service = new FitmentService(prisma, client);

      await assert.rejects(service.getMakes(), /database unavailable/);
      assert.equal(calls.getMakes, 0);
    },
  );
});

test("empty cache without a Wheel-Size key falls back to mock data in development", async () => {
  await withEnv(
    {
      APP_ENV: "development",
      FITMENT_MOCK: "false",
      WHEEL_SIZE_API_KEY: undefined,
    },
    async () => {
      const { prisma } = fakePrisma();
      const { client, calls } = fakeClient();
      const service = new FitmentService(prisma, client);

      assert.deepEqual(
        await service.getMakes(),
        [...MOCK_MAKES].sort((a, b) => a.name.localeCompare(b.name)),
      );
      assert.equal(calls.getMakes, 0);
    },
  );
});

test("cache miss calls the upstream client and persists the result", async () => {
  await withEnv(
    { FITMENT_MOCK: "false", WHEEL_SIZE_API_KEY: "test-key" },
    async () => {
      const { prisma, makes } = fakePrisma();
      const sample: FitmentMake[] = [{ slug: "bmw", name: "BMW" }];
      const { client, calls } = fakeClient({ getMakes: async () => sample });
      const service = new FitmentService(prisma, client);

      const result = await service.getMakes();
      assert.deepEqual(result, sample);
      assert.equal(calls.getMakes, 1);
      assert.equal(makes.length, 1);
      assert.equal(makes[0]!.slug, "bmw");
    },
  );
});

test("fresh cache is served without calling the upstream client", async () => {
  await withEnv(
    { FITMENT_MOCK: "false", WHEEL_SIZE_API_KEY: "test-key" },
    async () => {
      const { prisma } = fakePrisma({
        makes: [
          {
            id: "id-1",
            slug: "bmw",
            name: "BMW",
            cachedAt: new Date(),
            modelsCachedAt: null,
          },
        ],
      });
      const { client, calls } = fakeClient();
      const service = new FitmentService(prisma, client);

      const result = await service.getMakes();
      assert.deepEqual(result, [{ slug: "bmw", name: "BMW" }]);
      assert.equal(calls.getMakes, 0);
    },
  );
});

test("a cold years request creates the missing model row and persists its years", async () => {
  await withEnv(
    { FITMENT_MOCK: "false", WHEEL_SIZE_API_KEY: "test-key" },
    async () => {
      const { prisma, models } = fakePrisma();
      const { client, calls } = fakeClient({
        getYears: async () => [2024, 2023],
      });
      const service = new FitmentService(prisma, client);

      const result = await service.getYears("bmw", "3-series");

      assert.deepEqual(result, [2024, 2023]);
      assert.equal(calls.getYears, 1);
      assert.equal(models.length, 1);
      assert.equal(models[0]?.slug, "3-series");
      assert.deepEqual(models[0]?.years, [2024, 2023]);
      assert.ok(models[0]?.yearsCachedAt);
    },
  );
});

test("concurrent cold model requests are coalesced into one upstream call", async () => {
  await withEnv(
    { FITMENT_MOCK: "false", WHEEL_SIZE_API_KEY: "test-key" },
    async () => {
      const { prisma } = fakePrisma();
      const sample: FitmentModel[] = [{ slug: "3-series", name: "3 Series" }];
      const { client, calls } = fakeClient({
        getModels: async () => {
          await new Promise((resolve) => setImmediate(resolve));
          return sample;
        },
      });
      const service = new FitmentService(prisma, client);

      const [first, second] = await Promise.all([
        service.getModels("bmw"),
        service.getModels("bmw"),
      ]);

      assert.deepEqual(first, sample);
      assert.deepEqual(second, sample);
      assert.equal(calls.getModels, 1);
    },
  );
});

test("stale cache falls back to the stale entry when the upstream refresh fails", async () => {
  await withEnv(
    { FITMENT_MOCK: "false", WHEEL_SIZE_API_KEY: "test-key" },
    async () => {
      const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      const { prisma } = fakePrisma({
        makes: [
          {
            id: "id-1",
            slug: "bmw",
            name: "BMW",
            cachedAt: staleDate,
            modelsCachedAt: null,
          },
        ],
      });
      const { client } = fakeClient({
        getMakes: async () => {
          throw new FitmentUpstreamError("upstream down");
        },
      });
      const service = new FitmentService(prisma, client);

      const result = await service.getMakes();
      assert.deepEqual(result, [{ slug: "bmw", name: "BMW" }]);
    },
  );
});

test("lookup filters by trim and returns null for unknown combinations", async () => {
  await withEnv(
    { FITMENT_MOCK: "false", WHEEL_SIZE_API_KEY: "test-key" },
    async () => {
      const { prisma } = fakePrisma();
      const { client } = fakeClient({
        searchByModel: async () => [SAMPLE_TRIM],
      });
      const service = new FitmentService(prisma, client);

      const all = await service.lookup("bmw", "3-series", 2021);
      assert.equal(all?.trims.length, 1);

      const filtered = await service.lookup("bmw", "3-series", 2021, "320i");
      assert.equal(filtered?.trims[0]?.trimSlug, "320i");

      const unknownTrim = await service.lookup(
        "bmw",
        "3-series",
        2021,
        "m340i",
      );
      assert.equal(unknownTrim, null);

      const { client: emptyClient } = fakeClient({
        searchByModel: async () => [],
      });
      const emptyService = new FitmentService(fakePrisma().prisma, emptyClient);
      const notFound = await emptyService.lookup("unknown", "unknown", 2021);
      assert.equal(notFound, null);
    },
  );
});
