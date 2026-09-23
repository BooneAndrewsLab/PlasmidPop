import { useMemo } from 'react';

import { type GelOptions, gelForAgarose } from '@/core';

import { useEditorState } from './useEditorStore';

/**
 * The gel rules for the percentage chosen under any drawn gel (item 41).
 * Everything that judges a lane — the ⚠ on a row, the band-separation order,
 * the double digests, the PCR lane — reads them from here, so the picture
 * and the verdicts are always about the same gel.
 */
export function useGelOptions(): Required<GelOptions> {
  const { gelAgarose } = useEditorState();
  return useMemo(() => gelForAgarose(gelAgarose), [gelAgarose]);
}
