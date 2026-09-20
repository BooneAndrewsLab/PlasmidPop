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

function setup(sites: readonly CutSite[]) {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setAnalysis(doc, sites, []);
  });
  return render(<EnzymePanel doc={doc} />);
}

describe('EnzymePanel', () => {
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
