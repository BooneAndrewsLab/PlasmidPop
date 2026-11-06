// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { type CutSite, SeqDocument, activeEnzymes, getEnzyme } from '@/core';

import { openEnzymeWorkspace } from '../enzymeWorkspace';
import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { forgetPanels, recallPanel } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { EnzymePanel } from './EnzymePanel';
import { EnzymeWorkspace } from './EnzymeWorkspace';

// The Digest, Double digests and Table pages of the Enzyme workspace (item
// 133, E5). The page plumbing is in EnzymeWorkspace.test.tsx and the old
// pieces' behaviours in EnzymePanel.test.tsx.

function Host({ doc }: { doc: SeqDocument }) {
  const { workspace } = useEditorState();
  return workspace === 'enzymes' ? <EnzymeWorkspace doc={doc} /> : <EnzymePanel doc={doc} />;
}

function open(doc: SeqDocument, sites: readonly CutSite[], page: 'digest' | 'pairs' | 'table') {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setAnalysis(doc, sites, []);
    openEnzymeWorkspace(editorStore.getState().documentId, page);
  });
  return render(<Host doc={doc} />);
}

const at = (enzyme: string, cut: number, bottom = cut): CutSite => ({
  enzyme,
  cut,
  cutBottom: bottom,
  siteStart: cut - 1,
  strand: 'forward' as const,
});

/** The rows of the table called `name`, header aside. */
function rowsOf(name: string): HTMLElement[] {
  return within(screen.getByRole('grid', { name })).getAllByRole('row').slice(1);
}

const preview = () => editorStore.getState().preview;

afterEach(() => {
  cleanup();
  act(() => {
    editorStore.clearShelf();
    editorStore.closeDocument();
    editorStore.setCloningReaction('digest');
  });
  forgetPanels();
});

describe('the Digest page (item 133, E5)', () => {
  // 4,000 bp, linear, cut once each by the first five enzymes: 1 | 100 ×4 | 3,599.
  const line = SeqDocument.create({ name: 'target', sequence: 'ACGT'.repeat(1000) });
  const names = activeEnzymes()
    .slice(0, 5)
    .map((e) => e.name);
  const sites = names.map((n, i) => at(n, i * 100 + 1));

  it('lists the ticked enzymes as chips, each with a × that unticks it', () => {
    open(line, sites, 'digest');
    const chips = screen.getByRole('list', { name: 'Ticked enzymes' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(5);
    const [first] = [...names].sort((a, b) => a.localeCompare(b));
    if (first === undefined) throw new Error('table');
    fireEvent.click(screen.getByRole('button', { name: `Untick ${first}` }));
    expect(editorStore.getState().shownEnzymes.has(first)).toBe(false);
    expect(within(chips).getAllByRole('listitem')).toHaveLength(4);
    // The digest follows: four cuts, five pieces.
    expect(rowsOf('Fragments')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Untick all' }));
    expect(editorStore.getState().shownEnzymes.size).toBe(0);
  });

  it('draws the gel and tabulates the pieces, largest first, with the enzyme at each end', () => {
    open(line, sites, 'digest');
    expect(screen.getByTestId('gel-reading')).toBeInTheDocument();
    const rows = rowsOf('Fragments');
    expect(rows).toHaveLength(6);
    const cells = (row: HTMLElement): string[] =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent);
    const [big, , , , , small] = rows.map(cells);
    // #, length, span, left end, right end.
    expect(big?.slice(0, 3)).toEqual(['1', '3,599 bp', '402–4,000']);
    expect(big?.[3]).toContain(names[4]);
    expect(big?.[4]).toContain('end');
    expect(small?.slice(0, 3)).toEqual(['6', '1 bp', '1–1']);
  });

  it('puts a piece on the shelf with Add, and says it is there', () => {
    open(line, sites, 'digest');
    const [row] = rowsOf('Fragments');
    if (row === undefined) throw new Error('no rows');
    fireEvent.click(within(row).getByRole('button', { name: 'Add' }));
    const [part] = editorStore.getState().shelf;
    expect(part?.fragment.sequence.length).toBe(3599);
    expect(part?.fragment.lineage?.step).toMatchObject({ op: 'digest' });
    expect(within(row).getByRole('button', { name: 'Added ✓' })).toBeInTheDocument();
    expect(within(row).getByText(/On shelf/)).toBeInTheDocument();
  });

  it('lights the piece under the pointer or the keyboard on the views, whatever the Cloning reaction', () => {
    // The Cloning tab last had PCR: the page is the digest all the same.
    act(() => {
      editorStore.setCloningReaction('pcr');
    });
    open(line, sites, 'digest');
    expect(preview()?.owners).toEqual(['cloning']);
    expect(preview()?.items).toHaveLength(6);
    const [row] = rowsOf('Fragments');
    if (row === undefined) throw new Error('no rows');
    act(() => {
      fireEvent.mouseEnter(row);
    });
    const lit = preview()?.items.filter((s) => s.shape === 'arrow');
    expect(lit?.map((s) => s.label)).toEqual(['3,599 bp']);
    act(() => {
      fireEvent.mouseLeave(row);
    });
    expect(preview()?.items.filter((s) => s.shape === 'arrow')).toEqual([]);
  });

  it('selects the piece on a click or Enter, and walks the rows with the arrow keys', () => {
    open(line, sites, 'digest');
    const [first, second] = rowsOf('Fragments');
    if (first === undefined || second === undefined) throw new Error('no rows');
    fireEvent.click(first);
    expect(editorStore.getState().selection).toEqual({ start: 401, end: 4000 });
    // One row in the tab order, and the arrows move it without choosing anything.
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');
    act(() => {
      first.focus();
    });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(editorStore.getState().selection).toEqual({ start: 1, end: 101 });
    fireEvent.keyDown(second, { key: 'End' });
    expect(rowsOf('Fragments').at(-1)).toHaveFocus();
  });

  describe('the partial digest', () => {
    // 4,000 bp circular, EcoRI at 400 and 1,400: two pieces of 1,000 and 3,000.
    const eco = getEnzyme('EcoRI')?.name ?? 'EcoRI';
    const ring = SeqDocument.create({ sequence: 'ACGT'.repeat(1000), topology: 'circular' });
    const ringSites = [400, 1400].map((c) => at(eco, c, c + 4));

    // Two sites are not a single cutter's, so the ticking is ours.
    const tick = (): void => {
      act(() => {
        editorStore.setShownEnzymes([eco]);
      });
    };

    it('lists every piece a partial digest can give, with the sites each leaves uncut', () => {
      open(ring, ringSites, 'digest');
      tick();
      expect(screen.getByText(/2 fragments, largest first/)).toBeInTheDocument();
      expect(rowsOf('Fragments')).toHaveLength(2);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Partial digest' }));
      expect(screen.getByText(/4 fragments a partial digest can give/)).toBeInTheDocument();
      expect(screen.getAllByText(/1 site uncut/)).toHaveLength(2);
      // The pieces overlap, so only the one pointed at is drawn.
      expect(preview()?.items ?? []).toEqual([]);
      const [row] = rowsOf('Fragments');
      if (row === undefined) throw new Error('no rows');
      act(() => {
        fireEvent.mouseEnter(row);
      });
      expect(preview()?.items.map((s) => s.label)).toEqual(['4,000 bp']);
    });

    it('is remembered for the document under its own slot, not the Cloning tab’s', () => {
      const view = open(ring, ringSites, 'digest');
      tick();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Partial digest' }));
      const id = editorStore.getState().documentId;
      expect(recallPanel('enzymes.partial', id, false)).toBe(true);
      expect(recallPanel('cloning.partial', id, false)).toBe(false);
      // Gone to the panel and back, it is as it was left.
      act(() => {
        editorStore.setWorkspace(null);
      });
      view.rerender(<Host doc={ring} />);
      act(() => {
        openEnzymeWorkspace(id, 'digest');
      });
      expect(screen.getByRole('checkbox', { name: 'Partial digest' })).toBeChecked();
    });
  });

  it('names the sites the host leaves out when others still cut', () => {
    const text = `AAAACCTGGCCAAAAA${'ACGT'.repeat(40)}AAATCGATAAA`;
    const dcm = SeqDocument.create({ name: 'pDcm', sequence: text, topology: 'circular' });
    open(
      dcm,
      [
        { ...at('MscI', 9), siteStart: 6 },
        { ...at('ClaI', 180), siteStart: 178 },
      ],
      'digest',
    );
    act(() => {
      editorStore.setShownEnzymes(['MscI', 'ClaI']);
    });
    expect(
      screen.getByText(/1 site of MscI is left out: pDcm is dam\+\/dcm\+/),
    ).toBeInTheDocument();
    // Only ClaI cuts a circle: one piece.
    expect(rowsOf('Fragments')).toHaveLength(1);
  });

  it('says so when the host blocks every site of what is ticked', () => {
    // MscI's TGGCCA sits in a Dcm CCWGG, so an ordinary strain blocks it.
    const text = `AAAACCTGGCCAAAAA${'ACGT'.repeat(40)}`;
    const dcm = SeqDocument.create({ name: 'pDcm', sequence: text, topology: 'circular' });
    open(dcm, [{ ...at('MscI', 9), siteStart: 6 }], 'digest');
    act(() => {
      editorStore.setShownEnzymes(['MscI']);
    });
    expect(screen.getByText(/Every site of MscI in pDcm is blocked/)).toBeInTheDocument();
    // Nothing cut, so no partial digest to ask for.
    expect(screen.queryByRole('checkbox', { name: 'Partial digest' })).toBeNull();
  });

  it('is off with nothing ticked, says so in its heading, and sends you to the Enzymes page', () => {
    open(line, sites, 'digest');
    act(() => {
      editorStore.setShownEnzymes([]);
    });
    expect(screen.getByRole('heading', { name: 'DigestNothing is ticked' })).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Fragments' })).toBeNull();
    expect(screen.queryByTestId('gel-reading')).toBeNull();
    expect(screen.getByRole('group', { name: 'Digest' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Partial digest' })).toBeDisabled();
    expect(preview()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tick enzymes' }));
    expect(screen.getByRole('heading', { name: /^Enzymes/ })).toBeInTheDocument();
  });

  it('opens the Bench, with the workspace still open on the document when it comes back', () => {
    open(line, sites, 'digest');
    const id = editorStore.getState().documentId ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Open the Bench ›' }));
    expect(editorStore.getState().front).toBe('bench');
    act(() => {
      editorStore.restoreBench(DEFAULT_BENCH);
      editorStore.activateDocument(id);
    });
    expect(editorStore.getState().workspace).toBe('enzymes');
  });
});

describe('the Double digests page (item 133, E5)', () => {
  // Eleven enzymes cutting the 4 kb line once each, at positions whose pairs
  // mostly give three bands apart: far more pairs than a page lists.
  const enzymes = activeEnzymes()
    .slice(0, 11)
    .map((e) => e.name);
  const cuts = [137, 411, 905, 1288, 1777, 2203, 2650, 3011, 3399, 3702, 3891];
  const line = SeqDocument.create({ name: 'target', sequence: 'ACGT'.repeat(1000) });
  const sites = enzymes.map((n, i) => at(n, cuts[i] ?? 1));

  const named = (row: HTMLElement): string =>
    [...row.querySelectorAll('.enzyme-row__pair')].map((c) => c.textContent).join(' + ');

  it('lists the best twenty pairs, Tick both on each, and says what it is a table of', () => {
    open(line, sites, 'pairs');
    const rows = rowsOf('Double digests');
    expect(rows).toHaveLength(20);
    const [best] = rows;
    if (best === undefined) throw new Error('no pairs');
    const [first, second] = named(best).split(' + ');
    expect(screen.getByText(/best separated first/)).toBeInTheDocument();
    expect(within(best).getByRole('button', { name: 'Tick both' })).toBeEnabled();
    fireEvent.click(within(best).getByRole('button', { name: 'Tick both' }));
    expect([...editorStore.getState().shownEnzymes].sort()).toEqual([first, second].sort());
    expect(within(best).getByRole('button', { name: 'Ticked' })).toBeDisabled();
    // The rest still offer it.
    expect(screen.getAllByRole('button', { name: 'Tick both' })).toHaveLength(19);
  });

  it('draws the best pair’s three lanes under the table, and another’s on a click, without ticking', () => {
    open(line, sites, 'pairs');
    const lanes = (): (string | null)[] =>
      [...document.querySelectorAll('.gel__lane')].map((l) => l.getAttribute('data-lane'));
    const rows = rowsOf('Double digests');
    const [best, other] = rows;
    if (best === undefined || other === undefined) throw new Error('no pairs');
    const [a, b] = named(best).split(' + ');
    expect(lanes()).toEqual([a, b, 'Both']);
    expect(best).toHaveAttribute('aria-selected', 'true');
    const ticked = [...editorStore.getState().shownEnzymes];
    fireEvent.click(other);
    const [c, d] = named(other).split(' + ');
    expect(lanes()).toEqual([c, d, 'Both']);
    expect(other).toHaveAttribute('aria-selected', 'true');
    expect([...editorStore.getState().shownEnzymes]).toEqual(ticked);
    // A band of the pair's lane selects the piece it is, as on the Digest page.
    const bands = screen.getAllByRole('button', { name: /^Both: / });
    const [band] = bands;
    if (band === undefined) throw new Error('no band to click');
    fireEvent.click(band);
    expect(editorStore.getState().selection).not.toBeNull();
  });

  it('moves between the rows with the arrow keys and selects one with Enter', () => {
    open(line, sites, 'pairs');
    const [first, second] = rowsOf('Double digests');
    if (first === undefined || second === undefined) throw new Error('no pairs');
    act(() => {
      first.focus();
    });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(second).toHaveAttribute('aria-selected', 'true');
  });

  it('says so, instead of a blank page, when fewer than two enzymes could be paired', () => {
    open(line, [at(enzymes[0] ?? '', 500)], 'pairs');
    expect(screen.getByTestId('double-digests')).toHaveTextContent(
      /Fewer than two enzymes cut target 3 times or fewer/,
    );
  });
});

describe('the Table page (item 133, E5)', () => {
  const line = SeqDocument.create({ name: 'target', sequence: 'ACGT'.repeat(1000) });

  afterEach(async () => {
    await persistence.removeCustomEnzyme('MyEco');
  });

  it('says which table is scanning, with the import and the form open under it', () => {
    open(line, [], 'table');
    expect(screen.getByText(/Scanning with the bundled table/)).toBeInTheDocument();
    expect(screen.getByText('Choose file…')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Enzyme name' })).toBeInTheDocument();
  });

  it('adds an enzyme of your own, counts it on the rail, lists it and removes it', async () => {
    open(line, [], 'table');
    fireEvent.change(screen.getByRole('textbox', { name: 'Enzyme name' }), {
      target: { value: 'MyEco' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Recognition site in REBASE notation' }), {
      target: { value: 'G^AATT_C' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save enzyme' }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText(/Plus 1 of your own/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Table/ })).toHaveTextContent('1');
    const list = screen.getByText('Your enzymes:').parentElement;
    if (list === null) throw new Error('no list');
    expect(list).toHaveTextContent('MyEco');
    await act(async () => {
      fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText('Your enzymes:')).toBeNull();
    expect(screen.getByRole('tab', { name: /^Table/ })).not.toHaveTextContent('1');
    expect(activeEnzymes().some((e) => e.name === 'MyEco')).toBe(false);
  });
});
