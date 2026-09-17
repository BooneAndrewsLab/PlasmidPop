import { useEffect } from 'react';

import { analysisClient } from '@/workers/analysisClient';

import { editorStore } from './editorStore';
import { useEditorState } from './useEditorStore';

const DEBOUNCE_MS = 150;

/**
 * Keeps store.analysis in step with the open document: whenever the document
 * (or ORF threshold) changes, waits a beat and recomputes cut sites and ORFs
 * on the worker. Results for a document that is no longer current are
 * discarded by the store.
 */
export function useAnalysis(): void {
  const { history, analysis, orfMinCodons } = useEditorState();
  const doc = history?.present ?? null;

  useEffect(() => {
    if (doc === null || analysis?.doc === doc) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const text = doc.sequence.toString();
      Promise.all([
        analysisClient.cutSites(text, doc.topology),
        analysisClient.orfs(text, doc.topology, { minCodons: orfMinCodons }),
      ])
        .then(([cutSites, orfs]) => {
          if (!cancelled) editorStore.setAnalysis(doc, cutSites, orfs);
        })
        .catch((e: unknown) => {
          if (!cancelled) editorStore.fail(e instanceof Error ? e.message : String(e));
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [doc, analysis, orfMinCodons]);
}
