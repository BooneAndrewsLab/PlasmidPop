import {
  type CdsTranslations,
  type CutSite,
  type DocumentDiff,
  type Feature,
  type Range,
  type SeqDocument,
  complement,
  marksIn,
  rangePieces,
} from '@/core';

import { type DrawingContext } from '../drawingContext';
import { contrastingText, featureColor, withAlpha } from '../featureColors';
import { type LaneAssignment } from './lanes';
import { type LinearLayout, type RowLayout } from './layout';

export interface LinearTheme {
  readonly ink: string;
  readonly inkMuted: string;
  readonly gutterText: string;
  readonly rulerLine: string;
  readonly selectionFill: string;
  readonly caret: string;
  readonly background: string;
  readonly cutSite: string;
  /** Bases that are new since the baseline. */
  readonly editInsert: string;
  /** Bases standing where other bases used to be. */
  readonly editChange: string;
  /** Boundaries where bases were removed. */
  readonly editDelete: string;
}

export interface RenderParams {
  readonly doc: SeqDocument;
  readonly layout: LinearLayout;
  readonly lanes: LaneAssignment;
  /**
   * Amino-acid translations drawn under the strands, and which line each
   * coding feature occupies. `null` hides translations altogether.
   */
  readonly translations: CdsTranslations | null;
  readonly translationLanes: LaneAssignment;
  readonly selection: Range | null;
  /** Cut sites to mark above the strands (already filtered to the enzymes the user wants). */
  readonly cutSites: readonly CutSite[];
  /**
   * Changes since the baseline the user chose, marked over the strands and
   * around the features they touched. `null` leaves the view unmarked.
   */
  readonly edits: DocumentDiff | null;
  readonly scrollTop: number;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly theme: LinearTheme;
  readonly monoFont: string;
  readonly sansFont: string;
}

const ARROW = 7;
const RIBBON_INSET = 2;

function drawRuler(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { layout, theme } = p;
  const m = layout.metrics;
  const baseline = row.top + m.rulerHeight - 3;
  ctx.font = p.sansFont;
  ctx.fillStyle = theme.gutterText;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    (row.start + 1).toLocaleString(),
    m.leftGutter - 10,
    layout.forwardTextTop(row) + m.lineHeight * 0.75,
  );

  const labelEvery = m.basesPerRow >= 50 ? 50 : 10;
  ctx.strokeStyle = theme.rulerLine;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  for (let col = 10; col <= row.end - row.start; col += 10) {
    const x = Math.round(layout.xOfColumn(col)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, row.top + m.rulerHeight - 2);
    ctx.lineTo(x, row.top + m.rulerHeight + 2);
    ctx.stroke();
    if ((row.start + col) % labelEvery === 0 && col < row.end - row.start) {
      ctx.fillText((row.start + col).toLocaleString(), x, baseline - 3);
    }
  }
}

function drawSelection(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { selection, layout, theme, doc } = p;
  if (selection === null) return;
  const m = layout.metrics;
  const top = layout.forwardTextTop(row);
  const bottom = row.top + row.height - m.rowGap;
  if (selection.start === selection.end) {
    if (
      selection.start >= row.start &&
      (selection.start < row.end || (selection.start === row.end && row.end === doc.length))
    ) {
      const x = Math.round(layout.xOfColumn(selection.start - row.start)) + 0.5;
      ctx.strokeStyle = theme.caret;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, layout.forwardTextTop(row) + layout.baseBlockHeight() - m.rulerHeight);
      ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = theme.selectionFill;
  for (const piece of rangePieces(selection, doc.length)) {
    const s = Math.max(piece.start, row.start);
    const e = Math.min(piece.end, row.end);
    if (e <= s) continue;
    const x0 = layout.xOfColumn(s - row.start);
    const x1 = layout.xOfColumn(e - row.start);
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
  }
}

/** Half-width and height of the wedge that marks bases which are gone. */
const DELETION_WEDGE = 4;

/**
 * Tracked changes over the strands: a tint with a solid underline for bases
 * that are new or that replaced others, and a wedge at every boundary where
 * bases were removed. Drawn under the selection so both stay readable.
 */
function drawEdits(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { doc, edits, layout, theme } = p;
  if (edits === null) return;
  const m = layout.metrics;
  const top = layout.forwardTextTop(row);
  const bottom = top + m.lineHeight * (m.showComplement ? 2 : 1);
  for (const mark of marksIn(edits.marks, row.start, row.end)) {
    const s = Math.max(mark.start, row.start);
    const e = Math.min(mark.end, row.end);
    if (e <= s) continue;
    const color = mark.kind === 'inserted' ? theme.editInsert : theme.editChange;
    const x0 = layout.xOfColumn(s - row.start);
    const x1 = layout.xOfColumn(e - row.start);
    ctx.fillStyle = withAlpha(color, 0.2);
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
    ctx.fillStyle = color;
    ctx.fillRect(x0, bottom - 2, x1 - x0, 2);
  }
  for (const deletion of edits.deletions) {
    const at = deletion.position;
    // A deletion at a row break belongs to the row it ends, and one at the
    // very end of the sequence to the last row.
    if (at < row.start || at > row.end) continue;
    if (at === row.end && row.end !== doc.length) continue;
    // A wedge in the ruler band pointing at the gap, and a line down through
    // the strands to say exactly which boundary it is.
    const x = Math.round(layout.xOfColumn(at - row.start)) + 0.5;
    ctx.fillStyle = theme.editDelete;
    ctx.beginPath();
    ctx.moveTo(x - DELETION_WEDGE, top - DELETION_WEDGE - 2);
    ctx.lineTo(x + DELETION_WEDGE, top - DELETION_WEDGE - 2);
    ctx.lineTo(x, top - 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = theme.editDelete;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
}

function drawStrands(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { doc, layout, theme } = p;
  const m = layout.metrics;
  const text = doc.sequence.slice(row.start, row.end);
  ctx.font = p.monoFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const drawLine = (s: string, top: number, color: string): void => {
    ctx.fillStyle = color;
    const y = top + m.lineHeight * 0.75;
    // Ten-base chunks keep the text anchored to the column grid even if the
    // font's advance width is not exactly `charWidth`.
    for (let i = 0; i < s.length; i += 10) ctx.fillText(s.slice(i, i + 10), layout.xOfColumn(i), y);
  };
  drawLine(text, layout.forwardTextTop(row), theme.ink);
  if (m.showComplement) drawLine(complement(text), layout.complementTextTop(row), theme.inkMuted);
}

interface Run {
  readonly start: number;
  readonly end: number;
}

/** Contiguous runs of the ascending positions in `positions` that fall inside `[start, end)`. */
function runsInRow(positions: readonly number[], start: number, end: number): Run[] {
  const inRow = positions.filter((p) => p >= start && p < end).sort((a, b) => a - b);
  const runs: Run[] = [];
  for (const p of inRow) {
    const last = runs[runs.length - 1];
    if (last?.end === p) runs[runs.length - 1] = { start: last.start, end: p + 1 };
    else runs.push({ start: p, end: p + 1 });
  }
  return runs;
}

/**
 * One line of amino acids per coding feature in the row: each codon is a
 * lightly tinted box over its bases (alternating shades so codon boundaries
 * read even where letters are omitted) with the one-letter code centred on
 * it. A codon split by a join or a row break is shaded wherever its bases
 * are and lettered once, over the piece holding its middle base.
 */
function drawTranslations(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { doc, layout, theme, translations, translationLanes } = p;
  if (translations === null || row.translations === 0) return;
  const m = layout.metrics;
  const height = m.translationHeight - 2;
  ctx.font = p.monoFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const feature of doc.features.overlapping({ start: row.start, end: row.end }, doc.length)) {
    const line = translationLanes.laneOf.get(feature.id);
    if (line === undefined || line >= row.translations) continue;
    const top = layout.translationTop(row, line) + 1;
    const color = featureColor(feature);
    const fills = [withAlpha(color, 0.16), withAlpha(color, 0.34)];
    for (const codon of translations.get(feature).codons) {
      const runs = runsInRow(codon.positions, row.start, row.end);
      if (runs.length === 0) continue;
      const middle = codon.positions[1];
      for (const run of runs) {
        const x0 = layout.xOfColumn(run.start - row.start);
        const x1 = layout.xOfColumn(run.end - row.start);
        ctx.fillStyle = fills[codon.index % 2] ?? color;
        ctx.fillRect(x0, top, x1 - x0, height);
        if (middle >= run.start && middle < run.end) {
          ctx.fillStyle = codon.aminoAcid === '*' ? theme.cutSite : theme.ink;
          ctx.fillText(codon.aminoAcid, (x0 + x1) / 2, top + height / 2 + 0.5);
        }
      }
    }
  }
}

interface Ribbon {
  readonly x0: number;
  readonly x1: number;
  readonly arrowRight: boolean;
  readonly arrowLeft: boolean;
}

function ribbonPath(ctx: DrawingContext, r: Ribbon, top: number, height: number): void {
  const mid = top + height / 2;
  const a = Math.min(ARROW, (r.x1 - r.x0) / 2);
  ctx.beginPath();
  ctx.moveTo(r.arrowLeft ? r.x0 + a : r.x0, top);
  ctx.lineTo(r.arrowRight ? r.x1 - a : r.x1, top);
  if (r.arrowRight) ctx.lineTo(r.x1, mid);
  ctx.lineTo(r.arrowRight ? r.x1 - a : r.x1, top + height);
  ctx.lineTo(r.arrowLeft ? r.x0 + a : r.x0, top + height);
  if (r.arrowLeft) ctx.lineTo(r.x0, mid);
  ctx.closePath();
}

/** The colour an annotation that changed since the baseline is outlined in. */
function editOutline(p: RenderParams, feature: Feature): string | null {
  const { edits, theme } = p;
  if (edits === null) return null;
  if (edits.featuresAdded.has(feature.id)) return theme.editInsert;
  if (edits.featuresChanged.has(feature.id)) return theme.editChange;
  return null;
}

function drawFeature(ctx: DrawingContext, p: RenderParams, row: RowLayout, feature: Feature): void {
  const { doc, layout, lanes } = p;
  const lane = lanes.laneOf.get(feature.id);
  if (lane === undefined || lane >= row.lanes) return;
  const m = layout.metrics;
  const top = layout.laneTop(row, lane) + RIBBON_INSET;
  const height = m.laneHeight - RIBBON_INSET * 2;
  const color = featureColor(feature);
  const outline = editOutline(p, feature);
  const label = feature.name === '' ? feature.type : feature.name;

  const pieces: { start: number; end: number; first: boolean; last: boolean }[] = [];
  feature.segments.forEach((seg, si) => {
    if (seg.kind === 'site') {
      if (seg.position >= row.start && seg.position <= row.end) {
        const x = layout.xOfColumn(seg.position - row.start);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - 5, top);
        ctx.lineTo(x + 5, top);
        ctx.lineTo(x, top + height);
        ctx.closePath();
        ctx.fill();
        if (outline !== null) {
          ctx.strokeStyle = outline;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      return;
    }
    const parts = rangePieces(seg, doc.length);
    parts.forEach((part, pi) => {
      pieces.push({
        start: part.start,
        end: part.end,
        first: si === 0 && pi === 0,
        last: si === feature.segments.length - 1 && pi === parts.length - 1,
      });
    });
  });

  for (const piece of pieces) {
    const s = Math.max(piece.start, row.start);
    const e = Math.min(piece.end, row.end);
    if (e <= s) continue;
    const ribbon: Ribbon = {
      x0: layout.xOfColumn(s - row.start),
      x1: layout.xOfColumn(e - row.start),
      arrowRight: feature.strand === 'forward' && piece.last && e === piece.end,
      arrowLeft: feature.strand === 'reverse' && piece.first && s === piece.start,
    };
    ctx.fillStyle = color;
    ribbonPath(ctx, ribbon, top, height);
    ctx.fill();
    if (outline !== null) {
      // The fill leaves the path in place, so the outline needs no second one.
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const inner =
      ribbon.x1 - ribbon.x0 - (ribbon.arrowLeft ? ARROW : 0) - (ribbon.arrowRight ? ARROW : 0) - 8;
    if (inner > 12) {
      ctx.font = p.sansFont;
      ctx.fillStyle = contrastingText(color);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const text = fitText(ctx, label, inner);
      if (text !== '')
        ctx.fillText(text, ribbon.x0 + (ribbon.arrowLeft ? ARROW : 0) + 4, top + height / 2 + 0.5);
    }
  }
}

function fitText(ctx: DrawingContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : `${text.slice(0, lo)}…`;
}

/**
 * Marks restriction cuts: a vertical line at the top-strand cut, a short
 * jog to the bottom-strand cut, and the enzyme name above. Labels that would
 * collide with the previous one in the row are skipped (the mark stays).
 */
function drawCutSites(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { layout, theme, doc } = p;
  const m = layout.metrics;
  const sites = p.cutSites.filter(
    (s) =>
      (s.cut >= row.start && s.cut <= row.end && (s.cut < row.end || row.end === doc.length)) ||
      (s.cutBottom >= row.start && s.cutBottom < row.end),
  );
  if (sites.length === 0) return;
  const strandTop = layout.forwardTextTop(row);
  const strandBottom = strandTop + m.lineHeight * (m.showComplement ? 2 : 1);
  const mid = m.showComplement ? strandTop + m.lineHeight : strandBottom;
  const labelBaseline = row.top + 11;
  ctx.font = p.sansFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 1;
  let lastLabelEnd = -Infinity;
  const ordered = [...sites].sort((a, b) => a.cut - b.cut);
  for (const site of ordered) {
    const xTop =
      Math.round(layout.xOfColumn(Math.min(Math.max(site.cut, row.start), row.end) - row.start)) +
      0.5;
    const xBottom =
      Math.round(
        layout.xOfColumn(Math.min(Math.max(site.cutBottom, row.start), row.end) - row.start),
      ) + 0.5;
    ctx.strokeStyle = theme.cutSite;
    ctx.beginPath();
    ctx.moveTo(xTop, row.top + 14);
    ctx.lineTo(xTop, mid);
    if (m.showComplement) {
      ctx.lineTo(xBottom, mid);
      ctx.lineTo(xBottom, strandBottom);
    }
    ctx.stroke();
    const width = ctx.measureText(site.enzyme).width;
    if (xTop - width / 2 > lastLabelEnd + 4) {
      ctx.fillStyle = theme.cutSite;
      ctx.fillText(site.enzyme, xTop, labelBaseline);
      lastLabelEnd = xTop + width / 2;
    }
  }
}

/** Draws the visible part of the linear view onto a canvas that covers the viewport. */
export function renderLinearView(ctx: DrawingContext, p: RenderParams): void {
  const { layout, doc, scrollTop, width, height, devicePixelRatio: dpr } = p;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = p.theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(0, -scrollTop);

  for (const row of layout.rowsInWindow(scrollTop, scrollTop + height)) {
    drawEdits(ctx, p, row);
    drawSelection(ctx, p, row);
    drawRuler(ctx, p, row);
    drawStrands(ctx, p, row);
    drawTranslations(ctx, p, row);
    drawCutSites(ctx, p, row);
    if (row.lanes > 0) {
      for (const feature of doc.features.overlapping(
        { start: row.start, end: row.end },
        doc.length,
      )) {
        drawFeature(ctx, p, row, feature);
      }
    }
  }
  ctx.restore();
}

/** Advance width of one character in `font`, measured on a scratch canvas (fallback 8px). */
const charWidthCache = new Map<string, number>();
export function measureCharWidth(font: string): number {
  const cached = charWidthCache.get(font);
  if (cached !== undefined) return cached;
  let width = 8;
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx !== null) {
      ctx.font = font;
      const measured = ctx.measureText('ACGTACGTAC').width / 10;
      if (measured > 0) width = measured;
    }
  }
  charWidthCache.set(font, width);
  return width;
}
