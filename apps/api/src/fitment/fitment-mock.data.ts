import { FitmentMake, FitmentModel, FitmentOemByRim, FitmentTrim } from './fitment.types';
import { parseTireCode } from './tire-code.util';

interface MockRimSpec {
  rimDiameterInch: number;
  front: string;
  rear?: string;
}

interface MockTrimSeed {
  slug: string;
  name: string;
  sizes: MockRimSpec[];
}

interface MockModelSeed {
  slug: string;
  name: string;
  years: number[];
  trims: MockTrimSeed[];
}

interface MockMakeSeed {
  slug: string;
  name: string;
  models: MockModelSeed[];
}

function buildTrim(seed: MockTrimSeed): FitmentTrim {
  const oemBySize: FitmentOemByRim[] = seed.sizes.map((spec) => {
    const front = parseTireCode(spec.front);
    const rear = spec.rear ? parseTireCode(spec.rear) : null;
    return {
      rimDiameterInch: spec.rimDiameterInch,
      front: front.size,
      ...(rear ? { rear: rear.size } : {}),
    };
  });

  const loadIndexes = seed.sizes.flatMap((spec) => {
    const front = parseTireCode(spec.front);
    const rear = spec.rear ? parseTireCode(spec.rear) : null;
    return [front.loadIndex, rear?.loadIndex].filter((n): n is number => n != null);
  });
  const speedRatings = seed.sizes
    .map((spec) => parseTireCode(spec.front).speedRating)
    .filter((s): s is string => s != null);

  return {
    trimSlug: seed.slug,
    trimName: seed.name,
    rimDiametersInch: seed.sizes.map((s) => s.rimDiameterInch),
    oemBySize,
    staggered: seed.sizes.some((s) => !!s.rear),
    minLoadIndex: loadIndexes.length ? Math.min(...loadIndexes) : 0,
    oemSpeedRating: speedRatings[0] ?? 'H',
  };
}

/** ~10 common makes with realistic (but illustrative) fitment data, used when
 *  FITMENT_MOCK=true so frontend work isn't blocked on a Wheel-Size sandbox key. */
const MOCK_SEED: MockMakeSeed[] = [
  {
    slug: 'toyota',
    name: 'Toyota',
    models: [
      {
        slug: 'camry',
        name: 'Camry',
        years: [2021, 2022, 2023, 2024],
        trims: [
          { slug: 'le', name: 'LE', sizes: [{ rimDiameterInch: 16, front: '205/65R16 95H' }] },
          { slug: 'xse', name: 'XSE', sizes: [{ rimDiameterInch: 19, front: '235/40R19 96W' }] },
        ],
      },
      {
        slug: 'corolla',
        name: 'Corolla',
        years: [2020, 2021, 2022, 2023, 2024],
        trims: [{ slug: 'le', name: 'LE', sizes: [{ rimDiameterInch: 16, front: '205/55R16 91H' }] }],
      },
    ],
  },
  {
    slug: 'volkswagen',
    name: 'Volkswagen',
    models: [
      {
        slug: 'golf',
        name: 'Golf',
        years: [2020, 2021, 2022, 2023],
        trims: [
          { slug: 'comfortline', name: 'Comfortline', sizes: [{ rimDiameterInch: 16, front: '205/55R16 91V' }] },
          { slug: 'gti', name: 'GTI', sizes: [{ rimDiameterInch: 18, front: '225/40R18 92Y' }] },
        ],
      },
      {
        slug: 'passat',
        name: 'Passat',
        years: [2019, 2020, 2021, 2022],
        trims: [{ slug: 'se', name: 'SE', sizes: [{ rimDiameterInch: 17, front: '215/55R17 94V' }] }],
      },
    ],
  },
  {
    slug: 'bmw',
    name: 'BMW',
    models: [
      {
        slug: '3-series',
        name: '3 Series',
        years: [2019, 2020, 2021, 2022, 2023],
        trims: [
          {
            slug: '320i',
            name: '320i',
            sizes: [{ rimDiameterInch: 17, front: '225/45R17 91V' }],
          },
          {
            slug: 'm340i',
            name: 'M340i',
            sizes: [
              { rimDiameterInch: 19, front: '225/40R19 93Y', rear: '255/35R19 96Y' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'mercedes-benz',
    name: 'Mercedes-Benz',
    models: [
      {
        slug: 'c-class',
        name: 'C-Class',
        years: [2019, 2020, 2021, 2022],
        trims: [
          {
            slug: 'c300',
            name: 'C300',
            sizes: [{ rimDiameterInch: 18, front: '225/45R18 95H', rear: '245/40R18 97H' }],
          },
        ],
      },
    ],
  },
  {
    slug: 'ford',
    name: 'Ford',
    models: [
      {
        slug: 'focus',
        name: 'Focus',
        years: [2018, 2019, 2020],
        trims: [{ slug: 'se', name: 'SE', sizes: [{ rimDiameterInch: 16, front: '205/60R16 92H' }] }],
      },
      {
        slug: 'escape',
        name: 'Escape',
        years: [2021, 2022, 2023, 2024],
        trims: [{ slug: 'se', name: 'SE', sizes: [{ rimDiameterInch: 17, front: '225/65R17 102H' }] }],
      },
    ],
  },
  {
    slug: 'honda',
    name: 'Honda',
    models: [
      {
        slug: 'civic',
        name: 'Civic',
        years: [2020, 2021, 2022, 2023, 2024],
        trims: [
          { slug: 'lx', name: 'LX', sizes: [{ rimDiameterInch: 16, front: '215/55R16 93H' }] },
          { slug: 'si', name: 'Si', sizes: [{ rimDiameterInch: 18, front: '235/40R18 91W' }] },
        ],
      },
      {
        slug: 'cr-v',
        name: 'CR-V',
        years: [2020, 2021, 2022, 2023],
        trims: [{ slug: 'ex', name: 'EX', sizes: [{ rimDiameterInch: 18, front: '235/60R18 103H' }] }],
      },
    ],
  },
  {
    slug: 'hyundai',
    name: 'Hyundai',
    models: [
      {
        slug: 'elantra',
        name: 'Elantra',
        years: [2021, 2022, 2023, 2024],
        trims: [{ slug: 'sel', name: 'SEL', sizes: [{ rimDiameterInch: 16, front: '205/55R16 91H' }] }],
      },
      {
        slug: 'tucson',
        name: 'Tucson',
        years: [2022, 2023, 2024],
        trims: [{ slug: 'sel', name: 'SEL', sizes: [{ rimDiameterInch: 17, front: '225/60R17 99H' }] }],
      },
    ],
  },
  {
    slug: 'kia',
    name: 'Kia',
    models: [
      {
        slug: 'sportage',
        name: 'Sportage',
        years: [2021, 2022, 2023, 2024],
        trims: [{ slug: 'lx', name: 'LX', sizes: [{ rimDiameterInch: 17, front: '225/60R17 99H' }] }],
      },
      {
        slug: 'optima',
        name: 'Optima',
        years: [2018, 2019, 2020],
        trims: [{ slug: 'lx', name: 'LX', sizes: [{ rimDiameterInch: 16, front: '205/65R16 95H' }] }],
      },
    ],
  },
  {
    slug: 'nissan',
    name: 'Nissan',
    models: [
      {
        slug: 'altima',
        name: 'Altima',
        years: [2019, 2020, 2021, 2022, 2023],
        trims: [
          { slug: 's', name: 'S', sizes: [{ rimDiameterInch: 16, front: '215/60R16 95H' }] },
          { slug: 'sr', name: 'SR', sizes: [{ rimDiameterInch: 19, front: '235/40R19 96V' }] },
        ],
      },
      {
        slug: 'rogue',
        name: 'Rogue',
        years: [2021, 2022, 2023, 2024],
        trims: [{ slug: 's', name: 'S', sizes: [{ rimDiameterInch: 17, front: '225/65R17 102H' }] }],
      },
    ],
  },
  {
    slug: 'audi',
    name: 'Audi',
    models: [
      {
        slug: 'a4',
        name: 'A4',
        years: [2019, 2020, 2021, 2022],
        trims: [
          { slug: '40-tfsi', name: '40 TFSI', sizes: [{ rimDiameterInch: 17, front: '225/50R17 94H' }] },
          {
            slug: '45-tfsi-quattro',
            name: '45 TFSI quattro',
            sizes: [{ rimDiameterInch: 18, front: '245/40R18 93Y' }],
          },
        ],
      },
    ],
  },
];

export const MOCK_MAKES: FitmentMake[] = MOCK_SEED.map((m) => ({ slug: m.slug, name: m.name }));

export function mockModels(makeSlug: string): FitmentModel[] {
  const make = MOCK_SEED.find((m) => m.slug === makeSlug);
  return make ? make.models.map((m) => ({ slug: m.slug, name: m.name })) : [];
}

export function mockYears(makeSlug: string, modelSlug: string): number[] {
  const model = MOCK_SEED.find((m) => m.slug === makeSlug)?.models.find((mo) => mo.slug === modelSlug);
  return model ? [...model.years].sort((a, b) => b - a) : [];
}

export function mockTrims(makeSlug: string, modelSlug: string, year: number): FitmentTrim[] {
  const model = MOCK_SEED.find((m) => m.slug === makeSlug)?.models.find((mo) => mo.slug === modelSlug);
  if (!model || !model.years.includes(year)) {
    return [];
  }
  return model.trims.map(buildTrim);
}
