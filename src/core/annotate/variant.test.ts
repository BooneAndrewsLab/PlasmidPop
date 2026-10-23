import { describe, expect, it } from 'vitest';

import { randomDna, randomInt, seededRandom } from '@/test/random';

import { reverseComplement } from '../sequence';
import { type FeatureHit, detectFeatures } from './detect';
import { featureFromHit } from './hits';
import { type FeatureLibrary, type LibraryPart, codingProtein, parseLibraryFile } from './library';
import { nameOfHit } from './variant';

/**
 * Variant names (#284, docs/design/59-detect-features.md): a part named for
 * one variant of an element keeps its name only where the hit shows what the
 * name claims. The parts here are synthetic, so the rule is tested apart
 * from the bundled data (`library.test.ts` and the pLannotate oracle check
 * the parts themselves).
 */

const rand = seededRandom(284);

function part(over: Partial<LibraryPart> & { name: string; sequence: string }): LibraryPart {
  const type = over.type ?? 'CDS';
  // As the bundled library does: a coding part's protein is read off its own
  // bases, and is what the residues a variant names are counted on.
  const protein = codingProtein(type, over.sequence);
  return {
    type,
    category: 'other',
    accession: 'X00000.1',
    location: `1..${over.sequence.length}`,
    source: 'core',
    ...(protein === undefined ? {} : { protein }),
    ...over,
  };
}

function library(...parts: LibraryPart[]): FeatureLibrary {
  return { parts };
}

/**
 * A coding part of `codons` codons, ATG first and no stop inside, with the
 * same protein spelled in other codons beside it (`recoded`).
 */
const SYNONYMS = [
  ['CTG', 'CTC'],
  ['GTG', 'GTC'],
  ['TCG', 'TCC'],
  ['CCG', 'CCC'],
  ['ACG', 'ACC'],
  ['GCG', 'GCC'],
  ['CGG', 'CGC'],
  ['GGG', 'GGC'],
] as const;

function coding(codons: number): { dna: string; recoded: string } {
  let dna = 'ATG';
  let recoded = 'ATG';
  for (let i = 1; i < codons; i++) {
    const pair = SYNONYMS[randomInt(rand, 0, SYNONYMS.length)] ?? SYNONYMS[0];
    dna += pair[0];
    recoded += pair[1];
  }
  return { dna, recoded };
}

function hitOf(hits: readonly FeatureHit[]): FeatureHit {
  const [hit] = hits;
  if (hit === undefined) throw new Error('no hit');
  return hit;
}

function partOf(lib: FeatureLibrary): LibraryPart {
  const [p] = lib.parts;
  if (p === undefined) throw new Error('no part');
  return p;
}

const FLANK = randomDna(rand, 400);

describe('a part named for a variant', () => {
  const { dna: CDS, recoded: RECODED } = coding(120);
  const protein = 'exact';

  it('keeps its name where the hit carries the marked residues', () => {
    const lib = library(part({ name: 'X (v2)', sequence: CDS, variant: { protein, family: 'X' } }));
    const hits = detectFeatures(FLANK + CDS + FLANK, 'linear', lib);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.family).toBeUndefined();
    expect(nameOfHit(hitOf(hits), partOf(lib))).toBe('X (v2)');
  });

  it('is named for the element where a marked residue differs', () => {
    const lib = library(part({ name: 'X (v2)', sequence: CDS, variant: { protein, family: 'X' } }));
    // One base of the fourth codon, so one residue of the protein, changed.
    const changed = `${CDS.slice(0, 10)}${CDS[10] === 'A' ? 'C' : 'A'}${CDS.slice(11)}`;
    const hits = detectFeatures(FLANK + changed + FLANK, 'linear', lib);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.family).toBe(true);
    const feature = featureFromHit(hitOf(hits), partOf(lib));
    expect(feature.name).toBe('X');
    expect(feature.qualifiers.map((q) => q.value).join(' ')).toContain('rather than X (v2)');
  });

  it('is not reported at all where the part names no element', () => {
    const lib = library(part({ name: 'X (v2)', sequence: CDS, variant: { protein } }));
    const changed = `${CDS.slice(0, 10)}${CDS[10] === 'A' ? 'C' : 'A'}${CDS.slice(11)}`;
    expect(detectFeatures(FLANK + changed + FLANK, 'linear', lib)).toEqual([]);
    expect(detectFeatures(FLANK + CDS + FLANK, 'linear', lib)).toHaveLength(1);
  });

  it('reads the marks on the strand the part is on', () => {
    const lib = library(part({ name: 'X (v2)', sequence: CDS, variant: { protein, family: 'X' } }));
    const hits = detectFeatures(FLANK + reverseComplement(CDS) + FLANK, 'linear', lib);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.strand).toBe('reverse');
    expect(hits[0]?.family).toBeUndefined();
  });

  it('counts residues only where a whole, ungapped copy was matched', () => {
    const lib = library(part({ name: 'X (v2)', sequence: CDS, variant: { protein, family: 'X' } }));
    // A base deleted in the middle: the residues after it are no longer
    // where they are counted, so the hit shows nothing.
    const gapped = CDS.slice(0, 200) + CDS.slice(201);
    const hits = detectFeatures(FLANK + gapped + FLANK, 'linear', lib);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.deletions).toBe(1);
    expect(hits[0]?.family).toBe(true);
    // And a copy cut off by a linear end, for the same reason.
    const cut = detectFeatures(CDS.slice(100) + FLANK, 'linear', lib);
    expect(cut).toHaveLength(1);
    expect(cut[0]?.partialStart).toBe(true);
    expect(cut[0]?.family).toBe(true);
  });

  it('is named for the element where only its protein was matched', () => {
    // A part whose variant is in the codons: a hit made in the translation
    // can never show it, however well the protein matched.
    const lib = library(
      part({ name: 'X (v2)', sequence: CDS, variant: { codons: true, family: 'X' } }),
    );
    const hits = detectFeatures(FLANK + RECODED + FLANK, 'linear', lib);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.viaProtein).toBe(true);
    expect(hits[0]?.family).toBe(true);
    // The same part found by its bases keeps the variant's name.
    expect(detectFeatures(FLANK + CDS + FLANK, 'linear', lib)[0]?.family).toBeUndefined();
  });

  it('asks for a stretch of bases wherever it was matched, indel or not', () => {
    const PROMOTER = randomDna(rand, 240);
    const lib = library(
      part({
        name: 'P (v2)',
        type: 'promoter',
        sequence: PROMOTER,
        variant: { bases: { start: 101, end: 130 } },
      }),
    );
    // A base missing from the marked stretch: the hit is found with a
    // deletion and is not offered, though every other base matches.
    const short = PROMOTER.slice(0, 110) + PROMOTER.slice(111);
    expect(detectFeatures(FLANK + short + FLANK, 'linear', lib)).toEqual([]);
    // A base missing outside it leaves the stretch there, so the name holds.
    const elsewhere = PROMOTER.slice(0, 200) + PROMOTER.slice(201);
    const hits = detectFeatures(FLANK + elsewhere + FLANK, 'linear', lib);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.family).toBeUndefined();
  });

  it('is never claimed by a homologue', () => {
    const lib = library(
      part({ name: 'X (v2)', sequence: CDS, variant: { protein, family: 'X' } }),
      part({ name: 'Y', sequence: coding(120).dna }),
    );
    // A sixth of the residues changed: too far for the part, close enough
    // for the homologue search, which is only ever "similar to" it (#219).
    const diverged = (CDS.match(/.{3}/g) ?? [])
      .map((c, i) => (i % 6 === 0 ? `${c.startsWith('A') ? 'C' : 'A'}${c.slice(1)}` : c))
      .join('');
    const hits = detectFeatures(FLANK + diverged + FLANK, 'linear', lib).filter(
      (h) => h.similar !== undefined && h.part === 0,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.family).toBe(true);
      expect(nameOfHit(h, partOf(lib))).toBe('similar to X');
    }
  });
});

describe('the library file', () => {
  const one = (variant: unknown): string =>
    JSON.stringify({
      parts: [
        {
          name: 'X (v2)',
          type: 'CDS',
          category: 'other',
          sequence: 'ATGAAACCCGGGTTTAAACCCGGGTTTAAATAA',
          accession: 'X00000.1',
          location: '1..33',
          variant,
        },
      ],
    });

  it('reads the positions a variant names', () => {
    const [p] = parseLibraryFile(one({ family: 'X', protein: '1..3,8' }), 'core');
    expect(p?.variant).toEqual({ family: 'X', protein: [1, 2, 3, 8] });
    expect(parseLibraryFile(one({ bases: '1..9' }), 'core')[0]?.variant).toEqual({
      bases: { start: 1, end: 9 },
    });
    expect(parseLibraryFile(one({ protein: 'exact' }), 'core')[0]?.variant).toEqual({
      protein: 'exact',
    });
  });

  it('takes a family on its own, which only a homologue fails', () => {
    expect(parseLibraryFile(one({ family: 'X' }), 'core')[0]?.variant).toEqual({ family: 'X' });
  });

  it('refuses a variant that names nothing, or a position the part has not', () => {
    expect(() => parseLibraryFile(one({}), 'core')).toThrow(/says nothing/);
    expect(() => parseLibraryFile(one({ protein: '99' }), 'core')).toThrow(/out of range/);
    expect(() => parseLibraryFile(one({ bases: '1,9' }), 'core')).toThrow(/one stretch/);
    expect(() => parseLibraryFile(one({ bases: 'x' }), 'core')).toThrow(/malformed positions/);
  });
});
