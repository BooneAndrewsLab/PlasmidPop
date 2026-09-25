import {
  type LineageNode,
  type PcrPrimer,
  type SeqDocument as Doc,
  SeqDocument,
  createFeature,
  designMutagenesis,
  designOverlapPrimers,
  digest,
  documentChecksum,
  documentFromFragment,
  findCutSites,
  flipFragment,
  gateway,
  getEnzyme,
  gibson,
  goldenGate,
  ligate,
  partialDigest,
  pcr,
  rangeSegment,
  reverseComplement,
} from '@/core';

import { editedSinceMade, lineageOf } from './lineage';
import {
  fragmentLineage,
  fragmentOfDocument,
  fragmentWithLineage,
  recordGateway,
  recordGibson,
  recordGoldenGate,
  recordLigation,
  recordMutagenesis,
  recordOverlapDesign,
  recordPcr,
  withPhosphates,
} from './record';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

function cut(doc: Doc, ...names: string[]) {
  const enzymes = names.map((n) => must(getEnzyme(n), n));
  return findCutSites(doc.sequence.toString(), doc.topology, enzymes);
}

function checksum(doc: Doc): string {
  return must(documentChecksum(doc), 'a checksum').text;
}

function lineage(doc: Doc): LineageNode {
  return must(doc.metadata.lineage, `a lineage on ${doc.name}`);
}

function parents(node: LineageNode | undefined): readonly LineageNode[] {
  return node?.step?.parents ?? [];
}

// A vector with EcoRI and BamHI sites around a stuffer, and an insert with the same.
const vector = SeqDocument.create({
  name: 'pVec',
  topology: 'circular',
  sequence: `GAATTC${filler(300, 1)}GGATCC${filler(2000, 2)}`,
});
const insert = SeqDocument.create({
  name: 'pIns',
  topology: 'circular',
  sequence: `GAATTC${filler(700, 3)}GGATCC${filler(1500, 4)}`,
});

/** The larger piece of an EcoRI + BamHI digest. */
function backbone(doc: Doc) {
  return must(
    [...digest(doc, cut(doc, 'EcoRI', 'BamHI'))].sort(
      (a, b) => b.sequence.length - a.sequence.length,
    )[0],
    'a backbone',
  );
}

/** The smaller piece. */
function small(doc: Doc) {
  return must(
    [...digest(doc, cut(doc, 'EcoRI', 'BamHI'))].sort(
      (a, b) => a.sequence.length - b.sequence.length,
    )[0],
    'an insert',
  );
}

describe('a digest fragment opened (#67)', () => {
  it('opens as the fragment, made by a digest of its source', () => {
    const piece = fragmentWithLineage(small(vector), vector);
    const doc = documentFromFragment(piece);
    const root = lineage(doc);
    expect(root.name).toBe(doc.name);
    expect(root.checksum).toBe(checksum(doc));
    expect(root.topology).toBe('linear');
    expect(root.length).toBe(doc.length);
    expect(editedSinceMade(doc)).toBe(false);
    const step = must(root.step, 'a step');
    expect(step).toMatchObject({
      op: 'digest',
      enzymes: ['EcoRI', 'BamHI'],
      range: piece.range,
      uncut: 0,
    });
    expect(parents(root)).toEqual([lineageOf(vector)]);
    expect(parents(root)[0]?.checksum).toBe(checksum(vector));
  });

  it('keeps the name the tube numbers it by', () => {
    const piece = fragmentWithLineage(small(vector), vector);
    expect(lineage(documentFromFragment(piece, { name: 'pVec fragment 2' })).name).toBe(
      'pVec fragment 2',
    );
  });

  it('records the sites a partial digest left uncut', () => {
    const pieces = partialDigest(vector, cut(vector, 'EcoRI', 'BamHI'));
    const whole = must(
      pieces.find((p) => p.uncut === 1),
      'a piece with one site uncut',
    );
    const piece = fragmentWithLineage(whole, vector);
    expect(piece.uncut).toBe(1);
    expect(piece.lineage?.step).toMatchObject({ op: 'digest', uncut: 1 });
  });

  it('is the same molecule turned over', () => {
    const piece = fragmentWithLineage(small(vector), vector);
    const flipped = flipFragment(piece);
    expect(flipped.lineage).toBe(piece.lineage);
    expect(checksum(documentFromFragment(flipped))).toBe(piece.lineage?.checksum);
  });

  it('stands in for a fragment shelved before lineages were kept', () => {
    const old = small(vector);
    const node = fragmentLineage(old);
    expect(node.step).toBeNull();
    expect(node.checksum).toBe(checksum(documentFromFragment(old)));
  });
});

describe('a ligation of shelved parts', () => {
  const a = fragmentWithLineage(backbone(vector), vector);
  const b = flipFragment(fragmentWithLineage(small(insert), insert));

  it('gives a two-level tree: the product, the fragments, the documents they were cut from', () => {
    // The insert turned over would not fit; the unflipped one does.
    const parts = [
      { fragment: a, flipped: false },
      { fragment: fragmentWithLineage(small(insert), insert), flipped: false },
    ];
    const product = recordLigation(
      ligate(
        parts.map((p) => p.fragment),
        { name: 'pVec+pIns', circular: true },
      ),
      parts,
      true,
    );
    const root = lineage(product);
    expect(root.checksum).toBe(checksum(product));
    expect(root.step).toMatchObject({ op: 'ligation', circular: true, flipped: [false, false] });
    const [first, second] = parents(root);
    expect(first?.step?.op).toBe('digest');
    expect(second?.step?.op).toBe('digest');
    expect(parents(first)[0]?.name).toBe('pVec');
    expect(parents(second)[0]?.name).toBe('pIns');
    expect(parents(second)[0]?.checksum).toBe(checksum(insert));
  });

  it('records which parts went in turned over', () => {
    const product = recordLigation(
      SeqDocument.create({ name: 'x', sequence: 'ACGT', topology: 'circular' }),
      [
        { fragment: a, flipped: false },
        { fragment: b, flipped: true },
      ],
      true,
    );
    expect(lineage(product).step).toMatchObject({ flipped: [false, true] });
  });

  it('goes a level deeper for a part that was itself a product', () => {
    const first = recordLigation(
      ligate([a, fragmentWithLineage(small(insert), insert)], { name: 'p1', circular: true }),
      [
        { fragment: a, flipped: false },
        { fragment: fragmentWithLineage(small(insert), insert), flipped: false },
      ],
      true,
    );
    const again = fragmentWithLineage(small(first), first);
    const root = must(again.lineage, 'a lineage');
    expect(root.step?.op).toBe('digest');
    expect(parents(root)[0]?.step?.op).toBe('ligation');
    expect(parents(parents(root)[0])).toHaveLength(2);
  });
});

describe('dephosphorylating a shelf part', () => {
  const piece = fragmentWithLineage(backbone(vector), vector);

  it('adds a step, and taking the treatment back takes it off', () => {
    const treated = withPhosphates(piece, true);
    expect(treated.dephosphorylated).toBe(true);
    expect(treated.lineage?.step).toMatchObject({ op: 'phosphates', removed: true });
    expect(treated.lineage?.checksum).toBe(piece.lineage?.checksum);
    expect(parents(treated.lineage)[0]).toBe(piece.lineage);
    const untreated = withPhosphates(treated, false);
    expect(untreated.dephosphorylated).toBe(false);
    expect(untreated.lineage).toBe(piece.lineage);
  });

  it('records a kinase on a part that came without phosphates', () => {
    const kinased = withPhosphates({ ...piece, dephosphorylated: true }, false);
    expect(kinased.lineage?.step).toMatchObject({ op: 'phosphates', removed: false });
  });

  it('only treats a part with no lineage', () => {
    const old = backbone(vector);
    expect(withPhosphates(old, true)).toEqual({ ...old, dephosphorylated: true });
  });
});

describe('a PCR product', () => {
  const template = SeqDocument.create({ name: 'strip', sequence: filler(3000, 9) });
  const text = template.sequence.toString();
  const primers: PcrPrimer[] = [
    { name: 'F', sequence: `gg${text.slice(100, 122)}` },
    { name: 'R', sequence: reverseComplement(text.slice(500, 522)) },
  ];
  const product = must(pcr(template, primers, { polymerase: 'taq' }).products[0], 'a product');

  it('names its template, primers and polymerase', () => {
    const doc = recordPcr(product, template, primers, 'taq');
    const root = lineage(doc);
    expect(root.checksum).toBe(checksum(product.document));
    expect(root.step).toMatchObject({
      op: 'pcr',
      forward: { name: 'F', sequence: `GG${text.slice(100, 122)}` },
      reverse: { name: 'R', sequence: reverseComplement(text.slice(500, 522)) },
      polymerase: 'taq',
    });
    expect(parents(root)).toEqual([lineageOf(template)]);
  });

  it('shelved whole, is made the way the product was', () => {
    const doc = recordPcr(product, template, primers, 'taq');
    const [whole] = digest(doc, []);
    const shelved = fragmentOfDocument(must(whole, 'the whole product'), doc);
    expect(shelved.lineage).toEqual(lineageOf(doc));
    expect(shelved.lineage?.step?.op).toBe('pcr');
    expect(checksum(documentFromFragment(shelved))).toBe(shelved.lineage?.checksum);
  });
});

describe('a Gibson assembly', () => {
  const circle = filler(3000, 21);
  const pieces = [0, 1000, 2000].map((start, i) => {
    const end = start + 1000 + 25;
    let s = '';
    for (let p = start; p < end; p++) s += circle.charAt(p % circle.length);
    return SeqDocument.create({ name: `part${i + 1}`, sequence: s });
  });

  it('names each part in the order they joined', () => {
    const run = gibson(pieces, { minOverlap: 20 });
    const assembly = must(run.assembly, 'an assembly');
    const doc = recordGibson(assembly, { kit: 'gibson', circular: true, overlap: 20 });
    const root = lineage(doc);
    expect(root.step).toMatchObject({ op: 'gibson', kit: 'gibson', circular: true, overlap: 20 });
    expect(parents(root).map((p) => p.name)).toEqual(assembly.order.map((p) => p.document.name));
    expect(root.step?.op === 'gibson' ? root.step.flipped : []).toEqual(
      assembly.order.map((p) => p.flipped),
    );
    expect(parents(root)[0]?.checksum).toBe(checksum(must(pieces[0], 'part1')));
  });
});

describe('a Golden Gate assembly', () => {
  const BsaI = must(getEnzyme('BsaI'), 'BsaI');
  const [A, B, C] = ['AATG', 'GCTT', 'CGCT'];
  const part = (name: string, l: string, payload: string, r: string) =>
    SeqDocument.create({ name, sequence: `TTGGTCTCA${l}${payload}${r}AGAGACCTT` });
  const dest = SeqDocument.create({
    name: 'pDest',
    topology: 'circular',
    sequence: `${C}${filler(400, 5)}${A}AGAGACCTTTTGGTCTCA`,
  });

  it('names the documents its pieces were cut from', () => {
    const one = part('one', A, filler(200, 6), B);
    const two = part('two', B, filler(300, 7), C);
    const run = goldenGate([dest, one, two], { enzyme: BsaI });
    const assembly = must(run.assembly, 'an assembly');
    expect(assembly.order.map((p) => p.document.name)).toEqual(['pDest', 'one', 'two']);
    const doc = recordGoldenGate(assembly, ['BsaI']);
    const root = lineage(doc);
    expect(root.step).toMatchObject({ op: 'golden-gate', enzymes: ['BsaI'] });
    expect(parents(root).map((p) => p.checksum)).toEqual([dest, one, two].map(checksum));
  });
});

describe('a Gateway clone', () => {
  const core = { 1: 'ACGTTGA', 2: 'TTCAGGC' } as const;
  const arms = {
    B: ['CCTTAGGACTTCAAGGTCCA', 'GGATCCAAGTTCGATCTTGC'],
    P: ['TTACGCAAGGTTCCATGAAC', 'AACCGGTTACGGATTCCAAG'],
  } as const;
  const molecule = (name: string, kind: 'B' | 'P', middle: string, rest: string) => {
    const one = arms[kind][0] + core[1] + arms[kind][1];
    const two = arms[kind][0] + core[2] + arms[kind][1];
    const at = (start: number, end: number, label: string) =>
      createFeature({ type: 'protein_bind', name: label, segments: [rangeSegment(start, end)] });
    return SeqDocument.create({
      name,
      topology: 'circular',
      sequence: one + middle + two + rest,
      features: [
        at(0, one.length, `att${kind}1`),
        at(one.length + middle.length, one.length + middle.length + two.length, `att${kind}2`),
      ],
    });
  };
  const substrate = molecule('pSource', 'B', filler(600, 11), filler(1200, 22));
  const donor = molecule('pDONR', 'P', filler(900, 33), filler(1500, 44));

  it('names the substrate and the vector, and says which circle it is', () => {
    const result = gateway(substrate, donor, 'BP');
    const product = must(result.product, 'an entry clone');
    const byproduct = must(result.byproduct, 'a byproduct');
    const clone = lineage(recordGateway(product, substrate, donor, 'BP', false));
    expect(clone.step).toMatchObject({ op: 'gateway', reaction: 'BP', byproduct: false });
    expect(parents(clone).map((p) => p.name)).toEqual(['pSource', 'pDONR']);
    const other = lineage(recordGateway(byproduct, substrate, donor, 'BP', true));
    expect(other.step).toMatchObject({ byproduct: true });
  });
});

describe('a mutant', () => {
  const template = SeqDocument.create({
    name: 'pTest',
    sequence: filler(2500, 20260923).toLowerCase(),
    topology: 'circular',
  });
  const design = designMutagenesis(template, { start: 1000, end: 1001 }, 'G', 'back-to-back');

  it('opens as the template carrying the mutant’s lineage, which the edit makes true', () => {
    const opened = recordMutagenesis(template, design, `pTest ${design.label}`);
    expect(opened.name).toBe(`pTest ${design.label}`);
    expect(opened.sequence.toString()).toBe(template.sequence.toString());
    const root = lineage(opened);
    expect(root.step).toMatchObject({
      op: 'mutagenesis',
      change: design.label,
      method: 'back-to-back',
      primers: [design.forward.sequence.toUpperCase(), design.reverse.sequence.toUpperCase()],
    });
    expect(parents(root)).toEqual([lineageOf(template)]);
    // Before the design's edit it is not yet the mutant; after it, it is.
    expect(editedSinceMade(opened)).toBe(true);
    const mutant = opened.apply(design.edit);
    expect(editedSinceMade(mutant)).toBe(false);
    expect(root.checksum).toBe(checksum(mutant));
  });
});

describe('an In-Fusion design', () => {
  const vec = SeqDocument.create({ name: 'pBackbone', sequence: filler(3000, 31).toLowerCase() });
  const source = SeqDocument.create({ name: 'gDNA', sequence: filler(4000, 77).toLowerCase() });

  it('is the vector and a PCR product of the template, two levels down', () => {
    const design = designOverlapPrimers(vec, source, { start: 1000, end: 1900 }, 'in-fusion');
    const doc = must(recordOverlapDesign(design, vec, source, 'in-fusion'), 'a product');
    const root = lineage(doc);
    expect(root.step).toMatchObject({ op: 'gibson', kit: 'in-fusion', overlap: 15 });
    const [backboneNode, amplicon] = parents(root);
    expect(backboneNode?.name).toBe('pBackbone');
    expect(amplicon?.step).toMatchObject({
      op: 'pcr',
      forward: { name: 'Forward', sequence: design.forward.sequence.toUpperCase() },
      polymerase: 'proofreading',
    });
    expect(parents(amplicon)[0]?.checksum).toBe(checksum(source));
  });

  it('makes nothing of a design that made nothing', () => {
    const design = designOverlapPrimers(vec, source, { start: 1000, end: 1010 }, 'in-fusion');
    expect(recordOverlapDesign(design, vec, source, 'in-fusion')).toBeNull();
  });
});
