import { useEffect, useMemo, useState } from 'react';

import { type SeqDocument, gcProfile } from '@/core';
import { analysisClient } from '@/workers/analysisClient';

/** Up to this many bases the profile is made inline, which costs a millisecond or two. */
export const GC_INLINE_LIMIT = 200_000;

/**
 * The sliding-window GC profile of `doc` (item 75), or null while `enabled`
 * is off or the answer is not in. A large sequence is computed in the
 * analysis worker, and the previous profile stays up in the meantime so the
 * track does not flicker with every edit; the answer is dropped if the
 * document or window moved on before it came back.
 */
export function useGcProfile(
  doc: SeqDocument,
  window: number,
  enabled: boolean,
): Float32Array | null {
  const circular = doc.topology === 'circular';
  const inline = useMemo(
    () =>
      enabled && doc.length <= GC_INLINE_LIMIT
        ? gcProfile(doc.sequence.toString(), window, circular)
        : null,
    [doc, window, circular, enabled],
  );
  const [remote, setRemote] = useState<Float32Array | null>(null);
  useEffect(() => {
    if (!enabled || doc.length <= GC_INLINE_LIMIT) return;
    let current = true;
    analysisClient
      .gcProfile(doc.sequence.toString(), window, circular)
      .then((profile) => {
        if (current) setRemote(profile);
      })
      .catch(() => {
        // The track is a convenience; without an answer it is simply not drawn.
      });
    return () => {
      current = false;
    };
  }, [doc, window, circular, enabled]);
  // A remote answer is only the answer while the sequence is one it is made for.
  return enabled && doc.length > GC_INLINE_LIMIT ? remote : inline;
}
