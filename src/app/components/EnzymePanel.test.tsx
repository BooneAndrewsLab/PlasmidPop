// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { type CutSite, type Enzyme, SeqDocument, activeEnzymes, setActiveEnzymeSet } from '@/core';

import { MAX_DEFAULT_ENZYMES, editorStore } from '../state/editorStore';
import { EnzymePanel } from './EnzymePanel';

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

function setup(sites: readonly CutSite[]) {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setAnalysis(doc, sites, []);
  });
  return render(<EnzymePanel doc={doc} />);
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
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('ticks a handful of single cutters by itself', () => {
    setup(singleCutters(5));
    expect(editorStore.getState().shownEnzymes.size).toBe(5);
    expect(screen.queryByText(/enzymes that cut once/)).toBeNull();
  });

  it('renders only the rows near the viewport', () => {
    const names = activeEnzymes()
      .slice(0, 120)
      .map((e) => e.name);
    setup(singleCutters(names.length));
    const scroller = document.querySelector('.enzyme-list__scroll');
    const list = document.querySelector('.enzyme-list');
    if (scroller === null || list === null) throw new Error('no list');
    // Every row is counted, but only a screenful of them is in the DOM.
    expect(screen.getByText(/120 of 127 enzymes cut/)).toBeInTheDocument();
    const rendered = () =>
      [...list.querySelectorAll('.enzyme-row__name')].map((n) => n.textContent);
    expect(rendered().length).toBeLessThan(names.length / 2);
    expect(rendered()).toContain(names[0]);
    expect(rendered()).not.toContain(names[names.length - 1]);

    // Scrolling to the bottom swaps the window over, and the list keeps its
    // full height through the padding above the rows.
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', { value: 1e6, configurable: true });
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(rendered()).toContain(names[names.length - 1]);
    expect(rendered()).not.toContain(names[0]);
    expect(parseFloat((list as HTMLElement).style.paddingTop)).toBeGreaterThan(0);
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
    expect(warned[0]?.getAttribute('title')).toMatch(/run together/);
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
    setup([at(a, 400), at(b, 2100)]);
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
    setup([at(a, 400), at(b, 2100)]);
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

  it('orders by band separation on request, and by name otherwise', () => {
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
    // a: 2,000 + 2,000 (one band), b: 3,600 + 400 (9x), c: 2,400 + 1,600 (1.5x).
    setup([at(a, 2000), at(b, 400), at(c, 1600)]);
    expect(listed()).toEqual([a, b, c]);
    act(() => {
      editorStore.setEnzymeSort('bands');
    });
    expect(listed()).toEqual([b, c, a]);
  });

  it('reverses the order on request', () => {
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
    setup([at(a, 2000), at(b, 400), at(c, 1600)]);
    act(() => {
      editorStore.setEnzymeSort('bands');
    });
    const reverse = screen.getByRole('button', { name: 'Reverse the order' });
    act(() => {
      fireEvent.click(reverse);
    });
    expect(reverse).toHaveAttribute('aria-pressed', 'true');
    // Hardest to read first: a's one band, then c's 1.5x, then b's 9x.
    expect(listed()).toEqual([a, c, b]);
    act(() => {
      editorStore.setEnzymeSort('name');
    });
    expect(listed()).toEqual([c, b, a]);
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
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Agarose' }), {
        target: { value: '2' },
      });
    });
    expect(editorStore.getState().gelAgarose).toBe(2);
    expect(document.querySelector('.enzyme-row__bands--muddy')).toBeNull();
    expect(screen.getByText(/model of a 2 % gel/)).toBeVisible();
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Ladder' }), {
        target: { value: '100 bp' },
      });
    });
    expect(document.querySelector('.gel__svg title')?.textContent).toMatch(/100 bp ladder$/);
  });

  it('offers the best double digests when ordered by band separation', () => {
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
    setup([at(a, 1000), at(b, 2000), at(c, 3500)]);
    expect(screen.queryByTestId('double-digests')).toBeNull();
    act(() => {
      editorStore.setEnzymeSort('bands');
    });
    const section = screen.getByTestId('double-digests');
    const pairs = [...section.querySelectorAll('.enzyme-row__pair')].map((n) => n.textContent);
    // Each pair is named alphabetically, whatever order the list is in.
    const named = (x: string, y: string) => [x, y].sort((p, q) => p.localeCompare(q)).join(' + ');
    expect(pairs).toEqual([named(a, c), named(b, c)]);

    const [best] = screen.getAllByRole('button', { name: 'Tick both' });
    if (best === undefined) throw new Error('no pair offered');
    fireEvent.click(best);
    expect([...editorStore.getState().shownEnzymes].sort()).toEqual([a, c].sort());
    // The ticked pair says so, and the gel below draws it beside each alone.
    expect(screen.getByRole('button', { name: 'Ticked' })).toBeDisabled();
    expect(
      [...document.querySelectorAll('.gel__lane')].map((l) => l.getAttribute('data-lane')),
    ).toEqual([a, c, 'Both']);
  });

  it('offers the single cutters when there were too many to tick', () => {
    setup(singleCutters(MAX_DEFAULT_ENZYMES + 1));
    expect(editorStore.getState().shownEnzymes.size).toBe(0);
    const offer = screen.getByRole('button', {
      name: `Tick the ${MAX_DEFAULT_ENZYMES + 1} enzymes that cut once`,
    });
    act(() => {
      fireEvent.click(offer);
    });
    expect(editorStore.getState().shownEnzymes.size).toBe(MAX_DEFAULT_ENZYMES + 1);
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
    act(() => {
      editorStore.setEnzymeCutFilter('any');
      editorStore.closeDocument();
    });
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
    render(<EnzymePanel doc={doc} />);
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
    setActiveEnzymeSet(null);
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
    expect(screen.getByTitle('Same site and cut: BstI and AliI')).toHaveTextContent('+2');
    expect(
      screen.getByText(/5 of 5 enzymes .* in 3 rows with isoschizomers together/),
    ).toBeVisible();
  });

  it('lists them separately when asked to', () => {
    setup(SITES);
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'share a row' }));
    });
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
    expect(screen.getByTitle('Same site and cut: AliI')).toBeVisible();
  });

  it('unticks every member when the row is unticked', () => {
    setup(SITES);
    act(() => {
      editorStore.setShownEnzymes(['AliI', 'BamHI', 'XmaI']);
    });
    // The row is named after the first ticked member in the group's order.
    const row = [...document.querySelectorAll('.enzyme-row__name')]
      .find((n) => n.textContent === 'BamHI')
      ?.closest('li');
    const box = row?.querySelector('input');
    expect(box).toBeChecked();
    act(() => {
      if (box) fireEvent.click(box);
    });
    expect([...editorStore.getState().shownEnzymes]).toEqual(['XmaI']);
  });
});
