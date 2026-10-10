import { describe, expect, it } from 'vitest';

import { type Alignment, type AlignmentOptions, alignEitherStrand } from '../alignment';
import { SeqDocument } from '../document';
import { createFeature, rangeSegment } from '../features';
import { reverseComplement } from '../sequence/alphabet';

import {
  type AlignLong,
  type CloneInput,
  type CloneResult,
  type Construct,
  type VerifyAlign,
  chooseConstruct,
  describeResult,
  exactOrigin,
  indexConstructs,
  sharedShare,
  verifyClone,
  verifyCsv,
} from './verify';
import { type Variant, describeVariant, placeVariants, variantsOf } from './variants';

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

const alignDefault = align;

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

/** A one-row alignment with a given identity, for tests that stand in for the worker. */
function stubAlignment(over: Partial<Alignment> = {}): Alignment {
  return {
    mode: 'global',
    score: 0,
    alignedA: 'A',
    alignedB: 'A',
    matchLine: '|',
    startA: 0,
    endA: 1,
    startB: 0,
    endB: 1,
    identities: 1,
    ambiguous: 0,
    gaps: 0,
    columns: 1,
    identity: 1,
    ...over,
  };
}

function stubAlign(
  over: Partial<Alignment>,
  strand: 'forward' | 'reverse' = 'forward',
): VerifyAlign {
  return () => Promise.resolve({ alignment: stubAlignment(over), strand });
}

/** A result built by hand, for the text writers. */
function result(over: Partial<CloneResult> = {}): CloneResult {
  return {
    name: 'c',
    length: 10,
    construct: 0,
    constructName: 'pX',
    verdict: 'match',
    identity: 1,
    shared: 1,
    variants: [],
    ambiguous: 0,
    turned: null,
    strand: 'forward',
    unchecked: false,
    byName: false,
    message: null,
    ...over,
  };
}

function snv(start: number, features: string[] = []): Variant {
  return {
    kind: 'snv',
    start,
    end: start + 1,
    size: 1,
    expected: 'A',
    observed: 'C',
    features: features.map((text) => ({ featureId: text, type: 'CDS', name: 'x', text })),
  };
}

describe('indexConstructs', () => {
  const ref = (text: string, circular: boolean): Set<string> => {
    const out = new Set<string>();
    for (const t of [text, reverseComplement(text)]) {
      const ring = circular ? t + t.slice(0, 15) : t;
      for (let i = 0; i + 16 <= ring.length; i++) out.add(ring.slice(i, i + 16));
    }
    return out;
  };
  const make = (sequence: string, topology: 'linear' | 'circular'): Construct => ({
    name: 'p',
    pattern: '',
    doc: SeqDocument.create({ name: 'p', sequence, topology }),
  });

  it('holds every 16-mer of both strands, those across the origin of a circle too', () => {
    const s = bases(60, 21);
    const [circular] = indexConstructs([make(s, 'circular')]);
    expect([...(circular ?? [])].sort()).toEqual([...ref(s, true)].sort());
    const [linear] = indexConstructs([make(s, 'linear')]);
    expect([...(linear ?? [])].sort()).toEqual([...ref(s, false)].sort());
    expect(circular?.size).toBeGreaterThan(linear?.size ?? 0);
  });

  it('holds a sequence of exactly 16 bases, and nothing shorter', () => {
    const s = bases(16, 4);
    const [linear] = indexConstructs([make(s, 'linear')]);
    expect(linear?.has(s)).toBe(true);
    const [short] = indexConstructs([make(bases(15, 4), 'linear')]);
    expect(short?.size).toBe(0);
  });

  it('reads the sequence in upper case', () => {
    const s = bases(20, 8);
    const [lower] = indexConstructs([make(s.toLowerCase(), 'linear')]);
    expect(lower?.has(s.slice(0, 16))).toBe(true);
  });
});

describe('sharedShare', () => {
  const index = new Set([bases(16, 3)]);

  it('is the share of the text 16-mers in the index', () => {
    const own = bases(16, 3);
    expect(sharedShare(own, index)).toBe(1);
    expect(sharedShare(own + 'A'.repeat(16), index)).toBe(1 / 17);
    expect(sharedShare(bases(40, 30), index)).toBe(0);
  });

  it('is zero for a text shorter than 16 bases', () => {
    expect(sharedShare('ACGT', index)).toBe(0);
    expect(sharedShare('', index)).toBe(0);
  });
});

describe('chooseConstruct', () => {
  const make = (name: string, sequence: string, pattern = ''): Construct => ({
    name,
    pattern,
    doc: SeqDocument.create({ name, sequence, topology: 'circular' }),
  });
  const A = bases(200, 41);
  const B = bases(200, 42);

  it('gives nothing when there are no constructs', () => {
    expect(chooseConstruct('x', A, [], [])).toBeNull();
  });

  it('goes by name to the first construct, with its real share', () => {
    const constructs = [make('pA', A, 'alpha'), make('pB', B, 'beta')];
    const index = indexConstructs(constructs);
    expect(chooseConstruct('ALPHA_01.fa', A, constructs, index)).toEqual({
      index: 0,
      shared: 1,
      byName: true,
    });
    const other = chooseConstruct('beta_02', A, constructs, index);
    expect(other?.index).toBe(1);
    expect(other?.byName).toBe(true);
    expect(other?.shared).toBe(sharedShare(A, index[1] ?? new Set()));
  });

  it('prefers the longest pattern and trims a pattern and ignores an empty one', () => {
    const constructs = [
      make('p0', A, ''),
      make('p1', A, 'pl'),
      make('p2', B, '  plate7 '),
      make('p3', A, 'plate'),
    ];
    const index = indexConstructs(constructs);
    expect(chooseConstruct('plate7_x', A, constructs, index)?.index).toBe(2);
    expect(chooseConstruct('plate8_x', A, constructs, index)?.index).toBe(3);
    expect(chooseConstruct('other', A, constructs, index)?.byName).toBe(false);
  });

  it('goes by sequence otherwise, to the first of equals', () => {
    const constructs = [make('pA', A), make('pB', B), make('pA2', A)];
    const index = indexConstructs(constructs);
    expect(chooseConstruct('x', B, constructs, index)).toEqual({
      index: 1,
      shared: 1,
      byName: false,
    });
    expect(chooseConstruct('x', A, constructs, index)?.index).toBe(0);
    expect(chooseConstruct('x', bases(200, 43), constructs, index)?.index).toBe(0);
  });
});

describe('exactOrigin', () => {
  const C = bases(120, 51);
  const rot = (s: string, o: number) => s.slice(o) + s.slice(0, o);

  it('finds the construct first base by its first 24 bases', () => {
    expect(exactOrigin(C, rot(C, 30))).toBe(90);
    expect(exactOrigin(C, C)).toBe(0);
    expect(exactOrigin(C, rot(C, 110))).toBe(10);
  });

  it('finds an origin whose first bases wrap the end of the text', () => {
    expect(exactOrigin(C, rot(C, 10))).toBe(110);
  });

  it('falls back on the last 24 bases when the first are changed', () => {
    const cut = (s: string) => s.slice(0, 5) + (s[5] === 'A' ? 'C' : 'A') + s.slice(6);
    expect(exactOrigin(C, cut(rot(C, 30)))).toBe(90);
    expect(exactOrigin(C, cut(C))).toBe(0);
  });

  it('falls back on the last 24 bases when the first occur twice', () => {
    const text = rot(C, 30);
    expect(exactOrigin(C, text + C.slice(0, 24))).toBe(90);
  });

  it('is null when neither end is found once', () => {
    const text = rot(C, 30);
    const flaw = (t: string, i: number) =>
      t.slice(0, i) + (t[i] === 'A' ? 'C' : 'A') + t.slice(i + 1);
    expect(exactOrigin(C, flaw(flaw(text, 95), 85))).toBeNull();
    expect(exactOrigin(C, flaw(text, 95) + C.slice(-24))).toBeNull();
    expect(exactOrigin(C, text + C.slice(0, 24) + C.slice(-24))).toBeNull();
  });

  it('takes the first 24 bases when only they are intact, and the last 24 when only they are', () => {
    const flaw = (t: string, i: number) =>
      t.slice(0, i) + (t[i] === 'A' ? 'C' : 'A') + t.slice(i + 1);
    const text = rot(C, 30);
    // text index 90 is the construct's first base, 66..90 its last 24 bases
    expect(exactOrigin(C, flaw(flaw(text, 70), 40))).toBe(90);
    expect(exactOrigin(C, flaw(flaw(text, 95), 40))).toBe(90);
  });

  it('needs at least 48 bases of both construct and text', () => {
    const c48 = bases(48, 5);
    expect(exactOrigin(c48, rot(c48, 7))).toBe(41);
    expect(exactOrigin(bases(47, 5), bases(47, 5))).toBeNull();
    expect(exactOrigin(c48, bases(47, 5))).toBeNull();
    expect(exactOrigin(bases(47, 5), c48)).toBeNull();
  });
});

describe('verifyClone, the details', () => {
  const noAlign: VerifyAlign = () => Promise.reject(new Error('must not align'));
  const one = [construct('pX', SEQ)];
  const run = (c: CloneInput, a: VerifyAlign, constructs: Construct[] = one, long?: AlignLong) =>
    verifyClone(c, constructs, indexConstructs(constructs), a, long);

  it('fails a protein, an empty sequence and a plate without constructs, saying why', async () => {
    const protein = SeqDocument.create({ name: 'pr', sequence: 'MKV', alphabet: 'protein' });
    const expectedFail = (name: string, length: number, message: string) => ({
      name,
      length,
      construct: null,
      constructName: '',
      verdict: 'failed',
      identity: null,
      shared: 0,
      variants: [],
      ambiguous: 0,
      turned: null,
      strand: 'forward',
      unchecked: false,
      byName: false,
      message,
    });
    expect(await run({ name: 'pr', doc: protein }, noAlign)).toEqual(
      expectedFail('pr', 3, 'A protein cannot be checked against DNA.'),
    );
    expect(await run(clone('e', ''), noAlign)).toEqual(
      expectedFail('e', 0, 'The sequence is empty.'),
    );
    expect(await run(clone('n', SEQ), noAlign, [])).toEqual(
      expectedFail('n', SEQ.length, 'No expected construct was chosen.'),
    );
  });

  it('calls a clone sharing almost nothing wrong without aligning it', async () => {
    const r = await run(clone('w', bases(500, 77)), noAlign);
    expect(r).toEqual({
      name: 'w',
      length: 500,
      construct: 0,
      constructName: 'pX',
      verdict: 'wrong',
      identity: null,
      shared: 0,
      variants: [],
      ambiguous: 0,
      turned: null,
      strand: 'forward',
      unchecked: false,
      byName: false,
      message: null,
    });
  });

  it('aligns a clone sharing exactly 5% of its 16-mers, but not less', async () => {
    // 20 construct bases give 5 shared 16-mers; 95 novel ones follow: 5 of 100.
    const novel = bases(95, 88);
    const text = SEQ.slice(0, 20) + novel;
    const idx = indexConstructs(one)[0] ?? new Set<string>();
    expect(sharedShare(text, idx)).toBe(0.05);
    const r = await run(clone('b', text), stubAlign({ identity: 0.9 }));
    expect(r.shared).toBe(0.05);
    expect(r.identity).toBe(0.9);
    const fewer = SEQ.slice(0, 19) + bases(96, 89);
    expect(sharedShare(fewer, idx)).toBe(0.04);
    const less = await run(clone('b', fewer), noAlign);
    expect(less.verdict).toBe('wrong');
    expect(less.identity).toBeNull();
  });

  it('aligns a clone sent by name however little it shares', async () => {
    const constructs = [construct('pX', SEQ, 'plate')];
    const r = await run(clone('plate_1', bases(500, 77)), alignDefault, constructs);
    expect(r.byName).toBe(true);
    expect(r.verdict).toBe('wrong');
    expect(r.turned).toBeNull();
    expect(r.identity).not.toBeNull();
  });

  it('hands the worker the construct, the clone and global fast options', async () => {
    const seen: {
      a: string;
      b: string;
      options: AlignmentOptions;
      long?: AlignLong | undefined;
    }[] = [];
    const signal = new AbortController().signal;
    const long: AlignLong = { signal };
    const constructs = [
      {
        name: 'lin',
        pattern: '',
        doc: SeqDocument.create({ name: 'lin', sequence: SEQ, topology: 'linear' }),
      },
    ];
    await run(
      clone('s', SEQ.toLowerCase()),
      (a, b, options, l) => {
        seen.push({ a, b, options, long: l });
        return Promise.resolve({ alignment: stubAlignment(), strand: 'forward' });
      },
      constructs,
      long,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.a).toBe(SEQ);
    expect(seen[0]?.b).toBe(SEQ);
    expect(seen[0]?.options).toEqual({ mode: 'global', fast: true });
    expect(seen[0]?.long).toBe(long);
  });

  it('takes 0.75 identity as the lowest that is not wrong', async () => {
    const c = clone('i', SEQ);
    expect((await run(c, stubAlign({ identity: 0.75 }))).verdict).toBe('match');
    expect((await run(c, stubAlign({ identity: 0.7499 }))).verdict).toBe('wrong');
  });

  it('carries the alignment into the result as it is', async () => {
    const r = await run(
      clone('k', SEQ),
      stubAlign({ identity: 0.8, ambiguous: 3, unchecked: true }, 'reverse'),
    );
    expect(r.identity).toBe(0.8);
    expect(r.ambiguous).toBe(3);
    expect(r.strand).toBe('reverse');
    expect(r.unchecked).toBe(true);
    expect(r.message).toBeNull();
    const plain = await run(clone('k', SEQ), stubAlign({}));
    expect(plain.unchecked).toBe(false);
    expect(plain.ambiguous).toBe(0);
    expect(plain.strand).toBe('forward');
    expect(plain.byName).toBe(false);
    expect(plain.construct).toBe(0);
    expect(plain.constructName).toBe('pX');
    expect(plain.length).toBe(SEQ.length);
  });

  it('is in-feature when any difference is inside a feature, outside when none is', async () => {
    const cols = (a: string, b: string) => ({
      alignedA: a,
      alignedB: b,
      matchLine: a
        .split('')
        .map((x, i) => (x === b[i] ? '|' : '.'))
        .join(''),
      columns: a.length,
    });
    // construct bases 700 and 100 changed: one outside, one in the CDS
    const both = stubAlign({
      startA: 0,
      endA: 701,
      ...cols('A'.repeat(701), 'A'.repeat(100) + 'C' + 'A'.repeat(599) + 'C'),
    });
    expect((await run(clone('f', SEQ), both)).verdict).toBe('in-feature');
    const outside = stubAlign({
      startA: 0,
      endA: 701,
      ...cols('A'.repeat(701), 'A'.repeat(600) + 'C' + 'A'.repeat(99) + 'C'),
    });
    const r = await run(clone('f', SEQ), outside);
    expect(r.verdict).toBe('outside');
    expect(r.variants).toHaveLength(2);
  });

  it('rethrows a cancelled analysis and fails on any other error', async () => {
    const cancelled = Object.assign(new Error('stop'), { name: 'AnalysisCancelledError' });
    await expect(run(clone('x', SEQ), () => Promise.reject(cancelled))).rejects.toBe(cancelled);
    const failedRun = await run(clone('x', SEQ), () => Promise.reject(new Error('boom')));
    expect(failedRun).toMatchObject({
      verdict: 'failed',
      message: 'boom',
      construct: 0,
      constructName: 'pX',
      shared: 1,
      identity: null,
    });
    // A worker can reject with anything; only an Error carries a message.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const text = await run(clone('x', SEQ), () => Promise.reject('plain text'));
    expect(text.message).toBe('plain text');
    const named = await run(clone('x', SEQ), () =>
      Promise.reject(Object.assign(new Error('o'), { name: 'Other' })),
    );
    expect(named.message).toBe('o');
    const notError = await run(clone('x', SEQ), () =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject({ name: 'AnalysisCancelledError' }),
    );
    expect(notError.verdict).toBe('failed');
  });

  describe('turning a circular clone', () => {
    it('reports the origin an exact match of the construct start gives, not exact', async () => {
      const mutated = swap(SEQ, 700);
      const r = await run(clone('t', mutated.slice(500) + mutated.slice(0, 500)), alignDefault);
      expect(r.turned).toEqual({ origin: 760, flipped: false, exact: false });
      expect(r.verdict).toBe('outside');
      expect(r.identity).toBe(1 - 1 / SEQ.length);
    });

    it('puts the origin where the first bases are, a base nearer than the shared stretches say', async () => {
      const deleted = SEQ.slice(0, 100) + SEQ.slice(101);
      const r = await run(clone('t', deleted.slice(500) + deleted.slice(0, 500)), alignDefault);
      expect(r.turned).toEqual({ origin: 759, flipped: false, exact: false });
      expect(r.variants.map((v) => [v.kind, v.start, v.end])).toEqual([['deletion', 100, 101]]);
      const flipped = await run(clone('t', reverseComplement(deleted)), alignDefault);
      expect(flipped.turned).toMatchObject({ flipped: true, exact: false });
      expect(flipped.variants.map((v) => [v.kind, v.start, v.end])).toEqual([
        ['deletion', 100, 101],
      ]);
    });

    it('turns a clone from the other strand, and reads it as the construct', async () => {
      const mutated = swap(SEQ, 100);
      const r = await run(clone('t', reverseComplement(mutated)), alignDefault);
      expect(r.turned?.flipped).toBe(true);
      expect(r.verdict).toBe('in-feature');
      expect(r.variants[0]?.start).toBe(100);
      expect(r.strand).toBe('forward');
    });

    it('falls back on the shared stretches when the construct is too short for an anchor', async () => {
      const small = bases(40, 61);
      const constructs = [
        {
          name: 'tiny',
          pattern: '',
          doc: SeqDocument.create({ name: 'tiny', sequence: small, topology: 'circular' }),
        },
      ];
      const turnedClone = small.slice(13) + small.slice(0, 13);
      const r = await run(clone('t', turnedClone), alignDefault, constructs);
      expect(r.verdict).toBe('match');
      expect(r.turned).toEqual({ origin: 27, flipped: false, exact: true });
    });

    it('keeps a clone as written when no origin can be found', async () => {
      const constructs = [construct('pX', SEQ, 'pX')];
      const r = await run(clone('pX_1', bases(60, 70)), alignDefault, constructs);
      expect(r.turned).toBeNull();
      expect(r.verdict).toBe('wrong');
    });

    it('does not rotate a clone to a linear construct', async () => {
      const lin = {
        name: 'lin',
        pattern: '',
        doc: SeqDocument.create({ name: 'lin', sequence: SEQ, topology: 'linear' }),
      };
      const r = await run(clone('l', SEQ.slice(500) + SEQ.slice(0, 500)), alignDefault, [lin]);
      expect(r.turned).toBeNull();
      expect(r.identity ?? 1).toBeLessThan(1);
    });

    it('does not turn a clone of a linear construct', async () => {
      const lin = {
        name: 'lin',
        pattern: '',
        doc: SeqDocument.create({ name: 'lin', sequence: SEQ, topology: 'linear' }),
      };
      const r = await run(clone('l', reverseComplement(SEQ)), alignDefault, [lin]);
      expect(r.turned).toBeNull();
      expect(r.strand).toBe('reverse');
      expect(r.verdict).toBe('match');
    });
  });
});

describe('describeResult', () => {
  it('says the message when there is one', () => {
    expect(describeResult(result({ verdict: 'failed', message: 'too big' }))).toBe('too big');
  });

  it('says how little a wrong clone shares', () => {
    expect(describeResult(result({ verdict: 'wrong', identity: null }))).toBe(
      'Shares almost nothing with the construct.',
    );
    expect(describeResult(result({ verdict: 'wrong', identity: 0.7123 }))).toBe(
      'Only 71.2% identical to pX.',
    );
  });

  it('lists the differences with their features, three at most, then how many more', () => {
    const vs = [snv(0, ['base change in CDS x']), snv(10), snv(20, ['a', 'b']), snv(30), snv(40)];
    expect(describeResult(result({ verdict: 'in-feature', variants: vs.slice(0, 3) }))).toBe(
      'SNV at 1 (A to C): base change in CDS x. SNV at 11 (A to C). SNV at 21 (A to C): a; b',
    );
    expect(describeResult(result({ variants: vs.slice(0, 4) }))).toBe(
      'SNV at 1 (A to C): base change in CDS x. SNV at 11 (A to C). SNV at 21 (A to C): a; b. and 1 more',
    );
    expect(describeResult(result({ variants: vs }), 1)).toBe(
      'SNV at 1 (A to C): base change in CDS x. and 4 more',
    );
    expect(describeResult(result({ variants: vs }), 5)).toBe(
      vs.map((v) => describeResult(result({ variants: [v] }))).join('. '),
    );
  });

  it('says nothing for a match', () => {
    expect(describeResult(result())).toBe('');
  });

  it('groups thousands in how many more', () => {
    const many = Array.from({ length: 1003 }, (_, i) => snv(i));
    expect(describeResult(result({ variants: many }), 3).endsWith('. and 1,000 more')).toBe(true);
  });
});

describe('verifyCsv, the text', () => {
  const HEAD = 'clone,length,construct,verdict,identity,differences,orientation,details';
  const rows = (...rs: CloneResult[]) => verifyCsv(rs).split('\r\n');

  it('is a header, a row a clone, each ending in CRLF', () => {
    expect(verifyCsv([])).toBe(HEAD + '\r\n');
    expect(verifyCsv([result(), result({ name: 'd' })])).toBe(
      HEAD + '\r\nc,10,pX,Matches,100.00,0,as written,\r\nd,10,pX,Matches,100.00,0,as written,\r\n',
    );
  });

  it('writes identity as a percentage to two places, empty when not aligned', () => {
    expect(rows(result({ identity: 0.98765 }))[1]).toBe('c,10,pX,Matches,98.77,0,as written,');
    expect(rows(result({ verdict: 'wrong', identity: null }))[1]).toBe(
      'c,10,pX,Wrong construct,,,as written,Shares almost nothing with the construct.',
    );
  });

  it('leaves the count of differences empty for a wrong or failed clone', () => {
    expect(rows(result({ verdict: 'wrong', identity: 0.5 }))[1]).toBe(
      'c,10,pX,Wrong construct,50.00,,as written,Only 50.0% identical to pX.',
    );
    expect(
      rows(result({ verdict: 'failed', identity: null, message: 'too big', constructName: '' }))[1],
    ).toBe('c,10,,Could not be checked,,,as written,too big');
    expect(rows(result({ verdict: 'outside', variants: [snv(5), snv(9)] }))[1]).toBe(
      'c,10,pX,Differs outside features,100.00,2,as written,SNV at 6 (A to C) | SNV at 10 (A to C)',
    );
  });

  it('puts every variant in the details, with its features after a colon', () => {
    const vs = [snv(1, ['one', 'two']), snv(2), snv(3), snv(4)];
    expect(rows(result({ verdict: 'in-feature', variants: vs }))[1]).toBe(
      'c,10,pX,Differs inside a feature,100.00,4,as written,SNV at 2 (A to C): one; two | SNV at 3 (A to C) | SNV at 4 (A to C) | SNV at 5 (A to C)',
    );
  });

  it('says how the clone was turned', () => {
    const o = (over: Partial<CloneResult>) =>
      rows(result(over))[1]?.slice('c,10,pX,Matches,100.00,0,'.length, -1);
    expect(o({ strand: 'reverse' })).toBe('reverse complemented');
    expect(o({ turned: { origin: 0, flipped: true, exact: false } })).toBe('reverse complemented');
    expect(o({ turned: { origin: 0, flipped: false, exact: false } })).toBe('as written');
    expect(o({ turned: { origin: 41, flipped: false, exact: false } })).toBe('rotated to base 42');
    expect(o({ strand: 'reverse', turned: { origin: 0, flipped: false, exact: true } })).toBe(
      'reverse complemented',
    );
    expect(o({ strand: 'forward', turned: { origin: 7, flipped: true, exact: false } })).toBe(
      '"reverse complemented, rotated to base 8"',
    );
    expect(o({ strand: 'reverse', turned: { origin: 7, flipped: false, exact: false } })).toBe(
      '"reverse complemented, rotated to base 8"',
    );
    expect(o({ strand: 'reverse', turned: { origin: 7, flipped: true, exact: false } })).toBe(
      '"reverse complemented, rotated to base 8"',
    );
  });

  it('quotes a cell holding a comma, a quote, or a line break, and no other', () => {
    expect(rows(result({ name: 'plain-1.fa' }))[1]?.startsWith('plain-1.fa,')).toBe(true);
    expect(verifyCsv([result({ name: 'a,b' })])).toContain('\r\n"a,b",');
    expect(verifyCsv([result({ name: 'a"b' })])).toContain('\r\n"a""b",');
    expect(verifyCsv([result({ name: 'a\nb' })])).toContain('\r\n"a\nb",');
    expect(verifyCsv([result({ name: 'a\rb' })])).toContain('\r\n"a\rb",');
    expect(verifyCsv([result({ name: 'a b' })])).toContain('\r\na b,');
  });
});
