import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthService } from '../core/auth.service';
import { GOVERNANCE_FEATURE_CONFIG } from '../core/governance-flags';
import { Shell } from './shell';

describe('Shell', () => {
  let fixture: ComponentFixture<Shell>;
  let mediaChangeListener: ((event: MediaQueryListEvent) => void) | undefined;
  const logout = vi.fn(() => of(undefined));
  const hasPermission = vi.fn((_permission: string) => true);
  const hasExactPermission = vi.fn((_permission: string) => true);
  const governanceConfig = {
    apiBaseUrl: '/admin/v1',
    approvalsEnabled: false,
    auditReaderEnabled: false,
    jobsReaderEnabled: false,
  };
  const admin = signal({
    id: 'admin-1',
    email: 'ops@tyre.ge',
    role: 'admin',
    enabled: true,
    permissions: ['*'],
    permissionGrants: [{ permission: '*', scopeType: 'global' as const, scopeId: '' }],
  });

  beforeEach(async () => {
    logout.mockReset();
    hasPermission.mockReset();
    hasPermission.mockReturnValue(true);
    hasExactPermission.mockReset();
    hasExactPermission.mockReturnValue(true);
    governanceConfig.approvalsEnabled = false;
    governanceConfig.auditReaderEnabled = false;
    governanceConfig.jobsReaderEnabled = false;
    installMatchMedia(false);
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { admin, logout, hasPermission, hasExactPermission },
        },
        {
          provide: GOVERNANCE_FEATURE_CONFIG,
          useValue: governanceConfig,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  function installMatchMedia(matches: boolean): void {
    mediaChangeListener = undefined;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(
        (media: string): MediaQueryList =>
          ({
            matches,
            media,
            onchange: null,
            addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
              mediaChangeListener = listener as (event: MediaQueryListEvent) => void;
            },
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    });
  }

  function recreateAtCompactViewport(): void {
    fixture.destroy();
    installMatchMedia(true);
    fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
  }

  it('exposes the target IA without creating dead links', () => {
    const element = fixture.nativeElement as HTMLElement;
    const links = [...element.querySelectorAll<HTMLAnchorElement>('a.admin-nav__item')];
    const disabledItems = [
      ...element.querySelectorAll<HTMLButtonElement>('.admin-nav__item--disabled'),
    ];

    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'მიმოხილვა', 'შეკვეთები', 'გადახდები', 'მომხმარებლები', 'მარაგი',
      'საბურავები', 'ავტომობილები', 'ბრენდები', 'გუნდი და უფლებები', 'უსაფრთხოება',
    ]);
    expect(disabledItems).toHaveLength(0);
    expect(element.textContent).not.toContain('Bulk operations');
    expect(element.textContent).not.toContain('დამტკიცების ცენტრი');

  });

  it('opens the command palette from the keyboard and clearly scopes search', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const dialog = element.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('მხოლოდ ადმინისტრაციის მოდულებს');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(element.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not disclose permissioned governance navigation to an unrelated role', () => {
    hasPermission.mockImplementation((permission: string) => permission === 'audit.read');
    hasExactPermission.mockImplementation((permission: string) => permission === 'audit.read');
    const items = fixture.componentInstance.navigation.flatMap((section) => section.items);
    const canSee = (label: string): boolean =>
      fixture.componentInstance.canSee(items.find((item) => item.label === label)!);

    expect(canSee('აუდიტის ოპერაციები')).toBe(true);
    expect(canSee('დამტკიცების ცენტრი')).toBe(false);
    expect(canSee('Jobs / Dead letter')).toBe(false);
  });

  it('renders the live audit link only behind the distinct flag and exact audit.read check', () => {
    governanceConfig.auditReaderEnabled = true;
    hasExactPermission.mockImplementation((permission: string) => permission === 'audit.read');
    fixture.destroy();
    fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    const auditLink = [...element.querySelectorAll<HTMLAnchorElement>('a')].find(
      (link) => link.getAttribute('href') === '/audit',
    );
    expect(auditLink).toBeDefined();
    expect(hasExactPermission).toHaveBeenCalledWith('audit.read');
    expect(
      [...element.querySelectorAll<HTMLAnchorElement>('a')].some(
        (link) => link.getAttribute('href') === '/approvals',
      ),
    ).toBe(false);
  });

  it('renders Jobs only behind its own flag and a literal jobs.read grant', () => {
    governanceConfig.jobsReaderEnabled = true;
    hasPermission.mockReturnValue(true);
    hasExactPermission.mockImplementation((permission: string) => permission === 'jobs.read');
    fixture.destroy();
    fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(
      [...element.querySelectorAll<HTMLAnchorElement>('a')].some(
        (link) => link.getAttribute('href') === '/jobs',
      ),
    ).toBe(true);
    expect(hasExactPermission).toHaveBeenCalledWith('jobs.read');

    hasExactPermission.mockReturnValue(false);
    fixture.destroy();
    fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    expect(
      [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')].some(
        (link) => link.getAttribute('href') === '/jobs',
      ),
    ).toBe(false);
  });

  it('keeps the persistent desktop navigation interactive', () => {
    const element = fixture.nativeElement as HTMLElement;
    const drawer = element.querySelector<HTMLElement>('.admin-sidebar');
    const firstLink = element.querySelector<HTMLAnchorElement>('[data-nav-focus-start]');

    expect(drawer?.hasAttribute('inert')).toBe(false);
    expect(drawer?.hasAttribute('aria-hidden')).toBe(false);
    expect(drawer?.getAttribute('role')).toBeNull();

    firstLink?.focus();
    expect(document.activeElement).toBe(firstLink);
  });

  it('makes a closed compact drawer inert and removes it from the accessibility tree', () => {
    recreateAtCompactViewport();
    const element = fixture.nativeElement as HTMLElement;
    const drawer = element.querySelector<HTMLElement>('.admin-sidebar');

    expect(fixture.componentInstance.mobileNavOpen()).toBe(false);
    expect(drawer?.hasAttribute('inert')).toBe(true);
    expect(drawer?.getAttribute('aria-hidden')).toBe('true');
    expect(drawer?.getAttribute('role')).toBe('dialog');
    expect(drawer?.getAttribute('aria-modal')).toBeNull();
  });

  it('opens compact navigation as a focus-contained modal', async () => {
    recreateAtCompactViewport();
    const element = fixture.nativeElement as HTMLElement;
    const menu = element.querySelector<HTMLButtonElement>('.admin-topbar__menu');
    menu?.click();
    fixture.detectChanges();
    await Promise.resolve();

    const drawer = element.querySelector<HTMLElement>('.admin-sidebar');
    const links = [...drawer!.querySelectorAll<HTMLAnchorElement>('a[href]')];
    const first = links.at(0);
    const last = links.at(-1);

    expect(fixture.componentInstance.mobileNavOpen()).toBe(true);
    expect(menu?.getAttribute('aria-expanded')).toBe('true');
    expect(drawer?.hasAttribute('inert')).toBe(false);
    expect(drawer?.hasAttribute('aria-hidden')).toBe(false);
    expect(drawer?.getAttribute('role')).toBe('dialog');
    expect(drawer?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(first);

    last?.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(document.activeElement).toBe(first);

    first?.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(last);
  });

  it.each([
    { name: 'Ctrl/Cmd+K', event: { key: 'k', ctrlKey: true } },
    { name: 'slash', event: { key: '/' } },
  ])('closes the compact drawer before opening the palette with $name', async ({ event }) => {
    recreateAtCompactViewport();
    const element = fixture.nativeElement as HTMLElement;
    const menu = element.querySelector<HTMLButtonElement>('.admin-topbar__menu');
    const drawer = element.querySelector<HTMLElement>('.admin-sidebar');

    menu?.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(drawer?.getAttribute('aria-modal')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { ...event, cancelable: true }));
    fixture.detectChanges();
    await Promise.resolve();

    const palette = element.querySelector<HTMLElement>('.command-dialog');
    const paletteInput = palette?.querySelector<HTMLInputElement>('input');
    expect(fixture.componentInstance.mobileNavOpen()).toBe(false);
    expect(drawer?.hasAttribute('inert')).toBe(true);
    expect(drawer?.getAttribute('aria-hidden')).toBe('true');
    expect(drawer?.getAttribute('aria-modal')).toBeNull();
    expect(palette).not.toBeNull();
    expect(drawer?.contains(palette ?? null)).toBe(false);
    expect(document.activeElement).toBe(paletteInput);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.componentInstance.commandPaletteOpen()).toBe(false);
    expect(fixture.componentInstance.mobileNavOpen()).toBe(false);
    expect(document.activeElement).toBe(
      element.querySelector<HTMLButtonElement>('.command-trigger'),
    );
  });

  it('closes on Escape or backdrop and restores focus to the menu trigger', async () => {
    recreateAtCompactViewport();
    const element = fixture.nativeElement as HTMLElement;
    const menu = element.querySelector<HTMLButtonElement>('.admin-topbar__menu');
    const drawer = element.querySelector<HTMLElement>('.admin-sidebar');

    menu?.click();
    fixture.detectChanges();
    await Promise.resolve();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    await Promise.resolve();

    expect(fixture.componentInstance.mobileNavOpen()).toBe(false);
    expect(drawer?.hasAttribute('inert')).toBe(true);
    expect(drawer?.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(menu);

    menu?.click();
    fixture.detectChanges();
    await Promise.resolve();
    element.querySelector<HTMLButtonElement>('.admin-shell__backdrop')?.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(fixture.componentInstance.mobileNavOpen()).toBe(false);
    expect(document.activeElement).toBe(menu);
  });

  it('returns the drawer to persistent navigation when the viewport expands', async () => {
    recreateAtCompactViewport();
    const element = fixture.nativeElement as HTMLElement;
    const drawer = element.querySelector<HTMLElement>('.admin-sidebar');

    element.querySelector<HTMLButtonElement>('.admin-topbar__menu')?.click();
    fixture.detectChanges();
    await Promise.resolve();
    mediaChangeListener?.({ matches: false } as MediaQueryListEvent);
    fixture.detectChanges();

    expect(fixture.componentInstance.compactNavigation()).toBe(false);
    expect(fixture.componentInstance.mobileNavOpen()).toBe(false);
    expect(drawer?.hasAttribute('inert')).toBe(false);
    expect(drawer?.hasAttribute('aria-hidden')).toBe(false);
    expect(drawer?.getAttribute('role')).toBeNull();
  });
});
