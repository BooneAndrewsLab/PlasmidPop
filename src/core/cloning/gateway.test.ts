import { type Segment, SeqDocument, createFeature, rangeSegment, siteSegment } from '@/core';

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

  it('names the sites that do not pair, and warns of nothing', () => {
    const odd = molecule(
      'pOdd',
      'P',
      { text: filler(400, 77), name: 'ccdB' },
      { text: filler(900, 88), name: 'kanR' },
    );
    const renumbered = odd.updateFeature(must(attSites(odd)[1], 'a second att site').feature.id, {
      name: 'attP3',
    });
    const run = gateway(substrate, renumbered, 'BP');
    expect(run.problem).toBe(
      'The sites do not pair: pEntrySource has attB1 and attB2, pOdd has attP1 and attP3. Each number recombines only with its own.',
    );
    expect(run.warnings).toEqual([]);
    expect(run.product).toBeNull();
  });
});

/** A circle of the given stretches; an `att…` label is a site, any other a CDS. */
function circle(name: string, stretches: readonly (readonly [string, string?])[]): SeqDocument {
  let at = 0;
  const features = [];
  for (const [text, label] of stretches) {
    if (label !== undefined) {
      features.push(
        createFeature({
          type: label.trim().startsWith('att') ? 'protein_bind' : 'CDS',
          name: label,
          segments: [rangeSegment(at, at + text.length)],
        }),
      );
    }
    at += text.length;
  }
  return SeqDocument.create({
    name,
    topology: 'circular',
    sequence: stretches.map(([text]) => text).join(''),
    features,
  });
}

describe('attSites (#77)', () => {
  it('passes over a feature named like a site that marks only a point between bases', () => {
    const doc = SeqDocument.create({
      sequence: filler(100, 1),
      features: [
        createFeature({ type: 'protein_bind', name: 'attP1', segments: [siteSegment(10)] }),
        createFeature({ type: 'protein_bind', name: 'attP2', segments: [rangeSegment(20, 40)] }),
      ],
    });
    expect(attSites(doc).map((s) => [s.kind, s.number, s.range])).toEqual([
      ['P', '2', { start: 20, end: 40 }],
    ]);
  });
});

describe('the circles a reaction makes (#77)', () => {
  it('names both circles and says what they are, unless given a name', () => {
    const run = gateway(substrate, donor, 'BP');
    const product = must(run.product, 'a product');
    const byproduct = must(run.byproduct, 'a byproduct');
    expect(product.name).toBe('pEntrySource × pDONR BP');
    expect(product.metadata.description).toBe(
      'Entry clone from a BP reaction of pEntrySource and pDONR: attL1 and attL2',
    );
    expect(product.metadata.moleculeType).toBe('DNA');
    expect(product.metadata.division).toBe('SYN');
    expect(byproduct.name).toBe('pEntrySource × pDONR BP byproduct');
    expect(byproduct.metadata.description).toBe(
      'Byproduct of the BP reaction of pEntrySource and pDONR: attR1 and attR2',
    );

    const named = gateway(substrate, donor, 'BP', { name: 'pENTR-gene' });
    expect(named.product?.name).toBe('pENTR-gene');
    expect(named.byproduct?.name).toBe('pENTR-gene byproduct');

    const lr = gateway(product, destination, 'LR');
    expect(lr.product?.metadata.description).toBe(
      'Expression clone from a LR reaction of pEntrySource × pDONR BP and pDEST: attB2 and attB1',
    );
  });

  it('says exactly what it warns of, for a BP and for an LR', () => {
    const bp = gateway(substrate, donor, 'BP');
    expect(bp.warnings).toEqual([
      'The ccdB cassette of pDONR leaves on the byproduct, so an entry clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.',
      'One pair shares only 7 bases, shorter than a full att core: check the sites are annotated over their whole length.',
      'One pair shares only 7 bases, shorter than a full att core: check the sites are annotated over their whole length.',
      'gene and kanR are 47 bases apart across attL2, which is not a multiple of three, so the fusion is out of frame.',
      'kanR and gene are 47 bases apart across attL1, which is not a multiple of three, so the fusion is out of frame.',
    ]);
    const lr = gateway(must(bp.product, 'an entry clone'), destination, 'LR');
    expect(lr.warnings[0]).toBe(
      'The ccdB cassette of pDEST leaves on the byproduct, so an expression clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.',
    );
  });

  it('drops the parents’ half sites even when their names carry spaces', () => {
    const [b1, b2] = attSites(substrate);
    const padded = substrate
      .updateFeature(must(b1, 'attB1').feature.id, { name: ' attB1' })
      .updateFeature(must(b2, 'attB2').feature.id, { name: 'attB2 ' });
    const run = gateway(padded, donor, 'BP');
    expect(names(must(run.product, 'a product'))).toEqual(['attL1', 'attL2', 'gene', 'kanR']);
  });

  it('keeps the circle the crossover makes when no circle carries ccdB', () => {
    const plain = molecule(
      'pPlain',
      'P',
      { text: filler(900, 33), name: 'stuffer' },
      { text: filler(1500, 44), name: 'kanR' },
    );
    const run = gateway(substrate, plain, 'BP');
    expect(names(must(run.product, 'a product'))).toEqual(['attL1', 'attL2', 'gene', 'kanR']);
    expect(names(must(run.byproduct, 'a byproduct'))).toEqual([
      'ampR',
      'attR1',
      'attR2',
      'stuffer',
    ]);
  });

  it('keeps the same circle when both circles carry ccdB, since selection cannot tell them apart', () => {
    const ccdbInsert = molecule(
      'pToxic',
      'B',
      { text: GENE.text, name: 'ccdB' },
      { text: filler(1200, 22), name: 'ampR' },
    );
    const run = gateway(ccdbInsert, donor, 'BP');
    expect(names(must(run.product, 'a product'))).toEqual(['attL1', 'attL2', 'ccdB', 'kanR']);
    expect(names(must(run.byproduct, 'a byproduct'))).toEqual(['ampR', 'attR1', 'attR2', 'ccdB']);
  });

  it('finds a core that runs to the last base of both sites', () => {
    // attB1 and attP1 end with their core: the shared stretch is the last
    // seven bases of each, and six would not do.
    const insert = circle('pEnd', [
      [ARMS.B[0] + CORE[1], 'attB1'],
      [GENE.text, 'gene'],
      [site('B', 2), 'attB2'],
      [filler(1200, 22), 'ampR'],
    ]);
    const vector = circle('pEndDonor', [
      [ARMS.P[0] + CORE[1], 'attP1'],
      [filler(900, 33), 'ccdB'],
      [site('P', 2), 'attP2'],
      [filler(1500, 44), 'kanR'],
    ]);
    const run = gateway(insert, vector, 'BP');
    expect(run.problem).toBeNull();
    // Read twice round, since attL1 may wrap the origin.
    const text = must(run.product, 'a product').sequence.toString();
    expect(text + text).toContain(ARMS.P[0] + CORE[1] + GENE.text);
  });
});

/**
 * A destination whose backbone ends two bases before attR1, carrying
 * `tags` over that stretch, so the LR of the entry clone puts them 49 bases
 * ahead of the gene (47 of attB1, and the two).
 */
function taggedDestination(
  tags: readonly { readonly name: string; readonly type?: string; readonly segments: Segment[] }[],
): SeqDocument {
  const one = site('R', 1);
  const two = site('R', 2);
  const sequence = filler(300, 5) + 'AA' + one + filler(500, 6) + two + filler(400, 9);
  return SeqDocument.create({
    name: 'pTag',
    topology: 'circular',
    sequence,
    features: [
      ...tags.map((t) =>
        createFeature({ type: t.type ?? 'CDS', name: t.name, segments: t.segments }),
      ),
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
}

describe('fusions out of frame (#77)', () => {
  const acrossB1 = (tags: Parameters<typeof taggedDestination>[0]): string[] => {
    const entry = must(gateway(substrate, donor, 'BP').product, 'an entry clone');
    const run = gateway(entry, taggedDestination(tags), 'LR');
    expect(run.problem).toBeNull();
    return run.warnings.filter((w) => w.includes('across attB1'));
  };
  const outOfFrame = (tag: string, gap: number): string =>
    `${tag} and gene are ${gap} bases apart across attB1, which is not a multiple of three, so the fusion is out of frame.`;

  it('reads only a CDS as a fusion partner', () => {
    expect(acrossB1([{ name: 'His6', segments: [rangeSegment(0, 300)] }])).toEqual([
      outOfFrame('His6', 49),
    ]);
    expect(
      acrossB1([{ name: 'His6', type: 'misc_feature', segments: [rangeSegment(0, 300)] }]),
    ).toEqual([]);
  });

  it('calls an unnamed CDS a CDS', () => {
    expect(acrossB1([{ name: '', segments: [rangeSegment(0, 300)] }])).toEqual([
      outOfFrame('CDS', 49),
    ]);
  });

  it('ends a CDS at its last range, and passes over one that is only a point', () => {
    expect(
      acrossB1([
        { name: 'His6', segments: [rangeSegment(0, 300), siteSegment(150)] },
        { name: 'marker', segments: [siteSegment(100)] },
      ]),
    ).toEqual([outOfFrame('His6', 49)]);
  });

  it('takes the nearest CDS as the partner, and the first of two as near', () => {
    // Myc starts later but ends further from the site: His6 is the partner.
    expect(
      acrossB1([
        { name: 'His6', segments: [rangeSegment(0, 300)] },
        { name: 'Myc', segments: [rangeSegment(250, 295)] },
      ]),
    ).toEqual([outOfFrame('His6', 49)]);
    expect(
      acrossB1([
        { name: 'His6', segments: [rangeSegment(0, 300)] },
        { name: 'Tag', segments: [rangeSegment(200, 300)] },
      ]),
    ).toEqual([outOfFrame('His6', 49)]);
  });

  it('says nothing of a CDS that meets one of its own name across the site', () => {
    expect(acrossB1([{ name: 'gene', segments: [rangeSegment(0, 300)] }])).toEqual([]);
  });
});
