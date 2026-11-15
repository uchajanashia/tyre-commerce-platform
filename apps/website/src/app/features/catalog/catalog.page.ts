import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { GarageService } from '@core/services/garage.service';
import { LanguageService } from '@core/i18n/language.service';
import { CatalogBrowser } from './catalog-browser';
import { CatalogPromoCarousel } from './catalog-promo-carousel';

/**
 * Catalog page (spec 06) — a thin wrapper around the reusable {@link CatalogBrowser}
 * (filter + grid + pagination), which the tire detail page reuses too.
 *
 * The page owns the catalog chrome and a soft link into the configurator.
 * Seasonal scope is handled by CatalogBrowser as real query state. The shared
 * climate backdrop owns the atmosphere so the transition stays site-wide.
 */
@Component({
  selector: 'app-catalog-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CatalogBrowser, CatalogPromoCarousel],
  template: `
    <section class="catalog">
      <div class="catalog__heading">
        <span class="catalog__eyebrow">TYRE.GE / CATALOG</span>
        <h1 class="catalog__title">{{ copy('კატალოგი', 'Catalog') }}</h1>
      </div>

      <app-catalog-promo-carousel />

      <nav class="catalog__paths" [attr.aria-label]="copy('არჩევის გზა', 'Selection path')">
        @if (garage.selectedVehicle(); as vehicle) {
          <a routerLink="/configurator" class="catalog__path">
            <span class="catalog__path-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path
                  d="M3 15.5v-3l2-1 2.1-4h9.8l2.1 4 2 1v3M6 15.5h12M7 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM7.1 11.5h9.8"
                />
              </svg>
            </span>
            <span>
              <strong>{{ copy('ავტომობილით არჩევა', 'Shop by vehicle') }}</strong>
              <small
                >{{ vehicle.label }} —
                {{ copy('შეამოწმე კონფიგურატორში', 'check in configurator') }}</small
              >
            </span>
            <span aria-hidden="true">→</span>
          </a>
        } @else {
          <a routerLink="/garage" class="catalog__path">
            <span class="catalog__path-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path
                  d="M3 15.5v-3l2-1 2.1-4h9.8l2.1 4 2 1v3M6 15.5h12M7 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM7.1 11.5h9.8"
                />
              </svg>
            </span>
            <span>
              <strong>{{ copy('ავტომობილით არჩევა', 'Shop by vehicle') }}</strong>
              <small>{{ copy('მარკა, მოდელი და წელი', 'Make, model and year') }}</small>
            </span>
            <span aria-hidden="true">→</span>
          </a>
        }
      </nav>

      <app-catalog-browser id="catalog-filters" />
    </section>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-height: calc(100vh - var(--header-height));
      background: var(--season-canvas);
      color: var(--text-primary);
      overflow-x: clip;
    }

    .catalog {
      position: relative;
      max-width: var(--container-max);
      margin: 0 auto;
      padding: var(--space-6) var(--space-5) var(--space-8);
      display: grid;
      /* An implicit auto grid track adopts the catalog controls' max-content
         width and used to stretch the document to 370px on 320/360px screens. */
      grid-template-columns: minmax(0, 1fr);
      /* The category strip owns its horizontal scrolling; its off-screen chips
         must not enlarge the page-level scroll area. */
      overflow-x: clip;
      gap: var(--space-4);
    }

    .catalog__heading,
    .catalog__paths,
    app-catalog-promo-carousel,
    app-catalog-browser {
      min-width: 0;
    }

    .catalog__heading {
      display: grid;
      gap: var(--space-2);
      padding-top: var(--space-2);
    }

    .catalog__eyebrow {
      color: var(--season-primary);
      font-size: 0.64rem;
      font-weight: 600;
      letter-spacing: 0.18em;
    }

    :host-context(.climate-all-season) .catalog__eyebrow {
      width: fit-content;
      background: linear-gradient(96deg, #557f9a 0%, #728187 48%, #a76539 100%);
      background-clip: text;
      -webkit-background-clip: text;
      color: transparent;
    }

    .catalog__title {
      margin: 0;
      max-width: 8ch;
      letter-spacing: -0.045em;
    }

    .catalog__paths {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }

    .catalog__path {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 64px;
      padding: 9px 14px;
      border: 1px solid var(--color-border, var(--border));
      border-radius: 14px;
      color: var(--color-text, var(--text-primary));
      background: var(--color-surface, var(--surface));
      transition:
        border-color var(--dur-fast) var(--ease-out),
        box-shadow var(--dur-fast) var(--ease-out),
        transform var(--dur-fast) var(--ease-out);
    }

    .catalog__path:hover {
      border-color: color-mix(
        in srgb,
        var(--color-action-primary, var(--brand-action)) 42%,
        var(--color-border, var(--border))
      );
      box-shadow: 0 8px 20px rgb(8 20 36 / 7%);
      transform: translateY(-1px);
    }

    .catalog__path:focus-visible {
      outline: 2px solid var(--color-focus, var(--accent));
      outline-offset: 3px;
    }

    .catalog__path-icon {
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border-radius: 10px;
      background: color-mix(
        in srgb,
        var(--color-action-primary, var(--brand-action)) 10%,
        transparent
      );
      color: var(--color-action-primary, var(--brand-action));
    }

    .catalog__path-icon svg {
      width: 21px;
      height: 21px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.65;
    }

    .catalog__path > span:nth-child(2) {
      display: grid;
      gap: 2px;
    }

    .catalog__path strong {
      font-size: var(--text-sm);
      line-height: 1.25;
    }

    .catalog__path small {
      color: var(--color-text-muted, var(--text-secondary));
      font-size: var(--text-xs);
      line-height: 1.3;
    }

    app-catalog-promo-carousel {
      margin-top: var(--space-5);
    }

    @media (max-width: 640px) {
      .catalog {
        padding: var(--space-4) var(--space-4) var(--space-6);
        gap: 12px;
      }

      .catalog__paths {
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
      }

      .catalog__path {
        grid-template-columns: 30px minmax(0, 1fr) auto;
        min-height: 56px;
        padding-inline: 9px;
      }

      .catalog__path-icon {
        width: 28px;
        height: 28px;
      }

      .catalog__path small {
        display: none;
      }

      app-catalog-promo-carousel {
        margin-top: var(--space-4);
      }
    }

    @media (max-width: 360px) {
      .catalog__title {
        font-size: var(--text-3xl);
      }
    }
  `,
})
export class CatalogPage {
  protected readonly garage = inject(GarageService);
  private readonly language = inject(LanguageService);

  protected copy(ka: string, en: string): string {
    return this.language.language() === 'en' ? en : ka;
  }
}
