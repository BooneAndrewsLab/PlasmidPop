import {
  type CloneInput,
  type CloneResult,
  type Construct,
  type VerifyAlign,
  indexConstructs,
  verifyClone,
} from '@/core';
import { readSequenceData } from '@/io';
import { AnalysisCancelledError } from '@/workers/analysisClient';

/**
 * Verify clones (#218, item 80): the plate's files read into clones, and the
 * clones checked one after another, each its own request to the analysis
 * worker so the main thread only waits and a cancel stops the one running.
 */

/** At most this many clones are checked at once: a 384-well plate. */
export const CLONE_LIMIT = 384;

export interface ReadClones {
  readonly clones: readonly CloneInput[];
  /** Files that held no sequence or could not be read, with why. */
  readonly problems: readonly string[];
}

/**
 * The clones in `files`: a file with one record is named by the file, one
 * with several by the file and the record. DNA only; a protein record is
 * reported, not checked.
 */
export async function readCloneFiles(files: readonly File[]): Promise<ReadClones> {
  const clones: CloneInput[] = [];
  const problems: string[] = [];
  for (const file of files) {
    try {
      const result = await readSequenceData(await file.arrayBuffer(), file.name);
      const docs = result.documents.filter((d) => !d.isProtein);
      if (docs.length === 0) {
        problems.push(`${file.name}: no DNA sequence in it.`);
        continue;
      }
      for (const doc of docs) {
        const many = result.documents.length > 1;
        clones.push({ name: many ? `${file.name} · ${doc.name}` : file.name, doc });
      }
    } catch (e: unknown) {
      problems.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { clones, problems };
}

export interface VerifyOptions {
  readonly onResult?: (result: CloneResult, index: number) => void;
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/**
 * Every clone checked, in order. A clone that cannot be is a `failed` row and
 * the next one goes on; a cancel stops and keeps what was done. Throws only
 * for more than `CLONE_LIMIT` clones.
 */
export async function verifyPlate(
  clones: readonly CloneInput[],
  constructs: readonly Construct[],
  align: VerifyAlign,
  { onResult, onProgress, signal }: VerifyOptions = {},
): Promise<{ readonly results: readonly CloneResult[]; readonly cancelled: boolean }> {
  if (clones.length > CLONE_LIMIT) {
    throw new Error(`At most ${CLONE_LIMIT} clones are checked at once; this has ${clones.length}`);
  }
  const aborted = (): boolean => signal?.aborted === true;
  const index = indexConstructs(constructs);
  const results: CloneResult[] = [];
  const n = clones.length;
  for (let i = 0; i < n; i++) {
    if (aborted()) return { results, cancelled: true };
    const clone = clones[i];
    if (clone === undefined) continue;
    try {
      const result = await verifyClone(clone, constructs, index, align, {
        onProgress: (f) => {
          onProgress?.((i + f) / n);
        },
        ...(signal === undefined ? {} : { signal }),
      });
      results.push(result);
      onResult?.(result, i);
    } catch (e: unknown) {
      if (e instanceof AnalysisCancelledError || aborted()) {
        return { results, cancelled: true };
      }
      throw e;
    }
    onProgress?.((i + 1) / n);
  }
  return { results, cancelled: false };
}
