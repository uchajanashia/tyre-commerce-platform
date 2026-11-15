import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { LanguageService } from '@core/i18n/language.service';

type PageItem = number | 'gap';

/**
 * Compact numbered window: always shows first + last + the current page with one
 * neighbour each side, collapsing the rest into ellipses.
 * e.g. page 6 of 21 → 1 … 4 5 [6] 7 8 … 21
 */
export function pageWindow(current: number, total: number): PageItem[] {
  const wanted = new Set<number>([
    1,
    total,
    current - 2,
    current - 1,
    current,
    current + 1,
    current + 2,
  ]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: PageItem[] = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) {
      out.push('gap');
    }
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Premium numbered pager (studio aesthetic): glass chrome, machined-metal current
 * page, 44px touch targets, real <button>s with aria-current / aria-labels.
 * Emits the requested page; the host owns the URL (?page=) + scroll + motion.
 */
@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="pg" [attr.aria-label]="copy('გვერდები', 'Pages')">
      <button
        type="button"
        class="pg__btn pg__edge"
        [disabled]="page() <= 1"
        (click)="go(page() - 1)"
        [attr.aria-label]="copy('წინა გვერდი', 'Previous page')"
      >
        <span class="pg__arrow" aria-hidden="true">‹</span>
        <span class="pg__edge-label">{{ copy('წინა', 'Previous') }}</span>
      </button>

      @for (item of items(); track $index) {
        @if (item === 'gap') {
          <span class="pg__gap" aria-hidden="true">…</span>
        } @else {
          <button
            type="button"
            class="pg__btn pg__num num"
            [class.is-current]="item === page()"
            [attr.aria-current]="item === page() ? 'page' : null"
            (click)="go(item)"
          >
            {{ item }}
          </button>
        }
      }

      <button
        type="button"
        class="pg__btn pg__edge"
        [disabled]="page() >= totalPages()"
        (click)="go(page() + 1)"
        [attr.aria-label]="copy('შემდეგი გვერდი', 'Next page')"
      >
        <span class="pg__edge-label">{{ copy('შემდეგი', 'Next') }}</span>
        <span class="pg__arrow" aria-hidden="true">›</span>
      </button>
    </nav>
  `,
  styles: `
    .pg {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
    }

    .pg__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-height: var(--touch-target);
      min-width: var(--touch-target);
      padding: 0 var(--space-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      color: var(--ink-1);
      font-size: var(--text-sm);
      transition:
        color var(--dur-fast) var(--ease-out),
        border-color var(--dur-fast) var(--ease-out);

      &:hover:not(:disabled) {
        color: var(--ink-0);
        border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      &:disabled {
        opacity: 0.4;
        cursor: default;
      }
    }

    /* current page — machined-metal accent (spec 01/07) */
    .pg__num.is-current {
      color: var(--accent-ink);
      border-color: var(--accent);
      background: var(--accent);
      background-image: linear-gradient(
        180deg,
        color-mix(in srgb, var(--metal) 88%, white) 0%,
        var(--metal) 52%,
        color-mix(in srgb, var(--metal) 82%, black) 100%
      );
      font-weight: var(--weight-medium);
    }

    .pg__arrow {
      font-size: 1.1em;
      line-height: 1;
    }

    .pg__gap {
      min-width: var(--space-3);
      text-align: center;
      color: var(--ink-1);
      user-select: none;
    }

    /* On narrow screens the edge buttons collapse to just their arrow. */
    @media (max-width: 560px) {
      .pg__edge-label {
        display: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .pg__btn {
        transition: none;
      }
    }
  `,
})
export class Pagination {
  private readonly language = inject(LanguageService);

  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly pageChange = output<number>();

  protected readonly items = computed(() => pageWindow(this.page(), this.totalPages()));

  protected copy(ka: string, en: string): string {
    return this.language.language() === 'en' ? en : ka;
  }

  protected go(target: number): void {
    const clamped = Math.min(Math.max(1, target), this.totalPages());
    if (clamped !== this.page()) {
      this.pageChange.emit(clamped);
    }
  }
}
