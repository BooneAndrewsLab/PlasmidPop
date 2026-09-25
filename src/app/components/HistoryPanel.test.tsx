// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { History, SeqDocument, createFeature, rangeSegment } from '@/core';

import { editsBaselineLabel } from '../editsView';
import { changeStopsOf, goToChange } from '../state/editDiff';
import { editorStore, editsBaselineDocument } from '../state/editorStore';
import { HistoryPanel } from './HistoryPanel';

const plasmid = SeqDocument.create({
  name: 'pHist',
  sequence: 'ACGTTGCAAG'.repeat(20),
  topology: 'circular',
  features: [
    createFeature({ id: 'f', type: 'gene', name: 'lacZ', segments: [rangeSegment(50, 80)] }),
  ],
});

/** A document with three steps: insert five bases, add a feature, delete three. */
function setup(): void {
  act(() => {
    editorStore.closeAllDocuments();
    editorStore.openDocument(plasmid);
    editorStore.apply({ type: 'insert', position: 10, text: 'TTTTT' });
    editorStore.apply({
      type: 'addFeature',
      feature: createFeature({
        id: 'g',
        type: 'misc_feature',
        name: 'new',
        segments: [rangeSegment(100, 120)],
      }),
    });
    editorStore.apply({ type: 'delete', range: { start: 150, end: 153 } });
  });
}

function history() {
  const h = editorStore.getState().history;
  if (h === null) throw new Error('no history');
  return h;
}

/** Opens a row's "⋯" menu and picks `item` from it. */
function pick(step: string, item: string): void {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${step}` }));
  const menu = screen.getByRole('menu', { name: `Actions for ${step}` });
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }));
}

describe('HistoryPanel naming (#4)', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
    });
  });

  it('names a state from its menu, shows the name, and Enter saves it', () => {
    setup();
    const { container } = render(<HistoryPanel />);
    pick('step 2', 'Name…');
    const input = screen.getByRole('textbox', { name: 'Name for step 2' });
    fireEvent.change(input, { target: { value: '  Before the cut ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(history().steps[1]?.name).toBe('Before the cut');
    expect(container.querySelector('.history-panel__name')?.textContent).toBe('Before the cut');
    // Not an undo step: the count and the position are as they were.
    expect(history().size).toBe(3);
    expect(history().position).toBe(3);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('cancels on Escape, and an emptied name clears it', () => {
    setup();
    act(() => {
      editorStore.nameHistoryState(1, 'Five Ts');
    });
    render(<HistoryPanel />);
    pick('step 1', 'Rename…');
    let input = screen.getByRole('textbox', { name: 'Name for step 1' });
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(history().steps[0]?.name).toBe('Five Ts');

    pick('step 1', 'Rename…');
    input = screen.getByRole('textbox', { name: 'Name for step 1' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(history().steps[0]?.name).toBeUndefined();

    act(() => {
      editorStore.nameHistoryState(1, 'Again');
    });
    pick('step 1', 'Clear name');
    expect(history().steps[0]?.name).toBeUndefined();
  });

  it('does not offer to name the starting state, which is not a step', () => {
    setup();
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for New document' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Name…' })).toBeNull();
    expect(
      within(menu).getByRole('menuitem', { name: 'What changed' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('lists only the named states when asked', () => {
    setup();
    const { container } = render(<HistoryPanel />);
    // Nothing to filter by until something is named.
    expect(screen.queryByRole('button', { name: 'Named only' })).toBeNull();
    act(() => {
      editorStore.nameHistoryState(2, 'With the feature');
    });
    const toggle = screen.getByRole('button', { name: 'Named only' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const rows = container.querySelectorAll('.history-panel__item');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('With the feature');
    fireEvent.click(toggle);
    expect(container.querySelectorAll('.history-panel__item')).toHaveLength(4);
  });

  it('seals the named step, so typing on is a step of its own', () => {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(plasmid);
    });
    const typeAt = (at: number): void => {
      editorStore.apply({ type: 'insert', position: at, text: 'A' }, undefined, undefined, {
        follows: `type@${at}`,
        key: `type@${at + 1}`,
      });
    };
    act(() => {
      typeAt(5);
      typeAt(6);
    });
    expect(history().size).toBe(1);
    act(() => {
      editorStore.nameHistoryState(1, 'Two As');
      typeAt(7);
    });
    expect(history().size).toBe(2);
    expect(history().steps[0]?.name).toBe('Two As');
    expect(history().stateAt(1)?.length).toBe(plasmid.length + 2);
  });
});

describe('HistoryPanel: what a step changed (#4)', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
    });
  });

  it('opens the review of that one step, and Close or Escape puts it away', () => {
    setup();
    const before = history().present;
    render(<HistoryPanel />);
    pick('step 1', 'What changed');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe(
      'What step 1 changed',
    );
    expect(dialog.querySelector('.save-review__summary')?.textContent).toBe('+5 bp');
    expect(dialog.querySelector('.diff-strip__label')?.textContent).toBe('around 11 inserted 5 bp');
    // Looking changes nothing.
    expect(history().present).toBe(before);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    pick('step 2', 'What changed');
    expect(screen.getByRole('dialog').textContent).toContain('+ new 101..120');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the step by its name when it has one', () => {
    setup();
    act(() => {
      editorStore.nameHistoryState(3, 'Trimmed');
    });
    render(<HistoryPanel />);
    pick('step 3', 'What changed');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'What “Trimmed”, step 3, changed',
    );
    expect(screen.getByRole('dialog').querySelector('.save-review__summary')?.textContent).toBe(
      '−3 bp',
    );
  });
});

describe('HistoryPanel: mark changes since a state (#4)', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
    });
  });

  it('makes that state the edit marks’ baseline, named after it', () => {
    setup();
    render(<HistoryPanel />);
    pick('step 1', 'Mark changes since this');
    const state = editorStore.getState();
    expect(state.editsBaseline).toBe('compared');
    expect(state.compared?.name).toBe('step 1');
    expect(editsBaselineDocument(state)).toBe(history().stateAt(1));
    expect(editsBaselineLabel('compared', state.compared?.name ?? null)).toBe(
      'Compared with step 1',
    );
    // What changed since step 1: the feature added and the three bases deleted.
    const stops = changeStopsOf(state);
    expect(stops.length).toBeGreaterThan(0);
    act(() => {
      editorStore.setSelection({ start: 0, end: 0 });
      expect(goToChange(1)).toBe(true);
    });
    expect(editorStore.getState().selection).toEqual(stops[0]);
  });

  it('uses the name of a named state, and of the start row', () => {
    setup();
    act(() => {
      editorStore.nameHistoryState(2, 'Annotated');
    });
    render(<HistoryPanel />);
    pick('step 2', 'Mark changes since this');
    expect(editorStore.getState().compared?.name).toBe('Annotated');
    pick('New document', 'Mark changes since this');
    expect(editorStore.getState().compared?.name).toBe('the new document');
    expect(editsBaselineDocument(editorStore.getState())).toBe(history().stateAt(0));
  });
});

describe('HistoryPanel: named states the limit dropped (#4)', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
    });
  });

  it('lists them below the steps, and brings one back as a change of its own', () => {
    // A history with a limit of three, so a few more steps push the named one out.
    let h = History.create(plasmid, { limit: 3 }).push(plasmid.insert(0, 'GG'), 'Insert 2 bases');
    h = h.named(1, 'Two Gs');
    for (let i = 0; i < 3; i++) h = h.push(h.present.insert(0, 'A'), 'Insert 1 base');
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(h.present, null, [], {
        history: { history: h, opened: plasmid, saved: null },
      });
    });
    expect(history().kept.map((k) => k.name)).toEqual(['Two Gs']);
    const { container } = render(<HistoryPanel />);
    const kept = screen.getByRole('list', { name: 'Named states kept' });
    expect(within(kept).getByText('Two Gs')).toBeTruthy();

    const item = kept.querySelector('.history-panel__item');
    if (item === null) throw new Error('no kept row');
    fireEvent.click(item);
    expect(editorStore.document?.length).toBe(plasmid.length + 2);
    expect(history().undoLabel).toBe('Back to “Two Gs”');
    // It is the present now, and marked as such below the list.
    expect(container.querySelector('[aria-label="Named states kept"] [aria-current]')).toBeTruthy();
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.length).toBe(plasmid.length + 5);

    pick('“Two Gs”', 'Mark changes since this');
    expect(editorStore.getState().compared?.name).toBe('Two Gs');
    pick('“Two Gs”', 'Forget');
    expect(history().kept).toEqual([]);
    expect(screen.queryByRole('list', { name: 'Named states kept' })).toBeNull();
  });
});
