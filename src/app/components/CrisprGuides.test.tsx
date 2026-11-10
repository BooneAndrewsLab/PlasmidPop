// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument, reverseComplement } from '@/core';
import { AnalysisWorkerError, analysisClient } from '@/workers/analysisClient';

import { type CrisprSession, forgetCrisprSessions, updateCrisprSession } from '../crisprSession';
import { openCrisprWorkspace } from '../crisprWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { CrisprPanel } from './CrisprPanel';
import { CrisprWorkspace } from './CrisprWorkspace';
import { SLOW_RUN_MS } from './useMultipleAlignment';
import { getByTip } from '@/test/tips';

/** One SpCas9 site: 20 A's and a TGG PAM, then filler with no GG or CC. */
const UNIT = `${'A'.repeat(20)}TGG`;
const FILLER = 'CTCTCTCTCT';

function docOf(sequence: string, topology: 'linear' | 'circular' = 'linear'): SeqDocument {
  return SeqDocument.create({ sequence, topology, name: 'test' });
}

/** As the app mounts it: the document in front is the store's, so an edit is seen. */
function Host({ doc }: { doc: SeqDocument }) {
  const { workspace, history } = useEditorState();
  const current = history?.present ?? doc;
  return workspace === 'crispr' ? <CrisprWorkspace doc={current} /> : <CrisprPanel doc={current} />;
}

/** Opens the document with the workspace on Guides, flagged guides listed, and waits for the scan. */
async function openGuides(doc: SeqDocument, session: Partial<CrisprSession> = {}) {
  act(() => {
    editorStore.openDocument(doc);
    const { documentId } = editorStore.getState();
    updateCrisprSession(documentId, { showFlagged: true, ...session });
    openCrisprWorkspace(documentId, 'guides');
  });
  const view = render(<Host doc={doc} />);
  await waitFor(() => {
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
  });
  return view;
}

const grid = (): HTMLElement => screen.getByRole('grid', { name: 'Guides' });
const rowEls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('tr[data-row]')];
const rowAt = (i: number): HTMLElement => {
  const row = rowEls()[i];
  if (row === undefined) throw new Error(`no row ${String(i)}`);
  return row;
};
const cells = (r: HTMLElement | undefined): (string | null)[] =>
  [...(r?.querySelectorAll('td') ?? [])].map((c) => c.textContent);
/** The Position column of every drawn row: where the list is in order. */
const positions = (): string[] => rowEls().map((r) => cells(r)[2] ?? '');
const heads = (): (string | null)[] =>
  [...grid().querySelectorAll('thead th')].map((h) => h.textContent);

/** A scroller jsdom lays out: a height, and a `scrollTop` that holds what it is given. */
function stubScroller(height = 400): HTMLElement {
  const el = document.querySelector<HTMLElement>('.crispr-ws__scroll');
  if (el === null) throw new Error('no scroller');
  let top = 0;
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
  return el;
}

/** Three guides with plain, distinct spacers (no GG or CC to make others): unflagged, at 1, 34 and 67. */
const PLAIN = ['ACGTACGTACGTACGTACGT', 'GATCGATCGATCGATCGATC', 'CAGCTAGCTAGCATCGATCG'] as const;
function plain(): SeqDocument {
  return docOf(PLAIN.map((p, i) => `${p}${['TGG', 'AGG', 'CGG'][i] ?? 'TGG'}`).join(FILLER));
}

afterEach(() => {
  cleanup();
  forgetCrisprSessions();
  forgetPanels();
  vi.restoreAllMocks();
  vi.useRealTimers();
  act(() => {
    while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
  });
});

describe('the Guides page (item 133, C4)', () => {
  it('has the settings row, the filter bar and the table, in that order', async () => {
    await openGuides(plain());
    const settings = screen.getByRole('group', { name: 'Settings' });
    expect(within(settings).getByLabelText('Nuclease')).toBeInTheDocument();
    expect(within(settings).getByLabelText('Off-targets up to')).toBeInTheDocument();
    expect(within(settings).getByLabelText(/other open documents/)).toBeInTheDocument();
    expect(within(settings).getByLabelText('Only cuts in the selection')).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: 'Filters' });
    expect(within(filters).getByLabelText('Spacer contains')).toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: 'Show flagged' })).toBeInTheDocument();
    // The PAMs found, one to keep.
    expect(
      [...within(filters).getByLabelText('PAM').querySelectorAll('option')].map(
        (o) => o.textContent,
      ),
    ).toEqual(['any', 'AGG', 'CGG', 'TGG']);
    // Settings above the filters above the table.
    const order = [settings, filters, grid()];
    for (const [a, b] of [
      [order[0], order[1]],
      [order[1], order[2]],
    ]) {
      expect(a?.compareDocumentPosition(b as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(grid()).toHaveClass('wst', 'dt');
  });

  it('draws a column for each of the counts, the specificity, and the base editor’s edits', async () => {
    await openGuides(plain(), { maxMismatches: 2 });
    // SpCas9 NGG 20 nt scores specificity; no editor is chosen, so no edits.
    expect(heads()).toEqual([
      '#',
      '',
      'Position▲',
      'Spacer',
      'PAM',
      'GC',
      'Exact',
      '1 mm',
      '2 mm',
      'Spec.',
      '',
    ]);
    const first = rowEls()[0];
    expect(cells(first)).toEqual([
      '1',
      '→',
      '1–20',
      PLAIN[0],
      'TGG',
      '50%',
      '0',
      '0',
      '0',
      '100',
      '',
    ]);

    fireEvent.change(screen.getByLabelText('Base editor'), { target: { value: 'cbe' } });
    expect(heads().slice(-3)).toEqual(['Spec.', 'C→T', '']);
    expect(getByTip(document.body, /^CBE .*: how many C to T edits/)).toBeInTheDocument();
    // The edits column is the window's C's, positions 4-8 of each spacer.
    expect(rowEls().map((r) => cells(r).at(-2))).toEqual(['1', '2', '2']);
  });

  it('has a column for each mismatch counted, and none for specificity on other nucleases', async () => {
    await openGuides(docOf(`${plain().sequence.toString()}${FILLER}TTTA${'ACGT'.repeat(5)}ACG`), {
      maxMismatches: 0,
    });
    expect(heads()).toContain('Exact');
    expect(heads()).not.toContain('1 mm');
    fireEvent.change(screen.getByLabelText('Off-targets up to'), { target: { value: '4' } });
    await waitFor(() => {
      expect(heads()).toContain('4 mm');
    });
    expect(heads().filter((h) => (h ?? '').endsWith('mm'))).toHaveLength(4);
    expect(heads()).toContain('Spec.');
    // A nuclease the MIT weights were not measured for gives no score.
    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'ascas12a' } });
    await waitFor(() => {
      expect(heads()).not.toContain('Spec.');
    });
    expect(heads()).toContain('Exact');
  });

  it('puts the heading note on the count and the clean ones, or what the filters leave', async () => {
    await openGuides(docOf(`${PLAIN[0]}TGG${FILLER}${UNIT}`), { showFlagged: false });
    const heading = screen.getByRole('heading', { name: /^Guides/ });
    expect(heading).toHaveTextContent('1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Show flagged' }));
    expect(heading).toHaveTextContent('2 · 1 clean');
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 guides listed. 1 of the 2 have no flags.',
    );
  });

  it('says which guides are hidden, and that none match a filter', async () => {
    await openGuides(docOf(`${PLAIN[0]}TGG${FILLER}${UNIT}`), { showFlagged: false });
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 guide listed, of 2 found. 1 of the 2 have no flags. Flagged guides are hidden; Show flagged lists them.',
    );
    fireEvent.change(screen.getByLabelText('Spacer contains'), { target: { value: 'X' } });
    expect(screen.getByText('No guides match the filters.')).toBeInTheDocument();
    // The filters are still there to be put right.
    expect(screen.getByLabelText('Spacer contains')).toHaveValue('X');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('shows the off-target note in the head until it is dismissed (once, then a tooltip)', async () => {
    globalThis.localStorage.clear();
    try {
      await openGuides(plain());
      const head = document.querySelector('.ws__head');
      expect(head).toHaveTextContent(/no genome to search/);
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      expect(document.querySelector('.ws__head')).not.toHaveTextContent(/no genome to search/);
      expect(getByTip(document.body, /no genome to search/)).toHaveTextContent('Off-targets up to');
    } finally {
      globalThis.localStorage.clear();
    }
  });

  it('says there are no guides, with the region it was narrowed to', async () => {
    await openGuides(docOf(`${'A'.repeat(20)}TGA${FILLER}`));
    expect(screen.getByText(/^No guides\. Another nuclease/)).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    // The settings stay, so the answer can be changed.
    expect(screen.getByLabelText('Nuclease')).toBeInTheDocument();
  });

  it('keeps the slim tab’s look: no table in it', async () => {
    act(() => {
      editorStore.openDocument(plain());
    });
    render(<Host doc={plain()} />);
    await waitFor(() => {
      expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.crispr-list .crispr-row').length).toBeGreaterThan(0);
  });
});

describe('sorting the guide table', () => {
  it('lists along the molecule to begin with, and the Position column turns it round', async () => {
    await openGuides(plain());
    expect(positions()).toEqual(['1–20', '34–53', '67–86']);
    const position = screen.getByRole('button', { name: /^Position/ });
    expect(position.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(position);
    expect(positions()).toEqual(['67–86', '34–53', '1–20']);
    expect(position.closest('th')).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(position);
    expect(positions()).toEqual(['1–20', '34–53', '67–86']);
  });

  it('starts GC and Spec. with the highest, and a second click on a column turns it round', async () => {
    await openGuides(plain());
    const gc = screen.getByRole('button', { name: /^GC/ });
    fireEvent.click(gc);
    expect(gc.closest('th')).toHaveAttribute('aria-sort', 'descending');
    const gcs = rowEls().map((r) => Number.parseInt(cells(r)[5] ?? '', 10));
    expect(gcs).toEqual([55, 50, 50]);
    expect(positions()[0]).toBe('67–86');
    fireEvent.click(gc);
    expect(gc.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    const up = rowEls().map((r) => Number.parseInt(cells(r)[5] ?? '', 10));
    expect(up).toEqual([...up].sort((a, b) => a - b));
    // Another column begins in its own first order, not the last one's direction.
    fireEvent.click(screen.getByRole('button', { name: /^Position/ }));
    expect(positions()).toEqual(['1–20', '34–53', '67–86']);
  });

  it('orders by the exact column fewest first, and by a mismatch column', async () => {
    // The first guide has a copy of itself; the second a near copy (one mismatch).
    const a = 'ACGTACGTACGTACGTACGT';
    const near = 'ACGTACGTACGTACGTACGA';
    const lone = 'GATCGATCGATCGATCGATC';
    await openGuides(docOf([`${lone}TGG`, `${a}TGG`, `${a}AGG`, `${near}TGG`].join(FILLER)));
    fireEvent.click(screen.getByRole('button', { name: /^Exact/ }));
    // Fewest exact copies first: the lone guide and the near one tie, the two copies follow.
    const spacers = (): (string | null)[] => rowEls().map((r) => cells(r)[3] ?? null);
    expect(spacers().slice(0, 2)).toEqual([lone, near]);
    expect(spacers().slice(2)).toEqual([a, a]);
    fireEvent.click(screen.getByRole('button', { name: /^1 mm/ }));
    // By the one-mismatch count: none, one each for the copies (the near guide), two for the near guide.
    expect(spacers()).toEqual([lone, a, a, near]);
    expect(rowEls().map((r) => cells(r)[7])).toEqual(['0', '1', '1', '2']);
  });

  it('is the order the slim tab lists in, since the sort is the session’s', async () => {
    await openGuides(plain());
    fireEvent.click(screen.getByRole('button', { name: /^Position/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close the CRISPR workspace' }));
    const rows = [...document.querySelectorAll('.crispr-list .crispr-row__spacer')];
    expect(rows.map((r) => r.textContent.slice(0, 8))).toEqual([
      'CAGCTAGC',
      'GATCGATC',
      'ACGTACGT',
    ]);
  });
});

describe('a guide through the origin of a circular document', () => {
  /** 66 bp: a guide on the last 10 bases and the first 10, one in the middle, the same spacer. */
  const ring = (): SeqDocument =>
    docOf(`${'A'.repeat(10)}TGG${FILLER}${UNIT}${FILLER}${'A'.repeat(10)}`, 'circular');

  it('numbers the protospacer in the table and the detail by its last base, with the linear one beside it', async () => {
    await openGuides(ring());
    // The guide through the origin ends at base 10, not 76; the other ends at 56.
    expect(positions()).toEqual(['24–43', '57–10']);
    fireEvent.click(rowAt(1));
    const detail = screen.getByRole('complementary', { name: 'Guide at 57 (forward)' });
    expect(within(detail).getByText('57–10 (forward)')).toBeInTheDocument();
    // Its other site is the middle one, and from the middle guide the one through the origin.
    const sites = screen.getByRole('table', { name: 'Other sites' });
    expect(within(sites).getAllByRole('row')[1]).toHaveTextContent('→ 24–43');
    fireEvent.click(rowAt(0));
    const others = screen.getByRole('table', { name: 'Other sites' });
    expect(within(others).getAllByRole('row')[1]).toHaveTextContent('→ 57–10');
    fireEvent.click(within(others).getByRole('button', { name: 'Show the site at 57–10' }));
    expect(editorStore.getState().selection).toEqual({ start: 56, end: 76 });
  });
});

describe('a base editor window through the origin', () => {
  it('numbers the edited bases by the last base of the window', async () => {
    // A 20 nt spacer whose first 5 bases are the last 5 of the circle: its
    // C's are at 5 and 7, so the window reaches from base 33 over the origin.
    const spacer = 'GATACACAGATCGATCGATC';
    const ring = docOf(`${spacer.slice(5)}TGG${FILLER}${spacer.slice(0, 5)}`, 'circular');
    await openGuides(ring);
    fireEvent.change(screen.getByLabelText('Base editor'), { target: { value: 'cbe' } });
    expect(positions()).toEqual(['29–15']);
    fireEvent.click(rowAt(0));
    // The window is bases 4 to 8 of the spacer: 32 to 36 here, ending at 3.
    expect(screen.getByText('C5, C7 (32–3)')).toBeInTheDocument();
  });

  it('numbers the same window on a line, ending where it ends', async () => {
    await openGuides(docOf(`GATACACAGATCGATCGATCTGG${FILLER}`));
    fireEvent.change(screen.getByLabelText('Base editor'), { target: { value: 'cbe' } });
    fireEvent.click(rowAt(0));
    expect(screen.getByText('C5, C7 (4–8)')).toBeInTheDocument();
  });
});

describe('the keys in the guide table', () => {
  it('are one stop in the tab order: the selected row, or the first', async () => {
    await openGuides(plain());
    const stops = (): string[] =>
      rowEls()
        .filter((r) => r.tabIndex === 0)
        .map((r) => cells(r)[2] ?? '');
    expect(stops()).toEqual(['1–20']);
    fireEvent.click(rowAt(2));
    expect(stops()).toEqual(['67–86']);
  });

  it('walk the selection with the arrows, Home and End, and select the protospacer', async () => {
    await openGuides(plain());
    const first = rowAt(0);
    first.focus();
    // From the focused row, down is the next one; the views follow.
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(editorStore.getState().selection).toEqual({ start: 33, end: 53 });
    expect(rowEls()[1]).toHaveAttribute('aria-selected', 'true');
    expect(rowEls()[1]).toHaveFocus();
    fireEvent.keyDown(rowAt(1), { key: 'End' });
    expect(rowEls()[2]).toHaveFocus();
    expect(editorStore.getState().selection).toEqual({ start: 66, end: 86 });
    // Past the ends it stays.
    fireEvent.keyDown(rowAt(2), { key: 'ArrowDown' });
    expect(rowEls()[2]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rowAt(2), { key: 'Home' });
    expect(rowEls()[0]).toHaveFocus();
    expect(editorStore.getState().selection).toEqual({ start: 0, end: 20 });
    fireEvent.keyDown(rowAt(0), { key: 'ArrowUp' });
    expect(rowEls()[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rowAt(0), { key: 'ArrowDown' });
    fireEvent.keyDown(rowAt(1), { key: 'ArrowUp' });
    expect(rowEls()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('leave the other keys alone', async () => {
    await openGuides(plain());
    const first = rowAt(0);
    fireEvent.keyDown(first, { key: 'a' });
    fireEvent.keyDown(first, { key: 'ArrowDown', ctrlKey: true });
    expect(editorStore.getState().selection).toBeNull();
  });

  it('put the guide away with Escape first, and shut the workspace with the next', async () => {
    await openGuides(plain());
    const second = rowAt(1);
    fireEvent.click(second);
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(editorStore.getState().selection).toBeNull();
    expect(editorStore.getState().workspace).toBe('crispr');
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(editorStore.getState().workspace).toBeNull();
  });
});

describe('a table of 1,500 guides', () => {
  // Distinct 20-mers from the digits of i in base four, each with its own TGG
  // PAM; their junctions make a few guides more, which is as it is on a real one.
  function big(count: number): SeqDocument {
    const spacer = (i: number): string =>
      i
        .toString(4)
        .padStart(10, '0')
        .split('')
        .map((d) => 'ACGT'[Number(d)] ?? 'A')
        .join('')
        .repeat(2);
    return docOf(Array.from({ length: count }, (_, i) => `${spacer(i)}TGG`).join(FILLER));
  }

  it('draws a screenful of rows, not all of them, with the height in a spacer, and no cap', async () => {
    await openGuides(big(1500), { maxMismatches: 0 });
    const status = screen.getByRole('status');
    const listed = Number.parseInt(status.textContent.replaceAll(',', ''), 10);
    expect(listed).toBeGreaterThanOrEqual(1500);
    const drawn = rowEls().length;
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThan(100);
    const spacers = [...document.querySelectorAll<HTMLElement>('tr.wst__spacer')];
    // Nothing above the first row, a thousand rows' worth of height below the window.
    expect(spacers).toHaveLength(1);
    expect(Number.parseFloat(spacers[0]?.style.height ?? '0')).toBeGreaterThan(30000);
    // The cap is the preview's: none of this many is drawn on the views, and it says so.
    expect(editorStore.getState().preview).toBeNull();
    expect(screen.getByText(/More than 200 are listed, so none are drawn/)).toBeInTheDocument();
  });

  it('moves the window with the scroll, and lands on a row not drawn yet with End', async () => {
    await openGuides(big(1500), { maxMismatches: 0 });
    const scroller = stubScroller();
    const firstNumber = (): number =>
      Number.parseInt((cells(rowEls()[0])[0] ?? '').replaceAll(',', ''), 10);
    expect(firstNumber()).toBe(1);
    scroller.scrollTop = 1e6;
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(firstNumber()).toBeGreaterThan(1000);
    expect(rowEls().length).toBeLessThan(100);
    expect(document.querySelectorAll('tr.wst__spacer')).toHaveLength(1);

    // Back at the top the keyboard asks for the last one, which has no row yet.
    scroller.scrollTop = 0;
    act(() => {
      fireEvent.scroll(scroller);
    });
    const top = rowAt(0);
    top.focus();
    fireEvent.keyDown(top, { key: 'End' });
    const last = rowAt(rowEls().length - 1);
    expect(last).toHaveAttribute('aria-selected', 'true');
    expect(last).toHaveFocus();
    expect(rowEls().length).toBeLessThan(100);
    fireEvent.keyDown(last, { key: 'Home' });
    expect(rowEls()[0]).toHaveFocus();
  });

  it('scrolls to a guide opened elsewhere, such as one the selection now covers', async () => {
    const doc = big(1500);
    await openGuides(doc, { maxMismatches: 0 });
    stubScroller();
    // The last unit's protospacer is among the last guides, far below the window.
    act(() => {
      editorStore.setSelection({ start: doc.length - 23, end: doc.length - 3 });
    });
    await waitFor(() => {
      expect(rowEls().some((r) => r.getAttribute('aria-selected') === 'true')).toBe(true);
    });
    expect(rowEls().length).toBeLessThan(100);
    expect(Number.parseInt((cells(rowEls()[0])[0] ?? '').replaceAll(',', ''), 10)).toBeGreaterThan(
      1000,
    );
  });
});

describe('the detail pane', () => {
  it('names the row, with the facts, the flags and the cut', async () => {
    await openGuides(docOf(`${UNIT}${FILLER}${UNIT}`));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByText('Select a guide to see its details and oligos.')).toBeInTheDocument();
    fireEvent.click(rowAt(1));
    const detail = screen.getByRole('complementary', { name: 'Guide at 34 (forward)' });
    expect(within(detail).getByText('blunt, after base 50')).toBeInTheDocument();
    expect(
      within(detail).getByText(/^Binds somewhere else exactly; .*20 of one base in a row$/),
    ).toBeInTheDocument();
    // Another row, another name.
    fireEvent.click(rowAt(0));
    expect(screen.getByRole('complementary', { name: 'Guide at 1 (forward)' })).toBeInTheDocument();
  });

  it('lists the other sites in a table, and Show selects one in this document', async () => {
    await openGuides(docOf(`${UNIT}${FILLER}${UNIT}`));
    fireEvent.click(rowAt(0));
    const sites = screen.getByRole('table', { name: 'Other sites' });
    const row = within(sites).getAllByRole('row')[1];
    expect(row).toHaveTextContent('exact');
    expect(row).toHaveTextContent('test');
    expect(row).toHaveTextContent('→ 34–53');
    fireEvent.click(within(sites).getByRole('button', { name: 'Show the site at 34–53' }));
    expect(editorStore.getState().selection).toEqual({ start: 33, end: 53 });
  });

  it('names the other document a site is in', async () => {
    act(() => {
      editorStore.openDocument(
        SeqDocument.create({ name: 'vector', sequence: `${FILLER}${UNIT}${FILLER}` }),
      );
    });
    await openGuides(docOf(`${UNIT}${FILLER}`), { searchOthers: true });
    fireEvent.click(rowAt(0));
    const sites = await screen.findByRole('table', { name: 'Other sites' });
    expect(within(sites).getByText('vector')).toBeInTheDocument();
    // Another document's position is its own: there is nothing in this one to show.
    expect(within(sites).queryByRole('button', { name: /^Show the site/ })).not.toBeInTheDocument();
  });

  it('has the oligos, the overhangs, Copy and Save to My primers', async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (t: string) => {
          copied.push(t);
          return Promise.resolve();
        },
      },
      configurable: true,
    });
    await openGuides(plain());
    fireEvent.click(rowAt(2));
    expect(screen.getByText('CACCGCAGCTAGCTAGCATCGATCG')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Overhangs'), { target: { value: 'none' } });
    expect(screen.getByText(PLAIN[2], { selector: '.crispr-oligo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy oligos' }));
    expect(copied).toEqual([`${PLAIN[2]}\n${reverseComplement(PLAIN[2])}`]);
    expect(screen.getByRole('button', { name: 'Save to My primers' })).toBeInTheDocument();
  });
});

describe('Add as feature and Add the listed, in the workspace (D8)', () => {
  const features = (): number =>
    [...(editorStore.getState().documents[0]?.history.present.features.all() ?? [])].length;

  it('adds the listed guides in one edit, says so, and Undo takes them all back', async () => {
    await openGuides(plain());
    fireEvent.click(screen.getByRole('button', { name: 'Add all 3 listed as features' }));
    expect(features()).toBe(3);
    // The workspace is not shut by the Features tab: it says what it did.
    expect(editorStore.getState()).toMatchObject({ workspace: 'crispr', sidebarTab: 'crispr' });
    const status = screen.getByText(/^Added 3 features\./);
    fireEvent.click(
      within(status.closest('p') as HTMLElement).getByRole('button', { name: 'Undo' }),
    );
    expect(features()).toBe(0);
    expect(screen.queryByText(/^Added 3 features\./)).not.toBeInTheDocument();
    // The arrows are on the views again after both edits.
    await waitFor(() => {
      expect(editorStore.getState().preview?.items).toHaveLength(3);
    });
  });

  it('says "the N" when a filter narrows the list, and adds only those', async () => {
    await openGuides(plain());
    fireEvent.change(screen.getByLabelText('Spacer contains'), { target: { value: 'GATCGATC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the 1 listed as features' }));
    expect(features()).toBe(1);
    expect(screen.getByText(/^Added 1 feature\./)).toBeInTheDocument();
  });

  it('adds the open guide from its detail, with the same line and Undo', async () => {
    await openGuides(plain());
    fireEvent.click(rowAt(1));
    fireEvent.click(screen.getByRole('button', { name: 'Add as feature' }));
    expect(features()).toBe(1);
    expect(editorStore.getState().sidebarTab).toBe('crispr');
    expect(editorStore.getState().selection).toEqual({ start: 33, end: 53 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(features()).toBe(0);
  });

  it('drops the line, and its Undo, once something else has been done to the document', async () => {
    await openGuides(plain());
    fireEvent.click(screen.getByRole('button', { name: 'Add all 3 listed as features' }));
    expect(screen.getByText(/^Added 3 features\./)).toBeInTheDocument();
    // Undoing now would take back the wrong edit.
    act(() => {
      editorStore.apply({ type: 'rename', name: 'renamed' });
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });
});

describe('a scan that fails or is slow (RunNotices, #373)', () => {
  const crash = () => new AnalysisWorkerError('Analysis worker failed: out of memory (w.js:3)');

  it('says plainly that the scan stopped, with the technical text behind a details line', async () => {
    vi.spyOn(analysisClient, 'crisprGuides').mockRejectedValue(crash());
    await openGuides(plain());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The analysis stopped (probably memory or size). Try again, or narrow the scan to a selection or count fewer mismatches.',
    );
    const details = alert.querySelector('details');
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('Analysis worker failed: out of memory (w.js:3)');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText(/^No guides/)).not.toBeInTheDocument();
  });

  it('sends the scan again once on Try again, and does not offer it a second time', async () => {
    const spy = vi.spyOn(analysisClient, 'crisprGuides').mockRejectedValue(crash());
    await openGuides(plain());
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /memory or size\)\. Narrow the scan to a selection or count fewer mismatches\./,
      );
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]).toEqual(spy.mock.calls[0]);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows the guides when the second try works', async () => {
    const real = analysisClient.crisprGuides.bind(analysisClient);
    vi.spyOn(analysisClient, 'crisprGuides')
      .mockRejectedValueOnce(crash())
      .mockImplementation(real);
    await openGuides(plain());
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('grid', { name: 'Guides' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an ordinary error as it was, without the stopped text', async () => {
    vi.spyOn(analysisClient, 'crisprGuides').mockRejectedValue(new Error('Too many'));
    await openGuides(plain());
    expect(await screen.findByText('Too many')).toBeInTheDocument();
    expect(screen.queryByText(/The analysis stopped/)).toBeNull();
  });

  it('tells the slim tab of a stopped scan too', async () => {
    vi.spyOn(analysisClient, 'crisprGuides').mockRejectedValue(crash());
    act(() => {
      editorStore.openDocument(plain());
    });
    render(<Host doc={plain()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The analysis stopped');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says a scan is taking a while after the limit, and not before', () => {
    vi.useFakeTimers();
    vi.spyOn(analysisClient, 'crisprGuides').mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const doc = plain();
    act(() => {
      editorStore.openDocument(doc);
      openCrisprWorkspace(editorStore.getState().documentId, 'guides');
    });
    render(<Host doc={doc} />);
    expect(screen.getByText('Looking for guides…')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SLOW_RUN_MS - 1);
    });
    expect(screen.queryByText(/This is taking a while/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('This is taking a while');
  });
});
