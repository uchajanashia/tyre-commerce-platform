import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, PLATFORM_ID, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { catchError, of, filter } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { Brand, Season } from '@core/models';
import { ClimateService } from '@core/services/climate.service';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { MotionPreferenceService } from '@core/services/motion-preference.service';
import { MotionService } from '@core/services/motion.service';
import catalogBrands from '@data/catalog-brands.json';
import { HomeFilmComponent } from './home-film';
import { BrandCard, HomeBrandsComponent } from './home-brands';


const DARK_LOGO_PLATE_BRANDS = new Set(['bearway', 'hawkway', 'lakesea', 'neumaster', 'superhawk']);

interface AnatomyStage {
  readonly frame: string;
  readonly num: string;
  readonly title: BilingualCopy;
  readonly text: BilingualCopy;
  readonly detail: BilingualCopy;
}

interface BilingualCopy {
  readonly ka: string;
  readonly en: string;
}

const ANATOMY_STAGES: readonly AnatomyStage[] = [
  {
    frame: '/assets/tire-anatomy/frame-00.webp',
    num: '01',
    title: { ka: 'ზუსტი კონტაქტი გზასთან', en: 'Precise contact with the road' },
    text: {
      ka: 'ასიმეტრიული პროტექტორი და ოთხი ფართო არხი უზრუნველყოფს სტაბილურ მოძრაობას, მშვიდ სვლასა და წყლის სწრაფ გამოდევნას.',
      en: 'An asymmetric tread and four wide channels provide stability, a quiet ride and fast water evacuation.',
    },
    detail: { ka: 'პროტექტორი', en: 'Tread' },
  },
  {
    frame: '/assets/tire-anatomy/frame-01.webp',
    num: '02',
    title: { ka: 'გამძლე გარე ნაერთი', en: 'Durable outer compound' },
    text: {
      ka: 'რეზინის გარე ნაერთი აერთიანებს მოჭიდებას, ცვეთისადმი გამძლეობასა და ყოველდღიურ კომფორტს.',
      en: 'The outer rubber compound balances grip, wear resistance and everyday comfort.',
    },
    detail: { ka: 'რეზინის ნაერთი', en: 'Rubber compound' },
  },
  {
    frame: '/assets/tire-anatomy/frame-02.webp',
    num: '03',
    title: { ka: 'სტაბილიზაციის ფენა', en: 'Stabilising layer' },
    text: {
      ka: 'უწყვეტი ნეილონის ფენა მაღალ სიჩქარეზე ამაგრებს ქამრების პაკეტს და საბურავის ფორმას ინარჩუნებს.',
      en: 'A continuous nylon layer reinforces the belt package at speed and helps the tyre keep its shape.',
    },
    detail: { ka: 'ნეილონის საფარი', en: 'Nylon cap' },
  },
  {
    frame: '/assets/tire-anatomy/frame-03.webp',
    num: '04',
    title: { ka: 'ორი ფოლადის ქამარი', en: 'Two steel belts' },
    text: {
      ka: 'საწინააღმდეგო კუთხით განლაგებული ფოლადის ქამრები ამაგრებს პროტექტორის ზონას და ზრდის მართვის სტაბილურობას.',
      en: 'Opposing steel belts reinforce the tread area and improve handling stability.',
    },
    detail: { ka: 'ფოლადის კარკასი', en: 'Steel structure' },
  },
  {
    frame: '/assets/tire-anatomy/frame-04.webp',
    num: '05',
    title: { ka: 'სრული შიდა სისტემა', en: 'Complete inner system' },
    text: {
      ka: 'კარკასი, ჰერმეტული შიდა ფენა და ბორტის რგოლები ერთად ანაწილებს დატვირთვას, ინარჩუნებს წნევას და საბურავს დისკზე აფიქსირებს.',
      en: 'The carcass, airtight liner and bead rings distribute load, retain pressure and secure the tyre to the wheel.',
    },
    detail: { ka: 'შიდა კონსტრუქცია', en: 'Inner construction' },
  },
] as const;

interface ProductFilm {
  id: string;
  model: string;
  family: string;
  description: BilingualCopy;
  productId: string;
}

@Component({
  selector: 'app-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HomeFilmComponent, HomeBrandsComponent],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  private readonly data = inject(FitmentDataService);
  private readonly language = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly climate = inject(ClimateService);
  private readonly motionPreference = inject(MotionPreferenceService);
  private readonly motion = inject(MotionService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  protected readonly heroFilms = [
    { id: 'h03-tyre', title: { ka: 'ყოველი ახალი მიმართულება', en: 'Every new direction' } },
    { id: 'h04', title: { ka: 'ზამთრის გზები', en: 'Winter roads' } },
    { id: 'h05-tyre', title: { ka: 'გზა გრძელდება', en: 'The road goes on' } },
  ];
  protected readonly seasons: { id: Season; index: string; title: BilingualCopy; note: BilingualCopy }[] = [
    { id: 'summer', index: '01', title: { ka: 'ზაფხული', en: 'Summer' }, note: { ka: 'თბილი დღეებისთვის', en: 'For warmer days' } },
    { id: 'winter', index: '02', title: { ka: 'ზამთარი', en: 'Winter' }, note: { ka: 'ცივი დღეებისთვის', en: 'For colder days' } },
    { id: 'all-season', index: '03', title: { ka: 'ყველა სეზონი', en: 'All season' }, note: { ka: 'ცვალებადი ამინდისთვის', en: 'For changing weather' } },
  ];
  protected readonly productFilms: ProductFilm[] = [
    { id: 'p01', model: 'SU01', family: 'RXQUEST', description: { ka: 'ზაფხული შენი SUV-ისთვის.', en: 'Summer for your SUV.' }, productId: '002507' },
    { id: 'p03', model: 'DU71', family: 'RXMOTION', description: { ka: 'გაიცანი საზაფხულო მოდელი.', en: 'Meet the summer model.' }, productId: '005475' },
    { id: 'p02', model: '4S', family: 'RXMOTION', description: { ka: 'გაიცანი ყველა სეზონის მოდელი.', en: 'Explore the all-season model.' }, productId: '002308' },
  ];
  protected readonly heroIndex = signal(0);
  protected readonly activeHero = computed(() => this.heroFilms[this.heroIndex()]!);
  protected readonly heroProgress = signal(0);
  protected readonly heroPaused = signal(false);
  protected readonly productIndex = signal(0);
  protected readonly productPaused = signal(false);
  protected readonly mediaReady = signal(false);
  protected readonly hoveredSeason = signal<Season | null>(null);
  protected readonly focusedSeason = signal<Season | null>(null);
  private readonly seasonHoverDevice = signal(true);
  private readonly visibleSeasons = signal<ReadonlySet<string>>(new Set());
  protected seasonPlaying(id: Season): boolean {
    return this.mediaReady() && this.pageVisible() && !this.modalProduct() &&
      !this.motionPreference.reduced() && this.visibleSeasons().has(id) &&
      (!this.seasonHoverDevice() || this.hoveredSeason() === id || this.focusedSeason() === id);
  }

  protected readonly manualMotion = signal(false);
  private readonly pageVisible = signal(true);
  private readonly heroInViewport = signal(true);
  private readonly productInViewport = signal(false);
  protected readonly modalProduct = signal<ProductFilm | null>(null);
  protected readonly modalClosing = signal(false);
  protected readonly activeProduct = computed(() => this.productFilms[this.productIndex()]!);
  protected readonly heroPlaying = computed(() => this.mediaReady() && this.pageVisible() && this.heroInViewport() && !this.heroPaused() && !this.modalProduct() && (!this.motionPreference.reduced() || this.manualMotion()));
  protected readonly productPlaying = computed(() => this.mediaReady() && this.pageVisible() && this.productInViewport() && !this.productPaused() && !this.modalProduct() && (!this.motionPreference.reduced() || this.manualMotion()));

  protected readonly anatomyStages = ANATOMY_STAGES;
  protected readonly activeIndex = signal(0);
  protected readonly paused = signal(false);
  private readonly carouselInViewport = signal(false);
  protected readonly activeStage = computed(() => this.anatomyStages[this.activeIndex()]!);
  private readonly brandsApi = toSignal(this.data.getBrands().pipe(catchError(() => of(catalogBrands as Brand[]))), { initialValue: [] as Brand[] });
  protected readonly brandCards = computed<BrandCard[]>(() => {
    const brands = this.brandsApi().length ? this.brandsApi() : catalogBrands as Brand[];
    return brands.map((brand, index) => ({ ...brand, logoUrl: `/assets/brands/${brand.id}.webp`, needsDarkLogoPlate: DARK_LOGO_PLATE_BRANDS.has(brand.id), flipDelay: 2 + ((index * 7) % 15), flipDuration: 0.75 + ((index * 13) % 5) * 0.06 }));
  });
  private autoplayTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private scrollObserver?: IntersectionObserver;
  private seasonObserver?: IntersectionObserver;
  private pointerStart?: { x: number; y: number };
  private heroPointerStart?: { x: number; y: number };
  private modalTrigger?: HTMLElement;
  private bodyOverflow = '';
  private bodyLocked = false;

  constructor() {
    effect(() => {
      this.activeIndex(); this.paused(); this.carouselInViewport(); this.pageVisible(); this.motionPreference.reduced(); this.modalProduct();
      this.scheduleAutoplay();
    });
    afterNextRender(() => {
      this.mediaReady.set(true);
      this.document.addEventListener('visibilitychange', this.onVisibilityChange);
      const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
      const updateHover = () => { this.seasonHoverDevice.set(hoverQuery.matches); this.hoveredSeason.set(null); };
      updateHover();
      hoverQuery.addEventListener('change', updateHover);
      this.destroyRef.onDestroy(() => hoverQuery.removeEventListener('change', updateHover));
      this.setupObservers();
      this.startEntrance();
      this.scrollToHash();
    });
    const navigation = this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => this.scrollToHash());
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.autoplayTimer); clearTimeout(this.closeTimer);
      this.scrollObserver?.disconnect(); this.seasonObserver?.disconnect(); navigation.unsubscribe();
      this.document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.restoreBody();
    });
  }

  protected t(ka: string, en: string): string { return this.language.language() === 'en' ? en : ka; }
  protected chooseHero(index: number): void {
    this.heroIndex.set((index + this.heroFilms.length) % this.heroFilms.length);
    this.heroProgress.set(0);
  }
  protected heroEnded(index: number): void {
    if (index === this.heroIndex() && this.heroPlaying()) this.chooseHero(index + 1);
  }
  protected toggleHero(): void {
    if (this.motionPreference.reduced() && !this.manualMotion()) { this.manualMotion.set(true); this.heroPaused.set(false); }
    else this.heroPaused.update(value => !value);
  }
  protected toggleProduct(): void {
    if (this.motionPreference.reduced() && !this.manualMotion()) { this.manualMotion.set(true); this.productPaused.set(false); }
    else this.productPaused.update(value => !value);
  }
  protected chooseProduct(index: number): void { this.productIndex.set(index); this.productPaused.set(false); }
  protected setSeason(season: Season): void { this.climate.setSeason(season); }
  protected heroKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); this.chooseHero(this.heroIndex() + (event.key === 'ArrowRight' ? 1 : -1));
    }
  }
  protected heroPointerDown(event: PointerEvent): void { this.heroPointerStart = { x: event.clientX, y: event.clientY }; }
  protected heroPointerUp(event: PointerEvent): void {
    if (this.heroPointerStart) {
      const dx = event.clientX - this.heroPointerStart.x, dy = event.clientY - this.heroPointerStart.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) this.chooseHero(this.heroIndex() + (dx < 0 ? 1 : -1));
    }
    this.heroPointerStart = undefined;
  }
  protected openFilm(event: Event): void {
    this.modalTrigger = event.currentTarget as HTMLElement;
    this.modalProduct.set(this.activeProduct());
    this.modalClosing.set(false);
    this.bodyOverflow = this.document.body.style.overflow;
    this.bodyLocked = true;
    this.document.body.style.overflow = 'hidden';
    this.document.defaultView?.requestAnimationFrame(() => {
      const dialog = this.host.nativeElement.querySelector<HTMLDialogElement>('dialog');
      if (!dialog || !this.modalProduct()) return;
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('.film-dialog__close')?.focus();
    });
  }
  protected closeFilm(event?: Event): void {
    event?.preventDefault();
    if (!this.modalProduct() || this.modalClosing()) return;
    this.modalClosing.set(true);
    this.closeTimer = setTimeout(() => {
      this.host.nativeElement.querySelector<HTMLDialogElement>('dialog')?.close();
      this.modalProduct.set(null); this.modalClosing.set(false); this.restoreBody();
      this.modalTrigger?.focus();
    }, this.motionPreference.reduced() ? 0 : 220);
  }
  protected backdropClick(event: MouseEvent): void { if (event.target === event.currentTarget) this.closeFilm(); }
  private restoreBody(): void { if (this.bodyLocked) { this.document.body.style.overflow = this.bodyOverflow; this.bodyLocked = false; } }

  protected previous(): void { this.activeIndex.update(index => (index - 1 + this.anatomyStages.length) % this.anatomyStages.length); }
  protected next(): void { this.activeIndex.update(index => (index + 1) % this.anatomyStages.length); }
  protected selectStage(index: number): void { this.activeIndex.set(index); }
  protected relativePosition(index: number): number {
    let distance = index - this.activeIndex(); const total = this.anatomyStages.length;
    if (distance > total / 2) distance -= total; else if (distance < -total / 2) distance += total;
    return distance;
  }
  protected isHidden(index: number): boolean { return Math.abs(this.relativePosition(index)) > 1; }
  protected setPaused(value: boolean): void { this.paused.set(value); }
  protected onCarouselKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.previous(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); this.next(); }
  }
  protected onCarouselFocusOut(): void {
    if (this.isBrowser) setTimeout(() => this.paused.set(Boolean(this.host.nativeElement.querySelector('.showcase')?.contains(this.document.activeElement))));
  }
  protected onPointerDown(event: PointerEvent): void { this.pointerStart = { x: event.clientX, y: event.clientY }; this.paused.set(true); }
  protected onPointerUp(event: PointerEvent): void {
    if (this.pointerStart) {
      const dx = event.clientX - this.pointerStart.x, dy = event.clientY - this.pointerStart.y;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { if (dx > 0) this.previous(); else this.next(); }
    }
    this.pointerStart = undefined; this.paused.set(false);
  }
  protected onPointerCancel(): void { this.pointerStart = undefined; this.paused.set(false); }
  private scheduleAutoplay(): void {
    clearTimeout(this.autoplayTimer);
    if (!this.isBrowser || this.paused() || !this.carouselInViewport() || this.motionPreference.reduced() || !this.pageVisible() || this.modalProduct()) return;
    this.autoplayTimer = setTimeout(() => this.next(), 7000);
  }
  private readonly onVisibilityChange = (): void => this.pageVisible.set(!this.document.hidden);
  private scrollToHash(): void {
    if (!this.isBrowser) return;
    const id = this.document.location.hash.slice(1);
    if (id === 'season' || id === 'brands' || id === 'anatomy') this.document.defaultView?.requestAnimationFrame(() => {
      const section = this.document.getElementById(id);
      if (section) {
        const offset = parseFloat(getComputedStyle(this.host.nativeElement).getPropertyValue('--home-header-height')) || 80;
        this.motion.scrollToY(window.scrollY + section.getBoundingClientRect().top - offset - 16, { duration: 0.85 });
      }
    });
  }
  private setupObservers(): void {
    if (typeof IntersectionObserver === 'undefined') { this.productInViewport.set(true); this.visibleSeasons.set(new Set(this.seasons.map(season => season.id))); return; }
    this.scrollObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target.matches('.hero')) this.heroInViewport.set(entry.isIntersecting);
        if (entry.target.matches('.product-cinema')) this.productInViewport.set(entry.isIntersecting);
        if (entry.target.matches('.showcase')) this.carouselInViewport.set(entry.isIntersecting);
      }
    }, { threshold: 0.12 });
    this.host.nativeElement.querySelectorAll('.hero,.product-cinema,.showcase').forEach(el => this.scrollObserver?.observe(el));
    this.seasonObserver = new IntersectionObserver(entries => {
      const visible = new Set(this.visibleSeasons());
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset['season'];
        if (!id) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visible.add(id);
        else visible.delete(id);
      }
      this.visibleSeasons.set(visible);
    }, { threshold: [0, 0.5] });
    this.host.nativeElement.querySelectorAll('.season-card').forEach(el => this.seasonObserver?.observe(el));
  }
  private startEntrance(): void {
    const root = this.host.nativeElement;
    if (this.motionPreference.reduced()) return;
    const intro = this.motion.timeline({ defaults: { ease: 'power3.out' } }, this.destroyRef);
    intro.fromTo(root.querySelectorAll('[data-hero-copy]'), { y: 48, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.12, duration: 1, clearProps: 'transform,opacity' }, 0.1);
    intro.fromTo(root.querySelector('.hero__finder'), { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.85, clearProps: 'transform,opacity' }, 0.6);
    root.querySelectorAll('[data-reveal]').forEach((el, index) => this.motion.reveal(el, { delay: el.classList.contains('season-card') ? (index % 3) * 0.1 : 0 }, this.destroyRef));
    if (window.matchMedia('(min-width: 1024px)').matches) {
      const hero = root.querySelector('.hero');
      if (hero) this.motion.scrollScene(hero, tl => { tl.to(root.querySelector('.hero__visual'), { yPercent: 16, ease: 'none' }); }, { start: 'top top', end: 'bottom top', scrub: 0.5 }, this.destroyRef);
    }
  }
}
