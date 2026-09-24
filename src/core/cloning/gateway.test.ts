import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { attSites, gateway } from './gateway';

/**
 * Synthetic att sites: two arms around a core. Nothing here is a real
 * Invitrogen sequence — what is being tested is the crossover, and the
 * crossover only needs partner sites to share a core (`gateway.ts`).
 */
const CORE = { 1: 'ACGTTGA', 2: 'TTCAGGC' } as const;
const ARMS = {
  B: ['CCTTAGGACTTCAAGGTCCA', 'GGATCCAAGTTCGATCTTGC'],
  P: ['TTACGCAAGGTTCCATGAAC', 'AACCGGTTACGGATTCCAAG'],
  R: ['GTTCCAAGGATCTTAGCCAT', 'CATTGGACCTTAAGGCATCG'],
} as const;

function site(kind: 'B' | 'P' | 'R', n: 1 | 2): string {
  return ARMS[kind][0] + CORE[n] + ARMS[kind][1];
}

/** Filler that shares nothing with the arms. */
function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

/**
 * A molecule as `[site n1][middle][site n2][rest]`, with the two sites
 * annotated and the middle and the rest named so the products can be told
 * apart.
 */
function molecule(
  name: string,
  kind: 'B' | 'P' | 'R',
  middle: { readonly text: string; readonly name: string },
  rest: { readonly text: string; readonly name: string },
): SeqDocument {
  const one = site(kind, 1);
  const two = site(kind, 2);
  const sequence = one + middle.text + two + rest.text;
  const at = (start: number, end: number, type: string, label: string) =>
    createFeature({ type, name: label, segments: [rangeSegment(start, end)] });
  return SeqDocument.create({
    name,
    topology: 'circular',
    sequence,
    features: [
      at(0, one.length, 'protein_bind', `att${kind}1`),
      at(one.length, one.length + middle.text.length, 'CDS', middle.name),
      at(
        one.length + middle.text.length,
        one.length + middle.text.length + two.length,
        'protein_bind',
        `att${kind}2`,
      ),
      at(sequence.length - rest.text.length, sequence.length, 'CDS', rest.name),
    ],
  });
}

const GENE = { text: filler(600, 11), name: 'gene' };
const substrate = molecule('pEntrySource', 'B', GENE, { text: filler(1200, 22), name: 'ampR' });
const donor = molecule(
  'pDONR',
  'P',
  { text: filler(900, 33), name: 'ccdB' },
  { text: filler(1500, 44), name: 'kanR' },
);
const destination = molecule(
  'pDEST',
  'R',
  { text: filler(800, 55), name: 'ccdB' },
  { text: filler(1700, 66), name: 'specR' },
);

/** The codebase forbids `!`, and a missing product is a test failure worth a sentence. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const names = (doc: SeqDocument): string[] =>
  doc.features
    .all()
    .map((f) => f.name)
    .sort();

describe('attSites', () => {
  it('reads the sites a document annotates, and ignores everything else', () => {
    expect(attSites(donor).map((s) => `${s.kind}${s.number}`)).toEqual(['P1', 'P2']);
    expect(attSites(SeqDocument.create({ sequence: 'ACGT' }))).toEqual([]);
  });
});

describe('BP', () => {
  // Run in each test, not once for the block: work done while the file
  // loads cannot be told apart per test by mutation testing (#77).
  const bp = (): ReturnType<typeof gateway> => gateway(substrate, donor, 'BP');

  it('moves the gene into an entry clone and sends ccdB to the byproduct', () => {
    const run = bp();
    expect(run.problem).toBeNull();
    expect(names(must(run.product, 'a product'))).toEqual(['attL1', 'attL2', 'gene', 'kanR']);
    expect(names(must(run.byproduct, 'a byproduct'))).toEqual(['ampR', 'attR1', 'attR2', 'ccdB']);
    // The gene is whole in the entry clone.
    expect(must(run.product, 'a product').sequence.toString()).toContain(GENE.text);
    // Both circles together hold every base the two parents had.
    expect(must(run.product, 'a product').length + must(run.byproduct, 'a byproduct').length).toBe(
      substrate.length + donor.length,
    );
  });

  it('builds the recombinant sites out of one arm from each parent', () => {
    const run = bp();
    const entry = must(run.product, 'a product');
    const l1 = must(
      attSites(entry).find((s) => s.number === '1'),
      'attL1 on the entry clone',
    );
    const text = entry.subsequence(l1.range).toUpperCase();
    expect(text).toContain(CORE[1]);
    // attL1 is the donor's left arm and the substrate's right arm.
    expect(text.startsWith(ARMS.P[0])).toBe(true);
    expect(text.endsWith(ARMS.B[1])).toBe(true);
  });

  it('warns that the byproduct carries ccdB', () => {
    const run = bp();
    expect(run.warnings.join(' ')).toMatch(/ccdB cassette of pDONR leaves on the byproduct/);
  });
});

describe('LR', () => {
  it('takes the entry clone on into an expression clone carrying attB sites', () => {
    const entry = must(gateway(substrate, donor, 'BP').product, 'an entry clone');
    const run = gateway(entry, destination, 'LR');
    expect(run.problem).toBeNull();
    expect(names(must(run.product, 'a product'))).toEqual(['attB1', 'attB2', 'gene', 'specR']);
    expect(names(must(run.byproduct, 'a byproduct'))).toEqual(['attP1', 'attP2', 'ccdB', 'kanR']);
    expect(must(run.product, 'a product').sequence.toString()).toContain(GENE.text);
  });
});

describe('a linear attB substrate', () => {
  it('goes in, and leaves no byproduct circle: its flanks are lost', () => {
    const one = site('B', 1);
    const two = site('B', 2);
    const text = filler(60, 7) + one + GENE.text + two + filler(60, 8);
    const amplicon = SeqDocument.create({
      name: 'attB-PCR',
      sequence: text,
      features: [
        createFeature({
          type: 'protein_bind',
          name: 'attB1',
          segments: [rangeSegment(60, 60 + one.length)],
        }),
        createFeature({
          type: 'protein_bind',
          name: 'attB2',
          segments: [
            rangeSegment(
              60 + one.length + GENE.text.length,
              60 + one.length + GENE.text.length + two.length,
            ),
          ],
        }),
      ],
    });
    const run = gateway(amplicon, donor, 'BP');
    expect(run.problem).toBeNull();
    expect(must(run.product, 'a product').sequence.toString()).toContain(GENE.text);
    expect(run.byproduct).toBeNull();
    // The 60 bases outside each site are gone.
    expect(must(run.product, 'a product').sequence.toString()).not.toContain(filler(60, 7));
  });
});

describe('what it refuses', () => {
  it('will not run a BP against a destination vector', () => {
    expect(gateway(substrate, destination, 'BP').problem).toMatch(
      /pDEST has no attP site annotated/,
    );
  });

  it('says so when the numbers do not pair', () => {
    const odd = molecule(
      'pOdd',
      'P',
      { text: filler(400, 77), name: 'ccdB' },
      { text: filler(900, 88), name: 'kanR' },
    ).rename('pOdd');
    const renumbered = odd.updateFeature(must(attSites(odd)[1], 'a second att site').feature.id, {
      name: 'attP3',
    });
    expect(gateway(substrate, renumbered, 'BP').problem).toMatch(/do not pair/);
  });

  it('warns when a tag in the backbone reads out of frame through an att site', () => {
    // A destination whose His6 stops two bases before attR1. The att site
    // is 47 bases, so the tag and the insert end up 49 apart: not a
    // multiple of three, and the fusion is broken.
    const one = site('R', 1);
    const two = site('R', 2);
    const sequence = filler(300, 5) + 'AA' + one + filler(500, 6) + two + filler(400, 9);
    const tagged = SeqDocument.create({
      name: 'pTag',
      topology: 'circular',
      sequence,
      features: [
        createFeature({ type: 'CDS', name: 'His6', segments: [rangeSegment(0, 300)] }),
        createFeature({
          type: 'protein_bind',
          name: 'attR1',
          segments: [rangeSegment(302, 302 + one.length)],
        }),
        createFeature({
          type: 'CDS',
          name: 'ccdB',
          segments: [rangeSegment(302 + one.length, 302 + one.length + 500)],
        }),
        createFeature({
          type: 'protein_bind',
          name: 'attR2',
          segments: [rangeSegment(302 + one.length + 500, 302 + one.length + 500 + two.length)],
        }),
      ],
    });
    const entry = must(gateway(substrate, donor, 'BP').product, 'an entry clone');
    const run = gateway(entry, tagged, 'LR');
    expect(run.problem).toBeNull();
    expect(run.warnings.join(' ')).toMatch(
      /His6 and gene are \d+ bases apart across attB1, which is not a multiple of three/,
    );
  });

  it('says so when two labelled partners share no core', () => {
    const impostor = SeqDocument.create({
      name: 'pFake',
      topology: 'circular',
      sequence: filler(300, 99) + filler(300, 111) + filler(300, 123),
      features: [
        createFeature({ type: 'protein_bind', name: 'attP1', segments: [rangeSegment(0, 40)] }),
        createFeature({ type: 'protein_bind', name: 'attP2', segments: [rangeSegment(400, 440)] }),
      ],
    });
    expect(gateway(substrate, impostor, 'BP').problem).toMatch(/share no core of 7 bases/);
  });
});
