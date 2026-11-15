import { Component, WritableSignal, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { LanguageService } from '@core/i18n/language.service';
import { ClimateService } from '@core/services/climate.service';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { MotionPreferenceService } from '@core/services/motion-preference.service';
import { MotionService } from '@core/services/motion.service';
import { HomeFilmComponent } from './home-film';
import { HomePage } from './home.page';

@Component({ selector: 'app-home-film', template: '' })
class FilmStub {
  readonly id = input.required<string>();
  readonly active = input(true);
  readonly playing = input(true);
  readonly loop = input(false);
  readonly priority = input(false);
  readonly ended = output<void>();
  readonly progress = output<number>();
  readonly failed = output<void>();
}

describe('HomePage cinematic customer journey', () => {
  let fixture: ComponentFixture<HomePage>;
  let reduced: WritableSignal<boolean>;
  let frames: FrameRequestCallback[];
  const setSeason = vi.fn();
  const originalMatchMedia = window.matchMedia;
  const state = <T>(name: string): WritableSignal<T> =>
    Reflect.get(fixture.componentInstance, name) as WritableSignal<T>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const film = (id: string): FilmStub => fixture.debugElement.queryAll(By.directive(FilmStub))
    .map((el) => el.componentInstance as FilmStub).find((component) => component.id() === id)!;
  const render = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    frames = [];
    reduced = signal(false);
    setSeason.mockClear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const timeline = { fromTo: vi.fn().mockReturnThis() };
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        { provide: FitmentDataService, useValue: { getBrands: () => of([]) } },
        { provide: ClimateService, useValue: { setSeason } },
        { provide: MotionPreferenceService, useValue: { reduced } },
        { provide: MotionService, useValue: { timeline: () => timeline, reveal: vi.fn(), scrollScene: vi.fn(), scrollToY: vi.fn() } },
      ],
    }).overrideComponent(HomePage, {
      remove: { imports: [HomeFilmComponent] },
      add: { imports: [FilmStub] },
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    document.body.style.overflow = '';
    localStorage.removeItem('tyre.ge.language');
    document.documentElement.lang = 'ka';
  });

  it('keeps the original winter aerial between the approved tyre close-ups and preserves shopping journeys', async () => {
    await render();
    const controls = [...host().querySelectorAll<HTMLButtonElement>('.hero__dot')];
    expect(controls.map((button) => button.getAttribute('aria-label'))).toEqual([
      'ვიდეო 1', 'ვიდეო 2', 'ვიდეო 3',
    ]);
    expect(fixture.debugElement.queryAll(By.directive(FilmStub)).slice(0, 3)
      .map((element) => (element.componentInstance as FilmStub).id()))
      .toEqual(['h03-tyre', 'h04', 'h05-tyre']);
    expect(controls.filter((button) => button.getAttribute('aria-current') === 'true')).toHaveLength(1);
    const actions = [...host().querySelectorAll<HTMLAnchorElement>('.hero__finder a')];
    expect(actions.map((link) => link.getAttribute('href'))).toEqual(['/catalog', '/garage']);
    expect(actions.map((link) => link.querySelector('span')?.textContent?.trim())).toEqual([
      'ზომით არჩევა', 'ავტომობილით არჩევა',
    ]);
    controls[2]!.click();
    fixture.detectChanges();
    expect(state<number>('heroIndex')()).toBe(2);
    expect(film('h05-tyre').active()).toBe(true);
    expect(film('h03-tyre').active()).toBe(false);
  });

  it('links each season card directly to the correct catalog filter and sets its climate', async () => {
    await render();
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const cards = [...host().querySelectorAll<HTMLAnchorElement>('.season-card')];
    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      '/catalog?season=summer', '/catalog?season=winter', '/catalog?season=all-season',
    ]);
    expect(cards.map((card) => card.querySelector('h3')?.textContent?.trim())).toEqual([
      'ზაფხული', 'ზამთარი', 'ყველა სეზონი',
    ]);
    for (const card of cards) {
      expect(film('season-' + card.dataset['season']).loop()).toBe(true);
      card.click();
    }
    expect(setSeason.mock.calls.map(([season]) => season)).toEqual(['summer', 'winter', 'all-season']);
  });

  it('supports hero keyboard and horizontal gestures without treating vertical scrolling as a slide change', async () => {
    await render();
    const hero = host().querySelector<HTMLElement>('.hero')!;
    const key = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    hero.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(state<number>('heroIndex')()).toBe(2);
    const gesture = (endX: number, endY: number): void => {
      hero.dispatchEvent(new MouseEvent('pointerdown', { clientX: 200, clientY: 200 }));
      hero.dispatchEvent(new MouseEvent('pointerup', { clientX: endX, clientY: endY }));
    };
    gesture(130, 400);
    expect(state<number>('heroIndex')()).toBe(2);
    gesture(120, 210);
    expect(state<number>('heroIndex')()).toBe(0);
  });

  it('switches each featured film together with its correct product destination', async () => {
    await render();
    const tabs = [...host().querySelectorAll<HTMLButtonElement>('.product-tabs button')];
    const models = [
      { film: 'p01', model: 'SU01', path: '/tire/002507' },
      { film: 'p03', model: 'DU71', path: '/tire/005475' },
      { film: 'p02', model: '4S', path: '/tire/002308' },
    ];
    expect(tabs).toHaveLength(models.length);
    models.forEach((model, index) => {
      tabs[index]!.click();
      fixture.detectChanges();
      expect(host().querySelector('.product-copy h3')?.textContent).toBe(model.model);
      expect(host().querySelector('.product-copy a')?.getAttribute('href')).toBe(model.path);
      expect(film(model.film).active()).toBe(true);
      expect(film(model.film).loop()).toBe(true);
      expect(host().querySelectorAll('.product-tabs [aria-pressed="true"]')).toHaveLength(1);
    });
  });

  it('preserves all 29 linked flip cards and the five anatomy stages', async () => {
    await render();
    const cards = [...host().querySelectorAll<HTMLAnchorElement>('.brand-card')];
    expect(cards).toHaveLength(29);
    expect(host().querySelectorAll('.brand-card__inner')).toHaveLength(29);
    expect(host().querySelectorAll('.brand-card__front')).toHaveLength(29);
    expect(host().querySelectorAll('.brand-card__back')).toHaveLength(29);
    expect(cards.every((card) => card.getAttribute('href')?.startsWith('/catalog?brand='))).toBe(true);
    expect(cards[0]!.style.getPropertyValue('--flip-delay')).not.toBe('');
    expect(cards[0]!.style.getPropertyValue('--flip-duration')).not.toBe('');
    expect(host().querySelectorAll('.carousel__item img')).toHaveLength(5);
    host().querySelector<HTMLElement>('.showcase')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(host().querySelector('.carousel__brand')?.textContent).toContain('რეზინის ნაერთი');
  });

  it('changes homepage actions and season labels to English without changing destinations', async () => {
    TestBed.inject(LanguageService).setLanguage('en');
    await render();
    const actions = [...host().querySelectorAll<HTMLAnchorElement>('.hero__finder a')];
    expect(actions.map((link) => link.querySelector('span')?.textContent?.trim())).toEqual(['Shop by size', 'Shop by vehicle']);
    expect(actions.map((link) => link.getAttribute('href'))).toEqual(['/catalog', '/garage']);
    expect([...host().querySelectorAll('.season-card h3')].map((el) => el.textContent?.trim())).toEqual(['Summer', 'Winter', 'All season']);
    expect(host().querySelector('#products-title')?.textContent).toBe('Meet the models.');
    expect(host().querySelector('.brands__heading')?.textContent).toContain('Brands');
  });

  it('starts hero playback only after client rendering and advances only the current playing film', async () => {
    expect(state<boolean>('heroPlaying')()).toBe(false);
    await render();
    expect(state<boolean>('heroPlaying')()).toBe(true);
    film('h04').ended.emit();
    expect(state<number>('heroIndex')()).toBe(0);
    film('h03-tyre').ended.emit();
    fixture.detectChanges();
    expect(state<number>('heroIndex')()).toBe(1);
    host().querySelector<HTMLButtonElement>('.hero__controls .media-toggle')!.click();
    fixture.detectChanges();
    expect(state<boolean>('heroPlaying')()).toBe(false);
    film('h04').ended.emit();
    expect(state<number>('heroIndex')()).toBe(1);
    host().querySelector<HTMLButtonElement>('.hero__controls .media-toggle')!.click();
    fixture.detectChanges();
    film('h04').ended.emit();
    expect(state<number>('heroIndex')()).toBe(2);
  });

  it('suppresses autoplay for reduced motion until the visitor explicitly starts a film', async () => {
    reduced.set(true);
    await render();
    state<boolean>('carouselInViewport').set(true);
    fixture.detectChanges();
    expect(state<boolean>('heroPlaying')()).toBe(false);
    expect(state<boolean>('productPlaying')()).toBe(false);
    expect(Reflect.get(fixture.componentInstance, 'autoplayTimer')).toBeUndefined();
    host().querySelector<HTMLButtonElement>('.hero__controls .media-toggle')!.click();
    fixture.detectChanges();
    expect(state<boolean>('heroPlaying')()).toBe(true);
    expect(Reflect.get(fixture.componentInstance, 'autoplayTimer')).toBeUndefined();
  });

  it('pauses when hidden or outside the hero and resumes without losing a manual pause', async () => {
    await render();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state<boolean>('heroPlaying')()).toBe(false);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state<boolean>('heroPlaying')()).toBe(true);
    state<boolean>('heroInViewport').set(false);
    expect(state<boolean>('heroPlaying')()).toBe(false);
    state<boolean>('heroPaused').set(true);
    state<boolean>('heroInViewport').set(true);
    expect(state<boolean>('heroPlaying')()).toBe(false);
  });

  it.each(['cancel', 'button', 'backdrop'] as const)('closes the product film via %s and restores focus and page scrolling', async (method) => {
    await render();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    document.body.style.overflow = 'clip';
    const trigger = host().querySelector<HTMLButtonElement>('.film-open')!;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    const dialog = host().querySelector<HTMLDialogElement>('dialog')!;
    dialog.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
    dialog.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
    frames.splice(0).forEach((callback) => callback(0));
    const close = dialog.querySelector<HTMLButtonElement>('.film-dialog__close')!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe('hidden');
    expect(state<boolean>('heroPlaying')()).toBe(false);
    expect(dialog.querySelector('a')?.getAttribute('href')).toBe('/tire/002507');
    dialog.querySelector<HTMLElement>('.film-dialog__surface')!.click();
    expect(state<boolean>('modalClosing')()).toBe(false);
    if (method === 'cancel') {
      const event = new Event('cancel', { cancelable: true });
      dialog.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    } else if (method === 'button') close.click();
    else dialog.click();
    fixture.detectChanges();
    expect(dialog.classList.contains('is-closing')).toBe(true);
    await vi.advanceTimersByTimeAsync(220);
    fixture.detectChanges();
    expect(host().querySelector('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('clip');
    expect(document.activeElement).toBe(trigger);
  });

  it('restores page scrolling if navigation destroys an open product film', async () => {
    await render();
    document.body.style.overflow = 'auto';
    host().querySelector<HTMLButtonElement>('.film-open')!.click();
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');
    fixture.destroy();
    expect(document.body.style.overflow).toBe('auto');
  });
});
