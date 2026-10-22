import { useEffect, useRef } from 'react';

import { hasTool, type SeqDocument } from '@/core';
import { analysisClient } from '@/workers/analysisClient';

import { editorStore } from './editorStore';
import { useEditorState } from './useEditorStore';

const DEBOUNCE_MS = 150;
/** Waits before each retry of a scan that failed; past the last, the error is shown. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 2000];

type Scan = 'sites' | 'orfs';

/**
 * Asks for one scan after the debounce and hands its answer to `apply`,
 * trying twice more if it fails (#138), then calling `fail`. Returns the
 * effect's cleanup, which drops an answer that comes after it.
 */
function schedule<T>(
  ask: () => Promise<T>,
  apply: (result: T) => void,
  fail: (why: string) => void,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (attempt: number): void => {
    ask()
      .then((result) => {
        if (!cancelled) apply(result);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // A failed scan left the results carried through the last edit in
        // place, provisional, and nothing would ask again until the next
        // edit (#138): try again, then say so rather than stay quiet.
        if (attempt < RETRY_DELAYS_MS.length) {
          timer = setTimeout(() => {
            run(attempt + 1);
          }, RETRY_DELAYS_MS[attempt]);
          return;
        }
        fail(e instanceof Error ? e.message : String(e));
      });
  };
  timer = setTimeout(() => {
    run(0);
  }, DEBOUNCE_MS);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

interface Failures {
  doc: SeqDocument | null;
  readonly scans: Set<Scan>;
}

/** Shows that a scan gave up, naming both when the other one did too for this document. */
function reportFailure(failed: Failures, doc: SeqDocument, scan: Scan, why: string): void {
  if (failed.doc !== doc) {
    failed.doc = doc;
    failed.scans.clear();
  }
  failed.scans.add(scan);
  const what =
    failed.scans.size === 2
      ? 'restriction sites and ORFs'
      : scan === 'sites'
        ? 'restriction sites'
        : 'ORFs';
  const next = failed.scans.has('sites') ? 'The digest waits for that scan; edit' : 'Edit';
  editorStore.fail(
    `Could not scan ${doc.name} for ${what} (${why}). ${next} the sequence or reload to try again.`,
  );
}

/**
 * Keeps store.analysis in step with the open document: whenever the document
 * (or the ORF threshold, or the genetic code) changes, waits a beat and
 * recomputes cut sites and ORFs on the worker. The two scans are stored as
 * each answers (#274): the restriction scan goes first on the one worker, and
 * the Enzymes tab does not wait for the ORFs behind it. Results for a document
 * that is no longer current are discarded by the store. Results the store
 * carried over from the previous document (`provisional`, `orfsProvisional`)
 * count as missing and are recomputed too. A scan that fails is tried again
 * twice before the error is shown.
 */
export function useAnalysis(): void {
  const { history, analysis, orfMinCodons, geneticCode } = useEditorState();
  const doc = history?.present ?? null;
  const current = analysis?.doc === doc ? analysis : null;
  const needSites = current?.cutSites == null || current.provisional;
  const needOrfs = current?.orfs == null || current.orfsProvisional;
  // Which scans have given up on which document, so a second failure says both.
  const failed = useRef<Failures>({ doc: null, scans: new Set() });

  useEffect(() => {
    if (doc === null || !needSites) return;
    // A protein has no sites to cut and no frames to read (#66).
    if (!hasTool(doc, 'enzymes')) {
      editorStore.setAnalysis(doc, [], []);
      return;
    }
    return schedule(
      () => analysisClient.cutSitesWithDigest(doc.sequence.toString(), doc.topology),
      ({ sites, digest }) => {
        editorStore.setCutSites(doc, sites, digest);
      },
      (why) => {
        reportFailure(failed.current, doc, 'sites', why);
      },
    );
  }, [doc, needSites]);

  useEffect(() => {
    if (doc === null || !needOrfs || !hasTool(doc, 'enzymes')) return;
    return schedule(
      () =>
        analysisClient.orfs(doc.sequence.toString(), doc.topology, {
          minCodons: orfMinCodons,
          table: geneticCode,
        }),
      (orfs) => {
        editorStore.setOrfs(doc, orfs);
      },
      (why) => {
        reportFailure(failed.current, doc, 'orfs', why);
      },
    );
  }, [doc, needOrfs, orfMinCodons, geneticCode]);
}
