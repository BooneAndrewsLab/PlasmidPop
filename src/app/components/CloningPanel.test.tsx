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
      editorStore.clearShelf();
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
    expect(screen.queryByRole('heading', { name: /PCR/ })).toBeNull();

    act(() => {
      fireEvent.click(pick('PCR'));
    });
    expect(screen.getByRole('heading', { name: /PCR/ })).toBeInTheDocument();
    // One preview channel: the digest gives it up to the panel being worked in.
    expect(preview()).toBeNull();
    act(() => {
      fireEvent.click(pick('Ligation'));
    });
    expect(preview()?.owner).toBe('cloning');

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

  it('adds a fragment to the shelf when its span is clicked in a view', () => {
    act(() => {
      editorStore.setCloningReaction('gibson');
    });
    setup();
    const spans = preview()?.items ?? [];
    expect(spans.every((s) => s.clickable === true)).toBe(true);
    const small = spans[1];
    if (small === undefined) throw new Error('expected two spans');
    act(() => {
      editorStore.activatePreview(small.id);
    });
    const shelf = editorStore.getState().shelf;
    expect(shelf).toHaveLength(1);
    expect(shelf[0]?.fragment.sequence.length).toBe(1000);
    // The shelf is the bench's, above every reaction, so the picker stays on
    // the reaction being worked in and the fragment is seen landing (#16).
    expect(editorStore.getState().cloningReaction).toBe('gibson');
    expect(
      within(screen.getByRole('list', { name: 'Shelf' })).getByText(/1,000 bp/),
    ).toBeInTheDocument();

    // The same fragment twice is two parts: a shelf is a list, not a set.
    act(() => {
      editorStore.activatePreview(small.id);
    });
    expect(editorStore.getState().shelf).toHaveLength(2);
  });

  it("ligates the ticked shelf parts in the shelf's order", () => {
    setup();
    for (const add of screen.getAllByRole('button', { name: 'Add' })) {
      act(() => {
        fireEvent.click(add);
      });
    }
    const order = (): string[] =>
      within(screen.getByRole('list', { name: 'Ligation order' }))
        .getAllByRole('listitem')
        .filter((li) => li.className === 'part')
        .map((li) => li.querySelector('.part__detail')?.textContent ?? '');
    expect(order()).toEqual(['3,000 bp', '1,000 bp']);
    // A shelf part can be meant for another reaction, so the tick leaves it
    // out of this one without taking it off the shelf.
    const ticks = within(
      screen.getByRole('list', { name: 'Fragments in the ligation' }),
    ).getAllByRole('checkbox');
    const second = ticks[1];
    if (second === undefined) throw new Error('expected two ticks');
    act(() => {
      fireEvent.click(second);
    });
    expect(order()).toEqual(['3,000 bp']);
    expect(editorStore.getState().shelf).toHaveLength(2);
    // The shelf's order is the ligation's.
    act(() => {
      fireEvent.click(second);
      fireEvent.click(screen.getByRole('button', { name: 'Move part 2 up' }));
    });
    expect(order()).toEqual(['1,000 bp', '3,000 bp']);
  });

  it('ignores an activation meant for another panel', () => {
    setup();
    act(() => {
      editorStore.setPreview('find', [
        { id: 'm0', label: 'match', range: { start: 0, end: 4 }, strand: 'none', shape: 'arrow' },
      ]);
      editorStore.activatePreview('m0');
    });
    expect(editorStore.getState().shelf).toHaveLength(0);
  });

  it('does not answer a click again when the tab comes back', () => {
    const first = setup();
    const id = preview()?.items[0]?.id;
    if (id === undefined) throw new Error('no preview');
    act(() => {
      editorStore.activatePreview(id);
    });
    expect(editorStore.getState().shelf).toHaveLength(1);
    act(() => {
      first.unmount();
    });
    // Leaving the Cloning tab and coming back must not add it a second time.
    // The panel alone is remounted, as switching sidebar tabs does; the
    // document and its ticks are untouched.
    const again = render(<CloningPanel doc={doc} />);
    expect(editorStore.getState().shelf).toHaveLength(1);
    act(() => {
      again.unmount();
    });
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
