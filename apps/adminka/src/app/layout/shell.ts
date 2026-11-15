import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from '../core/auth.service';
import {
  GOVERNANCE_FEATURE_CONFIG,
  GovernanceFeature,
  isGovernanceFeatureEnabled,
} from '../core/governance-flags';
import { ADMIN_COLOR_TOKENS } from './admin-theme';

interface NavigationItem {
  label: string;
  description: string;
  route?: string;
  queryParams?: Record<string, string>;
  requiredPermission?: string;
  exactPermission?: boolean;
  requiredFeature?: GovernanceFeature;
}

interface NavigationSection {
  label: string;
  items: NavigationItem[];
}

const NAVIGATION: NavigationSection[] = [
  {
    label: 'სამუშაო სივრცე',
    items: [
      { label: 'მიმოხილვა', description: 'მთავარი საქმეები', route: '/' },
      {
        label: 'შეკვეთები',
        description: 'შეკვეთების ისტორია',
        route: '/orders',
        requiredPermission: 'orders.read',
      },
      {
        label: 'გადახდები',
        description: 'გადახდის მცდელობები',
        route: '/payments',
        requiredPermission: 'payments.read',
      },
      {
        label: 'მომხმარებლები',
        description: 'შეკვეთის კონტაქტები',
        route: '/customers',
        requiredPermission: 'orders.contacts.read',
      },
      {
        label: 'მარაგი',
        description: 'რაოდენობები და ხელმისაწვდომობა',
        route: '/inventory',
        requiredPermission: 'inventory.read',
      },
    ],
  },
  {
    label: 'კატალოგი',
    items: [
      {
        label: 'საბურავები',
        description: 'მოდელები, ფასები და ფოტოები',
        route: '/tires',
        requiredPermission: 'catalog.read',
      },
      {
        label: 'ავტომობილები',
        description: 'მანქანის ვიზუალები',
        route: '/vehicles',
        requiredPermission: 'catalog.read',
      },
      {
        label: 'ბრენდები',
        description: 'კატალოგის ბრენდები',
        route: '/brands',
        requiredPermission: 'catalog.read',
      },
    ],
  },
  {
    label: 'მართვა',
    items: [
      {
        label: 'გუნდი და უფლებები',
        description: 'თანამშრომლების წვდომა',
        route: '/staff',
        requiredPermission: 'staff.read',
      },
      { label: 'უსაფრთხოება', description: 'სესიების მართვა', route: '/security' },
      {
        label: 'დამტკიცების ცენტრი',
        description: 'მოთხოვნები',
        route: '/approvals',
        requiredPermission: 'approvals.read',
        requiredFeature: 'approvals',
      },
      {
        label: 'აუდიტის ოპერაციები',
        description: 'ცვლილებების ისტორია',
        route: '/audit',
        requiredPermission: 'audit.read',
        exactPermission: true,
        requiredFeature: 'audit',
      },
      {
        label: 'Jobs / Dead letter',
        description: 'ფონური პროცესები',
        route: '/jobs',
        requiredPermission: 'jobs.read',
        exactPermission: true,
        requiredFeature: 'jobs',
      },
    ],
  },
];

/** Production admin frame with target IA and an honest, navigation-only command palette. */
@Component({
  selector: 'adm-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  host: {
    '[style.--adm-surface]': 'colorTokens.surface',
    '[style.--adm-surface-subtle]': 'colorTokens.surfaceSubtle',
    '[style.--adm-ink-faint]': 'colorTokens.inkFaint',
    '[style.--adm-sidebar]': 'colorTokens.sidebar',
    '[style.--adm-sidebar-muted]': 'colorTokens.sidebarMuted',
    '[style.--adm-sidebar-heading]': 'colorTokens.sidebarHeading',
    '[style.--adm-sidebar-disabled]': 'colorTokens.sidebarDisabled',
  },
  template: `
    <a class="skip-link" href="#workspace-content">შინაარსზე გადასვლა</a>

    <div class="admin-shell" [class.admin-shell--nav-open]="mobileNavOpen()">
      <button
        type="button"
        class="admin-shell__backdrop"
        aria-label="ნავიგაციის დახურვა"
        (click)="closeMobileNav(true)"
      ></button>

      <aside
        #navigationDrawer
        class="admin-sidebar"
        id="primary-navigation"
        aria-label="მთავარი ნავიგაცია"
        [attr.aria-hidden]="compactNavigation() && !mobileNavOpen() ? 'true' : null"
        [attr.aria-modal]="compactNavigation() && mobileNavOpen() ? 'true' : null"
        [attr.inert]="compactNavigation() && !mobileNavOpen() ? '' : null"
        [attr.role]="compactNavigation() ? 'dialog' : null"
      >
        <div class="admin-sidebar__brand">
          <span class="admin-sidebar__mark" aria-hidden="true"></span>
          <span class="admin-sidebar__wordmark">tyre.ge</span>
          <span class="admin-sidebar__product">OPS</span>
        </div>

        <div class="admin-sidebar__environment">
          <span aria-hidden="true"></span>
          ადმინისტრირება
        </div>

        <nav class="admin-nav">
          @for (section of navigation; track section.label) {
            <section class="admin-nav__section" [attr.aria-labelledby]="sectionId(section.label)">
              <h2 [id]="sectionId(section.label)">{{ section.label }}</h2>
              <div class="admin-nav__items">
                @for (item of section.items; track item.label) {
                  @if (canSee(item) && featureEnabled(item)) {
                    @if (item.route && featureEnabled(item)) {
                      <a
                        class="admin-nav__item"
                        [attr.data-nav-focus-start]="item.route === '/' ? '' : null"
                        [routerLink]="item.route"
                        [queryParams]="item.queryParams ?? null"
                        routerLinkActive="admin-nav__item--active"
                        [routerLinkActiveOptions]="{ exact: true }"
                      >
                        <span>{{ item.label }}</span>
                      </a>
                    } @else {
                      <button
                        type="button"
                        class="admin-nav__item admin-nav__item--disabled"
                        disabled
                        [attr.aria-label]="disabledLabel(item)"
                      >
                        <span>{{ item.label }}</span>
                        <small>{{ item.requiredFeature ? 'OFF' : 'მალე' }}</small>
                      </button>
                    }
                  }
                }
              </div>
            </section>
          }
        </nav>

        <div class="admin-sidebar__account">
          <span class="admin-sidebar__avatar" aria-hidden="true">{{ adminInitial() }}</span>
          <span class="admin-sidebar__identity">
            <strong>{{ auth.admin()?.email }}</strong>
            <small>{{ auth.admin()?.role ?? 'Admin' }}</small>
          </span>
        </div>
      </aside>

      <div class="admin-workspace">
        <header class="admin-topbar">
          <button
            #navigationTrigger
            type="button"
            class="icon-button admin-topbar__menu"
            aria-label="ნავიგაციის გახსნა"
            aria-controls="primary-navigation"
            [attr.aria-expanded]="mobileNavOpen()"
            (click)="toggleMobileNav()"
          >
            <span></span><span></span><span></span>
          </button>

          <button
            #commandTrigger
            type="button"
            class="command-trigger"
            (click)="openCommandPalette()"
          >
            <span class="command-trigger__icon" aria-hidden="true"></span>
            <span>მოდულის მოძებნა</span>
            <kbd>Ctrl K</kbd>
          </button>

          <div class="admin-topbar__session" title="ავტორიზებული ადმინისტრატორის სესია">
            <span aria-hidden="true"></span>
            სესია აქტიურია
          </div>

          <button type="button" class="quiet-button" (click)="logout()">გასვლა</button>
        </header>

        <main class="admin-content" id="workspace-content" tabindex="-1">
          <router-outlet />
        </main>
      </div>
    </div>

    @if (commandPaletteOpen()) {
      <div class="command-overlay" (mousedown)="closeCommandPalette()">
        <section
          #commandDialog
          class="command-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-title"
          (mousedown)="$event.stopPropagation()"
        >
          <h2 id="command-title" class="sr-only">მოდულის მოძებნა</h2>
          <div class="command-dialog__input-row">
            <span class="command-trigger__icon" aria-hidden="true"></span>
            <input
              #commandInput
              type="search"
              autocomplete="off"
              placeholder="მოდულის სახელი…"
              aria-label="მოდულის მოძებნა"
              [value]="commandQuery()"
              (input)="setCommandQuery($event)"
            />
            <kbd>Esc</kbd>
          </div>
          <p class="command-dialog__scope">ძებნა მოიცავს მხოლოდ ადმინისტრაციის მოდულებს.</p>
          <div class="command-dialog__results">
            @for (item of filteredNavigation(); track item.label) {
              @if (item.route && featureEnabled(item)) {
                <button type="button" class="command-result" (click)="goTo(item)">
                  <span
                    ><strong>{{ item.label }}</strong
                    ><small>{{ item.description }}</small></span
                  >
                  <span class="command-result__action">გახსნა</span>
                </button>
              } @else {
                <div class="command-result command-result--disabled" aria-disabled="true">
                  <span
                    ><strong>{{ item.label }}</strong
                    ><small>{{ item.description }}</small></span
                  >
                  <span class="command-result__action">მზადდება</span>
                </div>
              }
            } @empty {
              <p class="command-dialog__empty">შესაბამისი მოდული ვერ მოიძებნა.</p>
            }
          </div>
        </section>
      </div>
    }
  `,
})
export class Shell {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly governanceConfig = inject(GOVERNANCE_FEATURE_CONFIG);
  private readonly compactNavigationQuery =
    this.document.defaultView?.matchMedia?.('(max-width: 1024px)');

  readonly navigation = NAVIGATION;
  readonly colorTokens = ADMIN_COLOR_TOKENS;
  readonly mobileNavOpen = signal(false);
  readonly compactNavigation = signal(this.compactNavigationQuery?.matches ?? false);
  readonly commandPaletteOpen = signal(false);
  readonly commandQuery = signal('');
  readonly filteredNavigation = computed(() => {
    const query = this.commandQuery().trim().toLocaleLowerCase('ka-GE');
    const items = this.navigation
      .flatMap((section) => section.items)
      .filter((item) => this.canSee(item) && this.featureEnabled(item));
    if (!query) return items;
    return items.filter((item) =>
      `${item.label} ${item.description}`.toLocaleLowerCase('ka-GE').includes(query),
    );
  });

  @ViewChild('commandInput') private commandInput?: ElementRef<HTMLInputElement>;
  @ViewChild('commandTrigger') private commandTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('commandDialog') private commandDialog?: ElementRef<HTMLElement>;
  @ViewChild('navigationTrigger') private navigationTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('navigationDrawer') private navigationDrawer?: ElementRef<HTMLElement>;

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.closeMobileNav(false));

    const compactNavigationQuery = this.compactNavigationQuery;
    if (compactNavigationQuery) {
      const handleViewportChange = (event: MediaQueryListEvent): void => {
        this.compactNavigation.set(event.matches);
        if (!event.matches) this.closeMobileNav(false);
      };
      compactNavigationQuery.addEventListener('change', handleViewportChange);
      this.destroyRef.onDestroy(() =>
        compactNavigationQuery.removeEventListener('change', handleViewportChange),
      );
    }
  }

  adminInitial(): string {
    return (this.auth.admin()?.email?.trim().charAt(0) || 'A').toLocaleUpperCase('ka-GE');
  }

  sectionId(label: string): string {
    return `nav-${label.replace(/[^\p{L}\p{N}]+/gu, '-').toLocaleLowerCase('ka-GE')}`;
  }

  toggleMobileNav(): void {
    if (this.mobileNavOpen()) {
      this.closeMobileNav(true);
      return;
    }

    if (this.commandPaletteOpen()) this.closeCommandPalette();
    this.mobileNavOpen.set(true);
    queueMicrotask(() => {
      this.navigationDrawer?.nativeElement
        .querySelector<HTMLElement>('[data-nav-focus-start]')
        ?.focus();
    });
  }

  closeMobileNav(restoreFocus = false): void {
    const wasOpen = this.mobileNavOpen();
    this.mobileNavOpen.set(false);
    if (wasOpen && restoreFocus) {
      queueMicrotask(() => this.navigationTrigger?.nativeElement.focus());
    }
  }

  openCommandPalette(): void {
    if (this.mobileNavOpen()) this.closeMobileNav(false);
    this.commandPaletteOpen.set(true);
    this.commandQuery.set('');
    queueMicrotask(() => this.commandInput?.nativeElement.focus());
  }

  closeCommandPalette(): void {
    const wasOpen = this.commandPaletteOpen();
    this.commandPaletteOpen.set(false);
    if (wasOpen) queueMicrotask(() => this.commandTrigger?.nativeElement.focus());
  }

  setCommandQuery(event: Event): void {
    this.commandQuery.set((event.target as HTMLInputElement).value);
  }

  goTo(item: NavigationItem): void {
    if (!item.route || !this.featureEnabled(item)) return;
    this.closeCommandPalette();
    void this.router.navigate([item.route], { queryParams: item.queryParams });
  }

  canSee(item: NavigationItem): boolean {
    if (!item.requiredPermission) return true;
    return item.exactPermission
      ? this.auth.hasExactPermission(item.requiredPermission)
      : this.auth.hasPermission(item.requiredPermission);
  }

  featureEnabled(item: NavigationItem): boolean {
    return (
      !item.requiredFeature ||
      isGovernanceFeatureEnabled(this.governanceConfig, item.requiredFeature)
    );
  }

  disabledLabel(item: NavigationItem): string {
    return item.requiredFeature
      ? `${item.label} — feature flag უსაფრთხოდ გამორთულია`
      : `${item.label} — მოდული მზადდება`;
  }

  logout(): void {
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.commandPaletteOpen()) {
        this.closeCommandPalette();
        return;
      }
      this.closeMobileNav(true);
      return;
    }

    if (event.key === 'Tab' && this.commandPaletteOpen()) {
      const focusable = [
        ...(this.commandDialog?.nativeElement.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (event.shiftKey && this.document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && this.document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }

    if (
      event.key === 'Tab' &&
      this.compactNavigation() &&
      this.mobileNavOpen() &&
      !this.commandPaletteOpen()
    ) {
      const focusable = [
        ...(this.navigationDrawer?.nativeElement.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (event.shiftKey && this.document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && this.document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }

    const target = event.target as HTMLElement | null;
    const isTyping =
      target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      this.openCommandPalette();
    } else if (event.key === '/' && !isTyping) {
      event.preventDefault();
      this.openCommandPalette();
    }
  }
}
