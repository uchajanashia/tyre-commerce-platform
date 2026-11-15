import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  PLATFORM_ID,
  afterRenderEffect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';

import { LanguageKey, LanguageService } from '@core/i18n/language.service';
import { CartService } from '@core/services/cart.service';
import {
  CatalogClassIcon,
  CatalogClassIconName,
} from '@shared/components/catalog-class-icon/catalog-class-icon';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const NAVIGATION = [
  { path: '/', labelKey: 'nav.home' satisfies LanguageKey, exact: true },
  { path: '/catalog', labelKey: 'nav.catalog' satisfies LanguageKey, exact: false },
  { path: '/configurator', labelKey: 'nav.configurator' satisfies LanguageKey, exact: false },
  { path: '/about', labelKey: 'nav.about' satisfies LanguageKey, exact: false },
] as const;

const CATALOG_LINKS: readonly {
  key: CatalogClassIconName;
  labelKey: LanguageKey;
  noteKey: LanguageKey;
}[] = [
  { key: 'passenger', labelKey: 'catalog.passenger', noteKey: 'catalog.passengerNote' },
  { key: 'truck', labelKey: 'catalog.truck', noteKey: 'catalog.truckNote' },
  { key: 'disk', labelKey: 'catalog.disk', noteKey: 'catalog.diskNote' },
  { key: 'special', labelKey: 'catalog.special', noteKey: 'catalog.specialNote' },
];

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CatalogClassIcon],
  templateUrl: './header.html',
  styleUrl: './header.scss',
  host: {
    '[class.is-home]': 'homeMode()',
    '[class.is-home-scrolled]': 'homeMode() && homeScrolled()',
  },
})
export class Header {
  readonly homeMode = input(false);
  protected readonly cart = inject(CartService);
  protected readonly language = inject(LanguageService);
  protected readonly drawerOpen = signal(false);
  protected readonly homeScrolled = signal(false);
  protected readonly navigation = NAVIGATION;
  protected readonly catalogLinks = CATALOG_LINKS;
  protected readonly currentUrl = signal('/');

  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly menuTrigger = viewChild<ElementRef<HTMLButtonElement>>('menuTrigger');
  private readonly headerBar = viewChild<ElementRef<HTMLElement>>('headerBar');
  private readonly drawer = viewChild<ElementRef<HTMLElement>>('drawer');
  private readonly drawerClose = viewChild<ElementRef<HTMLButtonElement>>('drawerClose');
  private previousBodyOverflow = '';

  constructor() {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
        if (this.drawerOpen()) {
          this.closeDrawer(false);
        }
      });

    inject(DestroyRef).onDestroy(() => this.unlockPageScroll());
    afterRenderEffect({ read: () => this.syncHomeHeaderSurface() });
  }

  protected t(key: LanguageKey): string {
    return this.language.text(key);
  }

  protected isNavigationActive(item: (typeof NAVIGATION)[number]): boolean {
    const path = this.currentPath();
    if (item.exact) {
      return path === item.path;
    }
    return path === item.path || path.startsWith(`${item.path}/`);
  }

  protected isCatalogCategoryActive(category: CatalogClassIconName): boolean {
    if (this.currentPath() !== '/catalog') {
      return false;
    }
    const selected = this.router.parseUrl(this.currentUrl()).queryParams['class'];
    return (typeof selected === 'string' ? selected : 'passenger') === category;
  }

  protected toggleDrawer(): void {
    if (this.drawerOpen()) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  }

  protected openDrawer(): void {
    if (this.drawerOpen()) {
      return;
    }
    this.drawerOpen.set(true);
    this.lockPageScroll();
    if (this.isBrowser) {
      setTimeout(() => this.drawerClose()?.nativeElement.focus());
    }
  }

  protected closeDrawer(restoreFocus = true): void {
    if (!this.drawerOpen()) {
      return;
    }
    this.drawerOpen.set(false);
    this.unlockPageScroll();
    if (restoreFocus && this.isBrowser) {
      setTimeout(() => this.menuTrigger()?.nativeElement.focus());
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (this.drawerOpen()) {
      event.preventDefault();
      this.closeDrawer();
    }
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.syncHomeHeaderSurface();
    if (this.isBrowser && this.document.defaultView?.matchMedia('(min-width: 1024px)').matches) {
      this.closeDrawer(false);
    }
  }

  @HostListener('window:scroll')
  protected onScroll(): void {
    this.syncHomeHeaderSurface();
  }

  protected onDrawerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }
    const panel = this.drawer()?.nativeElement;
    if (!panel) {
      return;
    }
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.hasAttribute('disabled'),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const active = this.document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private currentPath(): string {
    return this.currentUrl().split(/[?#]/, 1)[0] || '/';
  }

  private syncHomeHeaderSurface(): void {
    if (!this.isBrowser || !this.homeMode()) {
      this.homeScrolled.set(false);
      return;
    }
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    const hero = this.document.querySelector<HTMLElement>('app-home-page .hero');
    const headerHeight = this.headerBar()?.nativeElement.offsetHeight ||
      (view.innerWidth < 1024 ? 68 : 80);
    // Switch before light sections move underneath the fixed navigation.
    this.homeScrolled.set(hero
      ? hero.getBoundingClientRect().bottom <= headerHeight
      : view.scrollY > 24);
  }

  private lockPageScroll(): void {
    if (!this.isBrowser) {
      return;
    }
    this.previousBodyOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
  }

  private unlockPageScroll(): void {
    if (this.isBrowser) {
      this.document.body.style.overflow = this.previousBodyOverflow;
    }
  }
}
