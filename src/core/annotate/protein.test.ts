import { type FeatureLibrary, type LibraryPart } from './library';
import { detectFeatures } from './detect';
import {
  DEFAULT_PROTEIN_IDENTITY,
  EXACT_UP_TO,
  detectProteinFeatures,
  proteinMismatchBudget,
} from './protein';
import { reverseComplement, translate } from '@/core';

function part(over: Partial<LibraryPart> & { readonly name: string }): LibraryPart {
  return {
    type: 'CDS',
    category: 'tag',
    sequence: '',
    accession: 'X00001.1',
    location: '1..30',
    source: 'core',
    ...over,
  };
}

function library(...parts: readonly LibraryPart[]): FeatureLibrary {
  return { parts };
}

/** Bases that translate to `protein`, in a spelling of our own. */
function encode(protein: string): string {
  const codons: Record<string, string> = {
    A: 'GCG',
    C: 'TGC',
    D: 'GAT',
    E: 'GAA',
    F: 'TTT',
    G: 'GGC',
    H: 'CAT',
    I: 'ATT',
    K: 'AAA',
    L: 'CTG',
    M: 'ATG',
    N: 'AAC',
    P: 'CCG',
    Q: 'CAG',
    R: 'CGT',
    S: 'AGC',
    T: 'ACC',
    V: 'GTG',
    W: 'TGG',
    Y: 'TAT',
  };
  return Array.from(protein, (aa) => codons[aa] ?? 'NNN').join('');
}

/** Filler with no stop codon and no accidental tag in it. */
const PAD = 'GCGGCGGCGGCGGCGGCGGCGGCGGCG';
const HIS = 'HHHHHH';
const TEV = 'ENLYFQG';
/** A protein long enough to be allowed a mismatch. */
const LONG = 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTL';

describe('proteinMismatchBudget (#93)', () => {
  it('allows nothing to a short part, and what the identity allows to a long one', () => {
    expect(proteinMismatchBudget(6, 0.5)).toBe(0);
    expect(proteinMismatchBudget(EXACT_UP_TO, 0.5)).toBe(0);
    expect(proteinMismatchBudget(100, DEFAULT_PROTEIN_IDENTITY)).toBe(2);
    expect(proteinMismatchBudget(100, 0.9)).toBe(10);
  });

  it('never allows more than a seed can still find', () => {
    // A part of 20 residues shares a 5-mer with the sequence only while it
    // has at most 3 mismatched residues.
    expect(proteinMismatchBudget(20, 0)).toBe(3);
    expect(proteinMismatchBudget(30, 0)).toBe(5);
  });
});

describe('detectProteinFeatures', () => {
  const lib = library(
    part({ name: '6xHis', protein: HIS }),
    part({ name: 'TEV site', protein: TEV }),
    part({ name: 'FP', protein: LONG, type: 'CDS', category: 'reporter' }),
  );

  it('finds a tag in any forward frame, and gives back the bases it read', () => {
    for (const offset of ['', 'A', 'AC']) {
      const sequence = `${offset}${PAD}${encode(HIS)}${PAD}`;
      const [hit] = detectProteinFeatures(sequence, 'linear', lib);
      const start = offset.length + PAD.length;
      expect(hit).toMatchObject({
        strand: 'forward',
        range: { start, end: start + HIS.length * 3 },
        mismatches: 0,
        identity: 1,
        viaProtein: true,
      });
      expect(translate(sequence.slice(start, start + HIS.length * 3))).toBe(HIS);
    }
  });

  it('finds one on the reverse strand, over the same bases', () => {
    const forward = `${PAD}${encode(TEV)}${PAD}`;
    const sequence = reverseComplement(forward);
    const [hit] = detectProteinFeatures(sequence, 'linear', lib);
    expect(hit?.strand).toBe('reverse');
    const { start, end } = hit?.range ?? { start: 0, end: 0 };
    expect(translate(reverseComplement(sequence.slice(start, end)))).toBe(TEV);
  });

  it('finds a part however it is spelled, which is the point of matching the protein', () => {
    const one = `${PAD}${encode(TEV)}${PAD}`;
    // The same peptide in other codons: nothing of the DNA match survives.
    const other = `${PAD}GAGAACCTGTACTTTCAGGGT${PAD}`;
    expect(translate(other.slice(PAD.length, PAD.length + 21))).toBe(TEV);
    expect(detectProteinFeatures(one, 'linear', lib)).toHaveLength(1);
    expect(detectProteinFeatures(other, 'linear', lib)).toHaveLength(1);
  });

  it('allows a long part a substituted residue but a short one none', () => {
    const changed = `${LONG.slice(0, 20)}A${LONG.slice(21)}`;
    const [hit] = detectProteinFeatures(`${PAD}${encode(changed)}${PAD}`, 'linear', lib);
    expect(hit).toMatchObject({ mismatches: 1 });
    expect(hit?.identity).toBeCloseTo((LONG.length - 1) / LONG.length);
    // A tag with one residue changed is not that tag.
    const wrong = `${PAD}${encode('HHHQHH')}${PAD}`;
    expect(detectProteinFeatures(wrong, 'linear', lib)).toEqual([]);
  });

  it('reads through the origin of a circle, and not of a linear sequence', () => {
    const codons = encode(TEV);
    // The tag's first two codons at the end of the sequence, the rest at its start.
    const sequence = `${codons.slice(6)}${PAD}${PAD}${codons.slice(0, 6)}`;
    const circular = detectProteinFeatures(sequence, 'circular', lib);
    expect(circular).toHaveLength(1);
    expect(circular[0]?.range.start).toBe(sequence.length - 6);
    expect(circular[0]?.range.end).toBe(sequence.length - 6 + TEV.length * 3);
    expect(detectProteinFeatures(sequence, 'linear', lib)).toEqual([]);
  });

  it('does not match through a stop codon', () => {
    const codons = encode(TEV);
    const stopped = `${codons.slice(0, 9)}TAA${codons.slice(12)}`;
    expect(detectProteinFeatures(`${PAD}${stopped}${PAD}`, 'linear', lib)).toEqual([]);
  });

  it('is nothing for an empty sequence or a library with no proteins', () => {
    expect(detectProteinFeatures('', 'linear', lib)).toEqual([]);
    const dna = library(part({ name: 'plain', sequence: 'ACGT'.repeat(10) }));
    expect(detectProteinFeatures(`${PAD}${encode(HIS)}`, 'linear', dna)).toEqual([]);
  });
});

describe('detectFeatures with the protein parts (#93)', () => {
  it('offers a tag found only in the translation among the rest', () => {
    const dnaPart = 'GGTCTCAGGTCTCAGGTCTCAGGTCTCA';
    const lib = library(
      part({ name: 'a site', sequence: dnaPart, type: 'misc_feature' }),
      part({ name: '6xHis', protein: HIS }),
    );
    const sequence = `${dnaPart}${PAD}${encode(HIS)}${PAD}`;
    const hits = detectFeatures(sequence, 'linear', lib);
    expect(hits.map((h) => lib.parts[h.part]?.name)).toEqual(['a site', '6xHis']);
    expect(hits[1]?.viaProtein).toBe(true);
    // And can be left out, for a caller that wants the bases alone.
    expect(detectFeatures(sequence, 'linear', lib, { protein: false })).toHaveLength(1);
  });

  it('keeps one hit where a part is found by its bases and by its protein', () => {
    const bases = encode(LONG);
    const lib = library(part({ name: 'FP', sequence: bases, protein: LONG, category: 'reporter' }));
    const hits = detectFeatures(`${PAD}${bases}${PAD}`, 'linear', lib);
    expect(hits).toHaveLength(1);
    // The match on the bases is the more exacting, so it is the one kept.
    expect(hits[0]?.viaProtein).toBeUndefined();
  });
});
