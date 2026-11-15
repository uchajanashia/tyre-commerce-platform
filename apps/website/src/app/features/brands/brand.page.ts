import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { Brand } from '@core/models';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { SeoService } from '@core/services/seo.service';

type BrandState =
  | { kind: 'loading' }
  | { kind: 'found'; value: Brand }
  | { kind: 'missing' }
  | { kind: 'error' };

/** Brand storytelling page (spec 06, phase 5+). Phase 1: minimal data-backed stub. */
@Component({
  selector: 'app-brand-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="page">
      @if (brandState().kind === 'loading') {
        <h1 i18n>ბრენდი იტვირთება…</h1>
      } @else if (brand(); as b) {
        <h1>{{ b.name }}</h1>
        @if (b.country || b.tier) {
          <p class="page__meta">
            {{ b.country }} @if (b.country && b.tier) { · } {{ b.tier }}
          </p>
        }
        @if (b.story) {
          <p class="page__story">{{ b.story }}</p>
        }
        <a [routerLink]="['/catalog']" [queryParams]="{ brand: b.id }" i18n>
          ბრენდის პროდუქტების ნახვა →
        </a>
      } @else if (brandState().kind === 'error') {
        <h1 i18n>კატალოგი დროებით მიუწვდომელია</h1>
        <p i18n>გთხოვ, ცოტა ხანში სცადე ხელახლა.</p>
      } @else {
        <h1 i18n>ბრენდი ვერ მოიძებნა</h1>
        <a routerLink="/catalog" i18n>← კატალოგში დაბრუნება</a>
      }
    </section>
  `,
  styles: `
    .page {
      max-width: 720px;
      margin: 0 auto;
      padding: var(--space-8) var(--space-5);
      display: grid;
      gap: var(--space-4);
    }

    .page__meta {
      color: var(--accent);
      font-size: var(--text-sm);
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .page__story {
      color: var(--ink-1);
    }

    a {
      color: var(--accent);
    }
  `,
})
export class BrandPage {
  private readonly data = inject(FitmentDataService);
  private readonly seo = inject(SeoService);

  /** route param via withComponentInputBinding */
  readonly id = input.required<string>();

  protected readonly brandState = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        this.data.getBrand(id).pipe(
          map(
            (brand): BrandState =>
              brand ? { kind: 'found', value: brand } : { kind: 'missing' },
          ),
          catchError(() => of<BrandState>({ kind: 'error' })),
          startWith<BrandState>({ kind: 'loading' }),
        ),
      ),
    ),
    { initialValue: { kind: 'loading' } as BrandState },
  );

  protected readonly brand = () => {
    const state = this.brandState();
    return state.kind === 'found' ? state.value : undefined;
  };

  constructor() {
    effect(() => {
      const state = this.brandState();
      if (state.kind === 'missing') {
        this.seo.setNotFound('ბრენდი ვერ მოიძებნა');
      } else if (state.kind === 'error') {
        this.seo.setUnavailable('კატალოგი დროებით მიუწვდომელია');
      } else if (state.kind === 'found') {
        this.seo.setPage({
          title: state.value.name,
          description: `${state.value.name} — ბრენდის გვერდი tyre.ge-ზე.`,
          canonicalPath: `/brands/${encodeURIComponent(state.value.id)}`,
        });
      }
    });
  }
}
