import { type DocumentEnds, type OverhangKind, type StrandEnd } from '@/core';

/**
 * Sticky ends in a GenBank file.
 *
 * GenBank has nowhere to say that a linear molecule's strands stop at
 * different places, so the ends travel as one COMMENT line in a shape we can
 * read back:
 *
 *     PlasmidPop-ends: left=5' AATT/EcoRI; right=blunt
 *
 * The kind is `blunt`, `5'` or `3'`, followed by the overhang bases (written
 * as top-strand bases, the convention of `core/document/ends.ts`) and, after
 * a slash, the enzyme that made the cut. Other software sees a comment it can
 * ignore; ours takes it out of the comments and puts it back on write, so a
 * file round-trips without collecting copies of the line.
 */
const PREFIX = 'PlasmidPop-ends:';

const END = /^(blunt|5'|3')(?:\s+([A-Za-z]+))?(?:\s*\/\s*(.+))?$/;

function formatEnd(end: StrandEnd): string {
  const overhang = end.kind === 'blunt' || end.overhang === '' ? '' : ` ${end.overhang}`;
  const enzyme = end.enzyme === null || end.enzyme === '' ? '' : `/${end.enzyme}`;
  return `${end.kind}${overhang}${enzyme}`;
}

export function formatEndsComment(ends: DocumentEnds): string {
  return `${PREFIX} left=${formatEnd(ends.left)}; right=${formatEnd(ends.right)}`;
}

function parseEnd(text: string): StrandEnd | null {
  const m = END.exec(text.trim());
  if (m === null) return null;
  const kind = m[1] as OverhangKind;
  const overhang = m[2] ?? '';
  // A kind and an overhang have to agree, or the ends would not describe a
  // real molecule: treat a mismatch as an unreadable line.
  if ((kind === 'blunt') !== (overhang === '')) return null;
  const enzyme = m[3]?.trim();
  return { kind, overhang, enzyme: enzyme === undefined || enzyme === '' ? null : enzyme };
}

/** The ends a `PlasmidPop-ends:` comment describes, or null if it is not one (or is damaged). */
export function parseEndsComment(comment: string): DocumentEnds | null {
  const text = comment.trim();
  if (!text.startsWith(PREFIX)) return null;
  const body = text.slice(PREFIX.length);
  const parts = body.split(';');
  let left: StrandEnd | null = null;
  let right: StrandEnd | null = null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const side = part.slice(0, eq).trim().toLowerCase();
    const end = parseEnd(part.slice(eq + 1));
    if (end === null) continue;
    if (side === 'left') left = end;
    else if (side === 'right') right = end;
  }
  return left === null || right === null ? null : { left, right };
}

/** Whether a comment is ours, so the writer can add its own copy without duplicating. */
export function isEndsComment(comment: string): boolean {
  return comment.trim().startsWith(PREFIX);
}
