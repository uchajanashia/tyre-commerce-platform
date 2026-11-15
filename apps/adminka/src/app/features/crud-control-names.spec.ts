import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import {
  AdminBrand,
  AdminProduct,
  AdminTireModelDetail,
  AdminTireModelListItem,
} from '@tyre/shared';

import { BrandAdminService } from '../core/brand-admin.service';
import { TireAdminService } from '../core/tire-admin.service';
import { BrandsPage } from './brands/brands.page';
import { TireModelDetailPage } from './tires/tire-model-detail.page';
import { TiresPage } from './tires/tires.page';

const brand: AdminBrand = {
  id: 'roadx',
  name: 'RoadX',
  defaultCountry: null,
  productCount: 1,
  tireModelCount: 1,
};

const listItem: AdminTireModelListItem = {
  id: 'rx-motion',
  name: 'RX Motion',
  slug: 'rx-motion',
  brand: { id: brand.id, name: brand.name },
  productCount: 1,
  photoCount: 0,
};

const product = {
  id: 'sku-001',
  code: 'SKU-001',
  size: '205/55 R16',
  width: 205,
  profile: 55,
  rimDiameter: 16,
  commercial: false,
  construction: 'radial',
  vehicleClass: 'passenger',
  seasonGroup: 'summer',
  loadSpeedIndex: '91H',
  retailPrice: 200,
  wholesalePrice: 160,
  stockStatus: 'in_stock',
  stockQty: null,
} as AdminProduct;

const detail: AdminTireModelDetail = {
  id: listItem.id,
  name: listItem.name,
  slug: listItem.slug,
  brand: listItem.brand,
  photoCount: 0,
  photos: [],
  products: [product],
};

describe('legacy CRUD control names', () => {
  it('names brand create and contextual inline rename controls', async () => {
    const fixture = await createBrandsFixture();
    fixture.componentInstance.startEdit(brand);
    fixture.detectChanges();

    expectEveryControlToHaveUniqueName(fixture);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLInputElement>('input[name="editName"]')
        ?.getAttribute('aria-label'),
    ).toBe('ბრენდის სახელის შეცვლა: RoadX');
  });

  it('names tire create, filters and contextual inline rename controls', async () => {
    const fixture = await createTiresFixture();
    fixture.componentInstance.startEdit(listItem);
    fixture.detectChanges();

    expectEveryControlToHaveUniqueName(fixture);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLInputElement>('input[name="editName"]')
        ?.getAttribute('aria-label'),
    ).toBe('მოდელის სახელის შეცვლა: RoadX RX Motion');
  });

  it('names file, add-size, rename and every SKU inline-edit control', async () => {
    const fixture = await createDetailFixture();
    fixture.componentInstance.startRename();
    fixture.componentInstance.startEdit(product);
    fixture.detectChanges();

    expectEveryControlToHaveUniqueName(fixture);
    const editControls = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<
        HTMLInputElement | HTMLSelectElement
      >('tr.editing input, tr.editing select'),
    ];
    expect(editControls.length).toBe(9);
    expect(
      editControls.every((control) =>
        control.getAttribute('aria-label')?.startsWith('SKU SKU-001:'),
      ),
    ).toBe(true);
  });
});

async function createBrandsFixture(): Promise<ComponentFixture<BrandsPage>> {
  await TestBed.configureTestingModule({
    imports: [BrandsPage],
    providers: [{ provide: BrandAdminService, useValue: { list: () => of([brand]) } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(BrandsPage);
  fixture.detectChanges();
  return fixture;
}

async function createTiresFixture(): Promise<ComponentFixture<TiresPage>> {
  await TestBed.configureTestingModule({
    imports: [TiresPage],
    providers: [
      provideRouter([]),
      { provide: BrandAdminService, useValue: { list: () => of([brand]) } },
      {
        provide: TireAdminService,
        useValue: {
          list: () => of({ total: 1, page: 1, pageSize: 20, items: [listItem] }),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(TiresPage);
  fixture.detectChanges();
  return fixture;
}

async function createDetailFixture(): Promise<ComponentFixture<TireModelDetailPage>> {
  await TestBed.configureTestingModule({
    imports: [TireModelDetailPage],
    providers: [
      provideRouter([]),
      { provide: TireAdminService, useValue: { detail: () => of(detail) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(TireModelDetailPage);
  fixture.detectChanges();
  return fixture;
}

function expectEveryControlToHaveUniqueName<T>(fixture: ComponentFixture<T>): void {
  const root = fixture.nativeElement as HTMLElement;
  const controls = [
    ...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'),
  ];
  const names = controls.map((control) => accessibleName(control, root));

  expect(controls.length).toBeGreaterThan(0);
  expect(names, 'every control should have a programmatic name').not.toContain('');
  expect(new Set(names).size, `control names must be unique: ${names.join(' | ')}`).toBe(
    names.length,
  );
}

function accessibleName(control: HTMLInputElement | HTMLSelectElement, root: HTMLElement): string {
  const ariaLabel = control.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => root.querySelector<HTMLElement>(`#${id}`)?.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }

  const explicitLabel = control.id
    ? [...root.querySelectorAll<HTMLLabelElement>('label')].find(
        (label) => label.htmlFor === control.id,
      )
    : undefined;
  const label = explicitLabel ?? control.closest('label');
  if (!label) return '';

  const clone = label.cloneNode(true) as HTMLLabelElement;
  clone.querySelectorAll('input, select, option').forEach((element) => element.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
