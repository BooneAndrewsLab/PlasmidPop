import type { ColumnSummary } from '@/core';
import { monoFontOf, sansFontOf } from '@/view/linear';
import type { DrawingContext } from '@/view/drawingContext';

import type { Colours } from './alignmentStackDraw';

/**
 * The multiple alignment as pictures (#207): a ruler, the consensus row and
 * a bar of how conserved each column is, pinned at the top, then one row per
 * sequence under them, names pinned at the left. Only the columns in view
 * are drawn, so any length of alignment is as quick as a screenful.
 */

export const MSA_NAME_WIDTH = 168;
export const MSA_ROW_HEIGHT = 18;
export const MSA_RULER_HEIGHT = 18;
export const MSA_BAR_HEIGHT = 14;
export const MSA_CHAR_WIDTH = 9;
/** Ruler, consensus row and conservation bar. */
export const MSA_HEADER_HEIGHT = MSA_RULER_HEIGHT + MSA_ROW_HEIGHT + MSA_BAR_HEIGHT;

export type MsaShading = 'conservation' | 'bases';

export interface MsaDrawing {
  readonly names: readonly string[];
  readonly rows: readonly string[];
  readonly summary: readonly ColumnSummary[];
  readonly colours: Colours;
  readonly shading: MsaShading;
  /** The text colour on the accent, for a strongly shaded cell. */
  readonly onAccent: string;
  /** The scroll offsets and the size of what is shown. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Size of the whole picture. */
export function msaSize(columns: number, rows: number): { width: number; height: number } {
  return {
    width: MSA_NAME_WIDTH + columns * MSA_CHAR_WIDTH,
    height: MSA_HEADER_HEIGHT + rows * MSA_ROW_HEIGHT,
  };
}

/** The columns (half-open) that show at `left` in a view `width` wide. */
export function visibleColumns(
  left: number,
  width: number,
  columns: number,
): { first: number; end: number } {
  const first = Math.max(0, Math.floor(left / MSA_CHAR_WIDTH));
  const end = Math.min(columns, Math.ceil((left + width - MSA_NAME_WIDTH) / MSA_CHAR_WIDTH) + 1);
  return { first, end: Math.max(first, end) };
}

/** Strength of a column's shade: dim for a column few agree on, strong for a conserved one. */
export function shadeAlpha(conservation: number): number {
  return conservation < 0.3 ? 0 : 0.12 + 0.78 * ((conservation - 0.3) / 0.7);
}

/** Drawn to a canvas context; the `clip` and `globalAlpha` of the real one are all it needs beyond the shared subset. */
export type MsaContext = DrawingContext & {
  globalAlpha: number;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
};

export function drawMsa(g: MsaContext, d: MsaDrawing): void {
  const { colours: c } = d;
  const columns = d.summary.length;
  const { first, end } = visibleColumns(d.left, d.width, columns);
  g.fillStyle = c.background;
  g.fillRect(0, 0, d.width, d.height);

  const xOf = (col: number): number => MSA_NAME_WIDTH + col * MSA_CHAR_WIDTH - d.left;
  g.textBaseline = 'middle';

  // The sequence rows, clipped under the header and right of the names.
  g.save();
  g.beginPath();
  g.rect(MSA_NAME_WIDTH, MSA_HEADER_HEIGHT, d.width - MSA_NAME_WIDTH, d.height - MSA_HEADER_HEIGHT);
  g.clip();
  g.font = monoFontOf(13);
  g.textAlign = 'center';
  const rowFirst = Math.max(0, Math.floor(d.top / MSA_ROW_HEIGHT));
  const rowEnd = Math.min(d.rows.length, Math.ceil((d.top + d.height) / MSA_ROW_HEIGHT));
  for (let r = rowFirst; r < rowEnd; r++) {
    const y = MSA_HEADER_HEIGHT + r * MSA_ROW_HEIGHT - d.top;
    const row = d.rows[r] ?? '';
    for (let col = first; col < end; col++) {
      const ch = row.charAt(col);
      const x = xOf(col);
      if (ch === '-') {
        g.fillStyle = c.line;
        g.fillRect(x + 1, y + MSA_ROW_HEIGHT / 2, MSA_CHAR_WIDTH - 2, 1);
        continue;
      }
      const cons = d.summary[col]?.conservation ?? 0;
      let ink = c.ink;
      if (d.shading === 'bases') {
        const colour = c.bases[ch] ?? c.other;
        g.globalAlpha = 0.28;
        g.fillStyle = colour;
        g.fillRect(x, y, MSA_CHAR_WIDTH, MSA_ROW_HEIGHT);
        g.globalAlpha = 1;
      } else {
        const a = shadeAlpha(cons);
        if (a > 0) {
          g.globalAlpha = a;
          g.fillStyle = c.accent;
          g.fillRect(x, y, MSA_CHAR_WIDTH, MSA_ROW_HEIGHT);
          g.globalAlpha = 1;
          if (a > 0.55) ink = d.onAccent;
        }
      }
      g.fillStyle = ink;
      g.fillText(ch, x + MSA_CHAR_WIDTH / 2, y + MSA_ROW_HEIGHT / 2 + 1);
    }
  }
  g.restore();

  // The pinned header.
  g.save();
  g.beginPath();
  g.rect(MSA_NAME_WIDTH, 0, d.width - MSA_NAME_WIDTH, MSA_HEADER_HEIGHT);
  g.clip();
  g.fillStyle = c.background;
  g.fillRect(MSA_NAME_WIDTH, 0, d.width - MSA_NAME_WIDTH, MSA_HEADER_HEIGHT);
  g.font = sansFontOf(12);
  g.textAlign = 'left';
  g.fillStyle = c.muted;
  g.strokeStyle = c.line;
  g.lineWidth = 1;
  for (let col = first; col < end; col++) {
    if ((col + 1) % 10 !== 0 && col !== 0) continue;
    const x = xOf(col) + MSA_CHAR_WIDTH / 2;
    g.fillRect(x, MSA_RULER_HEIGHT - 5, 1, 4);
    g.fillText(String(col + 1), x + 2, MSA_RULER_HEIGHT / 2 - 1);
  }
  g.font = monoFontOf(13);
  g.textAlign = 'center';
  for (let col = first; col < end; col++) {
    const s = d.summary[col];
    if (s === undefined) continue;
    const x = xOf(col);
    g.fillStyle = c.ink;
    g.fillText(s.consensus, x + MSA_CHAR_WIDTH / 2, MSA_RULER_HEIGHT + MSA_ROW_HEIGHT / 2 + 1);
    // The bar's height is the share of the sequences with the consensus letter.
    const h = Math.round((MSA_BAR_HEIGHT - 2) * s.conservation);
    g.fillStyle = c.accent;
    g.fillRect(x + 1, MSA_HEADER_HEIGHT - 1 - h, MSA_CHAR_WIDTH - 2, h);
  }
  g.restore();

  // The pinned names, drawn last so scrolled residues pass under them.
  g.fillStyle = c.background;
  g.fillRect(0, 0, MSA_NAME_WIDTH, d.height);
  g.font = sansFontOf(14);
  g.textAlign = 'left';
  g.fillStyle = c.muted;
  g.fillText('Consensus', 8, MSA_RULER_HEIGHT + MSA_ROW_HEIGHT / 2);
  g.fillText('Conservation', 8, MSA_HEADER_HEIGHT - MSA_BAR_HEIGHT / 2);
  g.save();
  g.beginPath();
  g.rect(0, MSA_HEADER_HEIGHT, MSA_NAME_WIDTH, d.height - MSA_HEADER_HEIGHT);
  g.clip();
  g.fillStyle = c.ink;
  for (let r = rowFirst; r < rowEnd; r++) {
    const y = MSA_HEADER_HEIGHT + r * MSA_ROW_HEIGHT - d.top;
    g.fillText(d.names[r] ?? '', 8, y + MSA_ROW_HEIGHT / 2, MSA_NAME_WIDTH - 14);
  }
  g.restore();
  g.fillStyle = c.line;
  g.fillRect(MSA_NAME_WIDTH - 1, 0, 1, d.height);
  g.fillRect(0, MSA_HEADER_HEIGHT - 1, d.width, 1);
}
