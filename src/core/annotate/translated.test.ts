import { describe, expect, it } from 'vitest';

import { findOrfs } from '../analysis/orf';
import { reverseComplement, translate } from '@/core';
import { type FeatureHit, detectFeatures } from './detect';
import { type FeatureLibrary, type LibraryPart } from './library';
import { BASE_CODE, detectProteinFeatures } from './protein';
import { readsAntisense, withoutAntisense } from './translated';

/**
 * A tag found by its protein only where its frame is plausibly translated
 * (#285): not in a frame with no start and shorter than an ORF, inside an
 * ORF on the other strand.
 */

function part(name: string, protein: string): LibraryPart {
  return {
    name,
    type: 'CDS',
    category: 'tag',
    sequence: '',
    accession: 'X00001.1',
    location: '1..30',
    source: 'core',
    protein,
  };
}

const lib: FeatureLibrary = { parts: [part('6xHis', 'HHHHHH')] };

/** A stop in each of the six frames. */
const STOPS = 'TTAATTAATTAA';
/** Ala forward, Ser on the other strand in the same frame: no stop, no ATG either way. */
const ALA = (n: number): string => 'GCT'.repeat(n);
/** Six histidines, and on the other strand, in the same frame, six valines. */
const HIS6 = 'CAC'.repeat(6);

function codes(sequence: string): Uint8Array {
  return Uint8Array.from(sequence, (c) => BASE_CODE[c.charCodeAt(0)] ?? 4);
}

function tags(sequence: string, topology: 'linear' | 'circular' = 'linear'): FeatureHit[] {
  return detectFeatures(sequence, topology, lib).filter((h) => h.viaProtein === true);
}

/** The one protein hit in a linear `sequence`. */
function onlyHit(sequence: string): FeatureHit {
  const [hit, ...rest] = detectProteinFeatures(sequence, 'linear', lib);
  if (hit === undefined || rest.length > 0) throw new Error('not one hit');
  return hit;
}

/** The ORFs of at least the default length on `strand` that hold all of `hit`. */
function orfsAcross(sequence: string, hit: FeatureHit, strand: 'forward' | 'reverse') {
  return findOrfs(sequence, 'linear').filter(
    (o) => o.strand === strand && o.range.start <= hit.range.start && o.range.end >= hit.range.end,
  );
}

describe('a protein hit read antisense to an ORF (#285)', () => {
  // On the forward strand, a 10-codon open stretch with no ATG, between two
  // TAG; read the other way, the same bases are inside a 93-codon ORF that
  // starts at the CAT on the right (ATG on the reverse strand) and stops at
  // the TTA on the left.
  const antisense = `${STOPS}TTA${ALA(40)}TAG${ALA(2)}${HIS6}${ALA(2)}TAG${ALA(40)}CAT${STOPS}`;

  it('is found in the translation, and dropped from what is offered', () => {
    const found = detectProteinFeatures(antisense, 'linear', lib);
    expect(found).toHaveLength(1);
    const hit = onlyHit(antisense);
    expect(hit.strand).toBe('forward');
    expect(orfsAcross(antisense, hit, 'reverse').map((o) => o.codons)).toEqual([93]);
    expect(orfsAcross(antisense, hit, 'forward')).toEqual([]);
    expect(readsAntisense(hit, codes(antisense), 'linear')).toBe(true);
    expect(tags(antisense)).toEqual([]);
  });

  it('drops the glycine-linker case, a His run on the strand opposite a long CDS', () => {
    // A 217-codon CDS whose middle reads ...S S S V×8 S S S... and whose
    // other strand reads TAA A A A H×8 A A A TAA there: eight histidines in
    // a 14-codon frame with no start.
    const lib8: FeatureLibrary = { parts: [part('8xHis', 'HHHHHHHH')] };
    const cds = `ATG${ALA(100)}TTA${'AGC'.repeat(3)}${'GTG'.repeat(8)}${'AGC'.repeat(3)}TTA${ALA(100)}TAA`;
    const sequence = `${STOPS}${cds}${STOPS}`;
    expect(translate(cds).endsWith('*')).toBe(true);
    expect(translate(cds).slice(0, -1)).not.toContain('*');
    expect(detectProteinFeatures(sequence, 'linear', lib8)).toHaveLength(1);
    expect(detectFeatures(sequence, 'linear', lib8).filter((h) => h.viaProtein)).toEqual([]);
  });

  it('is dropped across the origin of a circle as well', () => {
    // The circle cut inside the His run, and again inside the ORF opposite.
    for (const cut of [STOPS.length + 3 + 120 + 3 + 6 + 9, STOPS.length + 60]) {
      const circle = antisense.slice(cut) + antisense.slice(0, cut);
      expect(detectProteinFeatures(circle, 'circular', lib)).toHaveLength(1);
      expect(tags(circle, 'circular')).toEqual([]);
    }
  });

  it('is kept where its own frame runs off a linear end: its start may lie beyond', () => {
    const offEnd = `TTA${ALA(2)}${HIS6}${ALA(2)}TAG${ALA(80)}CAT${STOPS}`;
    const hit = onlyHit(offEnd);
    expect(orfsAcross(offEnd, hit, 'reverse').map((o) => o.codons)).toEqual([92]);
    expect(tags(offEnd)).toHaveLength(1);
    // The same bases with stops before them, so the frame is closed there.
    expect(tags(`${STOPS}${offEnd}`)).toEqual([]);
  });

  it('is kept where the other strand is open but has no ATG to start an ORF', () => {
    const noStart = `${STOPS}TTA${ALA(40)}TAG${ALA(2)}${HIS6}${ALA(2)}TAG${ALA(40)}GCT${STOPS}`;
    expect(tags(noStart)).toHaveLength(1);
  });

  it('is kept where the ORF opposite is shorter than the ORF view shows', () => {
    // 1 + 20 + 1 + 2 + 6 + 2 + 1 + 20 = 53 codons.
    const short = `${STOPS}TTA${ALA(20)}TAG${ALA(2)}${HIS6}${ALA(2)}TAG${ALA(20)}CAT${STOPS}`;
    const hit = onlyHit(short);
    expect(findOrfs(short, 'linear', { minCodons: 0 }).some((o) => o.codons === 53)).toBe(true);
    expect(readsAntisense(hit, codes(short), 'linear')).toBe(false);
  });
});

describe('real tags stay (#285)', () => {
  it('keeps a His tag in its own short ORF, across a longer ORF on the other strand', () => {
    // The N-terminal His tag of an empty expression vector: ATG H×6 TAA on
    // the forward strand, inside a 109-codon ORF read the other way.
    const reverseOrf = `ATG${ALA(50)}TTA${'GTG'.repeat(6)}CAT${ALA(50)}TAA`;
    const sequence = `${STOPS}${reverseComplement(reverseOrf)}${STOPS}`;
    expect(sequence).toContain(`ATG${HIS6}TAA`);
    const hit = onlyHit(sequence);
    expect(orfsAcross(sequence, hit, 'reverse').map((o) => o.codons)).toEqual([109]);
    expect(tags(sequence)).toHaveLength(1);
  });

  it('keeps a tag read in frame at the end of a forward CDS', () => {
    const sequence = `${STOPS}ATG${ALA(100)}${HIS6}TAA${STOPS}`;
    expect(tags(sequence)).toHaveLength(1);
    expect(tags(reverseComplement(sequence))).toHaveLength(1);
  });

  it('keeps a tag with nothing on either strand to translate it', () => {
    expect(tags(`${STOPS}${ALA(5)}${HIS6}${ALA(5)}${STOPS}`)).toHaveLength(1);
  });

  it('keeps a tag without a start where its frame is open for an ORF’s length', () => {
    // A TEV site in frame with the protein after it, its start supplied by
    // cloning: 1 + 40 + 6 + 40 + 1 open codons and no ATG, opposite an
    // 87-codon ORF.
    const fusion = `${STOPS}TTA${ALA(40)}${HIS6}${ALA(40)}CAT${STOPS}`;
    const hit = onlyHit(fusion);
    expect(orfsAcross(fusion, hit, 'reverse').map((o) => o.codons)).toEqual([87]);
    expect(readsAntisense(hit, codes(fusion), 'linear')).toBe(false);
  });

  it('leaves hits on their bases alone, and takes nothing out of a list with no protein hit', () => {
    const dna: FeatureHit = {
      part: 0,
      range: { start: 0, end: 9 },
      strand: 'forward',
      mismatches: 0,
      ambiguous: 0,
      identity: 1,
    };
    expect(withoutAntisense([dna], 'ACGTACGTA', 'linear')).toEqual([dna]);
    expect(withoutAntisense([], '', 'circular')).toEqual([]);
  });
});
