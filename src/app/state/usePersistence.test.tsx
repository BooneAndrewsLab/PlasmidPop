// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';

import { persistence } from './persistence';
import { useRestoreSession } from './usePersistence';

function Probe(): React.JSX.Element {
  return <span>{useRestoreSession() ? 'opening' : 'ready'}</span>;
}

describe('useRestoreSession (#101)', () => {
  it('sets no state once the app it belongs to is gone', async () => {
    // A restore still in flight when the app goes: reading storage takes a
    // moment and cannot be called off. In a test the environment goes with
    // the app, so a state update after it reaches a window that no longer
    // exists — which is how this failed a release deploy.
    let finish = (): void => undefined;
    const held = new Promise<boolean>((resolve) => {
      finish = () => {
        resolve(false);
      };
    });
    vi.spyOn(persistence, 'restoreEnzymeSet').mockResolvedValue();
    vi.spyOn(persistence, 'restoreFidelityTable').mockResolvedValue();
    vi.spyOn(persistence, 'restoreLastSession').mockReturnValue(held);
    const view = render(<Probe />);
    view.unmount();

    // Nothing awaits the restore, so an attempt to set state after the app
    // has gone surfaces as an unhandled rejection — and fails the run.
    const loose: unknown[] = [];
    const collect = (reason: unknown): void => {
      loose.push(reason);
    };
    process.on('unhandledRejection', collect);
    const saved: unknown = Reflect.get(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'window');
    try {
      finish();
      await held;
      // The restore has a few awaits left after this one, and the `finally`
      // comes after all of them: give the queue a turn of the event loop.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      Reflect.set(globalThis, 'window', saved);
      process.off('unhandledRejection', collect);
      vi.restoreAllMocks();
    }
    expect(loose).toEqual([]);
  });

  it('removes unkept documents past their time once the session is back, and only then (item 110)', async () => {
    const order: string[] = [];
    vi.spyOn(persistence, 'restoreEnzymeSet').mockResolvedValue();
    vi.spyOn(persistence, 'restoreFidelityTable').mockResolvedValue();
    vi.spyOn(persistence, 'restoreLastSession').mockImplementation(() => {
      order.push('restore');
      return Promise.resolve(false);
    });
    vi.spyOn(persistence, 'pruneScratch').mockImplementation(() => {
      order.push('prune');
      return Promise.resolve(0);
    });
    const view = render(<Probe />);
    await waitFor(() => {
      expect(order).toContain('prune');
    });
    // Each removal comes after a restore, never before the tabs are back.
    order.forEach((step, i) => {
      if (step === 'prune') expect(order[i - 1]).toBe('restore');
    });
    view.unmount();
    vi.restoreAllMocks();
  });
});
