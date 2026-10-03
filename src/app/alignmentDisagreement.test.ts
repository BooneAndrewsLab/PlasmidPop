import { alignEitherStrand } from '@/core';

import {
  agreementColumns,
  callsAt,
  disagreementColumns,
  disagreesAt,
} from './alignmentDisagreement';
import { stackAlignments } from './alignmentStack';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
const ref = { sequence: reference, offset: 0, wrap: null };

/** The reference with `base` put at `at`. */
function mutate(at: number, base: string, seq = reference): string {
  return seq.slice(0, at) + base + seq.slice(at + 1);
}

interface Read {
  readonly sequence: string;
  readonly quality?: number | readonly number[];
}

function stackOf(reads: Read[]) {
  const samples = reads.map(({ sequence, quality }, i) => {
    const read =
      quality === undefined
        ? null
        : {
            qualities: Uint8Array.from(
              typeof quality === 'number'
                ? new Array<number>(sequence.length).fill(quality)
                : quality,
            ),
            trace: null,
          };
    const prepared = prepareReadAlignment(ref, { sequence, read }, null);
    if (!prepared.ok) throw new Error(prepared.message);
    const { job } = prepared;
    return {
      name: `r${i}`,
      result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
    };
  });
  return stackAlignments(ref, samples);
}

const other = (b: string): string => (b === 'A' ? 'C' : 'A');

describe('disagreementColumns', () => {
  it('marks a column where two samples carry different bases', () => {
    const base = reference.charAt(20);
    const x = other(base);
    const y = base === 'G' ? 'T' : 'G';
    const stack = stackOf([{ sequence: mutate(20, x) }, { sequence: mutate(20, y) }]);
    expect(disagreementColumns(stack, 20)).toEqual([20]);
  });

  it('marks a column where one sample matches the document and the other does not', () => {
    const stack = stackOf([
      { sequence: reference },
      { sequence: mutate(20, other(reference.charAt(20))) },
    ]);
    expect(disagreementColumns(stack, 20)).toEqual([20]);
  });

  it('does not mark a difference every sample shares, and calls it agreement', () => {
    const x = other(reference.charAt(20));
    const stack = stackOf([{ sequence: mutate(20, x) }, { sequence: mutate(20, x) }]);
    expect(stack.differences).toEqual([20]);
    expect(disagreementColumns(stack, 20)).toEqual([]);
    expect(agreementColumns(stack, 20)).toEqual([20]);
  });

  it('does not call a lone sample an agreement, or a disagreement', () => {
    const stack = stackOf([{ sequence: mutate(20, other(reference.charAt(20))) }]);
    expect(disagreementColumns(stack, 20)).toEqual([]);
    expect(agreementColumns(stack, 20)).toEqual([]);
  });

  it('ignores a poor-quality base when the sample has qualities', () => {
    const x = other(reference.charAt(20));
    const quality = new Array<number>(reference.length).fill(40);
    quality[20] = 5;
    const stack = stackOf([
      { sequence: reference, quality: 40 },
      { sequence: mutate(20, x), quality },
    ]);
    expect(disagreementColumns(stack, 20)).toEqual([]);
    expect(disagreesAt(stack, 20, 2)).toBe(true);
  });

  it('counts a deletion against a base, but not the padding another sample insertion leaves', () => {
    const deleted = reference.slice(0, 20) + reference.slice(21);
    const stack = stackOf([{ sequence: deleted }, { sequence: reference }]);
    expect(disagreementColumns(stack, 20)).toContain(20);
    const inserted = reference.slice(0, 30) + 'T' + reference.slice(30);
    const withInsertion = stackOf([{ sequence: inserted }, { sequence: reference }]);
    // The column holds the insertion: the other sample's padding takes no part.
    const column = withInsertion.reference.indexOf('-');
    expect(callsAt(withInsertion, column, 20)).toHaveLength(1);
    expect(disagreementColumns(withInsertion, 20)).toEqual([]);
  });

  it('takes an ambiguity code as no call', () => {
    const stack = stackOf([{ sequence: mutate(20, 'N') }, { sequence: reference }]);
    expect(callsAt(stack, 20, 20)).toEqual([reference.charAt(20)]);
    expect(disagreementColumns(stack, 20)).toEqual([]);
  });

  it('is empty for one row', () => {
    expect(disagreementColumns(stackOf([{ sequence: reference }]), 20)).toEqual([]);
  });
});
