import { randomDna, randomInt, seededRandom } from '@/test/random';

import {
  type Feature,
  createFeature,
  isValidSegment,
  rangeSegment,
  siteSegment,
} from '../features';
import { type Range, range } from '../range';
import { InvalidSequenceError, reverseComplement } from '../sequence';
import { type EditOp, describeEditOp } from './editOp';
import { SeqDocument } from './seqDocument';

// Twenty distinct-ish bases so every position is identifiable in assertions.
const SEQ = 'ACGTTGCAAGGCTTAACCGG';

function segs(f: Feature | undefined): Range[] {
  if (f === undefined) throw new Error('feature missing');
  return f.segments.map((s) =>
    s.kind === 'range' ? range(s.start, s.end) : range(s.position, s.position),
  );
}

describe('SeqDocument.create', () => {
  it('validates the sequence alphabet', () => {
    expect(() => SeqDocument.create({ sequence: 'ACGX' })).toThrow(InvalidSequenceError);
    expect(SeqDocument.create({ sequence: 'acgtNNRY' }).sequence.toString()).toBe('acgtNNRY');
  });

  it('validates feature segments against length and topology', () => {
    const wrapped = createFeature({ type: 'CDS', segments: [rangeSegment(15, 25)] });
    expect(() => SeqDocument.create({ sequence: SEQ, features: [wrapped] })).toThrow(RangeError);
    expect(
      SeqDocument.create({ sequence: SEQ, topology: 'circular', features: [wrapped] }).features
        .size,
    ).toBe(1);
    const empty = createFeature({ type: 'CDS', segments: [rangeSegment(5, 5)] });
    expect(() => SeqDocument.create({ sequence: SEQ, features: [empty] })).toThrow(RangeError);
    expect(() => createFeature({ type: 'CDS', segments: [] })).toThrow(RangeError);
  });

  it('defaults to a linear, untitled document', () => {
    const doc = SeqDocument.create({ sequence: SEQ });
    expect(doc.name).toBe('Untitled');
    expect(doc.topology).toBe('linear');
    expect(doc.length).toBe(20);
    expect(doc.isCircular).toBe(false);
  });
});

describe('subsequence / featureSequence', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    topology: 'circular',
    features: [
      createFeature({ id: 'fwd', type: 'CDS', segments: [rangeSegment(2, 6)] }),
      createFeature({ id: 'rev', type: 'CDS', strand: 'reverse', segments: [rangeSegment(2, 6)] }),
      createFeature({ id: 'wrap', type: 'misc', segments: [rangeSegment(17, 23)] }),
      createFeature({
        id: 'join',
        type: 'mRNA',
        strand: 'reverse',
        segments: [rangeSegment(0, 3), rangeSegment(10, 12)],
      }),
    ],
  });

  it('reads ranges, following the sequence around the origin', () => {
    expect(doc.subsequence(range(2, 6))).toBe('GTTG');
    expect(doc.subsequence(range(17, 23))).toBe('CGGACG');
    expect(doc.subsequence(range(0, 20))).toBe(SEQ);
    expect(doc.subsequence(range(5, 25))).toBe(SEQ.slice(5) + SEQ.slice(0, 5));
    expect(() => doc.subsequence(range(5, 26))).toThrow(RangeError);
  });

  it('reverse-complements reverse-strand features and joins segments in order', () => {
    expect(doc.featureSequence('fwd')).toBe('GTTG');
    expect(doc.featureSequence('rev')).toBe('CAAC');
    expect(doc.featureSequence('wrap')).toBe('CGGACG');
    expect(doc.featureSequence('join')).toBe(reverseComplement('ACG' + 'GC'));
    expect(() => doc.featureSequence('missing')).toThrow(/Unknown feature/);
  });
});

describe('insert', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    features: [createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(5, 10)] })],
  });

  it('updates text and grows a feature when inserting inside it', () => {
    const next = doc.insert(7, 'NNN');
    expect(next.sequence.toString()).toBe(SEQ.slice(0, 7) + 'NNN' + SEQ.slice(7));
    expect(segs(next.getFeature('f'))).toEqual([range(5, 13)]);
    expect(next.featureSequence('f')).toBe('GC' + 'NNN' + 'AAG');
    // original untouched
    expect(doc.length).toBe(20);
    expect(segs(doc.getFeature('f'))).toEqual([range(5, 10)]);
  });

  it('pushes a feature when inserting at its start and leaves it when inserting at its end', () => {
    expect(segs(doc.insert(5, 'NN').getFeature('f'))).toEqual([range(7, 12)]);
    expect(segs(doc.insert(10, 'NN').getFeature('f'))).toEqual([range(5, 10)]);
    expect(segs(doc.insert(0, 'NN').getFeature('f'))).toEqual([range(7, 12)]);
    expect(segs(doc.insert(20, 'NN').getFeature('f'))).toEqual([range(5, 10)]);
  });

  it('rejects invalid positions and text; empty text is a no-op', () => {
    expect(() => doc.insert(21, 'A')).toThrow(RangeError);
    expect(() => doc.insert(-1, 'A')).toThrow(RangeError);
    expect(() => doc.insert(3, 'A C')).toThrow(InvalidSequenceError);
    expect(doc.insert(3, '')).toBe(doc);
  });

  it('grows an origin-spanning feature when inserting at the origin of a circular sequence', () => {
    const circ = SeqDocument.create({
      sequence: SEQ,
      topology: 'circular',
      features: [createFeature({ id: 'w', type: 'gene', segments: [rangeSegment(17, 23)] })],
    });
    const before = circ.featureSequence('w'); // CGG + ACG
    const atZero = circ.insert(0, 'NN');
    expect(segs(atZero.getFeature('w'))).toEqual([range(19, 27)]);
    expect(atZero.featureSequence('w')).toBe('CGG' + 'NN' + 'ACG');
    const atEnd = circ.insert(20, 'NN');
    expect(atEnd.sequence.toString()).toBe(atZero.sequence.toString());
    expect(atEnd.featureSequence('w')).toBe('CGG' + 'NN' + 'ACG');
    expect(before).toBe('CGGACG');
  });
});

describe('delete', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    topology: 'circular',
    features: [
      createFeature({ id: 'a', type: 'gene', segments: [rangeSegment(5, 10)] }),
      createFeature({ id: 'w', type: 'gene', segments: [rangeSegment(17, 23)] }),
      createFeature({
        id: 'j',
        type: 'mRNA',
        segments: [rangeSegment(2, 4), rangeSegment(12, 14)],
      }),
    ],
  });

  it('removes text and shifts, trims or drops features', () => {
    const next = doc.delete(range(3, 8));
    expect(next.sequence.toString()).toBe(SEQ.slice(0, 3) + SEQ.slice(8));
    expect(next.length).toBe(15);
    expect(segs(next.getFeature('a'))).toEqual([range(3, 5)]);
    expect(segs(next.getFeature('w'))).toEqual([range(12, 18)]);
    expect(segs(next.getFeature('j'))).toEqual([range(2, 3), range(7, 9)]);
  });

  it('drops a feature whose every base is deleted, and only its dead segments otherwise', () => {
    expect(doc.delete(range(4, 11)).getFeature('a')).toBeUndefined();
    expect(segs(doc.delete(range(2, 4)).getFeature('j'))).toEqual([range(10, 12)]);
    expect(doc.delete(range(2, 14)).getFeature('j')).toBeUndefined();
  });

  it('handles a deletion that wraps the origin', () => {
    const next = doc.delete(range(18, 22)); // removes bases 18,19,0,1
    expect(next.sequence.toString()).toBe(SEQ.slice(2, 18));
    expect(next.length).toBe(16);
    expect(segs(next.getFeature('w'))).toEqual([range(15, 17)]); // old 17 and old 2? no: old 17 + old 2 gone
    expect(next.featureSequence('w')).toBe('C' + 'G');
    expect(segs(next.getFeature('a'))).toEqual([range(3, 8)]);
    expect(segs(next.getFeature('j'))).toEqual([range(0, 2), range(10, 12)]);
  });

  it('can delete the whole sequence', () => {
    const empty = doc.delete(range(0, 20));
    expect(empty.length).toBe(0);
    expect(empty.features.size).toBe(0);
  });

  it('rejects invalid ranges; empty range is a no-op', () => {
    expect(() => doc.delete(range(5, 26))).toThrow(RangeError);
    expect(doc.delete(range(5, 5))).toBe(doc);
  });
});

describe('replace', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    features: [createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(2, 10)] })],
  });

  it('same-length replacement changes text without moving anything', () => {
    const next = doc.replace(range(2, 4), 'NN');
    expect(next.sequence.toString()).toBe('AC' + 'NN' + SEQ.slice(4));
    expect(segs(next.getFeature('f'))).toEqual([range(2, 10)]);
  });

  it('longer replacement keeps the feature covering the new text, even at the feature start', () => {
    const next = doc.replace(range(2, 4), 'NNNNN');
    expect(next.sequence.toString()).toBe('AC' + 'NNNNN' + SEQ.slice(4));
    expect(segs(next.getFeature('f'))).toEqual([range(2, 13)]);
    expect(next.featureSequence('f')).toBe('NNNNN' + SEQ.slice(4, 10));
  });

  it('shorter replacement shrinks the feature', () => {
    const next = doc.replace(range(4, 8), 'N');
    expect(next.sequence.toString()).toBe(SEQ.slice(0, 4) + 'N' + SEQ.slice(8));
    expect(segs(next.getFeature('f'))).toEqual([range(2, 7)]);
  });

  it('replacing with empty text is a deletion, and vice versa', () => {
    expect(doc.replace(range(4, 8), '').sequence.toString()).toBe(
      doc.delete(range(4, 8)).sequence.toString(),
    );
    expect(doc.replace(range(4, 4), 'GG').sequence.toString()).toBe(
      doc.insert(4, 'GG').sequence.toString(),
    );
  });

  it('works across the origin on circular sequences', () => {
    const circ = SeqDocument.create({
      sequence: SEQ,
      topology: 'circular',
      features: [createFeature({ id: 'w', type: 'gene', segments: [rangeSegment(17, 23)] })],
    });
    const next = circ.replace(range(18, 22), 'nnnnnn');
    // bases 18,19,0,1 are overwritten in place; the two extra bases go right after old base 1
    expect(next.sequence.toString()).toBe('nnnn' + SEQ.slice(2, 18) + 'nn');
    expect(next.length).toBe(22);
    expect(next.featureSequence('w')).toBe('C' + 'nnnnnn' + 'G');
  });
});

describe('insertFragment', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    topology: 'circular',
    features: [
      createFeature({ id: 'a', type: 'gene', segments: [rangeSegment(5, 10)] }),
      createFeature({ id: 'w', type: 'gene', segments: [rangeSegment(17, 23)] }),
    ],
  });
  const fragment = {
    sequence: 'NNNNNN',
    features: [
      createFeature({ id: 'p', type: 'CDS', segments: [rangeSegment(1, 5, { partialEnd: true })] }),
      createFeature({ id: 's', type: 'misc', segments: [siteSegment(3)] }),
    ],
  };

  it('inserts at a caret and shifts the fragment features to the paste position', () => {
    const next = doc.insertFragment(range(2, 2), fragment);
    expect(next.sequence.toString()).toBe('AC' + 'NNNNNN' + SEQ.slice(2));
    expect(next.length).toBe(26);
    expect(segs(next.getFeature('a'))).toEqual([range(11, 16)]);
    expect(segs(next.getFeature('w'))).toEqual([range(23, 35)]); // wraps past the paste, so it grows
    expect(next.getFeature('p')?.segments).toEqual([rangeSegment(3, 7, { partialEnd: true })]);
    expect(next.getFeature('s')?.segments).toEqual([siteSegment(5)]);
    expect(next.featureSequence('p')).toBe('NNNN');
  });

  it('replaces a selection, dropping annotations confined to it', () => {
    const next = doc.insertFragment(range(4, 11), fragment);
    expect(next.sequence.toString()).toBe(SEQ.slice(0, 4) + 'NNNNNN' + SEQ.slice(11));
    expect(next.getFeature('a')).toBeUndefined();
    expect(segs(next.getFeature('p'))).toEqual([range(5, 9)]);
    expect(segs(next.getFeature('w'))).toEqual([range(16, 22)]);
  });

  it('pastes at the origin and over a selection that wraps it', () => {
    const atOrigin = doc.insertFragment(range(0, 0), fragment);
    expect(atOrigin.sequence.toString()).toBe('NNNNNN' + SEQ);
    expect(segs(atOrigin.getFeature('p'))).toEqual([range(1, 5)]);
    // Deleting 18,19,0,1 leaves old base 2 as base 0 and the cut at the origin,
    // so the paste goes in at the origin; the wrapped feature grows around it.
    const wrapped = doc.insertFragment(range(18, 22), fragment);
    expect(wrapped.sequence.toString()).toBe('NNNNNN' + SEQ.slice(2, 18));
    expect(segs(wrapped.getFeature('p'))).toEqual([range(1, 5)]);
    expect(segs(wrapped.getFeature('w'))).toEqual([range(21, 29)]);
    expect(wrapped.featureSequence('w')).toBe('C' + 'NNNNNN' + 'G');
  });

  it('grows a feature the paste lands inside and pushes one starting there', () => {
    const inside = doc.insertFragment(range(7, 7), fragment);
    expect(segs(inside.getFeature('a'))).toEqual([range(5, 16)]);
    const atStart = doc.insertFragment(range(5, 5), fragment);
    expect(segs(atStart.getFeature('a'))).toEqual([range(11, 16)]);
  });

  it('is one op for undo and appears in the linear case too', () => {
    const linear = SeqDocument.create({ sequence: 'ACGT' });
    const next = linear.apply({ type: 'insertFragment', range: range(4, 4), fragment });
    expect(next.sequence.toString()).toBe('ACGTNNNNNN');
    expect(next.features.size).toBe(2);
    expect(linear.features.size).toBe(0);
    expect(describeEditOp({ type: 'insertFragment', range: range(0, 0), fragment })).toBe(
      'Paste 6 bases',
    );
  });

  it('with an empty sequence just deletes; rejects bad bases and clashing ids', () => {
    const empty = { sequence: '', features: [] };
    expect(doc.insertFragment(range(0, 0), empty)).toBe(doc);
    expect(doc.insertFragment(range(2, 4), empty).length).toBe(18);
    expect(() => doc.insertFragment(range(0, 0), { sequence: 'XYZ', features: [] })).toThrow(
      InvalidSequenceError,
    );
    expect(() =>
      doc.insertFragment(range(0, 0), {
        sequence: 'AA',
        features: [createFeature({ id: 'a', type: 'gene', segments: [rangeSegment(0, 2)] })],
      }),
    ).toThrow(/Duplicate feature id/);
  });

  it('maps cursor positions through a paste', () => {
    const op: EditOp = { type: 'insertFragment', range: range(4, 8), fragment };
    expect(doc.mapPositionThrough(op, 2)).toBe(2);
    expect(doc.mapPositionThrough(op, 6)).toBe(10); // collapsed onto the cut, then pushed past the paste
    expect(doc.mapPositionThrough(op, 12)).toBe(14);
  });
});

describe('reverseComplement', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    topology: 'circular',
    features: [
      createFeature({ id: 'fwd', type: 'CDS', segments: [rangeSegment(2, 6)] }),
      createFeature({ id: 'rev', type: 'CDS', strand: 'reverse', segments: [rangeSegment(8, 15)] }),
      createFeature({ id: 'wrap', type: 'misc', segments: [rangeSegment(17, 23)] }),
      createFeature({
        id: 'join',
        type: 'mRNA',
        strand: 'reverse',
        segments: [
          rangeSegment(0, 3, { partialStart: true }),
          rangeSegment(10, 12, { partialEnd: true }),
        ],
      }),
      createFeature({ id: 'site', type: 'misc', segments: [siteSegment(5)] }),
    ],
  });
  const rc = doc.reverseComplement();

  it('reverse-complements the text', () => {
    expect(rc.sequence.toString()).toBe(reverseComplement(SEQ));
    expect(rc.reverseComplement().sequence.toString()).toBe(SEQ);
  });

  it('preserves every feature sequence and flips strands', () => {
    for (const f of doc.features) {
      const flipped = rc.requireFeature(f.id);
      expect(rc.featureSequence(flipped)).toBe(doc.featureSequence(f));
      expect(flipped.strand).not.toBe(f.strand);
    }
  });

  it('maps coordinates, reverses segment order and swaps partial markers', () => {
    expect(segs(rc.getFeature('fwd'))).toEqual([range(14, 18)]);
    expect(segs(rc.getFeature('wrap'))).toEqual([range(17, 23)]);
    const join = rc.requireFeature('join');
    expect(segs(join)).toEqual([range(8, 10), range(17, 20)]);
    expect(join.segments.map((s) => s.kind === 'range' && s.partialStart)).toEqual([true, false]);
    expect(join.segments.map((s) => s.kind === 'range' && s.partialEnd)).toEqual([false, true]);
    expect(segs(rc.getFeature('site'))).toEqual([range(15, 15)]);
  });

  it('is an involution on the whole document', () => {
    const back = rc.reverseComplement();
    for (const f of doc.features) {
      expect(back.requireFeature(f.id)).toEqual(f);
    }
  });
});

describe('setOrigin', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    topology: 'circular',
    features: [
      createFeature({ id: 'fwd', type: 'CDS', segments: [rangeSegment(2, 6)] }),
      createFeature({ id: 'rev', type: 'CDS', strand: 'reverse', segments: [rangeSegment(8, 15)] }),
      createFeature({ id: 'wrap', type: 'misc', segments: [rangeSegment(17, 23)] }),
      createFeature({ id: 'full', type: 'source', segments: [rangeSegment(0, 20)] }),
      createFeature({ id: 'site', type: 'misc', segments: [siteSegment(0)] }),
    ],
  });

  it('rotates the text', () => {
    const next = doc.setOrigin(5);
    expect(next.sequence.toString()).toBe(SEQ.slice(5) + SEQ.slice(0, 5));
    expect(doc.setOrigin(0)).toBe(doc);
    expect(doc.setOrigin(20)).toBe(doc);
  });

  it('preserves every feature sequence for every possible origin', () => {
    for (let o = 0; o < 20; o++) {
      const next = doc.setOrigin(o);
      for (const f of doc.features) {
        expect(next.featureSequence(f.id)).toBe(doc.featureSequence(f));
        expect(next.requireFeature(f.id).strand).toBe(f.strand);
      }
    }
  });

  it('wraps and unwraps features as they cross the new origin', () => {
    expect(segs(doc.setOrigin(17).getFeature('wrap'))).toEqual([range(0, 6)]);
    expect(segs(doc.setOrigin(4).getFeature('fwd'))).toEqual([range(18, 22)]);
    expect(segs(doc.setOrigin(4).getFeature('full'))).toEqual([range(16, 36)]);
    expect(segs(doc.setOrigin(4).getFeature('site'))).toEqual([range(16, 16)]);
  });

  it('is only defined for circular sequences', () => {
    expect(() => SeqDocument.create({ sequence: SEQ }).setOrigin(3)).toThrow(/circular/);
    expect(() => doc.setOrigin(21)).toThrow(RangeError);
  });
});

describe('setTopology', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    topology: 'circular',
    features: [
      createFeature({
        id: 'wrap',
        type: 'misc',
        segments: [rangeSegment(17, 23, { partialStart: true })],
      }),
      createFeature({ id: 'plain', type: 'gene', segments: [rangeSegment(2, 6)] }),
    ],
  });

  it('splits origin-spanning features into a join when made linear', () => {
    const linear = doc.setTopology('linear');
    expect(linear.topology).toBe('linear');
    const wrap = linear.requireFeature('wrap');
    expect(segs(wrap)).toEqual([range(17, 20), range(0, 3)]);
    expect(wrap.segments.map((s) => s.kind === 'range' && s.partialStart)).toEqual([true, false]);
    expect(linear.featureSequence('wrap')).toBe(doc.featureSequence('wrap'));
    expect(linear.requireFeature('plain')).toBe(doc.requireFeature('plain'));
    expect(doc.setTopology('circular')).toBe(doc);
  });

  it('making a sequence circular keeps features as they are', () => {
    const circ = SeqDocument.create({ sequence: SEQ }).setTopology('circular');
    expect(circ.topology).toBe('circular');
    expect(circ.setTopology('circular')).toBe(circ);
  });
});

describe('feature CRUD', () => {
  const doc = SeqDocument.create({ sequence: SEQ });
  const f = createFeature({ id: 'f', type: 'gene', name: 'lacZ', segments: [rangeSegment(2, 6)] });

  it('adds, updates and removes features with validation', () => {
    const withF = doc.addFeature(f);
    expect(withF.features.size).toBe(1);
    expect(doc.features.size).toBe(0);
    expect(() => withF.addFeature(f)).toThrow(/Duplicate/);
    expect(() =>
      doc.addFeature(createFeature({ type: 'x', segments: [rangeSegment(15, 25)] })),
    ).toThrow(RangeError);

    const renamed = withF.updateFeature('f', { name: 'lacY', strand: 'reverse' });
    expect(renamed.requireFeature('f')).toMatchObject({ id: 'f', name: 'lacY', strand: 'reverse' });
    expect(() => withF.updateFeature('f', { segments: [rangeSegment(0, 30)] })).toThrow(RangeError);
    expect(() => withF.updateFeature('nope', { name: 'x' })).toThrow(/Unknown feature/);

    expect(withF.removeFeature('f').features.size).toBe(0);
    expect(withF.removeFeature('nope')).toBe(withF);
    expect(doc.rename('pUC19').name).toBe('pUC19');
    expect(doc.rename('Untitled')).toBe(doc);
  });

  it('carries metadata', () => {
    expect(doc.metadata.description).toBe('');
    const next = doc.setMetadata({ description: 'Cloning vector', accession: 'L09137' });
    expect(next.metadata).toMatchObject({ description: 'Cloning vector', accession: 'L09137' });
    expect(next.setMetadata({ accession: 'X' }).metadata.description).toBe('Cloning vector');
    expect(doc.apply({ type: 'setMetadata', patch: { keywords: 'k' } }).metadata.keywords).toBe(
      'k',
    );
    expect(
      SeqDocument.create({ sequence: SEQ, metadata: { organism: 'E. coli' } }).metadata.organism,
    ).toBe('E. coli');
  });
});

describe('site segments', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    topology: 'circular',
    features: [createFeature({ id: 's', type: 'misc_feature', segments: [siteSegment(10)] })],
  });

  it('shift on insert and delete but are never removed', () => {
    expect(segs(doc.insert(3, 'NN').getFeature('s'))).toEqual([range(12, 12)]);
    expect(segs(doc.insert(10, 'NN').getFeature('s'))).toEqual([range(12, 12)]);
    expect(segs(doc.insert(11, 'NN').getFeature('s'))).toEqual([range(10, 10)]);
    expect(segs(doc.delete(range(2, 5)).getFeature('s'))).toEqual([range(7, 7)]);
    expect(segs(doc.delete(range(8, 14)).getFeature('s'))).toEqual([range(8, 8)]);
    expect(segs(doc.delete(range(0, 20)).getFeature('s'))).toEqual([range(0, 0)]);
  });

  it('rejects a site at position length on a circular sequence but not on a linear one', () => {
    expect(isValidSegment(siteSegment(20), 20, 'circular')).toBe(false);
    expect(isValidSegment(siteSegment(20), 20, 'linear')).toBe(true);
    expect(isValidSegment(siteSegment(0), 20, 'circular')).toBe(true);
  });
});

describe('apply / EditOp', () => {
  const doc = SeqDocument.create({
    sequence: SEQ,
    topology: 'circular',
    features: [createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(5, 10)] })],
  });

  it('applies every op kind equivalently to the direct method', () => {
    const feature = createFeature({ id: 'g', type: 'gene', segments: [rangeSegment(1, 3)] });
    const cases: [EditOp, SeqDocument][] = [
      [{ type: 'insert', position: 6, text: 'NN' }, doc.insert(6, 'NN')],
      [{ type: 'delete', range: range(6, 8) }, doc.delete(range(6, 8))],
      [{ type: 'replace', range: range(6, 8), text: 'N' }, doc.replace(range(6, 8), 'N')],
      [{ type: 'reverseComplement' }, doc.reverseComplement()],
      [{ type: 'setOrigin', position: 4 }, doc.setOrigin(4)],
      [{ type: 'setTopology', topology: 'linear' }, doc.setTopology('linear')],
      [{ type: 'rename', name: 'x' }, doc.rename('x')],
      [{ type: 'setMetadata', patch: { description: 'd' } }, doc.setMetadata({ description: 'd' })],
      [{ type: 'addFeature', feature }, doc.addFeature(feature)],
      [
        { type: 'updateFeature', id: 'f', patch: { name: 'n' } },
        doc.updateFeature('f', { name: 'n' }),
      ],
      [{ type: 'removeFeature', id: 'f' }, doc.removeFeature('f')],
    ];
    for (const [op, expected] of cases) {
      const actual = doc.apply(op);
      expect(actual.sequence.toString()).toBe(expected.sequence.toString());
      expect(actual.topology).toBe(expected.topology);
      expect(actual.name).toBe(expected.name);
      expect(actual.features.all()).toEqual(expected.features.all());
      expect(describeEditOp(op)).toEqual(expect.any(String));
    }
  });

  it('maps cursor positions through insert and delete', () => {
    expect(doc.mapPositionThrough({ type: 'insert', position: 5, text: 'NN' }, 5)).toBe(7);
    expect(doc.mapPositionThrough({ type: 'insert', position: 5, text: 'NN' }, 4)).toBe(4);
    expect(doc.mapPositionThrough({ type: 'delete', range: range(2, 6) }, 10)).toBe(6);
    expect(doc.mapPositionThrough({ type: 'delete', range: range(2, 6) }, 4)).toBe(2);
    expect(doc.mapPositionThrough({ type: 'rename', name: 'x' }, 4)).toBe(4);
  });
});

describe('randomized invariants', () => {
  it('keeps every feature valid and consistent through random edits', () => {
    const rand = seededRandom(2024);
    for (let round = 0; round < 15; round++) {
      const L = randomInt(rand, 5, 60);
      const topology = rand() < 0.7 ? 'circular' : 'linear';
      const features: Feature[] = [];
      for (let i = 0; i < 8; i++) {
        const start = randomInt(rand, 0, L);
        const maxLen = topology === 'circular' ? L : L - start;
        const len = randomInt(rand, 1, maxLen + 1);
        features.push(
          createFeature({
            id: `f${i}`,
            type: 'misc',
            strand: rand() < 0.5 ? 'forward' : 'reverse',
            segments: [rangeSegment(start, start + len)],
          }),
        );
      }
      let doc = SeqDocument.create({ sequence: randomDna(rand, L), topology, features });

      for (let step = 0; step < 40; step++) {
        const before = doc;
        const roll = rand();
        if (roll < 0.3) {
          const n = randomInt(rand, 1, 6);
          const p = randomInt(rand, 0, doc.length + 1);
          doc = doc.insert(p, randomDna(rand, n));
          expect(doc.length).toBe(before.length + n);
          for (const f of before.features) {
            const after = doc.requireFeature(f.id);
            const grew = featureLen(after) - featureLen(f);
            expect([0, n]).toContain(grew);
            // the old feature text is still there, possibly with an insertion in it
            if (grew === 0) expect(doc.featureSequence(after)).toBe(before.featureSequence(f));
          }
        } else if (roll < 0.55 && doc.length > 0) {
          const start = randomInt(rand, 0, doc.length);
          const maxLen = doc.topology === 'circular' ? doc.length : doc.length - start;
          const len = randomInt(rand, 1, Math.min(maxLen, 6) + 1);
          doc = doc.delete(range(start, start + len));
          expect(doc.length).toBe(before.length - len);
          for (const f of before.features) {
            const after = doc.getFeature(f.id);
            const lost = featureLen(f) - (after === undefined ? 0 : featureLen(after));
            expect(lost).toBeGreaterThanOrEqual(0);
            expect(lost).toBeLessThanOrEqual(len);
            if (after !== undefined && lost === 0) {
              expect(doc.featureSequence(after)).toBe(before.featureSequence(f));
            }
          }
        } else if (roll < 0.75 && doc.topology === 'circular' && doc.length > 0) {
          doc = doc.setOrigin(randomInt(rand, 0, doc.length));
          for (const f of before.features) {
            expect(doc.featureSequence(f.id)).toBe(before.featureSequence(f));
          }
        } else if (roll < 0.9) {
          doc = doc.reverseComplement();
          for (const f of before.features) {
            expect(doc.featureSequence(f.id)).toBe(before.featureSequence(f));
          }
        } else if (doc.length > 0) {
          const start = randomInt(rand, 0, doc.length);
          const maxLen = doc.topology === 'circular' ? doc.length : doc.length - start;
          const len = randomInt(rand, 0, Math.min(maxLen, 5) + 1);
          doc = doc.replace(range(start, start + len), randomDna(rand, randomInt(rand, 0, 6)));
        }
        for (const f of doc.features) {
          for (const seg of f.segments)
            expect(isValidSegment(seg, doc.length, doc.topology)).toBe(true);
        }
      }
    }
  });
});

function featureLen(f: Feature): number {
  let n = 0;
  for (const s of f.segments) if (s.kind === 'range') n += s.end - s.start;
  return n;
}
