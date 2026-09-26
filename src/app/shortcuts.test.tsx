// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getRepository } from '@/storage';

import { App } from './App';
import { editorStore } from './state/editorStore';

function alt(code: string): void {
  fireEvent.keyDown(window, { code, altKey: true });
}

beforeEach(() => {
  getRepository().setLastDocumentId(null);
  getRepository().setOpenDocumentIds([]);
  localStorage.removeItem('plasmidpop.viewPrefs');
  act(() => {
    editorStore.closeAllDocuments();
    editorStore.setSidebarOpen(true);
    editorStore.setShowComplement(true);
    editorStore.setShowCutSites(true);
    editorStore.setEditsBaseline('opened');
  });
});

describe('view shortcuts', () => {
  it('toggles the three view switches, the marks and the sidebar', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));

    alt('KeyC');
    expect(editorStore.getState().showComplement).toBe(false);
    alt('KeyC');
    expect(editorStore.getState().showComplement).toBe(true);

    alt('KeyR');
    expect(editorStore.getState().showCutSites).toBe(false);

    alt('KeyS');
    expect(editorStore.getState().sidebarOpen).toBe(false);
    alt('KeyS');
    expect(editorStore.getState().sidebarOpen).toBe(true);
  });

  it('works with the keyboard in the sequence view, and not in a text field', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    // Alt types no base, so the view the work is done in is where the Alt
    // bindings have to work. Until 1.5 they stood down there.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sequence' }), {
      code: 'KeyC',
      altKey: true,
    });
    expect(editorStore.getState().showComplement).toBe(false);
    // A field takes its keys: Alt there can type a character.
    act(() => {
      editorStore.setFindOpen(true);
    });
    fireEvent.keyDown(screen.getByLabelText('Find'), {
      code: 'KeyC',
      altKey: true,
    });
    expect(editorStore.getState().showComplement).toBe(false);
    act(() => {
      editorStore.setFindOpen(false);
    });
  });

  it('turns the edit marks off and brings back the baseline that was chosen', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      editorStore.setEditsBaseline('saved');
    });
    alt('KeyE');
    expect(editorStore.getState().editsBaseline).toBe('off');
    alt('KeyE');
    expect(editorStore.getState().editsBaseline).toBe('saved');
  });

  it('steps from one marked change to the next and back, going round', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    // Nothing marked yet: the keys do nothing, and the menu items are off.
    act(() => {
      editorStore.setSelection({ start: 5, end: 5 });
    });
    alt('KeyN');
    expect(editorStore.getState().selection).toEqual({ start: 5, end: 5 });
    fireEvent.click(screen.getByRole('button', { name: /^Edits/ }));
    expect(screen.getByRole('menuitem', { name: /Next change/ })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: /^Edits/ }));

    act(() => {
      editorStore.apply({ type: 'replace', range: { start: 100, end: 102 }, text: 'NN' });
      editorStore.apply({ type: 'delete', range: { start: 300, end: 305 } });
      editorStore.setSelection({ start: 0, end: 0 });
    });
    const reveal = editorStore.getState().reveal?.nonce ?? 0;
    alt('KeyN');
    expect(editorStore.getState().selection).toEqual({ start: 100, end: 102 });
    expect(editorStore.getState().reveal).toEqual({ position: 100, nonce: reveal + 1 });
    alt('KeyN');
    expect(editorStore.getState().selection).toEqual({ start: 300, end: 300 });
    alt('KeyN');
    expect(editorStore.getState().selection).toEqual({ start: 100, end: 102 });
    fireEvent.keyDown(window, { code: 'KeyN', altKey: true, shiftKey: true });
    expect(editorStore.getState().selection).toEqual({ start: 300, end: 300 });

    // The menu does the same.
    fireEvent.click(screen.getByRole('button', { name: /^Edits/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Previous change/ }));
    expect(editorStore.getState().selection).toEqual({ start: 100, end: 102 });
  });

  it('brings a comparison marked in the views back with Alt+E', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const doc = editorStore.document;
    if (doc === null) throw new Error('expected a document');
    act(() => {
      editorStore.markComparedInViews('theirs.gb', doc.delete({ start: 10, end: 20 }));
    });
    alt('KeyE');
    expect(editorStore.getState().editsBaseline).toBe('off');
    alt('KeyE');
    expect(editorStore.getState().editsBaseline).toBe('compared');
  });

  it('steps through the views, the sidebar tabs and the text sizes, and brings up the Bench', () => {
    act(() => {
      editorStore.setView('both');
      editorStore.setSeqFontSize(13);
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      editorStore.setSidebarTab('features');
    });

    alt('KeyV');
    expect(editorStore.getState().view).toBe('sequence');
    alt('KeyV');
    alt('KeyV');
    expect(editorStore.getState().view).toBe('both');

    alt('BracketRight');
    expect(editorStore.getState().sidebarTab).toBe('orfs');
    alt('BracketLeft');
    alt('BracketLeft'); // round the top of the rail to its foot
    expect(editorStore.getState().sidebarTab).toBe('history');
    // Put away, the sidebar comes back on the tab it was on.
    alt('KeyS');
    alt('BracketRight');
    expect(editorStore.getState()).toMatchObject({ sidebarOpen: true, sidebarTab: 'history' });

    alt('Equal');
    expect(editorStore.getState().seqFontSize).toBe(16);
    alt('Equal'); // already the largest
    expect(editorStore.getState().seqFontSize).toBe(16);
    alt('Minus');
    alt('Minus');
    expect(editorStore.getState().seqFontSize).toBe(11);

    alt('Digit0');
    expect(editorStore.getState().front).toBe('bench');
    act(() => {
      editorStore.setSeqFontSize(13);
    });
  });

  it('asks for a file to compare with on Alt+K, and not with nothing open', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(<App />);
    alt('KeyK');
    await Promise.resolve();
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    alt('KeyK');
    await waitFor(() => {
      expect(click).toHaveBeenCalledTimes(1);
    });
    click.mockRestore();
  });

  it('walks the sidebar rail with the arrow keys, as one Tab stop', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      editorStore.setSidebarTab('features');
    });
    const rail = screen.getByRole('tablist', { name: 'Sidebar' });
    const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });
    // Only the open tab is in the Tab order.
    expect(tab('Features')).toHaveAttribute('tabindex', '0');
    expect(tab('ORFs')).toHaveAttribute('tabindex', '-1');
    tab('Features').focus();
    fireEvent.keyDown(rail, { key: 'ArrowDown' });
    expect(editorStore.getState().sidebarTab).toBe('orfs');
    expect(tab('ORFs')).toHaveFocus();
    fireEvent.keyDown(rail, { key: 'End' });
    expect(tab('History')).toHaveFocus();
    fireEvent.keyDown(rail, { key: 'ArrowDown' }); // round to the top
    expect(editorStore.getState().sidebarTab).toBe('features');
    fireEvent.keyDown(rail, { key: 'ArrowUp' });
    expect(editorStore.getState().sidebarTab).toBe('history');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'sidebar-tab-history');
  });

  it('opens the Format menu on its first item with Alt+O', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    alt('KeyO');
    const menu = screen.getByRole('menu', { name: 'Format and layout' });
    expect(menu.querySelector('button')).toHaveFocus();
    alt('KeyO');
    expect(screen.queryByRole('menu', { name: 'Format and layout' })).toBeNull();
  });

  it('brings the nth document forward', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const first = editorStore.getState().documentId;
    act(() => {
      editorStore.newDocument();
    });
    const second = editorStore.getState().documentId;
    expect(second).not.toBe(first);

    alt('Digit1');
    expect(editorStore.getState().documentId).toBe(first);
    alt('Digit2');
    expect(editorStore.getState().documentId).toBe(second);
    // Nothing happens where there is no such tab.
    alt('Digit9');
    expect(editorStore.getState().documentId).toBe(second);
  });

  it('leaves a shortcut alone while text is being typed into a field', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const find = screen.getByRole('searchbox', { name: 'Find' });
    fireEvent.keyDown(find, { code: 'KeyC', altKey: true });
    expect(editorStore.getState().showComplement).toBe(true);
  });
});

describe('selecting by codon', () => {
  it('takes the caret’s codon, then one more for each press', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    // pBR322's tet CDS runs 86..1276 (1-based), so 0-based 85..1276 with
    // codons starting at 85. Position 100 is in the sixth codon, 100..102.
    act(() => {
      editorStore.setSelection({ start: 100, end: 100 });
    });
    const view = document.querySelector('.seq-view');
    if (view === null) throw new Error('no sequence view');

    fireEvent.keyDown(view, {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      shiftKey: true,
    });
    const first = editorStore.getState().selection;
    expect(first).toEqual({ start: 100, end: 103 });

    fireEvent.keyDown(view, {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(editorStore.getState().selection).toEqual({ start: 100, end: 106 });

    // A plain arrow goes back to one base at a time and ends the run.
    fireEvent.keyDown(view, { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
    expect(editorStore.getState().selection?.end).toBe(107);
  });

  it('does nothing where the caret is in no coding feature', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      // Before the first CDS of pBR322.
      editorStore.setSelection({ start: 10, end: 10 });
    });
    const view = document.querySelector('.seq-view');
    if (view === null) throw new Error('no sequence view');
    fireEvent.keyDown(view, {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      shiftKey: true,
    });
    // Falls through to the plain Ctrl+arrow, which moves nothing.
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
  });
});

describe('a rebound key (#79)', () => {
  afterEach(() => {
    act(() => {
      editorStore.resetKeyBindings();
    });
  });

  it('answers on the new key and no longer on the old one', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const open = (): boolean => editorStore.getState().sidebarOpen;
    expect(open()).toBe(true);
    act(() => {
      editorStore.setKeyBinding('toggle-sidebar', 'alt+KeyG');
    });
    alt('KeyS');
    expect(open(), 'the old key does nothing').toBe(true);
    alt('KeyG');
    expect(open()).toBe(false);
    alt('KeyG');
    expect(open()).toBe(true);
    // And the tooltip says the key it is on now.
    expect(screen.getAllByTitle(/Hide the panel \(Alt\+G\)/).length).toBeGreaterThan(0);
  });

  it('leaves the action whose key was taken without one, rather than firing both', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      editorStore.setShowComplement(true);
      editorStore.setSidebarOpen(true);
      // The sidebar moves onto the complement's key.
      editorStore.setKeyBinding('toggle-sidebar', 'alt+KeyC');
    });
    alt('KeyC');
    expect(editorStore.getState().sidebarOpen).toBe(false);
    expect(editorStore.getState().showComplement, 'the complement kept its state').toBe(true);
  });
});
