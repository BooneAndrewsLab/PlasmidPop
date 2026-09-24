import {
  SeqDocument,
  createFeature,
  meltingTemperature,
  rangeSegment,
  reverseComplement,
} from '@/core';

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

describe('designMutagenesis, the edit and the primers’ lengths', () => {
  it('writes the change as an insert, a delete or a replace', () => {
    const doc = SeqDocument.create({ name: 'p', sequence: template(600), topology: 'circular' });
    expect(designMutagenesis(doc, { start: 300, end: 300 }, 'gg', 'back-to-back').edit).toEqual({
      type: 'insert',
      position: 300,
      text: 'GG',
    });
    expect(designMutagenesis(doc, { start: 300, end: 303 }, '', 'back-to-back').edit).toEqual({
      type: 'delete',
      range: { start: 300, end: 303 },
    });
    expect(designMutagenesis(doc, { start: 300, end: 303 }, 'a', 'overlapping').edit).toEqual({
      type: 'replace',
      range: { start: 300, end: 303 },
      text: 'A',
    });
  });

  it('keeps an insert of exactly 20 bases whole on the forward primer', () => {
    const doc = SeqDocument.create({ name: 'p', sequence: template(600), topology: 'circular' });
    const tag = 'GACTACAAAGACGATGACGA';
    const d = designMutagenesis(doc, { start: 300, end: 300 }, tag, 'back-to-back');
    expect(d.forward.sequence.startsWith(tag)).toBe(true);
    expect(d.reverse.sequence).toBe(d.reverse.sequence.toLowerCase());
    expect(d.reverse.sequence).toHaveLength(d.reverse.annealLength);
  });

  it('stops growing a primer at the first length that reaches the target, even exactly', () => {
    const text = template(600);
    const doc = SeqDocument.create({ name: 'p', sequence: text, topology: 'circular' });
    const range = { start: 300, end: 301 };
    // The target set to what 20 bases on either side reach, and not before.
    const forward20 = text.slice(301, 321);
    const reverse20 = reverseComplement(text.slice(280, 300));
    for (const [twenty, from] of [
      [forward20, (n: number) => text.slice(301, 301 + n)],
      [reverse20, (n: number) => reverseComplement(text.slice(300 - n, 300))],
    ] as const) {
      for (let n = 15; n < 20; n++) {
        expect(meltingTemperature(from(n))).toBeLessThan(meltingTemperature(twenty));
      }
    }
    const f = designMutagenesis(doc, range, 'G', 'back-to-back', {
      targetTm: meltingTemperature(forward20),
    });
    expect(f.forward.annealLength).toBe(20);
    expect(f.forward.tm).toBe(meltingTemperature(forward20));
    expect(f.problem).toBeNull();
    const r = designMutagenesis(doc, range, 'G', 'back-to-back', {
      targetTm: meltingTemperature(reverse20),
    });
    expect(r.reverse.annealLength).toBe(20);
    expect(r.reverse.sequence).toBe(reverse20.toLowerCase());
    expect(r.problem).toBeNull();
  });

  it('runs out of template at either end of a linear molecule, and says so', () => {
    const text = template(600);
    const linear = SeqDocument.create({ name: 'p', sequence: text, topology: 'linear' });
    const problem =
      'The template next to the change is too AT-rich to reach 60 °C within 60 bases.';
    const nearStart = designMutagenesis(linear, { start: 3, end: 4 }, 'G', 'back-to-back');
    expect(nearStart.reverse.sequence).toBe(reverseComplement(text.slice(0, 3)).toLowerCase());
    expect(nearStart.forward.tm).toBeGreaterThanOrEqual(60);
    expect(nearStart.problem).toBe(problem);
    const nearEnd = designMutagenesis(linear, { start: 596, end: 597 }, 'G', 'back-to-back');
    expect(nearEnd.forward.sequence).toBe(`G${text.slice(597).toLowerCase()}`);
    expect(nearEnd.reverse.tm).toBeGreaterThanOrEqual(60);
    expect(nearEnd.problem).toBe(problem);
    // The same change on the circle reads on round the origin.
    const circle = SeqDocument.create({ name: 'p', sequence: text, topology: 'circular' });
    const round = designMutagenesis(circle, { start: 3, end: 4 }, 'G', 'back-to-back');
    expect(round.reverse.sequence).toBe(
      reverseComplement(
        text.slice(600 - (round.reverse.annealLength - 3)) + text.slice(0, 3),
      ).toLowerCase(),
    );
    expect(round.reverse.annealLength).toBeGreaterThan(3);
    expect(round.problem).toBeNull();
  });

  it('gives up on an overlapping pair at the longest primer, and says how far it got', () => {
    const doc = SeqDocument.create({ name: 'p', sequence: 'A'.repeat(200), topology: 'linear' });
    const d = designMutagenesis(doc, { start: 100, end: 101 }, 'G', 'overlapping');
    expect(d.forward.sequence).toHaveLength(60);
    expect(d.forward.sequence.indexOf('G')).toBe(30);
    expect(d.problem).toBe(
      'The primers reach only 69 °C at 60 bases, short of the 78 °C QuikChange asks for.',
    );
  });
});

describe('protein changes, at the edges of a CDS', () => {
  // ATG AAA GAA TTT TAA, in a linear molecule and in a circle.
  function withCds(topology: 'linear' | 'circular', segments = [rangeSegment(100, 115)]) {
    const text = template(300).toLowerCase();
    return SeqDocument.create({
      name: 'pCds',
      topology,
      sequence: text.slice(0, 100) + 'ATGAAAGAATTTTAA' + text.slice(115),
      features: [createFeature({ type: 'CDS', name: 'orf', segments })],
    });
  }

  it('reads a change in a CDS of a linear molecule', () => {
    const d = designMutagenesis(withCds('linear'), { start: 104, end: 105 }, 'G', 'overlapping');
    expect(d.proteinChanges).toEqual(['orf K2R']);
  });

  it('counts a change on the first or the last base of the CDS as inside it', () => {
    // CTG for the start codon still reads as M, the first codon of a CDS.
    for (const topology of ['linear', 'circular'] as const) {
      const doc = withCds(topology);
      expect(
        designMutagenesis(doc, { start: 100, end: 101 }, 'C', 'overlapping').proteinChanges,
      ).toEqual(['orf no change (silent)']);
      expect(
        designMutagenesis(doc, { start: 114, end: 115 }, 'C', 'overlapping').proteinChanges,
      ).toEqual(['orf *5Y']);
      expect(
        designMutagenesis(doc, { start: 99, end: 100 }, 'C', 'overlapping').proteinChanges,
      ).toEqual([]);
      expect(
        designMutagenesis(doc, { start: 115, end: 116 }, 'C', 'overlapping').proteinChanges,
      ).toEqual([]);
    }
  });

  it('looks for the change in each segment of a joined CDS', () => {
    const doc = withCds('linear', [rangeSegment(100, 106), rangeSegment(106, 115)]);
    expect(
      designMutagenesis(doc, { start: 104, end: 105 }, 'G', 'overlapping').proteinChanges,
    ).toEqual(['orf K2R']);
    expect(
      designMutagenesis(doc, { start: 108, end: 109 }, 'C', 'overlapping').proteinChanges,
    ).toEqual(['orf E3D']);
  });

  it('says nothing of a CDS the change deletes whole', () => {
    const d = designMutagenesis(withCds('linear'), { start: 100, end: 115 }, '', 'back-to-back');
    expect(d.mutant.features.all()).toEqual([]);
    expect(d.proteinChanges).toEqual([]);
  });
});
