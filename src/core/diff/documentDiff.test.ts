import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import { SeqDocument } from '../document';
import { createFeature, rangeSegment, siteSegment } from '../features';
import { diffDocuments, isEmptyDiff, marksIn } from './documentDiff';

const SEQ = 'ACGTTGCAAGGCTTAACCGG'; // 20 bases, all positions identifiable

// The diff reports the shortest description of the difference, which is not
// always the edit that produced it: where several placements are equivalent
// (a base inserted next to an identical one) it picks one, so the fixtures
// below use bases that make the answer unambiguous.

function doc(sequence = SEQ, topology: 'linear' | 'circular' = 'linear'): SeqDocument {
  return SeqDocument.create({ name: 'test', sequence, topology });
}

function spans(marks: readonly { kind: string; start: number; end: number }[]): string[] {
  return marks.map((m) => `${m.kind} ${m.start}-${m.end}`);
}

describe('diffDocuments', () => {
  it('is empty for the same document', () => {
    const d = doc();
    expect(isEmptyDiff(diffDocuments(d, d))).toBe(true);
    expect(isEmptyDiff(diffDocuments(d, doc()))).toBe(true);
  });

  it('marks inserted bases', () => {
    const before = doc();
    const after = before.insert(5, 'TTT');
    const diff = diffDocuments(before, after);
    expect(spans(diff.marks)).toEqual(['inserted 5-8']);
    expect(diff.deletions).toEqual([]);
    expect(diff.basesInserted).toBe(3);
  });

  it('marks where bases were deleted', () => {
    const before = doc();
    const after = before.delete({ start: 1, end: 4 });
    const diff = diffDocuments(before, after);
    expect(diff.marks).toEqual([]);
    expect(diff.deletions).toEqual([{ position: 1, count: 3 }]);
    expect(diff.basesDeleted).toBe(3);
  });

  it('marks a same-length replacement as changed, not inserted', () => {
    const before = doc();
    const after = before.replace({ start: 4, end: 8 }, 'NNNN');
    const diff = diffDocuments(before, after);
    expect(spans(diff.marks)).toEqual(['changed 4-8']);
    expect(diff.basesChanged).toBe(4);
    expect(diff.deletions).toEqual([]);
  });

  it('reports the surplus of a shortening replacement as a deletion', () => {
    const before = doc();
    const after = before.replace({ start: 4, end: 10 }, 'NN');
    const diff = diffDocuments(before, after);
    expect(spans(diff.marks)).toEqual(['changed 4-6']);
    expect(diff.deletions).toEqual([{ position: 6, count: 4 }]);
  });

  it('reports only what really differs, not what the edit op did', () => {
    // Replacing TGCAAG with AA leaves one of the old bases standing where the
    // new ones go, so the difference is smaller than the edit: four bases
    // gone and one changed, not six replaced by two.
    const before = doc();
    const diff = diffDocuments(before, before.replace({ start: 4, end: 10 }, 'AA'));
    expect(diff.basesDeleted).toBe(4);
    expect(diff.basesChanged).toBe(1);
  });

  it('keeps several edits apart and in order', () => {
    const before = doc(`${SEQ}${SEQ}${SEQ}`);
    const after = before.insert(45, 'CCC').insert(10, 'TTT');
    const diff = diffDocuments(before, after);
    expect(spans(diff.marks)).toEqual(['inserted 10-13', 'inserted 48-51']);
  });

  it('notices a rename and a topology change without marking bases', () => {
    const before = doc();
    const diff = diffDocuments(before, before.rename('other').setTopology('circular'));
    expect(diff.renamed).toBe(true);
    expect(diff.topologyChanged).toBe(true);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it('marks the whole middle when the sequences are too different to follow', () => {
    const before = doc('ACGT'.repeat(30));
    const after = doc('TGCA'.repeat(30));
    const diff = diffDocuments(before, after, { maxEdits: 4 });
    expect(diff.coarse).toBe(true);
    expect(diff.marks).toHaveLength(1);
    expect(diff.marks[0]?.kind).toBe('changed');
  });

  it('marks a moved origin as changed throughout', () => {
    const before = doc(SEQ, 'circular');
    const diff = diffDocuments(before, before.setOrigin(7), { maxEdits: 40 });
    expect(diff.marks.length).toBeGreaterThan(0);
  });
});

describe('diffDocuments features', () => {
  const feature = createFeature({
    id: 'f1',
    type: 'CDS',
    name: 'gene',
    segments: [rangeSegment(4, 12)],
  });
  const base = SeqDocument.create({ sequence: SEQ, features: [feature] });

  it('lists features that were added and removed', () => {
    const extra = createFeature({ id: 'f2', type: 'promoter', segments: [rangeSegment(0, 3)] });
    const added = diffDocuments(base, base.addFeature(extra));
    expect([...added.featuresAdded]).toEqual(['f2']);
    expect(added.featuresRemoved.size).toBe(0);

    const removed = diffDocuments(base, base.removeFeature('f1'));
    expect(removed.featuresRemoved.size).toBe(1);
    expect(removed.featuresAdded.size).toBe(0);
    // The feature itself, so a review can name it: it is in neither
    // document the caller holds.
    expect(removed.featuresRemoved.get('f1')?.name).toBe('gene');
  });

  it('matches features by what they are when the two files give them different ids', () => {
    // Two parses of the same record share nothing but content: every feature
    // gets a fresh id, so matching by id alone would call every one of them
    // removed and added again. This is what Compare with… is made of.
    const reparsed = SeqDocument.create({
      sequence: SEQ,
      features: [createFeature({ ...feature, id: 'other-id' })],
    });
    expect(isEmptyDiff(diffDocuments(base, reparsed))).toBe(true);

    // A feature that differs is the same feature changed, not a loss and a
    // gain at the same coordinates: it is in the same place and still
    // recognisable, by its type here since the name is what changed.
    const renamed = SeqDocument.create({
      sequence: SEQ,
      features: [createFeature({ ...feature, id: 'other-id', name: 'gene2' })],
    });
    const diff = diffDocuments(base, renamed);
    expect(diff.featuresAdded.size).toBe(0);
    expect(diff.featuresRemoved.size).toBe(0);
    expect([...diff.featuresChanged.keys()]).toEqual(['other-id']);
    expect(diff.featuresChanged.get('other-id')?.name).toBe(feature.name);
  });

  it('pairs a feature whose type was edited, by its name and its place', () => {
    // The base feature is a CDS called "gene"; this is the same thing typed
    // as a gene instead, which is the case that sent us here.
    const retyped = SeqDocument.create({
      sequence: SEQ,
      features: [createFeature({ ...feature, id: 'other-id', type: 'gene' })],
    });
    const diff = diffDocuments(base, retyped);
    expect(diff.featuresAdded.size).toBe(0);
    expect(diff.featuresRemoved.size).toBe(0);
    expect(diff.featuresChanged.get('other-id')?.type).toBe('CDS');
  });

  it('will not pair two features that share only a place', () => {
    // A gene and the CDS inside it cover the same bases on a real record and
    // are not versions of one another, so losing one and gaining the other
    // is two events, not one change.
    const other = SeqDocument.create({
      sequence: SEQ,
      features: [
        createFeature({
          ...feature,
          id: 'other-id',
          type: 'promoter',
          name: 'operator',
        }),
      ],
    });
    const diff = diffDocuments(base, other);
    expect([...diff.featuresAdded]).toEqual(['other-id']);
    expect([...diff.featuresRemoved.keys()]).toEqual(['f1']);
    expect(diff.featuresChanged.size).toBe(0);
  });

  it('pairs each feature once, so a duplicate still reads as added', () => {
    const twice = SeqDocument.create({
      sequence: SEQ,
      features: [createFeature({ ...feature, id: 'a' }), createFeature({ ...feature, id: 'b' })],
    });
    const diff = diffDocuments(base, twice);
    expect(diff.featuresAdded.size).toBe(1);
    expect(diff.featuresRemoved.size).toBe(0);
  });

  it('puts a removed feature where the edits since have left its bases', () => {
    // Three bases inserted before it, so what was 4..12 is now 7..15.
    const after = base.insert(0, 'TTT').removeFeature('f1');
    const gone = diffDocuments(base, after).featuresRemoved.get('f1');
    expect(gone?.segments[0]).toMatchObject({ start: 7, end: 15 });
  });

  it('collapses a feature the deletion swallowed to the boundary it left', () => {
    // 4..12 deleted outright, so the feature has no bases left to sit on and
    // comes out at the boundary. Not a single point: the base at 4 is a T
    // and so is the one that follows the deletion, so the shortest edit
    // script deletes 5..13 and the feature's own ends map either side of it.
    // Near enough for the review, which groups by the deletion beside it.
    const after = base.delete({ start: 4, end: 12 }).removeFeature('f1');
    const diff = diffDocuments(base, after);
    expect(diff.featuresRemoved.get('f1')?.segments[0]).toMatchObject({ start: 4, end: 5 });
    expect(diff.deletions).toEqual([{ position: 5, count: 8 }]);
  });

  it('marks a feature whose annotation was edited', () => {
    const diff = diffDocuments(base, base.updateFeature('f1', { name: 'renamed' }));
    expect([...diff.featuresChanged.keys()]).toEqual(['f1']);
    // The before is carried with it, so a review can say what changed.
    expect(diff.featuresChanged.get('f1')?.name).toBe(feature.name);
  });

  it('marks a feature whose location was edited by hand', () => {
    const diff = diffDocuments(base, base.updateFeature('f1', { segments: [rangeSegment(4, 15)] }));
    expect([...diff.featuresChanged.keys()]).toEqual(['f1']);
  });

  it('leaves a feature alone when an edit elsewhere only shifted it', () => {
    const diff = diffDocuments(base, base.insert(0, 'TTTT'));
    expect(diff.featuresChanged.size).toBe(0);
    expect(base.getFeature('f1')?.segments[0]).not.toEqual(
      base.insert(0, 'TTTT').getFeature('f1')?.segments[0],
    );
  });

  it('leaves a feature alone when the edit moved the codon its /transl_except names', () => {
    const cds = createFeature({
      id: 'f1',
      type: 'CDS',
      segments: [rangeSegment(4, 12)],
      qualifiers: [{ name: 'transl_except', value: '(pos:8..10,aa:Sec)' }],
    });
    const before = SeqDocument.create({ sequence: SEQ, features: [cds] });
    const after = before.insert(0, 'TTTT');
    expect(after.getFeature('f1')?.qualifiers[0]?.value).toBe('(pos:12..14,aa:Sec)');
    expect(diffDocuments(before, after).featuresChanged.size).toBe(0);
  });

  it('leaves a feature alone when an edit inside it stretched it', () => {
    const grown = base.insert(8, 'AAA');
    expect(grown.getFeature('f1')?.segments[0]).toMatchObject({ start: 4, end: 15 });
    expect(diffDocuments(base, grown).featuresChanged.size).toBe(0);
  });

  it('leaves a feature alone when an edit trimmed it', () => {
    const trimmed = base.delete({ start: 10, end: 12 });
    expect(trimmed.getFeature('f1')?.segments[0]).toMatchObject({ start: 4, end: 10 });
    expect(diffDocuments(base, trimmed).featuresChanged.size).toBe(0);
  });

  it('leaves a feature alone when bases were inserted right at its edges', () => {
    for (const at of [4, 12]) {
      const shifted = base.insert(at, 'CC');
      expect(diffDocuments(base, shifted).featuresChanged.size).toBe(0);
    }
  });

  it('follows a feature that wraps the origin', () => {
    const wrapped = createFeature({
      id: 'w',
      type: 'CDS',
      segments: [rangeSegment(16, 24)],
    });
    const circular = SeqDocument.create({
      sequence: SEQ,
      topology: 'circular',
      features: [wrapped],
    });
    const edited = circular.insert(8, 'AA');
    expect(edited.getFeature('w')?.segments[0]).toMatchObject({ start: 18, end: 26 });
    expect(diffDocuments(circular, edited).featuresChanged.size).toBe(0);
  });

  it('follows a site segment', () => {
    const site = SeqDocument.create({
      sequence: SEQ,
      features: [createFeature({ id: 's', type: 'misc_feature', segments: [siteSegment(10)] })],
    });
    expect(diffDocuments(site, site.insert(2, 'GG')).featuresChanged.size).toBe(0);
    expect(
      diffDocuments(site, site.updateFeature('s', { segments: [siteSegment(11)] })).featuresChanged
        .size,
    ).toBe(1);
  });
});

describe('marksIn', () => {
  const marks = [
    { kind: 'inserted' as const, start: 0, end: 4 },
    { kind: 'changed' as const, start: 10, end: 12 },
    { kind: 'inserted' as const, start: 30, end: 40 },
  ];

  it('returns the marks overlapping a row', () => {
    expect(marksIn(marks, 0, 10)).toEqual([marks[0]]);
    expect(marksIn(marks, 4, 10)).toEqual([]);
    expect(marksIn(marks, 11, 35)).toEqual([marks[1], marks[2]]);
    expect(marksIn(marks, 40, 100)).toEqual([]);
    expect(marksIn([], 0, 10)).toEqual([]);
  });
});

describe('diffDocuments on a real plasmid', () => {
  const base = parseGenBank(readFixture('J01749.gb')).documents[0];
  if (base === undefined) throw new Error('fixture');

  it('keeps a nearby insertion and deletion apart', () => {
    // Two edits eleven bases apart in pBR322. A shortest edit script can
    // "explain" them in fewer steps by matching stray bases in between,
    // which used to come out as a scatter of one-base marks; the
    // neighbourhood is re-aligned so each edit is reported where it is.
    const edited = base.insert(160, 'acacact').delete({ start: 178, end: 184 });
    const diff = diffDocuments(base, edited);
    expect(spans(diff.marks)).toEqual(['inserted 160-167']);
    expect(diff.deletions).toEqual([{ position: 178, count: 6 }]);
  });

  it('reports a run of separate edits one by one', () => {
    const edited = base
      .insert(3000, 'GGGG')
      .replace({ start: 2000, end: 2010 }, 'TTTTTTTTTT')
      .delete({ start: 1000, end: 1100 });
    const diff = diffDocuments(base, edited);
    expect(spans(diff.marks)).toEqual(['changed 1900-1910', 'inserted 2900-2904']);
    expect(diff.deletions).toEqual([{ position: 1000, count: 100 }]);
  });

  describe('a molecule turned over', () => {
    // 60 bases with no stretch that reads the same on the other strand.
    const LONG = 'ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTA';

    it('marks nothing for a plain reverse complement, and says it was turned', () => {
      const before = SeqDocument.create({
        name: 'flip',
        sequence: LONG,
        features: [
          createFeature({ id: 'f', type: 'gene', name: 'g', segments: [rangeSegment(5, 20)] }),
        ],
      });
      const diff = diffDocuments(before, before.reverseComplement());
      expect(diff.reversed).toBe(true);
      expect(diff.marks).toEqual([]);
      expect(diff.deletions).toEqual([]);
      // The feature moved with the turn, which is not a change to it.
      expect(diff.featuresChanged.size).toBe(0);
      // Nothing to mark, but something to say.
      expect(isEmptyDiff(diff)).toBe(false);
    });

    it('marks only an edit made after the turn', () => {
      const before = doc(LONG);
      const after = before.reverseComplement().apply({ type: 'insert', position: 30, text: 'GGG' });
      const diff = diffDocuments(before, after);
      expect(diff.reversed).toBe(true);
      expect(diff.basesInserted).toBe(3);
      expect(diff.basesChanged + diff.basesDeleted).toBe(0);
    });

    it('marks nothing for a sticky-ended flip, though its length changes', () => {
      // EcoRI 5′ on the left and PstI 3′ on the right both leave their four
      // bases on the top strand only, so the bottom strand, which is the top
      // after the turn, is 8 shorter. The molecule is the same one.
      const before = SeqDocument.create({
        name: 'sticky',
        sequence: `AATT${LONG}TGCA`,
        ends: {
          left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
          right: { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' },
        },
      });
      const turned = before.reverseComplement();
      const diff = diffDocuments(before, turned);
      expect(diff.reversed).toBe(true);
      expect(diff.marks).toEqual([]);
      expect(turned.length).toBe(before.length - 8);
    });

    it('keeps the forward reading for an ordinary edit', () => {
      const before = doc(LONG);
      const diff = diffDocuments(
        before,
        before.apply({ type: 'delete', range: { start: 10, end: 12 } }),
      );
      expect(diff.reversed).toBe(false);
      expect(diff.basesDeleted).toBe(2);
    });
  });
});
