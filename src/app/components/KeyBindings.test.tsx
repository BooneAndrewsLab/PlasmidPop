// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { KeyBindings, KeyBindingsDialog } from './KeyBindings';

const doc = SeqDocument.create({ name: 'pTest', sequence: 'ACGT'.repeat(50) });

describe('changing a key binding (#79)', () => {
  beforeEach(() => {
    act(() => {
      editorStore.resetKeyBindings();
    });
  });

  afterEach(() => {
    act(() => {
      editorStore.resetKeyBindings();
      editorStore.showKeysDialog(false);
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  /** The row of the list for an action, by the label it is listed under. */
  function row(label: string): HTMLElement {
    const item = screen.getByText(label, { selector: '.keybindings__label' }).closest('li');
    if (item === null) throw new Error(`no row for ${label}`);
    return item;
  }

  it('lists every group, with the key each action is on', () => {
    render(<KeyBindings />);
    expect(screen.getByRole('list', { name: 'View shortcuts' })).toBeInTheDocument();
    expect(within(row('Complement')).getByText('Alt+C')).toBeInTheDocument();
    expect(within(row('The Bench')).getByText('Alt+0')).toBeInTheDocument();
    // A fixed key is listed, and says it cannot be changed.
    const fixed = row('Undo and redo');
    expect(within(fixed).getByText('Ctrl+Z')).toBeInTheDocument();
    expect(within(fixed).getByText('fixed')).toBeInTheDocument();
    expect(within(fixed).queryByRole('button', { name: /Change the key/ })).toBeNull();
  });

  it('takes a new key, and puts it back on its default', () => {
    render(<KeyBindings />);
    fireEvent.click(
      within(row('The sidebar, away and back')).getByRole('button', { name: /Change the key/ }),
    );
    expect(within(row('The sidebar, away and back')).getByText('Press a key…')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyG', key: 'g', altKey: true });
    });
    expect(editorStore.getState().keyBindings).toEqual({ 'toggle-sidebar': 'alt+KeyG' });
    expect(within(row('The sidebar, away and back')).getByText('Alt+G')).toBeInTheDocument();

    fireEvent.click(
      within(row('The sidebar, away and back')).getByRole('button', { name: /Put .* back on/ }),
    );
    expect(editorStore.getState().keyBindings).toEqual({});
  });

  it('refuses a key with no modifier, one the browser keeps, and one already taken', () => {
    render(<KeyBindings />);
    const change = (): void => {
      fireEvent.click(
        within(row('The sidebar, away and back')).getByRole('button', { name: /Change the key/ }),
      );
    };
    change();
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyG', key: 'g' });
    });
    // The intro says the same thing, so the warning is looked for by its class.
    const warning = (): string => document.querySelector('.panel__note--warn')?.textContent ?? '';
    expect(warning()).toMatch(/needs Alt or Ctrl/);
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });
    });
    expect(warning()).toMatch(/belongs to the browser/);
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyC', key: 'c', altKey: true });
    });
    expect(warning()).toMatch(/already complement/);
    // None of them was taken, and it is still listening.
    expect(editorStore.getState().keyBindings).toEqual({});
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyG', key: 'g', altKey: true });
    });
    expect(editorStore.getState().keyBindings).toEqual({ 'toggle-sidebar': 'alt+KeyG' });
  });

  it('leaves the binding alone on Escape, and puts them all back', () => {
    render(<KeyBindings />);
    fireEvent.click(
      within(row('The sidebar, away and back')).getByRole('button', { name: /Change the key/ }),
    );
    act(() => {
      fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
    });
    expect(editorStore.getState().keyBindings).toEqual({});
    expect(screen.queryByText('Press a key…')).toBeNull();

    act(() => {
      editorStore.setKeyBinding('toggle-sidebar', 'alt+KeyG');
      editorStore.setKeyBinding('close-tab', 'alt+KeyX');
    });
    fireEvent.click(screen.getByRole('button', { name: 'All back to their defaults' }));
    expect(editorStore.getState().keyBindings).toEqual({});
  });

  it('opens as a dialog, and the new key works in the app', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.showKeysDialog(true);
    });
    render(<KeyBindingsDialog />);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    fireEvent.click(
      within(row('The sidebar, away and back')).getByRole('button', { name: /Change the key/ }),
    );
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyG', key: 'g', altKey: true });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(editorStore.getState().keysDialog).toBe(false);
    expect(editorStore.getState().keyBindings['toggle-sidebar']).toBe('alt+KeyG');
  });
});
