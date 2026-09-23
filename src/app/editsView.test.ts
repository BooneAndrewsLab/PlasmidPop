import { SeqDocument, createFeature, diffDocuments, rangeSegment } from '@/core';

import { describeEditDiff } from './editsView';
import { editDiffBetween, editDiffOf } from './state/editDiff';
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
