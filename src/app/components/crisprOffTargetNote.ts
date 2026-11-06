import { useState } from 'react';

import { rememberSeen, wasSeen } from '../state/seenOnce';

/** The off-target disclaimer is said once; afterwards the label keeps it as a tooltip. */
const NOTE_SEEN_KEY = 'plasmidpop.crisprOffTargetNoteSeen';
export const OFF_TARGET_NOTE =
  'Off-targets are counted in the open documents only. PlasmidPop has no genome to search, so this says nothing about specificity in a cell: check a guide against the host genome with a genome-wide tool before ordering it.';

/** Whether the off-target note has been acknowledged, and the way to acknowledge it. */
export function useOffTargetNote(): { readonly seen: boolean; readonly dismiss: () => void } {
  const [seen, setSeen] = useState(() => wasSeen(NOTE_SEEN_KEY));
  return {
    seen,
    dismiss: () => {
      rememberSeen(NOTE_SEEN_KEY);
      setSeen(true);
    },
  };
}
