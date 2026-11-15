import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SeoService } from '@core/services/seo.service';

@Component({
  selector: 'app-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="page">
      <p class="page__code num" aria-hidden="true">404</p>
      <h1 i18n>გვერდი ვერ მოიძებნა</h1>
      <p class="page__hint" i18n>ბმული შესაძლოა შეცვლილია ან აღარ არსებობს.</p>
      <a routerLink="/catalog" i18n>← კატალოგში გადასვლა</a>
    </section>
  `,
  styles: `
    .page {
      max-width: 720px;
      min-height: 55vh;
      margin: 0 auto;
      padding: var(--space-9) var(--space-5);
      display: grid;
      align-content: center;
      justify-items: start;
      gap: var(--space-4);
    }

    .page__code {
      color: var(--accent);
      font-size: var(--text-sm);
      letter-spacing: 0.16em;
    }

    .page__hint {
      color: var(--ink-1);
    }

    a {
      min-height: var(--touch-target);
      display: inline-flex;
      align-items: center;
      color: var(--accent);
    }
  `,
})
export class NotFoundPage {
  constructor() {
    inject(SeoService).setNotFound();
  }
}
