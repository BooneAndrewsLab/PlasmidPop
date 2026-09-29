import { type PointerEvent, useEffect, useMemo, useState } from 'react';

import { type ReadAlignment, alignedRegionInDocument, alignedRegionSpan } from '../readAlignment';
import { editorStore } from '../state/editorStore';

/**
 * Pointing at an alignment finds where it is (#108): hovering or focusing
 * its heading draws the aligned region in both views without touching the
 * selection; clicking selects it and scrolls to it. The highlight is the
 * preview channel's 'align' span, so an edit, leaving the tab, the result
 * going away or the pointer or focus leaving all take it off again. A touch
 * has no hover, so a tap only selects.
 */
export function useAlignedRegionPointer(
  result: ReadAlignment,
  documentIsRead: boolean,
  docLength: number,
) {
  const [pointed, setPointed] = useState(false);
  const computed = alignedRegionSpan(result, documentIsRead, docLength);
  // `result` can be a fresh object every render (a batch row's is), so the
  // span is keyed by its numbers: a new identity must not re-run the effect,
  // whose cleanup commits to the store and renders again.
  const start = computed?.range.start ?? null;
  const end = computed?.range.end ?? null;
  const span = useMemo(
    () =>
      computed === null
        ? null
        : { ...computed, range: { start: computed.range.start, end: computed.range.end } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start, end],
  );
  useEffect(() => {
    if (!pointed || span === null) return;
    editorStore.setPreview('align', [span]);
    return () => {
      editorStore.clearPreview('align');
    };
  }, [pointed, span]);
  return {
    handlers: {
      onPointerEnter: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch') setPointed(true);
      },
      onPointerLeave: () => {
        setPointed(false);
      },
      onFocus: () => {
        setPointed(true);
      },
      onBlur: () => {
        setPointed(false);
      },
    },
    select: () => {
      // The selection shows the region now, so the pointer's highlight steps aside.
      setPointed(false);
      const range = alignedRegionInDocument(result, documentIsRead);
      if (range !== null) {
        editorStore.setSelection(range);
        editorStore.revealPosition(range.start);
      }
    },
  };
}
