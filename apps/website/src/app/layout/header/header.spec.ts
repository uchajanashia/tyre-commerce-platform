import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CartService } from '@core/services/cart.service';
import { Header } from './header';

describe('Header mobile navigation', () => {
  let fixture: ComponentFixture<Header>;
  let homepage: HTMLElement | undefined;

  const flushFocusTimer = (): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, 0));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Header],
      providers: [provideRouter([]), { provide: CartService, useValue: { itemCount: signal(2) } }],
    }).compileComponents();

    fixture = TestBed.createComponent(Header);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    homepage?.remove();
    homepage = undefined;
    vi.restoreAllMocks();
    document.body.style.overflow = '';
    localStorage.removeItem('tyre.ge.language');
  });

  it('keeps the cart and an accessible menu trigger in the shell', () => {
    const host = fixture.nativeElement as HTMLElement;
    const cart = host.querySelector<HTMLAnchorElement>('.cart-button--mobile');
    const trigger = host.querySelector<HTMLButtonElement>('.menu-trigger');

    expect(cart?.getAttribute('href')).toBe('/cart');
    expect(cart?.textContent).toContain('2');
    expect(trigger?.getAttribute('aria-controls')).toBe('mobile-navigation');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('aria-label')).toBeTruthy();
  });

  it('uses the supplied logo and exposes a visible desktop language switch', () => {
    const host = fixture.nativeElement as HTMLElement;
    const logos = host.querySelectorAll<HTMLImageElement>('img[src="/brand/tyre-ge-logo.png"]');

    expect(logos.length).toBe(2);
    expect(logos.item(0).getAttribute('alt')).toBe('tyre.ge');
    expect(host.querySelector('.sidebar__footer .language-switch')?.textContent).toContain('GE');
    expect(host.querySelector('.sidebar__footer .language-switch')?.textContent).toContain('EN');
    expect(host.textContent).toContain('ქართული ონლაინ კატალოგი');
  });

  it('switches the navigation copy to English and persists the choice', () => {
    const host = fixture.nativeElement as HTMLElement;
    const buttons = host.querySelectorAll<HTMLButtonElement>(
      '.sidebar__footer .language-switch button',
    );

    buttons.item(1).click();
    fixture.detectChanges();

    expect(host.querySelector('.sidebar__nav')?.textContent).toContain('Catalog');
    expect(host.querySelector('.sidebar__footer')?.textContent).toContain('Choose a vehicle');
    expect(localStorage.getItem('tyre.ge.language')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('uses the homepage navigation without replacing the working catalog and vehicle journeys', () => {
    fixture.componentRef.setInput('homeMode', true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const destinations = Array.from(host.querySelectorAll<HTMLAnchorElement>('.home-nav a'),
      (link) => link.getAttribute('href'));

    expect(host.classList.contains('is-home')).toBe(true);
    expect(destinations).toEqual(['/catalog', '/#season', '/#brands', '/about']);
    expect(host.querySelector('.home-garage')?.getAttribute('href')).toBe('/garage');
    expect(host.querySelector('.cart-button--mobile')?.getAttribute('href')).toBe('/cart');
    expect(host.querySelectorAll('.home-language button').length).toBe(2);
  });

  it.each([80, 68])('adds a readable surface when the hero passes the %ipx header and clears it on return', (headerHeight) => {
    homepage = document.createElement('app-home-page');
    const hero = document.createElement('section');
    hero.className = 'hero';
    homepage.append(hero);
    document.body.append(homepage);

    let heroBottom = 900;
    vi.spyOn(hero, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: heroBottom,
    }) as DOMRect);
    const host = fixture.nativeElement as HTMLElement;
    vi.spyOn(host.querySelector<HTMLElement>('.mobile-header')!, 'offsetHeight', 'get')
      .mockReturnValue(headerHeight);
    fixture.componentRef.setInput('homeMode', true);
    fixture.detectChanges();

    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(host.classList.contains('is-home-scrolled')).toBe(false);

    heroBottom = headerHeight;
    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(host.classList.contains('is-home-scrolled')).toBe(true);

    heroBottom = headerHeight + 1;
    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(host.classList.contains('is-home-scrolled')).toBe(false);

    fixture.componentRef.setInput('homeMode', false);
    fixture.detectChanges();
    heroBottom = 0;
    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(host.classList.contains('is-home')).toBe(false);
    expect(host.classList.contains('is-home-scrolled')).toBe(false);
  });

  it('opens four primary journeys and all catalog categories, then locks page scroll', async () => {
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>('.menu-trigger')!;

    trigger.click();
    fixture.detectChanges();
    await flushFocusTimer();

    const primaryLinks = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('.drawer__nav a'),
      (link) => link.getAttribute('href'),
    );
    const categoryLinks = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('.drawer__catalog-grid a'),
      (link) => link.getAttribute('href'),
    );

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.drawer')?.getAttribute('aria-modal')).toBe('true');
    expect(primaryLinks).toEqual(['/', '/catalog', '/configurator', '/about']);
    expect(categoryLinks).toEqual([
      '/catalog?class=passenger',
      '/catalog?class=truck',
      '/catalog?class=disk',
      '/catalog?class=special',
    ]);
    expect(host.querySelectorAll('.drawer__catalog-grid app-catalog-class-icon').length).toBe(4);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(host.querySelector('.drawer__close'));
  });

  it('closes with Escape, restores scroll, and returns focus to the trigger', async () => {
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>('.menu-trigger')!;

    trigger.click();
    fixture.detectChanges();
    await flushFocusTimer();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await flushFocusTimer();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.drawer')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab focus within the open drawer', async () => {
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('.menu-trigger')!.click();
    fixture.detectChanges();
    await flushFocusTimer();

    const close = host.querySelector<HTMLButtonElement>('.drawer__close')!;
    const links = host.querySelectorAll<HTMLAnchorElement>('.drawer a');
    const last = links.item(links.length - 1);
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(document.activeElement).toBe(close);
  });
});
