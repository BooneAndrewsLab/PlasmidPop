import {
  BUNDLED_ENZYME_SET,
  SeqDocument,
  createFeature,
  getEnzyme,
  rangeSegment,
  reverseComplement,
  setActiveEnzymeSet,
} from '@/core';

import {
  goldenGateEnzymes,
  defaultGoldenGateEnzyme,
  describeDropped,
  goldenGate,
  overhangWarnings,
} from './goldenGate';
import { overhangsMatch } from './ligate';

const BsaI = getEnzyme('BsaI');
if (BsaI === undefined) throw new Error('BsaI is not in the enzyme table');

/**
 * A linear part as a Golden Gate designer would order it: a BsaI site at
 * each end pointing inwards, one spacer base, then the overhang the cut
 * leaves. The sites and everything outside them go with the end pieces.
 */
function linearPart(name: string, left: string, payload: string, right: string): SeqDocument {
  return SeqDocument.create({ name, sequence: `TTGGTCTCA${left}${payload}${right}AGAGACCTT` });
}

/**
 * A destination vector: the same arrangement closed into a circle, so the
 * stuffer between the two sites carries them both away when it is cut out.
 */
function circularPart(name: string, left: string, payload: string, right: string): SeqDocument {
  return SeqDocument.create({
    name,
    topology: 'circular',
    sequence: `${left}${payload}${right}AGAGACCTTTTGGTCTCA`,
  });
}

const A = 'AATG';
const B = 'GCTT';
const C = 'CGCT';

describe('Golden Gate enzymes', () => {
  it('offers the Type IIS enzymes that leave an overhang', () => {
    const names = goldenGateEnzymes().map((e) => e.name);
    expect(names).toContain('BsaI');
    expect(names).toContain('BsmBI');
    expect(names).toContain('BbsI');
    expect(names).toContain('SapI');
    // Cuts inside its site, so it is not Type IIS.
    expect(names).not.toContain('EcoRI');
    // Type IIS but blunt: nothing to assemble by.
    expect(names).not.toContain('MlyI');
    expect(defaultGoldenGateEnzyme()?.name).toBe('BsaI');
  });

  it('leaves out an enzyme that cuts on both sides of its site', () => {
    const bcgI = {
      name: 'BcgI',
      site: 'CGANNNNNNTGC',
      cutTop: -10,
      cutBottom: -12,
      secondCut: { cutTop: 24, cutBottom: 22 },
      palindromic: false,
    };
    setActiveEnzymeSet({ ...BUNDLED_ENZYME_SET, enzymes: [...BUNDLED_ENZYME_SET.enzymes, bcgI] });
    try {
      expect(goldenGateEnzymes().map((e) => e.name)).not.toContain('BcgI');
    } finally {
      setActiveEnzymeSet(null);
    }
  });
});

describe('goldenGate', () => {
  it('joins a vector and two inserts in the one order the overhangs allow', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const one = linearPart('insert1', B, 'AAAAAAAAAA', C);
    const two = linearPart('insert2', C, 'TTTTTTTTTT', A);
    // The parts are given out of order on purpose.
    const result = goldenGate([one, two, vector], { enzyme: BsaI });

    expect(result.problem).toBeNull();
    const assembly = result.assembly;
    if (assembly === null) throw new Error('no assembly');
    expect(result.usable).toHaveLength(3);
    expect(assembly.order.map((p) => p.fragment.source)).toEqual(['insert1', 'insert2', 'pDest']);
    expect(assembly.order.every((p) => !p.flipped)).toBe(true);
    expect(assembly.product.isCircular).toBe(true);

    // The product is the three payloads, each behind the overhang it starts with.
    expect(assembly.product.sequence.toString()).toBe(
      `${B}AAAAAAAAAA${C}TTTTTTTTTT${A}CCCCCCCCCCCC`,
    );
    // Every BsaI site is gone: the product cannot be cut again.
    expect(assembly.product.sequence.toString()).not.toContain('GGTCTC');
    expect(assembly.product.sequence.toString()).not.toContain('GAGACC');
    expect(assembly.product.metadata.description).toContain('Golden Gate assembly with BsaI');
  });

  it('starts from whichever part comes first and still finds the same circle', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const one = linearPart('insert1', B, 'AAAAAAAAAA', C);
    const two = linearPart('insert2', C, 'TTTTTTTTTT', A);
    const fromVector = goldenGate([vector, one, two], { enzyme: BsaI });
    expect(fromVector.assembly?.order.map((p) => p.fragment.source)).toEqual([
      'pDest',
      'insert1',
      'insert2',
    ]);
    // The same circle, read starting at the vector.
    expect(fromVector.assembly?.product.sequence.toString()).toBe(
      `${A}CCCCCCCCCCCC${B}AAAAAAAAAA${C}TTTTTTTTTT`,
    );
  });

  it('carries the parts features into the product', () => {
    const insert = SeqDocument.create({
      name: 'insert1',
      sequence: `TTGGTCTCA${B}AAAAAAAAAA${C}AGAGACCTT`,
      // The payload starts at 13: 2 prefix + 6 site + 1 spacer + 4 overhang.
      features: [
        createFeature({ id: 'g', type: 'CDS', name: 'gene', segments: [rangeSegment(13, 23)] }),
      ],
    });
    const vector = circularPart('pDest', C, 'CCCCCCCCCCCC', B);
    const result = goldenGate([vector, insert], { enzyme: BsaI });
    expect(result.problem).toBeNull();
    expect(result.assembly?.product.features.all().map((f) => f.name)).toEqual(['gene']);
  });

  it('turns a part around when that is the way it fits', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    // Ordered back to front: it reads C → A, and needs to go in as A → C.
    const flipped = linearPart('insert1', reverseComplement(A), 'GGGAAAGGGA', reverseComplement(B));
    const result = goldenGate([vector, flipped], { enzyme: BsaI });
    expect(result.problem).toBeNull();
    expect(result.assembly?.product.sequence.toString()).toBe(`${A}CCCCCCCCCCCC${B}TCCCTTTCCC`);
    // The order says which part had to be turned around.
    expect(result.assembly?.order.map((p) => [p.fragment.source, p.flipped])).toEqual([
      ['pDest', false],
      ['insert1', true],
    ]);
    expect(result.assembly?.product.metadata.description).toContain(
      'insert1 (14 bp, GCTT, flipped)',
    );
  });

  it('leaves out the pieces the reaction keeps re-cutting', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const insert = linearPart('insert1', B, 'AAAAAAAAAA', A);
    const result = goldenGate([vector, insert], { enzyme: BsaI });
    expect(result.problem).toBeNull();
    // The vector's stuffer, and the insert's two flanks, all keep a BsaI site.
    expect(result.dropped.map((d) => d.reason)).toEqual(['site', 'site', 'site']);
    expect(result.dropped.every((d) => d.fragment.sequence.length > 0)).toBe(true);
  });

  it('will not guess when two parts offer the same overhang', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const one = linearPart('insert1', B, 'AAAAAAAAAA', A);
    const two = linearPart('insert2', B, 'TTTTTTTTTT', A);
    const result = goldenGate([vector, one, two], { enzyme: BsaI });
    expect(result.assembly).toBeNull();
    expect(result.problem).toContain('ambiguous');
    expect(result.problem).toContain('2 parts');
    // It still reports what it had to work with.
    expect(result.usable).toHaveLength(3);
  });

  it('says which overhang has nowhere to go', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    // Starts with C, not the B the vector leaves.
    const orphan = linearPart('insert1', C, 'AAAAAAAAAA', A);
    const result = goldenGate([vector, orphan], { enzyme: BsaI });
    expect(result.assembly).toBeNull();
    expect(result.problem).toContain('GCTT');
    expect(result.problem).toContain('pDest');
  });

  it('says when the parts chain but do not close', () => {
    const one = linearPart('insert1', A, 'AAAAAAAAAA', B);
    const two = linearPart('insert2', B, 'TTTTTTTTTT', C);
    const result = goldenGate([one, two], { enzyme: BsaI });
    expect(result.assembly).toBeNull();
    expect(result.problem).toContain('do not close into a circle');
  });

  it('circularises a single part whose own ends match', () => {
    const only = linearPart('insert1', A, 'AAAAAAAAAACCCC', A);
    const result = goldenGate([only], { enzyme: BsaI });
    expect(result.problem).toBeNull();
    expect(result.assembly?.product.sequence.toString()).toBe(`${A}AAAAAAAAAACCCC`);
    expect(result.assembly?.product.isCircular).toBe(true);
  });

  it('reports having nothing to work with', () => {
    const plain = SeqDocument.create({ name: 'plain', sequence: 'ACGTACGTACGTACGT' });
    const result = goldenGate([plain], { enzyme: BsaI });
    expect(result.usable).toEqual([]);
    expect(result.problem).toContain('Nothing to assemble');
    // An uncut linear molecule is one blunt-ended piece.
    expect(result.dropped.map((d) => d.reason)).toEqual(['blunt']);
    // An uncut circle gives nothing at all.
    const circle = SeqDocument.create({
      name: 'c',
      sequence: 'ACGTACGTACGTACGT',
      topology: 'circular',
    });
    expect(goldenGate([circle], { enzyme: BsaI }).dropped).toEqual([]);
  });

  it('takes a name for the product and makes one up otherwise', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const insert = linearPart('insert1', B, 'AAAAAAAAAA', A);
    expect(goldenGate([vector, insert], { enzyme: BsaI }).assembly?.product.name).toBe(
      'pDest+insert1 assembly',
    );
    expect(
      goldenGate([vector, insert], { enzyme: BsaI, name: 'pFinal' }).assembly?.product.name,
    ).toBe('pFinal');
  });
});

describe('Golden Gate II (#11)', () => {
  const BsmBI = getEnzyme('BsmBI');
  if (BsmBI === undefined) throw new Error('BsmBI is not in the enzyme table');
  /** A part made for BsmBI (CGTCTC N1/N5) rather than BsaI. */
  const bsmBIPart = (name: string, left: string, payload: string, right: string) =>
    SeqDocument.create({ name, sequence: `TTCGTCTCA${left}${payload}${right}AGAGACGTT` });

  it('mixes two enzymes in one tube', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const insert = bsmBIPart('insert', B, 'AAAAAAAAAA', A);
    // BsaI alone leaves the insert with its BsmBI sites and blunt ends.
    expect(goldenGate([vector, insert], { enzyme: BsaI }).assembly).toBeNull();
    const both = goldenGate([vector, insert], { enzyme: BsaI, secondEnzyme: BsmBI });
    expect(both.problem).toBeNull();
    expect(both.assembly?.product.sequence.toString()).toBe(`${A}CCCCCCCCCCCC${B}AAAAAAAAAA`);
    expect(both.assembly?.product.metadata.description).toMatch(/with BsaI and BsmBI/);
    // A piece that keeps a site says which enzyme's.
    const flank = both.dropped.find((d) => d.reason === 'site');
    expect(flank?.enzyme).toBeDefined();
  });

  it('warns about overhangs a ligase could confuse, and still assembles', () => {
    // AATG and AATC are one base apart.
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', 'AATC');
    const one = linearPart('insert1', 'AATC', 'AAAAAAAAAA', C);
    const two = linearPart('insert2', C, 'TTTTTTTTTT', A);
    const result = goldenGate([vector, one, two], { enzyme: BsaI });
    expect(result.assembly).not.toBeNull();
    expect(result.assembly?.warnings.map((w) => w.overhangs)).toEqual([['AATG', 'AATC']]);
    // A well-chosen set has nothing to say.
    const good = goldenGate(
      [
        circularPart('pDest', A, 'CCCCCCCCCCCC', B),
        linearPart('insert1', B, 'AAAAAAAAAA', C),
        linearPart('insert2', C, 'TTTTTTTTTT', A),
      ],
      { enzyme: BsaI },
    );
    expect(good.assembly?.warnings).toEqual([]);
  });
});

describe('overhangWarnings', () => {
  it('names palindromes, near neighbours either way round, and ambiguity codes', () => {
    const texts = (set: string[]) => overhangWarnings(set).map((w) => w.overhangs.join('/'));
    expect(texts(['GATC'])).toEqual(['GATC']);
    // CATT turned around is AATG: the two can pair.
    expect(texts(['AATG', 'CATT'])).toEqual(['AATG/CATT']);
    // CATA turned around is TATG, one base from AATG.
    expect(texts(['AATG', 'CATA'])).toEqual(['AATG/CATA']);
    expect(texts(['AANG'])).toEqual(['AANG']);
    expect(texts(['AATG', 'GCTT', 'CGCT'])).toEqual([]);
  });
});

describe('overhangsMatch', () => {
  it('lets an ambiguity code pair with any base it stands for', () => {
    expect(overhangsMatch('AATG', 'aatg')).toBe(true);
    expect(overhangsMatch('ANTG', 'AATG')).toBe(true);
    expect(overhangsMatch('ARTG', 'AGTG')).toBe(true);
    expect(overhangsMatch('ARTG', 'ACTG')).toBe(false);
    expect(overhangsMatch('AATG', 'AAT')).toBe(false);
  });
});

describe('Golden Gate, exactly (#77)', () => {
  it('starts the picker on BsmBI when the table has no BsaI', () => {
    setActiveEnzymeSet({
      ...BUNDLED_ENZYME_SET,
      enzymes: BUNDLED_ENZYME_SET.enzymes.filter((e) => e.name !== 'BsaI'),
    });
    try {
      expect(defaultGoldenGateEnzyme()?.name).toBe('BsmBI');
    } finally {
      setActiveEnzymeSet(null);
    }
  });

  it('keeps a part shorter than the recognition site', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    // Nothing between the overhangs: the piece is the four bases of B.
    const tiny = linearPart('tiny', B, '', A);
    const result = goldenGate([vector, tiny], { enzyme: BsaI });
    expect(result.problem).toBeNull();
    expect(result.usable.map((f) => f.sequence)).toEqual([`${A}CCCCCCCCCCCC`, B]);
    expect(result.assembly?.product.sequence.toString()).toBe(`${A}CCCCCCCCCCCC${B}`);
  });

  it('describes the product part by part', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const one = linearPart('insert1', B, 'AAAAAAAAAA', C);
    const two = linearPart('insert2', C, 'TTTTTTTTTT', A);
    const result = goldenGate([one, two, vector], { enzyme: BsaI });
    expect(result.assembly?.product.metadata.description).toBe(
      'Golden Gate assembly with BsaI of insert1 (14 bp, GCTT), insert2 (14 bp, CGCT), pDest (16 bp, AATG)',
    );
  });

  it('drops a piece with a blunt end on either side, and says there is nothing left', () => {
    // Two sites pointing outwards: the middle keeps both, and each flank
    // comes away with one sticky end and the blunt end of the molecule.
    const outward = SeqDocument.create({
      name: 'outward',
      sequence: `AAAAAAAAAAAAGAGACCTTTTGGTCTCAAAAAAAAAAAA`,
    });
    const one = goldenGate([outward], { enzyme: BsaI });
    expect(one.dropped.map((d) => [d.reason, d.fragment.left.kind, d.fragment.right.kind])).toEqual(
      [
        ['blunt', 'blunt', "5'"],
        ['site', "5'", "5'"],
        ['blunt', "5'", 'blunt'],
      ],
    );
    expect(one.usable).toEqual([]);
    expect(one.problem).toBe(
      'Nothing to assemble: no piece of the BsaI digest kept two sticky ends and lost its BsaI site.',
    );
    const BsmBI = getEnzyme('BsmBI');
    if (BsmBI === undefined) throw new Error('BsmBI is not in the enzyme table');
    expect(goldenGate([outward], { enzyme: BsaI, secondEnzyme: BsmBI }).problem).toBe(
      'Nothing to assemble: no piece of the BsaI and BsmBI digest kept two sticky ends and lost its sites.',
    );
  });

  it('drops a piece that is exactly the site', () => {
    const BsmBI = getEnzyme('BsmBI');
    if (BsmBI === undefined) throw new Error('BsmBI is not in the enzyme table');
    const doc = SeqDocument.create({
      name: 'exact',
      sequence: 'TTCGTCTCAGGTCTCAAAAAGAGACGTT',
    });
    // BsmBI cuts either side of the BsaI site, leaving a piece that is the
    // six bases of it and nothing more: still cut again.
    const result = goldenGate([doc], { enzyme: BsaI, secondEnzyme: BsmBI });
    expect(result.dropped.map((d) => [d.fragment.sequence, d.reason, d.enzyme])).toEqual([
      ['TTCGTCTCA', 'site', 'BsmBI'],
      ['GGTCTC', 'site', 'BsaI'],
      ['AAAAGAGACGTT', 'site', 'BsmBI'],
    ]);
    // Between the two enzymes' cuts on the right, one base with no site.
    expect(result.usable.map((f) => f.sequence)).toEqual(['A']);
  });

  it('says how many parts it never reached', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const orphan = linearPart('insert1', C, 'AAAAAAAAAA', A);
    expect(goldenGate([vector, orphan], { enzyme: BsaI }).problem).toBe(
      'No part starts with the overhang BsaI 5′ GCTT left by pDest. 1 of 2 parts were never reached.',
    );
  });

  it('will not guess which way round a part goes when its overhangs are palindromes', () => {
    const vector = circularPart('pDest', 'GATC', 'CCCCCCCCCCCC', 'GATC');
    const insert = linearPart('insert1', 'GATC', 'AAAAAAAAAA', 'GATC');
    expect(goldenGate([vector, insert], { enzyme: BsaI }).problem).toBe(
      'The overhang BsaI 5′ GATC lets the next part go in either way round, so the assembly is ambiguous.',
    );
  });

  it('keeps the pieces of a palindromic enzyme, which lose its site when cut', () => {
    const EcoRI = getEnzyme('EcoRI');
    if (EcoRI === undefined) throw new Error('EcoRI is not in the enzyme table');
    const circle = SeqDocument.create({
      name: 'pEco',
      topology: 'circular',
      sequence: 'GAATTCCCCCCCCCCCGAATTCGGGGGGGGGG',
    });
    const result = goldenGate([circle], { enzyme: EcoRI });
    expect(result.dropped).toEqual([]);
    expect(result.usable).toHaveLength(2);
  });

  it('says why each piece was left out', () => {
    const vector = circularPart('pDest', A, 'CCCCCCCCCCCC', B);
    const insert = linearPart('insert1', B, 'AAAAAAAAAA', A);
    const flank = goldenGate([vector, insert], { enzyme: BsaI }).dropped[0];
    if (flank === undefined) throw new Error('no dropped piece');
    expect(describeDropped(flank)).toBe(
      'still carries the BsaI site, so the reaction cuts it again',
    );
    expect(describeDropped({ fragment: flank.fragment, reason: 'site' })).toBe(
      'still carries the enzyme site, so the reaction cuts it again',
    );
    expect(describeDropped({ fragment: flank.fragment, reason: 'blunt' })).toBe(
      'has a blunt end, so there is no overhang to join it by',
    );
  });

  it('finds no risk in empty overhangs, nor between overhangs of different lengths', () => {
    expect(overhangWarnings(['', ''])).toEqual([]);
    expect(overhangWarnings(['AATG', 'AAT'])).toEqual([]);
  });
});
