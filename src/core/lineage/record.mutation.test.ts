import {
  type GoldenGateAssembly,
  type SeqDocument as Doc,
  SeqDocument,
  designOverlapPrimers,
  digest,
  documentFromFragment,
  findCutSites,
  getEnzyme,
  pcr,
  reverseComplement,
} from '@/core';

import { lineageChecksum, lineageOf } from './lineage';
import {
  fragmentLineage,
  fragmentOfDocument,
  fragmentWithLineage,
  recordGoldenGate,
  recordOverlapDesign,
  recordPcr,
  withPhosphates,
} from './record';

// Survivors of the 1.6 mutation run (item 50): each step kind recorded
// exactly, down to the fields the existing tests matched loosely.

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

function whole(doc: Doc) {
  return must(digest(doc, [])[0], `the whole of ${doc.name}`);
}

describe('recording a digest, exactly', () => {
  it('names only the enzymes that cut, for a piece with one end uncut', () => {
    const strip = SeqDocument.create({
      name: 'strip',
      sequence: `${filler(200, 1)}GAATTC${filler(300, 2)}`,
    });
    const enzyme = must(getEnzyme('EcoRI'), 'EcoRI');
    const sites = findCutSites(strip.sequence.toString(), strip.topology, [enzyme]);
    const pieces = digest(strip, sites);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      expect(fragmentWithLineage(piece, strip).lineage?.step).toMatchObject({
        op: 'digest',
        enzymes: ['EcoRI'],
      });
    }
  });

  it('names no enzyme for a molecule left uncut', () => {
    const strip = SeqDocument.create({ name: 'strip', sequence: filler(300, 3) });
    expect(fragmentWithLineage(whole(strip), strip).lineage?.step).toMatchObject({
      op: 'digest',
      enzymes: [],
    });
  });

  it('stands in a linear molecule for a fragment shelved before lineages were kept', () => {
    const old = whole(SeqDocument.create({ name: 'pieceA', sequence: filler(400, 4) }));
    const doc = documentFromFragment(old);
    expect(fragmentLineage(old)).toEqual({
      name: doc.name,
      checksum: lineageChecksum(doc),
      topology: 'linear',
      length: doc.length,
      step: null,
    });
  });
});

describe('recording phosphates, exactly', () => {
  it('adds the step to a part whose lineage is a molecule with no history', () => {
    const plain = SeqDocument.create({ name: 'plain', sequence: filler(300, 5) });
    const part = fragmentOfDocument(whole(plain), plain);
    const node = lineageOf(plain);
    expect(part.lineage).toEqual(node);
    const treated = withPhosphates(part, true);
    expect(treated.dephosphorylated).toBe(true);
    expect(treated.lineage).toEqual({
      ...node,
      step: { op: 'phosphates', parents: [node], removed: true },
    });
  });
});

describe('recording a PCR, exactly', () => {
  const template = SeqDocument.create({ name: 'strip', sequence: filler(3000, 9) });
  const text = template.sequence.toString();
  const primers = [
    { name: 'F', sequence: text.slice(100, 122) },
    { name: 'R', sequence: reverseComplement(text.slice(500, 522)) },
  ];
  const product = must(pcr(template, primers, { polymerase: 'taq' }).products[0], 'a product');

  it('records a primer’s bases in capitals with every space taken out', () => {
    const spaced = [
      { name: 'F', sequence: 'ac gt\t nn\nG' },
      { name: 'R', sequence: '  ttt  ' },
    ];
    expect(lineageOf(recordPcr(product, template, spaced, 'taq')).step).toMatchObject({
      forward: { name: 'F', sequence: 'ACGTNNG' },
      reverse: { name: 'R', sequence: 'TTT' },
    });
  });

  it('records a primer it was not given by name, with no bases', () => {
    expect(lineageOf(recordPcr(product, template, [], 'proofreading')).step).toMatchObject({
      forward: { name: 'F', sequence: '' },
      reverse: { name: 'R', sequence: '' },
      polymerase: 'proofreading',
    });
  });
});

describe('recording a Golden Gate, exactly', () => {
  it('names a document two pieces came from once, with the first piece’s orientation', () => {
    const a = SeqDocument.create({ name: 'pA', sequence: filler(300, 11) });
    const b = SeqDocument.create({ name: 'pB', sequence: filler(200, 12) });
    const assembly: GoldenGateAssembly = {
      order: [
        { fragment: whole(a), flipped: false, document: a },
        { fragment: whole(b), flipped: true, document: b },
        { fragment: whole(a), flipped: true, document: a },
      ],
      product: SeqDocument.create({ name: 'pAB', sequence: filler(500, 13), topology: 'circular' }),
      warnings: [],
    };
    const root = must(recordGoldenGate(assembly, ['BsaI']).metadata.lineage, 'a lineage');
    expect(root.step).toEqual({
      op: 'golden-gate',
      parents: [lineageOf(a), lineageOf(b)],
      enzymes: ['BsaI'],
      flipped: [false, true],
    });
  });
});

describe('recording an In-Fusion design, exactly', () => {
  const vec = SeqDocument.create({ name: 'pBackbone', sequence: filler(3000, 31).toLowerCase() });
  const source = SeqDocument.create({ name: 'gDNA', sequence: filler(4000, 77).toLowerCase() });
  const design = designOverlapPrimers(vec, source, { start: 1000, end: 1900 }, 'in-fusion');

  it('closes the circle of the vector and the amplicon, neither turned over', () => {
    const doc = must(recordOverlapDesign(design, vec, source, 'in-fusion'), 'a product');
    const root = must(doc.metadata.lineage, 'a lineage');
    expect(root.step).toMatchObject({ op: 'gibson', circular: true, flipped: [false, false] });
    const amplicon = root.step?.parents[1];
    expect(amplicon?.step).toEqual({
      op: 'pcr',
      parents: [lineageOf(source)],
      forward: { name: 'Forward', sequence: design.forward.sequence.toUpperCase() },
      reverse: { name: 'Reverse', sequence: design.reverse.sequence.toUpperCase() },
      polymerase: 'proofreading',
    });
    expect(design.reverse.sequence).not.toBe(design.reverse.sequence.toUpperCase());
  });

  it('makes nothing when the design has an amplicon but no product, or a product but no amplicon', () => {
    expect(design.product).not.toBeNull();
    expect(design.amplicon).not.toBeNull();
    expect(recordOverlapDesign({ ...design, product: null }, vec, source, 'in-fusion')).toBeNull();
    expect(recordOverlapDesign({ ...design, amplicon: null }, vec, source, 'in-fusion')).toBeNull();
  });
});
