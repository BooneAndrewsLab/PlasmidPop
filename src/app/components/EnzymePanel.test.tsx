// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { type CutSite, SeqDocument, activeEnzymes } from '@/core';

import { MAX_DEFAULT_ENZYMES, editorStore } from '../state/editorStore';
import { EnzymePanel } from './EnzymePanel';

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
