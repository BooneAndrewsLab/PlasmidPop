import {
  type BaseStyle,
  type StyleRun,
  isBaseSize,
  isBaseStyle,
  normalizeStyleColor,
} from '@/core';

/**
 * The styles of runs of bases in a GenBank file (#89, #91).
 *
 * GenBank has nowhere to say that some bases are drawn red or large, so they
 * travel as a COMMENT block of ours, the way sticky ends and the host do
 * (`endsComment.ts`, `methylationComment.ts`): a header with the format's
 * version, then the runs, as many to a line as fit in GenBank's width:
 *
 *     PlasmidPop-base-styles: 1
 *     1..20:color=#d62728,bold 41..45:highlight=#ffe066,size=1.5
 *
 * A run is its first and last base, 1-based and inclusive as GenBank
 * counts, then what it is: `color=` and `highlight=` a `#rrggbb` colour,
 * `bold`, `size=` one of the sizes the view offers. Runs are in order and do
 * not overlap; a style over the origin of a circle is two of them.
 *
 * Other software sees a comment it can ignore. A block that does not read
 * back whole (a run out of order, a style this build does not know) is not
 * ours, and stays among the ordinary comments both ways (#72).
 */
const PREFIX = 'PlasmidPop-base-styles:';

/** The format written, and the only one read. */
const VERSION = '1';

/** Columns a comment line has after the 12 of the COMMENT keyword. */
const WIDTH = 67;

function formatStyle(style: BaseStyle): string {
  const parts: string[] = [];
  if (style.color !== undefined) parts.push(`color=${style.color}`);
  if (style.highlight !== undefined) parts.push(`highlight=${style.highlight}`);
  if (style.bold === true) parts.push('bold');
  if (style.size !== undefined) parts.push(`size=${style.size}`);
  return parts.join(',');
}

export function formatBaseStylesComment(runs: readonly StyleRun[]): string {
  const lines = [`${PREFIX} ${VERSION}`];
  let line = '';
  for (const run of runs) {
    const token = `${run.start + 1}..${run.end}:${formatStyle(run.style)}`;
    if (line !== '' && line.length + 1 + token.length > WIDTH) {
      lines.push(line);
      line = token;
    } else line = line === '' ? token : `${line} ${token}`;
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}

export function isBaseStylesComment(comment: string): boolean {
  return comment.trim().startsWith(PREFIX);
}

function parseStyle(text: string): BaseStyle | null {
  const style: { color?: string; highlight?: string; bold?: boolean; size?: BaseStyle['size'] } =
    {};
  for (const part of text.split(',')) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? null : part.slice(eq + 1);
    if (key === 'bold' && value === null && style.bold === undefined) style.bold = true;
    else if (
      (key === 'color' || key === 'highlight') &&
      value !== null &&
      style[key] === undefined
    ) {
      const color = normalizeStyleColor(value);
      if (color === null) return null;
      style[key] = color;
    } else if (key === 'size' && value !== null && style.size === undefined) {
      const size = Number(value);
      if (!isBaseSize(size)) return null;
      style.size = size;
    } else return null;
  }
  return isBaseStyle(style) ? style : null;
}

/**
 * The runs a `PlasmidPop-base-styles:` block holds, 0-based and half-open,
 * or null when the comment is not one this build can read whole. Whether
 * they fit the sequence is for the caller, who knows its length.
 */
export function parseBaseStylesComment(comment: string): StyleRun[] | null {
  const lines = comment.trim().split('\n');
  const header = lines[0]?.trim() ?? '';
  if (!header.startsWith(PREFIX) || header.slice(PREFIX.length).trim() !== VERSION) return null;
  const runs: StyleRun[] = [];
  let previous = 0;
  for (const token of lines.slice(1).join(' ').split(/\s+/)) {
    if (token === '') continue;
    const m = /^(\d+)\.\.(\d+):(\S+)$/.exec(token);
    if (m === null) return null;
    const start = Number(m[1]) - 1;
    const end = Number(m[2]);
    if (start < previous || end <= start) return null;
    const style = parseStyle(m[3] ?? '');
    if (style === null) return null;
    runs.push({ start, end, style });
    previous = end;
  }
  return runs;
}
