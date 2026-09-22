// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type CutSite, SeqDocument, getEnzyme } from '@/core';

import { editorStore } from '../state/editorStore';
import { CloningPanel } from './CloningPanel';

// 4,000 bp circular, cut at 400 and 1,400 by the first enzyme in the table:
// two fragments of 1,000 and 3,000 bp.
const doc = SeqDocument.create({ sequence: 'ACGT'.repeat(1000), topology: 'circular' });
const found = getEnzyme('EcoRI');
if (found === undefined) throw new Error('EcoRI is not in the enzyme table');
const enzyme = found.name;

const sites: CutSite[] = [400, 1400].map((cut) => ({
  enzyme,
  cut,
  cutBottom: cut + 4,
  siteStart: cut - 1,
  strand: 'forward' as const,
}));

function setup() {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setAnalysis(doc, sites, []);
    editorStore.setShownEnzymes([enzyme]);
  });
  return render(<CloningPanel doc={doc} />);
}

const preview = () => editorStore.getState().preview;

describe('CloningPanel', () => {
  beforeEach(() => {
    act(() => {
      editorStore.setCloningReaction('ligation');
    });
  });

  afterEach(() => {
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('shows one reaction at a time', () => {
    setup();
    const pick = (name: string): HTMLElement =>
      within(screen.getByRole('group', { name: 'Reaction' })).getByRole('button', { name });
    expect(screen.getByRole('heading', { name: /Ligation/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Golden Gate/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Gibson/ })).toBeNull();

    act(() => {
      fireEvent.click(pick('Gibson'));
    });
    expect(screen.getByRole('heading', { name: /Gibson/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Ligation/ })).toBeNull();
    // It is a preference, not panel state: it outlives the panel.
    expect(editorStore.getState().cloningReaction).toBe('gibson');

    act(() => {
      fireEvent.click(pick('Golden Gate'));
    });
    expect(screen.getByRole('heading', { name: /Golden Gate/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Gibson/ })).toBeNull();
  });

  it('draws the digest fragments on both views', () => {
    setup();
    const spans = preview()?.items ?? [];
    expect(preview()?.owner).toBe('cloning');
    // Largest first, as the list is; each a bracket with a tick at the cuts.
    expect(spans.map((s) => s.label)).toEqual(['3,000 bp', '1,000 bp']);
    expect(spans.map((s) => s.shape)).toEqual(['span', 'span']);
    // The 3,000 bp piece is the one that runs over the origin, unrolled.
    expect(spans[0]?.range).toEqual({ start: 1400, end: 4400 });
    expect(spans[1]?.range).toEqual({ start: 400, end: 1400 });
  });

  it('lights the fragment under the pointer, and no other', () => {
    setup();
    const rows = screen.getAllByRole('listitem').filter((li) => li.className === 'fragment');
    const second = rows[1];
    if (second === undefined) throw new Error('expected two fragment rows');
    act(() => {
      fireEvent.mouseEnter(second);
    });
    expect(preview()?.items.map((s) => s.shape)).toEqual(['span', 'arrow']);
    act(() => {
      fireEvent.mouseLeave(second);
    });
    expect(preview()?.items.map((s) => s.shape)).toEqual(['span', 'span']);
  });

  it('takes the fragments off the views when the tab is left', () => {
    const view = setup();
    expect(preview()).not.toBeNull();
    act(() => {
      view.unmount();
    });
    expect(preview()).toBeNull();
  });
});
