import { describe, expect, it } from 'vitest';

import { alignEitherStrand } from '../alignment';
import { SeqDocument } from '../document';
import { createFeature, rangeSegment } from '../features';
import { reverseComplement } from '../sequence/alphabet';

import {
  type CloneInput,
  type Construct,
  type VerifyAlign,
  describeResult,
  indexConstructs,
  verifyClone,
  verifyCsv,
} from './verify';
import { describeVariant, placeVariants, variantsOf } from './variants';

/** Deterministic pseudo-random bases, so tests need no fixture files. */
function bases(n: number, seed: number): string {
  let s = seed;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((s >> 16) & 3);
  }
  return out;
}

const align: VerifyAlign = (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options));

const BACKBONE = bases(900, 7);
const GENE = bases(300, 11);
const PROMOTER = bases(60, 13);
// promoter 0..60, gene 60..360, backbone after
const SEQ = PROMOTER + GENE + BACKBONE;

function construct(name: string, sequence: string, pattern = ''): Construct {
  const doc = SeqDocument.create({
    name,
    sequence,
    topology: 'circular',
    features: [
      createFeature({ type: 'promoter', name: 'pLac', segments: [rangeSegment(0, 60)] }),
      createFeature({ type: 'CDS', name: 'bla', segments: [rangeSegment(60, 360)] }),
      createFeature({ type: 'source', name: '', segments: [rangeSegment(0, sequence.length)] }),
    ],
  });
  return { name, doc, pattern };
}

function clone(name: string, sequence: string): CloneInput {
  return { name, doc: SeqDocument.create({ name, sequence }) };
}

async function check(c: CloneInput, constructs: Construct[] = [construct('pX', SEQ)]) {
  return verifyClone(c, constructs, indexConstructs(constructs), align);
}

function swap(text: string, at: number): string {
  const was = text.charAt(at);
  return text.slice(0, at) + (was === 'A' ? 'C' : 'A') + text.slice(at + 1);
}

describe('variantsOf', () => {
  it('groups columns into SNV, substitution, insertion and deletion', () => {
    const a = 'ACGTACGTACGTACGTACGT';
    const b = 'ACGTTCGTACGGGTACGTACGT'.replace('GGG', 'GG');
    const r = alignEitherStrand(a, b, { mode: 'global' }).alignment;
    const kinds = variantsOf(r).map((v) => v.kind);
    expect(kinds).toContain('snv');
  });

  it('calls a long gap a region', () => {
    const a = bases(200, 3);
    const r = alignEitherStrand(a, a.slice(0, 80) + a.slice(120), { mode: 'global' }).alignment;
    const [v] = variantsOf(r);
    expect(v?.kind).toBe('missing');
    expect(v?.size).toBe(40);
    expect(v?.start).toBe(80);
    expect(v?.end).toBe(120);
  });
});

describe('placeVariants', () => {
  const c = construct('pX', SEQ);
  const place = (start: number, end: number, kind: 'snv' | 'insertion' | 'deletion', size = 1) =>
    placeVariants(
      [{ kind, start, end, size, expected: '', observed: '', features: [] }],
      c.doc.features,
      c.doc.length,
    )[0]?.features.map((f) => f.text);

  it('names the feature a base change is in, and never the source', () => {
    expect(place(10, 11, 'snv')).toEqual(['promoter pLac changed']);
    expect(place(100, 101, 'snv')).toEqual(['base change in CDS bla']);
    expect(place(500, 501, 'snv')).toEqual([]);
  });

  it('calls an indel that is not a multiple of three a frameshift', () => {
    expect(place(100, 101, 'deletion', 1)).toEqual(['frameshift in CDS bla']);
    expect(place(100, 100, 'insertion', 4)).toEqual(['frameshift in CDS bla']);
    expect(place(100, 103, 'deletion', 3)).toEqual(['in-frame deletion of 3 bp in CDS bla']);
  });

  it('puts an insertion at a feature edge outside it', () => {
    expect(place(60, 60, 'insertion', 2)).toEqual([]);
    expect(place(360, 360, 'insertion', 2)).toEqual([]);
    expect(place(61, 61, 'insertion', 2)).toEqual(['frameshift in CDS bla']);
  });

  it('says a deletion covering a feature deleted it', () => {
    expect(place(55, 365, 'deletion', 310)).toEqual(['promoter pLac changed', 'CDS bla deleted']);
  });
});

describe('verifyClone', () => {
  it('matches an identical clone', async () => {
    const r = await check(clone('c1', SEQ));
    expect(r.verdict).toBe('match');
    expect(r.variants).toHaveLength(0);
    expect(r.identity).toBe(1);
  });

  it('matches a clone written from another origin and on the other strand', async () => {
    const rotated = SEQ.slice(500) + SEQ.slice(0, 500);
    const r = await check(clone('c2', reverseComplement(rotated)));
    expect(r.verdict).toBe('match');
    expect(r.turned).not.toBeNull();
  });

  it('puts a base change in a feature, positions in the construct numbering', async () => {
    const mutated = swap(SEQ, 100);
    const r = await check(clone('c3', mutated.slice(700) + mutated.slice(0, 700)));
    expect(r.verdict).toBe('in-feature');
    expect(r.variants).toHaveLength(1);
    expect(r.variants[0]?.start).toBe(100);
    expect(describeResult(r)).toContain('base change in CDS bla');
    expect(r.variants.map(describeVariant)[0]).toMatch(/SNV at 101/);
  });

  it('reports a frameshift', async () => {
    const r = await check(clone('c4', SEQ.slice(0, 150) + SEQ.slice(151)));
    expect(r.verdict).toBe('in-feature');
    expect(r.variants[0]?.features[0]?.text).toBe('frameshift in CDS bla');
  });

  it('is outside features when only the backbone differs', async () => {
    const r = await check(clone('c5', swap(SEQ, 700)));
    expect(r.verdict).toBe('outside');
  });

  it('calls a clone of another plasmid the wrong construct', async () => {
    const r = await check(clone('c6', bases(1260, 99)));
    expect(r.verdict).toBe('wrong');
  });

  it('is wrong when most of the construct is missing', async () => {
    const r = await check(clone('c7', SEQ.slice(0, 300)));
    expect(r.verdict).toBe('wrong');
  });

  it('fails a clone it cannot align and goes on', async () => {
    const constructs = [construct('pX', SEQ)];
    const r = await verifyClone(clone('c8', SEQ), constructs, indexConstructs(constructs), () =>
      Promise.reject(new Error('too big')),
    );
    expect(r.verdict).toBe('failed');
    expect(r.message).toBe('too big');
  });

  it('sends each clone to the construct it fits best', async () => {
    const other = bases(1000, 5);
    const constructs = [construct('pA', SEQ), construct('pB', other)];
    const index = indexConstructs(constructs);
    const a = await verifyClone(clone('x', swap(SEQ, 700)), constructs, index, align);
    const b = await verifyClone(clone('y', other), constructs, index, align);
    expect([a.constructName, b.constructName]).toEqual(['pA', 'pB']);
    expect(b.verdict).toBe('match');
  });

  it('uses a name pattern before the sequence', async () => {
    const constructs = [construct('pA', SEQ, 'plate1'), construct('pB', bases(1000, 5), 'plate2')];
    const index = indexConstructs(constructs);
    const r = await verifyClone(clone('plate2_A01.fa', SEQ), constructs, index, align);
    expect(r.constructName).toBe('pB');
    expect(r.byName).toBe(true);
    expect(r.verdict).toBe('wrong');
  });
});

describe('verifyCsv', () => {
  it('writes a row a clone, quoting what needs it', async () => {
    const r = await check(clone('a,"b"', swap(SEQ, 100)));
    const lines = verifyCsv([r]).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'clone,length,construct,verdict,identity,differences,orientation,details',
    );
    expect(lines[1]).toContain('"a,""b"""');
    expect(lines[1]).toContain('Differs inside a feature');
  });
});
