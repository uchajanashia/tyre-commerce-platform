import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AdminProduct, AdminTireModelDetail } from '@tyre/shared';
import { of, Subject, throwError } from 'rxjs';
import { TireAdminService } from '../../core/tire-admin.service';
import { TireModelDetailPage } from './tire-model-detail.page';

const product = {
  id: 'product-1',
  code: '003024',
  size: '455/40R22.5',
  width: 455,
  profile: 40,
  rimDiameter: 22.5,
  commercial: false,
  construction: 'radial',
  vehicleClass: 'truck',
  seasonGroup: 'all_season',
  loadSpeedIndex: null,
  retailPrice: 1150,
  wholesalePrice: 1030,
  stockStatus: 'in_stock',
  stockQty: null,
} as AdminProduct;
const model: AdminTireModelDetail = {
  id: 'model-1',
  name: 'GL251T',
  slug: 'gl251t',
  brand: { id: 'advance', name: 'ADVANCE' },
  photoCount: 2,
  photos: [
    { id: 'front', url: '/front.webp', position: 0 },
    { id: 'side', url: '/side.webp', position: 1 },
  ],
  products: [product],
};

describe('TireModelDetailPage', () => {
  let fixture: ComponentFixture<TireModelDetailPage>;
  let page: TireModelDetailPage;
  const api = {
    detail: vi.fn(),
    updateProduct: vi.fn(),
    createProduct: vi.fn(),
    uploadPhotos: vi.fn(),
    reorderPhotos: vi.fn(),
    removeProduct: vi.fn(),
  };

  beforeEach(async () => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.detail.mockReturnValue(of(structuredClone(model)));
    await TestBed.configureTestingModule({
      imports: [TireModelDetailPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'model-1' }) } },
        },
        { provide: TireAdminService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TireModelDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    // jsdom does not implement the native modal top layer; browser checks cover focus and Escape.
    for (const dialog of fixture.nativeElement.querySelectorAll('dialog')) {
      dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''));
      dialog.close = vi.fn(() => dialog.removeAttribute('open'));
    }
  });
  afterEach(() => fixture.destroy());

  it('allows Escape to close the editor except during a pending save', () => {
    const dialog = page.editor()!.nativeElement;
    const idleCancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(idleCancel);
    expect(idleCancel.defaultPrevented).toBe(false);
    page.busy.set(true);
    fixture.detectChanges();
    const savingCancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(savingCancel);
    expect(savingCancel.defaultPrevented).toBe(true);
  });

  it('shows server prices and distinguishes unknown quantity from catalog availability', () => {
    const row = fixture.nativeElement.querySelector('.product-row') as HTMLElement;
    expect(row.textContent).toContain(page.money(1150));
    expect(row.textContent).toContain('დასაზუსტებელია');
    expect(row.textContent).not.toContain('0 ცალი');
    expect(fixture.nativeElement.querySelector('dialog[open]')).toBeNull();
  });

  it('preserves SKU and warehouse quantity when editing prices, and prevents double submission', () => {
    const pending = new Subject<unknown>();
    api.updateProduct.mockReturnValue(pending);
    page.startEdit(product);
    page.edit.retailPrice = 1200;
    page.saveSize();
    page.saveSize();
    expect(api.updateProduct).toHaveBeenCalledTimes(1);
    const payload = api.updateProduct.mock.calls[0][1];
    expect(payload.retailPrice).toBe(1200);
    expect(payload.stockQty).toBeUndefined();
    expect(payload.code).toBeUndefined();
    pending.next({});
    pending.complete();
    expect(page.editor()!.nativeElement.open).toBe(false);
    expect(api.detail).toHaveBeenCalledTimes(2);
  });

  it('keeps the editor and entered prices after a server rejection', () => {
    api.updateProduct.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    page.startEdit(product);
    page.edit.retailPrice = 1200;
    page.saveSize();
    expect(page.edit.retailPrice).toBe(1200);
    expect(page.editor()!.nativeElement.open).toBe(true);
    expect(page.notice()?.kind).toBe('error');
    expect(page.busy()).toBe(false);
  });

  it('rejects negative or fractional prices without sending a mutation', () => {
    page.startEdit(product);
    page.edit.retailPrice = -1;
    page.saveSize();
    page.edit.retailPrice = 1.5;
    page.saveSize();
    expect(api.updateProduct).not.toHaveBeenCalled();
  });

  it('reorders all photo IDs when making a photo primary, and preserves selection', () => {
    api.reorderPhotos.mockReturnValue(of({}));
    page.selectPhoto('side');
    page.makeMain();
    expect(api.reorderPhotos).toHaveBeenCalledWith('model-1', ['side', 'front']);
    expect(page.photo()?.id).toBe('side');
    page.stepPhoto(1);
    expect(page.photo()?.id).toBe('front');
  });

  it('renders an explicit image failure instead of a broken thumbnail', () => {
    const image = fixture.nativeElement.querySelector('.enlarge img') as HTMLImageElement;
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.image-error')?.textContent).toContain(
      'ფოტო ვერ ჩაიტვირთა',
    );
    expect(fixture.nativeElement.querySelector('.enlarge')).toBeNull();
  });

  it('rejects unsupported uploads and more than six total photos', () => {
    const send = (files: File[]) =>
      page.onFilesPicked({ target: { files, value: 'file' } } as unknown as Event);
    send([new File(['data'], 'image.svg', { type: 'image/svg+xml' })]);
    expect(page.notice()?.kind).toBe('error');
    send(
      Array.from({ length: 5 }, () => new File(['image'], 'photo.webp', { type: 'image/webp' })),
    );
    expect(api.uploadPhotos).not.toHaveBeenCalled();
  });

  it('can retry initial loading without retaining the error state', () => {
    api.detail
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValue(of(model));
    page.reload();
    expect(page.loadError()).toBe(true);
    page.reload();
    expect(page.loadError()).toBe(false);
  });
});
