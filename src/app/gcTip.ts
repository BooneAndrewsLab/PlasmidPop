import { type SeqDocument, formatGc } from '@/core';
import { type GcTrack } from '@/view/linear';

/**
 * What the GC track says at base `position`, for the tooltip: its value, the
 * window it is over and the base as the ruler numbers it (item 75).
 */
export function gcTip(
  track: GcTrack | null,
  position: number,
  doc: SeqDocument,
): string | undefined {
  const value = track?.profile[position];
  if (track === null || value === undefined) return undefined;
  const at = `base ${(position + 1).toLocaleString()}`;
  if (Number.isNaN(value)) return `No GC value at ${at}`;
  const window = Math.min(track.window, doc.length).toLocaleString();
  return `GC ${formatGc(value)} over ${window} bases around ${at}`;
}
