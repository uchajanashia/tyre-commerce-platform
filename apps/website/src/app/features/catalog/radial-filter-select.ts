import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { LanguageService } from '@core/i18n/language.service';

export interface RadialFilterOption {
  value: string;
  label: string;
}

/**
 * Compact value picker kept under the historical selector name so catalog-only
 * callers do not need a route or API change. Desktop renders an anchored grid;
 * small screens use the same accessible dialog as a bottom sheet.
 */
@Component({
  selector: 'app-radial-filter-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'catalog-value-select' },
  templateUrl: './radial-filter-select.html',
  styleUrl: './radial-filter-select.scss',
})
export class RadialFilterSelect {
  readonly label = input.required<string>();
  readonly options = input<RadialFilterOption[]>([]);
  readonly value = input('');
  readonly valueChange = output<string>();

  private readonly document = inject(DOCUMENT);
  private readonly language = inject(LanguageService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly listbox = viewChild<ElementRef<HTMLElement>>('listbox');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private previousBodyOverflow = '';

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly cursor = signal(0);
  protected readonly searchEnabled = computed(() => this.options().length > 18);
  protected readonly filteredOptions = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    return query
      ? this.options().filter((option) => option.label.toLocaleLowerCase().includes(query))
      : this.options();
  });
  protected readonly selectedLabel = computed(
    () =>
      this.options().find((option) => option.value === this.value())?.label ??
      this.options()[0]?.label ??
      '',
  );
  protected readonly activeOptionId = computed(() =>
    this.filteredOptions()[this.cursor()] ? this.optionId(this.cursor()) : null,
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.unlockPage());
  }

  protected copy(ka: string, en: string): string {
    return this.language.language() === 'en' ? en : ka;
  }

  protected openMenu(): void {
    this.query.set('');
    const selectedIndex = this.options().findIndex((option) => option.value === this.value());
    this.cursor.set(Math.max(0, selectedIndex));
    this.open.set(true);
    this.lockPage();
    setTimeout(() => {
      if (this.searchEnabled()) this.searchInput()?.nativeElement.focus();
      else this.listbox()?.nativeElement.focus();
    }, 0);
  }

  protected toggleMenu(): void {
    if (this.open()) this.close(false);
    else this.openMenu();
  }

  protected close(restoreFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    this.query.set('');
    this.unlockPage();
    if (restoreFocus) {
      // The parent writes the chosen value into the router. Restore focus on
      // both the next task and after navigation settles so it lands on the
      // current trigger instance without making Escape feel delayed.
      const focusTrigger = () => this.trigger().nativeElement.focus({ preventScroll: true });
      setTimeout(focusTrigger, 0);
      setTimeout(focusTrigger, 150);
    }
  }

  protected choose(option: RadialFilterOption): void {
    this.valueChange.emit(option.value);
    this.close();
  }

  protected optionId(index: number): string {
    return `${this.label().replace(/\s+/g, '-')}-option-${index}`;
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.cursor.set(0);
  }

  protected onListKeydown(event: KeyboardEvent): void {
    const actions: Record<string, () => void> = {
      ArrowUp: () => this.moveCursor(-1),
      ArrowLeft: () => this.moveCursor(-1),
      ArrowDown: () => this.moveCursor(1),
      ArrowRight: () => this.moveCursor(1),
      PageUp: () => this.moveCursor(-6),
      PageDown: () => this.moveCursor(6),
      Home: () => this.setCursor(0),
      End: () => this.setCursor(this.filteredOptions().length - 1),
      Enter: () => this.confirmCursor(),
      ' ': () => this.confirmCursor(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  protected onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      this.dialog()?.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [tabindex="0"]',
      ) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.openMenu();
    }
  }

  private moveCursor(delta: number): void {
    this.setCursor(this.cursor() + delta);
  }

  private setCursor(index: number): void {
    const max = Math.max(0, this.filteredOptions().length - 1);
    this.cursor.set(Math.min(Math.max(index, 0), max));
  }

  private confirmCursor(): void {
    const option = this.filteredOptions()[this.cursor()];
    if (option) this.choose(option);
  }

  private lockPage(): void {
    if (!this.isBrowser) return;
    this.previousBodyOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
  }

  private unlockPage(): void {
    if (!this.isBrowser) return;
    this.document.body.style.overflow = this.previousBodyOverflow;
  }
}
