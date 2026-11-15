import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type CatalogClassIconName = 'passenger' | 'truck' | 'disk' | 'special';

@Component({
  selector: 'app-catalog-class-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" focusable="false">
      @switch (name()) {
        @case ('passenger') {
          <path d="M4 15.5V13l2-4h10.8l3.2 4v2.5" />
          <path d="M6 9l1.5-3h7L17 9M4 13h16M7 16.5h.01M17 16.5h.01" />
          <path d="M5 18v-2.5h14V18" />
        }
        @case ('truck') {
          <path d="M3 7h11v9H3zM14 10h3.5l3.5 3.5V16h-7z" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17.5" cy="18" r="2" />
        }
        @case ('disk') {
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="2.2" />
          <path
            d="M12 4v5.8M12 14.2V20M4 12h5.8M14.2 12H20M6.35 6.35l4.1 4.1M13.55 13.55l4.1 4.1M17.65 6.35l-4.1 4.1M10.45 13.55l-4.1 4.1"
          />
        }
        @case ('special') {
          <path d="M4 14V9h9v7H6M13 11h3l3 3v2h-6" />
          <circle cx="7" cy="17" r="3" />
          <circle cx="17" cy="17" r="2" />
          <path d="M6 9V6h5l2 3" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      width: 24px;
      height: 24px;
      place-items: center;
    }

    svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.6;
    }
  `,
})
export class CatalogClassIcon {
  readonly name = input.required<CatalogClassIconName>();
}
