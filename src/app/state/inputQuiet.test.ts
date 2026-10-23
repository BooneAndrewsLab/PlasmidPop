// @vitest-environment jsdom
import { InputQuiet, inputQuiet } from './inputQuiet';

/**
 * When the autosave may run its main-thread pieces (#278): after the input
 * has been quiet for a while, at an idle moment, and at the latest a few
 * seconds after it asked, whatever the input.
 */

describe('InputQuiet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A page of its own, on the fake clock, and when its wait resolved. */
  function page(quietMs = 1000, maxWaitMs = 5000) {
    const target = new EventTarget();
    const quiet = new InputQuiet(target, () => Date.now());
    const start = Date.now();
    let resolvedAt: number | null = null;
    const wait = (): void => {
      void quiet.whenQuiet(quietMs, maxWaitMs).then(() => {
        resolvedAt = Date.now() - start;
      });
    };
    const input = (type: string, init: { buttons?: number } = {}): void => {
      const e = new Event(type);
      Object.assign(e, init);
      target.dispatchEvent(e);
    };
    return { quiet, wait, input, resolvedAt: () => resolvedAt };
  }

  it('resolves at the next idle moment when nobody has touched the page', async () => {
    const p = page();
    p.wait();
    await vi.advanceTimersByTimeAsync(1);
    expect(p.resolvedAt()).not.toBeNull();
  });

  it('waits until the input has been quiet that long, each input pushing it back', async () => {
    const p = page();
    p.input('wheel');
    p.wait();
    await vi.advanceTimersByTimeAsync(600);
    expect(p.resolvedAt()).toBeNull();
    p.input('keydown');
    await vi.advanceTimersByTimeAsync(900);
    expect(p.resolvedAt()).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(p.resolvedAt()).toBeGreaterThanOrEqual(1600);
    expect(p.resolvedAt()).toBeLessThanOrEqual(1610);
  });

  it('counts scrolling, typing, pressing, touching and dragging, not a pointer passing over', () => {
    for (const [type, init] of [
      ['wheel', {}],
      ['scroll', {}],
      ['keydown', {}],
      ['pointerdown', {}],
      ['pointermove', { buttons: 1 }],
      ['touchstart', {}],
      ['touchmove', {}],
    ] as const) {
      const p = page();
      p.input(type, init);
      expect(p.quiet.sinceInput()).toBe(0);
    }
    const hover = page();
    hover.input('pointermove', { buttons: 0 });
    expect(hover.quiet.sinceInput()).toBe(Infinity);
    // A wheel turned with no button held carries buttons 0 too, and counts.
    const wheel = page();
    wheel.input('wheel', { buttons: 0 });
    expect(wheel.quiet.sinceInput()).toBe(0);
  });

  it('listens in the capture phase and passively, and to nothing without a page', () => {
    const addEventListener = vi.fn();
    new InputQuiet({ addEventListener } as unknown as EventTarget, () => 0);
    expect(addEventListener.mock.calls.length).toBeGreaterThan(0);
    for (const [, , options] of addEventListener.mock.calls)
      expect(options).toEqual({ capture: true, passive: true });
    expect(new InputQuiet(null, () => 0).sinceInput()).toBe(Infinity);
  });

  it('asks for the idle moment within a second, or by the deadline if that is sooner', async () => {
    const quiet = new InputQuiet(new EventTarget(), () => Date.now());
    const timeouts: unknown[] = [];
    vi.stubGlobal('requestIdleCallback', (cb: () => void, options: unknown) => {
      timeouts.push(options);
      cb();
    });
    try {
      await quiet.whenQuiet(1000, 5000);
      await quiet.whenQuiet(1000, 300);
      expect(timeouts).toEqual([{ timeout: 1000 }, { timeout: 300 }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives up at the deadline itself, not a moment after it', async () => {
    // On a clock that stands still the deadline is now: one idle moment, then done.
    const target = new EventTarget();
    const quiet = new InputQuiet(target, () => 0);
    target.dispatchEvent(new Event('keydown'));
    let done = false;
    void quiet.whenQuiet(1000, 0).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('gives up waiting after the longest wait, however busy the page', async () => {
    const p = page(1000, 5000);
    p.wait();
    for (let t = 0; t < 8000; t += 100) {
      p.input('wheel');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(p.resolvedAt()).toBeGreaterThanOrEqual(5000);
    expect(p.resolvedAt()).toBeLessThanOrEqual(5200);
  });

  it('starts over when input comes while it waits for the idle moment', async () => {
    const target = new EventTarget();
    const quiet = new InputQuiet(target, () => Date.now());
    const idle: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => idle.push(cb));
    try {
      let done = false;
      void quiet.whenQuiet(1000, 60_000).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(idle).toHaveLength(1);
      target.dispatchEvent(new Event('wheel'));
      idle[0]?.();
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(idle).toHaveLength(2);
      idle[1]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the page's InputQuiet", () => {
  it('hears a scroll of any element, in the capture phase', () => {
    const box = document.createElement('div');
    document.body.append(box);
    try {
      box.dispatchEvent(new Event('scroll'));
      expect(inputQuiet.sinceInput()).toBeLessThan(1000);
    } finally {
      box.remove();
    }
  });
});
