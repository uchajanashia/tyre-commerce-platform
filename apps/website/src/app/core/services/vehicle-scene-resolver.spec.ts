import { Tire } from '@core/models';

import { anchorMatchesRole, fallbackWindowStyle, resolveVehicleScene, scenePercent } from './vehicle-scene-resolver';
import { PRODUCT_VEHICLE_MAP, VEHICLE_SCENE_BY_ID } from '../content/vehicle-scenes.data';

function tireOf(id: string, catalogClass?: Tire['catalogClass']): Pick<Tire, 'id' | 'catalogClass'> {
  return { id, catalogClass };
}

describe('resolveVehicleScene (spec 07-product-media-vehicles.md)', () => {
  it('honors an admin scene assignment ahead of the bundled SKU mapping', () => {
    const result = resolveVehicleScene({ id: '002716', catalogClass: 'truck', vehicleClassification: 'vehicle-quarry-dump' });
    expect(result.scene.id).toBe('vehicle-quarry-dump');
    expect(result.axleRole).toBeNull();
  });
  it('preserves axle metadata when the stored scene matches the original mapping', () => {
    const result = resolveVehicleScene({ id: '002716', catalogClass: 'truck', vehicleClassification: 'vehicle-highway-truck' });
    expect(result.axleRole).toBe('drive-rear');
  });
  it('resolves a mapped highway-truck product to its scene and axle role', () => {
    const { scene, axleRole } = resolveVehicleScene(tireOf('002716', 'truck'));
    expect(scene.id).toBe('vehicle-highway-truck');
    expect(axleRole).toBe('drive-rear');
  });

  it('resolves a disk product to the neutral wheel studio', () => {
    const { scene, axleRole } = resolveVehicleScene(tireOf('003230', 'disk'));
    expect(scene.id).toBe('neutral-wheel-studio');
    expect(axleRole).toBeNull();
  });

  it('falls back to vehicle-passenger for an unmapped non-disk product (mock fixtures)', () => {
    const { scene, axleRole } = resolveVehicleScene(tireOf('mock-fixture-1'));
    expect(scene.id).toBe('vehicle-passenger');
    expect(axleRole).toBeNull();
  });

  it('falls back to the neutral wheel studio for an unmapped disk product', () => {
    const { scene } = resolveVehicleScene(tireOf('mock-disk-1', 'disk'));
    expect(scene.id).toBe('neutral-wheel-studio');
  });

  it('every one of the 606 catalog mappings resolves to a real, known scene', () => {
    const unknown = Object.entries(PRODUCT_VEHICLE_MAP)
      .filter(([, mapping]) => !VEHICLE_SCENE_BY_ID.has(mapping.vehicleId))
      .map(([code, mapping]) => `${code} -> ${mapping.vehicleId}`);
    expect(unknown).toEqual([]);
  });
});

describe('anchorMatchesRole', () => {
  const anchor = (axleRole: string | null) => ({ id: 'x', axleRole, cx: 0, cy: 0, outerRadius: 0 });

  it('null product role matches every anchor (axle undetermined)', () => {
    expect(anchorMatchesRole(anchor('steer'), null)).toBe(true);
    expect(anchorMatchesRole(anchor('trailer'), null)).toBe(true);
  });

  it('exact axle role match', () => {
    expect(anchorMatchesRole(anchor('drive'), 'drive')).toBe(true);
    expect(anchorMatchesRole(anchor('trailer'), 'drive')).toBe(false);
  });

  it('front-or-rear covers both front and rear anchors but not others', () => {
    expect(anchorMatchesRole(anchor('front'), 'front-or-rear')).toBe(true);
    expect(anchorMatchesRole(anchor('rear'), 'front-or-rear')).toBe(true);
    expect(anchorMatchesRole(anchor('steer'), 'front-or-rear')).toBe(false);
  });

  it('steer-or-drive covers steer and drive anchors but not trailer', () => {
    expect(anchorMatchesRole(anchor('steer'), 'steer-or-drive')).toBe(true);
    expect(anchorMatchesRole(anchor('drive'), 'steer-or-drive')).toBe(true);
    expect(anchorMatchesRole(anchor('trailer'), 'steer-or-drive')).toBe(false);
  });

  it('a highway-truck drive-rear product only lights up its two drive anchors', () => {
    const scene = VEHICLE_SCENE_BY_ID.get('vehicle-highway-truck')!;
    const matching = scene.anchors.filter((a) => anchorMatchesRole(a, 'drive-rear'));
    expect(matching.map((a) => a.id).sort()).toEqual(['drive-rear-1', 'drive-rear-2']);
  });

  it('a highway-truck steer-front product only lights up its steer anchor', () => {
    const scene = VEHICLE_SCENE_BY_ID.get('vehicle-highway-truck')!;
    const matching = scene.anchors.filter((a) => anchorMatchesRole(a, 'steer-front'));
    expect(matching.map((a) => a.id)).toEqual(['steer-front']);
  });

  it('a quarry-dump drive-rear product does not also light up its steer anchors', () => {
    const scene = VEHICLE_SCENE_BY_ID.get('vehicle-quarry-dump')!;
    const matching = scene.anchors.filter((a) => anchorMatchesRole(a, 'drive-rear'));
    expect(matching.map((a) => a.id).sort()).toEqual(['drive-rear-1', 'drive-rear-2']);
  });

  it('every distinct targetAxleRole used by the 606-product catalog matches at least one anchor on its assigned scene', () => {
    const unmatched = new Set<string>();
    for (const mapping of Object.values(PRODUCT_VEHICLE_MAP)) {
      const scene = VEHICLE_SCENE_BY_ID.get(mapping.vehicleId);
      if (!scene) continue;
      const hasMatch = scene.anchors.some((a) => anchorMatchesRole(a, mapping.axleRole));
      if (!hasMatch) unmatched.add(`${mapping.vehicleId}:${mapping.axleRole}`);
    }
    expect([...unmatched]).toEqual([]);
  });
});

describe('scenePercent', () => {
  it('converts a canvas coordinate to a percentage of its axis', () => {
    expect(scenePercent(1200, 2400)).toBe(50);
    expect(scenePercent(675, 1350)).toBe(50);
    expect(scenePercent(0, 2400)).toBe(0);
  });
});

describe('fallbackWindowStyle', () => {
  it('crops a centered anchor to a centered 50%/50% background-position', () => {
    // neutral-wheel-studio's single anchor: cx=1200 is exactly canvas-center (2400/2).
    const anchor = { id: 'center', axleRole: null, cx: 1200, cy: 650, outerRadius: 360 };
    const style = fallbackWindowStyle(anchor, 2400, 1350);
    expect(style.sizeXPercent).toBeCloseTo((2400 / 720) * 100, 6);
    expect(style.posXPercent).toBeCloseTo(50, 6);
  });

  it('the cropped window, once scaled back down, is exactly the anchor diameter', () => {
    // background-size% of 100 * (containerWidth) reconstructs to the full
    // source width; dividing back by that same ratio must return 2r.
    const anchor = { id: 'front', axleRole: 'front', cx: 512, cy: 962, outerRadius: 159 };
    const { sizeXPercent, sizeYPercent } = fallbackWindowStyle(anchor, 2400, 1350);
    expect((2400 / sizeXPercent) * 100).toBeCloseTo(anchor.outerRadius * 2, 6);
    expect((1350 / sizeYPercent) * 100).toBeCloseTo(anchor.outerRadius * 2, 6);
  });

  it('a left-edge anchor (cx - r = 0) crops from the source image origin (0%)', () => {
    const anchor = { id: 'edge', axleRole: null, cx: 100, cy: 100, outerRadius: 100 };
    const style = fallbackWindowStyle(anchor, 2400, 1350);
    expect(style.posXPercent).toBeCloseTo(0, 6);
    expect(style.posYPercent).toBeCloseTo(0, 6);
  });
});
