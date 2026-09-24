import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';

import { digest } from './digest';
import { ligate } from './ligate';
import { compareProteins, describeChange, designMutagenesis, quikChangeTm } from './mutagenesis';
import { pcr } from './pcr';

/** A fixed pseudo-random plasmid, so every primer site is unique by accident. */
function template(length: number, seed = 20260923): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const TEXT = template(2500).toLowerCase();
const PLASMID = SeqDocument.create({ name: 'pTest', sequence: TEXT, topology: 'circular' });

/** Whether two circles are the same molecule, from any origin, case aside. */
function sameCircle(a: string, b: string): boolean {
  return a.length === b.length && (a + a).toUpperCase().includes(b.toUpperCase());
}

/**
 * What the bench does with back-to-back primers: amplify the whole plasmid,
 * then close the linear product on itself (KLD).
 */
function kld(doc: SeqDocument, forward: string, reverse: string): string {
  const result = pcr(doc, [
    { name: 'F', sequence: forward },
    { name: 'R', sequence: reverse },
  ]);
  expect(result.products).toHaveLength(1);
  const product = result.products[0]?.document;
  if (product === undefined) throw new Error('no product');
  const [whole] = digest(product, []);
  if (whole === undefined) throw new Error('no fragment');
  return ligate([whole], { name: 'closed', circular: true }).sequence.toString();
}

describe('designMutagenesis, back to back', () => {
  it('makes a substitution whose PCR and ligation give the mutant', () => {
    const d = designMutagenesis(PLASMID, { start: 1000, end: 1001 }, 'G', 'back-to-back');
    expect(d.problem).toBeNull();
    expect(d.forward.sequence.startsWith('G')).toBe(true);
    expect(d.forward.tm).toBeGreaterThanOrEqual(60);
    expect(d.reverse.tm).toBeGreaterThanOrEqual(60);
    expect(d.mutant.sequence.charAt(1000)).toBe('G');
    expect(
      sameCircle(
        kld(PLASMID, d.forward.sequence, d.reverse.sequence),
        d.mutant.sequence.toString(),
      ),
    ).toBe(true);
    expect(d.label).toBe(`${TEXT.charAt(1000).toUpperCase()}1,001G`);
  });

  it('deletes, and inserts, splitting a long insert between the primers', () => {
    const del = designMutagenesis(PLASMID, { start: 1000, end: 1030 }, '', 'back-to-back');
    expect(del.mutant.length).toBe(TEXT.length - 30);
    expect(
      sameCircle(
        kld(PLASMID, del.forward.sequence, del.reverse.sequence),
        del.mutant.sequence.toString(),
      ),
    ).toBe(true);
    expect(del.label).toBe('Δ1,001–1,030');

    const tag = 'GACTACAAAGACGATGACGACAAG'; // FLAG, 24 bases: split
    const ins = designMutagenesis(PLASMID, { start: 1500, end: 1500 }, tag, 'back-to-back');
    expect(ins.forward.sequence.startsWith(tag.slice(12))).toBe(true);
    expect(ins.reverse.sequence.startsWith(reverseComplement(tag.slice(0, 12)))).toBe(true);
    expect(
      sameCircle(
        kld(PLASMID, ins.forward.sequence, ins.reverse.sequence),
        ins.mutant.sequence.toString(),
      ),
    ).toBe(true);
    expect(ins.label).toBe(`+${tag} after 1,500`);
  });

  it('works across the origin of a circle', () => {
    const d = designMutagenesis(PLASMID, { start: 2, end: 3 }, 'T', 'back-to-back');
    expect(
      sameCircle(
        kld(PLASMID, d.forward.sequence, d.reverse.sequence),
        d.mutant.sequence.toString(),
      ),
    ).toBe(true);
  });
});

describe('designMutagenesis, overlapping', () => {
  it('centres the change in two complementary primers that reach 78 °C', () => {
    const d = designMutagenesis(PLASMID, { start: 1000, end: 1001 }, 'G', 'overlapping');
    expect(d.problem).toBeNull();
    expect(d.reverse.sequence).toBe(reverseComplement(d.forward.sequence));
    expect(d.forward.tm).toBeGreaterThanOrEqual(78);
    const i = d.forward.sequence.indexOf('G');
    expect(Math.abs(i - (d.forward.sequence.length - 1 - i))).toBeLessThanOrEqual(1);
    expect(d.forward.sequence.length).toBeLessThanOrEqual(60);
  });

  it('uses Agilent’s formula', () => {
    // 25 bases, 13 GC, one mismatch: 81.5 + 0.41·52 − 675/25 − 4.
    expect(quikChangeTm('GGGGGGGCCCCCCAAAAAAAAAAAA', 1, 0)).toBeCloseTo(81.5 + 21.32 - 27 - 4, 5);
    // An insertion leaves its bases out of N and subtracts no mismatch.
    expect(quikChangeTm('GGGGGGGCCCCCCAAAAAAAAAAAA', 0, 5)).toBeCloseTo(81.5 + 21.32 - 675 / 20, 5);
  });
});

describe('protein changes', () => {
  // ATG AAA GAA TTT TAA inside a plasmid.
  const cds = 'ATGAAAGAATTTTAA';
  const doc = SeqDocument.create({
    name: 'pCds',
    topology: 'circular',
    sequence: TEXT.slice(0, 500) + cds + TEXT.slice(515),
    features: [createFeature({ type: 'CDS', name: 'orf', segments: [rangeSegment(500, 515)] })],
  });

  it('names the residue a substitution changes, a frameshift, and a silent change', () => {
    // Deleting the first A of AAA leaves AAG, still K: the frame breaks at E3.
    expect(
      designMutagenesis(doc, { start: 504, end: 505 }, 'G', 'back-to-back').proteinChanges,
    ).toEqual(['orf K2R']);
    expect(
      designMutagenesis(doc, { start: 505, end: 506 }, 'G', 'back-to-back').proteinChanges,
    ).toEqual(['orf no change (silent)']);
    expect(
      designMutagenesis(doc, { start: 504, end: 505 }, '', 'back-to-back').proteinChanges,
    ).toEqual(['orf frameshift from E3']);
    expect(
      designMutagenesis(doc, { start: 200, end: 201 }, 'G', 'back-to-back').proteinChanges,
    ).toEqual([]);
  });

  it('describes changes by position', () => {
    expect(compareProteins('MKEF*', 'MREF*')).toBe('K2R');
    expect(compareProteins('MKEF*', 'MKF*')).toBe('3 E → (none)');
    expect(describeChange('acgt', { start: 1, end: 3 }, 'TT')).toBe('CG2–3TT');
  });
});
