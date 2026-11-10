// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument, reverseComplement } from '@/core';
import { analytics } from '../analytics';
import { analysisClient } from '@/workers/analysisClient';

import { type CrisprSession, forgetCrisprSessions, updateCrisprSession } from '../crisprSession';
import { openCrisprWorkspace } from '../crisprWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { getByTip } from '@/test/tips';
import { useEditorState } from '../state/useEditorStore';
import { CrisprPanel } from './CrisprPanel';
import { CrisprWorkspace } from './CrisprWorkspace';

// The Pairs page of the CRISPR workspace (item 133, C5): the paired nickases
// of item 82 as a table over the session's scan.

/** One SpCas9 site: 20 A's and a TGG PAM, then filler with no GG or CC. */
const UNIT = `${'A'.repeat(20)}TGG`;
const FILLER = 'CTCTCTCTCT';
const SPACER = 'A'.repeat(20);

function docOf(sequence: string, topology: 'linear' | 'circular' = 'linear'): SeqDocument {
  return SeqDocument.create({ sequence, topology, name: 'test' });
}

/** One guide on each strand, their blunt cuts at 17 and 39: 22 bases apart. */
const ONE = (): SeqDocument => docOf(`${UNIT}${FILLER}${reverseComplement(UNIT)}`);
/**
 * Two of each. Their forward-strand guides cut at 17 and 50, the reverse ones
 * at 72 and 105, so the four pairs of the default nickase are 22, 55, 55 and
 * 88 bases apart.
 */
const FOUR = (): SeqDocument =>
  docOf([UNIT, UNIT, reverseComplement(UNIT), reverseComplement(UNIT)].join(FILLER));

function Host({ doc }: { doc: SeqDocument }) {
  const { workspace } = useEditorState();
  return workspace === 'crispr' ? <CrisprWorkspace doc={doc} /> : <CrisprPanel doc={doc} />;
}

/** Opens the workspace on Pairs and waits for the scan. */
async function openPairs(doc: SeqDocument, session: Partial<CrisprSession> = {}) {
  act(() => {
    editorStore.openDocument(doc);
    const { documentId } = editorStore.getState();
    updateCrisprSession(documentId, session);
    openCrisprWorkspace(documentId, 'pairs');
  });
  const view = render(<Host doc={doc} />);
  await waitFor(() => {
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
  });
  return view;
}

const rowEls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('tr[data-row]')];
const rowAt = (i: number): HTMLElement => {
  const row = rowEls()[i];
  if (row === undefined) throw new Error(`no row ${String(i)}`);
  return row;
};
const cells = (r: HTMLElement | undefined): string[] =>
  [...(r?.querySelectorAll('td') ?? [])].map((c) => c.textContent);
/** The Apart column of every drawn row. */
const apart = (): string[] => rowEls().map((r) => cells(r)[3] ?? '');
const railBadge = (name: RegExp): string | null =>
  screen.getByRole('tab', { name }).querySelector('.ws__badge')?.textContent ?? null;
const preview = () => editorStore.getState().preview;

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

afterEach(() => {
  cleanup();
  forgetCrisprSessions();
  forgetPanels();
  vi.restoreAllMocks();
  act(() => {
    while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
  });
});

describe('the Pairs page', () => {
  it('has the nickase and the distance on top, and a table of the pairs under them', async () => {
    await openPairs(ONE());
    const settings = screen.getByRole('group', { name: 'Settings' });
    expect(within(settings).getByLabelText('Nickase')).toHaveValue('target');
    expect(within(settings).getByLabelText('Nicks at most (bp) apart')).toHaveValue(100);
    const grid = screen.getByRole('grid', { name: 'Paired nickases' });
    expect([...grid.querySelectorAll('thead th')].map((h) => h.textContent)).toEqual([
      '#',
      'Forward nick',
      'Reverse nick',
      'Apart (bp)',
      'Overhang',
    ]);
    expect(rowEls()).toHaveLength(1);
    // D10A nicks the strand the guide pairs with: the reverse guide's nick is the forward one.
    expect(cells(rowAt(0))).toEqual([
      '1',
      `← 37–56 ${SPACER}`,
      `→ 1–20 ${SPACER}`,
      '22',
      '22 nt 3′ overhang',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 pair of guides nick within 100 bp of each other, the closest first.',
    );
  });

  it('turns the overhang round with the other nickase', async () => {
    await openPairs(ONE());
    const track = vi.spyOn(analytics, 'track');
    fireEvent.change(screen.getByLabelText('Nickase'), { target: { value: 'pam' } });
    expect(track).toHaveBeenCalledWith('crispr', 'nickPairs');
    expect(cells(rowAt(0))).toEqual([
      '1',
      `→ 1–20 ${SPACER}`,
      `← 37–56 ${SPACER}`,
      '22',
      '22 nt 5′ overhang',
    ]);
  });

  it('lists the closest nicks first, all of them, and honours the distance', async () => {
    await openPairs(FOUR());
    expect(apart()).toEqual(['22', '55', '55', '88']);
    expect(rowEls().map((r) => cells(r)[0])).toEqual(['1', '2', '3', '4']);
    fireEvent.change(screen.getByLabelText('Nicks at most (bp) apart'), {
      target: { value: '60' },
    });
    expect(apart()).toEqual(['22', '55', '55']);
    expect(screen.getByRole('status')).toHaveTextContent('3 pairs of guides nick within 60 bp');
    // A box that is no number is the default distance, as it was.
    fireEvent.change(screen.getByLabelText('Nicks at most (bp) apart'), { target: { value: '' } });
    expect(apart()).toHaveLength(4);
  });

  it('says there is no pair, or no guide to make one', async () => {
    await openPairs(ONE());
    fireEvent.change(screen.getByLabelText('Nicks at most (bp) apart'), {
      target: { value: '21' },
    });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(
      screen.getByText('No pair of the guides found nicks within that distance.'),
    ).toBeVisible();
    cleanup();
    forgetCrisprSessions();
    act(() => {
      editorStore.closeDocument();
    });
    await openPairs(docOf('CTCTCTCTCTCTCTCTCTCTCTCTCTCT'));
    expect(screen.getByText('No guides were found, so there is no pair of them.')).toBeVisible();
    expect(railBadge(/^Pairs/)).toBe('0');
  });

  it('counts the pairs on the rail, from any page', async () => {
    await openPairs(FOUR());
    expect(railBadge(/^Pairs/)).toBe('4');
    fireEvent.click(screen.getByRole('tab', { name: /^Guides/ }));
    expect(railBadge(/^Pairs/)).toBe('4');
    // The Prime page has no edit yet, so no count.
    expect(railBadge(/^Prime/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^Pairs/ }));
    fireEvent.change(screen.getByLabelText('Nicks at most (bp) apart'), {
      target: { value: '30' },
    });
    expect(railBadge(/^Pairs/)).toBe('1');
  });

  it('counts the guides the Guides filters hide, as the pairs are made of all of them', async () => {
    // All-A spacers are flagged, and flagged guides are not listed by default.
    await openPairs(ONE());
    fireEvent.click(screen.getByRole('tab', { name: /^Guides/ }));
    expect(screen.queryByRole('grid', { name: 'Guides' })).not.toBeInTheDocument();
    expect(railBadge(/^Pairs/)).toBe('1');
  });

  it('selects the two guides on a click, draws them and nothing else, and a second click puts them away', async () => {
    await openPairs(FOUR());
    expect(preview()).toBeNull();
    fireEvent.click(rowAt(0));
    // The span covering both guides: the one at 34-53 and the one at 70-89.
    expect(editorStore.getState().selection).toEqual({ start: 33, end: 89 });
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'true');
    const drawn = preview();
    expect(drawn?.owners).toEqual(['crispr']);
    expect(drawn?.items.map((i) => [i.label, i.strand, i.shape, i.range])).toEqual([
      ['TGG', 'reverse', 'arrow', { start: 69, end: 89 }],
      ['TGG', 'forward', 'arrow', { start: 33, end: 53 }],
    ]);
    fireEvent.click(rowAt(0));
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'false');
    expect(editorStore.getState().selection).toBeNull();
    expect(preview()).toBeNull();
  });

  it('selects the span of the pair on the document', async () => {
    await openPairs(ONE());
    fireEvent.click(rowAt(0));
    expect(editorStore.getState().selection).toEqual({ start: 0, end: 56 });
  });

  it('selects the guide a click on its arrow names', async () => {
    await openPairs(ONE());
    fireEvent.click(rowAt(0));
    const [first] = preview()?.items ?? [];
    if (first === undefined) throw new Error('the pair was not drawn');
    act(() => {
      editorStore.activatePreview(first.id);
    });
    expect(editorStore.getState().selection).toEqual({ start: 36, end: 56 });
  });

  it('swaps its arrows for the Guides page’s, and gets its own back, with no new scan', async () => {
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    await openPairs(ONE(), { showFlagged: true });
    const before = scans.mock.calls.length;
    fireEvent.click(rowAt(0));
    expect(preview()?.items).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: /^Guides/ }));
    // The Guides page draws the guides it lists: here the same two, by their own ids.
    expect(preview()?.items.map((i) => i.id)).toEqual(['crispr:forward:0', 'crispr:reverse:36']);
    fireEvent.click(screen.getByRole('tab', { name: /^Pairs/ }));
    // The pair is still the session's open one, and drawn.
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'true');
    expect(preview()?.items).toHaveLength(2);
    expect(scans.mock.calls.length).toBe(before);
  });

  it('takes the arrows off the views when the workspace goes', async () => {
    await openPairs(ONE());
    fireEvent.click(rowAt(0));
    expect(preview()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /close the crispr workspace/i }));
    expect(preview()).toBeNull();
  });

  it('forgets an open pair the list no longer has', async () => {
    await openPairs(FOUR());
    fireEvent.click(rowAt(3));
    expect(preview()).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Nicks at most (bp) apart'), {
      target: { value: '30' },
    });
    expect(rowEls().some((r) => r.getAttribute('aria-selected') === 'true')).toBe(false);
    expect(preview()).toBeNull();
  });

  it('says what Pairs needs when the nuclease cannot, and a way back', async () => {
    await openPairs(ONE(), { nucleaseId: 'ascas12a' });
    expect(screen.getByText(/Paired nickases need a Cas9-like nuclease/)).toBeVisible();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(railBadge(/^Pairs/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }));
    expect(screen.getByRole('heading', { name: /^Guides/ })).toBeVisible();
  });

  it('says why a custom PAM that is none has no pairs', async () => {
    await openPairs(ONE(), { nucleaseId: 'custom', pam: 'NXG' });
    expect(screen.getByText(/not an IUPAC base/)).toBeVisible();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
});

describe('the keys in the pairs table', () => {
  it('are one stop in the tab order: the open row, or the first', async () => {
    await openPairs(FOUR());
    const stops = (): string[] =>
      rowEls()
        .filter((r) => r.tabIndex === 0)
        .map((r) => cells(r)[0] ?? '');
    expect(stops()).toEqual(['1']);
    fireEvent.click(rowAt(2));
    expect(stops()).toEqual(['3']);
  });

  it('walk the selection with the arrows, Home and End', async () => {
    await openPairs(FOUR());
    const first = rowAt(0);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(rowAt(1)).toHaveAttribute('aria-selected', 'true');
    expect(rowAt(1)).toHaveFocus();
    expect(preview()?.items).toHaveLength(2);
    fireEvent.keyDown(rowAt(1), { key: 'End' });
    expect(rowAt(3)).toHaveFocus();
    expect(rowAt(3)).toHaveAttribute('aria-selected', 'true');
    // Past the end it stays.
    fireEvent.keyDown(rowAt(3), { key: 'ArrowDown' });
    expect(rowAt(3)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rowAt(3), { key: 'Home' });
    expect(rowAt(0)).toHaveFocus();
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rowAt(0), { key: 'ArrowUp' });
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'true');
  });

  it('select the focused row with Enter, and put it away with the next', async () => {
    await openPairs(FOUR());
    const second = rowAt(1);
    second.focus();
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(editorStore.getState().selection).not.toBeNull();
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(second).toHaveAttribute('aria-selected', 'false');
  });

  it('leave the other keys alone', async () => {
    await openPairs(FOUR());
    const first = rowAt(0);
    fireEvent.keyDown(first, { key: 'a' });
    fireEvent.keyDown(first, { key: 'ArrowDown', ctrlKey: true });
    expect(editorStore.getState().selection).toBeNull();
  });

  it('put the pair away with Escape first, and shut the workspace with the next', async () => {
    await openPairs(FOUR());
    const second = rowAt(1);
    fireEvent.click(second);
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(second).toHaveAttribute('aria-selected', 'false');
    expect(editorStore.getState().selection).toBeNull();
    expect(preview()).toBeNull();
    expect(editorStore.getState().workspace).toBe('crispr');
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(editorStore.getState().workspace).toBeNull();
  });
});

describe('a table of thousands of pairs', () => {
  // Distinct 20-mers from the digits of i in base four, a unit and its reverse complement each.
  function big(count: number): SeqDocument {
    const spacer = (i: number): string =>
      i
        .toString(4)
        .padStart(10, '0')
        .split('')
        .map((d) => 'ACGT'[Number(d)] ?? 'A')
        .join('')
        .repeat(2);
    const units = Array.from({ length: count }, (_, i) => `${spacer(i)}TGG`);
    return docOf([...units, ...units.map(reverseComplement)].join(FILLER));
  }
  const open = () => openPairs(big(40), { maxMismatches: 0, maxOffset: '100000' });

  it('draws a screenful of rows with the height in a spacer, and caps nothing', async () => {
    await open();
    const listed = Number.parseInt(screen.getByRole('status').textContent.replaceAll(',', ''), 10);
    expect(listed).toBeGreaterThanOrEqual(1600);
    expect(rowEls().length).toBeGreaterThan(10);
    expect(rowEls().length).toBeLessThan(100);
    const spacers = [...document.querySelectorAll<HTMLElement>('tr.wst__spacer')];
    expect(spacers).toHaveLength(1);
    expect(Number.parseFloat(spacers[0]?.style.height ?? '0')).toBeGreaterThan(30000);
    expect(railBadge(/^Pairs/)).toBe(listed.toLocaleString());
  });

  it('moves the window with the scroll, and lands on a row not drawn yet with End', async () => {
    await open();
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
});

describe('a pair across the origin of a circular document', () => {
  it('numbers a guide through the origin by its last base, in the cell and in its tooltip', async () => {
    const ring = docOf(
      `${'A'.repeat(10)}TGG${FILLER}${reverseComplement(UNIT)}${FILLER}${'A'.repeat(10)}`,
      'circular',
    );
    await openPairs(ring);
    expect(cells(rowAt(0)).slice(1, 3)).toEqual([`← 27–46 ${SPACER}`, `→ 57–10 ${SPACER}`]);
    expect(getByTip(rowAt(0), 'Guide at 57–10, forward strand, PAM TGG')).toBeInTheDocument();
    // The linear guide beside it ends where it ends.
    expect(getByTip(rowAt(0), 'Guide at 27–46, reverse strand, PAM TGG')).toBeInTheDocument();
  });

  it('numbers the single-stranded gap through the origin by its last base', async () => {
    // The reverse guide's nick is 6 bases after the origin, the forward guide's 6 before it.
    const ring = docOf(`${reverseComplement(UNIT)}${FILLER}${UNIT}`, 'circular');
    await openPairs(ring);
    expect(getByTip(rowAt(0), 'The single-stranded bases are 51–6')).toBeInTheDocument();
    expect(apart()).toEqual(['12']);
  });

  it('numbers the gap of a pair on a line by its end', async () => {
    await openPairs(ONE());
    expect(getByTip(rowAt(0), /^The single-stranded bases are \d+–\d+$/).dataset.tip).toBe(
      'The single-stranded bases are 18–39',
    );
  });
});
