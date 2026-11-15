import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { HomeFilmComponent } from './home-film';

describe('HomeFilmComponent playback lifecycle', () => {
  let fixture: ComponentFixture<HomeFilmComponent>;
  let mobile = false;
  let changeListener: (() => void) | undefined;
  let removeListener: ReturnType<typeof vi.fn>;
  const originalMatchMedia = window.matchMedia;

  const render = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    mobile = false;
    removeListener = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        get matches() { return mobile; },
        addEventListener: (_type: string, listener: () => void) => { changeListener = listener; },
        removeEventListener: removeListener,
      })),
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
    });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    await TestBed.configureTestingModule({ imports: [HomeFilmComponent] }).compileComponents();
    fixture = TestBed.createComponent(HomeFilmComponent);
    fixture.componentRef.setInput('id', 'h01');
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  });

  it('keeps inactive slides as responsive posters without loading a video', async () => {
    fixture.componentRef.setInput('active', false);
    await render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('video')).toBeNull();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/homepage-2026/h01-desktop-poster.webp');
    expect(host.querySelector('source')?.getAttribute('srcset')).toBe('/assets/homepage-2026/h01-mobile-poster.webp');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('selects the responsive film and obeys pause and resume without autoplay attributes', async () => {
    mobile = true;
    fixture.componentRef.setInput('playing', false);
    await render();
    const video = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/assets/homepage-2026/h01-mobile.mp4');
    expect(video.paused).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(false);

    fixture.componentRef.setInput('playing', true);
    await render();
    expect(video.paused).toBe(false);
    mobile = false;
    changeListener?.();
    await render();
    expect(video.getAttribute('src')).toBe('/assets/homepage-2026/h01-desktop.mp4');
  });

  it('reports actual media progress and completion', async () => {
    const progress = vi.fn();
    const ended = vi.fn();
    fixture.componentInstance.progress.subscribe(progress);
    fixture.componentInstance.ended.subscribe(ended);
    await render();
    const video = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable: true, value: 7 });
    video.currentTime = 3.5;
    video.dispatchEvent(new Event('timeupdate'));
    expect(progress).toHaveBeenLastCalledWith(50);
    video.dispatchEvent(new Event('ended'));
    expect(progress).toHaveBeenLastCalledWith(100);
    expect(ended).toHaveBeenCalledOnce();
  });

  it('retains the poster on a media failure and releases the failed source', async () => {
    const failed = vi.fn();
    fixture.componentInstance.failed.subscribe(failed);
    await render();
    const host = fixture.nativeElement as HTMLElement;
    const video = host.querySelector('video')!;
    video.dispatchEvent(new Event('loadeddata'));
    await render();
    expect(video.classList.contains('is-ready')).toBe(true);
    video.dispatchEvent(new Event('error'));
    await render();
    expect(host.querySelector('video')).toBeNull();
    expect(host.querySelector('picture img')).not.toBeNull();
    expect(video.hasAttribute('src')).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
  });

  it('pauses in a hidden tab and does not override the caller pause when visibility returns', async () => {
    await render();
    const video = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await render();
    expect(video.paused).toBe(true);
    fixture.componentRef.setInput('playing', false);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await render();
    expect(video.paused).toBe(true);
  });

  it('retries denied autoplay only after the caller explicitly toggles playback', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('Autoplay denied', 'NotAllowedError'));
    await render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('video')).toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('playing', false);
    await render();
    expect(host.querySelector('video')).toBeNull();
    fixture.componentRef.setInput('playing', true);
    await render();
    expect(host.querySelector('video')).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it('releases playback and viewport listeners when destroyed', async () => {
    await render();
    const video = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    fixture.destroy();
    expect(video.paused).toBe(true);
    expect(video.hasAttribute('src')).toBe(false);
    expect(removeListener).toHaveBeenCalledWith('change', changeListener);
  });
});
