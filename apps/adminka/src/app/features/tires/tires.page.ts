import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { AdminBrand, AdminTireModelListItem } from '@tyre/shared';

import { BrandAdminService } from '../../core/brand-admin.service';
import { TireAdminService } from '../../core/tire-admin.service';

const PAGE_SIZE = 20;

/** Tire-model list: brand filter + name search + pagination + create/rename/delete. */
@Component({
  selector: 'adm-tires-page',
  imports: [FormsModule, RouterLink],
  template: `
    <h1>საბურავები (მოდელები)</h1>

    @if (notice(); as n) {
      <p class="notice" [class.notice-error]="n.kind === 'error'">{{ n.text }}</p>
    }

    <form class="create-row" (ngSubmit)="create()">
      <label class="utility-field" for="tire-create-brand">
        <span>ახალი მოდელის ბრენდი</span>
        <select id="tire-create-brand" name="newBrand" [(ngModel)]="newBrandId" [disabled]="busy()">
          <option value="" disabled>აირჩიეთ ბრენდი</option>
          @for (b of brands(); track b.id) {
            <option [value]="b.id">{{ b.name }}</option>
          }
        </select>
      </label>
      <label class="utility-field" for="tire-create-name">
        <span>ახალი მოდელის სახელი</span>
        <input
          id="tire-create-name"
          name="newName"
          [(ngModel)]="newName"
          placeholder="მაგ. Primacy 4"
          maxlength="80"
          [disabled]="busy()"
        />
      </label>
      <button type="submit" [disabled]="busy() || !newBrandId || !newName.trim()">
        მოდელის დამატება
      </button>
    </form>

    <div class="filter-row">
      <label class="utility-field" for="tire-filter-brand">
        <span>ფილტრი: ბრენდი</span>
        <select
          id="tire-filter-brand"
          name="filterBrand"
          [(ngModel)]="filterBrand"
          (ngModelChange)="applyFilters()"
        >
          <option value="">ყველა ბრენდი</option>
          @for (b of brands(); track b.id) {
            <option [value]="b.id">{{ b.name }}</option>
          }
        </select>
      </label>
      <label class="utility-field" for="tire-filter-name">
        <span>ფილტრი: მოდელის სახელი</span>
        <input
          id="tire-filter-name"
          name="filterQ"
          [(ngModel)]="filterQ"
          (keyup.enter)="applyFilters()"
          placeholder="სახელი ან ნაწილი"
        />
      </label>
      <label class="utility-field" for="tire-filter-photos">
        <span>ფილტრი: ფოტოს სტატუსი</span>
        <select
          id="tire-filter-photos"
          name="filterPhotos"
          [(ngModel)]="filterPhotos"
          (ngModelChange)="applyFilters()"
        >
          <option value="">ყველა</option>
          <option value="with">ფოტოთი</option>
          <option value="without">ფოტოს გარეშე</option>
        </select>
      </label>
      <button type="button" class="secondary" (click)="applyFilters()">ძებნა</button>
    </div>

    @if (loading()) {
      <p>იტვირთება…</p>
    } @else if (loadError()) {
      <p class="notice notice-error">
        სია ვერ ჩაიტვირთა.
        <button type="button" class="link" (click)="reload()">თავიდან ცდა</button>
      </p>
    } @else {
      <table>
        <thead>
          <tr>
            <th>ბრენდი</th>
            <th>მოდელი</th>
            <th class="num">ზომა</th>
            <th class="num">ფოტო</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (m of items(); track m.id) {
            <tr>
              <td>{{ m.brand.name }}</td>
              <td>
                @if (editingId() === m.id) {
                  <form class="edit-row" (ngSubmit)="saveRename(m)">
                    <input
                      name="editName"
                      [(ngModel)]="editName"
                      maxlength="80"
                      [disabled]="busy()"
                      [attr.aria-label]="'მოდელის სახელის შეცვლა: ' + m.brand.name + ' ' + m.name"
                    />
                    <button type="submit" [disabled]="busy() || !editName.trim()">შენახვა</button>
                    <button type="button" class="secondary" (click)="editingId.set(null)">
                      გაუქმება
                    </button>
                  </form>
                } @else {
                  <a class="model-link" [routerLink]="['/tires', m.id]">{{ m.name }}</a>
                }
              </td>
              <td class="num">{{ m.productCount }}</td>
              <td class="num">{{ m.photoCount }}</td>
              <td class="actions">
                <a class="btn-like" [routerLink]="['/tires', m.id]">გახსნა</a>
                <button type="button" class="secondary" (click)="startEdit(m)" [disabled]="busy()">
                  გადარქმევა
                </button>
                @if (confirmingId() === m.id) {
                  <span class="confirm">
                    წავშალოთ?
                    <button
                      type="button"
                      class="danger"
                      (click)="confirmDelete(m)"
                      [disabled]="busy()"
                    >
                      კი
                    </button>
                    <button type="button" class="secondary" (click)="confirmingId.set(null)">
                      არა
                    </button>
                  </span>
                } @else {
                  <button
                    type="button"
                    class="danger"
                    (click)="confirmingId.set(m.id)"
                    [disabled]="busy() || m.productCount > 0 || m.photoCount > 0"
                    [title]="
                      m.productCount > 0 || m.photoCount > 0
                        ? 'ვერ წაიშლება: მოდელს აქვს ზომები ან ფოტოები'
                        : 'მოდელის წაშლა'
                    "
                  >
                    წაშლა
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>

      <div class="pager">
        <button
          type="button"
          class="secondary"
          (click)="goPage(page() - 1)"
          [disabled]="page() <= 1"
        >
          ←
        </button>
        <span>{{ page() }} / {{ maxPage() }} (სულ {{ total() }})</span>
        <button
          type="button"
          class="secondary"
          (click)="goPage(page() + 1)"
          [disabled]="page() >= maxPage()"
        >
          →
        </button>
      </div>
    }
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 1rem;
    }
    .notice {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #065f46;
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      font-size: 0.85rem;
      max-width: 760px;
    }
    .notice-error {
      background: #fef2f2;
      border-color: #fecaca;
      color: #b91c1c;
    }
    .create-row,
    .filter-row {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      align-items: end;
      flex-wrap: wrap;
    }
    .utility-field {
      display: grid;
      gap: 0.25rem;
      color: #4b5563;
      font-size: 0.76rem;
    }
    input,
    select {
      padding: 0.45rem 0.6rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
      background: #fff;
    }
    .create-row input {
      width: 240px;
    }
    button,
    .btn-like {
      padding: 0.45rem 0.8rem;
      border: none;
      border-radius: 6px;
      background: #111827;
      color: #fff;
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    button.secondary {
      background: #fff;
      color: #374151;
      border: 1px solid #d1d5db;
    }
    button.danger {
      background: #fff;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }
    button.link {
      background: none;
      color: #2563eb;
      border: none;
      padding: 0;
      text-decoration: underline;
    }
    .btn-like {
      background: #fff;
      color: #374151;
      border: 1px solid #d1d5db;
    }
    table {
      border-collapse: collapse;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      min-width: 760px;
    }
    th,
    td {
      text-align: left;
      padding: 0.55rem 0.9rem;
      font-size: 0.88rem;
      border-bottom: 1px solid #f3f4f6;
    }
    th {
      background: #f9fafb;
      color: #6b7280;
      font-weight: 600;
      font-size: 0.78rem;
    }
    .num {
      text-align: right;
    }
    .actions {
      display: flex;
      gap: 0.4rem;
      align-items: center;
    }
    .edit-row {
      display: flex;
      gap: 0.4rem;
    }
    .confirm {
      display: inline-flex;
      gap: 0.4rem;
      align-items: center;
      font-size: 0.85rem;
      color: #b91c1c;
    }
    .model-link {
      color: #111827;
      font-weight: 600;
      text-decoration: none;
    }
    .model-link:hover {
      text-decoration: underline;
    }
    .pager {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-top: 0.9rem;
      font-size: 0.85rem;
      color: #374151;
    }
  `,
})
export class TiresPage {
  private readonly api = inject(TireAdminService);
  private readonly brandApi = inject(BrandAdminService);

  readonly brands = signal<AdminBrand[]>([]);
  readonly items = signal<AdminTireModelListItem[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly maxPage = signal(1);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly busy = signal(false);
  readonly notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly confirmingId = signal<string | null>(null);

  newBrandId = '';
  newName = '';
  editName = '';
  filterBrand = '';
  filterQ = '';
  filterPhotos: '' | 'with' | 'without' = '';

  constructor() {
    // The "Photos" nav item deep-links here as /tires?photos=without.
    const photos = inject(ActivatedRoute).snapshot.queryParamMap.get('photos');
    if (photos === 'with' || photos === 'without') this.filterPhotos = photos;
    this.brandApi.list().subscribe({ next: (b) => this.brands.set(b) });
    this.reload();
  }

  applyFilters(): void {
    this.page.set(1);
    this.reload();
  }

  goPage(p: number): void {
    this.page.set(p);
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.api
      .list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        brand: this.filterBrand || undefined,
        q: this.filterQ.trim() || undefined,
        photos: this.filterPhotos || undefined,
      })
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.total.set(res.total);
          this.maxPage.set(Math.max(1, Math.ceil(res.total / PAGE_SIZE)));
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadError.set(true);
        },
      });
  }

  create(): void {
    const name = this.newName.trim();
    if (!name || !this.newBrandId || this.busy()) return;
    this.run(
      this.api.createModel({ brandId: this.newBrandId, name }),
      `მოდელი „${name}" დაემატა.`,
      () => (this.newName = ''),
    );
  }

  startEdit(m: AdminTireModelListItem): void {
    this.editingId.set(m.id);
    this.editName = m.name;
    this.confirmingId.set(null);
  }

  saveRename(m: AdminTireModelListItem): void {
    const name = this.editName.trim();
    if (!name || this.busy()) return;
    this.run(this.api.renameModel(m.id, { name }), `მოდელს დაერქვა „${name}".`, () =>
      this.editingId.set(null),
    );
  }

  confirmDelete(m: AdminTireModelListItem): void {
    if (this.busy()) return;
    this.run(this.api.removeModel(m.id), `მოდელი „${m.name}" წაიშალა.`, () =>
      this.confirmingId.set(null),
    );
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
    const serverMsg = (err.error as { message?: string } | null)?.message;
    if (err.status === 409) return serverMsg ?? 'კონფლიქტი.';
    if (err.status === 400) return 'არასწორი მონაცემები.';
    if (err.status === 404) return serverMsg ?? 'ვერ მოიძებნა.';
  }
  return 'ოპერაცია ვერ შესრულდა.';
}
