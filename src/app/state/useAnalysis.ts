import { useEffect } from 'react';

import { hasTool } from '@/core';
import { analysisClient } from '@/workers/analysisClient';

import { editorStore } from './editorStore';
import { useEditorState } from './useEditorStore';

const DEBOUNCE_MS = 150;
/** Waits before each retry of a scan that failed; past the last, the error is shown. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 2000];

/**
 * Keeps store.analysis in step with the open document: whenever the document
 * (or the ORF threshold, or the genetic code) changes, waits a beat and
 * recomputes cut sites and ORFs on the worker. Results for a document that is no longer current are
 * discarded by the store. Results the store carried over from the previous
 * document (`provisional`) count as missing and are recomputed too. A scan
 * that fails is tried again twice before the error is shown.
 */
export function useAnalysis(): void {
  const { history, analysis, orfMinCodons, geneticCode } = useEditorState();
  const doc = history?.present ?? null;

  useEffect(() => {
    if (doc === null || (analysis?.doc === doc && !analysis.provisional)) return;
    // A protein has no sites to cut and no frames to read (#66).
    if (!hasTool(doc, 'enzymes')) {
      editorStore.setAnalysis(doc, [], []);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (attempt: number): void => {
      const text = doc.sequence.toString();
      Promise.all([
        analysisClient.cutSites(text, doc.topology),
        analysisClient.orfs(text, doc.topology, { minCodons: orfMinCodons, table: geneticCode }),
      ])
        .then(([cutSites, orfs]) => {
          if (!cancelled) editorStore.setAnalysis(doc, cutSites, orfs);
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
          const why = e instanceof Error ? e.message : String(e);
          editorStore.fail(
            `Could not scan ${doc.name} for restriction sites and ORFs (${why}). ` +
              'The digest waits for that scan; edit the sequence or reload to try again.',
          );
        });
    };
    timer = setTimeout(() => {
      run(0);
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [doc, analysis, orfMinCodons, geneticCode]);
}
