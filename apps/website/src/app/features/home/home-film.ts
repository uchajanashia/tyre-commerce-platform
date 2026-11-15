import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** One responsive, decorative film. The page owns its carousel and playback controls. */
@Component({
  selector: 'app-home-film',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <picture>
      <source [media]="mobileMedia()" [srcset]="mobilePoster()" />
      <img
        [src]="desktopPoster()"
        alt=""
        [attr.loading]="priority() ? 'eager' : 'lazy'"
        [attr.fetchpriority]="priority() ? 'high' : 'auto'"
        decoding="async"
      />
    </picture>
    @if (active() && clientReady() && !loadFailed()) {
      <video
        #film
        [src]="videoSource()"
        [poster]="mobile() ? mobilePoster() : desktopPoster()"
        [muted]="true"
        playsinline
        [loop]="loop()"
        [attr.preload]="priority() ? 'auto' : 'metadata'"
        [class.is-ready]="ready()"
        (loadstart)="ready.set(false)"
        (loadeddata)="ready.set(true)"
        (timeupdate)="onTimeUpdate($event)"
        (ended)="onEnded()"
        (error)="onFailure()"
      ></video>
    }
  `,
  styles: `
    :host { position: absolute; inset: 0; display: block; overflow: hidden; }
    picture, img, video { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
    img, video { object-fit: var(--film-fit, cover); object-position: var(--film-position, center); }
    video { opacity: 0; transition: opacity 550ms ease; }
    video.is-ready { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { video { transition: none; } }
  `,
})
export class HomeFilmComponent {
  readonly id = input.required<string>();
  readonly active = input(true);
  readonly playing = input(true);
  readonly loop = input(false);
  readonly priority = input(false);
  readonly mobileMedia = input('(max-width: 767px)');

  readonly ended = output<void>();
  readonly progress = output<number>();
  readonly failed = output<void>();

  protected readonly mobile = signal(false);
  protected readonly clientReady = signal(false);
  protected readonly ready = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly desktopPoster = computed(() => this.asset('desktop', '-poster.webp'));
  protected readonly mobilePoster = computed(() => this.asset('mobile', '-poster.webp'));
  protected readonly videoSource = computed(() => this.asset(this.mobile() ? 'mobile' : 'desktop', '.mp4'));

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly film = viewChild<ElementRef<HTMLVideoElement>>('film');
  private readonly pageVisible = signal(true);
  private previousVideo?: HTMLVideoElement;
  private playbackAttempt = 0;
  private previousPlaying?: boolean;
  private destroyed = false;

  constructor() {
    effect(() => {
      this.videoSource();
      this.active();
      this.playbackAttempt++;
      this.ready.set(false);
      this.loadFailed.set(false);
    });

    effect(() => {
      const playing = this.playing();
      // A deliberate pause → play toggle retries denied autoplay once.
      // Pausing alone keeps the current frame and does not reload a healthy film.
      if (playing && this.previousPlaying === false) this.loadFailed.set(false);
      this.previousPlaying = playing;
    });

    afterNextRender(() => {
      const view = this.document.defaultView;
      if (!view) return;
      const query = view.matchMedia(this.mobileMedia());
      const updateViewport = () => this.mobile.set(query.matches);
      const updateVisibility = () => {
        const visible = this.document.visibilityState !== 'hidden';
        this.pageVisible.set(visible);
        if (!visible) {
          this.playbackAttempt++;
          this.film()?.nativeElement.pause();
        }
      };
      updateViewport();
      updateVisibility();
      query.addEventListener('change', updateViewport);
      this.document.addEventListener('visibilitychange', updateVisibility);
      this.destroyRef.onDestroy(() => {
        query.removeEventListener('change', updateViewport);
        this.document.removeEventListener('visibilitychange', updateVisibility);
      });
      this.clientReady.set(true);
    });

    afterRenderEffect(() => {
      this.videoSource();
      const video = this.film()?.nativeElement;
      const shouldPlay = this.active() && this.playing() && this.pageVisible() && !this.loadFailed();
      if (this.previousVideo && this.previousVideo !== video) this.release(this.previousVideo);
      this.previousVideo = video;
      if (!video) return;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      if (shouldPlay) {
        this.play(video);
      } else {
        this.playbackAttempt++;
        video.pause();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.playbackAttempt++;
      if (this.previousVideo) this.release(this.previousVideo);
    });
  }

  protected onTimeUpdate(event: Event): void {
    const video = event.currentTarget as HTMLVideoElement;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      this.progress.emit(Math.min(100, Math.max(0, video.currentTime / video.duration * 100)));
    }
  }

  protected onEnded(): void {
    this.progress.emit(100);
    this.ended.emit();
  }

  protected onFailure(): void {
    if (this.destroyed || this.loadFailed()) return;
    this.ready.set(false);
    this.loadFailed.set(true);
    this.failed.emit();
  }

  private asset(variant: 'desktop' | 'mobile', suffix: string): string {
    return `/assets/homepage-2026/${this.id()}-${variant}${suffix}`;
  }

  private play(video: HTMLVideoElement): void {
    if (!video.paused) return;
    const attempt = ++this.playbackAttempt;
    try {
      const playback = video.play();
      playback?.catch((error: unknown) => {
        if (this.destroyed || attempt !== this.playbackAttempt || !this.playing() || !this.active()) return;
        // Switching sources or pausing an in-flight play request is an ordinary lifecycle event.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        this.onFailure();
      });
    } catch {
      this.onFailure();
    }
  }

  private release(video: HTMLVideoElement): void {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
