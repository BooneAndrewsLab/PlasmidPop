// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFileImport } from './useFileImport';

afterEach(cleanup);

const FILE = new File(['x'], 'a.txt');

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useFileImport', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useFileImport(() => Promise.resolve(1)));
    expect(result.current.busy).toBe(false);
    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('does nothing for no file', () => {
    const read = vi.fn(() => Promise.resolve(1));
    const { result } = renderHook(() => useFileImport(read));
    act(() => {
      result.current.take(undefined);
    });
    expect(read).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it('is busy while reading, then holds the summary', async () => {
    const d = defer<number>();
    const read = vi.fn(() => d.promise);
    const { result } = renderHook(() => useFileImport(read));
    act(() => {
      result.current.take(FILE);
    });
    expect(read).toHaveBeenCalledWith(FILE);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      d.resolve(7);
      await d.promise;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.summary).toBe(7);
    expect(result.current.error).toBeNull();
  });

  it('reports an Error by its message, and stops being busy', async () => {
    const d = defer<number>();
    const { result } = renderHook(() => useFileImport(() => d.promise));
    act(() => {
      result.current.take(FILE);
    });
    await act(async () => {
      d.reject(new Error('not a table'));
      await d.promise.catch(() => undefined);
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe('not a table');
    expect(result.current.summary).toBeNull();
  });

  it('stringifies a rejection that is not an Error', async () => {
    const d = defer<number>();
    const { result } = renderHook(() => useFileImport(() => d.promise));
    act(() => {
      result.current.take(FILE);
    });
    await act(async () => {
      d.reject('plain text');
      await d.promise.catch(() => undefined);
    });
    expect(result.current.error).toBe('plain text');
  });

  it('clears the previous summary and error when a new file is taken', async () => {
    const first = defer<number>();
    const second = defer<number>();
    const queue = [first, second];
    const { result } = renderHook(() =>
      useFileImport(() => {
        const next = queue.shift();
        if (next === undefined) throw new Error('no more reads');
        return next.promise;
      }),
    );
    act(() => {
      result.current.take(FILE);
    });
    await act(async () => {
      first.resolve(1);
      await first.promise;
    });
    expect(result.current.summary).toBe(1);
    act(() => {
      result.current.fail('boom');
    });
    expect(result.current.error).toBe('boom');
    act(() => {
      result.current.take(FILE);
    });
    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(true);
    await act(async () => {
      second.resolve(2);
      await second.promise;
    });
    expect(result.current.summary).toBe(2);
  });

  it('lets the caller set an error', () => {
    const { result } = renderHook(() => useFileImport(() => Promise.resolve(1)));
    act(() => {
      result.current.fail('Could not clear the imported table.');
    });
    expect(result.current.error).toBe('Could not clear the imported table.');
  });
});
