// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import {
  type CutSite,
  type Enzyme,
  SeqDocument,
  activeEnzymes,
  enzymeDigest,
  findCutSites,
  getEnzyme,
  setActiveEnzymeSet,
} from '@/core';

import { packCutSites, packEnzymeDigest, unpackScan } from '@/workers/analysisProtocol';

import { type EnzymePage, openEnzymeWorkspace, recallEnzymePage } from '../enzymeWorkspace';
import { MAX_DEFAULT_ENZYMES, editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { EnzymePanel } from './EnzymePanel';
import { EnzymeWorkspace } from './EnzymeWorkspace';
import { getByTip } from '@/test/tips';

// 4,000 bp, linear: the fragment sizes below are cut positions on it.
const doc = SeqDocument.create({ sequence: 'ACGT'.repeat(1000) });

/** The first `n` enzymes of the active table, each cutting the document once. */
function singleCutters(n: number): CutSite[] {
  return activeEnzymes()
    .slice(0, n)
    .map((enzyme, i) => ({
      enzyme: enzyme.name,
      cut: i * 10 + 1,
      cutBottom: i * 10 + 1,
      siteStart: i * 10,
      strand: 'forward' as const,
    }));
}

/**
 * Cut sites for the first enzymes of the table, one entry per enzyme saying
 * how many times it cuts.
 */
function cutsEach(counts: readonly number[]): CutSite[] {
  const sites: CutSite[] = [];
  activeEnzymes()
    .slice(0, counts.length)
    .forEach((enzyme, i) => {
      for (let n = 0; n < (counts[i] ?? 0); n++) {
        const cut = i * 100 + n * 10 + 1;
        sites.push({
          enzyme: enzyme.name,
          cut,
          cutBottom: cut,
          siteStart: cut - 1,
          strand: 'forward' as const,
        });
      }
    });
  return sites;
}

/** The enzyme names of the rows the list is showing. */
function listed(): (string | null)[] {
  return [...document.querySelectorAll('.enzyme-row__name')].map((n) => n.textContent);
}

/** The Enzymes tab as the app mounts it: the slim panel, or the workspace while it is open (item 133). */
function Host({ doc: d }: { doc: SeqDocument }) {
  const { workspace } = useEditorState();
  return workspace === 'enzymes' ? <EnzymeWorkspace doc={d} /> : <EnzymePanel doc={d} />;
}

/**
 * Opens the document with `sites` as its scan and renders the tab, with the
 * workspace open on `page` where the full list, the digest and the pairs are,
 * or as the slim panel with `null`.
 */
function setup(sites: readonly CutSite[], page: EnzymePage | null = 'enzymes') {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setAnalysis(doc, sites, []);
    if (page !== null) openEnzymeWorkspace(editorStore.getState().documentId, page);
  });
  return render(<Host doc={doc} />);
}

/** The pairs the Double page lists, "A + B" a row, in its order. */
function pairNames(): string[] {
  return [...document.querySelectorAll('table[aria-label="Double digests"] tbody tr')].map((r) =>
    [...r.querySelectorAll('.enzyme-row__pair')].map((c) => c.textContent).join(' + '),
  );
}

/** Goes to one of the workspace's pages by its rail tab. */
function goTo(name: 'Enzymes' | 'Digest' | 'Double' | 'Table'): void {
  act(() => {
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
  });
}

describe('EnzymePanel', () => {
  beforeEach(() => {
    act(() => {
      editorStore.setEnzymeCutFilter('any');
      editorStore.setEnzymeSupplier('');
      editorStore.setEnzymeSort('name');
      editorStore.setEnzymeSortReversed(false);
      editorStore.setGelAgarose(1);
      editorStore.setGelLadder('auto');
    });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      editorStore.closeDocument();
    });
    forgetPanels();
  });

  it('ticks a handful of single cutters by itself', () => {
    setup(singleCutters(5), null);
    expect(editorStore.getState().shownEnzymes.size).toBe(5);
    expect(screen.queryByText(/enzymes that cut once/)).toBeNull();
  });

  it("ticks them from the worker's count of sites when it has one (item 98)", () => {
    const sites = cutsEach([1, 2, 1, 3]);
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setAnalysis(
        doc,
        sites,
        [],
        enzymeDigest(sites, doc.sequence.toString(), 'linear'),
      );
    });
    expect([...editorStore.getState().shownEnzymes]).toEqual(
      activeEnzymes()
        .slice(0, 4)
        .filter((_, i) => i % 2 === 0)
        .map((e) => e.name),
    );
  });

  it('shows the bands each enzyme alone would give, and warns about a muddy one', () => {
    const names = activeEnzymes()
      .slice(0, 3)
      .map((e) => e.name);
    const [clean, muddy, single] = names;
    if (clean === undefined || muddy === undefined || single === undefined)
      throw new Error('table');
    const at = (enzyme: string, cut: number): CutSite => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut - 1,
      strand: 'forward' as const,
    });
    // The document is 4,000 bp and linear: 400 + 3,600 reads at a glance,
    // 2,000 + 2,000 is one band.
    setup([at(clean, 400), at(muddy, 2000), at(single, 1000)]);
    const bands = [...document.querySelectorAll('.enzyme-row__bands')].map((n) => n.textContent);
    expect(bands[0]).toBe('3,600 + 400 bp');
    expect(bands[1]).toBe('2,000 ×2 bp ⚠');
    // One cut on a linear molecule is two pieces; a warning only when they
    // cannot be told apart.
    expect(bands[2]).toBe('3,000 + 1,000 bp');
    const warned = document.querySelectorAll('.enzyme-row__bands--muddy');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.getAttribute('data-tip')).toMatch(/run together/);
  });

  it('says how everything ticked together would read on a gel', () => {
    const names = activeEnzymes()
      .slice(0, 2)
      .map((e) => e.name);
    const [a, b] = names;
    if (a === undefined || b === undefined) throw new Error('table');
    const at = (enzyme: string, cut: number): CutSite => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut - 1,
      strand: 'forward' as const,
    });
    // Ticked together the two enzymes give 400, 1,700 and 1,900: the last
    // two are within 15 % and run as one band, which neither enzyme's own
    // line can say.
    setup([at(a, 400), at(b, 2100)], 'digest');
    act(() => {
      editorStore.setShownEnzymes([a, b]);
    });
    expect(screen.getByTestId('gel-reading').textContent).toBe(
      'On a gel: 1,900 ×2 + 400 bp — 1,900 and 1,700 run together.',
    );
    act(() => {
      editorStore.setShownEnzymes([a]);
    });
    expect(screen.getByTestId('gel-reading').textContent).toBe(
      'On a gel: 2 bands, 3,600 + 400 bp.',
    );
  });

  it('draws the lane, and a click on a band selects the piece it is', () => {
    const names = activeEnzymes()
      .slice(0, 2)
      .map((e) => e.name);
    const [a, b] = names;
    if (a === undefined || b === undefined) throw new Error('table');
    const at = (enzyme: string, cut: number): CutSite => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut - 1,
      strand: 'forward' as const,
    });
    setup([at(a, 400), at(b, 2100)], 'digest');
    act(() => {
      editorStore.setShownEnzymes([a, b]);
    });
    // A double digest is drawn beside the two single ones: each enzyme alone
    // cuts the linear 4 kb into two (b's two within 15 % of each other, so one
    // band), and together they give 400, 1,700 and 1,900 bp, two of them under
    // one band.
    const lanes = [...document.querySelectorAll('.gel__lane')];
    expect(lanes.map((l) => l.getAttribute('data-lane'))).toEqual([a, b, 'Both']);
    expect(lanes.map((l) => l.querySelectorAll('.gel__band').length)).toEqual([2, 1, 2]);
    expect(screen.getByTestId('gel-singles').textContent).toBe(
      `Beside it, each alone: ${a} 3,600 + 400 bp; ${b} 2,100 ×2 bp.`,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Both: 1,900 and 1,700 bp run here; select the 1,900 bp one',
      }),
    );
    // The 1,900 bp piece is the one from 2,100 to the end.
    expect(editorStore.getState().selection).toEqual({ start: 2100, end: 4000 });
    // A single lane's band is that enzyme's own piece.
    fireEvent.click(
      screen.getByRole('button', {
        name: `${b} alone: 2,100 and 1,900 bp run here; select the 2,100 bp one`,
      }),
    );
    expect(editorStore.getState().selection).toEqual({ start: 0, end: 2100 });

    // Past three enzymes the lane is a survey and stands alone, headed by a count.
    const four = activeEnzymes()
      .slice(2, 4)
      .map((e) => e.name);
    act(() => {
      editorStore.setAnalysis(
        doc,
        [at(a, 400), at(b, 2100), ...four.map((n, i) => at(n, 3000 + i * 500))],
        [],
      );
      editorStore.setShownEnzymes([a, b, ...four]);
    });
    expect(document.querySelectorAll('.gel__lane')).toHaveLength(1);
    expect(screen.getByText('4 enzymes')).toBeInTheDocument();
    expect(screen.queryByTestId('gel-singles')).toBeNull();

    act(() => {
      editorStore.setShownEnzymes([a]);
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Select the 400 bp fragment in the views' }),
    );
    expect(editorStore.getState().selection).toEqual({ start: 0, end: 400 });
  });

  /** Three enzymes whose lanes differ: a one band, b 9x apart, c 1.5x apart. */
  function threeLanes(): [string, string, string] {
    const [a, b, c] = activeEnzymes()
      .slice(0, 3)
      .map((e) => e.name);
    if (a === undefined || b === undefined || c === undefined) throw new Error('table');
    const at = (enzyme: string, cut: number): CutSite => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut - 1,
      strand: 'forward' as const,
    });
    // a: 2,000 + 2,000 (one band), b: 3,600 + 400 (9x), c: 2,400 + 1,600 (1.5x).
    setup([at(a, 2000), at(b, 400), at(c, 1600)]);
    return [a, b, c];
  }

  const header = (name: 'Name' | 'Bands'): HTMLElement =>
    screen.getByRole('button', { name: new RegExp(`^${name}`) });
  const sortOf = (name: 'Name' | 'Bands'): string | null =>
    header(name).closest('th')?.getAttribute('aria-sort') ?? null;

  it('orders by band separation from the Bands heading, and by name from Name', () => {
    const [a, b, c] = threeLanes();
    expect(listed()).toEqual([a, b, c]);
    expect(sortOf('Name')).toBe('ascending');
    expect(sortOf('Bands')).toBeNull();
    act(() => {
      fireEvent.click(header('Bands'));
    });
    expect(editorStore.getState()).toMatchObject({
      enzymeSort: 'bands',
      enzymeSortReversed: false,
    });
    expect(listed()).toEqual([b, c, a]);
    expect(sortOf('Bands')).toBe('ascending');
    expect(sortOf('Name')).toBeNull();
    act(() => {
      fireEvent.click(header('Name'));
    });
    expect(editorStore.getState().enzymeSort).toBe('name');
    expect(listed()).toEqual([a, b, c]);
  });

  it('turns the order round on a second click of the heading', () => {
    const [a, b, c] = threeLanes();
    act(() => {
      fireEvent.click(header('Bands'));
    });
    act(() => {
      fireEvent.click(header('Bands'));
    });
    expect(editorStore.getState().enzymeSortReversed).toBe(true);
    expect(sortOf('Bands')).toBe('descending');
    // Hardest to read first: a's one band, then c's 1.5x, then b's 9x.
    expect(listed()).toEqual([a, c, b]);
    act(() => {
      fireEvent.click(header('Name'));
    });
    // Another column starts ascending.
    expect(editorStore.getState().enzymeSortReversed).toBe(false);
    act(() => {
      fireEvent.click(header('Name'));
    });
    expect(sortOf('Name')).toBe('descending');
    expect(listed()).toEqual([c, b, a]);
    // The choice is the store's, which the panel and a reload read.
    act(() => {
      editorStore.setEnzymeSort('bands');
      editorStore.setEnzymeSortReversed(false);
    });
    expect(sortOf('Bands')).toBe('ascending');
    expect(listed()).toEqual([b, c, a]);
  });

  it('judges and draws the lanes for the agarose chosen, beside the ladder chosen', () => {
    const [a] = activeEnzymes().map((e) => e.name);
    if (a === undefined) throw new Error('table');
    // 3,920 + 80 bp: the 80 runs off a 1 % gel, and stays on a 2 % one.
    setup([{ enzyme: a, cut: 80, cutBottom: 80, siteStart: 79, strand: 'forward' }]);
    act(() => {
      editorStore.setShownEnzymes([a]);
    });
    expect(document.querySelector('.enzyme-row__bands--muddy')).not.toBeNull();
    // The gel and its settings are on the Digest page; the list's marks follow them.
    goTo('Digest');
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Agarose' }), {
        target: { value: '2' },
      });
    });
    expect(editorStore.getState().gelAgarose).toBe(2);
    expect(screen.getByText(/model of a 2 % gel/)).toBeVisible();
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Ladder' }), {
        target: { value: '100 bp' },
      });
    });
    expect(document.querySelector('.gel__svg')?.getAttribute('aria-label')).toMatch(
      /100 bp ladder$/,
    );
    goTo('Enzymes');
    expect(document.querySelector('.enzyme-row__bands--muddy')).toBeNull();
  });

  it('offers the best double digests on the Double page', () => {
    const names = activeEnzymes()
      .slice(0, 3)
      .map((e) => e.name);
    const [a, b, c] = names;
    if (a === undefined || b === undefined || c === undefined) throw new Error('table');
    const at = (enzyme: string, cut: number): CutSite => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut - 1,
      strand: 'forward' as const,
    });
    // On the linear 4 kb: a+b cut it into 1,000 + 1,000 + 2,000 (two run
    // together, so not offered), b+c into 2,000 + 1,500 + 500, a+c into
    // 1,000 + 2,500 + 500.
    setup([at(a, 1000), at(b, 2000), at(c, 3500)], 'pairs');
    const pairs = pairNames();
    // Each pair is named alphabetically, whatever order the list is in.
    const named = (x: string, y: string) => [x, y].sort((p, q) => p.localeCompare(q)).join(' + ');
    expect(pairs).toEqual([named(a, c), named(b, c)]);

    const [best] = screen.getAllByRole('button', { name: 'Tick both' });
    if (best === undefined) throw new Error('no pair offered');
    fireEvent.click(best);
    expect([...editorStore.getState().shownEnzymes].sort()).toEqual([a, c].sort());
    // The ticked pair says so, and the gel below draws it beside each alone.
    expect(screen.getByRole('button', { name: 'Ticked' })).toBeDisabled();
    goTo('Digest');
    expect(
      [...document.querySelectorAll('.gel__lane')].map((l) => l.getAttribute('data-lane')),
    ).toEqual([a, c, 'Both']);
  });

  it('finds a partner for one enzyme among every enzyme, whatever the list shows', () => {
    const [a, b, c] = activeEnzymes()
      .slice(0, 3)
      .map((e) => e.name);
    if (a === undefined || b === undefined || c === undefined) throw new Error('table');
    const at = (enzyme: string, cut: number): CutSite => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut - 1,
      strand: 'forward' as const,
    });
    // On the 4,000 bp linear document: a + b is 2,500 + 1,000 + 500; a + c
    // and b + c both leave two pieces within 15 % of each other.
    setup([at(a, 1000), at(b, 1500), at(c, 2900)]);
    act(() => {
      editorStore.setShownEnzymes([a]);
    });
    // Filtered down to one enzyme, the listed pairs have nothing to pair.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter enzymes' }), {
      target: { value: c },
    });
    goTo('Double');
    const section = screen.getByTestId('double-digests');
    expect(section).toHaveTextContent('Fewer than two of the enzymes listed');
    // One enzyme ticked: offered as the one to find a partner for.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: `Find a partner for ${a}` }));
    });
    expect(screen.getByRole('combobox', { name: 'Pair' })).toHaveValue(a);
    expect(pairNames()).toEqual([`${a} + ${b}`]);
    expect(section).toHaveTextContent(`Partners for ${a} among all 2 enzymes`);
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Pair' }), { target: { value: c } });
    });
    expect(section).toHaveTextContent(`No enzyme with ${c} gives a lane`);
  });

  it.each([null, 'enzymes'] as const)(
    'offers the single cutters when there were too many to tick (%s)',
    (page) => {
      setup(singleCutters(MAX_DEFAULT_ENZYMES + 1), page);
      expect(editorStore.getState().shownEnzymes.size).toBe(0);
      const offer = screen.getByRole('button', {
        name: `Tick the ${MAX_DEFAULT_ENZYMES + 1} enzymes that cut once`,
      });
      act(() => {
        fireEvent.click(offer);
      });
      expect(editorStore.getState().shownEnzymes.size).toBe(MAX_DEFAULT_ENZYMES + 1);
    },
  );
});

describe('the slim EnzymePanel (item 133, E3)', () => {
  const COUNTS = [1, 1, 1, 2, 2, 3, 4];
  const names = activeEnzymes()
    .slice(0, COUNTS.length)
    .map((e) => e.name);

  beforeEach(() => {
    act(() => {
      editorStore.setEnzymeCutFilter('any');
      editorStore.setEnzymeSupplier('');
      editorStore.setEnzymeSort('name');
      editorStore.setEnzymeSortReversed(false);
      editorStore.setEnzymeGroupIsoschizomers(true);
      editorStore.setShowCutSites(true);
    });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      editorStore.setEnzymeGroupIsoschizomers(true);
      editorStore.setShowCutSites(true);
      editorStore.closeDocument();
    });
    forgetPanels();
  });

  const search = (text: string): void => {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter enzymes' }), {
      target: { value: text },
    });
  };

  it('keeps to the filter, the summary, the ticked rows and the links, and nothing of the list', () => {
    setup(cutsEach(COUNTS), null);
    expect(screen.getByRole('searchbox', { name: 'Filter enzymes' })).toBeVisible();
    // The three single cutters are ticked by themselves; the other four are
    // the workspace's to list.
    expect(listed()).toEqual(names.slice(0, 3));
    for (const label of ['Cuts', 'Order', 'Show listed', 'Add enzyme…', 'Import a REBASE table…']) {
      expect(screen.queryByLabelText(label)).toBeNull();
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(document.querySelector('.enzyme-list__scroll')).toBeNull();
    expect(screen.queryByText(/enzymes cut/)).toBeNull();
    expect(screen.queryByTestId('double-digests')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Fragments from ticked enzymes/ })).toBeNull();
    expect(document.querySelector('.gel')).toBeNull();
  });

  it('sums the enzymes up in a status line, and says when it is still scanning', () => {
    act(() => {
      editorStore.openDocument(doc);
    });
    render(<Host doc={doc} />);
    expect(screen.getByRole('status')).toHaveTextContent('Scanning for restriction sites…');
    act(() => {
      editorStore.setAnalysis(doc, cutsEach(COUNTS), []);
    });
    const total = activeEnzymes().length;
    expect(screen.getByRole('status')).toHaveTextContent(
      `${total} enzymes: 3 cut once, 4 more than once, ${total - 7} not at all. 3 ticked.`,
    );
    act(() => {
      editorStore.setShownEnzymes([]);
    });
    expect(screen.getByRole('status')).toHaveTextContent(/ 0 ticked\.$/);
  });

  it('lists what a search finds, ticks one of them, and goes back to the ticked rows', () => {
    setup(cutsEach(COUNTS), null);
    search(names[3] ?? '');
    expect(listed()).toEqual([names[3]]);
    const row = document.querySelector('.enzyme-row');
    const box = row?.querySelector('input');
    if (!box) throw new Error('no tick box');
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect([...editorStore.getState().shownEnzymes]).toContain(names[3]);
    search('');
    expect(listed()).toEqual([...names.slice(0, 3), names[3]]);
    // The same search by site.
    const site = getEnzyme(names[0] ?? '')?.site ?? '';
    search(site.toLowerCase());
    expect(listed()).toContain(names[0]);
  });

  it('lists every ticked enzyme whatever the table is filtered to (#406)', () => {
    setup(cutsEach(COUNTS), null);
    expect(listed()).toEqual(names.slice(0, 3));
    // The workspace's Cuts filter narrows its table, not what is ticked.
    act(() => {
      editorStore.setEnzymeCutFilter('twice');
    });
    expect(listed()).toEqual(names.slice(0, 3));
    expect(screen.getByText(/3 ticked\./)).toBeInTheDocument();
  });

  it('lists a dozen matches and links to the rest in the workspace, with the filter kept', () => {
    act(() => {
      editorStore.setEnzymeGroupIsoschizomers(false);
    });
    setup(singleCutters(100), null);
    search('g');
    // Only enzymes that cut are listed.
    const matching = activeEnzymes()
      .slice(0, 100)
      .filter(
        (e) => e.name.toLowerCase().includes('g') || e.site.toLowerCase().includes('g'),
      ).length;
    expect(matching).toBeGreaterThan(12);
    expect(listed()).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: `and ${matching - 12} more ›` }));
    expect(editorStore.getState().workspace).toBe('enzymes');
    expect(screen.getByRole('heading', { name: /^Enzymes/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Filter enzymes' })).toHaveValue('g');
    expect(listed().length).toBeGreaterThan(0);
  });

  it('has no "and N more" for twelve matches or fewer, and says when none match', () => {
    setup(cutsEach(COUNTS), null);
    search(names[1] ?? '');
    expect(screen.queryByRole('button', { name: /more ›$/ })).toBeNull();
    search('zzzz');
    expect(listed()).toEqual([]);
    expect(screen.getByText('No enzyme matches that.')).toBeVisible();
  });

  it('unticks everything with Hide all, which is only there with something ticked', () => {
    setup(cutsEach(COUNTS), null);
    fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
    expect(editorStore.getState().shownEnzymes.size).toBe(0);
    expect(screen.queryByRole('button', { name: 'Hide all' })).toBeNull();
    expect(listed()).toEqual([]);
    // The note that recovers from an empty tick state.
    expect(screen.getByRole('button', { name: 'Tick the 3 enzymes that cut once' })).toBeVisible();
  });

  it('keeps the note on hidden cut sites, with the way to show them', () => {
    setup(cutsEach(COUNTS), null);
    act(() => {
      editorStore.setShowCutSites(false);
    });
    expect(screen.getByText(/Cut sites are hidden in the views/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show cut sites' }));
    expect(editorStore.getState().showCutSites).toBe(true);
  });

  it('keeps Grown in, as the same edit as the workspace head', () => {
    setup(cutsEach(COUNTS), null);
    fireEvent.change(screen.getByRole('combobox', { name: 'Host methylation' }), {
      target: { value: 'unmethylated' },
    });
    expect(editorStore.getState().history?.present.methylation).toEqual({
      dam: false,
      dcm: false,
    });
  });

  it('reads the gel in a sentence with Digest ›, which opens the workspace on the Digest page', () => {
    const [a, b] = names;
    if (a === undefined || b === undefined) throw new Error('table');
    const at = (enzyme: string, cut: number): CutSite => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut - 1,
      strand: 'forward' as const,
    });
    setup([at(a, 400), at(b, 2100)], null);
    act(() => {
      editorStore.setShownEnzymes([a, b]);
    });
    const reading = screen.getByTestId('gel-reading');
    expect(reading).toHaveTextContent(
      'On a gel: 1,900 ×2 + 400 bp — 1,900 and 1,700 run together. Digest ›',
    );
    expect(reading).toHaveClass('panel__note--warn');
    fireEvent.click(within(reading).getByRole('button', { name: 'Digest ›' }));
    expect(editorStore.getState().workspace).toBe('enzymes');
    expect(recallEnzymePage(editorStore.getState().documentId)).toBe('digest');
    expect(screen.getByRole('heading', { name: 'Digest' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Fragments' })).toBeVisible();
  });

  it('has no gel sentence with nothing ticked', () => {
    setup(cutsEach(COUNTS), null);
    act(() => {
      editorStore.setShownEnzymes([]);
    });
    expect(screen.queryByTestId('gel-reading')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Digest ›' })).toBeNull();
  });

  it('opens the workspace from its link, on the page it was left on', () => {
    setup(cutsEach(COUNTS), null);
    fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
    expect(editorStore.getState()).toMatchObject({ workspace: 'enzymes', sidebarTab: 'enzymes' });
    expect(screen.getByRole('heading', { name: /^Enzymes/ })).toBeInTheDocument();
    goTo('Table');
    fireEvent.click(screen.getByRole('button', { name: /close the enzyme workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
    expect(screen.getByRole('heading', { name: 'Enzyme table' })).toBeInTheDocument();
  });

  it('offers Double digests › only when two enzymes could be paired, and opens that page', () => {
    setup(singleCutters(1), null);
    expect(screen.queryByRole('button', { name: 'Double digests ›' })).toBeNull();
    act(() => {
      editorStore.setAnalysis(doc, singleCutters(3), []);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Double digests ›' }));
    expect(editorStore.getState().workspace).toBe('enzymes');
    expect(recallEnzymePage(editorStore.getState().documentId)).toBe('pairs');
    expect(screen.getByRole('heading', { level: 2, name: 'Double digests' })).toBeInTheDocument();
  });

  it('puts the keyboard back on the link when the workspace is shut with Escape', () => {
    setup(cutsEach(COUNTS), null);
    // The tab's own door: Escape stays on this tab (a link on another tab goes back to it, #404).
    act(() => {
      editorStore.setSidebarTab('enzymes');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Double digests ›' }));
    fireEvent.keyDown(screen.getByRole('heading', { level: 2, name: 'Double digests' }), {
      key: 'Escape',
    });
    expect(editorStore.getState().workspace).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Enzyme workspace ›' })).toHaveFocus();
  });

  it('says how many ticked sites the host blocks, and drops the sentence when none are', () => {
    // The Dcm-blocked MscI site and the ClaI site that nothing blocks.
    const text = `AAAACCTGGCCAAAAA${'ACGT'.repeat(20)}AAATCGATAAA${'TTAG'.repeat(20)}`;
    const plasmid = SeqDocument.create({ name: 'pMeth', sequence: text, topology: 'circular' });
    const mscI = getEnzyme('MscI');
    const claI = getEnzyme('ClaI');
    if (mscI === undefined || claI === undefined) throw new Error('missing enzymes');
    act(() => {
      editorStore.openDocument(plasmid);
      editorStore.setAnalysis(plasmid, findCutSites(text, 'circular', [mscI, claI]), []);
      editorStore.setShownEnzymes(['MscI', 'ClaI']);
    });
    const view = render(<Host doc={plasmid} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 ticked. 1 ticked site blocked by Dam/Dcm (grown in dam+/dcm+).',
    );
    act(() => {
      editorStore.setShownEnzymes(['ClaI']);
    });
    expect(screen.getByRole('status')).not.toHaveTextContent(/blocked/);
    act(() => {
      editorStore.setShownEnzymes(['MscI', 'ClaI']);
      editorStore.apply({
        type: 'setMethylation',
        methylation: { dam: false, dcm: false },
      });
    });
    view.rerender(<Host doc={editorStore.document ?? plasmid} />);
    expect(screen.getByRole('status')).not.toHaveTextContent(/blocked/);
  });
});

describe('EnzymePanel cut-count filter', () => {
  const COUNTS = [1, 1, 1, 2, 2, 3, 4];
  const names = activeEnzymes()
    .slice(0, COUNTS.length)
    .map((e) => e.name);

  beforeEach(() => {
    act(() => {
      editorStore.setEnzymeCutFilter('any');
    });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      editorStore.setEnzymeCutFilter('any');
      editorStore.closeDocument();
    });
    forgetPanels();
  });

  /** Picks a value in the "Cuts" select. */
  function chooseCuts(value: string): void {
    act(() => {
      fireEvent.change(screen.getByLabelText('Cuts'), { target: { value } });
    });
  }

  it('lists the enzymes that cut a chosen number of times', () => {
    setup(cutsEach(COUNTS));
    expect(screen.getByText(/7 of 127 enzymes cut\./)).toBeInTheDocument();
    expect(listed()).toEqual(names);

    chooseCuts('twice');
    expect(listed()).toEqual(names.slice(3, 5));
    expect(screen.getByText(/2 of 127 enzymes cut twice/)).toBeInTheDocument();

    // A dual digest usually wants either, and three is as many bands as a
    // gel of a small plasmid is worth reading.
    chooseCuts('once-or-twice');
    expect(listed()).toEqual(names.slice(0, 5));
    chooseCuts('up-to-three');
    expect(listed()).toEqual(names.slice(0, 6));
    chooseCuts('once');
    expect(listed()).toEqual(names.slice(0, 3));
    expect(screen.getByText(/3 of 127 enzymes cut once/)).toBeInTheDocument();

    // The name filter still applies on top of it.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter enzymes' }), {
      target: { value: names[1] ?? '' },
    });
    expect(listed()).toEqual([names[1]]);
  });

  it('offers to tick what the filter asks for, not always the single cutters', () => {
    setup(cutsEach(COUNTS));
    act(() => {
      editorStore.setShownEnzymes([]);
    });
    // With no cut-count filter the offer is the single cutters, as ever.
    expect(screen.getByRole('button', { name: 'Tick the 3 enzymes that cut once' })).toBeVisible();
    chooseCuts('twice');
    const offer = screen.getByRole('button', { name: 'Tick the 2 enzymes that cut twice' });
    act(() => {
      fireEvent.click(offer);
    });
    expect([...editorStore.getState().shownEnzymes]).toEqual(names.slice(3, 5));
  });

  it('keeps what it was asked for when the panel comes back', () => {
    const view = setup(cutsEach(COUNTS));
    chooseCuts('twice');
    view.unmount();
    render(<Host doc={doc} />);
    expect(screen.getByLabelText('Cuts')).toHaveValue('twice');
    expect(listed()).toEqual(names.slice(3, 5));
  });
});

describe('EnzymePanel isoschizomers', () => {
  const enzyme = (name: string, site: string, cut: number, suppliers: string[]): Enzyme => ({
    name,
    site,
    cutTop: cut,
    cutBottom: site.length - cut,
    palindromic: true,
    suppliers,
  });
  // BamHI and two isoschizomers; XmaI and SmaI share a site but not a cut.
  const SET = [
    enzyme('AliI', 'GGATCC', 1, ['B']),
    enzyme('BamHI', 'GGATCC', 1, ['N']),
    enzyme('BstI', 'GGATCC', 1, ['N', 'B', 'K']),
    enzyme('SmaI', 'CCCGGG', 3, ['N']),
    enzyme('XmaI', 'CCCGGG', 1, ['N']),
  ];
  const cutOnce = (name: string, at: number): CutSite => ({
    enzyme: name,
    cut: at,
    cutBottom: at,
    siteStart: at - 1,
    strand: 'forward',
  });
  const SITES = [
    ...['AliI', 'BamHI', 'BstI'].map((n) => cutOnce(n, 101)),
    cutOnce('SmaI', 503),
    cutOnce('XmaI', 501),
  ];

  beforeEach(() => {
    setActiveEnzymeSet({
      id: 'rebase',
      label: 'Test set',
      enzymes: SET,
      suppliers: [
        { code: 'B', name: 'Thermo' },
        { code: 'K', name: 'Takara' },
        { code: 'N', name: 'NEB' },
      ],
    });
    act(() => {
      editorStore.setEnzymeSetInfo({
        label: 'Test set',
        count: SET.length,
        bundled: false,
        fileName: null,
        custom: [],
        suppliers: [
          { code: 'B', name: 'Thermo' },
          { code: 'K', name: 'Takara' },
          { code: 'N', name: 'NEB' },
        ],
      });
      editorStore.setEnzymeCutFilter('any');
      editorStore.setEnzymeSupplier('');
      editorStore.setEnzymeSort('name');
      editorStore.setEnzymeGroupIsoschizomers(true);
    });
  });

  afterEach(() => {
    cleanup();
    setActiveEnzymeSet(null);
    forgetPanels();
    act(() => {
      editorStore.closeDocument();
      editorStore.setEnzymeGroupIsoschizomers(true);
    });
  });

  it('lists enzymes with the same site and cut as one row, and ticks one of them', () => {
    setup(SITES);
    // BamHI is the bundled table's name for it; neoschizomers keep their own rows.
    expect(listed()).toEqual(['BamHI', 'SmaI', 'XmaI']);
    expect([...editorStore.getState().shownEnzymes].sort()).toEqual(['BamHI', 'SmaI', 'XmaI']);
    expect(getByTip(document.body, 'Same site and cut: BstI and AliI')).toHaveTextContent('+2');
    expect(
      screen.getByText(/5 of 5 enzymes .* in 3 rows with isoschizomers together/),
    ).toBeVisible();
  });

  it('lists them separately when asked to', () => {
    setup(SITES);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Isoschizomers share a row' }));
    });
    expect(screen.getByRole('button', { name: 'Isoschizomers share a row' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(listed()).toEqual(['AliI', 'BamHI', 'BstI', 'SmaI', 'XmaI']);
    expect(editorStore.getState().enzymeGroupIsoschizomers).toBe(false);
  });

  it('names the row after the enzyme searched for, ticked, or sold by the supplier', () => {
    setup(SITES);
    const search = screen.getByRole('searchbox', { name: 'Filter enzymes' });
    fireEvent.change(search, { target: { value: 'bamh' } });
    expect(listed()).toEqual(['BamHI']);
    fireEvent.change(search, { target: { value: '' } });
    act(() => {
      editorStore.setShownEnzymes(['AliI']);
    });
    expect(listed()).toEqual(['AliI', 'SmaI', 'XmaI']);
    act(() => {
      editorStore.setShownEnzymes([]);
      editorStore.setEnzymeSupplier('K');
    });
    expect(listed()).toEqual(['BstI']);
    act(() => {
      editorStore.setEnzymeSupplier('B');
    });
    // AliI and BstI are sold by B; BstI is sold by more companies.
    expect(listed()).toEqual(['BstI']);
    expect(getByTip(document.body, 'Same site and cut: AliI')).toBeVisible();
  });

  it('unticks every member when the row is unticked', () => {
    setup(SITES);
    act(() => {
      editorStore.setShownEnzymes(['AliI', 'BamHI', 'XmaI']);
    });
    // The row is named after the first ticked member in the group's order.
    const row = [...document.querySelectorAll('.enzyme-row__name')]
      .find((n) => n.textContent === 'BamHI')
      ?.closest('tr');
    const box = row?.querySelector('input');
    expect(box).toBeChecked();
    act(() => {
      if (box) fireEvent.click(box);
    });
    expect([...editorStore.getState().shownEnzymes]).toEqual(['XmaI']);
  });
});

describe('EnzymePanel host methylation', () => {
  afterEach(() => {
    cleanup();
    act(() => {
      editorStore.closeDocument();
    });
    forgetPanels();
  });

  it('marks a site Dam methylation overlaps, and says how many there are', () => {
    // Two ClaI sites (ATCGAT): the first behind a G, which makes GATC; the second not.
    const sequence = `${'CCCCCCCCCC'.repeat(5)}GATCGAT${'CCCCCCCCCC'.repeat(5)}CATCGATA${'C'.repeat(40)}`;
    const methylDoc = SeqDocument.create({ sequence });
    const claI = getEnzyme('ClaI');
    if (claI === undefined) throw new Error('ClaI');
    act(() => {
      editorStore.openDocument(methylDoc);
      editorStore.setAnalysis(methylDoc, findCutSites(sequence, 'linear', [claI]), []);
      editorStore.setEnzymeCutFilter('any');
      editorStore.setEnzymeSupplier('');
      openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
    });
    render(<Host doc={methylDoc} />);
    const cuts = [...document.querySelectorAll('.enz-cuts .link')];
    expect(cuts.map((c) => c.classList.contains('link--methylated'))).toEqual([true, false]);
    expect(cuts[0]?.getAttribute('data-tip')).toMatch(/Dam methylation overlaps it/);
    // The column says how many; the detail says what it means.
    const row = document.querySelector('tr[data-row]');
    expect(row?.querySelectorAll('td')[6]).toHaveTextContent('1 of 2');
    fireEvent.click(screen.getByText('ClaI'));
    expect(screen.getByText(/1 of 2 sites may be blocked by Dam\/Dcm methylation/)).toBeVisible();
  });

  it("draws the same rows from the worker's digest as from the sites alone (item 98)", async () => {
    // MscI in a Dcm site and two ClaI sites, one Dam-marked, on a circle.
    const sequence = `${'A'.repeat(20)}CCTGGCCA${'A'.repeat(20)}GATCGAT${'A'.repeat(20)}CATCGATA${'A'.repeat(20)}`;
    const plasmid = SeqDocument.create({ sequence, topology: 'circular' });
    const sites = findCutSites(sequence, 'circular', activeEnzymes());
    const rows = () =>
      [...document.querySelectorAll('tr[data-row]')].map((row) => ({
        name: row.querySelector('.enzyme-row__name')?.textContent,
        cuts: [...row.querySelectorAll('.enz-cuts .link')].map(
          (c) => `${c.textContent}${c.classList.contains('link--methylated') ? 'm' : ''}`,
        ),
        note: row.querySelectorAll('td')[6]?.textContent ?? '',
        bands: row.querySelector('.enzyme-row__bands')?.textContent ?? '',
      }));
    act(() => {
      editorStore.openDocument(plasmid);
      editorStore.setAnalysis(plasmid, sites, []);
      editorStore.setEnzymeCutFilter('any');
      editorStore.setEnzymeSupplier('');
      editorStore.setEnzymeSort('bands');
      openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
    });
    const view = render(<Host doc={plasmid} />);
    const inline = rows();
    expect(inline.length).toBeGreaterThan(2);
    expect(inline.some(({ cuts }) => cuts.some((c) => c.endsWith('m')))).toBe(true);
    const whole = view.container.textContent;
    act(() => {
      editorStore.setAnalysis(plasmid, sites, [], enzymeDigest(sites, sequence, 'circular'));
    });
    view.rerender(<Host doc={plasmid} />);
    expect(rows()).toEqual(inline);
    // And unpacked as the client unpacks it: grouped on the way, the lengths
    // views into one buffer, the bands worked out as asked for (#278).
    const packed = packCutSites(sites);
    const unpacked = await unpackScan(
      packed,
      packEnzymeDigest(enzymeDigest(sites, sequence, 'circular'), packed.enzymes),
    );
    expect(unpacked.digest.byEnzyme?.size).toBeGreaterThan(2);
    act(() => {
      editorStore.setAnalysis(plasmid, unpacked.sites, [], unpacked.digest);
    });
    view.rerender(<Host doc={plasmid} />);
    expect(rows()).toEqual(inline);
    expect(view.container.textContent).toBe(whole);
    act(() => {
      editorStore.setEnzymeSort('name');
    });
    const byName = rows();
    act(() => {
      editorStore.setAnalysis(plasmid, sites, []);
    });
    view.rerender(<Host doc={plasmid} />);
    expect(rows()).toEqual(byName);
  });
});

describe('host methylation (#45)', () => {
  // MscI's TGGCCA here sits in a Dcm CCWGG, so an ordinary strain blocks
  // it; the ClaI site further along is never blocked.
  const text = `AAAACCTGGCCAAAAA${'ACGT'.repeat(20)}AAATCGATAAA${'TTAG'.repeat(20)}`;
  const plasmid = SeqDocument.create({ name: 'pMeth', sequence: text, topology: 'circular' });

  function current(): SeqDocument {
    const doc = editorStore.document;
    if (doc === null) throw new Error('no document');
    return doc;
  }

  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('cuts what the strain allows, and says which strain that is', () => {
    const mscI = getEnzyme('MscI');
    const claI = getEnzyme('ClaI');
    if (mscI === undefined || claI === undefined) throw new Error('missing enzymes');
    act(() => {
      editorStore.openDocument(plasmid);
      editorStore.setAnalysis(plasmid, findCutSites(text, 'circular', [mscI, claI]), []);
      editorStore.setShownEnzymes(['MscI', 'ClaI']);
      openEnzymeWorkspace(editorStore.getState().documentId, 'digest');
    });
    const view = render(<Host doc={current()} />);
    const host = (): HTMLElement => screen.getByLabelText('Host methylation');
    expect(host()).toHaveValue('dam+/dcm+');
    // Blocked: only ClaI cuts, so the circle opens into one piece.
    const bands = (): number =>
      document.querySelectorAll('table[aria-label="Fragments"] tbody tr[data-row]').length;
    expect(bands()).toBe(1);

    act(() => {
      fireEvent.change(host(), { target: { value: 'unmethylated' } });
    });
    expect(current().methylation).toEqual({ dam: false, dcm: false });
    view.rerender(<Host doc={current()} />);
    // Now MscI cuts as well, so the digest gives two pieces.
    expect(bands()).toBe(2);

    // It is an edit, so it can be undone.
    act(() => {
      editorStore.undo();
    });
    expect(current().methylation).toEqual({ dam: true, dcm: true });
  });

  describe('a cut at the origin (#168)', () => {
    const cutAt = (cut: number): CutSite => ({
      enzyme: activeEnzymes()[0]?.name ?? '',
      cut,
      cutBottom: cut,
      siteStart: 0,
      strand: 'forward',
    });
    const show = (topology: 'circular' | 'linear', cut: number) => {
      const d = SeqDocument.create({ sequence: 'ACGT'.repeat(1000), topology });
      act(() => {
        editorStore.openDocument(d);
        editorStore.setAnalysis(d, [cutAt(cut)], []);
      });
      render(<EnzymePanel doc={d} />);
      return [...document.querySelectorAll('.enzyme-row__cuts .link')].map((n) => n.textContent);
    };

    it('reads as after the last base on a circle', () => {
      expect(show('circular', 0)).toEqual(['4,000']);
    });

    it('reads 0 on a line, where it is before the first base', () => {
      expect(show('linear', 0)).toEqual(['0']);
    });

    it('leaves any other cut as it is', () => {
      expect(show('circular', 1)).toEqual(['1']);
    });
  });
});
