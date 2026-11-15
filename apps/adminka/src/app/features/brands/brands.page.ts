import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';

import { AdminBrand } from '@tyre/shared';

import { BrandAdminService } from '../../core/brand-admin.service';

/**
 * Brand CRUD. Renaming keeps the brand's id (slug) stable — it is the public
 * URL segment — so only the display name changes. Deleting is only allowed for
 * brands with zero products and zero tire models (the API enforces 409).
 */
@Component({
  selector: 'adm-brands-page',
  imports: [FormsModule],
  template: `
    <h1>ბრენდები</h1>

    @if (notice(); as n) {
      <p class="notice" [class.notice-error]="n.kind === 'error'">{{ n.text }}</p>
    }

    <form class="create-row" (ngSubmit)="create()">
      <label class="utility-field" for="brand-create-name">
        <span>ახალი ბრენდის სახელი</span>
        <input
          id="brand-create-name"
          name="newName"
          [(ngModel)]="newName"
          placeholder="მაგ. Michelin"
          maxlength="60"
          [disabled]="busy()"
        />
      </label>
      <button type="submit" [disabled]="busy() || !newName.trim()">დამატება</button>
    </form>

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
            <th>სახელი</th>
            <th>სლაგი</th>
            <th class="num">პროდუქტი</th>
            <th class="num">მოდელი</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (b of brands(); track b.id) {
            <tr>
              <td>
                @if (editingId() === b.id) {
                  <form class="edit-row" (ngSubmit)="saveRename(b)">
                    <input
                      name="editName"
                      [(ngModel)]="editName"
                      maxlength="60"
                      [disabled]="busy()"
                      [attr.aria-label]="'ბრენდის სახელის შეცვლა: ' + b.name"
                    />
                    <button type="submit" [disabled]="busy() || !editName.trim()">შენახვა</button>
                    <button type="button" class="secondary" (click)="cancelEdit()">გაუქმება</button>
                  </form>
                } @else {
                  {{ b.name }}
                }
              </td>
              <td class="slug">{{ b.id }}</td>
              <td class="num">{{ b.productCount }}</td>
              <td class="num">{{ b.tireModelCount }}</td>
              <td class="actions">
                <button type="button" class="secondary" (click)="startEdit(b)" [disabled]="busy()">
                  გადარქმევა
                </button>
                @if (confirmingId() === b.id) {
                  <span class="confirm">
                    წავშალოთ?
                    <button
                      type="button"
                      class="danger"
                      (click)="confirmDelete(b)"
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
                    (click)="confirmingId.set(b.id)"
                    [disabled]="busy() || b.productCount > 0 || b.tireModelCount > 0"
                    [title]="
                      b.productCount > 0 || b.tireModelCount > 0
                        ? 'ვერ წაიშლება: ბრენდს აქვს პროდუქტები ან მოდელები'
                        : 'ბრენდის წაშლა'
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
      max-width: 720px;
    }
    .notice-error {
      background: #fef2f2;
      border-color: #fecaca;
      color: #b91c1c;
    }
    .create-row {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      align-items: end;
    }
    .create-row input {
      width: 260px;
    }
    .utility-field {
      display: grid;
      gap: 0.25rem;
      color: #4b5563;
      font-size: 0.76rem;
    }
    input {
      padding: 0.45rem 0.6rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
    }
    button {
      padding: 0.45rem 0.8rem;
      border: none;
      border-radius: 6px;
      background: #111827;
      color: #fff;
      font-size: 0.85rem;
      cursor: pointer;
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
    button.danger:not(:disabled):hover {
      background: #fef2f2;
    }
    button.link {
      background: none;
      color: #2563eb;
      border: none;
      padding: 0;
      text-decoration: underline;
    }
    table {
      border-collapse: collapse;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      min-width: 720px;
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
    .slug {
      color: #6b7280;
      font-family: monospace;
      font-size: 0.8rem;
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
  `,
})
export class BrandsPage {
  private readonly api = inject(BrandAdminService);

  readonly brands = signal<AdminBrand[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly busy = signal(false);
  readonly notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  readonly editingId = signal<string | null>(null);
  readonly confirmingId = signal<string | null>(null);
  newName = '';
  editName = '';

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.api.list().subscribe({
      next: (list) => {
        this.brands.set(list);
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
    if (!name || this.busy()) return;
    this.run(this.api.create(name), `ბრენდი „${name}" დაემატა.`, () => (this.newName = ''));
  }

  startEdit(b: AdminBrand): void {
    this.editingId.set(b.id);
    this.editName = b.name;
    this.confirmingId.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveRename(b: AdminBrand): void {
    const name = this.editName.trim();
    if (!name || this.busy()) return;
    this.run(this.api.rename(b.id, name), `ბრენდს დაერქვა „${name}".`, () =>
      this.editingId.set(null),
    );
  }

  confirmDelete(b: AdminBrand): void {
    if (this.busy()) return;
    this.run(this.api.remove(b.id), `ბრენდი „${b.name}" წაიშალა.`, () =>
      this.confirmingId.set(null),
    );
  }

  /** Shared submit flow: busy flag, success notice + reload, friendly error notice. */
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
    if (err.status === 409) {
      const serverMsg = (err.error as { message?: string } | null)?.message;
      return serverMsg ?? 'კონფლიქტი: ასეთი ბრენდი უკვე არსებობს ან ცარიელი არ არის.';
    }
    if (err.status === 400) return 'არასწორი მონაცემები.';
  }
  return 'ოპერაცია ვერ შესრულდა.';
}
