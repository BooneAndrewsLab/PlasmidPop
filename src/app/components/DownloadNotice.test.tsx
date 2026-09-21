// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { editorStore } from '../state/editorStore';
import { DownloadNotice } from './DownloadNotice';

describe('DownloadNotice', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    act(() => {
      editorStore.dismissDownloadNotice();
    });
  });

  it('shows nothing until a save has gone out as a download', () => {
    const { container } = render(<DownloadNotice />);
    expect(container.firstChild).toBeNull();
  });

  it('names the downloaded file and says another save will not replace it', () => {
    const { container } = render(<DownloadNotice />);
    act(() => {
      editorStore.noteDownload('pBR322_copy.gb');
    });
    expect(container.textContent).toContain('pBR322_copy.gb');
    expect(container.textContent).toContain('rather than replacing it');
  });

  it('opens the guide at the files page', () => {
    render(<DownloadNotice />);
    act(() => {
      editorStore.noteDownload('pBR322_copy.gb');
    });
    const opened: unknown[] = [];
    const listener = (e: Event): void => {
      opened.push((e as CustomEvent<unknown>).detail);
    };
    window.addEventListener('plasmidpop:open-guide', listener);
    fireEvent.click(screen.getByRole('button', { name: 'How to keep one file' }));
    window.removeEventListener('plasmidpop:open-guide', listener);
    expect(opened).toEqual(['02-files#downloading-in-firefox-and-safari']);
  });

  it('stays away once it has been read, in this session and the next', () => {
    const first = render(<DownloadNotice />);
    act(() => {
      editorStore.noteDownload('pBR322_copy.gb');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(first.container.firstChild).toBeNull();
    expect(editorStore.getState().downloadNotice).toBeNull();

    // A later save, and a later visit: the notice has been read.
    act(() => {
      editorStore.noteDownload('pBR322_copy.gb');
    });
    expect(first.container.firstChild).toBeNull();
    const next = render(<DownloadNotice />);
    expect(next.container.firstChild).toBeNull();
  });
});
