import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';

import { SOE_DEFAULTS, designOverlapExtension } from './overlapExtension';

const GC_END = 'GGCCGCGC';
const GC_START = 'GCGGCCGC';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const A_TEXT = filler(1200, 3);
const B_TEXT = filler(900, 19);
const C_TEXT = filler(700, 41);

function doc(name: string, text: string, features = [] as ReturnType<typeof createFeature>[]) {
  return SeqDocument.create({ name, sequence: text.toLowerCase(), topology: 'linear', features });
}

const a = doc('A', A_TEXT);
const b = doc('B', B_TEXT);
const c = doc('C', C_TEXT);
const whole = (d: SeqDocument) => ({ doc: d, range: { start: 0, end: d.length } });

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

describe('designOverlapExtension', () => {
  it('fuses two fragments end to end and runs every step', () => {
    const d = designOverlapExtension([whole(a), whole(b)]);
    expect(d.problem).toBeNull();
    const product = must(d.product, 'a product');
    expect(product.sequence.toString().toUpperCase()).toBe(A_TEXT + B_TEXT);
    expect(must(d.fused, 'a fused molecule').length).toBe(A_TEXT.length + B_TEXT.length);
    // Four primers: two outer without tails, two inner with one.
    expect(d.primers.map((p) => p.name)).toEqual(['SOE F1', 'SOE R1', 'SOE F2', 'SOE R2']);
    expect(d.primers.map((p) => p.role)).toEqual(['outer', 'inner', 'inner', 'outer']);
    expect(d.primers[0]?.tail).toBe('');
    expect(d.primers[3]?.tail).toBe('');
    // First-round products carry the neighbour's end: the first the second's start, and back.
    expect(d.firstRound).toHaveLength(2);
    expect(d.firstRound[0]?.length).toBeGreaterThan(A_TEXT.length);
    expect(d.firstRound[1]?.length).toBeGreaterThan(B_TEXT.length);
  });

  it('makes the two inner primers complementary over the whole overlap', () => {
    const d = designOverlapExtension([whole(a), whole(b)]);
    const junction = must(d.junctions[0], 'a junction');
    const inner = d.primers.filter((p) => p.role === 'inner');
    const r1 = must(
      inner.find((p) => p.strand === 'reverse'),
      'reverse inner',
    ).sequence;
    const f2 = must(
      inner.find((p) => p.strand === 'forward'),
      'forward inner',
    ).sequence;
    expect(junction.overlap).toBe(
      A_TEXT.slice(-Math.ceil(junction.length / 2)) +
        B_TEXT.slice(0, Math.floor(junction.length / 2)),
    );
    expect(f2.toUpperCase()).toContain(junction.overlap);
    expect(reverseComplement(r1).toUpperCase()).toContain(junction.overlap);
    expect(junction.tm).toBeGreaterThanOrEqual(SOE_DEFAULTS.overlapTm);
  });

  it('joins three fragments, a middle one carrying a tail at each end', () => {
    const d = designOverlapExtension([whole(a), whole(b), whole(c)], { name: 'ABC' });
    expect(d.problem).toBeNull();
    expect(must(d.product, 'a product').name).toBe('ABC');
    expect(must(d.product, 'a product').sequence.toString().toUpperCase()).toBe(
      A_TEXT + B_TEXT + C_TEXT,
    );
    expect(d.primers).toHaveLength(6);
    expect(d.junctions).toHaveLength(2);
    const middle = d.firstRound[1];
    expect(middle?.length).toBeGreaterThan(B_TEXT.length + 15);
  });

  it('takes a stretch of a template, and makes a deletion by fusing its two flanks', () => {
    const left = { doc: a, range: { start: 0, end: 400 } };
    const right = { doc: a, range: { start: 700, end: 1200 } };
    const d = designOverlapExtension([left, right]);
    expect(d.problem).toBeNull();
    expect(must(d.product, 'a product').sequence.toString().toUpperCase()).toBe(
      A_TEXT.slice(0, 400) + A_TEXT.slice(700),
    );
  });

  it('grows the overlap to the Tm asked for', () => {
    const low = designOverlapExtension([whole(a), whole(b)], { overlapTm: 50, minOverlap: 12 });
    const high = designOverlapExtension([whole(a), whole(b)], { overlapTm: 66 });
    expect(must(high.junctions[0], 'junction').length).toBeGreaterThan(
      must(low.junctions[0], 'junction').length,
    );
  });

  it('warns when an overlap is short', () => {
    const d = designOverlapExtension([whole(a), whole(b)], {
      overlapTm: 30,
      minOverlap: 10,
      maxOverlap: 10,
    });
    expect(d.problem).toBeNull();
    expect(d.warnings.join(' ')).toMatch(/short for the extension step/);
  });

  it('warns when an overlap is not unique in the fused molecule', () => {
    const first = designOverlapExtension([whole(a), whole(b)]);
    const overlap = must(first.junctions[0], 'a junction').overlap;
    // The same stretch turns up again inside the second fragment.
    const again = doc('Again', B_TEXT.slice(0, 300) + overlap + B_TEXT.slice(300));
    const d = designOverlapExtension([whole(a), whole(again)]);
    expect(d.problem ?? d.warnings.join(' ')).toMatch(
      /2 times in the fused molecule|also matches somewhere else/,
    );
  });

  it('refuses fewer than two fragments, and fragments too short to prime', () => {
    const one = designOverlapExtension([whole(a)]);
    expect(one.problem).toBe('Choose at least two fragments to fuse.');
    expect(one).toMatchObject({
      primers: [],
      junctions: [],
      firstRound: [],
      fused: null,
      product: null,
      warnings: [],
    });
    const tiny = doc('Tiny', 'ACGTACGTAC');
    expect(designOverlapExtension([whole(a), whole(tiny)]).problem).toMatch(/too short/);
  });

  it('refuses ambiguous bases', () => {
    const amb = doc('Amb', B_TEXT.slice(0, 300) + 'N' + B_TEXT.slice(300));
    expect(designOverlapExtension([whole(a), whole(amb)]).problem).toMatch(/ambiguous/);
  });

  describe('reading frames', () => {
    const cds = (start: number, end: number, strand: 'forward' | 'reverse' = 'forward') =>
      createFeature({ type: 'CDS', name: 'gene', strand, segments: [rangeSegment(start, end)] });

    it('is quiet when a deletion inside a gene takes a whole number of codons', () => {
      const gene = doc('Gene', A_TEXT, [cds(100, 1000)]);
      const d = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 400 } },
        { doc: gene, range: { start: 403, end: 1200 } },
      ]);
      expect(d.problem).toBeNull();
      expect(d.warnings.filter((w) => w.includes('frame'))).toEqual([]);
    });

    it('warns when a deletion inside a gene shifts its frame', () => {
      const gene = doc('Gene', A_TEXT, [cds(100, 1000)]);
      const d = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 400 } },
        { doc: gene, range: { start: 401, end: 1200 } },
      ]);
      expect(d.problem).toBeNull();
      expect(d.warnings.some((w) => w.includes('out of frame') && w.includes('gene'))).toBe(true);
    });

    it('warns for a gene on the reverse strand too', () => {
      const gene = doc('Gene', A_TEXT, [cds(100, 1000, 'reverse')]);
      const shifted = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 400 } },
        { doc: gene, range: { start: 402, end: 1200 } },
      ]);
      expect(shifted.warnings.some((w) => w.includes('out of frame'))).toBe(true);
      const kept = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 400 } },
        { doc: gene, range: { start: 406, end: 1200 } },
      ]);
      expect(kept.warnings.filter((w) => w.includes('frame'))).toEqual([]);
    });

    it('checks a tag fused on to a gene against the frame the tag was read in', () => {
      const gene = doc('Gene', A_TEXT, [cds(0, 900)]);
      const tag = doc('Tag', B_TEXT, [cds(0, 300)]);
      // The gene's first 600 bases are 200 codons, so the tag starts in frame.
      const inFrame = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 600 } },
        { doc: tag, range: { start: 0, end: 300 } },
      ]);
      expect(inFrame.warnings.filter((w) => w.includes('frame'))).toEqual([]);
      const off = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 601 } },
        { doc: tag, range: { start: 0, end: 300 } },
      ]);
      expect(off.warnings.some((w) => w.includes('out of frame'))).toBe(true);
    });

    const SHIFT =
      'What is left out between fragments 1 and 2 is not a multiple of three bases, so gene is read out of frame after the junction.';
    const flanks = (gene: SeqDocument, from: number) => [
      { doc: gene, range: { start: 0, end: 400 } },
      { doc: gene, range: { start: from, end: 1200 } },
    ];

    it('words a shift inside one gene exactly, and a gene with no name as "A CDS"', () => {
      const gene = doc('Gene', A_TEXT, [cds(100, 1000)]);
      expect(designOverlapExtension(flanks(gene, 401)).warnings).toEqual([SHIFT]);
      const bare = doc('Bare', A_TEXT, [
        createFeature({ type: 'CDS', name: '', segments: [rangeSegment(100, 1000)] }),
      ]);
      expect(designOverlapExtension(flanks(bare, 401)).warnings).toEqual([
        'What is left out between fragments 1 and 2 is not a multiple of three bases, so A CDS is read out of frame after the junction.',
      ]);
    });

    it('reports each strand once, and looks only at CDSs that cover the junction', () => {
      const named = (name: string, type: string, start: number, end: number) =>
        createFeature({ type, name, segments: [rangeSegment(start, end)] });
      const gene = doc('Gene', A_TEXT, [
        cds(100, 1000),
        { ...cds(100, 1000, 'reverse'), name: 'rev' },
        named('region', 'gene', 100, 1000),
        named('elsewhere', 'CDS', 1050, 1150),
      ]);
      expect(designOverlapExtension(flanks(gene, 401)).warnings).toEqual([
        SHIFT,
        'What is left out between fragments 1 and 2 is not a multiple of three bases, so rev is read out of frame after the junction.',
      ]);
      expect(designOverlapExtension(flanks(gene, 403)).warnings).toEqual([]);
    });

    it('names both genes when a fusion shifts one into the other, on either strand', () => {
      const gene = doc('Gene', A_TEXT, [cds(0, 900)]);
      const tag = doc('Tag', B_TEXT, [{ ...cds(0, 300), name: 'tag' }]);
      expect(
        designOverlapExtension([
          { doc: gene, range: { start: 0, end: 601 } },
          { doc: tag, range: { start: 0, end: 300 } },
        ]).warnings,
      ).toEqual([
        'gene runs into tag at junction 1 out of frame: the fusion shifts the reading frame of tag.',
      ]);
      // On the reverse strand the ribosome comes from the right-hand fragment.
      const rgene = doc('RGene', A_TEXT, [cds(100, 1000, 'reverse')]);
      const rtag = doc('RTag', B_TEXT, [{ ...cds(0, 300, 'reverse'), name: 'tag' }]);
      const fuse = (end: number) =>
        designOverlapExtension([
          { doc: rgene, range: { start: 0, end } },
          { doc: rtag, range: { start: 0, end: 300 } },
        ]).warnings;
      expect(fuse(700)).toEqual([]);
      expect(fuse(701)).toEqual([
        'tag runs into gene at junction 1 out of frame: the fusion shifts the reading frame of tag.',
      ]);
    });

    it('starts counting a CDS at its codon_start, whatever other qualifiers it has', () => {
      const withStart = (value: string, start = 0) =>
        createFeature({
          type: 'CDS',
          name: 'gene',
          segments: [rangeSegment(start, 900)],
          qualifiers: [
            { name: 'note', value: '3' },
            { name: 'codon_start', value },
          ],
        });
      const tag = doc('Tag', B_TEXT, [{ ...cds(0, 300), name: 'tag' }]);
      const fuse = (gene: SeqDocument, end: number) =>
        designOverlapExtension([
          { doc: gene, range: { start: 0, end } },
          { doc: tag, range: { start: 0, end: 300 } },
        ]).warnings;
      const second = doc('Second', A_TEXT, [withStart('2')]);
      expect(fuse(second, 601)).toEqual([]);
      expect(fuse(second, 600)).toHaveLength(1);
      const third = doc('Third', A_TEXT, [withStart('3')]);
      expect(fuse(third, 602)).toEqual([]);
      expect(fuse(third, 600)).toHaveLength(1);
      // The downstream CDS has its own codon_start: it begins one base into a codon.
      const lateTag = doc('LateTag', B_TEXT, [
        createFeature({
          type: 'CDS',
          name: 'tag',
          segments: [rangeSegment(0, 300)],
          qualifiers: [{ name: 'codon_start', value: '3' }],
        }),
      ]);
      const gene = doc('Gene', A_TEXT, [cds(0, 900)]);
      const fuseLate = (end: number) =>
        designOverlapExtension([
          { doc: gene, range: { start: 0, end } },
          { doc: lateTag, range: { start: 0, end: 300 } },
        ]).warnings;
      expect(fuseLate(601)).toEqual([]);
      expect(fuseLate(600)).toHaveLength(1);
    });

    it('reads a join() in reading order and checks each junction of three fragments', () => {
      const split = doc('Split', A_TEXT, [
        createFeature({
          type: 'CDS',
          name: 'gene',
          segments: [rangeSegment(0, 300), rangeSegment(500, 900)],
        }),
      ]);
      const across = (from: number) =>
        designOverlapExtension([
          { doc: split, range: { start: 0, end: 300 } },
          { doc: split, range: { start: from, end: 1200 } },
        ]).warnings;
      expect(across(500)).toEqual([]);
      expect(across(501)).toEqual([SHIFT]);
      const gene = doc('Gene', A_TEXT, [cds(100, 1000)]);
      expect(
        designOverlapExtension([
          { doc: gene, range: { start: 0, end: 400 } },
          { doc: gene, range: { start: 403, end: 700 } },
          { doc: gene, range: { start: 701, end: 1200 } },
        ]).warnings,
      ).toEqual([
        'What is left out between fragments 2 and 3 is not a multiple of three bases, so gene is read out of frame after the junction.',
      ]);
    });
  });
});

describe('designOverlapExtension: primers, overlaps and messages', () => {
  const pair = () => designOverlapExtension([whole(a), whole(b)]);

  it('designs exactly these primers and this overlap for two fragments', () => {
    const d = pair();
    expect(d.warnings).toEqual([]);
    expect(
      d.primers.map((p) => [
        p.name,
        p.sequence,
        p.tail,
        p.annealLength,
        p.fragment,
        p.strand,
        p.role,
      ]),
    ).toEqual([
      ['SOE F1', 'ttccatttacgtgccttggttcgag', '', 25, 0, 'forward', 'outer'],
      [
        'SOE R1',
        'CGCCCTCGATTATGTtactccaaatggatctgaccacgaca',
        'CGCCCTCGATTATGT',
        26,
        0,
        'reverse',
        'inner',
      ],
      [
        'SOE F2',
        'GATCCATTTGGAGTAacataatcgagggcgaagcgc',
        'GATCCATTTGGAGTA',
        21,
        1,
        'forward',
        'inner',
      ],
      ['SOE R2', 'aaagaatttggtgaagtcggaactcaatgg', '', 30, 1, 'reverse', 'outer'],
    ]);
    expect(d.primers.map((p) => p.tm)).toEqual([
      expect.closeTo(60.385, 2),
      expect.closeTo(60.103, 2),
      expect.closeTo(60.688, 2),
      expect.closeTo(60.491, 2),
    ]);
    expect(d.junctions).toHaveLength(1);
    expect(d.junctions[0]).toMatchObject({
      index: 0,
      overlap: 'GATCCATTTGGAGTAACATAATCGAGGGCG',
      length: 30,
    });
    expect(d.junctions[0]?.tm).toBeCloseTo(61.62, 2);
    expect(d.firstRound.map((f) => [f.name, f.length])).toEqual([
      ['A fragment 1', 1215],
      ['B fragment 2', 915],
    ]);
    expect(d.product?.name).toBe('A + B fusion');
  });

  it('designs the tails of a middle fragment at both ends', () => {
    const d = designOverlapExtension([whole(a), whole(b), whole(c)]);
    expect(d.warnings).toEqual([]);
    expect(d.primers.map((p) => [p.name, p.tail.length, p.annealLength, p.role])).toEqual([
      ['SOE F1', 0, 25, 'outer'],
      ['SOE R1', 15, 26, 'inner'],
      ['SOE F2', 15, 21, 'inner'],
      ['SOE R2', 14, 30, 'inner'],
      ['SOE F3', 14, 22, 'inner'],
      ['SOE R3', 0, 24, 'outer'],
    ]);
    expect(d.junctions.map((j) => [j.index, j.overlap, j.length])).toEqual([
      [0, 'GATCCATTTGGAGTAACATAATCGAGGGCG', 30],
      [1, 'TCACCAAATTCTTTGGGGTTAGCTACGC', 28],
    ]);
  });

  it('names the primers with a prefix and the product with a name', () => {
    const d = designOverlapExtension([whole(a), whole(b)], { primerPrefix: 'X-', name: 'Fused' });
    expect(d.primers.map((p) => p.name)).toEqual(['X-F1', 'X-R1', 'X-F2', 'X-R2']);
    expect(d.product?.name).toBe('Fused');
  });

  it('holds the overlap to its bounds, and stops at the Tm when it reaches it exactly', () => {
    const grown = (o: object) =>
      designOverlapExtension([whole(a), whole(b)], o).junctions.map((j) => j.length);
    expect(grown({ overlapTm: 99, minOverlap: 18, maxOverlap: 25 })).toEqual([25]);
    expect(grown({ overlapTm: 99, minOverlap: 30, maxOverlap: 20 })).toEqual([30]);
    expect(grown({ overlapTm: 0, minOverlap: 18 })).toEqual([18]);
    const exact = pair().junctions[0]?.tm ?? 0;
    expect(grown({ overlapTm: exact })).toEqual([30]);
    expect(grown({ overlapTm: exact + 0.01 })).toEqual([31]);
  });

  it('says which fragment is too short or ambiguous', () => {
    const tiny = doc('Tiny', 'ACGTACGTAC');
    expect(designOverlapExtension([whole(a), whole(tiny)]).problem).toBe(
      'Fragment 2 (Tiny) is 10 bp, too short to fuse: a primer needs 18 bases at each end.',
    );
    const amb = doc('Amb', B_TEXT.slice(0, 300) + 'N' + B_TEXT.slice(300));
    expect(designOverlapExtension([whole(a), whole(amb)]).problem).toBe(
      'Fragment 2 (Amb) has ambiguous bases, which primers cannot be designed over. Resolve them first.',
    );
  });

  it('accepts a fragment of exactly two primers, and warns that its primer cannot grow', () => {
    const d = designOverlapExtension([whole(a), whole(doc('B36', B_TEXT.slice(0, 36)))]);
    expect(d.problem).toBeNull();
    expect(d.primers.map((p) => p.annealLength)).toEqual([25, 26, 18, 18]);
    expect(d.warnings).toEqual([
      'SOE F2 anneals below 55 °C, because the fragment gives it no room to grow: expect a poorer first round.',
    ]);
  });

  it('keeps an annealing part within half of its fragment, and names every weak primer', () => {
    const weak = designOverlapExtension([
      whole(a),
      whole(doc('T', 'ATATTATAATTATATATTAAATATTTATAATATTAATAAT')),
    ]);
    expect(weak.primers.map((p) => p.annealLength)).toEqual([25, 26, 20, 20]);
    expect(weak.warnings).toEqual([
      'SOE F2, SOE R2 anneal below 55 °C, because the fragment gives it no room to grow: expect a poorer first round.',
    ]);
    const mixed = designOverlapExtension([
      whole(a),
      whole(doc('M', B_TEXT.slice(0, 22) + 'ATATTATAATTATATATTAAAT')),
    ]);
    expect(mixed.warnings).toEqual([
      'SOE R2 anneals below 55 °C, because the fragment gives it no room to grow: expect a poorer first round.',
    ]);
  });

  it('lets a primer grow past the maximum to continue its tail, and fails the design if it cannot anneal', () => {
    const d = designOverlapExtension([whole(a), whole(b)], { maxAnneal: 10, minAnneal: 10 });
    expect(d.problem).toBe(
      'SOE F1 does not anneal to A, so there is nothing for the other primer to meet.',
    );
    expect(d.primers.map((p) => p.annealLength)).toEqual([10, 15, 15, 10]);
  });

  describe('short and weak overlaps', () => {
    const ends = (upEnd: string, downStart: string, length: number) =>
      designOverlapExtension(
        [whole(doc('A', A_TEXT.slice(0, 1100) + upEnd)), whole(doc('B', downStart + B_TEXT))],
        { minOverlap: length, maxOverlap: length, overlapTm: 10 },
      );

    it('warns of a short overlap however well it melts', () => {
      const d = ends(GC_END.slice(1), GC_START.slice(0, 7), 14);
      expect(d.junctions[0]?.overlap).toBe('GCCGCGCGCGGCCG');
      expect(d.warnings).toEqual([
        'The overlap is 14 bases melting at 68 °C, short for the extension step: lengthen it, or raise the overlap Tm.',
      ]);
    });

    it('does not warn of an overlap of 15 or more that melts well', () => {
      expect(ends(GC_END, GC_START, 15).warnings).toEqual([]);
      expect(ends(GC_END, GC_START, 16).warnings).toEqual([]);
    });

    it('warns of a long overlap that melts too low', () => {
      const d = ends('ATTATATAT', 'TAATTATAT', 18);
      expect(d.junctions[0]?.overlap).toBe('ATTATATATTAATTATAT');
      expect(d.warnings).toEqual([
        'The overlap is 18 bases melting at 27 °C, short for the extension step: lengthen it, or raise the overlap Tm.',
      ]);
    });
  });

  describe('overlaps that turn up again', () => {
    const OV1 = 'GATCCATTTGGAGTAACATAATCGAGGGCG';
    const OV2 = 'TCACCAAATTCTTTGGGGTTAGCTACGC';
    const times = (label: string, ov: string) =>
      `${label} (${ov}) occurs 2 times in the fused molecule, so a first-round product can anneal at the wrong place and give a different fusion.`;

    it('counts a copy at the very start, on the same strand, and on the other', () => {
      const same = designOverlapExtension([
        whole(a),
        whole(doc('B', B_TEXT.slice(0, 300) + OV1 + B_TEXT.slice(300))),
      ]);
      expect(same.warnings).toEqual([times('The overlap', OV1)]);
      const flipped = designOverlapExtension([
        whole(a),
        whole(doc('B', B_TEXT.slice(0, 300) + reverseComplement(OV1) + B_TEXT.slice(300))),
      ]);
      expect(flipped.warnings).toEqual([times('The overlap', OV1)]);
      const atStart = designOverlapExtension([whole(doc('A', OV1 + A_TEXT)), whole(b)]);
      expect(atStart.warnings).toEqual([times('The overlap', OV1)]);
    });

    it('numbers the junction when there are several', () => {
      const second = designOverlapExtension([
        whole(doc('A', A_TEXT.slice(0, 300) + OV2 + A_TEXT.slice(300))),
        whole(b),
        whole(c),
      ]);
      expect(second.warnings).toEqual([times('The overlap at junction 2', OV2)]);
      const first = designOverlapExtension([
        whole(a),
        whole(b),
        whole(doc('C', C_TEXT.slice(0, 300) + OV1 + C_TEXT.slice(300))),
      ]);
      expect(first.warnings).toEqual([times('The overlap at junction 1', OV1)]);
    });

    it('counts a palindromic overlap once', () => {
      const d = designOverlapExtension(
        [whole(a), whole(doc('B', reverseComplement(A_TEXT.slice(-15)) + B_TEXT))],
        { minOverlap: 20, maxOverlap: 20 },
      );
      expect(d.junctions[0]?.overlap).toBe('ATTTGGAGTATACTCCAAAT');
      expect(d.warnings).toEqual([
        'The overlap is 20 bases melting at 47 °C, short for the extension step: lengthen it, or raise the overlap Tm.',
      ]);
    });
  });

  describe('steps that fail', () => {
    it('says when a fragment is amplified with other products, one or several', () => {
      const repeated = doc('R', filler(60, 7).repeat(20));
      expect(designOverlapExtension([whole(repeated), whole(b)]).problem).toBe(
        'The primers for fragment 1 (R) do not amplify it: 12 other products instead.',
      );
      const huge = doc('Big', filler(21000, 5));
      expect(designOverlapExtension([whole(huge), whole(b)]).problem).toBe(
        'The primers for fragment 1 (Big) do not amplify it: 1 other product instead.',
      );
    });

    it('refuses first-round products that join ambiguously, keeping what was designed', () => {
      const d = designOverlapExtension([
        whole(a),
        whole(doc('B', B_TEXT + reverseComplement(pair().junctions[0]?.overlap ?? ''))),
      ]);
      expect(d.problem).toBe(
        'The end of A fragment 1 matches B fragment 2 either way round, so the assembly is ambiguous.',
      );
      expect(d.primers).toHaveLength(4);
      expect(d.junctions).toHaveLength(1);
      expect(d.firstRound).toHaveLength(2);
      expect(d.fused).toBeNull();
      expect(d.product).toBeNull();
    });

    it('refuses first-round products that do not join at all', () => {
      const d = designOverlapExtension([
        whole(a),
        whole(doc('B', B_TEXT + reverseComplement(B_TEXT.slice(0, 60)))),
      ]);
      expect(d.problem).toBe(
        'Nothing follows A fragment 1: no other part starts with its last 30 bases or more. 1 of 2 parts were never reached.',
      );
    });

    it('reports the fused molecule when the outer primers cannot copy it', () => {
      const d = designOverlapExtension([
        whole(doc('H', filler(11000, 9))),
        whole(doc('G', filler(11000, 11))),
      ]);
      expect(d.problem).toBe(
        'The primers would amplify, but the product is longer than 20,000 bp.',
      );
      expect(d.primers).toHaveLength(4);
      expect(d.fused?.length).toBe(22000);
      expect(d.product).toBeNull();
    });
  });
});
