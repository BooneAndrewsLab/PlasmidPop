import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';

import { gibson } from './gibson';
import { type PcrPrimer, pcr, primerDimers } from './pcr';

/** A fixed pseudo-random template, so every primer site is unique by accident. */
function template(length: number, seed = 20260922): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const TEXT = template(3000);
const LINEAR = SeqDocument.create({ name: 'strip', sequence: TEXT });
const PLASMID = SeqDocument.create({ name: 'pTest', sequence: TEXT, topology: 'circular' });

/** A primer that anneals to the top strand at [start, end). */
function fwd(start: number, end: number, tail = '', name = 'F'): PcrPrimer {
  return { name, sequence: tail + TEXT.slice(start, end) };
}

/** A primer that anneals to the bottom strand over the top strand's [start, end). */
function rev(start: number, end: number, tail = '', name = 'R'): PcrPrimer {
  return { name, sequence: tail + reverseComplement(TEXT.slice(start, end)) };
}

function one(result: ReturnType<typeof pcr>): string {
  expect(result.problem).toBeNull();
  expect(result.products).toHaveLength(1);
  return result.products[0]?.document.sequence.toString() ?? '';
}

describe('pcr', () => {
  it('copies the stretch between two primers', () => {
    const result = pcr(LINEAR, [fwd(100, 122), rev(500, 522)]);
    expect(one(result)).toBe(TEXT.slice(100, 522));
    const product = result.products[0];
    expect(product?.length).toBe(422);
    expect(product?.templateRange).toEqual({ start: 100, end: 522 });
    expect(product?.document.topology).toBe('linear');
  });

  it('carries the 5′ tails that anneal to nothing', () => {
    // What a cloning primer is: a site or a homology arm on the 5′ end, and
    // the template's own bases on the 3′ end.
    const result = pcr(LINEAR, [fwd(100, 122, 'GGATCC'), rev(500, 522, 'AAGCTT')]);
    expect(one(result)).toBe(`GGATCC${TEXT.slice(100, 522)}${reverseComplement('AAGCTT')}`);
    const site = result.products[0]?.forward;
    expect(site?.tail).toBe('GGATCC');
    expect(site?.annealLength).toBe(22);
    // The tail is nowhere on the template, so the copied stretch starts where
    // the annealing part does rather than six bases earlier.
    expect(result.products[0]?.templateRange.start).toBe(100);
  });

  it('lets a tail anneal where it happens to match, and changes nothing', () => {
    // Where a tail is drawn is a matter of what pairs, not of what the
    // designer meant: the HindIII site here shares AA and C with the four
    // bases after the annealing region, so two more base pairs form. The
    // product is the same string either way — those bases match the template,
    // which is why they annealed — so this is a fact about the report, not
    // about the molecule.
    const result = pcr(LINEAR, [fwd(100, 122, 'GGATCC'), rev(500, 522, 'AAGCTT')]);
    const reverse = result.products[0]?.reverse;
    expect(reverse?.annealLength).toBe(26);
    expect(reverse?.tail).toBe('AA');
    expect(reverse?.mismatches).toBe(2);
    expect(result.products[0]?.templateRange).toEqual({ start: 100, end: 526 });
    expect(one(result)).toBe(`GGATCC${TEXT.slice(100, 522)}AAGCTT`);
  });

  it('writes a primer mismatch into the product', () => {
    // Site-directed mutagenesis: the product is the primer's sequence, not
    // the template's, from the second cycle on.
    const annealing = TEXT.slice(100, 122).split('');
    const at = 8;
    const mutation = annealing[at] === 'A' ? 'C' : 'A';
    annealing[at] = mutation;
    const mutagenic: PcrPrimer = { name: 'F*', sequence: annealing.join('') };
    const result = pcr(LINEAR, [mutagenic, rev(500, 522)]);
    const expected = TEXT.slice(100, 522).split('');
    expected[at] = mutation;
    expect(one(result)).toBe(expected.join(''));
    expect(result.products[0]?.mismatches).toBe(1);
  });

  it('writes in upper case only what did not come from the template', () => {
    // A GenBank ORIGIN block is lower case and a primer is cleaned to upper,
    // so writing the oligo over the template would shout the whole annealing
    // region — which is the template's own sequence. Upper case in a product
    // means the 5′ tail and the mismatches, as a primer is written out in a
    // paper.
    const lower = SeqDocument.create({ name: 'strip', sequence: TEXT.toLowerCase() });
    const mutation = TEXT.charAt(108) === 'A' ? 'C' : 'A';
    const annealing = `${TEXT.slice(100, 108)}${mutation}${TEXT.slice(109, 122)}`;
    const result = pcr(lower, [{ name: 'F', sequence: `GGATCC${annealing}` }, rev(500, 522)]);
    const product = one(result);
    expect(product.toUpperCase()).toBe(
      `GGATCC${TEXT.slice(100, 108)}${mutation}${TEXT.slice(109, 522)}`,
    );
    const shouted: number[] = [];
    for (let i = 0; i < product.length; i++) {
      if (product.charAt(i) !== product.charAt(i).toLowerCase()) shouted.push(i);
    }
    // The six bases of the tail, and the mismatch at 6 + 8.
    expect(shouted).toEqual([0, 1, 2, 3, 4, 5, 14]);
  });

  it('refuses a mismatch under the 3′ end', () => {
    const annealing = TEXT.slice(100, 122).split('');
    annealing[21] = annealing[21] === 'A' ? 'C' : 'A';
    const result = pcr(LINEAR, [{ name: 'F', sequence: annealing.join('') }, rev(500, 522)]);
    expect(result.products).toHaveLength(0);
    expect(result.problem).toMatch(/does not anneal/);
  });

  it('amplifies across the origin of a plasmid', () => {
    const result = pcr(PLASMID, [fwd(2900, 2922), rev(100, 122)]);
    expect(one(result)).toBe(TEXT.slice(2900) + TEXT.slice(0, 122));
    expect(result.products[0]?.templateRange).toEqual({ start: 2900, end: 3122 });
  });

  it('amplifies the whole plasmid from back-to-back primers', () => {
    // Inverse PCR, which is how a vector is linearised for a Gibson. It
    // needs no case of its own: it is the long way round.
    const result = pcr(PLASMID, [fwd(1000, 1022), rev(978, 1000)]);
    expect(one(result)).toBe(TEXT.slice(1000) + TEXT.slice(0, 1000));
    expect(result.products[0]?.length).toBe(3000);
  });

  it('takes the template’s features and adds the two primers', () => {
    const annotated = SeqDocument.create({
      name: 'strip',
      sequence: TEXT,
      features: [
        createFeature({ type: 'CDS', name: 'gfp', segments: [rangeSegment(200, 300)] }),
        createFeature({ type: 'CDS', name: 'elsewhere', segments: [rangeSegment(1000, 1100)] }),
      ],
    });
    const result = pcr(annotated, [fwd(100, 122, 'GGATCC'), rev(500, 522)]);
    const features = result.products[0]?.document.features.all() ?? [];
    const gfp = features.find((f) => f.name === 'gfp');
    // Shifted by the tail, which is 6 bases of product before the template's.
    expect(gfp?.segments[0]).toMatchObject({ start: 106, end: 206 });
    expect(features.some((f) => f.name === 'elsewhere')).toBe(false);
    const primers = features.filter((f) => f.type === 'primer_bind');
    expect(primers.map((f) => f.name)).toEqual(['F', 'R']);
    // The oligo itself, tail included — which is where a tail can be drawn.
    expect(primers[0]?.segments[0]).toMatchObject({ start: 0, end: 28 });
    expect(primers[0]?.strand).toBe('forward');
    expect(primers[1]?.strand).toBe('reverse');
    expect(primers[1]?.segments[0]).toMatchObject({ start: 406, end: 428 });
  });

  it('lists the exact product before a mismatched one, shortest first', () => {
    // The same forward primer, an exact reverse site and a nearer one with a
    // mismatch in it: the exact pair is the band that was designed for.
    const near = reverseComplement(TEXT.slice(300, 322)).split('');
    near[10] = near[10] === 'A' ? 'C' : 'A';
    const result = pcr(LINEAR, [
      fwd(100, 122),
      rev(500, 522),
      { name: 'R2', sequence: near.join('') },
    ]);
    expect(result.products.map((p) => p.length)).toEqual([422, 222]);
    expect(result.products.map((p) => p.mismatches)).toEqual([0, 1]);
  });

  it('says which way it failed', () => {
    expect(pcr(LINEAR, [fwd(100, 122), fwd(500, 522, '', 'F2')]).problem).toMatch(
      /same strand of strip/,
    );
    expect(pcr(LINEAR, [fwd(500, 522), rev(100, 122)]).problem).toMatch(/point away from each/);
    expect(pcr(LINEAR, [fwd(100, 122), { name: 'R', sequence: 'A'.repeat(24) }]).problem).toMatch(
      /^R does not anneal to strip/,
    );
    expect(pcr(PLASMID, [fwd(100, 122), rev(500, 522)], { maxProduct: 100 }).problem).toMatch(
      /longer than 100 bp/,
    );
  });

  it('feeds a Gibson the parts nothing else could make', () => {
    // The reason PCR is here at all: the homology a Gibson joins by lives on
    // the primers, not in any file, so before this an assembly could only be
    // built from documents that already had it. Here the vector is
    // linearised by inverse PCR and the insert is amplified from a different
    // molecule with tails that anneal to nothing on it.
    const INSERT = template(800, 777);
    const source = SeqDocument.create({ name: 'gDNA', sequence: INSERT });

    const vector = pcr(PLASMID, [
      { name: 'V-fwd', sequence: TEXT.slice(1500, 1522) },
      { name: 'V-rev', sequence: reverseComplement(TEXT.slice(1478, 1500)) },
    ]).products[0]?.document;
    expect(vector?.length).toBe(3000);

    const insert = pcr(source, [
      { name: 'I-fwd', sequence: TEXT.slice(1475, 1500) + INSERT.slice(100, 122) },
      {
        name: 'I-rev',
        sequence: reverseComplement(INSERT.slice(500, 522) + TEXT.slice(1500, 1525)),
      },
    ]).products[0];
    // The tails are the vector's ends and are nowhere on the insert's own
    // template, which is exactly what the annealing search is for.
    expect(insert?.forward.tail).toBe(TEXT.slice(1475, 1500));
    expect(insert?.length).toBe(472);

    const parts = [vector, insert?.document].filter((d) => d !== undefined);
    expect(parts).toHaveLength(2);
    const assembled = gibson(parts);
    expect(assembled.problem).toBeNull();
    const product = assembled.assembly?.product;
    // Seamless: 3,000 bp of vector plus 422 bp of insert, each shared
    // stretch in it once.
    expect(product?.length).toBe(3422);
    expect(product?.isCircular).toBe(true);
    expect(product?.sequence.toString()).toBe(
      TEXT.slice(1500) + TEXT.slice(0, 1500) + INSERT.slice(100, 522),
    );
  });

  it('costs little enough to run on every keystroke', () => {
    // It is two walks over the template per primer, and a walk stops at the
    // first base that does not pair, so nearly every position costs one
    // comparison. The panel runs it on the main thread as the user types.
    const long = template(50_000, 99);
    const big = SeqDocument.create({ name: 'big', sequence: long, topology: 'circular' });
    const primers: PcrPrimer[] = [
      { name: 'F', sequence: long.slice(10_000, 10_022) },
      { name: 'R', sequence: reverseComplement(long.slice(14_000, 14_022)) },
    ];
    const t0 = performance.now();
    let found = 0;
    for (let run = 0; run < 20; run++) found += pcr(big, primers).products.length;
    const ms = (performance.now() - t0) / 20;
    // Over 100 kb of searchable strand a 15-base 3′ match with two
    // mismatches turns up by chance, so a long template really does give
    // spurious products; they sort below the exact one.
    expect(found).toBeGreaterThanOrEqual(20);
    expect(ms).toBeLessThan(200);
    // eslint-disable-next-line no-console
    console.info(`[perf] PCR over a 50 kb template: ${ms.toFixed(2)} ms`);
  });
});

describe('pcr II (#14)', () => {
  it('lets Taq add a 3′ A to each strand, which a TA vector joins by', () => {
    const [product] = pcr(LINEAR, [fwd(100, 122), rev(500, 522)], { polymerase: 'taq' }).products;
    const doc = product?.document;
    expect(doc?.sequence.toString()).toBe(`${TEXT.slice(100, 522)}A`);
    expect(doc?.ends).toEqual({
      left: { kind: "3'", overhang: 'T', enzyme: null },
      right: { kind: "3'", overhang: 'A', enzyme: null },
    });
    // A proofreading polymerase leaves it blunt.
    const [blunt] = pcr(LINEAR, [fwd(100, 122), rev(500, 522)]).products;
    expect(blunt?.document.ends).toBeNull();
  });

  it('gives Taq a shorter reach than a proofreading enzyme', () => {
    const long = SeqDocument.create({ name: 'long', sequence: template(8000, 7) });
    const text = long.sequence.toString();
    const pair = [
      { name: 'F', sequence: text.slice(100, 122) },
      { name: 'R', sequence: reverseComplement(text.slice(6500, 6522)) },
    ];
    expect(pcr(long, pair).products).toHaveLength(1);
    const taq = pcr(long, pair, { polymerase: 'taq' });
    expect(taq.products).toHaveLength(0);
    expect(taq.tooLong).toBe(1);
    expect(taq.problem).toMatch(/longer than 5,000 bp/);
  });

  it('gives a mismatched site the Tm of its stretch before the mismatch', () => {
    const primer =
      TEXT.slice(100, 110) + (TEXT.charAt(110) === 'A' ? 'C' : 'A') + TEXT.slice(111, 130);
    const [site] = pcr(LINEAR, [{ name: 'F', sequence: primer }]).sites;
    expect(site?.mismatches).toBe(1);
    // 19 bases pair after the mismatch; the whole 30 pair once it is copied.
    expect(site?.templateTm).toBeLessThan(site?.tm ?? 0);
    const [clean] = pcr(LINEAR, [fwd(100, 130)]).sites;
    expect(clean?.templateTm).toBe(clean?.tm);
  });
});

describe('primerDimers', () => {
  it('finds 3′ ends that pair with the partner or with a copy of themselves', () => {
    // GAATTC is its own reverse complement, so a primer ending in it pairs
    // with itself over six bases.
    const dimers = primerDimers([
      { name: 'Forward', sequence: 'ACGTTGCAAAGAATTC' },
      { name: 'Reverse', sequence: 'CCCCCCCCCCCCCCCC' },
    ]);
    expect(dimers).toEqual([{ primer: 'Forward', partner: 'Forward', bases: 6 }]);
    // The reverse primer's 3′ end is GGGGG's complement: it pairs with a
    // forward primer full of G.
    const pair = primerDimers([
      { name: 'Forward', sequence: 'ATATGGGGGGAT' },
      { name: 'Reverse', sequence: 'TATATACCCCCC' },
    ]);
    expect(pair.map((d) => [d.primer, d.partner])).toContainEqual(['Reverse', 'Forward']);
    expect(primerDimers([{ name: 'Forward', sequence: fwd(100, 122).sequence }])).toEqual([]);
  });
});
