import { translateCds } from '../analysis/cdsTranslation';
import { type Feature, createFeature, rangeSegment } from '../features';
import { History } from '../history';
import { reverseComplement } from '../sequence';
import { SeqDocument } from './seqDocument';

// #160: a delete that takes bases off the front of a CDS's reading moves its
// /codon_start so the first whole codon left is still read.

const ORF = 'ATGAAAGGGCCCTGA'; // M K G P *

function cds(init: Partial<Feature> & { segments: Feature['segments'] }): Feature {
  return createFeature({ id: 'c', type: 'CDS', name: 'orf', ...init });
}

function frame(doc: SeqDocument): string | undefined {
  return (
    doc.features.get('c')?.qualifiers.find((q) => q.name === 'codon_start')?.value ?? undefined
  );
}

function protein(doc: SeqDocument): string {
  const f = doc.features.get('c');
  if (f === undefined) throw new Error('feature missing');
  return translateCds(doc, f).protein;
}

describe('delete moves codon_start of a CDS cut at the start of its reading', () => {
  it('forward: cutting one base off the left end skips to the next codon', () => {
    const doc = SeqDocument.create({
      sequence: `CC${ORF}TT`,
      features: [cds({ segments: [rangeSegment(2, 17)] })],
    });
    const out = doc.delete({ start: 1, end: 3 }); // the C before and the A
    expect(frame(out)).toBe('3');
    expect(protein(out)).toBe('KGP*');
  });

  it('forward: cutting two bases gives codon_start 2, three or more wraps back to 1', () => {
    const mk = (n: number): SeqDocument =>
      SeqDocument.create({
        sequence: ORF,
        features: [cds({ segments: [rangeSegment(0, 15)] })],
      }).delete({ start: 0, end: n });
    expect(frame(mk(1))).toBe('3');
    expect(frame(mk(2))).toBe('2');
    expect(frame(mk(3))).toBeUndefined();
    expect(frame(mk(4))).toBe('3');
    expect(protein(mk(4))).toBe('GP*');
  });

  it('builds on an existing codon_start, and never goes outside 1..3', () => {
    const base = SeqDocument.create({
      sequence: `T${ORF}`,
      features: [
        cds({ segments: [rangeSegment(0, 16)], qualifiers: [{ name: 'codon_start', value: '2' }] }),
      ],
    });
    // Frame 2 skips the T; deleting it leaves the reading at frame 1, written as nothing.
    expect(frame(base.delete({ start: 0, end: 1 }))).toBeUndefined();
    expect(protein(base.delete({ start: 0, end: 1 }))).toBe('MKGP*');
    // Deleting four: frame 2 skip 1, lost 4, so 3 - (3 % 3) = 3 remaining 0 -> frame 1.
    expect(frame(base.delete({ start: 0, end: 5 }))).toBe('3');
    for (let n = 1; n <= 12; n++) {
      const v = frame(base.delete({ start: 0, end: n }));
      expect([undefined, '2', '3']).toContain(v);
    }
  });

  it('leaves the frame alone for a cut in the middle, at the far end, or elsewhere', () => {
    const doc = SeqDocument.create({
      sequence: `CC${ORF}TT`,
      features: [cds({ segments: [rangeSegment(2, 17)] })],
    });
    expect(frame(doc.delete({ start: 5, end: 8 }))).toBeUndefined();
    expect(frame(doc.delete({ start: 14, end: 17 }))).toBeUndefined();
    expect(frame(doc.delete({ start: 0, end: 2 }))).toBeUndefined();
    expect(frame(doc.delete({ start: 17, end: 19 }))).toBeUndefined();
    // A cut that starts inside the first segment does not take its start.
    expect(frame(doc.delete({ start: 3, end: 5 }))).toBeUndefined();
  });

  it('only touches CDS features', () => {
    const doc = SeqDocument.create({
      sequence: ORF,
      features: [createFeature({ id: 'c', type: 'gene', segments: [rangeSegment(0, 15)] })],
    });
    expect(frame(doc.delete({ start: 0, end: 1 }))).toBeUndefined();
  });

  it('reverse: the reading starts at the right end, so that is the cut that counts', () => {
    const doc = SeqDocument.create({
      sequence: `CC${reverseComplement(ORF)}TT`,
      features: [cds({ strand: 'reverse', segments: [rangeSegment(2, 17)] })],
    });
    expect(protein(doc)).toBe('MKGP*');
    const right = doc.delete({ start: 16, end: 18 }); // last base of the CDS and one T
    expect(frame(right)).toBe('3');
    expect(protein(right)).toBe('KGP*');
    // The left end is the end of the reading: no change.
    expect(frame(doc.delete({ start: 1, end: 3 }))).toBeUndefined();
  });

  it('multi-segment: a fully deleted leading segment counts toward the skip', () => {
    // 4 + 11 bases: ATGA | AAGGGCCCTGA
    const doc = SeqDocument.create({
      sequence: `${ORF.slice(0, 4)}TTTT${ORF.slice(4)}`,
      features: [cds({ segments: [rangeSegment(0, 4), rangeSegment(8, 19)] })],
    });
    expect(protein(doc)).toBe('MKGP*');
    const out = doc.delete({ start: 0, end: 5 }); // all of segment one and a spacer base
    // 4 bases lost: 4 % 3 = 1 -> frame 3.
    expect(frame(out)).toBe('3');
    expect(protein(out)).toBe('GP*');
    // Clipping only part of the first segment stops there.
    const part = doc.delete({ start: 0, end: 2 });
    expect(frame(part)).toBe('2');
    expect(protein(part)).toBe('KGP*');
  });

  it('multi-segment reverse: counts from the last segment', () => {
    const fwd = `${ORF.slice(0, 4)}TTTT${ORF.slice(4)}`;
    // Reverse complement of the whole molecule: segments swap sides.
    const rc = reverseComplement(fwd);
    const doc = SeqDocument.create({
      sequence: rc,
      features: [cds({ strand: 'reverse', segments: [rangeSegment(0, 11), rangeSegment(15, 19)] })],
    });
    expect(protein(doc)).toBe('MKGP*');
    const out = doc.delete({ start: 14, end: 19 });
    expect(frame(out)).toBe('3');
    expect(protein(out)).toBe('GP*');
  });
});

describe('circular CDS across the origin', () => {
  // 30 bp circle. The CDS starts at 26 and runs through the origin to 11.
  const tail = ORF.slice(0, 4); // at 26..29
  const head = ORF.slice(4); // at 0..10
  const sequence = head + 'T'.repeat(15) + tail;
  const doc = SeqDocument.create({
    sequence,
    topology: 'circular',
    features: [cds({ segments: [rangeSegment(26, 41)] })],
  });

  it('reads as the ORF to begin with', () => {
    expect(sequence.length).toBe(30);
    expect(protein(doc)).toBe('MKGP*');
  });

  it('a delete across the origin that takes the start of the reading', () => {
    const out = doc.delete({ start: 25, end: 28 }); // bases 25, 26, 27
    expect(frame(out)).toBe('2'); // two of them were the start of the CDS
  });

  it('a delete across the origin in the middle of the reading leaves the frame', () => {
    expect(frame(doc.delete({ start: 28, end: 31 }))).toBeUndefined();
  });

  it('a delete before the origin that covers the start from the left side', () => {
    const out = doc.delete({ start: 25, end: 27 }); // one base before, one at the start
    expect(frame(out)).toBe('3');
  });

  it('a wrapped delete that swallows the whole front segment of a wrapped feature', () => {
    // The feature as two segments: 26..30 and 0..11.
    const two = SeqDocument.create({
      sequence,
      topology: 'circular',
      features: [cds({ segments: [rangeSegment(26, 30), rangeSegment(0, 11)] })],
    });
    expect(protein(two)).toBe('MKGP*');
    const out = two.delete({ start: 26, end: 31 }); // segment one and base 0
    expect(frame(out)).toBe('2'); // 5 lost: 5 % 3 = 2 -> remaining 1 -> frame 2
    expect(protein(out)).toBe('GP*');
  });
});

describe('every path that deletes', () => {
  const doc = SeqDocument.create({
    sequence: `CC${ORF}TT`,
    features: [cds({ segments: [rangeSegment(2, 17)] })],
  });

  it('replace with nothing and replace with shorter text', () => {
    expect(frame(doc.replace({ start: 0, end: 3 }, ''))).toBe('3');
    // The replacement fills the first two bases; the third, the CDS's first, goes.
    expect(frame(doc.replace({ start: 0, end: 3 }, 'GG'))).toBe('3');
    // Same length replaces in place and leaves the frame.
    expect(frame(doc.replace({ start: 0, end: 3 }, 'GGG'))).toBeUndefined();
    expect(frame(doc.apply({ type: 'delete', range: { start: 0, end: 3 } }))).toBe('3');
  });

  it('paste over the front of a CDS', () => {
    const fragment = { sequence: 'AA', features: [] };
    const out = doc.insertFragment({ start: 0, end: 3 }, fragment);
    expect(frame(out)).toBe('3');
  });
});

describe('undo and redo', () => {
  it('restore codon_start with the document', () => {
    const doc = SeqDocument.create({
      sequence: ORF,
      features: [cds({ segments: [rangeSegment(0, 15)] })],
    });
    const h = History.create(doc).push(doc.delete({ start: 0, end: 1 }), 'Delete');
    expect(frame(h.present)).toBe('3');
    const undone = h.undo();
    expect(frame(undone.present)).toBeUndefined();
    expect(protein(undone.present)).toBe('MKGP*');
    expect(frame(undone.redo().present)).toBe('3');
  });
});

// #163: what is left of a CDS whose start was cut has no start codon of its
// own, so it is marked 5'-partial and its first codon is not read as M.
describe('delete marks a CDS cut at the start of its reading 5-prime partial', () => {
  const LEAD = 'CCCCCCCCCC';
  const body = 'ATGTTGAAACCCTAA'; // M L K P *
  const partial = (doc: SeqDocument): { start: boolean[]; end: boolean[] } => {
    const segs = (doc.features.get('c')?.segments ?? []).flatMap((s) =>
      s.kind === 'range' ? [s] : [],
    );
    return { start: segs.map((s) => s.partialStart), end: segs.map((s) => s.partialEnd) };
  };

  it('forward: deleting the whole start codon reads LKP*', () => {
    const doc = SeqDocument.create({
      sequence: LEAD + body + LEAD,
      features: [cds({ segments: [rangeSegment(10, 25)] })],
    });
    const d = doc.delete({ start: 10, end: 13 });
    expect(partial(d)).toEqual({ start: [true], end: [false] });
    expect(protein(d)).toBe('LKP*');
  });

  it('forward: deleting part of the start codon also marks it', () => {
    const doc = SeqDocument.create({
      sequence: LEAD + body + LEAD,
      features: [cds({ segments: [rangeSegment(10, 25)] })],
    });
    const d = doc.delete({ start: 10, end: 11 });
    expect(partial(d).start).toEqual([true]);
    expect(protein(d)).toBe('LKP*');
  });

  it('forward: a replace that removes the start codon marks it', () => {
    const doc = SeqDocument.create({
      sequence: LEAD + body + LEAD,
      features: [cds({ segments: [rangeSegment(10, 25)] })],
    });
    const d = doc.replace({ start: 10, end: 13 }, '');
    expect(protein(d)).toBe('LKP*');
  });

  it('forward: deleting elsewhere leaves it complete', () => {
    const doc = SeqDocument.create({
      sequence: LEAD + body + LEAD,
      features: [cds({ segments: [rangeSegment(10, 25)] })],
    });
    expect(partial(doc.delete({ start: 13, end: 16 })).start).toEqual([false]);
    expect(partial(doc.delete({ start: 0, end: 5 })).start).toEqual([false]);
  });

  it('reverse: marks the high end partial', () => {
    const doc = SeqDocument.create({
      sequence: LEAD + reverseComplement(body) + LEAD,
      features: [cds({ strand: 'reverse', segments: [rangeSegment(10, 25)] })],
    });
    const d = doc.delete({ start: 22, end: 25 });
    expect(partial(d)).toEqual({ start: [false], end: [true] });
    expect(protein(d)).toBe('LKP*');
  });

  it('multi-segment: a join whose first segment goes whole marks the next one', () => {
    // exons ATGTTG | AAACCCTAA joined, the first exon deleted entirely
    const doc = SeqDocument.create({
      sequence: 'ATGTTG' + 'GGG' + 'AAACCCTAA',
      features: [cds({ segments: [rangeSegment(0, 6), rangeSegment(9, 18)] })],
    });
    const d = doc.delete({ start: 0, end: 9 });
    expect(partial(d)).toEqual({ start: [true], end: [false] });
    expect(protein(d)).toBe('KP*');
  });

  it('circular: a delete across the origin that takes the start marks it', () => {
    const doc = SeqDocument.create({
      sequence: body.slice(3) + LEAD + body.slice(0, 3),
      topology: 'circular',
      features: [cds({ segments: [rangeSegment(12 + 10, 12 + 10 + 3), rangeSegment(0, 12)] })],
    });
    const d = doc.delete({ start: 22, end: 25 });
    expect(partial(d).start[0]).toBe(true);
  });

  it('undo and redo carry the mark', () => {
    const doc = SeqDocument.create({
      sequence: LEAD + body + LEAD,
      features: [cds({ segments: [rangeSegment(10, 25)] })],
    });
    const h = History.create(doc).push(doc.delete({ start: 10, end: 13 }), 'Delete');
    const undone = h.undo();
    expect(partial(undone.present).start).toEqual([false]);
    expect(protein(undone.present)).toBe('MLKP*');
    expect(partial(undone.redo().present).start).toEqual([true]);
  });
});
