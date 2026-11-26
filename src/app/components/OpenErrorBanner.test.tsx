// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { openPastedText, openText } from '../openFile';
import { editorStore } from '../state/editorStore';
import { OpenErrorBanner } from './OpenErrorBanner';

const LONG = `This is a very long explanation of why the file could not be opened. ${'More words. '.repeat(40)}`;

describe('OpenErrorBanner', () => {
  beforeEach(() => {
    act(() => {
      editorStore.dismissOpenError();
      editorStore.dismissError();
    });
  });

  it('shows nothing until a file fails to open', () => {
    const { container } = render(<OpenErrorBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the whole message as an alert, and leaves the status bar line alone', () => {
    render(<OpenErrorBanner />);
    act(() => {
      editorStore.failOpen(LONG);
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(LONG);
    expect(editorStore.getState().openError).toBe(LONG);
    expect(editorStore.getState().error).toBeNull();
    expect(editorStore.getState().errorCountdown).toBeNull();
  });

  it('does not show other errors', () => {
    const { container } = render(<OpenErrorBanner />);
    act(() => {
      editorStore.fail('Could not save locally.');
    });
    expect(container.firstChild).toBeNull();
    expect(editorStore.getState().error).toBe('Could not save locally.');
  });

  it('is dismissed by its button', () => {
    const { container } = render(<OpenErrorBanner />);
    act(() => {
      editorStore.failOpen('Nope.');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.firstChild).toBeNull();
    expect(editorStore.getState().openError).toBeNull();
  });

  it('is cleared by the next successful open', () => {
    const { container } = render(<OpenErrorBanner />);
    act(() => {
      editorStore.failOpen('Nope.');
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => {
      openText('>x\nACGTACGT\n', 'x.fa');
    });
    expect(container.firstChild).toBeNull();
  });

  it('is raised by a pasted text that is not a sequence', () => {
    render(<OpenErrorBanner />);
    act(() => {
      openPastedText('this is not a sequence 12345 !!');
    });
    expect(screen.getByRole('alert').textContent).toContain('Pasted text');
  });

  it('opens the guide at the supported formats', () => {
    render(<OpenErrorBanner />);
    act(() => {
      editorStore.failOpen('Nope.');
    });
    const opened: unknown[] = [];
    const listener = (e: Event): void => {
      opened.push((e as CustomEvent<unknown>).detail);
    };
    window.addEventListener('plasmidpop:open-guide', listener);
    fireEvent.click(screen.getByRole('button', { name: 'Supported formats' }));
    window.removeEventListener('plasmidpop:open-guide', listener);
    expect(opened).toEqual(['02-files#formats']);
  });
});

describe('OpenErrorBanner problem report', () => {
  const MARKER = 'SECRETMARKER-xyz';
  const real = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  beforeEach(() => {
    act(() => {
      editorStore.dismissOpenError();
    });
  });
  afterEach(() => {
    if (real === undefined) delete (navigator as { clipboard?: Clipboard }).clipboard;
    else Object.defineProperty(navigator, 'clipboard', real);
  });

  function failWithMarker(): void {
    act(() => {
      openText(`${MARKER}\nACGT\n`, `${MARKER}.gb`);
    });
  }

  it('does not render the mail link while the address is the placeholder', () => {
    render(<OpenErrorBanner />);
    failWithMarker();
    expect(screen.queryByRole('link', { name: 'Report this problem' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy report' })).toBeTruthy();
  });

  it('renders a mailto link for a real address, carrying no file content', () => {
    render(<OpenErrorBanner address="reports@example.org" />);
    failWithMarker();
    // The message itself, shown to the user, does quote the file.
    expect(screen.getByRole('alert').textContent).toContain(MARKER);
    const link = screen.getByRole('link', { name: 'Report this problem' });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('mailto:reports@example.org?subject=')).toBe(true);
    expect(href.length).toBeLessThan(1500);
    expect(href).not.toContain(MARKER);
    expect(decodeURIComponent(href)).not.toContain(MARKER);
    expect(decodeURIComponent(href)).toContain('Failure: unrecognised-format');
  });

  it('copies the same text as the mail body, and nothing from the file', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<OpenErrorBanner address="reports@example.org" />);
    failWithMarker();
    const href =
      screen.getByRole('link', { name: 'Report this problem' }).getAttribute('href') ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(copied).not.toContain(MARKER);
    expect(copied).not.toContain('ACGT');
    const body = decodeURIComponent(href.slice(href.indexOf('&body=') + 6)).replace(/\r\n/g, '\n');
    expect(body).toBe(copied);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
  });
});
