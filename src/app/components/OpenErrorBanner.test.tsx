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
