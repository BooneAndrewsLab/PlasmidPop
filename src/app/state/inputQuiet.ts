/**
 * When the page is being used (#278): the autosave's main-thread pieces
 * (the request to the save worker, the IndexedDB put) wait for a moment
 * nobody is scrolling, typing or dragging, so that what is left of a large
 * document's save does not land in the first scroll after it was opened.
 */

/** The events that say someone is using the page. A pointer move counts only as a drag. */
const INPUT_EVENTS = [
  'wheel',
  'scroll',
  'keydown',
  'pointerdown',
  'pointermove',
  'touchstart',
  'touchmove',
] as const;

/** How long the page has to have had no input to count as quiet, in ms. */
export const QUIET_MS = 1000;

/**
 * The longest a save waits for quiet, in ms: past it, it goes at the next
 * idle moment whatever the user is doing, so a long session of scrolling
 * does not leave an edit unsaved for as long (the flush on leaving covers
 * the page being closed meanwhile).
 */
export const MAX_QUIET_WAIT_MS = 5000;

/** Resolves when the main thread next has a moment to spare; the next task where there are no idle callbacks (jsdom, Safari). */
function whenIdle(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(
        () => {
          resolve();
        },
        { timeout },
      );
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class InputQuiet {
  /** When the last input came, on `now`'s clock; never, to begin with. */
  private last = -Infinity;
  private readonly onInput = (e: Event): void => {
    if (e.type === 'pointermove' && (e as PointerEvent).buttons === 0) return;
    this.last = this.now();
  };

  /**
   * Listens on `target` from the start, in the capture phase so a scroll
   * of any element is seen; with no target (Node) the page is always quiet.
   */
  constructor(
    target: EventTarget | null = typeof window === 'undefined' ? null : window,
    readonly now: () => number = () => performance.now(),
  ) {
    for (const type of INPUT_EVENTS) {
      target?.addEventListener(type, this.onInput, { capture: true, passive: true });
    }
  }

  /** How long ago the last input was, in ms. */
  sinceInput(): number {
    return this.now() - this.last;
  }

  /**
   * Resolves at an idle moment once there has been no input for `quietMs`,
   * or at the first idle moment after `maxWaitMs` whatever the input.
   */
  async whenQuiet(
    quietMs: number = QUIET_MS,
    maxWaitMs: number = MAX_QUIET_WAIT_MS,
  ): Promise<void> {
    const deadline = this.now() + maxWaitMs;
    for (;;) {
      const left = deadline - this.now();
      const wait = quietMs - this.sinceInput();
      if (wait > 0 && left > 0) {
        await sleep(Math.min(wait, left));
        continue;
      }
      await whenIdle(Math.max(1, Math.min(1000, left)));
      // Input during the wait for an idle moment starts the wait over.
      if (this.sinceInput() >= quietMs || this.now() >= deadline) return;
    }
  }
}

/** The page's own, listening from the moment the app loads. */
export const inputQuiet = new InputQuiet();
