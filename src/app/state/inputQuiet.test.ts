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
