import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { detectFeatures } from './detect';
import { describeMatch, featureFromHit } from './hits';
import { detectHomologues, bitScore, homologueThreshold } from './homologue';
import { type FeatureLibrary, type LibraryPart, codingProtein, parseLibraryFile } from './library';
import { myPartToLibraryPart } from './myParts';
import { reverseComplement } from '@/core';

function bundled(): FeatureLibrary {
  const read = (f: string): string =>
    readFileSync(new URL(`./data/${f}.json`, import.meta.url), 'utf8');
  return {
    parts: [
      ...parseLibraryFile(read('core-parts'), 'core'),
      ...parseLibraryFile(read('fpbase'), 'fpbase'),
    ],
  };
}

/** A small deterministic generator, so the variants are the same every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CODONS: Record<string, readonly string[]> = {
  A: ['GCT', 'GCC', 'GCA', 'GCG'],
  C: ['TGT', 'TGC'],
  D: ['GAT', 'GAC'],
  E: ['GAA', 'GAG'],
  F: ['TTT', 'TTC'],
  G: ['GGT', 'GGC', 'GGA', 'GGG'],
  H: ['CAT', 'CAC'],
  I: ['ATT', 'ATC', 'ATA'],
  K: ['AAA', 'AAG'],
  L: ['TTA', 'TTG', 'CTT', 'CTC', 'CTA', 'CTG'],
  M: ['ATG'],
  N: ['AAT', 'AAC'],
  P: ['CCT', 'CCC', 'CCA', 'CCG'],
  Q: ['CAA', 'CAG'],
  R: ['CGT', 'CGC', 'CGA', 'CGG', 'AGA', 'AGG'],
  S: ['TCT', 'TCC', 'TCA', 'TCG', 'AGT', 'AGC'],
  T: ['ACT', 'ACC', 'ACA', 'ACG'],
  V: ['GTT', 'GTC', 'GTA', 'GTG'],
  W: ['TGG'],
  Y: ['TAT', 'TAC'],
};
const RESIDUES = Object.keys(CODONS);

/** The protein in codons chosen at random: a plasmid recoded for another host. */
function recode(protein: string, next: () => number): string {
  return Array.from(protein, (aa) => {
    const options = CODONS[aa] ?? ['NNN'];
    return options[Math.floor(next() * options.length)] ?? 'NNN';
  }).join('');
}

/** `protein` with this share of its residues replaced, and a few residues inserted and deleted. */
function diverge(protein: string, share: number, next: () => number, indels = 0): string {
  let out = Array.from(protein, (aa) =>
    next() < share ? (RESIDUES[Math.floor(next() * RESIDUES.length)] ?? aa) : aa,
  );
  for (let k = 0; k < indels; k++) {
    const at = 30 + Math.floor(next() * (out.length - 60));
    if (k % 2 === 0) out.splice(at, 3);
    else out.splice(at, 0, 'G', 'S');
  }
  out = out.filter((c) => c !== '*');
  return out.join('');
}

function randomDna(length: number, next: () => number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += 'ACGT'.charAt(Math.floor(next() * 4));
  return s;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const library = bundled();
const find = (name: string): { part: LibraryPart; index: number } => {
  const index = library.parts.findIndex((p) => p.name === name);
  const part = library.parts[index];
  if (part === undefined) throw new Error(`no part ${name}`);
  return { part, index };
};

describe('every CDS part has a protein (#219)', () => {
  it('reads it off the bases of each CDS of the bundled list', () => {
    const cds = library.parts.filter((p) => p.type === 'CDS' && p.sequence !== '');
    expect(cds.length).toBeGreaterThan(50);
    const without = cds.filter((p) => p.protein === undefined).map((p) => p.name);
    // The few that are not whole codons with no stop are the exception, not the rule.
    expect(without.length).toBeLessThan(5);
    expect(find('AmpR').part.protein?.startsWith('MSIQHFRVALIPFFAAFCLPVFA')).toBe(true);
    expect(find('NeoR/KanR (Tn5)').part.protein).toBeDefined();
  });

  it('drops a closing stop, and refuses a stop inside or a partial codon', () => {
    const orf = 'ATGAAAGGGCCCTTTAAAGGGCCCTTT';
    expect(codingProtein('CDS', `${orf}TAA`)).toBe('MKGPFKGPF');
    expect(codingProtein('CDS', `${orf}TAATTT`)).toBeUndefined();
    expect(codingProtein('CDS', `${orf}G`)).toBeUndefined();
    expect(codingProtein('promoter', orf)).toBeUndefined();
    expect(codingProtein('CDS', 'ATGAAA')).toBeUndefined();
  });

  it('gives a CDS of My parts a protein too', () => {
    const mine = myPartToLibraryPart({
      id: '1',
      name: 'myKan',
      type: 'CDS',
      sequence: find('NeoR/KanR (Tn5)').part.sequence,
      notes: '',
      origin: 'My parts',
    });
    expect(mine.protein).toBe(find('NeoR/KanR (Tn5)').part.protein);
  });
});

describe('homologues', () => {
  const ampR = find('AmpR');
  const protein = ampR.part.protein ?? '';

  function plasmid(coding: string, seed = 7): string {
    const next = rng(seed);
    return randomDna(1500, next) + coding + randomDna(1500, next);
  }

  it('finds a diverged, recoded copy as similar, with its identity and coverage', () => {
    const next = rng(11);
    const variant = diverge(protein, 0.25, next, 4);
    const dna = plasmid(recode(variant, next));
    const hits = detectHomologues(dna, 'circular', library).filter((h) => h.part === ampR.index);
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit?.strand).toBe('forward');
    expect(hit?.identity).toBeGreaterThan(0.6);
    expect(hit?.identity).toBeLessThan(0.9);
    expect(hit?.similar?.coverage).toBeGreaterThan(0.9);
    expect(hit?.range.start).toBeGreaterThanOrEqual(1500 - 10);
    expect(hit?.range.start).toBeLessThanOrEqual(1500 + 30);
    expect(describeMatch(must(hit))).toMatch(/^similar protein: \d+/);
  });

  it('finds it on the reverse strand', () => {
    const next = rng(12);
    const variant = diverge(protein, 0.2, next, 2);
    const dna = plasmid(reverseComplement(recode(variant, next)));
    const hit = detectHomologues(dna, 'linear', library).find((h) => h.part === ampR.index);
    expect(hit?.strand).toBe('reverse');
  });

  it('finds it through the origin of a circle', () => {
    const next = rng(13);
    const coding = recode(diverge(protein, 0.2, next), next);
    const cut = 400;
    const dna = coding.slice(cut) + randomDna(2000, next) + coding.slice(0, cut);
    const hit = detectHomologues(dna, 'circular', library).find((h) => h.part === ampR.index);
    expect(hit).toBeDefined();
    expect(hit?.range.end).toBeGreaterThan(dna.length);
  });

  it('finds a recoded copy that is identical in protein', () => {
    const next = rng(14);
    const dna = plasmid(recode(protein, next));
    const hits = detectFeatures(dna, 'circular', library);
    const ampHits = hits.filter((h) => h.part === ampR.index);
    expect(ampHits).toHaveLength(1);
    // The part itself, found by its protein: not a "similar to".
    expect(ampHits[0]?.similar).toBeUndefined();
    expect(describeMatch(must(ampHits[0]))).toBe('exact protein match');
  });

  it('labels a homologue "similar to", never as the part', () => {
    const next = rng(15);
    const dna = plasmid(recode(diverge(protein, 0.3, next, 2), next));
    const hit = detectFeatures(dna, 'circular', library).find(
      (h) => h.part === ampR.index && h.similar !== undefined,
    );
    expect(hit).toBeDefined();
    const feature = featureFromHit(must(hit), ampR.part);
    expect(feature.name).toBe('similar to AmpR');
    const notes = feature.qualifiers.filter((q) => q.name === 'note').map((q) => q.value);
    expect(notes.join(' ')).toMatch(/similar protein: .* identical over .* of the part's protein/);
  });

  it('can be switched off', () => {
    const next = rng(16);
    const dna = plasmid(recode(diverge(protein, 0.3, next), next));
    const off = detectFeatures(dna, 'circular', library, { homologues: false });
    expect(off.some((h) => h.similar !== undefined)).toBe(false);
    const on = detectFeatures(dna, 'circular', library);
    expect(on.some((h) => h.similar !== undefined)).toBe(true);
    // Homologues are made in the translation, so a search without that has none either.
    const noProtein = detectFeatures(dna, 'circular', library, { protein: false });
    expect(noProtein.some((h) => h.similar !== undefined || h.viaProtein === true)).toBe(false);
  });

  it('finds a diverged copy of a My parts CDS', () => {
    const next = rng(17);
    const mine = myPartToLibraryPart({
      id: '1',
      name: 'my enzyme',
      type: 'CDS',
      sequence: recode(protein, next),
      notes: '',
      origin: 'My parts',
    });
    const lib: FeatureLibrary = { parts: [mine] };
    const dna = plasmid(recode(diverge(protein, 0.3, next, 2), next));
    const hits = detectFeatures(dna, 'circular', lib);
    expect(hits.some((h) => h.similar !== undefined && h.part === 0)).toBe(true);
  });

  it('does not offer a similar hit over a part of the same type already found', () => {
    const next = rng(18);
    const dna = plasmid(recode(protein, next));
    const hits = detectFeatures(dna, 'circular', library);
    expect(hits.filter((h) => h.similar !== undefined && h.part !== ampR.index)).toEqual([]);
  });

  it('finds no homologue in unrelated sequence', () => {
    for (const seed of [1, 2, 3]) {
      const dna = randomDna(10_000, rng(seed * 101));
      expect(detectHomologues(dna, 'circular', library)).toEqual([]);
    }
  });

  it('finds no homologue of an unrelated protein, however it is spelled', () => {
    const next = rng(21);
    // A random protein of the same composition: no relative of any part.
    const shuffled = Array.from(protein)
      .sort(() => next() - 0.5)
      .join('');
    const dna = plasmid(recode(shuffled, next));
    expect(detectHomologues(dna, 'circular', library)).toEqual([]);
  });

  it('holds short proteins and fluorescent proteins to higher floors', () => {
    const base = homologueThreshold({ source: 'core' }, 300);
    expect(homologueThreshold({ source: 'core' }, 100).identity).toBeGreaterThan(base.identity);
    expect(homologueThreshold({ source: 'fpbase' }, 300).identity).toBeGreaterThan(base.identity);
  });

  it('scores in bits as the published statistics do', () => {
    expect(bitScore(100)).toBeCloseTo((0.267 * 100 - Math.log(0.041)) / Math.LN2, 10);
  });

  it('is fast: a 10 kb plasmid against the whole library', () => {
    const next = rng(31);
    const dna = randomDna(5000, next) + recode(diverge(protein, 0.25, next, 2), next);
    const dna10 = dna + randomDna(10_000 - dna.length, next);
    const t0 = performance.now();
    const hits = detectHomologues(dna10, 'circular', library);
    const ms = performance.now() - t0;
    expect(hits.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });
});

describe('which homologue is offered (mutation survivors)', () => {
  const base = find('AmpR').part.protein ?? '';
  const parts = (...proteins: string[]): FeatureLibrary => ({
    parts: proteins.map((protein, i) => ({
      name: `P${i}`,
      type: 'CDS',
      category: 'marker',
      sequence: '',
      protein,
      accession: 'X00000.1',
      location: '1..1',
      source: 'core',
    })),
  });
  /** A part found by its bases alone. */
  const dnaPart = (name: string, type: string, sequence: string): LibraryPart => ({
    name,
    type,
    category: 'marker',
    sequence,
    accession: 'X00000.1',
    location: '1..1',
    source: 'core',
  });
  const similarOf = (dna: string, lib: FeatureLibrary) =>
    detectFeatures(dna, 'circular', lib).filter((h) => h.similar !== undefined);

  function target(seed: number, share: number): { dna: string } {
    const next = rng(seed);
    const flank = randomDna(1500, next);
    const dna = flank + recode(diverge(base, share, next), next) + randomDna(1500, next);
    return { dna };
  }

  it('offers the closer of two parts similar to the same bases, whichever comes first', () => {
    const { dna } = target(41, 0.2);
    const near = diverge(base, 0.05, rng(5));
    const far = diverge(base, 0.25, rng(6));
    const nearFirst = similarOf(dna, parts(near, far));
    const farFirst = similarOf(dna, parts(far, near));
    expect(nearFirst.map((h) => h.part)).toEqual([0]);
    expect(farFirst.map((h) => h.part)).toEqual([1]);
  });

  it('offers the first of two parts that are equally similar', () => {
    const { dna } = target(42, 0.2);
    const same = diverge(base, 0.1, rng(7));
    expect(similarOf(dna, parts(same, same, same)).map((h) => h.part)).toEqual([0]);
  });

  it('is not hidden by a hit of another type over the same bases', () => {
    const { dna } = target(43, 0.2);
    const lib = parts(base);
    const [hit] = similarOf(dna, lib);
    if (hit === undefined) throw new Error('no homologue');
    const exact = dna.slice(hit.range.start, hit.range.end);
    const other = dnaPart('tag', 'misc_feature', exact);
    const hits = detectFeatures(dna, 'circular', { parts: [...lib.parts, other] });
    expect(hits.some((h) => h.part === 0 && h.similar !== undefined)).toBe(true);
  });

  it('is hidden by a hit of its type over half of it, and not by less', () => {
    const { dna } = target(44, 0.2);
    const lib = parts(base);
    const [hit] = similarOf(dna, lib);
    if (hit === undefined) throw new Error('no homologue');
    const size = hit.range.end - hit.range.start;
    const covering = (bases: number): FeatureLibrary => ({
      parts: [
        ...lib.parts,
        dnaPart('piece', 'CDS', dna.slice(hit.range.start, hit.range.start + bases)),
      ],
    });
    const half = Math.ceil(size / 2);
    const hidden = detectFeatures(dna, 'circular', covering(half));
    expect(hidden.some((h) => h.part === 0)).toBe(false);
    expect(hidden.some((h) => h.part === 1)).toBe(true);
    const shown = detectFeatures(dna, 'circular', covering(half - 1));
    expect(shown.some((h) => h.part === 0 && h.similar !== undefined)).toBe(true);
  });

  it('lists the homologue among the other hits by start, the longer first where they start together', () => {
    const { dna } = target(45, 0.2);
    const lib = parts(base);
    const [hit] = similarOf(dna, lib);
    if (hit === undefined) throw new Error('no homologue');
    const tag = (name: string, from: number, to: number): LibraryPart =>
      dnaPart(name, 'misc_feature', dna.slice(from, to));
    const order = (extra: LibraryPart): string[] =>
      detectFeatures(dna, 'circular', { parts: [...lib.parts, extra] }).map((h) =>
        h.part === 0 ? 'similar' : 'tag',
      );
    // A tag after the homologue starts: the homologue is listed first.
    expect(order(tag('late', hit.range.end - 60, hit.range.end))).toEqual(['similar', 'tag']);
    // A tag before it: the tag first.
    expect(order(tag('early', hit.range.start - 60, hit.range.start))).toEqual(['tag', 'similar']);
    // Both starting together: the longer, the homologue, first.
    expect(order(tag('same', hit.range.start, hit.range.start + 60))).toEqual(['similar', 'tag']);
  });
});
