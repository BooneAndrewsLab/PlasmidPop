// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type Feature, SeqDocument, createFeature, rangeSegment } from '@/core';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { FeatureList } from './FeatureList';

const feature = (id: string, type: string, start: number, length = 60): Feature =>
  createFeature({ id, type, name: id, segments: [rangeSegment(start, start + length)] });

/**
 * An NCBI gene region as it opens: a source, then a gene, an mRNA and a CDS
 * for each of `genes`, every feature on bases of its own.
 */
const region = (genes: number): SeqDocument =>
  SeqDocument.create({
    name: 'region',
    sequence: 'ACGT'.repeat(1000),
    features: [
      feature('src', 'source', 0, 4000),
      ...Array.from({ length: genes }, (_, i) => [
        feature(`gene${String(i)}`, 'gene', 100 + i * 1000, 800),
        feature(`mrna${String(i)}`, 'mRNA', 110 + i * 1000, 700),
        feature(`cds${String(i)}`, 'CDS', 200 + i * 1000, 300),
      ]).flat(),
    ],
  });

/** Three gene/mRNA/CDS triples and a source: the BNI1 case, ten features. */
const ten = region(3);

const open = (doc: SeqDocument, reader = false) => {
  act(() => {
    editorStore.openDocument(doc);
  });
  const view = render(<FeatureList doc={doc} reader={reader} />);
  return {
    ...view,
    /** Draws the list again from the store's document, as the app does. */
    refresh: (): void => {
      view.rerender(<FeatureList doc={editorStore.document ?? doc} reader={reader} />);
    },
  };
};

/** The names of the rows the list shows, top to bottom. */
const rows = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('.feature-row__name')].map((n) => n.textContent.trim());

const filter = (): HTMLElement => screen.getByRole('group', { name: 'Filter by type' });
const chip = (type: string, count: number): HTMLElement =>
  within(filter()).getByRole('button', {
    name: `${type}, ${String(count)} ${count === 1 ? 'feature' : 'features'}`,
  });
const allChip = (count: number): HTMLElement =>
  within(filter()).getByRole('button', { name: `All types, ${String(count)} features` });

beforeEach(() => {
  forgetPanels();
});

describe('Features tab: filter by type (#453)', () => {
  it('is not offered for a list short enough to see whole, or of one type', () => {
    // source, gene, mRNA, CDS: the ACT1 case.
    open(region(1));
    expect(screen.queryByRole('group', { name: 'Filter by type' })).toBeNull();

    const same = SeqDocument.create({
      name: 'same',
      sequence: 'ACGT'.repeat(1000),
      features: Array.from({ length: 30 }, (_, i) =>
        feature(`f${String(i)}`, 'misc_feature', i * 100),
      ),
    });
    open(same);
    expect(screen.queryByRole('group', { name: 'Filter by type' })).toBeNull();
  });

  it('offers All and a chip for each type the list has, with how many, none switched on', () => {
    const view = open(ten);
    const buttons = within(filter()).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'All types, 10 features',
      'CDS, 3 features',
      'gene, 3 features',
      'mRNA, 3 features',
      'source, 1 feature',
    ]);
    // What is read on the chip: the type and the count.
    expect(buttons.map((b) => b.textContent)).toEqual([
      'All10',
      'CDS3',
      'gene3',
      'mRNA3',
      'source1',
    ]);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    for (const b of buttons) expect(b).toHaveAttribute('type', 'button');
    expect(rows(view.container)).toHaveLength(10);
    expect(view.container.querySelector('.features__count')?.textContent).toBe('10');
  });

  it('comes before the rows in the tab order', () => {
    const view = open(ten);
    const focusable = [...view.container.querySelectorAll('button')];
    const firstRow = focusable.findIndex((b) => b.classList.contains('feature-row'));
    const lastChip = focusable.lastIndexOf(chip('source', 1) as HTMLButtonElement);
    expect(focusable.indexOf(allChip(10) as HTMLButtonElement)).toBeLessThan(lastChip);
    expect(lastChip).toBeLessThan(firstRow);
  });

  it('shows the features of the types switched on, any number of them', () => {
    const view = open(ten);
    fireEvent.click(chip('CDS', 3));
    expect(rows(view.container)).toEqual(['cds0', 'cds1', 'cds2']);
    expect(chip('CDS', 3)).toHaveAttribute('aria-pressed', 'true');
    expect(allChip(10)).toHaveAttribute('aria-pressed', 'false');
    expect(view.container.querySelector('.features__count')?.textContent).toBe('3 of 10');

    fireEvent.click(chip('gene', 3));
    expect(rows(view.container)).toEqual(['gene0', 'cds0', 'gene1', 'cds1', 'gene2', 'cds2']);
    expect(view.container.querySelector('.features__count')?.textContent).toBe('6 of 10');
    // The counts on the chips are the document's, not the filter's.
    expect(chip('mRNA', 3)).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(chip('CDS', 3));
    expect(rows(view.container)).toEqual(['gene0', 'gene1', 'gene2']);
  });

  it('goes back to every feature on All, or when the last type is switched off', () => {
    const view = open(ten);
    fireEvent.click(chip('CDS', 3));
    fireEvent.click(chip('mRNA', 3));
    fireEvent.click(allChip(10));
    expect(rows(view.container)).toHaveLength(10);
    expect(allChip(10)).toHaveAttribute('aria-pressed', 'true');
    expect(chip('CDS', 3)).toHaveAttribute('aria-pressed', 'false');
    expect(chip('mRNA', 3)).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(chip('gene', 3));
    fireEvent.click(chip('gene', 3));
    expect(rows(view.container)).toHaveLength(10);
    expect(allChip(10)).toHaveAttribute('aria-pressed', 'true');
  });

  it('changes nothing but the list: not the document, its history or the selection', () => {
    const view = open(ten);
    act(() => {
      editorStore.selectFeature('gene1');
    });
    const before = editorStore.getState();
    fireEvent.click(chip('CDS', 3));
    fireEvent.click(chip('mRNA', 3));
    fireEvent.click(allChip(10));
    const after = editorStore.getState();
    expect(after.history).toBe(before.history);
    expect(editorStore.document).toBe(ten);
    expect(after.selection).toEqual(before.selection);
    expect(after.selectedFeatureId).toBe('gene1');
    expect(after.hiddenFeatureTypes).toBe(before.hiddenFeatureTypes);
    expect(rows(view.container)).toHaveLength(10);
  });

  it('says so when the selected feature is filtered out, keeps it selected, and brings it back', () => {
    const view = open(ten);
    act(() => {
      editorStore.selectFeature('gene1');
    });
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(chip('CDS', 3));
    expect(rows(view.container)).toEqual(['cds0', 'cds1', 'cds2']);
    expect(view.container.querySelector('.feature-item--selected')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(
      'The selected feature, gene1 (gene), is not of a type shown here.',
    );
    expect(editorStore.getState().selectedFeatureId).toBe('gene1');
    expect(editorStore.getState().selection).toEqual({ start: 1100, end: 1900 });

    fireEvent.click(screen.getByRole('button', { name: 'Show gene too' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(chip('gene', 3)).toHaveAttribute('aria-pressed', 'true');
    expect(chip('CDS', 3)).toHaveAttribute('aria-pressed', 'true');
    expect(view.container.querySelector('.feature-item--selected')?.textContent).toContain('gene1');
  });

  it('says so when a feature of another type is selected from outside while filtered', () => {
    open(ten);
    fireEvent.click(chip('CDS', 3));
    expect(screen.queryByRole('status')).toBeNull();
    // A click on the map selects through the store, as this does.
    act(() => {
      editorStore.selectFeature('mrna2');
    });
    expect(screen.getByRole('status').textContent).toContain('mrna2 (mRNA)');
    // One that is listed needs no note.
    act(() => {
      editorStore.selectFeature('cds1');
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('scrolls to the selected row again when the filter brings it back', () => {
    const view = open(ten);
    act(() => {
      editorStore.selectFeature('gene1');
    });
    fireEvent.click(chip('CDS', 3));
    const scrolled: string[] = [];
    // jsdom has no scrollIntoView of its own, so one is lent for the test.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent);
    };
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Show gene too' }));
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0]).toContain('gene1');
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
    expect(rows(view.container)).toContain('gene1');
  });

  it('keeps the row of a feature being edited or renamed, whatever its type', () => {
    const view = open(ten);
    fireEvent.click(chip('CDS', 3));
    act(() => {
      editorStore.editFeature('gene1');
    });
    // The editor is in the list, between the CDS rows it sits between.
    expect(rows(view.container)).toEqual(['cds0', 'gene1', 'cds1', 'cds2']);
    act(() => {
      editorStore.editFeature(null);
    });
    expect(rows(view.container)).toEqual(['cds0', 'cds1', 'cds2']);

    act(() => {
      editorStore.requestRename('mrna0');
    });
    expect(screen.getByRole('textbox', { name: 'Feature name' })).toHaveValue('mrna0');
    act(() => {
      editorStore.finishRename();
    });
    expect(screen.queryByRole('textbox', { name: 'Feature name' })).toBeNull();
  });

  it('says what is missing when the filter leaves no rows, and offers every feature back', () => {
    const view = open(ten);
    fireEvent.click(chip('CDS', 3));
    act(() => {
      for (const id of ['cds0', 'cds1', 'cds2']) editorStore.apply({ type: 'removeFeature', id });
    });
    view.refresh();
    expect(rows(view.container)).toEqual([]);
    expect(view.container.querySelector('.features__empty')?.textContent).toContain(
      'No CDS features in this list.',
    );
    // The chip stays, at zero and on, so the filter can be seen and undone.
    expect(chip('CDS', 0)).toHaveAttribute('aria-pressed', 'true');
    expect(view.container.querySelector('.features__count')?.textContent).toBe('0 of 7');

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(rows(view.container)).toHaveLength(7);
    expect(view.container.querySelector('.features__empty')).toBeNull();
    // Seven features are under the minimum, and nothing is set: no filter.
    expect(screen.queryByRole('group', { name: 'Filter by type' })).toBeNull();
  });

  it('follows the document: counts change with an edit, and Undo brings the rows back', () => {
    const view = open(ten);
    fireEvent.click(chip('CDS', 3));
    act(() => {
      editorStore.apply({ type: 'removeFeature', id: 'cds1' });
    });
    view.refresh();
    expect(rows(view.container)).toEqual(['cds0', 'cds2']);
    expect(chip('CDS', 2)).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      editorStore.undo();
    });
    view.refresh();
    expect(rows(view.container)).toEqual(['cds0', 'cds1', 'cds2']);
  });

  it('is remembered for the document while the tab is away, and not taken to another', () => {
    const first = open(ten);
    fireEvent.click(chip('mRNA', 3));
    expect(rows(first.container)).toEqual(['mrna0', 'mrna1', 'mrna2']);
    // Another sidebar tab unmounts the list; coming back mounts a new one.
    first.unmount();
    const back = render(<FeatureList doc={ten} />);
    expect(rows(back.container)).toEqual(['mrna0', 'mrna1', 'mrna2']);
    expect(chip('mRNA', 3)).toHaveAttribute('aria-pressed', 'true');
    back.unmount();

    // A second document starts with every feature listed.
    const other = open(region(4));
    expect(rows(other.container)).toHaveLength(13);
    expect(allChip(13)).toHaveAttribute('aria-pressed', 'true');
  });

  it('folds the less common types behind a button once there are many, never one that is on', () => {
    // Twelve types: t00 has twelve features, t01 eleven, down to t11 with one.
    const crowded = SeqDocument.create({
      name: 'crowded',
      sequence: 'ACGT'.repeat(1000),
      features: Array.from({ length: 12 }, (_, t) =>
        Array.from({ length: 12 - t }, (_, i) =>
          feature(
            `t${String(t)}-${String(i)}`,
            `t${String(t).padStart(2, '0')}`,
            t * 300 + i * 20,
            10,
          ),
        ),
      ).flat(),
    });
    const view = open(crowded);
    const labels = (): (string | null)[] =>
      within(filter())
        .getAllByRole('button')
        .map((b) => b.textContent);
    expect(labels()).toEqual([
      'All78',
      't0012',
      't0111',
      't0210',
      't039',
      't048',
      't057',
      't066',
      't075',
      '+4 more',
    ]);
    const more = within(filter()).getByRole('button', { name: '+4 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).not.toHaveAttribute('aria-pressed');

    fireEvent.click(more);
    expect(labels()).toHaveLength(14);
    expect(labels().slice(-5)).toEqual(['t084', 't093', 't102', 't111', 'Fewer types']);
    const fewer = within(filter()).getByRole('button', { name: 'Fewer types' });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');

    // A type switched on stays in sight when the rest fold again.
    fireEvent.click(chip('t10', 2));
    fireEvent.click(fewer);
    expect(labels().slice(-3)).toEqual(['t075', 't102', '+3 more']);
    expect(chip('t10', 2)).toHaveAttribute('aria-pressed', 'true');
    expect(rows(view.container)).toEqual(['t10-0', 't10-1']);
  });

  it('is there in the read-only list too', () => {
    const view = open(ten, true);
    fireEvent.click(chip('gene', 3));
    expect(rows(view.container)).toEqual(['gene0', 'gene1', 'gene2']);
  });

  it('counts a use once a visit, and sends no type, name or number', () => {
    const once = vi.spyOn(analytics, 'trackOnce');
    const each = vi.spyOn(analytics, 'track');
    try {
      open(ten);
      fireEvent.click(chip('CDS', 3));
      fireEvent.click(chip('gene', 3));
      fireEvent.click(allChip(10));
      expect(once.mock.calls).toEqual([
        ['features', 'filter'],
        ['features', 'filter'],
      ]);
      // `trackOnce` is what drops the second; nothing goes past it by hand.
      expect(each.mock.calls.filter(([category]) => category === 'features').length).toBeLessThan(
        2,
      );
    } finally {
      once.mockRestore();
      each.mockRestore();
    }
  });
});
