// @vitest-environment jsdom
import { copyText } from './clipboard';

/** Replaces navigator.clipboard for one test; undefined means "not a secure context". */
function withClipboard(value: Clipboard | undefined, run: () => void): void {
  const real = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
  try {
    run();
  } finally {
    if (real === undefined) delete (navigator as { clipboard?: Clipboard }).clipboard;
    else Object.defineProperty(navigator, 'clipboard', real);
  }
}

describe('copyText', () => {
  it('uses the async clipboard when there is one', () => {
    const writeText = vi.fn(() => Promise.resolve());
    withClipboard({ writeText } as unknown as Clipboard, () => {
      copyText('MKV*');
    });
    expect(writeText).toHaveBeenCalledWith('MKV*');
  });

  it('copies through a temporary textarea without one, as on a plain http origin', () => {
    let copied: string | null = null;
    const execCommand = vi.fn((command: string) => {
      copied = command === 'copy' ? (document.querySelector('textarea')?.value ?? null) : null;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    withClipboard(undefined, () => {
      copyText('MKV*');
    });
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(copied).toBe('MKV*');
    // The textarea is cleaned up again.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back to the textarea when the async write is refused', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    withClipboard({ writeText } as unknown as Clipboard, () => {
      copyText('MKV*');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('does nothing at all where neither exists', () => {
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
    withClipboard(undefined, () => {
      expect(() => {
        copyText('MKV*');
      }).not.toThrow();
    });
    expect(document.querySelector('textarea')).toBeNull();
  });
});
