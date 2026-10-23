import { describe, expect, it } from 'vitest';

import { createFeature, rangeSegment } from '../features';
import { type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { randomDna, seededRandom } from '@/test/random';
import { RUN_IN_BASES, inUseStrands } from './bidirectional';
import { detectFeatures } from './detect';
import { type FeatureLibrary, type LibraryPart, loadFeatureLibrary } from './library';

const rand = seededRandom(282);

/** Codons with no stop, so a frame of them is open. */
function openFrame(codons: number): string {
  const sense = ['GCT', 'GAA', 'AAA', 'CTG', 'GGC', 'TCT', 'CCG', 'ACC', 'GTT', 'CAG', 'ATC'];
  let out = '';
  for (let i = 0; i < codons; i++) out += sense[Math.floor(rand() * sense.length)] ?? 'GCT';
  return out;
}

/** Bases with no stop codon in any frame of either strand. */
function spacer(bases: number): string {
  return 'C'.repeat(bases);
}

// A bidirectional element: `late` holds `early` whole on its other strand,
// as the SV40 late poly(A) signal holds the early one.
const EARLY = randomDna(rand, 75);
const LATE = randomDna(rand, 60) + reverseComplement(EARLY) + randomDna(rand, 87);
const GENE = 'ATG' + openFrame(120) + 'TAA';

function part(name: string, sequence: string, type: string, extra = {}): LibraryPart {
  return {
    name,
    type,
    category: 'other',
    sequence,
    accession: 'X00000.1',
    location: `1..${sequence.length}`,
    source: 'core',
    ...extra,
  };
}

const LIB: FeatureLibrary = {
  parts: [
    part('late', LATE, 'polyA_signal', { complementOf: 'early' }),
    part('early', EARLY, 'polyA_signal'),
    part('gene', GENE, 'CDS'),
  ],
};

/** What is offered on `sequence`, as name and strand, after the rule. */
function offered(
  sequence: string,
  topology: Topology = 'linear',
  annotated: Parameters<typeof inUseStrands>[3] = [],
  lib: FeatureLibrary = LIB,
): string[] {
  const found = detectFeatures(sequence, topology, lib).flatMap((hit) => {
    const p = lib.parts[hit.part];
    return p === undefined ? [] : [{ hit, part: p }];
  });
  return inUseStrands(found, sequence, topology, annotated).map(
    (d) => `${d.part.name} ${d.hit.strand}`,
  );
}

describe('inUseStrands (#282)', () => {
  it('offers the late strand alone where a gene on it runs into the element', () => {
    const seq = spacer(40) + GENE + spacer(30) + LATE + spacer(40);
    expect(offered(seq)).toEqual(['gene forward', 'late forward']);
  });

  it('offers the early strand alone where a gene on it runs into the element', () => {
    // The gene on the reverse strand, upstream of the early signal there.
    const seq = spacer(40) + LATE + spacer(30) + reverseComplement(GENE) + spacer(40);
    expect(offered(seq)).toEqual(['early reverse', 'gene reverse']);
  });

  it('offers the generic early label alone where no gene runs into either strand', () => {
    const seq = spacer(40) + LATE + spacer(40);
    expect(offered(seq)).toEqual(['early reverse']);
    // A gene too far upstream runs into nothing.
    const far = spacer(40) + GENE + spacer(RUN_IN_BASES + 1) + LATE + spacer(40);
    expect(offered(far)).toEqual(['gene forward', 'early reverse']);
    const near = spacer(40) + GENE + spacer(RUN_IN_BASES) + LATE + spacer(40);
    expect(offered(near)).toEqual(['gene forward', 'late forward']);
  });

  it('offers both where a gene runs into each strand', () => {
    const seq = spacer(40) + GENE + spacer(30) + LATE + spacer(30) + reverseComplement(GENE);
    expect(offered(seq)).toEqual(['gene forward', 'late forward', 'early reverse', 'gene reverse']);
  });

  it('counts a gene whose stop codon lies inside the signal', () => {
    // The late signal begins with the gene's stop codon.
    const late = 'TAA' + LATE.slice(3);
    const lib: FeatureLibrary = {
      parts: [
        part('late', late, 'polyA_signal', { complementOf: 'early' }),
        part('early', EARLY, 'polyA_signal'),
        part('gene', GENE, 'CDS'),
      ],
    };
    const seq = spacer(40) + GENE.slice(0, -3) + late + spacer(40);
    expect(offered(seq, 'linear', [], lib)).toEqual(['gene forward', 'late forward']);
  });

  it("follows a part's frame on to the stop of the gene that carries it", () => {
    // A part that is the start of a longer gene (the TetR of an rtTA, a tag
    // before an insert): its frame runs on 200 codons before it stops, so
    // its own end is 633 bases from the signal and the gene's stop 30.
    const start = 'ATG' + openFrame(60);
    const lib: FeatureLibrary = {
      parts: [
        part('late', LATE, 'polyA_signal', { complementOf: 'early' }),
        part('early', EARLY, 'polyA_signal'),
        part('start', start, 'CDS'),
      ],
    };
    const gene = start + openFrame(200) + 'TGA';
    const seq = spacer(40) + gene + spacer(30) + LATE + spacer(40);
    expect(offered(seq, 'linear', [], lib)).toEqual(['start forward', 'late forward']);
  });

  it('counts a CDS the document annotates, and only a CDS', () => {
    const seq = spacer(40) + openFrame(100) + spacer(30) + LATE + spacer(40);
    const annotated = (type: string, strand: 'forward' | 'reverse', start: number, end: number) =>
      createFeature({ type, name: 'x', strand, segments: [rangeSegment(start, end)] });
    expect(offered(seq, 'linear', [annotated('CDS', 'forward', 40, 340)])).toEqual([
      'late forward',
    ]);
    expect(offered(seq, 'linear', [annotated('misc_feature', 'forward', 40, 340)])).toEqual([
      'early reverse',
    ]);
    // On the reverse strand a CDS's 3′ end is its start: one there, after a
    // gene that runs into the late strand, puts the early strand in use too.
    const both = spacer(40) + GENE + spacer(30) + LATE + spacer(30) + openFrame(100) + spacer(40);
    const from = 40 + GENE.length + 30 + LATE.length + 30;
    expect(offered(both, 'linear', [annotated('CDS', 'reverse', from, from + 300)])).toEqual([
      'gene forward',
      'late forward',
      'early reverse',
    ]);
  });

  it('works through the origin of a circle', () => {
    const seq = spacer(40) + GENE + spacer(30) + LATE + spacer(40);
    for (const cut of [0, 50, 40 + GENE.length + 10, 40 + GENE.length + 100, seq.length - 20]) {
      const rotated = seq.slice(cut) + seq.slice(0, cut);
      expect(offered(rotated, 'circular').sort(), `cut at ${cut}`).toEqual([
        'gene forward',
        'late forward',
      ]);
    }
  });

  it('leaves a gene cut off at its 3′ end by a linear end out of it', () => {
    // Only the gene's start is there; the element is not, so nothing changes.
    const seq = spacer(40) + GENE.slice(0, 200);
    expect(offered(seq)).toEqual(['gene forward']);
    // A late signal alone, with no early part over it, is left as found.
    const lone: FeatureLibrary = {
      parts: [part('late', LATE, 'polyA_signal', { complementOf: 'nothing' })],
    };
    expect(offered(spacer(40) + LATE + spacer(40), 'linear', [], lone)).toEqual(['late forward']);
  });
});

describe('the SV40 poly(A) signals of the bundled library (#282)', () => {
  it('pairs the late signal with the early one it holds on its other strand', async () => {
    const lib = await loadFeatureLibrary();
    const late = lib.parts.find((p) => p.name === 'SV40 late poly(A) signal');
    const early = lib.parts.find((p) => p.name === 'SV40 poly(A) signal');
    expect(late?.complementOf).toBe('SV40 poly(A) signal');
    expect(reverseComplement(late?.sequence ?? '').indexOf(early?.sequence ?? '-')).toBe(91);
    expect(lib.parts.filter((p) => p.complementOf !== undefined)).toHaveLength(1);
  });
});
