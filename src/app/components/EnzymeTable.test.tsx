// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { type CutSite, type Enzyme, SeqDocument, activeEnzymes, setActiveEnzymeSet } from '@/core';

import { openEnzymeWorkspace } from '../enzymeWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { EnzymePanel } from './EnzymePanel';
import { EnzymeWorkspace } from './EnzymeWorkspace';

// 4,000 bp, linear.
const doc = SeqDocument.create({ name: 'target', sequence: 'ACGT'.repeat(1000) });

function Host({ layout = 'split' }: { layout?: 'split' | 'full' | 'phone' }) {
  const { workspace } = useEditorState();
  return workspace === 'enzymes' ? (
    <EnzymeWorkspace doc={doc} layout={layout} />
  ) : (
    <EnzymePanel doc={doc} />
  );
}

const site = (enzyme: string, cut: number): CutSite => ({
  enzyme,
  cut,
  cutBottom: cut,
  siteStart: cut - 1,
  strand: 'forward',
});

/** Opens the document with `sites` as its scan and the workspace on the Enzymes page. */
function setup(sites: readonly CutSite[], layout: 'split' | 'full' | 'phone' = 'split') {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setAnalysis(doc, sites, []);
    openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
  });
  return render(<Host layout={layout} />);
}

/** The first `n` enzymes of the table, each cutting once, `gap` bases apart. */
function singleCutters(n: number): CutSite[] {
  return activeEnzymes()
    .slice(0, n)
    .map((enzyme, i) => site(enzyme.name, i * 100 + 1));
}

const rowEls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('tr[data-row]')];
const names = (): (string | null)[] =>
  rowEls().map((r) => r.querySelector('.enzyme-row__name')?.textContent ?? null);
const row = (name: string): HTMLElement => {
  const found = rowEls().find((r) => r.getAttribute('data-row') === name);
  if (found === undefined) throw new Error(`no row ${name}`);
  return found;
};
const detail = (name: string): HTMLElement => screen.getByRole('complementary', { name });

/** A scroller jsdom lays out: a height, and a `scrollTop` that holds what it is given. */
function stubScroller(height = 400): HTMLElement {
  const el = document.querySelector<HTMLElement>('.enz-ws__scroll');
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

describe('the enzyme table (item 133, E4)', () => {
  beforeEach(() => {
    act(() => {
      editorStore.setEnzymeCutFilter('any');
      editorStore.setEnzymeSupplier('');
      editorStore.setEnzymeSort('name');
      editorStore.setEnzymeSortReversed(false);
      editorStore.setEnzymeGroupIsoschizomers(true);
    });
  });
  afterEach(() => {
    cleanup();
    act(() => {
      editorStore.closeDocument();
    });
    forgetPanels();
  });

  it('is a grid of the enzymes that cut, with the columns of the plan', () => {
    setup(singleCutters(3));
    const grid = screen.getByRole('grid', { name: 'Enzymes' });
    expect(grid).toHaveClass('wst', 'dt');
    const heads = [...grid.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(heads).toEqual([
      '',
      'Name▲',
      'Site',
      'Overhang',
      'Cuts',
      'Positions',
      'Dam/Dcm',
      'Bands',
    ]);
    expect(rowEls()).toHaveLength(3);
    const first = rowEls()[0];
    const enzyme = activeEnzymes()[0];
    if (first === undefined || enzyme === undefined) throw new Error('table');
    const cells = [...first.querySelectorAll('td')].map((c) => c.textContent);
    expect(cells[1]).toBe(enzyme.name);
    expect(cells[2]).toBe(enzyme.site);
    expect(cells[4]).toBe('1');
    expect(cells[5]).toBe('1');
    // The count line is the page's status.
    expect(screen.getByRole('status')).toHaveTextContent(/3 of \d+ enzymes cut\. \d+ do not cut\./);
  });

  it('has a filter bar: Filter, Cuts, the isoschizomer toggle, Show listed and Hide all', () => {
    setup(singleCutters(3));
    for (const control of [
      screen.getByRole('searchbox', { name: 'Filter enzymes' }),
      screen.getByLabelText('Cuts'),
      screen.getByRole('button', { name: 'Isoschizomers share a row' }),
      screen.getByRole('button', { name: 'Show listed' }),
      screen.getByRole('button', { name: 'Hide all' }),
    ]) {
      expect(control).toBeVisible();
    }
    // Order is the Name and Bands headings now, and Grown in is in the head.
    expect(screen.queryByRole('button', { name: 'Reverse the order' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
    expect(editorStore.getState().shownEnzymes.size).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show listed' }));
    expect(editorStore.getState().shownEnzymes.size).toBe(3);
  });

  it('ticks from the row, which a click on the tick does not select', () => {
    setup(singleCutters(3));
    const [a, b] = names();
    if (a == null || b == null) throw new Error('table');
    act(() => {
      editorStore.setShownEnzymes([]);
    });
    fireEvent.click(within(row(b)).getByRole('checkbox', { name: `Tick ${b}` }));
    expect([...editorStore.getState().shownEnzymes]).toEqual([b]);
    expect(row(b)).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  describe('sorting', () => {
    const heading = (name: string): HTMLElement => screen.getByRole('button', { name });
    const aria = (name: string): string | null =>
      heading(name).closest('th')?.getAttribute('aria-sort') ?? null;

    it('makes Name and Bands the store’s order, with the arrow for its direction', () => {
      setup(singleCutters(4));
      expect(aria('Name')).toBe('ascending');
      fireEvent.click(heading('Bands'));
      expect(editorStore.getState()).toMatchObject({
        enzymeSort: 'bands',
        enzymeSortReversed: false,
      });
      fireEvent.click(heading('Bands'));
      expect(editorStore.getState().enzymeSortReversed).toBe(true);
      expect(aria('Bands')).toBe('descending');
      expect(heading('Bands').querySelector('.wst__arrow')).toHaveTextContent('▼');
      expect(aria('Name')).toBeNull();
      // Another column starts ascending again.
      fireEvent.click(heading('Name'));
      expect(editorStore.getState()).toMatchObject({
        enzymeSort: 'name',
        enzymeSortReversed: false,
      });
    });

    it('has no sort of its own on Cuts or Overhang (follow-up #402)', () => {
      setup(singleCutters(2));
      expect(screen.queryByRole('button', { name: /^Cuts/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Overhang/ })).toBeNull();
    });

    it('takes the window back to the top', () => {
      setup(singleCutters(100));
      const scroller = stubScroller();
      scroller.scrollTop = 2000;
      fireEvent.scroll(scroller);
      expect(scroller.scrollTop).toBe(2000);
      fireEvent.click(heading('Bands'));
      expect(scroller.scrollTop).toBe(0);
    });
  });

  describe('a table of 1,500 enzymes', () => {
    const SET: Enzyme[] = Array.from({ length: 1500 }, (_, i) => ({
      // Six bases from the digits of i in base four: every site is its own.
      name: `Enz${String(i).padStart(4, '0')}`,
      site: i
        .toString(4)
        .padStart(6, '0')
        .split('')
        .map((d) => 'ACGT'[Number(d)] ?? 'A')
        .join(''),
      cutTop: 3,
      cutBottom: 3,
      palindromic: false,
    }));
    const SITES = SET.map((e, i) => site(e.name, i * 2 + 1));

    beforeEach(() => {
      setActiveEnzymeSet({ id: 'rebase', label: 'Test set', enzymes: SET, suppliers: [] });
      act(() => {
        editorStore.setEnzymeSetInfo({
          label: 'Test set',
          count: SET.length,
          bundled: false,
          fileName: null,
          custom: [],
          suppliers: [],
        });
      });
    });
    afterEach(() => {
      cleanup();
      setActiveEnzymeSet(null);
    });

    it('draws a screenful of rows, not 1,500, and keeps the height in two spacers', () => {
      setup(SITES);
      expect(screen.getByRole('status')).toHaveTextContent('1,500 of 1,500 enzymes cut');
      const drawn = rowEls().length;
      expect(drawn).toBeGreaterThan(10);
      expect(drawn).toBeLessThan(100);
      expect(names()[0]).toBe('Enz0000');
      expect(names()).not.toContain('Enz1499');
      const spacers = [...document.querySelectorAll<HTMLElement>('tr.wst__spacer')];
      // Nothing above the first row, 1,500 rows' worth of height below the window.
      expect(spacers).toHaveLength(1);
      expect(parseFloat(spacers[0]?.style.height ?? '0')).toBeGreaterThan(40000);
    });

    it('moves the window with the scroll', () => {
      setup(SITES);
      const scroller = stubScroller();
      scroller.scrollTop = 1e6;
      act(() => {
        fireEvent.scroll(scroller);
      });
      expect(names()).toContain('Enz1499');
      expect(names()).not.toContain('Enz0000');
      expect(rowEls().length).toBeLessThan(100);
      expect(document.querySelectorAll('tr.wst__spacer')).toHaveLength(1);
    });

    it('lands on a row that is not drawn yet when End takes the keyboard there', () => {
      setup(SITES);
      stubScroller();
      const first = rowEls()[0];
      if (first === undefined) throw new Error('rows');
      first.focus();
      fireEvent.keyDown(first, { key: 'End' });
      const last = row('Enz1499');
      expect(last).toHaveAttribute('aria-selected', 'true');
      expect(last).toHaveFocus();
      expect(rowEls().length).toBeLessThan(100);
      fireEvent.keyDown(last, { key: 'Home' });
      expect(row('Enz0000')).toHaveFocus();
      expect(row('Enz0000')).toHaveAttribute('aria-selected', 'true');
    });

    it('does not offer to tick 1,500 enzymes at once', () => {
      setup(SITES);
      expect(screen.getByRole('button', { name: 'Show listed' })).toBeDisabled();
    });
  });

  describe('the keys', () => {
    it('are one stop in the tab order: the selected row, or the first', () => {
      setup(singleCutters(5));
      const stops = (): (string | null)[] =>
        rowEls()
          .filter((r) => r.tabIndex === 0)
          .map((r) => r.getAttribute('data-row'));
      expect(stops()).toEqual([names()[0]]);
      fireEvent.click(row(names()[3] ?? ''));
      expect(stops()).toEqual([names()[3]]);
      // The tick and the positions are in the tab order only on that row.
      const ticks = [...document.querySelectorAll<HTMLInputElement>('td input')];
      expect(ticks.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    });

    it('walk the selection with the arrows, Home and End, and stop at the ends', () => {
      setup(singleCutters(5));
      const all = names();
      const first = rowEls()[0];
      if (first === undefined) throw new Error('rows');
      first.focus();
      const press = (key: string): void => {
        fireEvent.keyDown(document.activeElement ?? first, { key });
      };
      const selected = (): string | null =>
        rowEls()
          .find((r) => r.getAttribute('aria-selected') === 'true')
          ?.getAttribute('data-row') ?? null;
      // From a row with the keyboard on it, the next one: not the first again.
      press('ArrowDown');
      expect(selected()).toBe(all[1]);
      expect(document.activeElement).toBe(row(all[1] ?? ''));
      press('ArrowDown');
      press('ArrowDown');
      expect(selected()).toBe(all[3]);
      press('ArrowUp');
      expect(selected()).toBe(all[2]);
      press('End');
      expect(selected()).toBe(all[4]);
      press('ArrowDown');
      expect(selected()).toBe(all[4]);
      press('Home');
      expect(selected()).toBe(all[0]);
      press('ArrowUp');
      expect(selected()).toBe(all[0]);
      // Their detail follows them.
      expect(detail(all[0] ?? '')).toBeVisible();
    });

    it('leave the other keys alone', () => {
      setup(singleCutters(3));
      const first = rowEls()[0];
      if (first === undefined) throw new Error('rows');
      first.focus();
      fireEvent.keyDown(first, { key: 'a' });
      fireEvent.keyDown(first, { key: 'ArrowDown', ctrlKey: true });
      expect(screen.queryByRole('complementary')).toBeNull();
    });

    it('put the detail away with Escape first, and shut the workspace with the next', () => {
      setup(singleCutters(3));
      const [a] = names();
      fireEvent.click(row(a ?? ''));
      expect(detail(a ?? '')).toBeVisible();
      fireEvent.keyDown(row(a ?? ''), { key: 'Escape' });
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(editorStore.getState().workspace).toBe('enzymes');
      fireEvent.keyDown(row(a ?? ''), { key: 'Escape' });
      expect(editorStore.getState().workspace).toBeNull();
    });
  });

  describe('the detail', () => {
    it('names the row, and a second click on it clears it', () => {
      setup(singleCutters(3));
      const all = names();
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(screen.getByText(/Select an enzyme to see where it cuts/)).toBeVisible();
      fireEvent.click(row(all[1] ?? ''));
      const pane = detail(all[1] ?? '');
      expect(pane.querySelector('strong')).toHaveTextContent(all[1] ?? '');
      expect(row(all[1] ?? '')).toHaveClass('is-selected');
      // One at a time: the other row's detail is not there.
      expect(screen.getAllByRole('complementary')).toHaveLength(1);
      fireEvent.click(row(all[2] ?? ''));
      expect(detail(all[2] ?? '')).toBeVisible();
      fireEvent.click(row(all[2] ?? ''));
      expect(screen.queryByRole('complementary')).toBeNull();
    });

    it('is kept with the document when the workspace is shut and opened again', () => {
      setup(singleCutters(3));
      const [a] = names();
      fireEvent.click(row(a ?? ''));
      act(() => {
        editorStore.setWorkspace(null);
      });
      act(() => {
        openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
      });
      expect(detail(a ?? '')).toBeVisible();
    });

    it('lists the facts, every site with its bases around it, and the lane alone', () => {
      const [a] = activeEnzymes();
      if (a === undefined) throw new Error('table');
      setup([site(a.name, 101), site(a.name, 2001)]);
      fireEvent.click(row(a.name));
      const pane = detail(a.name);
      expect(within(pane).getByText(/overhang$/)).toBeVisible();
      const sites = within(within(pane).getByRole('table', { name: `${a.name} sites` }));
      const body = sites.getAllByRole('row').slice(1);
      expect(body).toHaveLength(2);
      expect(body.map((r) => r.querySelector('td')?.textContent)).toEqual(['101', '2,001']);
      // The recognition site in bold, ten bases of the top strand either side.
      const at = 2000;
      const bold = body[1]?.querySelector('strong');
      expect(bold?.textContent).toBe(doc.sequence.slice(at, at + a.site.length).toUpperCase());
      expect(body[1]?.querySelector('.dt__seq')?.textContent).toBe(
        doc.sequence.slice(at - 10, at + a.site.length + 10).toUpperCase(),
      );
      // Its lane alone, with its own name under it.
      expect(pane.querySelector('.gel [data-lane]')?.getAttribute('data-lane')).toBe(a.name);
      fireEvent.click(
        within(pane).getByRole('button', {
          name: `Select the ${a.name} site cut after base 2,001`,
        }),
      );
      expect(editorStore.getState().selection).toEqual({ start: 2000, end: 2000 + a.site.length });
    });

    it('reads the bases of a site at the origin of a circle round it', () => {
      const circle = SeqDocument.create({
        sequence: `AAAAAAAAAA${'C'.repeat(10)}${'G'.repeat(10)}${'T'.repeat(10)}`,
        topology: 'circular',
      });
      const [a] = activeEnzymes();
      if (a === undefined) throw new Error('table');
      act(() => {
        editorStore.openDocument(circle);
        editorStore.setAnalysis(circle, [{ ...site(a.name, 3), siteStart: 2 }], []);
        openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
      });
      render(<EnzymeWorkspace doc={circle} />);
      fireEvent.click(row(a.name));
      const text = detail(a.name).querySelector('.dt__seq')?.textContent;
      expect(text?.startsWith('TTTTTTTTAA')).toBe(true);
      expect(text).toHaveLength(10 + a.site.length + 10);
    });

    it('ticks and unticks, and the tick box in the row agrees', () => {
      setup(singleCutters(3));
      const [a] = names();
      act(() => {
        editorStore.setShownEnzymes([]);
      });
      fireEvent.click(row(a ?? ''));
      fireEvent.click(within(detail(a ?? '')).getByRole('button', { name: 'Tick' }));
      expect([...editorStore.getState().shownEnzymes]).toEqual([a]);
      expect(within(row(a ?? '')).getByRole('checkbox')).toBeChecked();
      fireEvent.click(within(detail(a ?? '')).getByRole('button', { name: 'Untick' }));
      expect(editorStore.getState().shownEnzymes.size).toBe(0);
    });

    it('goes to the Double page with the partner searched', () => {
      setup(singleCutters(4));
      const [, b] = names();
      fireEvent.click(row(b ?? ''));
      fireEvent.click(within(detail(b ?? '')).getByRole('button', { name: 'Find a partner ›' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Double digests' })).toBeVisible();
      expect(screen.getByLabelText('Pair')).toHaveValue(b);
      expect(screen.getByText(new RegExp(`Partners for ${b} among all`))).toBeVisible();
    });

    it('cannot find a partner for an enzyme that cuts too often', () => {
      const [a, b, c] = activeEnzymes();
      if (a === undefined || b === undefined || c === undefined) throw new Error('table');
      setup([
        ...[1, 11, 21, 31, 41].map((cut) => site(a.name, cut)),
        site(b.name, 101),
        site(c.name, 201),
      ]);
      fireEvent.click(row(a.name));
      expect(
        within(detail(a.name)).getByRole('button', { name: 'Find a partner ›' }),
      ).toBeDisabled();
    });

    it('tabulates the first 200 sites of an enzyme that cuts a great many times', () => {
      const [a] = activeEnzymes();
      if (a === undefined) throw new Error('table');
      setup(Array.from({ length: 250 }, (_, i) => site(a.name, i * 10 + 1)));
      fireEvent.click(row(a.name));
      const pane = detail(a.name);
      const table = within(pane).getByRole('table', { name: `${a.name} sites` });
      expect(table.querySelectorAll('tbody tr')).toHaveLength(200);
      expect(within(pane).getByText('The first 200 of 250 sites.')).toBeVisible();
      // And the row says how many there are beyond the positions it lists.
      expect(row(a.name).querySelector('.enz-cuts')).toHaveTextContent('+238');
    });

    it('names the other enzymes of an isoschizomer row in full', () => {
      const e = (name: string): Enzyme => ({
        name,
        site: 'GGATCC',
        cutTop: 1,
        cutBottom: 5,
        palindromic: true,
      });
      setActiveEnzymeSet({
        id: 'rebase',
        label: 'Test set',
        enzymes: [e('AliI'), e('BamHI'), e('BstI')],
        suppliers: [],
      });
      act(() => {
        editorStore.setEnzymeSetInfo({
          label: 'Test set',
          count: 3,
          bundled: false,
          fileName: null,
          custom: [],
          suppliers: [],
        });
      });
      try {
        setup([site('AliI', 101), site('BamHI', 101), site('BstI', 101)]);
        expect(rowEls()).toHaveLength(1);
        fireEvent.click(rowEls()[0] ?? document.body);
        expect(screen.getByText(/Same site and cut: /)).toHaveTextContent(/BstI/);
        expect(screen.getByText(/Same site and cut: /)).toHaveTextContent(/AliI/);
      } finally {
        cleanup();
        setActiveEnzymeSet(null);
      }
    });
  });

  it('lists three positions on a phone, and the count of the rest', () => {
    const [a] = activeEnzymes();
    if (a === undefined) throw new Error('table');
    setup(
      [1, 11, 21, 31, 41].map((cut) => site(a.name, cut)),
      'phone',
    );
    const cell = row(a.name).querySelector('.enz-cuts');
    expect(cell?.querySelectorAll('button')).toHaveLength(3);
    expect(cell).toHaveTextContent('+2');
  });

  it('says so, with the controls kept, when no enzyme matches', () => {
    setup(singleCutters(3));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter enzymes' }), {
      target: { value: 'zzzz' },
    });
    expect(rowEls()).toHaveLength(0);
    expect(screen.getByText('No enzyme matches that.')).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Filter enzymes' })).toHaveValue('zzzz');
  });

  it('says it is scanning before the sites are known', () => {
    act(() => {
      editorStore.openDocument(doc);
      openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
    });
    render(<Host />);
    expect(screen.getByText('Scanning for restriction sites…')).toBeVisible();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Filter enzymes' })).toBeVisible();
  });
});
