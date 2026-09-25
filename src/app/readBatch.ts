import { type AlignmentOptions, type StrandedAlignment, readDifferences } from '@/core';
import { AnalysisCancelledError, type LongRequestOptions } from '@/workers/analysisClient';

import {
  type ReadAlignment,
  type ReadInput,
  type ReferenceInput,
  alignedReferenceRange,
  finishReadAlignment,
  prepareReadAlignment,
} from './readAlignment';

/**
 * Every record of a file aligned against the document, one after another
 * (#59): the usual way to check a batch of clones, a plate of Sanger reads
 * or a FASTQ of them. Each alignment is its own request to the analysis
 * worker, so the main thread only waits, a cancel stops the one running,
 * and each row is shown as soon as it is done.
 */

/** At most this many records go into one batch: a 96-well plate. */
export const BATCH_LIMIT = 96;

export interface BatchRead extends ReadInput {
  readonly name: string;
}

export type BatchRow =
  | {
      readonly index: number;
      readonly name: string;
      readonly length: number;
      readonly status: 'aligned';
      readonly result: ReadAlignment;
    }
  | {
      readonly index: number;
      readonly name: string;
      readonly length: number;
      readonly status: 'failed';
      readonly message: string;
    };

/** One alignment in the worker: `analysisClient.alignEitherStrand`, or a stand-in in tests. */
export type AlignRequest = (
  a: string,
  b: string,
  options: AlignmentOptions,
  long: LongRequestOptions,
) => Promise<StrandedAlignment>;

export interface BatchOptions {
  readonly options: AlignmentOptions;
  /** Error rate to trim reads with qualities at, or null not to trim. */
  readonly trimCutoff: number | null;
  /** Told each row as it is done, in the records' order. */
  readonly onRow?: (row: BatchRow) => void;
  /** Told the fraction of the whole batch done. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

export interface BatchOutcome {
  readonly rows: readonly BatchRow[];
  /** True when a cancel stopped it; `rows` are those done before. */
  readonly cancelled: boolean;
}

/**
 * Aligns `reads` to `reference` in order. A record that cannot be aligned
 * (nothing left after trimming, too large, a worker error) is a failed row
 * and the next one goes on; a cancel stops the batch and keeps what was
 * done. Throws only for more than `BATCH_LIMIT` reads.
 */
export async function runReadBatch(
  reads: readonly BatchRead[],
  reference: ReferenceInput,
  align: AlignRequest,
  { options, trimCutoff, onRow, onProgress, signal }: BatchOptions,
): Promise<BatchOutcome> {
  if (reads.length > BATCH_LIMIT) {
    throw new Error(`At most ${BATCH_LIMIT} reads are aligned at once; this has ${reads.length}`);
  }
  const rows: BatchRow[] = [];
  const n = reads.length;
  for (let index = 0; index < n; index++) {
    if (signal?.aborted === true) return { rows, cancelled: true };
    const input = reads[index];
    if (input === undefined) continue;
    const base = { index, name: input.name, length: input.sequence.length };
    let row: BatchRow;
    const prepared = prepareReadAlignment(
      reference,
      input,
      input.read === null ? null : trimCutoff,
    );
    if (!prepared.ok) {
      row = { ...base, status: 'failed', message: prepared.message };
    } else {
      const { job } = prepared;
      try {
        const best = await align(job.a, job.b, options, {
          ...(onProgress === undefined
            ? {}
            : {
                onProgress: (f: number) => {
                  onProgress((index + f) / n);
                },
              }),
          ...(signal === undefined ? {} : { signal }),
        });
        row = { ...base, status: 'aligned', result: finishReadAlignment(job, best) };
      } catch (e: unknown) {
        if (e instanceof AnalysisCancelledError) return { rows, cancelled: true };
        row = { ...base, status: 'failed', message: e instanceof Error ? e.message : String(e) };
      }
    }
    rows.push(row);
    onRow?.(row);
    onProgress?.((index + 1) / n);
  }
  return { rows, cancelled: false };
}

/** How the rows are ordered: as in the file, or by identity either way. */
export type BatchOrder = 'file' | 'identity-low' | 'identity-high';

/** A row's numbers, as the list shows them and sorts by. */
export interface BatchSummary {
  readonly identity: number;
  /** Differences on confident bases, or null for a read without qualities. */
  readonly confident: number | null;
  /** Every difference: mismatches and gap columns. */
  readonly differences: number;
  /** The reference stretch covered, 1-based inclusive in its own numbering, wrapped. */
  readonly span: { readonly from: number; readonly to: number } | null;
}

export function summarizeRow(
  row: Extract<BatchRow, { status: 'aligned' }>,
  confidentFrom: number,
): BatchSummary {
  const { result } = row;
  const diffs = readDifferences(result.alignment, result.qualities ?? [], confidentFrom);
  const range = alignedReferenceRange(result);
  const wrap = (p: number): number => (result.wrap === null ? p : p % result.wrap);
  return {
    identity: result.alignment.identity,
    confident: result.qualities === null ? null : diffs.filter((d) => d.confident).length,
    differences: diffs.length,
    span: range === null ? null : { from: wrap(range.start) + 1, to: wrap(range.end - 1) + 1 },
  };
}

/**
 * The rows in `order`. Identity ties keep the file's order, and failed rows
 * go last whichever way, since they have no identity to sort by.
 */
export function sortRows(
  rows: readonly BatchRow[],
  order: BatchOrder,
  confidentFrom: number,
): BatchRow[] {
  if (order === 'file') return [...rows];
  const key = (r: BatchRow): number =>
    r.status === 'aligned' ? summarizeRow(r, confidentFrom).identity : Number.NaN;
  const sign = order === 'identity-low' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (Number.isNaN(ka) || Number.isNaN(kb)) {
      return Number(Number.isNaN(ka)) - Number(Number.isNaN(kb)) || a.index - b.index;
    }
    return sign * (ka - kb) || a.index - b.index;
  });
}
