import { type GibsonJoin, YEAST_GC, YEAST_OVERLAP, gcPercent } from '@/core';

import { type JunctionVerdict } from './AssemblyOrder';

/**
 * Below this a junction anneals poorly at the 50 °C the reaction is held at.
 * It is a warning, not a refusal: the homology is there, and whether it
 * works is a bench question.
 */
export const WEAK_TM = 48;

/** A junction anneals or it does not: marked under `WEAK_TM`, with its Tm. */
export const gibsonVerdict = (join: GibsonJoin): JunctionVerdict => {
  const weak = join.tm < WEAK_TM;
  return {
    weak,
    detail: `Tm ${join.tm.toFixed(0)} °C${weak ? ` — under ${WEAK_TM} °C, so it may not anneal` : ''}`,
  };
};

/**
 * The homology a junction is made of: its length and its GC, never its Tm,
 * because the cell recombines it at 30 °C in a nucleus and not at 50 °C in a
 * tube. Marked when it is under the 30 bp the warnings give or outside the
 * GC they give.
 */
export const yeastVerdict = (join: GibsonJoin): JunctionVerdict => {
  const gc = gcPercent(join.overlap);
  return {
    weak: join.length < YEAST_OVERLAP.floor || gc < YEAST_GC.low || gc > YEAST_GC.high,
    detail: `${gc.toFixed(0)}% GC`,
  };
};
