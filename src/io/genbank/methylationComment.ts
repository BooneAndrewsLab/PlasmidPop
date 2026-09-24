import { type HostMethylationState, METHYLATED_HOST, methylationEqual } from '@/core';

/**
 * Host methylation in a GenBank file (#45).
 *
 * GenBank has nowhere to say where the DNA was grown, so it travels as one
 * COMMENT line of ours, the way sticky ends do (`endsComment.ts`):
 *
 *     PlasmidPop-methylation: dam-; dcm+
 *
 * Other software sees a comment it can ignore; ours takes it out of the
 * comments and writes its own back, so a file round-trips without
 * collecting copies. Only a document that is *not* an ordinary `dam+ dcm+`
 * plasmid carries the line at all, since that is what a file with no line
 * is read as.
 */
const PREFIX = 'PlasmidPop-methylation:';

export function formatMethylationComment(state: HostMethylationState): string {
  return `${PREFIX} dam${state.dam ? '+' : '-'}; dcm${state.dcm ? '+' : '-'}`;
}

/** Whether the line is worth writing: the default needs no saying. */
export function needsMethylationComment(state: HostMethylationState): boolean {
  return !methylationEqual(state, METHYLATED_HOST);
}

export function isMethylationComment(comment: string): boolean {
  return comment.trim().startsWith(PREFIX);
}

/**
 * What a `PlasmidPop-methylation:` comment says, or null if it is not one.
 * A flag the line does not mention keeps the default, so a line that names
 * only `dcm-` still reads as `dam+`.
 */
export function parseMethylationComment(comment: string): HostMethylationState | null {
  const text = comment.trim();
  if (!text.startsWith(PREFIX)) return null;
  const body = text.slice(PREFIX.length).toLowerCase();
  let seen = false;
  let dam = METHYLATED_HOST.dam;
  let dcm = METHYLATED_HOST.dcm;
  for (const part of body.split(';')) {
    const m = /^\s*(dam|dcm)\s*([+-])\s*$/.exec(part);
    if (m === null) continue;
    seen = true;
    if (m[1] === 'dam') dam = m[2] === '+';
    else dcm = m[2] === '+';
  }
  return seen ? { dam, dcm } : null;
}
