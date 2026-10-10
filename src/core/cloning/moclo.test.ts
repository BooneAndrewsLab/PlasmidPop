import { SeqDocument, getEnzyme } from '@/core';

import {
  BUNDLED_STANDARDS,
  MAX_PLAN_COMBINATIONS,
  detectPlacement,
  parseStandardText,
  planAssemblies,
  planGaps,
  placementEnds,
} from './moclo';

const BsaI = getEnzyme('BsaI');
if (BsaI === undefined) throw new Error('BsaI is not in the enzyme table');
const options = { enzyme: BsaI };

const plant = BUNDLED_STANDARDS.find((s) => s.id === 'moclo-plant');
const ytk = BUNDLED_STANDARDS.find((s) => s.id === 'ytk');
if (plant === undefined || ytk === undefined) throw new Error('standard missing');

function linearPart(name: string, left: string, payload: string, right: string): SeqDocument {
  return SeqDocument.create({ name, sequence: `TTGGTCTCA${left}${payload}${right}AGAGACCTT` });
}
function destination(name: string, left: string, payload: string, right: string): SeqDocument {
  return SeqDocument.create({
    name,
    topology: 'circular',
    sequence: `${left}${payload}${right}AGAGACCTTTTGGTCTCA`,
  });
}

describe('bundled standards', () => {
  it('give every position overhangs of four bases and a unique name', () => {
    for (const s of BUNDLED_STANDARDS) {
      expect(new Set(s.positions.map((p) => p.name)).size).toBe(s.positions.length);
      for (const p of s.positions) {
        expect(p.left).toMatch(/^[ACGT]{4}$/);
        expect(p.right).toMatch(/^[ACGT]{4}$/);
      }
    }
  });

  it('chain the MoClo plant positions from promoter to terminator', () => {
    const at = (n: string) => plant.positions.find((p) => p.name === n);
    expect(at('Promoter')).toMatchObject({ left: 'GGAG', right: 'TACT' });
    expect(at('5′UTR')).toMatchObject({ left: 'TACT', right: 'AATG' });
    expect(at('CDS')).toMatchObject({ left: 'AATG', right: 'GCTT' });
    expect(at('3′UTR + terminator')).toMatchObject({ left: 'GCTT', right: 'CGCT' });
  });

  it('close the Yeast Toolkit ring, type 8 back to type 1', () => {
    const at = (n: string) => ytk.positions.find((p) => p.name === n);
    expect(at('Type 8')?.right).toBe(at('Type 1')?.left);
    expect(at('Type 1')?.right).toBe(at('Type 2')?.left);
    expect(at('Type 234')).toMatchObject({ left: 'AACG', right: 'GCTG' });
  });
});

describe('parseStandardText', () => {
  it('reads positions, a name line and an enzyme, skipping a header row', () => {
    const r = parseStandardText(
      '# My kit, BsmBI\nposition,left,right\nPro,ggag,tact\nCDS;TACT;GCTT\n',
      'kit.csv',
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.standard.name).toBe('My kit');
    expect(r.standard.enzyme).toBe('BsmBI');
    expect(r.standard.id).toBe('custom:my-kit');
    expect(r.standard.bundled).toBe(false);
    expect(r.standard.positions).toEqual([
      { name: 'Pro', left: 'GGAG', right: 'TACT' },
      { name: 'CDS', left: 'TACT', right: 'GCTT' },
    ]);
  });

  it('names the standard after the file when it has no name line', () => {
    const r = parseStandardText('A\tAAAA\tCCCC', 'goldenbraid.tsv');
    expect(r.ok && r.standard.name).toBe('goldenbraid');
  });

  it('says what is wrong rather than guessing', () => {
    expect(parseStandardText('', null)).toMatchObject({ ok: false });
    expect(parseStandardText('A,AAAA,CCNC', null)).toMatchObject({
      ok: false,
      error: 'Line 1 (A): the left and right overhangs should be 2 to 6 bases of A, C, G and T.',
    });
    expect(parseStandardText('A,AAAA,CCCC\nA,CCCC,GGGG', null)).toMatchObject({
      ok: false,
      error: 'The position A is listed twice.',
    });
    expect(parseStandardText(',AAAA,CCCC', null)).toMatchObject({ ok: false });
  });
});

describe('detectPlacement', () => {
  it('finds the position a part is cut for', () => {
    const doc = linearPart('pP', 'GGAG', 'AAAAAAAAAA', 'TACT');
    expect(detectPlacement(doc, plant, options)).toEqual({
      kind: 'position',
      position: 'Promoter',
      flipped: false,
    });
  });

  it('finds a part that was ordered back to front', () => {
    // GGAG...TACT read from the other strand: AGTA ... CTCC.
    const doc = linearPart('pRev', 'AGTA', 'TTTTTTTTTT', 'CTCC');
    expect(detectPlacement(doc, plant, options)).toEqual({
      kind: 'position',
      position: 'Promoter',
      flipped: true,
    });
  });

  it('recognises a destination by the junction it closes', () => {
    const dest = destination('pDest', 'CGCT', 'CCCCCCCCCC', 'GGAG');
    expect(detectPlacement(dest, plant, options)).toEqual({
      kind: 'destination',
      left: 'CGCT',
      right: 'GGAG',
    });
  });

  it('gives nothing for a part that is no position of the standard', () => {
    expect(detectPlacement(linearPart('x', 'AAAA', 'CCCCCCCC', 'GGGG'), plant, options)).toBeNull();
    expect(
      detectPlacement(SeqDocument.create({ name: 'plain', sequence: 'ACGTACGT' }), plant, options),
    ).toBeNull();
  });

  it('gives the ends of a placement', () => {
    expect(placementEnds(plant, { kind: 'position', position: 'CDS', flipped: false })).toEqual({
      left: 'AATG',
      right: 'GCTT',
    });
    expect(placementEnds(plant, { kind: 'position', position: 'nope', flipped: false })).toBeNull();
    expect(placementEnds(plant, { kind: 'destination', left: 'A', right: 'B' })).toEqual({
      left: 'A',
      right: 'B',
    });
  });
});

describe('planAssemblies', () => {
  const dest = destination('pDest', 'CGCT', 'CCCCCCCCCC', 'GGAG');
  const pro1 = linearPart('pro1', 'GGAG', 'AAAAAAAAAA', 'AATG');
  const pro2 = linearPart('pro2', 'GGAG', 'AAAACCCCAA', 'AATG');
  const cds1 = linearPart('cds1', 'AATG', 'TTTTTTTTTT', 'GCTT');
  const cds2 = linearPart('cds2', 'AATG', 'TTTTGGGGTT', 'GCTT');
  const term = linearPart('term', 'GCTT', 'GGGGGGGGGG', 'CGCT');
  const slot = (label: string, left: string, right: string, parts: SeqDocument[]) => ({
    label,
    left,
    right,
    parts: parts.map((d) => ({ id: d.name, document: d })),
  });
  const slots = [
    slot('Destination', 'CGCT', 'GGAG', [dest]),
    slot('Promoter + 5′UTR', 'GGAG', 'AATG', [pro1, pro2]),
    slot('CDS', 'AATG', 'GCTT', [cds1, cds2]),
    slot('3′UTR + terminator', 'GCTT', 'CGCT', [term]),
  ];

  it('makes a product for every combination', () => {
    const plan = planAssemblies(slots, options);
    expect(plan.total).toBe(4);
    expect(plan.tooMany).toBe(false);
    expect(plan.gaps).toEqual([]);
    expect(plan.products.every((p) => p.assembly !== null)).toBe(true);
    const seqs = new Set(plan.products.map((p) => p.assembly?.product.sequence.toString()));
    expect(seqs.size).toBe(4);
    expect(plan.products[0]?.parts.map((p) => p.id)).toEqual(['pDest', 'pro1', 'cds1', 'term']);
    expect(plan.products[3]?.name).toBe('pDest + pro2 + cds2 + term');
  });

  it('lists the combinations that cannot form, with the reason', () => {
    const bad = linearPart('cdsBad', 'AATG', 'TTTTTTTTTT', 'AAAA');
    const plan = planAssemblies(
      slots.map((s) => (s.label === 'CDS' ? slot('CDS', 'AATG', 'GCTT', [cds1, bad]) : s)),
      options,
    );
    expect(plan.products.filter((p) => p.assembly === null)).toHaveLength(2);
    expect(plan.products.filter((p) => p.assembly !== null)).toHaveLength(2);
    expect(plan.products.find((p) => p.assembly === null)?.problem).toEqual(expect.any(String));
  });

  it('reports ends no slot meets', () => {
    expect(planGaps(slots.filter((s) => s.label !== 'CDS'))).toEqual([
      'Nothing follows Promoter + 5′UTR: no slot starts with AATG.',
      'Nothing precedes 3′UTR + terminator: no slot ends with GCTT.',
    ]);
    expect(planGaps(slots.slice(0, 1))).toEqual([]);
  });

  it('runs nothing for an empty plan or for too many combinations', () => {
    expect(planAssemblies([], options)).toMatchObject({ total: 0, products: [] });
    const many = Array.from({ length: MAX_PLAN_COMBINATIONS + 1 }, () => pro1);
    const plan = planAssemblies([slot('X', 'GGAG', 'AATG', many)], options);
    expect(plan).toMatchObject({ total: MAX_PLAN_COMBINATIONS + 1, tooMany: true, products: [] });
    const empty = planAssemblies([slot('X', 'GGAG', 'AATG', [])], options);
    expect(empty.total).toBe(0);
  });
});
