import { SeqDocument, reverseComplement } from '@/core';
import { vi } from 'vitest';

import { designMultiOverlapPrimers } from './overlapAssembly';
import type * as YeastModule from './yeastAssembly';
import { yeastAssembly } from './yeastAssembly';

// The assembly the primers are checked against is the real one, except where a
// test makes it answer wrongly: the checks after it have inputs that the real
// assembler's answers never reach (#413).
vi.mock('./yeastAssembly', async (importOriginal) => {
  const actual = await importOriginal<typeof YeastModule>();
  return { ...actual, yeastAssembly: vi.fn(actual.yeastAssembly) };
});

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const VECTOR = filler(3000, 31);
const vector = SeqDocument.create({ name: 'pBack', sequence: VECTOR, topology: 'linear' });
const GENOME = filler(6000, 77);
const source = SeqDocument.create({ name: 'gDNA', sequence: GENOME, topology: 'linear' });
const A = { start: 500, end: 1300 };
const B = { start: 2500, end: 3400 };
const inserts = [A, B].map((region) => ({ template: source, region }));
/** The circle that was asked for: the vector, then each insert as read. */
const WANTED = VECTOR + GENOME.slice(A.start, A.end) + GENOME.slice(B.start, B.end);

let actualAssembly: typeof yeastAssembly;

beforeAll(async () => {
  actualAssembly = (await vi.importActual<typeof YeastModule>('./yeastAssembly')).yeastAssembly;
});

type Result = ReturnType<typeof yeastAssembly>;

/** Makes the next assembly say what `answer` makes of the real one's result. */
function answerWith(answer: (real: Result) => Result): void {
  vi.mocked(yeastAssembly).mockImplementationOnce((parts, options) =>
    answer(actualAssembly(parts, options)),
  );
}

/** The real result with its circle replaced by another sequence. */
function withCircle(sequence: string) {
  answerWith((real) => {
    const assembly = real.assembly;
    if (assembly === null) throw new Error('expected the real assembly to close');
    return {
      ...real,
      assembly: {
        ...assembly,
        product: SeqDocument.create({ name: 'other', sequence, topology: 'circular' }),
      },
    };
  });
}

describe('designMultiOverlapPrimers when the assembly answers otherwise', () => {
  it('says the amplicons do not close when the assembler gives no reason', () => {
    answerWith((real) => ({ ...real, assembly: null, problem: null }));
    const d = designMultiOverlapPrimers(vector, inserts, 'yeast');
    expect(d.problem).toBe('The amplicons and the vector do not close into a circle.');
    expect(d.product).toBeNull();
    expect(d.warnings).toEqual([]);
    // The primers that were made are still given back.
    expect(d.inserts).toHaveLength(2);
    expect(d.inserts[1]?.amplicon).not.toBeNull();
  });

  it('gives the assembler’s reason when it has one', () => {
    answerWith((real) => ({ ...real, assembly: null, problem: 'the parts do not meet' }));
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast').problem).toBe(
      'the parts do not meet',
    );
  });

  const NOT_ASKED =
    'The primers close into a circle, but not the one asked for: the pieces join in another order or share homology beyond the junctions.';

  it('refuses a circle whose pieces are in another order', () => {
    withCircle(VECTOR + GENOME.slice(B.start, B.end) + GENOME.slice(A.start, A.end));
    const d = designMultiOverlapPrimers(vector, inserts, 'yeast');
    expect(d.problem).toBe(NOT_ASKED);
    expect(d.product).toBeNull();
    expect(d.warnings).toEqual([]);
    expect(d.inserts).toHaveLength(2);
  });

  it('refuses a circle of another length, though it is a stretch of the right one', () => {
    withCircle(WANTED.slice(0, WANTED.length - 10));
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast').problem).toBe(NOT_ASKED);
  });

  it('accepts the circle where it is cut open, and read the other way round', () => {
    withCircle(WANTED.slice(1234) + WANTED.slice(0, 1234));
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast').problem).toBeNull();
    withCircle(reverseComplement(WANTED));
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast').problem).toBeNull();
    withCircle(reverseComplement(WANTED.slice(77) + WANTED.slice(0, 77)));
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast').problem).toBeNull();
  });
});
