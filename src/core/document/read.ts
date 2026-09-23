/**
 * What a sequencing read carries besides its bases: a quality for each base
 * and, from a capillary instrument (AB1), the four-colour trace the bases
 * were called from. A document read from an AB1 or FASTQ file keeps it
 * alongside its sequence (#49, decided in #53); an edit that changes the
 * bases drops it, since it would no longer describe them.
 */

export type TraceBase = 'A' | 'C' | 'G' | 'T';

export const TRACE_BASES: readonly TraceBase[] = ['A', 'C', 'G', 'T'];

export interface Trace {
  /** Signal per base, one sample per trace point; all four the same length. */
  readonly channels: Readonly<Record<TraceBase, Int16Array>>;
  /** The trace point of each base's peak, one per base. */
  readonly peaks: Int32Array;
}

export interface SequencingRead {
  /** Phred quality of each base, one per base (0 where the file had none). */
  readonly qualities: Uint8Array;
  readonly trace: Trace | null;
}

/** The trace's length in samples, 0 without a trace. */
export function traceLength(read: SequencingRead): number {
  return read.trace?.channels.A.length ?? 0;
}

/**
 * Throws unless `read` describes `length` bases: a quality per base and, with
 * a trace, a peak per base inside it and four channels of one length.
 */
export function assertValidRead(read: SequencingRead, length: number): void {
  if (read.qualities.length !== length) {
    throw new Error(`Read has ${read.qualities.length} qualities for ${length} bases`);
  }
  const trace = read.trace;
  if (trace === null) return;
  const samples = trace.channels.A.length;
  for (const base of TRACE_BASES) {
    if (trace.channels[base].length !== samples) {
      throw new Error('Trace channels differ in length');
    }
  }
  if (trace.peaks.length !== length) {
    throw new Error(`Trace has ${trace.peaks.length} peaks for ${length} bases`);
  }
  for (const p of trace.peaks) {
    if (p < 0 || p >= samples) throw new Error(`Trace peak ${p} outside 0–${samples - 1}`);
  }
}

/**
 * The read of the reverse complement: qualities in reverse order, and the
 * trace mirrored with each channel on its complement's (A's signal becomes
 * T's), so the peaks still sit under their bases.
 */
export function reverseComplementRead(read: SequencingRead): SequencingRead {
  const qualities = read.qualities.slice().reverse();
  const trace = read.trace;
  if (trace === null) return { qualities, trace: null };
  const last = trace.channels.A.length - 1;
  const mirrored = (c: Int16Array): Int16Array => c.slice().reverse();
  const peaks = trace.peaks.map((p) => last - p).reverse();
  return {
    qualities,
    trace: {
      channels: {
        A: mirrored(trace.channels.T),
        C: mirrored(trace.channels.G),
        G: mirrored(trace.channels.C),
        T: mirrored(trace.channels.A),
      },
      peaks,
    },
  };
}

/** The fraction of bases with a quality of at least `q`, 0 for no bases. */
export function fractionAtLeast(read: SequencingRead, q: number): number {
  const n = read.qualities.length;
  if (n === 0) return 0;
  let count = 0;
  for (const value of read.qualities) if (value >= q) count++;
  return count / n;
}
