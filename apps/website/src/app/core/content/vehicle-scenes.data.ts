/**
 * GENERATED FILE — do not hand-edit.
 * Source: /vehicle-assets/manifest.json + catalog-vehicle-mapping.json
 * Regenerate: node scripts/generate-vehicle-scene-assets.mjs
 */

export interface VehicleSceneAnchor {
  readonly id: string;
  /** null = role undetermined (product review-required); matches every anchor. */
  readonly axleRole: string | null;
  readonly cx: number;
  readonly cy: number;
  readonly outerRadius: number;
}

export interface VehicleScene {
  readonly id: string;
  readonly bodyUrl: string;
  readonly occlusionUrl: string;
  readonly shadowUrl: string;
  readonly fallbackUrl: string;
  readonly anchors: readonly VehicleSceneAnchor[];
}

/** Shared canvas every scene layer is rendered at (see manifest.json). */
export const VEHICLE_SCENE_CANVAS = { width: 2400, height: 1350 } as const;

export const VEHICLE_SCENES: readonly VehicleScene[] = [
  {
    "id": "vehicle-passenger",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-passenger/vehicle-passenger-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-passenger/vehicle-passenger-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-passenger/vehicle-passenger-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-passenger/vehicle-passenger-fallback-wheels.webp",
    "anchors": [
      {
        "id": "front",
        "axleRole": "front",
        "cx": 512,
        "cy": 962,
        "outerRadius": 159
      },
      {
        "id": "rear",
        "axleRole": "rear",
        "cx": 1842,
        "cy": 962,
        "outerRadius": 159
      }
    ]
  },
  {
    "id": "vehicle-suv-4x4",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-suv-4x4/vehicle-suv-4x4-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-suv-4x4/vehicle-suv-4x4-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-suv-4x4/vehicle-suv-4x4-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-suv-4x4/vehicle-suv-4x4-fallback-wheels.webp",
    "anchors": [
      {
        "id": "front",
        "axleRole": "front",
        "cx": 527,
        "cy": 935,
        "outerRadius": 186
      },
      {
        "id": "rear",
        "axleRole": "rear",
        "cx": 1825,
        "cy": 935,
        "outerRadius": 186
      }
    ]
  },
  {
    "id": "vehicle-cargo-van",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-cargo-van/vehicle-cargo-van-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-cargo-van/vehicle-cargo-van-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-cargo-van/vehicle-cargo-van-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-cargo-van/vehicle-cargo-van-fallback-wheels.webp",
    "anchors": [
      {
        "id": "front",
        "axleRole": "front",
        "cx": 503,
        "cy": 984,
        "outerRadius": 137
      },
      {
        "id": "rear",
        "axleRole": "rear",
        "cx": 1822,
        "cy": 984,
        "outerRadius": 137
      }
    ]
  },
  {
    "id": "vehicle-highway-truck",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-highway-truck/vehicle-highway-truck-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-highway-truck/vehicle-highway-truck-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-highway-truck/vehicle-highway-truck-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-highway-truck/vehicle-highway-truck-fallback-wheels.webp",
    "anchors": [
      {
        "id": "steer-front",
        "axleRole": "steer",
        "cx": 412,
        "cy": 1031,
        "outerRadius": 88
      },
      {
        "id": "drive-rear-1",
        "axleRole": "drive",
        "cx": 886,
        "cy": 1031,
        "outerRadius": 88
      },
      {
        "id": "drive-rear-2",
        "axleRole": "drive",
        "cx": 1088,
        "cy": 1031,
        "outerRadius": 88
      },
      {
        "id": "trailer-1",
        "axleRole": "trailer",
        "cx": 1692,
        "cy": 1031,
        "outerRadius": 88
      },
      {
        "id": "trailer-2",
        "axleRole": "trailer",
        "cx": 1890,
        "cy": 1031,
        "outerRadius": 88
      },
      {
        "id": "trailer-3",
        "axleRole": "trailer",
        "cx": 2083,
        "cy": 1031,
        "outerRadius": 88
      }
    ]
  },
  {
    "id": "vehicle-quarry-dump",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-quarry-dump/vehicle-quarry-dump-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-quarry-dump/vehicle-quarry-dump-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-quarry-dump/vehicle-quarry-dump-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-quarry-dump/vehicle-quarry-dump-fallback-wheels.webp",
    "anchors": [
      {
        "id": "steer-front-1",
        "axleRole": "steer",
        "cx": 549,
        "cy": 982,
        "outerRadius": 138
      },
      {
        "id": "steer-front-2",
        "axleRole": "steer",
        "cx": 923,
        "cy": 982,
        "outerRadius": 138
      },
      {
        "id": "drive-rear-1",
        "axleRole": "drive",
        "cx": 1561,
        "cy": 982,
        "outerRadius": 138
      },
      {
        "id": "drive-rear-2",
        "axleRole": "drive",
        "cx": 1858,
        "cy": 982,
        "outerRadius": 138
      }
    ]
  },
  {
    "id": "vehicle-backhoe",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-backhoe/vehicle-backhoe-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-backhoe/vehicle-backhoe-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-backhoe/vehicle-backhoe-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-backhoe/vehicle-backhoe-fallback-wheels.webp",
    "anchors": [
      {
        "id": "front-small",
        "axleRole": "front-small",
        "cx": 839,
        "cy": 963,
        "outerRadius": 157
      },
      {
        "id": "rear-large",
        "axleRole": "rear-large",
        "cx": 1519,
        "cy": 901,
        "outerRadius": 219
      }
    ]
  },
  {
    "id": "vehicle-wheel-loader",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-wheel-loader/vehicle-wheel-loader-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-wheel-loader/vehicle-wheel-loader-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-wheel-loader/vehicle-wheel-loader-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-wheel-loader/vehicle-wheel-loader-fallback-wheels.webp",
    "anchors": [
      {
        "id": "front",
        "axleRole": "front-or-rear",
        "cx": 894,
        "cy": 923,
        "outerRadius": 195
      },
      {
        "id": "rear",
        "axleRole": "front-or-rear",
        "cx": 1704,
        "cy": 923,
        "outerRadius": 195
      }
    ]
  },
  {
    "id": "vehicle-skid-steer",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-skid-steer/vehicle-skid-steer-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-skid-steer/vehicle-skid-steer-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-skid-steer/vehicle-skid-steer-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-skid-steer/vehicle-skid-steer-fallback-wheels.webp",
    "anchors": [
      {
        "id": "front",
        "axleRole": "front-or-rear",
        "cx": 1017,
        "cy": 905,
        "outerRadius": 215
      },
      {
        "id": "rear",
        "axleRole": "front-or-rear",
        "cx": 1635,
        "cy": 905,
        "outerRadius": 215
      }
    ]
  },
  {
    "id": "vehicle-forklift",
    "bodyUrl": "/assets/vehicle-scenes/vehicle-forklift/vehicle-forklift-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/vehicle-forklift/vehicle-forklift-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/vehicle-forklift/vehicle-forklift-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/vehicle-forklift/vehicle-forklift-fallback-wheels.webp",
    "anchors": [
      {
        "id": "front-load",
        "axleRole": "front-load",
        "cx": 999,
        "cy": 936,
        "outerRadius": 184
      },
      {
        "id": "rear-steer",
        "axleRole": "rear-steer",
        "cx": 1897,
        "cy": 977,
        "outerRadius": 143
      }
    ]
  },
  {
    "id": "neutral-wheel-studio",
    "bodyUrl": "/assets/vehicle-scenes/neutral-wheel-studio/neutral-wheel-studio-body.webp",
    "occlusionUrl": "/assets/vehicle-scenes/neutral-wheel-studio/neutral-wheel-studio-occlusion.webp",
    "shadowUrl": "/assets/vehicle-scenes/neutral-wheel-studio/neutral-wheel-studio-shadow.webp",
    "fallbackUrl": "/assets/vehicle-scenes/neutral-wheel-studio/neutral-wheel-studio-fallback-wheel.webp",
    "anchors": [
      {
        "id": "center",
        "axleRole": null,
        "cx": 1200,
        "cy": 650,
        "outerRadius": 360
      }
    ]
  }
];

export const VEHICLE_SCENE_BY_ID: ReadonlyMap<string, VehicleScene> = new Map(
  VEHICLE_SCENES.map((s) => [s.id, s]),
);

export interface ProductVehicleMapping {
  readonly vehicleId: string;
  /** null = axle role not confidently determined for this product (visual class only). */
  readonly axleRole: string | null;
}

/** productCode (== Tire.id in the real catalog) → which scene + axle role to show it at. */
export const PRODUCT_VEHICLE_MAP: Readonly<Record<string, ProductVehicleMapping>> = {
  "003282": {
    "vehicleId": "vehicle-forklift",
    "axleRole": "front-load"
  },
  "002716": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002415": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002718": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "003264": {
    "vehicleId": "vehicle-skid-steer",
    "axleRole": "front-or-rear"
  },
  "003266": {
    "vehicleId": "vehicle-skid-steer",
    "axleRole": "front-or-rear"
  },
  "002555": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "000891": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002347": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002286": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "004257": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002193": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "000894": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "005858": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "005857": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002665": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-or-drive"
  },
  "002302": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002279": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002282": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002948": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "005278": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002050": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-or-drive"
  },
  "003017": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "005854": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "001089": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003003": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002294": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002296": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "000668": {
    "vehicleId": "vehicle-backhoe",
    "axleRole": "front-small"
  },
  "003230": {
    "vehicleId": "neutral-wheel-studio",
    "axleRole": null
  },
  "003227": {
    "vehicleId": "neutral-wheel-studio",
    "axleRole": null
  },
  "002301": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002300": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002192": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "000899": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002721": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003007": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002283": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002284": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "003008": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "004591": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002947": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "004592": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003009": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002295": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002298": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "005411": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "005370": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "001984": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "002104": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "002351": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "002105": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "002386": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "002892": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "005274": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "steer-front"
  },
  "005275": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "003271": {
    "vehicleId": "vehicle-backhoe",
    "axleRole": "front-small"
  },
  "004561": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002651": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002058": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "004750": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "steer-front"
  },
  "004484": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "000758": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002371": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "004748": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "004749": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "004385": {
    "vehicleId": "neutral-wheel-studio",
    "axleRole": null
  },
  "004589": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "003024": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "003004": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003005": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002731": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "002384": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "002385": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "steer-front"
  },
  "001040": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "steer-or-drive"
  },
  "002488": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002251": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002250": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002249": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "003002": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "004733": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003731": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "004611": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002595": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002890": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002552": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002551": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "005276": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "steer-front"
  },
  "005279": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002299": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003198": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "001907": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002297": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002722": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003233": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002247": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002246": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "004387": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "004388": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002374": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "002489": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "005106": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002245": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "003001": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "003169": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002244": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003913": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003741": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "004612": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002732": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002724": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002131": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002353": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002243": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "003235": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002241": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "005855": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "005856": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "003122": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003884": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002214": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002303": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "003129": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "002293": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002350": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002383": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "002240": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002382": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "steer-front"
  },
  "004613": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "004485": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "004389": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "002433": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "005107": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "004479": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "004614": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "000760": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "steer-front"
  },
  "001090": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "000761": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "drive-rear"
  },
  "003254": {
    "vehicleId": "vehicle-quarry-dump",
    "axleRole": "steer-or-drive"
  },
  "002304": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-or-drive"
  },
  "002506": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002239": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "002102": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "004390": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "002103": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "002238": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-front"
  },
  "004472": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "002352": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "trailer"
  },
  "002597": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-or-drive"
  },
  "005340": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "steer-or-drive"
  },
  "004471": {
    "vehicleId": "vehicle-highway-truck",
    "axleRole": "drive-rear"
  },
  "003268": {
    "vehicleId": "vehicle-wheel-loader",
    "axleRole": "front-or-rear"
  },
  "003273": {
    "vehicleId": "vehicle-backhoe",
    "axleRole": "rear-large"
  },
  "003276": {
    "vehicleId": "vehicle-forklift",
    "axleRole": "rear-steer"
  },
  "003283": {
    "vehicleId": "vehicle-forklift",
    "axleRole": null
  },
  "002277": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "004996": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002802": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004735": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002803": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003119": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003091": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "005622": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003012": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004605": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003103": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "005472": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002077": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003138": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002132": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003462": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003218": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002572": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002644": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002078": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002253": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002954": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002639": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004742": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002080": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002976": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003136": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003137": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002410": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002316": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003146": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003959": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003898": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002254": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002643": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003956": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003893": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002255": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003102": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005555": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002307": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004603": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002217": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003877": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003130": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002801": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002712": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002256": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005558": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002573": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004715": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005642": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002306": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004601": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002218": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004576": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005834": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005621": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002081": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005173": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002258": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005556": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004714": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002287": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004743": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005174": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002882": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005620": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002083": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004570": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003220": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004598": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002082": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003458": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003020": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004609": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002935": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002478": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002349": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003460": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002413": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003463": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003464": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003895": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002739": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002322": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003068": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002477": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003459": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003871": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002319": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003140": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003876": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002318": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003221": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003144": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "004071": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003092": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003958": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003131": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002490": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002640": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002480": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003089": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002586": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005547": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002308": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004716": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005475": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005545": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002574": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004720": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002085": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002259": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002309": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004993": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002260": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005560": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002310": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004602": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002261": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005563": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002828": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002811": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003058": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002398": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002969": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005564": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002645": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004571": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002417": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005454": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005199": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002311": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002534": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004445": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002421": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005172": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003021": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002087": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002921": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002780": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003469": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002086": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002957": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005196": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003888": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002474": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002928": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003057": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002399": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002958": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002401": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002859": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002090": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004703": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002414": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002411": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "005471": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002089": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003181": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002850": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002664": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002321": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003222": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003892": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002320": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003096": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002851": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002328": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003127": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "004235": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002088": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "005179": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002412": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "003883": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "004719": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003285": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004606": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005546": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002313": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002746": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004718": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005831": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005193": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004721": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005544": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003690": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004586": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002091": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002939": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005176": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002667": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002575": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005565": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004573": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002220": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005548": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004594": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002265": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005557": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002093": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003121": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002221": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002908": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004577": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005169": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004722": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004994": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002561": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005549": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005190": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002507": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005101": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005189": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002884": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003467": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002278": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003903": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002562": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002913": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002269": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004995": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002479": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004270": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005593": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004281": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002473": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002476": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002787": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003478": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003062": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002314": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005468": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002959": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002549": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002917": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002876": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002900": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002804": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005469": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002980": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005470": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003019": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003468": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003891": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002996": {
    "vehicleId": "vehicle-cargo-van",
    "axleRole": "front-or-rear"
  },
  "002972": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002588": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005591": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002509": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005832": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004580": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004578": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002264": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005552": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002582": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004726": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005554": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002590": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003145": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002973": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003879": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004723": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005830": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002883": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002224": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003286": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003466": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002475": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002886": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004579": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004744": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002223": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003120": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002584": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004600": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005592": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004584": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002275": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002942": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002404": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002713": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003177": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004597": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002472": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003059": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002711": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002405": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002929": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003461": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002979": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002591": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003957": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004091": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003878": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004727": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002564": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002885": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005562": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004761": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002406": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004745": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002508": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005833": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005589": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002484": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002130": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005551": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004630": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004650": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004608": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004572": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002271": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005343": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002975": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005184": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002097": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002099": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004713": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002714": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002934": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005835": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002407": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003689": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002323": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005455": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004725": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002098": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004690": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002324": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004582": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002315": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004737": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002550": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002967": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004691": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003784": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004585": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004688": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004717": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002482": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004658": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002566": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004736": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002961": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002895": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004724": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002990": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003093": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005474": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004599": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002100": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002545": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005559": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004728": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002982": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005590": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002933": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004741": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002936": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005561": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004992": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002567": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002810": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002956": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004662": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002977": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003134": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002960": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003757": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002276": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004704": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003219": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002585": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004574": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004595": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005553": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004610": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002418": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002548": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003465": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002408": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002409": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002965": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003143": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004667": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002486": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003779": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004660": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004664": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004444": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004666": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004668": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004575": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004596": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002095": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004588": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004654": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002925": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005457": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002962": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005458": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005459": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005181": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002963": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004693": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002953": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004635": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002881": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004656": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005192": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002971": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004675": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002661": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005460": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002932": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002981": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004676": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004670": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005466": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005182": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "005461": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002483": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005462": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004673": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004671": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002738": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005185": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "004674": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002927": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "003900": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004677": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005467": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002997": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "005463": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002419": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "003480": {
    "vehicleId": "vehicle-suv-4x4",
    "axleRole": "front-or-rear"
  },
  "002998": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002878": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004679": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004694": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004627": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002877": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "002999": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004695": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004685": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004698": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004696": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004699": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  },
  "004697": {
    "vehicleId": "vehicle-passenger",
    "axleRole": "front-or-rear"
  }
};
