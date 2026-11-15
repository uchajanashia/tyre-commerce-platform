import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { CategorySymbol } from '@core/models';

/**
 * Category symbol glyph (tire card badge / detail hero). Monochrome inline SVG
 * driven by `currentColor` so it inherits the category's identity color from
 * its host. The glyphs echo real sidewall stampings — 3PMSF's mountain +
 * snowflake, the literal "M+S" mark — engraved-stamp simple, never illustrative.
 *
 * Sized in em (host font-size scales it): card badge small, hero badge larger.
 */
@Component({
  selector: 'app-season-symbol',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (symbol()) {
        @case ('sun') {
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7" />
        }
        @case ('sun-snow') {
          <!-- left: half sun · right: half snowflake -->
          <path d="M11 8.2a3.9 3.9 0 0 0 0 7.6" />
          <path d="M11 3.4v2.2M3.4 12h2.2M11 20.6v-2.2M5.5 6.4l1.6 1.6M5.5 17.6l1.6-1.6" />
          <path d="M14 12h6.6M17.3 8.7v6.6M15 9.6l4.6 4.8M19.6 9.6L15 14.4" />
        }
        @case ('snowflake') {
          <!-- six-spoke snowflake, chevron ticks on the vertical axis -->
          <path d="M12 2.8v18.4M4 7.4l16 9.2M20 7.4L4 16.6" />
          <path d="M9.9 4.9L12 6.8l2.1-1.9M9.9 19.1L12 17.2l2.1 1.9" stroke-width="1.3" />
        }
        @case ('ms-letters') {
          <!-- the literal sidewall "M+S" stamp -->
          <rect x="1.75" y="6.25" width="20.5" height="11.5" rx="2.2" stroke-width="1.3" />
          <text x="12" y="15.6" text-anchor="middle" font-size="8.4" font-weight="700"
                letter-spacing="0.4" fill="currentColor" stroke="none">M+S</text>
        }
        @case ('road') {
          <!-- highway in perspective -->
          <path d="M4.5 20.5L10 3.5M19.5 20.5L14 3.5" />
          <path d="M12 19v-3M12 12.5v-2.6M12 7v-2" stroke-width="1.3" />
        }
        @case ('mountain') {
          <path d="M2.5 19L9 6.5l3.7 6.6L15.6 9l5.9 10Z" />
        }
        @case ('mud-tread') {
          <!-- aggressive M/T tread lugs -->
          <path d="M4 4.5l6 2.4v4l-6-2.4Z" fill="currentColor" stroke="none" />
          <path d="M4 13l6 2.4v4L4 17Z" fill="currentColor" stroke="none" />
          <path d="M20 4.5l-6 2.4v4l6-2.4Z" fill="currentColor" stroke="none" />
          <path d="M20 13l-6 2.4v4l6-2.4Z" fill="currentColor" stroke="none" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      width: 1.15em;
      height: 1.15em;
      flex: none;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class SeasonSymbol {
  readonly symbol = input.required<CategorySymbol>();
}
