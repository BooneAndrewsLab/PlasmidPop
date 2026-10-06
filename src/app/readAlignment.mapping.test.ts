import { alignEitherStrand, reverseComplement, TRACE_BASES } from '@/core';
import type { SequencingRead, TraceBase } from '@/core';

import {
  alignedReferenceRange,
  finishReadAlignment,
  prepareReadAlignment,
  readRange,
} from './readAlignment';

/**
 * Seeded property test of how a read's bases, trace and qualities map onto
 * the alignment (prepareReadAlignment, alignEitherStrand,
 * finishReadAlignment): every aligned read base, in every column, is the
 * base the read has there, the base its trace calls at that base's peak, and
 * has the quality the read stored for it, whether the read aligned forward
 * or reversed and whether the reference is linear or a circle the read
 * crosses the origin of. The read base maps back to the same base of the
 * stored read through readRange, and every reference letter is the letter of
 * the reference there, modulo its length on a circle.
 */

let seed = 12345;
/** A seeded uniform number in [0, 1). */
function rnd(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const pick = (s: string): string => s.charAt(Math.floor(rnd() * s.length));
const randomBases = (n: number): string => Array.from({ length: n }, () => pick('ACGT')).join('');

/** A read of `seq` with a one-colour peak per base and low quality at both ends. */
function makeRead(seq: string): SequencingRead {
  const spacing = 7;
  const samples = seq.length * spacing + 20;
  const channels = {
    A: new Int16Array(samples),
    C: new Int16Array(samples),
    G: new Int16Array(samples),
    T: new Int16Array(samples),
  };
  const peaks = new Int32Array(seq.length);
  let at = 10;
  for (let i = 0; i < seq.length; i++) {
    at += spacing + Math.floor(rnd() * 3) - 1;
    peaks[i] = at;
    channels[seq.charAt(i) as TraceBase][at] = 1000;
  }
  const qualities = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) {
    qualities[i] = i < 15 || i > seq.length - 15 ? 2 : 30 + Math.floor(rnd() * 10);
  }
  return { qualities, trace: { channels, peaks } };
}

/** The base the trace calls at base `i`'s peak: the colour with the signal there. */
function called(read: SequencingRead, i: number): string {
  const trace = read.trace;
  if (trace === null) return '?';
  const at = trace.peaks[i] ?? 0;
  return TRACE_BASES.find((b) => (trace.channels[b][at] ?? 0) > 0) ?? '?';
}

describe('read alignment: base, trace and quality mapping', () => {
  it('maps every aligned base of ~200 forward, reversed and wrapping reads', () => {
    const refLength = 400;
    const problems: string[] = [];
    let reads = 0;
    let bases = 0;
    let reversed = 0;
    let wrapped = 0;
    for (let trial = 0; trial < 330; trial++) {
      const reference = randomBases(refLength);
      const circular = trial % 3 === 0;
      const start = Math.floor(rnd() * refLength);
      const length = 120 + Math.floor(rnd() * 100);
      if (!circular && start + length > refLength) continue;
      let read = '';
      for (let i = 0; i < length; i++) {
        const base = reference.charAt((start + i) % refLength);
        const r = rnd();
        if (r < 0.02) read += pick('ACGT');
        else if (r < 0.03) continue;
        else if (r < 0.04) read += base + pick('ACGT');
        else read += base;
      }
      const reverse = trial % 2 === 1;
      const stored = reverse ? reverseComplement(read) : read;
      const sequencingRead = makeRead(stored);
      const prepared = prepareReadAlignment(
        { sequence: reference, offset: 0, wrap: circular ? refLength : null },
        { sequence: stored, read: sequencingRead },
        0.05,
      );
      if (!prepared.ok) continue;
      const result = finishReadAlignment(
        prepared.job,
        alignEitherStrand(prepared.job.a, prepared.job.b, { mode: 'local' }),
      );
      const trace = result.trace;
      const qualities = result.qualities;
      if (trace === null || qualities === null) {
        problems.push(`t${String(trial)}: no trace or qualities`);
        continue;
      }
      reads++;
      if (result.strand === 'reverse') reversed++;
      const oriented = result.strand === 'reverse' ? reverseComplement(stored) : stored;
      const al = result.alignment;
      if (circular && al.endA > refLength) wrapped++;
      let b = al.startB + result.offsetB;
      let a = al.startA;
      for (let c = 0; c < al.columns; c++) {
        const readBase = al.alignedB.charAt(c);
        const refBase = al.alignedA.charAt(c);
        const where = `t${String(trial)} col ${String(c)}`;
        if (readBase !== '-') {
          bases++;
          if (oriented.charAt(b) !== readBase) problems.push(`${where}: read base`);
          if (called(trace, b) !== readBase) problems.push(`${where}: trace call`);
          const stor = result.strand === 'reverse' ? stored.length - 1 - b : b;
          if (qualities[c] !== sequencingRead.qualities[stor]) problems.push(`${where}: quality`);
          const range = readRange(result, b, b + 1);
          const back =
            result.strand === 'reverse'
              ? reverseComplement(stored.charAt(range.start))
              : stored.charAt(range.start);
          if (range.end - range.start !== 1 || back !== readBase)
            problems.push(`${where}: readRange`);
          b++;
        }
        if (refBase !== '-') {
          if (reference.charAt(a % refLength) !== refBase)
            problems.push(`${where}: reference base`);
          a++;
        }
      }
      const span = alignedReferenceRange(result);
      if (!circular && span !== null && span.end - span.start !== al.endA - al.startA) {
        problems.push(`t${String(trial)}: reference range`);
      }
    }
    expect(reads).toBeGreaterThanOrEqual(200);
    expect(reversed).toBeGreaterThan(80);
    expect(wrapped).toBeGreaterThan(15);
    expect(bases).toBeGreaterThan(30000);
    expect(problems).toEqual([]);
  });
});
