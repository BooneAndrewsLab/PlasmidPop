import { describe, expect, it } from 'vitest';

import { SeqDocument } from '../document';
import { reverseComplement } from '../sequence';

import {
  cdseguid,
  csseguid,
  documentChecksum,
  documentStrands,
  ldseguid,
  lsseguid,
  minimalRotation,
} from './seguid';

/**
 * The expected values are the reference implementations' own test vectors
 * (https://github.com/seguid/seguid-tests, `tests-api/40.seguid-v2.bats`)
 * and the worked examples in the paper. A checksum is only worth having if
 * it is the same checksum everyone else computes, so these are quoted, not
 * generated from this implementation.
 */
describe('SEGUID v2', () => {
  it('matches the published lsseguid vectors', () => {
    expect(lsseguid('ACGT').text).toBe('lsseguid=IQiZThf2zKn_I1KtqStlEdsHYDQ');
    expect(lsseguid('A').text).toBe('lsseguid=bc1M4j2I4u6VaLpUbAB8Y9kTHBs');
    expect(lsseguid('GATTACA').text).toBe('lsseguid=tp2jzeCM2e3W4yxtrrx09CMKa_8');
  });

  it('matches the published csseguid vectors', () => {
    expect(csseguid('ACGT').text).toBe('csseguid=IQiZThf2zKn_I1KtqStlEdsHYDQ');
    expect(csseguid('A').text).toBe('csseguid=bc1M4j2I4u6VaLpUbAB8Y9kTHBs');
    expect(csseguid('GATTACA').text).toBe('csseguid=mtrvbtuwr6_MoBxvtm4BEpv-jKQ');
  });

  it('matches the published ldseguid vectors', () => {
    expect(ldseguid('AACGT', 'ACGTT').text).toBe('ldseguid=5fHMG19IbYxn7Yr7_sOCkvaaw7U');
    expect(ldseguid('A', 'T').text).toBe('ldseguid=ydezQsYTZgUCcb3-adxMaq_Xf8g');
    expect(ldseguid('TATGCCAA', 'TTGGCATA').text).toBe('ldseguid=p88RYs41n0NTej4htM1fJAWI1ME');
  });

  it('matches the published ldseguid vectors for staggered ends', () => {
    expect(ldseguid('-CGT', 'ACGT').text).toBe('ldseguid=PVID4ZDkJEzFu2w2RLBCMQdZgvE');
    expect(ldseguid('-CGT', '-CGT').text).toBe('ldseguid=s_nCUnQCNz7NjQQTOBmoqIvXexA');
    expect(ldseguid('--TTACA', '-GTAATC').text).toBe('ldseguid=4RNiS6tZ_3dnHmqD_15_83vEqKQ');
  });

  it('matches the published cdseguid vectors', () => {
    expect(cdseguid('AACGT', 'ACGTT').text).toBe('cdseguid=5fHMG19IbYxn7Yr7_sOCkvaaw7U');
    expect(cdseguid('CGTAA', 'TTACG').text).toBe('cdseguid=5fHMG19IbYxn7Yr7_sOCkvaaw7U');
    expect(cdseguid('A', 'T').text).toBe('cdseguid=ydezQsYTZgUCcb3-adxMaq_Xf8g');
    expect(cdseguid('TATGCCAA', 'TTGGCATA').text).toBe('cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A');
  });

  it('gives the prefix, the 27 characters and the short form', () => {
    const sum = cdseguid('TATGCCAA', 'TTGGCATA');
    expect(sum.kind).toBe('cdseguid');
    expect(sum.value).toHaveLength(27);
    expect(sum.short).toBe('dUxN7Y');
    expect(sum.text).toBe(`cdseguid=${sum.value}`);
  });
});

describe('minimalRotation', () => {
  it('finds the rotation that sorts first', () => {
    expect(minimalRotation('GATTACA')).toEqual({ rotated: 'ACAGATT', index: 4 });
    expect(minimalRotation('ACGT').rotated).toBe('ACGT');
    expect(minimalRotation('').rotated).toBe('');
  });

  it('agrees with sorting every rotation', () => {
    const cases = ['AAAA', 'AAAB', 'ABAB', 'CABCAB', 'TTTTTA', 'ACGTACGTA', 'AGAGAGAGAA'];
    for (const s of cases) {
      const all: string[] = [];
      for (let i = 0; i < s.length; i++) all.push(s.slice(i) + s.slice(0, i));
      all.sort();
      expect(minimalRotation(s).rotated).toBe(all[0]);
    }
  });

  it('reports where the rotation starts', () => {
    const { rotated, index } = minimalRotation('CABCAB');
    expect('CABCAB'.slice(index) + 'CABCAB'.slice(0, index)).toBe(rotated);
  });
});

const circular = (sequence: string): SeqDocument =>
  SeqDocument.create({ sequence, topology: 'circular' });

describe('documentChecksum', () => {
  it('is a cdseguid for a plasmid and an ldseguid for a linear molecule', () => {
    expect(documentChecksum(circular('AACGT'))?.kind).toBe('cdseguid');
    expect(documentChecksum(SeqDocument.create({ sequence: 'AACGT' }))?.kind).toBe('ldseguid');
  });

  it('is null for an empty document', () => {
    expect(documentChecksum(SeqDocument.create({ sequence: '' }))).toBeNull();
  });

  it('does not change when a plasmid is rotated to another origin', () => {
    const doc = circular('AACGTTGACCTAGGACGATCAGGTACC');
    const expected = documentChecksum(doc)?.text;
    expect(expected).toBeDefined();
    for (let origin = 1; origin < doc.length; origin++) {
      expect(documentChecksum(doc.setOrigin(origin))?.text).toBe(expected);
    }
  });

  it('does not change when a plasmid is read from the other strand', () => {
    const doc = circular('AACGTTGACCTAGGACGATCAGGTACC');
    expect(documentChecksum(doc.reverseComplement())?.text).toBe(documentChecksum(doc)?.text);
  });

  it('does not change when a linear molecule is turned around', () => {
    const doc = SeqDocument.create({ sequence: 'AACGTTGACCTAGG' });
    expect(documentChecksum(doc.reverseComplement())?.text).toBe(documentChecksum(doc)?.text);
  });

  it('ignores the case the sequence is written in', () => {
    expect(documentChecksum(circular('aacgttgacc'))?.text).toBe(
      documentChecksum(circular('AACGTTGACC'))?.text,
    );
  });

  it('separates a plasmid from the linear molecule of the same bases', () => {
    // Only by the prefix, and that is the design: a linear molecule already
    // written at its own smallest rotation hashes the same string a plasmid
    // of those bases does, so `cdseguid=` and `ldseguid=` are part of the
    // checksum rather than a label on it.
    const plasmid = documentChecksum(circular('AACGTTGACC'));
    const fragment = documentChecksum(SeqDocument.create({ sequence: 'AACGTTGACC' }));
    expect(plasmid?.value).toBe(fragment?.value);
    expect(plasmid?.text).not.toBe(fragment?.text);
  });

  it('is not changed by a name, a feature or a rotation of the same circle', () => {
    const a = circular('AACGTTGACCTAGGACGATCAGGTACC').rename('pFoo');
    const b = circular('AACGTTGACCTAGGACGATCAGGTACC').setOrigin(9).rename('pBar');
    expect(documentChecksum(a)?.text).toBe(documentChecksum(b)?.text);
  });
});

describe('documentStrands', () => {
  const sticky = (
    sequence: string,
    left: { kind: "5'" | "3'" | 'blunt'; overhang: string },
    right: { kind: "5'" | "3'" | 'blunt'; overhang: string },
  ): SeqDocument =>
    SeqDocument.create({
      sequence,
      ends: {
        left: { ...left, enzyme: null },
        right: { ...right, enzyme: null },
      },
    });

  it('writes both strands of a blunt molecule in full', () => {
    const { watson, crick } = documentStrands(SeqDocument.create({ sequence: 'AACGT' }));
    expect(watson).toBe('AACGT');
    expect(crick).toBe('ACGTT');
  });

  it("marks a 5' overhang the top strand carries", () => {
    // AATTCGGG / ----GCCC: the first four bases have no partner below them.
    const { watson, crick } = documentStrands(
      sticky('AATTCGGG', { kind: "5'", overhang: 'AATT' }, { kind: 'blunt', overhang: '' }),
    );
    expect(watson).toBe('AATTCGGG');
    expect(crick).toBe(`${reverseComplement('CGGG')}----`);
  });

  it("marks a 3' overhang the bottom strand carries", () => {
    // ----GGGC / AATTCCCG: the molecule reaches four bases left of our own
    // sequence, where only the bottom strand is present.
    const { watson, crick } = documentStrands(
      sticky('GGGC', { kind: "3'", overhang: 'AATT' }, { kind: 'blunt', overhang: '' }),
    );
    expect(watson).toBe('----GGGC');
    expect(crick).toBe(reverseComplement('AATTGGGC'));
  });

  it('keeps the two strands the same length', () => {
    const doc = sticky(
      'AATTCGGGAATT',
      { kind: "5'", overhang: 'AATT' },
      { kind: "5'", overhang: 'CCGG' },
    );
    const { watson, crick } = documentStrands(doc);
    expect(watson).toHaveLength(crick.length);
    expect(watson).toBe('AATTCGGGAATT----');
    expect(crick).toBe(`${reverseComplement('CGGGAATTCCGG')}----`);
  });

  it('tells sticky ends from the blunt molecule of the same bases', () => {
    const blunt = SeqDocument.create({ sequence: 'AATTCGGG' });
    const cut = sticky(
      'AATTCGGG',
      { kind: "5'", overhang: 'AATT' },
      { kind: 'blunt', overhang: '' },
    );
    expect(documentChecksum(cut)?.value).not.toBe(documentChecksum(blunt)?.value);
  });
});
