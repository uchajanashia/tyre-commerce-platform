import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { AdminPhoto, AdminProduct, AdminTireModelDetail, CreateProductRequest } from '@tyre/shared';

import { TireAdminService } from '../../core/tire-admin.service';

interface SizeForm {
  code: string;
  width: number | null;
  profile: number | null;
  rimDiameter: number | null;
  commercial: boolean;
  construction: 'radial' | 'bias';
  vehicleClass: 'passenger' | 'truck';
  seasonGroup: '' | 'summer' | 'all_season' | 'winter';
  loadSpeedIndex: string;
  retailPrice: number | null;
  wholesalePrice: number | null;
  stockStatus: 'in_stock' | 'limited' | 'out_of_stock';
  stockQty: number | null;
}

function emptyForm(): SizeForm {
  return {
    code: '',
    width: null,
    profile: null,
    rimDiameter: null,
    commercial: false,
    construction: 'radial',
    vehicleClass: 'passenger',
    seasonGroup: '',
    loadSpeedIndex: '',
    retailPrice: null,
    wholesalePrice: null,
    stockStatus: 'in_stock',
    stockQty: null,
  };
}

@Component({
  selector: 'adm-tire-model-detail-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './tire-model-detail.page.html',
  styleUrl: './tire-model-detail.page.scss',
})
export class TireModelDetailPage {
  private readonly api = inject(TireAdminService);
  private readonly route = inject(ActivatedRoute);

  readonly model = signal<AdminTireModelDetail | null>(null);
  readonly loadError = signal(false);
  readonly busy = signal(false);
  readonly notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);
  readonly renaming = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmingId = signal<string | null>(null);
  readonly confirmingPhotoId = signal<string | null>(null);
  readonly selectedPhotoId = signal<string | null>(null);
  readonly failedPhotos = signal<Set<string>>(new Set());
  readonly photo = computed(
    () =>
      this.model()?.photos.find((p) => p.id === this.selectedPhotoId()) ??
      this.model()?.photos[0] ??
      null,
  );
  readonly photoIndex = computed(
    () => this.model()?.photos.findIndex((p) => p.id === this.photo()?.id) ?? -1,
  );
  readonly editor = viewChild<ElementRef<HTMLDialogElement>>('editor');
  readonly preview = viewChild<ElementRef<HTMLDialogElement>>('preview');
  query = '';
  sort = 'size';

  visibleProducts(): AdminProduct[] {
    const q = this.query.trim().toLowerCase();
    return [...(this.model()?.products ?? [])]
      .filter((p) => `${p.code} ${p.size}`.toLowerCase().includes(q))
      .sort((a, b) =>
        this.sort === 'price'
          ? a.retailPrice - b.retailPrice
          : a.rimDiameter - b.rimDiameter ||
            a.width - b.width ||
            (a.profile ?? 0) - (b.profile ?? 0),
      );
  }

  get form(): SizeForm {
    return this.editingId() ? this.edit : this.add;
  }

  openAdd(): void {
    this.editingId.set(null);
    this.notice.set(null);
    this.editor()?.nativeElement.showModal();
  }

  closeEditor(): void {
    if (!this.busy()) this.editor()?.nativeElement.close();
  }

  saveSize(): void {
    if (!this.formValid(this.form)) return;
    const product = this.model()?.products.find((p) => p.id === this.editingId());
    if (product) this.saveEdit(product);
    else this.addSize();
  }

  formValid(f: SizeForm): boolean {
    return (
      !!f.code.trim() &&
      f.width !== null &&
      f.width >= 1 &&
      f.rimDiameter !== null &&
      f.rimDiameter >= 1 &&
      (f.profile === null || (Number.isInteger(f.profile) && f.profile >= 1)) &&
      f.retailPrice !== null &&
      Number.isInteger(f.retailPrice) &&
      f.retailPrice >= 0 &&
      f.wholesalePrice !== null &&
      Number.isInteger(f.wholesalePrice) &&
      f.wholesalePrice >= 0
    );
  }

  selectPhoto(id: string): void {
    this.selectedPhotoId.set(id);
    this.confirmingPhotoId.set(null);
  }

  stepPhoto(delta: number): void {
    const photos = this.model()?.photos ?? [];
    if (photos.length)
      this.selectPhoto(photos[(this.photoIndex() + delta + photos.length) % photos.length].id);
  }

  photoFailed(id: string): void {
    this.failedPhotos.update((ids) => new Set([...ids, id]));
  }

  newPhotoErrors(): Set<string> {
    return new Set();
  }

  money(value: number): string {
    return new Intl.NumberFormat('ka-GE').format(value);
  }

  deleteEdited(): void {
    const p = this.model()?.products.find((p) => p.id === this.editingId());
    if (p) this.confirmDelete(p);
  }

  makeMain(): void {
    const m = this.model();
    const ph = this.photo();
    if (!m || !ph || this.busy() || this.photoIndex() === 0) return;
    this.run(
      this.api.reorderPhotos(this.id, [
        ph.id,
        ...m.photos.filter((p) => p.id !== ph.id).map((p) => p.id),
      ]),
      'მთავარი ფოტო შეიცვალა.',
      () => {},
    );
  }

  renameName = '';
  add: SizeForm = emptyForm();
  edit: SizeForm = emptyForm();

  private readonly id = this.route.snapshot.paramMap.get('id')!;

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loadError.set(false);
    this.api.detail(this.id).subscribe({
      next: (m) => this.model.set(m),
      error: () => this.loadError.set(true),
    });
  }

  seasonLabel(g: AdminProduct['seasonGroup']): string {
    return g === 'summer'
      ? 'ზაფხული'
      : g === 'all_season'
        ? 'ყველა სეზონი'
        : g === 'winter'
          ? 'ზამთარი'
          : '—';
  }

  stockLabel(s: AdminProduct['stockStatus']): string {
    return s === 'in_stock' ? 'მარაგშია' : s === 'limited' ? 'ლიმიტირებული' : 'ამოიწურა';
  }

  startRename(): void {
    this.renameName = this.model()?.name ?? '';
    this.renaming.set(true);
  }

  saveRename(): void {
    const name = this.renameName.trim();
    if (!name || this.busy()) return;
    this.run(this.api.renameModel(this.id, { name }), `მოდელს დაერქვა „${name}".`, () =>
      this.renaming.set(false),
    );
  }

  addValid(): boolean {
    return this.formValid(this.add);
  }

  addSize(): void {
    if (!this.addValid() || this.busy()) return;
    this.run(
      this.api.createProduct(this.id, this.toRequest(this.add)),
      `ზომა დაემატა (SKU ${this.add.code.trim()}).`,
      () => {
        this.add = emptyForm();
        this.editor()?.nativeElement.close();
      },
    );
  }

  startEdit(p: AdminProduct): void {
    this.editingId.set(p.id);
    this.confirmingId.set(null);
    this.edit = {
      code: p.code,
      width: p.width,
      profile: p.profile,
      rimDiameter: p.rimDiameter,
      commercial: p.commercial,
      construction: p.construction,
      vehicleClass: p.vehicleClass,
      seasonGroup: p.seasonGroup ?? '',
      loadSpeedIndex: p.loadSpeedIndex ?? '',
      retailPrice: p.retailPrice,
      wholesalePrice: p.wholesalePrice,
      stockStatus: p.stockStatus,
      stockQty: p.stockQty,
    };
    this.notice.set(null);
    this.editor()?.nativeElement.showModal();
  }

  saveEdit(p: AdminProduct): void {
    if (this.busy() || !this.formValid(this.edit)) return;
    const body = this.toRequest(this.edit);
    delete (body as { code?: string }).code;
    // Quantity belongs to warehouse workflows, never to the price editor.
    delete body.stockQty;
    this.run(this.api.updateProduct(p.id, body), `ზომა ${p.code} განახლდა.`, () => {
      this.editingId.set(null);
      this.editor()?.nativeElement.close();
    });
  }

  confirmDelete(p: AdminProduct): void {
    if (this.busy()) return;
    this.run(this.api.removeProduct(p.id), `ზომა ${p.size} (SKU ${p.code}) წაიშალა.`, () => {
      this.confirmingId.set(null);
      this.editor()?.nativeElement.close();
    });
  }

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0 || this.busy()) return;
    if (
      files.length + (this.model()?.photos.length ?? 0) > 6 ||
      files.some(
        (f) =>
          !['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024,
      )
    ) {
      this.notice.set({
        kind: 'error',
        text: 'აირჩიეთ JPG, PNG ან WebP, თითოეული 5 MB-მდე; სულ მაქსიმუმ 6 ფოტო.',
      });
      input.value = '';
      return;
    }
    this.run(
      this.api.uploadPhotos(this.id, files),
      `${files.length} ფოტო აიტვირთა.`,
      () => (input.value = ''),
    );
  }

  movePhoto(m: AdminTireModelDetail, index: number, delta: -1 | 1): void {
    if (this.busy()) return;
    const ids = m.photos.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    this.run(this.api.reorderPhotos(this.id, ids), 'თანმიმდევრობა შეიცვალა.', () => {});
  }

  confirmDeletePhoto(ph: AdminPhoto): void {
    if (this.busy()) return;
    this.run(this.api.removePhoto(ph.id), 'ფოტო წაიშალა.', () => this.confirmingPhotoId.set(null));
  }

  private toRequest(f: SizeForm): CreateProductRequest {
    return {
      code: f.code.trim(),
      width: f.width!,
      profile: f.profile ?? null,
      rimDiameter: f.rimDiameter!,
      commercial: f.commercial,
      construction: f.construction,
      vehicleClass: f.vehicleClass,
      seasonGroup: f.seasonGroup === '' ? null : f.seasonGroup,
      loadSpeedIndex: f.loadSpeedIndex.trim() || null,
      retailPrice: f.retailPrice!,
      wholesalePrice: f.wholesalePrice!,
      stockStatus: f.stockStatus,
      stockQty: f.stockQty ?? null,
    };
  }

  private run(req: Observable<unknown>, okText: string, onOk: () => void): void {
    this.busy.set(true);
    this.notice.set(null);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        onOk();
        this.notice.set({ kind: 'ok', text: okText });
        this.reload();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.notice.set({ kind: 'error', text: errorText(err) });
      },
    });
  }
}

function errorText(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const serverMsg = (err.error as { message?: string | string[] } | null)?.message;
    const msg = Array.isArray(serverMsg) ? serverMsg.join('; ') : serverMsg;
    if (err.status === 409) return msg ?? 'კონფლიქტი.';
    if (err.status === 400) return msg ?? 'არასწორი მონაცემები.';
    if (err.status === 404) return msg ?? 'ვერ მოიძებნა.';
  }
  return 'ოპერაცია ვერ შესრულდა.';
}
