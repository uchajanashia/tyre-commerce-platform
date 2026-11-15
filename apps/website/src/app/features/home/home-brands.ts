import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Brand } from '@core/models';

export interface BrandCard extends Brand {
  flipDelay: number;
  flipDuration: number;
  needsDarkLogoPlate: boolean;
}

@Component({
  selector: 'app-home-brands',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
  <div class="brand-grid">
    @for (brand of cards(); track brand.id) {
      <a
        class="brand-card"
        routerLink="/catalog"
        [queryParams]="{ brand: brand.id }"
        [style.--flip-delay.s]="brand.flipDelay"
        [style.--flip-duration.s]="brand.flipDuration"
      >
        <span class="brand-card__inner">
          <span class="brand-card__face brand-card__front">
            <small>TYRE / PARTNER</small>
            <span
              class="brand-card__logo"
              [class.brand-card__logo--dark]="brand.needsDarkLogoPlate"
            >
              <img
                [src]="brand.logoUrl"
                [alt]="brand.name"
                width="1200"
                height="400"
                loading="lazy"
                decoding="async"
              />
            </span>
          </span>
          <span class="brand-card__face brand-card__back">
            <small>{{ collectionLabel() }}</small>
            <strong>{{ brand.name }}</strong>
            <span aria-hidden="true">↗</span>
          </span>
        </span>
      </a>
    }
  </div>
  `,
  styleUrl: './home-brands.scss',
})
export class HomeBrandsComponent {
  readonly cards = input.required<readonly BrandCard[]>();
  readonly collectionLabel = input.required<string>();
}
