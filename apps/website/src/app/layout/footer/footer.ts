import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LanguageKey, LanguageService } from '@core/i18n/language.service';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
  host: { '[class.is-home]': 'homeMode()' },
})
export class Footer {
  readonly homeMode = input(false);
  private readonly language = inject(LanguageService);

  protected t(key: LanguageKey): string {
    return this.language.text(key);
  }
}
