import {
  type DocumentDiff,
  EMPTY_DIFF,
  SeqDocument,
  createFeature,
  diffDocuments,
  rangeSegment,
} from '@/core';

import {
  changeSelection,
  changeStops,
  describeEditDiff,
  describeIdentityChange,
  identityChange,
  renameNote,
  stepChange,
  topologyNote,
} from './editsView';
import { editDiffBetween, editDiffOf, identityChangeOf } from './state/editDiff';
import { EditorStore } from './state/editorStore';

const SEQ = 'ACGTTGCAAGGCTTAACCGG';

describe('describeEditDiff', () => {
  const base = SeqDocument.create({ sequence: SEQ });

  it('says nothing when there is nothing', () => {
    expect(describeEditDiff(null)).toBe('');
    expect(describeEditDiff(diffDocuments(base, base.rename('other')))).toBe('');
  });

  it('counts inserted, changed and deleted bases', () => {
    expect(describeEditDiff(diffDocuments(base, base.insert(4, 'TTT')))).toBe('+3 bp');
    expect(describeEditDiff(diffDocuments(base, base.delete({ start: 1, end: 2 })))).toBe('−1 bp');
    expect(describeEditDiff(diffDocuments(base, base.replace({ start: 4, end: 8 }, 'NNNN')))).toBe(
      '4 bp changed',
    );
  });

  it('says a molecule was turned over rather than replaced', () => {
    const long = SeqDocument.create({
      sequence: 'ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTA',
    });
    expect(describeEditDiff(diffDocuments(long, long.reverseComplement()))).toBe('turned over');
    expect(describeEditDiff(diffDocuments(long, long.reverseComplement().insert(30, 'GGG')))).toBe(
      'turned over · +3 bp',
    );
  });

  it('counts features touched and lost', () => {
    const feature = createFeature({ id: 'f', type: 'CDS', segments: [rangeSegment(2, 8)] });
    const withFeature = base.addFeature(feature);
    expect(describeEditDiff(diffDocuments(base, withFeature))).toBe('1 feature');
    expect(describeEditDiff(diffDocuments(withFeature, base))).toBe('−1 feature');
  });

  it('joins several kinds of change', () => {
    const edited = SeqDocument.create({ sequence: SEQ })
      .insert(4, 'TTT')
      .delete({ start: 14, end: 16 });
    expect(describeEditDiff(diffDocuments(base, edited))).toBe('+3 bp · −2 bp');
  });
});

describe('editDiff', () => {
  const base = SeqDocument.create({ sequence: SEQ });

  it('reuses the diff of the same pair of versions', () => {
    const edited = base.insert(0, 'TT');
    const first = editDiffBetween(base, edited);
    expect(editDiffBetween(base, edited)).toBe(first);
    expect(editDiffBetween(base, base)).toBeNull();
    expect(editDiffBetween(null, edited)).toBeNull();
  });

  it('is null while there is nothing to mark', () => {
    const store = new EditorStore();
    store.openDocument(base, 'x.gb');
    expect(editDiffOf(store.getState())).toBeNull();
    store.apply({ type: 'insert', position: 0, text: 'TT' });
    expect(editDiffOf(store.getState())?.basesInserted).toBe(2);
    store.setEditsBaseline('off');
    expect(editDiffOf(store.getState())).toBeNull();
  });

  it('is null for a change no mark can show', () => {
    const store = new EditorStore();
    store.openDocument(base, 'x.gb');
    store.apply({ type: 'rename', name: 'renamed' });
    expect(editDiffOf(store.getState())).toBeNull();
  });
});

/** A diff with just these marks and deletions, the rest empty. */
function marked(
  marks: readonly [number, number][],
  deletions: readonly number[] = [],
): DocumentDiff {
  return {
    ...EMPTY_DIFF,
    marks: marks.map(([start, end]) => ({ kind: 'inserted' as const, start, end })),
    deletions: deletions.map((position) => ({ position, count: 1 })),
  };
}

describe('changeStops', () => {
  it('has none for no diff or an empty one', () => {
    expect(changeStops(null, 100, false)).toEqual([]);
    expect(changeStops(EMPTY_DIFF, 100, true)).toEqual([]);
  });

  it('puts marks and deletions in document order, a deletion before a mark at the same place', () => {
    expect(
      changeStops(
        marked(
          [
            [10, 14],
            [40, 41],
          ],
          [30, 10],
        ),
        100,
        false,
      ),
    ).toEqual([
      { start: 10, end: 10 },
      { start: 10, end: 14 },
      { start: 30, end: 30 },
      { start: 40, end: 41 },
    ]);
  });

  it('joins the marks either side of the origin of a circle into one', () => {
    expect(
      changeStops(
        marked([
          [0, 3],
          [50, 52],
          [97, 100],
        ]),
        100,
        true,
      ),
    ).toEqual([
      { start: 50, end: 52 },
      { start: 97, end: 103 },
    ]);
    // On a line the two ends are two places.
    expect(
      changeStops(
        marked([
          [0, 3],
          [97, 100],
        ]),
        100,
        false,
      ),
    ).toHaveLength(2);
  });

  it('takes a deletion after the last base of a circle as the one before the first', () => {
    expect(changeStops(marked([[5, 6]], [100, 0]), 100, true)).toEqual([
      { start: 0, end: 0 },
      { start: 5, end: 6 },
    ]);
  });

  it('comes from a real diff of an edited circle', () => {
    const doc = SeqDocument.create({ sequence: SEQ, topology: 'circular' });
    const edited = doc.insert(4, 'TTT').delete({ start: 15, end: 17 });
    const stops = changeStops(diffDocuments(doc, edited), edited.length, true);
    // Where in a run of Ts the diff puts the insertion is its own choice.
    expect(stops).toHaveLength(2);
    expect(stops[0]?.end).toBe((stops[0]?.start ?? 0) + 3);
    expect(stops[1]?.start).toBe(stops[1]?.end);
  });
});

describe('stepChange', () => {
  const stops = changeStops(
    marked(
      [
        [10, 14],
        [40, 41],
      ],
      [10, 30],
    ),
    100,
    false,
  );

  it('finds nothing with nothing marked', () => {
    expect(stepChange([], { start: 5, end: 5 }, 1)).toBeNull();
    expect(stepChange([], null, -1)).toBeNull();
  });

  it('starts at either end with nothing selected', () => {
    expect(stepChange(stops, null, 1)).toEqual({ start: 10, end: 10 });
    expect(stepChange(stops, null, -1)).toEqual({ start: 40, end: 41 });
  });

  it('steps forward and back from the selection', () => {
    expect(stepChange(stops, { start: 20, end: 25 }, 1)).toEqual({ start: 30, end: 30 });
    expect(stepChange(stops, { start: 20, end: 25 }, -1)).toEqual({ start: 10, end: 14 });
    // A selection that is a stop moves to the one beside it.
    expect(stepChange(stops, { start: 30, end: 30 }, 1)).toEqual({ start: 40, end: 41 });
    expect(stepChange(stops, { start: 30, end: 30 }, -1)).toEqual({ start: 10, end: 14 });
  });

  it('goes to the mark a caret is on the start of, past a deletion there', () => {
    // The caret is where the deletion is, so the mark starting there is next.
    expect(stepChange(stops, { start: 10, end: 10 }, 1)).toEqual({ start: 10, end: 14 });
    expect(stepChange(stops, { start: 10, end: 14 }, -1)).toEqual({ start: 10, end: 10 });
    const noDeletion = changeStops(marked([[10, 14]]), 100, false);
    expect(stepChange(noDeletion, { start: 10, end: 10 }, 1)).toEqual({ start: 10, end: 14 });
  });

  it('goes back to a mark from inside it', () => {
    expect(stepChange(stops, { start: 12, end: 12 }, -1)).toEqual({ start: 10, end: 14 });
    expect(stepChange(stops, { start: 12, end: 12 }, 1)).toEqual({ start: 30, end: 30 });
  });

  it('wraps round at either end', () => {
    expect(stepChange(stops, { start: 40, end: 41 }, 1)).toEqual({ start: 10, end: 10 });
    expect(stepChange(stops, { start: 90, end: 90 }, 1)).toEqual({ start: 10, end: 10 });
    expect(stepChange(stops, { start: 10, end: 10 }, -1)).toEqual({ start: 40, end: 41 });
    expect(stepChange(stops, { start: 0, end: 0 }, -1)).toEqual({ start: 40, end: 41 });
    // One stop is its own next and previous.
    const one = changeStops(marked([[5, 6]]), 100, false);
    expect(stepChange(one, { start: 5, end: 6 }, 1)).toEqual({ start: 5, end: 6 });
    expect(stepChange(one, { start: 5, end: 6 }, -1)).toEqual({ start: 5, end: 6 });
  });

  it('selects a change across the origin of a circle as one wrapping range', () => {
    const circle = changeStops(
      marked([
        [0, 3],
        [50, 52],
        [97, 100],
      ]),
      100,
      true,
    );
    expect(stepChange(circle, { start: 60, end: 60 }, 1)).toEqual({ start: 97, end: 103 });
    // From inside its head, just past the origin, back is the change itself.
    expect(stepChange(circle, { start: 1, end: 1 }, -1)).toEqual({ start: 97, end: 103 });
    expect(stepChange(circle, { start: 1, end: 1 }, 1)).toEqual({ start: 50, end: 52 });
    expect(stepChange(circle, { start: 97, end: 103 }, 1)).toEqual({ start: 50, end: 52 });
    expect(stepChange(circle, { start: 50, end: 52 }, -1)).toEqual({ start: 97, end: 103 });
  });
});

describe('changeSelection', () => {
  const diff: DocumentDiff = {
    ...EMPTY_DIFF,
    marks: [
      { kind: 'inserted', start: 0, end: 5 },
      { kind: 'changed', start: 40, end: 48 },
      { kind: 'inserted', start: 95, end: 100 },
    ],
    deletions: [
      { position: 20, count: 3 },
      { position: 100, count: 2 },
    ],
    featuresRemoved: new Map([
      [
        'gone',
        createFeature({ id: 'gone', type: 'CDS', name: 'bla', segments: [rangeSegment(60, 80)] }),
      ],
    ]),
  };

  it('selects a mark as Next change would', () => {
    expect(changeSelection({ kind: 'mark', index: 1 }, diff, 100, true)).toEqual({
      start: 40,
      end: 48,
    });
  });

  it('selects both halves of a change across the origin as one, from either half', () => {
    const across = { start: 95, end: 105 };
    expect(changeSelection({ kind: 'mark', index: 0 }, diff, 100, true)).toEqual(across);
    expect(changeSelection({ kind: 'mark', index: 2 }, diff, 100, true)).toEqual(across);
    // A line has no origin to cross: each half is its own.
    expect(changeSelection({ kind: 'mark', index: 0 }, diff, 100, false)).toEqual({
      start: 0,
      end: 5,
    });
  });

  it('puts the caret at a deletion, the end of a circle being its start', () => {
    expect(changeSelection({ kind: 'deletion', index: 0 }, diff, 100, true)).toEqual({
      start: 20,
      end: 20,
    });
    expect(changeSelection({ kind: 'deletion', index: 1 }, diff, 100, true)).toEqual({
      start: 0,
      end: 0,
    });
    expect(changeSelection({ kind: 'deletion', index: 1 }, diff, 100, false)).toEqual({
      start: 100,
      end: 100,
    });
  });

  it('selects the span a removed feature maps to', () => {
    expect(changeSelection({ kind: 'removed', featureId: 'gone' }, diff, 100, true)).toEqual({
      start: 60,
      end: 80,
    });
  });

  it('selects nothing for a change the diff no longer has', () => {
    expect(changeSelection({ kind: 'mark', index: 9 }, diff, 100, true)).toBeNull();
    expect(changeSelection({ kind: 'deletion', index: 9 }, diff, 100, true)).toBeNull();
    expect(changeSelection({ kind: 'removed', featureId: 'x' }, diff, 100, true)).toBeNull();
  });
});

describe('identityChange (#31)', () => {
  const linear = SeqDocument.create({ name: 'pA', sequence: SEQ });

  it('is null when the name and the shape are the same, or there is no baseline', () => {
    expect(identityChange(linear, linear.insert(0, 'A'))).toBeNull();
    expect(identityChange(null, linear)).toBeNull();
    expect(identityChange(linear, null)).toBeNull();
  });

  it('keeps what the baseline was called and what shape it was', () => {
    expect(identityChange(linear, linear.rename('pB'))).toEqual({
      nameWas: 'pA',
      topologyWas: null,
    });
    expect(identityChange(linear, linear.setTopology('circular'))).toEqual({
      nameWas: null,
      topologyWas: 'linear',
    });
    const both = identityChange(linear, linear.rename('pB').setTopology('circular'));
    expect(both).toEqual({ nameWas: 'pA', topologyWas: 'linear' });
    expect(describeIdentityChange(both)).toBe('renamed · made circular');
    expect(describeIdentityChange(null)).toBe('');
  });

  it('says it for the tooltip, against a version or against another file', () => {
    expect(renameNote('pA', null)).toBe('Renamed from “pA”');
    expect(renameNote('pA', 'theirs.gb')).toBe('Named “pA” in theirs.gb');
    expect(topologyNote('linear', null)).toBe('Was linear');
    expect(topologyNote('circular', 'theirs.gb')).toBe('Circular in theirs.gb');
  });

  it('follows the baseline, off included', () => {
    const store = new EditorStore();
    store.openDocument(linear);
    store.setEditsBaseline('opened');
    store.apply({ type: 'rename', name: 'pB' });
    expect(identityChangeOf(store.getState())?.nameWas).toBe('pA');
    store.setEditsBaseline('off');
    expect(identityChangeOf(store.getState())).toBeNull();
    store.setEditsBaseline('opened');
    store.markEditsFromHere();
    expect(identityChangeOf(store.getState())).toBeNull();
    store.apply({ type: 'setTopology', topology: 'circular' });
    expect(identityChangeOf(store.getState())).toEqual({ nameWas: null, topologyWas: 'linear' });
  });
});
