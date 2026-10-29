import { SeqDocument } from '../document';
import { type Feature, createFeature, rangeSegment } from '../features';
import { reverseComplement } from '../sequence';
import { translateCds } from './cdsTranslation';
import { codonNoteAt, codonPieces, codonRuns, isSplitCodon } from './splitCodons';

function cds(init: Partial<Feature> & { segments: Feature['segments'] }): Feature {
  return createFeature({ type: 'CDS', name: 'x', ...init });
}

describe('codonPieces', () => {
  it('keeps neighbouring bases together and breaks at a gap', () => {
    expect(codonPieces([4, 5, 6], 'forward', 100, false)).toEqual([[4, 5, 6]]);
    expect(codonPieces([6, 12, 13], 'forward', 100, false)).toEqual([[6], [12, 13]]);
    expect(codonPieces([6, 7, 12], 'forward', 100, false)).toEqual([[6, 7], [12]]);
    expect(codonPieces([1, 5, 9], 'forward', 100, false)).toEqual([[1], [5], [9]]);
  });

  it('reads a reverse-strand codon downwards', () => {
    expect(codonPieces([12, 11, 10], 'reverse', 100, false)).toEqual([[12, 11, 10]]);
    expect(codonPieces([12, 5, 4], 'reverse', 100, false)).toEqual([[12], [5, 4]]);
    // Ascending bases are not neighbours when read downwards.
    expect(codonPieces([4, 5, 6], 'reverse', 100, false)).toEqual([[4], [5], [6]]);
  });

  it('joins the last base to the first only on a circular sequence', () => {
    expect(codonPieces([19, 0, 1], 'forward', 20, true)).toEqual([[19, 0, 1]]);
    expect(codonPieces([19, 0, 1], 'forward', 20, false)).toEqual([[19], [0, 1]]);
    expect(codonPieces([1, 0, 19], 'reverse', 20, true)).toEqual([[1, 0, 19]]);
    expect(codonPieces([18, 19, 5], 'forward', 20, true)).toEqual([[18, 19], [5]]);
  });

  it('tells a split codon from a whole one', () => {
    const codon = { index: 0, positions: [6, 12, 13] as const, aminoAcid: 'V' };
    expect(isSplitCodon(codon, 'forward', 100, false)).toBe(true);
    expect(isSplitCodon({ ...codon, positions: [6, 7, 8] }, 'forward', 100, false)).toBe(false);
  });
});

describe('codonRuns', () => {
  const whole = (positions: number[], start = 0, end = 100) =>
    codonRuns(positions, 'forward', start, end);

  it('gives one closed stretch for a codon drawn whole', () => {
    expect(whole([4, 5, 6])).toEqual([
      { start: 4, end: 7, holdsMiddle: true, openLeft: false, openRight: false },
    ]);
  });

  it('opens the leading stub of a split codon to the right and its continuation to the left', () => {
    // G at 6, then TG at 12-13: the middle base is the T.
    expect(whole([6, 12, 13])).toEqual([
      { start: 6, end: 7, holdsMiddle: false, openLeft: false, openRight: true },
      { start: 12, end: 14, holdsMiddle: true, openLeft: true, openRight: false },
    ]);
  });

  it('mirrors both on the reverse strand', () => {
    expect(codonRuns([12, 5, 4], 'reverse', 0, 100)).toEqual([
      { start: 4, end: 6, holdsMiddle: true, openLeft: false, openRight: true },
      { start: 12, end: 13, holdsMiddle: false, openLeft: true, openRight: false },
    ]);
  });

  it('opens both sides of a middle piece of three, and a stub of two bases the same way', () => {
    expect(whole([1, 5, 9])).toEqual([
      { start: 1, end: 2, holdsMiddle: false, openLeft: false, openRight: true },
      { start: 5, end: 6, holdsMiddle: true, openLeft: true, openRight: true },
      { start: 9, end: 10, holdsMiddle: false, openLeft: true, openRight: false },
    ]);
    expect(whole([6, 7, 12])).toEqual([
      { start: 6, end: 8, holdsMiddle: true, openLeft: false, openRight: true },
      { start: 12, end: 13, holdsMiddle: false, openLeft: true, openRight: false },
    ]);
  });

  it('opens a codon cut by the edge of a row on that edge, the stub without the middle base', () => {
    // Row [0, 10): the codon at 9, 10, 11 has one base here, two in the next row.
    expect(codonRuns([9, 10, 11], 'forward', 0, 10)).toEqual([
      { start: 9, end: 10, holdsMiddle: false, openLeft: false, openRight: true },
    ]);
    expect(codonRuns([9, 10, 11], 'forward', 10, 20)).toEqual([
      { start: 10, end: 12, holdsMiddle: true, openLeft: true, openRight: false },
    ]);
    // Two bases in the first row, one in the next.
    expect(codonRuns([8, 9, 10], 'forward', 0, 10)).toEqual([
      { start: 8, end: 10, holdsMiddle: true, openLeft: false, openRight: true },
    ]);
    expect(codonRuns([8, 9, 10], 'forward', 10, 20)[0]).toMatchObject({
      holdsMiddle: false,
      openLeft: true,
      openRight: false,
    });
  });

  it('opens a codon across the origin where the row ends, and gives nothing outside the row', () => {
    // Length 20: bases 19, 0, 1; the last row holds one, the first row two.
    expect(codonRuns([19, 0, 1], 'forward', 10, 20)).toEqual([
      { start: 19, end: 20, holdsMiddle: false, openLeft: false, openRight: true },
    ]);
    expect(codonRuns([19, 0, 1], 'forward', 0, 10)).toEqual([
      { start: 0, end: 2, holdsMiddle: true, openLeft: true, openRight: false },
    ]);
    expect(codonRuns([19, 0, 1], 'forward', 5, 10)).toEqual([]);
  });
});

describe('codonNoteAt', () => {
  // ATGAAAG | CCCCCC | TGAAAC : join(1..7,14..19) reads ATG AAA GTG AAA C
  const exon1 = 'ATGAAAG';
  const intron = 'CCCCCC';
  const exon2 = 'TGAAAC';
  const forward = SeqDocument.create({ sequence: exon1 + intron + exon2, topology: 'linear' });
  const joined = cds({ segments: [rangeSegment(0, 7), rangeSegment(13, 19)] });

  it('says what a split codon is made of, over either piece', () => {
    const t = translateCds(forward, joined);
    const note = 'Codon 3: G (7) + TG (14-15) = GTG, Val. The codon continues in the next exon.';
    expect(codonNoteAt(forward, t, 6)).toBe(note);
    expect(codonNoteAt(forward, t, 13)).toBe(note);
    expect(codonNoteAt(forward, t, 14)).toBe(note);
  });

  it('says nothing over an ordinary codon, an intron, or a base outside the CDS', () => {
    const t = translateCds(forward, joined);
    expect(codonNoteAt(forward, t, 1)).toBeNull();
    expect(codonNoteAt(forward, t, 9)).toBeNull();
    expect(codonNoteAt(forward, t, 18)).toBeNull();
  });

  it('names a stub of two bases and a codon of three pieces', () => {
    // AT | G... : join(1..2,14..) => ATG? bases A T + T G A: ATT = Ile
    const two = cds({ segments: [rangeSegment(0, 2), rangeSegment(13, 19)] });
    expect(codonNoteAt(forward, translateCds(forward, two), 0)).toBe(
      'Codon 1: AT (1-2) + T (14) = ATT, Ile. The codon continues in the next exon.',
    );
    const three = cds({
      segments: [rangeSegment(0, 1), rangeSegment(2, 3), rangeSegment(13, 19)],
    });
    // A | G | T G A A A C: AGT, Ser
    expect(codonNoteAt(forward, translateCds(forward, three), 2)).toBe(
      'Codon 1: A (1) + G (3) + T (14) = AGT, Ser. The codon continues in the next exon.',
    );
  });

  it('reads a reverse-strand feature on the other strand, positions as the forward strand has them', () => {
    const sequence = reverseComplement(exon2) + intron + reverseComplement(exon1);
    const doc = SeqDocument.create({ sequence, topology: 'linear' });
    const reverse = cds({
      strand: 'reverse',
      segments: [rangeSegment(0, 6), rangeSegment(12, 19)],
    });
    const t = translateCds(doc, reverse);
    expect(t.protein).toBe('MKVK');
    const note = 'Codon 3: G (13) + TG (5-6) = GTG, Val. The codon continues in the next exon.';
    expect(codonNoteAt(doc, t, 12)).toBe(note);
    expect(codonNoteAt(doc, t, 4)).toBe(note);
    expect(codonNoteAt(doc, t, 13)).toBeNull();
  });

  it('numbers codons from the first full one under /codon_start 2', () => {
    // x | ATG AAA G..: codon_start 2 skips the first base
    const doc = SeqDocument.create({ sequence: `C${exon1}${intron}${exon2}`, topology: 'linear' });
    const t = translateCds(
      doc,
      cds({
        segments: [rangeSegment(0, 8), rangeSegment(14, 20)],
        qualifiers: [{ name: 'codon_start', value: '2' }],
      }),
    );
    expect(codonNoteAt(doc, t, 7)).toBe(
      'Codon 3: G (8) + TG (15-16) = GTG, Val. The codon continues in the next exon.',
    );
  });

  it('says nothing for a codon that only wraps the origin, and names one split across it', () => {
    // Circular, length 12: the codon at 10, 11, 0 is whole.
    const circ = SeqDocument.create({ sequence: 'ATGCCCAAAGTG', topology: 'circular' });
    const wrapping = cds({ segments: [rangeSegment(9, 15)] });
    const w = translateCds(circ, wrapping);
    expect(w.codons[0]?.positions).toEqual([9, 10, 11]);
    expect(w.codons[1]?.positions).toEqual([0, 1, 2]);
    expect(codonNoteAt(circ, w, 11)).toBeNull();
    const across = cds({ segments: [rangeSegment(10, 14)] });
    const a = translateCds(circ, across);
    expect(a.codons[0]?.positions).toEqual([10, 11, 0]);
    expect(codonNoteAt(circ, a, 11)).toBeNull();
    // join(11..12, 6..9): TG then CC|A... the second piece is not the origin's neighbour.
    const gap = cds({ segments: [rangeSegment(10, 12), rangeSegment(5, 9)] });
    const g = translateCds(circ, gap);
    expect(codonNoteAt(circ, g, 11)).toBe(
      'Codon 1: TG (11-12) + C (6) = TGC, Cys. The codon continues in the next exon.',
    );
  });

  it('writes a piece that wraps the origin from its first base to its last', () => {
    const circ = SeqDocument.create({ sequence: 'ATGCCCAAAGTG', topology: 'circular' });
    // join(12..14 (wraps: 12, 1, 2), 6..): T G | then...: positions 11, 0 | 5
    const f = cds({ segments: [rangeSegment(11, 13), rangeSegment(5, 9)] });
    const t = translateCds(circ, f);
    expect(t.codons[0]?.positions).toEqual([11, 0, 5]);
    expect(codonNoteAt(circ, t, 11)).toBe(
      'Codon 1: GA (12-1) + C (6) = GAC, Asp. The codon continues in the next exon.',
    );
  });

  it('says the CDS ends open over a codon that never finishes, whole, or two bases', () => {
    const open = { partialEnd: true };
    // ATG AAA G: the G is the incomplete codon, the CDS ends at 7.
    const one = translateCds(forward, cds({ segments: [rangeSegment(0, 7, open)] }));
    expect(codonNoteAt(forward, one, 6)).toBe('Incomplete codon: the CDS ends open at 7.');
    expect(codonNoteAt(forward, one, 5)).toBeNull();
    // Two bases that fix a residue are a part codon: still incomplete.
    const gt = SeqDocument.create({ sequence: 'ATGAAAGTC' });
    const two = translateCds(gt, cds({ segments: [rangeSegment(0, 8, open)] }));
    expect(codonNoteAt(gt, two, 6)).toBe('Incomplete codon: the CDS ends open at 8.');
    expect(codonNoteAt(gt, two, 7)).toBe('Incomplete codon: the CDS ends open at 8.');
    // Reverse strand: the CDS ends open at its lowest base.
    const rev = SeqDocument.create({ sequence: `CC${reverseComplement('ATGAAAG')}` });
    const r = translateCds(
      rev,
      cds({ strand: 'reverse', segments: [rangeSegment(2, 9, { partialStart: true })] }),
    );
    expect(codonNoteAt(rev, r, 2)).toBe('Incomplete codon: the CDS ends open at 3.');
  });

  it('names the stub of an incomplete codon that is split by a join as incomplete', () => {
    const open = { partialEnd: true };
    const t = translateCds(
      forward,
      cds({ segments: [rangeSegment(0, 6), rangeSegment(13, 14, open)] }),
    );
    // ATG AAA then... 6 + 1 = 7 bases: the seventh is left over.
    expect(codonNoteAt(forward, t, 13)).toBe('Incomplete codon: the CDS ends open at 14.');
  });

  it('writes U for an RNA record', () => {
    const rna = SeqDocument.create({
      sequence: exon1 + intron + exon2,
      topology: 'linear',
      metadata: { moleculeType: 'mRNA' },
    });
    expect(codonNoteAt(rna, translateCds(rna, joined), 6)).toBe(
      'Codon 3: G (7) + UG (14-15) = GUG, Val. The codon continues in the next exon.',
    );
  });
});
