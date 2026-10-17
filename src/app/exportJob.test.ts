import {
  ExportCancelledError,
  type ExportProgress,
  YIELD_AFTER_MS,
  eachPage,
  isCancelled,
  throwIfCancelled,
} from './exportJob';

describe('eachPage (#247, #248)', () => {
  it('runs the steps one at a time, in order, reporting progress before the first and after each', async () => {
    const seen: ExportProgress[] = [];
    let running = 0;
    let most = 0;
    const out = await eachPage(
      ['a', 'b', 'c'],
      'drawing',
      { onProgress: (p) => seen.push(p) },
      async (s, i) => {
        running++;
        most = Math.max(most, running);
        await Promise.resolve();
        running--;
        return `${s}${String(i)}`;
      },
    );
    expect(out).toEqual(['a0', 'b1', 'c2']);
    expect(most).toBe(1);
    expect(seen).toEqual([0, 1, 2, 3].map((done) => ({ stage: 'drawing', done, total: 3 })));
  });

  it('stops after the step during which the signal was aborted, with the cancellation', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await expect(
      eachPage([1, 2, 3, 4], 'writing', { signal: controller.signal }, (n) => {
        started.push(n);
        if (n === 2) controller.abort();
        return n;
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError);
    expect(started).toEqual([1, 2]);
  });

  it('does not start at all on a signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const step = vi.fn();
    await expect(eachPage([1], 'drawing', { signal: controller.signal }, step)).rejects.toThrow(
      'Cancelled',
    );
    expect(step).not.toHaveBeenCalled();
  });

  it('gives the browser a turn after a stretch of pages over the limit, not after every page', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    try {
      await eachPage([1, 2, 3, 4], 'drawing', {}, (n) => {
        // Pages 1 and 3 are slow; 2 and 4 are quick.
        clock += n % 2 === 1 ? YIELD_AFTER_MS + 1 : 1;
        return n;
      });
      // A yield after page 1 and after page 3; none after the last page.
      expect(timeouts).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('yields, then sees a cancellation that arrived during the turn', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const controller = new AbortController();
    try {
      const run = eachPage([1, 2], 'drawing', { signal: controller.signal }, (n) => {
        clock += YIELD_AFTER_MS + 1;
        return n;
      });
      // The first page is done and the loop is in its setTimeout(0) turn.
      await Promise.resolve();
      controller.abort();
      await expect(run).rejects.toBeInstanceOf(ExportCancelledError);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('cancellation', () => {
  it('throwIfCancelled throws only for an aborted signal, and isCancelled knows the error', () => {
    expect(() => {
      throwIfCancelled(undefined);
    }).not.toThrow();
    const c = new AbortController();
    expect(() => {
      throwIfCancelled(c.signal);
    }).not.toThrow();
    c.abort();
    expect(() => {
      throwIfCancelled(c.signal);
    }).toThrow(ExportCancelledError);
    expect(isCancelled(new ExportCancelledError())).toBe(true);
    expect(isCancelled(new Error('Cancelled'))).toBe(false);
    expect(new ExportCancelledError().name).toBe('ExportCancelledError');
  });
});
