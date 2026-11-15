import { DestroyRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { MotionPreferenceService } from './motion-preference.service';
import { MotionService } from './motion.service';

const animation = vi.hoisted(() => ({
  fromTo: vi.fn(),
  timeline: vi.fn(),
  registerPlugin: vi.fn(),
}));
vi.mock('gsap', () => ({ gsap: { ...animation, set: vi.fn(), to: vi.fn() } }));

describe('MotionService route and caller lifecycles', () => {
  let service: MotionService;
  let events: Subject<NavigationStart>;
  let router: { url: string; events: ReturnType<Subject<NavigationStart>['asObservable']> };
  let trigger: { kill: ReturnType<typeof vi.fn> };
  let tween: { kill: ReturnType<typeof vi.fn>; scrollTrigger: typeof trigger };
  let owner: { destroyed: boolean; callbacks: Set<() => void>; ref: DestroyRef };

  const pendingPlugin = () => {
    let resolve!: (value: object) => void;
    const promise = new Promise<object>((done) => { resolve = done; });
    vi.spyOn(service as unknown as { loadScrollTrigger(): Promise<object> }, 'loadScrollTrigger')
      .mockReturnValue(promise);
    return async () => { resolve({}); await promise; await Promise.resolve(); };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    events = new Subject<NavigationStart>();
    router = { url: '/', events: events.asObservable() };
    TestBed.configureTestingModule({
      providers: [
        MotionService,
        { provide: Router, useValue: router },
        { provide: MotionPreferenceService, useValue: { reduced: signal(false) } },
      ],
    });
    service = TestBed.inject(MotionService);
    trigger = { kill: vi.fn() };
    tween = { kill: vi.fn(), scrollTrigger: trigger };
    animation.fromTo.mockReturnValue(tween);
    animation.timeline.mockReturnValue({ ...tween, progress: vi.fn() });
    owner = { destroyed: false, callbacks: new Set(), ref: undefined as unknown as DestroyRef };
    owner.ref = {
      get destroyed() { return owner.destroyed; },
      onDestroy: (callback: () => void) => {
        if (owner.destroyed) throw new Error('Caller already destroyed');
        owner.callbacks.add(callback);
        return () => { owner.callbacks.delete(callback); };
      },
    };
  });

  afterEach(() => {
    events.complete();
    vi.restoreAllMocks();
  });

  it('preserves existing reveals when navigating to a hash or query on the current route', async () => {
    const finishLoading = pendingPlugin();
    service.reveal(document.createElement('section'), undefined, owner.ref);
    await finishLoading();

    events.next(new NavigationStart(1, '/#season'));
    router.url = '/#season';
    events.next(new NavigationStart(2, '/?preview=summer#brands'));
    expect(trigger.kill).not.toHaveBeenCalled();
    expect(animation.fromTo).toHaveBeenCalledOnce();
  });

  it('tears down tracked scenes when navigating to a different page', async () => {
    const finishLoading = pendingPlugin();
    service.reveal(document.createElement('section'), undefined, owner.ref);
    await finishLoading();
    events.next(new NavigationStart(1, '/catalog?season=summer'));
    expect(trigger.kill).toHaveBeenCalledOnce();

    router.url = '/catalog?season=summer';
    events.next(new NavigationStart(2, '/catalog?season=winter'));
    expect(trigger.kill).toHaveBeenCalledOnce();
  });

  it('does not start a delayed reveal after its owner is destroyed', async () => {
    const finishLoading = pendingPlugin();
    service.reveal(document.createElement('section'), undefined, owner.ref);
    owner.destroyed = true;
    await finishLoading();
    expect(animation.fromTo).not.toHaveBeenCalled();
    expect(owner.callbacks.size).toBe(0);
  });

  it('discards plugin callbacks belonging to the page being left', async () => {
    const finishLoading = pendingPlugin();
    service.reveal(document.createElement('section'), undefined, owner.ref);
    events.next(new NavigationStart(1, '/catalog'));
    await finishLoading();
    expect(animation.fromTo).not.toHaveBeenCalled();
  });

  it('does not build a delayed scroll scene after its owner is destroyed', async () => {
    const finishLoading = pendingPlugin();
    const build = vi.fn();
    service.scrollScene(document.createElement('section'), build, undefined, owner.ref);
    owner.destroyed = true;
    await finishLoading();
    expect(build).not.toHaveBeenCalled();
    expect(animation.timeline).not.toHaveBeenCalled();
  });

  it('releases both the reveal animation and its trigger with the caller', async () => {
    const finishLoading = pendingPlugin();
    service.reveal(document.createElement('section'), undefined, owner.ref);
    await finishLoading();
    owner.destroyed = true;
    owner.callbacks.forEach((callback) => callback());
    expect(tween.kill).toHaveBeenCalledOnce();
    expect(trigger.kill).toHaveBeenCalledOnce();
  });
});
