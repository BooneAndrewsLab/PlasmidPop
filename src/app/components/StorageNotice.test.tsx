// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { StorageNotice } from './StorageNotice';

describe('StorageNotice', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    act(() => {
      editorStore.dismissStorageNotice();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows nothing until the browser has a question to put', () => {
    const { container } = render(<StorageNotice />);
    expect(container.firstChild).toBeNull();
  });

  it('says where the documents are and that the browser may ask', () => {
    const { container } = render(<StorageNotice />);
    act(() => {
      editorStore.noteStoragePrompt();
    });
    expect(container.textContent).toContain('this browser');
    expect(container.textContent).toContain('nothing is uploaded');
    expect(container.textContent).toContain('may ask you to confirm');
  });

  it('asks from the button, remembers the choice and goes away when the browser agrees', async () => {
    const keep = vi.spyOn(persistence, 'keepStorage').mockResolvedValue(true);
    const { container } = render(<StorageNotice />);
    act(() => {
      editorStore.noteStoragePrompt();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep my documents' }));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(globalThis.localStorage.getItem('plasmidpop.storageChoice')).toBe('keep');
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(editorStore.getState().storageNotice).toBe(false);
  });

  it('reports a refusal instead of pretending the documents are kept', async () => {
    vi.spyOn(persistence, 'keepStorage').mockResolvedValue(false);
    const { container } = render(<StorageNotice />);
    act(() => {
      editorStore.noteStoragePrompt();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep my documents' }));
    await waitFor(() => {
      expect(container.textContent).toContain('did not agree');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(container.firstChild).toBeNull();
  });

  it('remembers a no, so the browser is never asked behind the user', () => {
    const keep = vi.spyOn(persistence, 'keepStorage');
    const { container } = render(<StorageNotice />);
    act(() => {
      editorStore.noteStoragePrompt();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(container.firstChild).toBeNull();
    expect(keep).not.toHaveBeenCalled();
    expect(globalThis.localStorage.getItem('plasmidpop.storageChoice')).toBe('no');
  });

  it('opens the guide at local storage', () => {
    render(<StorageNotice />);
    act(() => {
      editorStore.noteStoragePrompt();
    });
    const opened: unknown[] = [];
    const listener = (e: Event): void => {
      opened.push((e as CustomEvent<unknown>).detail);
    };
    window.addEventListener('plasmidpop:open-guide', listener);
    fireEvent.click(screen.getByRole('button', { name: 'What this means' }));
    window.removeEventListener('plasmidpop:open-guide', listener);
    expect(opened).toEqual(['02-files#local-storage-and-recent-files']);
  });
});
