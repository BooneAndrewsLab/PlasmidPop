// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument, reverseComplement } from '@/core';

import { analysisClient } from '@/workers/analysisClient';

import { forgetCrisprSessions, updateCrisprSession } from '../crisprSession';
import { openCrisprWorkspace } from '../crisprWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { CrisprPanel } from './CrisprPanel';
import { CrisprWorkspace } from './CrisprWorkspace';
import { getByTip, getAllByTip } from '@/test/tips';

/** One SpCas9 site: 20 A's and a TGG PAM, then filler with no GG or CC. */
const UNIT = `${'A'.repeat(20)}TGG`;
const FILLER = 'CTCTCTCTCT';

function docOf(sequence: string, topology: 'linear' | 'circular' = 'linear'): SeqDocument {
  return SeqDocument.create({ sequence, topology, name: 'test' });
}

/** The CRISPR tab as the app mounts it: the slim panel, or the workspace while it is open (item 133). */
function Host({ doc }: { doc: SeqDocument }) {
  const { workspace } = useEditorState();
  return workspace === 'crispr' ? <CrisprWorkspace doc={doc} /> : <CrisprPanel doc={doc} />;
}

/**
 * Opens the tab on the document and waits for its scan, with the workspace
 * open on `page` (where every option, filter and result is) unless it is
 * `null`, the slim panel. The all-A spacer most tests use is flagged, and
 * flagged guides are hidden until asked for, so by default this asks for
 * them where it can; pass false to test the default list.
 */
async function openTab(
  doc: SeqDocument,
  page: 'guides' | 'pairs' | 'prime' | null = 'guides',
  showFlagged = true,
) {
  act(() => {
    editorStore.openDocument(doc);
    const { documentId } = editorStore.getState();
    if (page !== null) openCrisprWorkspace(documentId, page);
    else if (showFlagged) updateCrisprSession(documentId, { showFlagged: true });
  });
  const view = render(<Host doc={doc} />);
  // The scan is a worker request even in tests, where it runs inline on a
  // promise: wait for it rather than for a result, since a document with no
  // guides at all is one of the things worth testing.
  await waitFor(() => {
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
  });
  const flagged = screen.queryByRole('button', { name: 'Show flagged' });
  if (showFlagged && flagged !== null) fireEvent.click(flagged);
  return view;
}

/** Waits for a scan in flight, so its answer lands inside the test rather than after it. */
const settled = () =>
  waitFor(() => {
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
  });

/** The slim panel's rows. */
const panelRows = () => document.querySelectorAll('.crispr-list .crispr-row');

/** The Guides table's rows, and the one whose spacer and PAM read `text`. */
const tableRows = () => [
  ...document.querySelectorAll<HTMLElement>('table[role="grid"] tr[data-row]'),
];
const tableRow = (text: RegExp): HTMLElement => {
  const found = tableRows().find((r) => text.test(r.textContent));
  if (found === undefined) throw new Error(`no row like ${String(text)}`);
  return found;
};

describe('CrisprPanel', () => {
  afterEach(() => {
    // Unmounted first: a panel still on screen would scan again on a forgotten session.
    cleanup();
    forgetCrisprSessions();
    forgetPanels();
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('lists the guides and draws them on the views while open', async () => {
    const doc = docOf(`${UNIT}${FILLER}${reverseComplement(UNIT)}`);
    const view = await openTab(doc);

    // One guide on each strand: the second unit is the first's reverse complement.
    await waitFor(() => {
      expect(editorStore.getState().preview?.items).toHaveLength(2);
    });
    const preview = editorStore.getState().preview;
    expect(preview?.owners).toEqual(['crispr']);
    expect(preview?.items.map((i) => [i.label, i.strand, i.shape])).toEqual([
      ['TGG', 'forward', 'arrow'],
      ['TGG', 'reverse', 'arrow'],
    ]);

    // Clicking one on a view opens it here and selects the protospacer.
    const first = preview?.items[0];
    if (first === undefined) throw new Error('no guide was previewed');
    act(() => {
      editorStore.activatePreview(first.id);
    });
    expect(editorStore.getState().selection).toEqual({ start: 0, end: 20 });
    expect(await screen.findByText('Protospacer')).toBeInTheDocument();

    // Leaving the tab takes the arrows off the views.
    view.unmount();
    expect(editorStore.getState().preview).toBeNull();
  });

  it('counts a guide that binds elsewhere exactly, and says so', async () => {
    const doc = docOf(`${UNIT}${FILLER}${UNIT}`);
    await openTab(doc);
    // Both guides share the same spacer, so each is the other's off-target.
    await screen.findByRole('grid', { name: 'Guides' });
    const rows = tableRows();
    expect(rows).toHaveLength(2);
    // Exact, then one, two and three mismatches: a column each.
    expect(
      [...(rows[0]?.querySelectorAll('td') ?? [])].slice(6, 10).map((c) => c.textContent),
    ).toEqual(['1', '0', '0', '0']);
    // The exact second site is the first of the flags; the all-A spacer has others.
    expect(getAllByTip(document.body, /^Binds somewhere else exactly;/)).toHaveLength(2);
  });

  it('filters the list by PAM, by spacer and by flag without rescanning', async () => {
    // Two clean guides with different PAMs, and a third that is all one base.
    const clean1 = 'ACGTACGTACGTACGTACGT';
    const clean2 = 'GATCGATCGATCGATCGATC';
    await openTab(docOf(`${clean1}AGG${FILLER}${clean2}TGG${FILLER}${UNIT}`), 'guides', false);
    const rows = tableRows;
    // The flagged one is hidden until asked for, and the heading says so.
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole('heading', { name: /^Guides/ })).toHaveTextContent('2 of 3');
    const flagged = screen.getByRole('button', { name: 'Show flagged' });
    expect(flagged).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(flagged);
    expect(rows()).toHaveLength(3);
    fireEvent.click(flagged);
    expect(rows()).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('PAM'), { target: { value: 'TGG' } });
    expect(rows()).toHaveLength(1);
    expect(tableRow(/GATCGATC/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('PAM'), { target: { value: '' } });
    // IUPAC: R is A or G, so this is in the first spacer and not the second.
    fireEvent.change(screen.getByLabelText('Spacer contains'), { target: { value: 'crta' } });
    expect(rows()).toHaveLength(1);
    expect(tableRow(/ACGTACGT/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Spacer contains'), { target: { value: 'X' } });
    expect(screen.getByText('No guides match the filters.')).toBeInTheDocument();
  });

  it('opens the chosen guide in the detail pane, without scanning again', async () => {
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    await openTab(docOf(`${UNIT}${FILLER}${UNIT}`));
    await screen.findByRole('grid', { name: 'Guides' });
    const [first, second] = tableRows();
    if (first === undefined || second === undefined) throw new Error('two rows expected');
    expect(scans).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    fireEvent.click(second);
    // A click changes the selection, which is not part of the question asked.
    expect(scans).toHaveBeenCalledTimes(1);
    // The detail pane names the row, which is the one selected and not the other.
    const detail = await screen.findByRole('complementary', { name: 'Guide at 34 (forward)' });
    expect(within(detail).getByText('Protospacer')).toBeInTheDocument();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'false');

    // A second click on the open row closes it and clears the selection.
    fireEvent.click(second);
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    });
    expect(second).toHaveAttribute('aria-selected', 'false');
    expect(editorStore.getState().selection).toBeNull();
  });

  it('says plainly that it has no genome to search, once, then as a tooltip', async () => {
    globalThis.localStorage.clear();
    try {
      await openTab(docOf(`${UNIT}${FILLER}`));
      expect(screen.getByText(/no genome to search/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      expect(screen.queryByText(/no genome to search/)).not.toBeInTheDocument();
      expect(getByTip(document.body, /no genome to search/)).toHaveTextContent('Off-targets up to');
      expect(globalThis.localStorage.getItem('plasmidpop.crisprOffTargetNoteSeen')).toBe('1');
    } finally {
      globalThis.localStorage.clear();
    }
  });

  it('refuses a custom PAM that is not IUPAC, and scans once it is', async () => {
    // TGA is no PAM for SpCas9, but it is one for a custom NGA.
    await openTab(docOf(`${'A'.repeat(20)}TGA${FILLER}`, 'linear'));
    expect(screen.getByText(/No guides/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'custom' } });
    const pam = screen.getByLabelText('PAM in IUPAC codes');
    fireEvent.change(pam, { target: { value: 'NXG' } });
    expect(await screen.findByText(/not an IUPAC base/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Spacer contains')).not.toBeInTheDocument();

    // The all-A guide it finds is flagged: the page is the filters over a list of none shown.
    fireEvent.change(pam, { target: { value: 'NGA' } });
    expect(await screen.findByLabelText('Spacer contains')).toBeInTheDocument();
  });

  it('writes the pX330 oligos for the guide chosen', async () => {
    const spacer = 'ACCTGCATTGGCATTGCATT';
    await openTab(docOf(`${spacer}TGG${FILLER}`));
    await screen.findByRole('grid', { name: 'Guides' });
    fireEvent.click(tableRow(/ACCTGCATTGGCATTGCATT/));

    expect(await screen.findByText('Oligos to order')).toBeInTheDocument();
    // The U6 promoter wants a G, which this spacer has not got.
    expect(screen.getByText('CACCGACCTGCATTGGCATTGCATT')).toBeInTheDocument();
    expect(screen.getByText('AAACAATGCAATGCCAATGCAGGTC')).toBeInTheDocument();
  });

  it('holds the region it was narrowed to while guides in it are clicked', async () => {
    // Three guides, cutting at 17, 50 and 83; a selection over the last two.
    await openTab(docOf([UNIT, UNIT, UNIT].join(FILLER)), null);
    act(() => {
      editorStore.setSelection({ start: 40, end: 89 });
    });
    fireEvent.click(screen.getByLabelText('Only cuts in the selection'));
    await waitFor(() => {
      expect(panelRows()).toHaveLength(2);
    });

    // Clicking a guide selects its protospacer. Were the region read from
    // the selection, the other guide would drop out of the list it was
    // clicked in and the selection to get back to would be gone.
    const [first] = screen.getAllByRole('button', { name: /AAAAAAAAAAAAAAAAAAAA/ });
    if (first === undefined) throw new Error('no guide was listed');
    fireEvent.click(first);
    expect(editorStore.getState().selection).toEqual({ start: 33, end: 53 });
    expect(await screen.findByRole('button', { name: 'Add as feature' })).toBeInTheDocument();
    expect(panelRows()).toHaveLength(2);
    expect(screen.getByLabelText('Only cuts in the selection')).toBeChecked();

    // A new selection is taken up only when asked for.
    act(() => {
      editorStore.setSelection({ start: 0, end: 30 });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Use the selection now' }));
    await waitFor(() => {
      expect(panelRows()).toHaveLength(1);
    });
  });

  it('drops the Cas9 sgRNA overhangs for a nuclease they would not clone', async () => {
    await openTab(docOf(`TTTA${'A'.repeat(23)}${FILLER}`));
    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'ascas12a' } });
    // The all-A guide is flagged, and SpCas9 found none for the helper to ask for.
    fireEvent.click(await screen.findByRole('button', { name: 'Show flagged' }));
    await screen.findByRole('grid', { name: 'Guides' });
    fireEvent.click(tableRow(/A{23}/));

    const overhangs = await screen.findByLabelText('Overhangs');
    expect([...overhangs.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'No overhangs',
    ]);
  });

  it('adds the chosen guide to the document as a feature', async () => {
    const doc = docOf(`${UNIT}${FILLER}`);
    await openTab(doc);
    await screen.findByRole('grid', { name: 'Guides' });
    fireEvent.click(tableRow(/AAAAAAAAAAAAAAAAAAAA/));
    fireEvent.click(await screen.findByRole('button', { name: 'Add as feature' }));

    const state = editorStore.getState().documents[0];
    if (state === undefined) throw new Error('the document was not opened');
    const features = [...state.history.present.features.all()];
    expect(features).toHaveLength(1);
    expect(features[0]?.strand).toBe('forward');
    expect(features[0]?.segments).toMatchObject([{ start: 0, end: 20 }]);
    expect(features[0]?.qualifiers).toContainEqual({
      name: 'note',
      value: 'CRISPR protospacer, TGG PAM',
    });
    // The workspace stays where it is: it says what it did and offers Undo (D8).
    expect(editorStore.getState()).toMatchObject({ workspace: 'crispr', sidebarTab: 'crispr' });
    expect(screen.getByText(/^Added 1 feature\./)).toBeInTheDocument();
  });

  it('adds every listed guide as a feature in one step to undo', async () => {
    const doc = docOf(`${UNIT}${FILLER}`);
    await openTab(doc);
    fireEvent.click(
      await screen.findByRole('button', { name: /^Add (all )?\d+ listed as features$/ }),
    );

    const state = editorStore.getState().documents[0];
    if (state === undefined) throw new Error('the document was not opened');
    const features = [...state.history.present.features.all()];
    expect(features.length).toBeGreaterThan(0);
    expect(features.every((f) => f.type === 'misc_feature')).toBe(true);
    act(() => {
      editorStore.undo();
    });
    expect([
      ...(editorStore.getState().documents[0]?.history.present.features.all() ?? []),
    ]).toHaveLength(0);
  });

  it('marks the base editor window on each guide and filters to the editable ones', async () => {
    // The first spacer has C's at positions 4 and 8; the second has none in 4-8.
    const withC = 'GATCGATCGATCGATCGATC';
    const noC = 'GAGAGAGAGAGAGAGAGAGA';
    await openTab(docOf(`${withC}TGG${FILLER}${noC}AGG`), 'guides', false);
    fireEvent.change(screen.getByLabelText('Base editor'), { target: { value: 'cbe' } });
    expect(
      getAllByTip(document.body, 'C to T edits in the window').map((e) => e.textContent),
    ).toEqual(['2', '0']);
    fireEvent.click(screen.getByRole('button', { name: 'Only with a C to edit' }));
    fireEvent.click(tableRow(/GATCGATC/));
    expect(screen.getByText(/^C4, C8 \(/)).toBeInTheDocument();
    expect(screen.getByText('GATTGATTGATCGATCGATC')).toBeInTheDocument();
    expect(tableRows().some((r) => r.textContent.includes('GAGAGAGA'))).toBe(false);
  });

  it('does not scan again when the tab is mounted again, and keeps its settings', async () => {
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    const doc = docOf(`${UNIT}${FILLER}${reverseComplement(UNIT)}`);
    const view = await openTab(doc);
    const before = scans.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Spacer contains'), { target: { value: 'AAAA' } });
    view.unmount();

    // The tab was left and came back: the answer and the filter are still there.
    render(<Host doc={doc} />);
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Spacer contains')).toHaveValue('AAAA');
    expect(tableRows()).toHaveLength(2);
    expect(scans.mock.calls.length).toBe(before);
  });

  it('takes the answer of a scan started in a panel that is gone', async () => {
    const doc = docOf(`${UNIT}${FILLER}${UNIT}`);
    act(() => {
      editorStore.openDocument(doc);
    });
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    const before = scans.mock.calls.length;
    render(<CrisprPanel doc={doc} />).unmount();
    // The scan was asked for and its result lands with nobody mounted.
    render(<CrisprPanel doc={doc} />);
    await waitFor(() => {
      expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
    });
    expect(scans.mock.calls.length).toBe(before + 1);
  });
});

/** Ten spaced-out guides with plain spacers, so none is flagged and more than eight are listed. */
function manyGuides(): SeqDocument {
  const bases = ['ACGT', 'GATC', 'CAGT', 'TGCA', 'AGCT'];
  const units = Array.from({ length: 10 }, (_, i) => {
    const b = bases[i % bases.length] ?? 'ACGT';
    // Distinct, unflagged spacers: no run, GC in range, no TTTT.
    return b.repeat(5).slice(0, 18) + (i < 5 ? 'AC' : 'GT') + 'TGG';
  });
  return docOf(units.join(FILLER));
}

describe('CrisprPanel, the slim tab (item 133, C3)', () => {
  afterEach(() => {
    cleanup();
    forgetCrisprSessions();
    forgetPanels();
    vi.restoreAllMocks();
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('keeps to the nuclease, the region, a status line, the rows and the links', async () => {
    await openTab(docOf(`${UNIT}${FILLER}`), null);
    expect(screen.getByLabelText('Nuclease')).toBeInTheDocument();
    expect(screen.getByLabelText('Only cuts in the selection')).toBeInTheDocument();
    for (const gone of [
      'Off-targets up to',
      'Spacer contains',
      'Sort by',
      'Show flagged',
      'Base editor',
    ]) {
      expect(screen.queryByLabelText(gone)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Options')).not.toBeInTheDocument();
    expect(screen.queryByText(/Add (all )?\d+ listed as features/)).not.toBeInTheDocument();
    expect(screen.queryByText('Oligos to order')).not.toBeInTheDocument();
  });

  it('says what was found in a status line, and lists at most eight guides', async () => {
    await openTab(manyGuides(), null, false);
    expect(screen.getByRole('status')).toHaveTextContent(
      /^\d+ guides, \d+ without flags\. The first 8 are listed\.$/,
    );
    expect(panelRows()).toHaveLength(8);
  });

  it('counts the flagged guides out of the clean ones, and says when nothing is listed', async () => {
    await openTab(docOf(`${UNIT}${FILLER}`), null, false);
    expect(screen.getByRole('status')).toHaveTextContent('1 guide, 0 without flags. None match');
    expect(panelRows()).toHaveLength(0);
  });

  it('says when there are no guides, and while it looks', async () => {
    act(() => {
      editorStore.openDocument(docOf(`${'A'.repeat(20)}TGA${FILLER}`));
    });
    render(<CrisprPanel doc={docOf(`${'A'.repeat(20)}TGA${FILLER}`)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Looking for guides…');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^No guides\./);
    });
  });

  it('ellipsizes the spacer rather than scrolling sideways', async () => {
    await openTab(manyGuides(), null, false);
    const row = panelRows()[0];
    expect(row?.querySelector('.crispr-row__spacer')).not.toBeNull();
    // jsdom has no layout: the contract is the class the stylesheet shrinks.
    expect(row?.parentElement?.parentElement).toHaveClass('crispr-list');
  });

  it('selects and reveals a guide on a click, with Add as feature and Details under it', async () => {
    const doc = docOf(`${UNIT}${FILLER}${UNIT}`);
    await openTab(doc, null);
    expect(screen.queryByRole('button', { name: 'Details ›' })).not.toBeInTheDocument();
    const [first, second] = panelRows();
    if (first === undefined || second === undefined) throw new Error('two rows expected');
    fireEvent.click(second);
    expect(editorStore.getState().selection).toEqual({ start: 33, end: 53 });
    expect(second).toHaveAttribute('aria-expanded', 'true');
    // Only the open row has them, and no detail is opened in the panel.
    expect(screen.getAllByRole('button', { name: 'Details ›' })).toHaveLength(1);
    expect(second.parentElement?.querySelector('.crispr-actions')).not.toBeNull();
    expect(first.parentElement?.querySelector('.crispr-actions')).toBeNull();
    expect(document.querySelector('.crispr-detail')).toBeNull();
    // The open row closes on a second click, and the selection goes with it.
    fireEvent.click(second);
    expect(editorStore.getState().selection).toBeNull();
    expect(screen.queryByRole('button', { name: 'Details ›' })).not.toBeInTheDocument();
  });

  it('shows a guide clicked on the map even when it is past the first eight', async () => {
    await openTab(manyGuides(), null, false);
    const preview = editorStore.getState().preview;
    const last = preview?.items[9];
    if (last === undefined) throw new Error('ten guides were previewed');
    expect(panelRows()).toHaveLength(8);
    act(() => {
      editorStore.activatePreview(last.id);
    });
    await waitFor(() => {
      expect(panelRows()).toHaveLength(9);
    });
    expect(screen.getByRole('button', { name: 'Add as feature' })).toBeInTheDocument();
  });

  it('opens the workspace on Guides with that guide open from Details ›', async () => {
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    await openTab(docOf(`${UNIT}${FILLER}${UNIT}`), null);
    const before = scans.mock.calls.length;
    const [, second] = panelRows();
    if (second === undefined) throw new Error('two rows expected');
    fireEvent.click(second);
    fireEvent.click(screen.getByRole('button', { name: 'Details ›' }));
    expect(editorStore.getState().workspace).toBe('crispr');
    expect(screen.getByRole('tab', { name: /^Guides/ })).toHaveAttribute('aria-selected', 'true');
    // The workspace's table has the same guide open, with its details beside it.
    expect(tableRows()[1]).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('complementary', { name: 'Guide at 34 (forward)' }),
    ).toBeInTheDocument();
    expect(editorStore.getState().selection).toEqual({ start: 33, end: 53 });
    expect(scans.mock.calls.length).toBe(before);
  });

  it('opens the workspace from its door, and the keyboard comes back to it on Escape', async () => {
    await openTab(docOf(`${UNIT}${FILLER}`), null);
    // The tab's own door: Escape stays on this tab (a link on another tab goes back to it, #404).
    act(() => {
      editorStore.setSidebarTab('crispr');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open CRISPR workspace ›' }));
    expect(editorStore.getState().workspace).toBe('crispr');
    fireEvent.keyDown(screen.getByRole('heading', { name: /^Guides/ }), { key: 'Escape' });
    expect(editorStore.getState().workspace).toBeNull();
    expect(screen.getByRole('button', { name: 'Open CRISPR workspace ›' })).toHaveFocus();
  });

  it('offers Paired nickases and Prime editing only for a nuclease that allows them', async () => {
    await openTab(docOf(`${UNIT}${FILLER}`), null);
    expect(screen.getByRole('button', { name: 'Paired nickases ›' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prime editing ›' })).toBeInTheDocument();

    // AsCas12a has the PAM before the guide and a staggered cut.
    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'ascas12a' } });
    await settled();
    expect(screen.getByRole('button', { name: 'Open CRISPR workspace ›' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Paired nickases ›' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prime editing ›' })).not.toBeInTheDocument();

    // A custom PAM that is no PAM has none either, but the workspace door stays.
    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'custom' } });
    await settled();
    fireEvent.change(screen.getByLabelText('PAM in IUPAC codes'), { target: { value: 'NXG' } });
    await settled();
    expect(screen.getByText(/not an IUPAC base/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prime editing ›' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open CRISPR workspace ›' })).toBeInTheDocument();
  });

  it('opens the pages the two doors name', async () => {
    await openTab(docOf(`${UNIT}${FILLER}`), null);
    fireEvent.click(screen.getByRole('button', { name: 'Paired nickases ›' }));
    expect(screen.getByRole('heading', { name: 'Paired nickases' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close the crispr workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Prime editing ›' }));
    expect(screen.getByRole('heading', { name: 'Prime editing' })).toBeInTheDocument();
  });

  it('keeps the nuclease and does not scan again when it goes to the workspace and back', async () => {
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    await openTab(docOf(`${UNIT}${FILLER}${reverseComplement(UNIT)}`), null);
    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'sacas9' } });
    await waitFor(() => {
      expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
    });
    const before = scans.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Open CRISPR workspace ›' }));
    expect(screen.getByLabelText('Nuclease')).toHaveValue('sacas9');
    fireEvent.click(screen.getByRole('button', { name: /close the crispr workspace/i }));
    expect(screen.getByLabelText('Nuclease')).toHaveValue('sacas9');
    expect(scans.mock.calls.length).toBe(before);
  });

  it('takes a custom PAM and spacer length in the panel', async () => {
    await openTab(docOf(`${UNIT}${FILLER}`), null);
    expect(screen.queryByLabelText('PAM in IUPAC codes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'custom' } });
    await settled();
    expect(screen.getByLabelText('PAM in IUPAC codes')).toBeInTheDocument();
    expect(screen.getByLabelText('Spacer (nt)')).toBeInTheDocument();
  });

  it('adds the chosen guide as a feature from the panel', async () => {
    await openTab(docOf(`${UNIT}${FILLER}`), null);
    fireEvent.click(screen.getByRole('button', { name: /A{20}/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add as feature' }));
    const features = [
      ...(editorStore.getState().documents[0]?.history.present.features.all() ?? []),
    ];
    expect(features).toHaveLength(1);
    expect(features[0]?.segments).toMatchObject([{ start: 0, end: 20 }]);
    // The panel's Add takes you to the feature list to name it, as it always did.
    expect(editorStore.getState().sidebarTab).toBe('features');
  });

  it('draws the guides on the views from the panel, and takes them off when it goes', async () => {
    const view = await openTab(docOf(`${UNIT}${FILLER}${reverseComplement(UNIT)}`), null);
    await waitFor(() => {
      expect(editorStore.getState().preview?.items).toHaveLength(2);
    });
    const first = editorStore.getState().preview?.items[0];
    if (first === undefined) throw new Error('no guide was previewed');
    act(() => {
      editorStore.activatePreview(first.id);
    });
    expect(editorStore.getState().selection).toEqual({ start: 0, end: 20 });
    expect(await screen.findByRole('button', { name: 'Add as feature' })).toBeInTheDocument();
    view.unmount();
    expect(editorStore.getState().preview).toBeNull();
  });
});
