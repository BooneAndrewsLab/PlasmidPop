import {
  type BaseStyle,
  type CdsTranslations,
  type CutSite,
  type DocumentDiff,
  type Feature,
  type Range,
  type SeqDocument,
  complement,
  marksIn,
  rangePieces,
  sameFeatureLocation,
  topStrandOverhang,
} from '@/core';

import { type DrawingContext } from '../drawingContext';
import { drawTrace } from '../trace';
import { contrastingText, featureColor, withAlpha } from '../featureColors';
import { type OverlaySpan, overlayPieces } from '../overlay';
import { type LaneAssignment } from './lanes';
import { type LinearLayout, type RowLayout } from './layout';

/**
 * Colours for the four bases when base colouring is on, with `other` for the
 * IUPAC ambiguity codes.
 */
export interface BaseColors {
  readonly a: string;
  readonly c: string;
  readonly g: string;
  readonly t: string;
  readonly other: string;
}

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
  /** Spans previewed beside the document's own annotation, which are not in it. */
  readonly preview: string;
  /** The base-quality bars behind a sequencing read's trace. */
  readonly traceQuality: string;
  readonly baseColors: BaseColors;
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
   * Transient spans drawn in a band outside the feature lanes: a primer pair
   * under consideration, every match of a find. Nothing here is part of the
   * document.
   */
  readonly overlay: readonly OverlaySpan[];
  readonly overlayLanes: LaneAssignment;
  /**
   * Changes since the baseline the user chose, marked over the strands and
   * around the features they touched. `null` leaves the view unmarked.
   */
  readonly edits: DocumentDiff | null;
  /** Tint each base by what it is instead of drawing the strands in one ink. */
  readonly colorBases: boolean;
  /** Repeat the row's position number beside the complement strand. */
  readonly numberComplement: boolean;
  readonly scrollTop: number;
  /** How far the view is scrolled right; 0 unless a fixed row width overflows. */
  readonly scrollLeft: number;
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
  const number = (row.start + 1).toLocaleString();
  ctx.fillText(number, m.leftGutter - 10, layout.textBaseline(row, layout.forwardTextTop(row)));
  // The complement is read from the same coordinates, so its number is the
  // same one repeated: on a wide row it saves tracking back to the top line.
  if (p.numberComplement && m.showComplement) {
    // Past the bottom-strand bases of a sticky end, which sit in the gutter.
    const clear = row.index === 0 ? endOverhangs(p.doc).leftBottom * m.charWidth : 0;
    ctx.fillStyle = theme.inkMuted;
    ctx.fillText(
      number,
      m.leftGutter - 10 - clear,
      layout.textBaseline(row, layout.complementTextTop(row)),
    );
    ctx.fillStyle = theme.gutterText;
  }

  const labelEvery = m.basesPerRow >= 50 ? 50 : 10;
  ctx.strokeStyle = theme.rulerLine;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  // A tick after every tenth base, counted from the start of the sequence:
  // a row after one of larger bases (#91) need not start on a ten.
  for (let at = Math.ceil((row.start + 1) / 10) * 10; at <= row.end; at += 10) {
    const x = Math.round(layout.xOf(row, at)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, row.top + m.rulerHeight - 2);
    ctx.lineTo(x, row.top + m.rulerHeight + 2);
    ctx.stroke();
    if (at % labelEvery === 0 && at < row.end) {
      ctx.fillText(at.toLocaleString(), x, baseline - 3);
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
      const x = Math.round(layout.xOf(row, selection.start)) + 0.5;
      ctx.strokeStyle = theme.caret;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, layout.forwardTextTop(row) + layout.strandsHeight(row));
      ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = theme.selectionFill;
  for (const piece of rangePieces(selection, doc.length)) {
    const s = Math.max(piece.start, row.start);
    const e = Math.min(piece.end, row.end);
    if (e <= s) continue;
    const x0 = layout.xOf(row, s);
    const x1 = layout.xOf(row, e);
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
  const top = layout.forwardTextTop(row);
  const bottom = top + layout.strandsHeight(row);
  for (const mark of marksIn(edits.marks, row.start, row.end)) {
    const s = Math.max(mark.start, row.start);
    const e = Math.min(mark.end, row.end);
    if (e <= s) continue;
    const color = mark.kind === 'inserted' ? theme.editInsert : theme.editChange;
    const x0 = layout.xOf(row, s);
    const x1 = layout.xOf(row, e);
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
    const x = Math.round(layout.xOf(row, at)) + 0.5;
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

/**
 * The single-stranded bases at each end of a linear molecule, in columns.
 * `top` is how many of the document's own bases have no partner (they are
 * drawn with a gap opposite them); `bottom` is how far the other strand runs
 * past the sequence, drawn in the gutter beside it.
 */
interface EndOverhangs {
  readonly leftTop: number;
  readonly leftBottom: number;
  readonly rightTop: number;
  readonly rightBottom: number;
}

export function endOverhangs(doc: SeqDocument): EndOverhangs {
  const ends = doc.ends;
  if (ends === null) return { leftTop: 0, leftBottom: 0, rightTop: 0, rightBottom: 0 };
  const leftTop = topStrandOverhang(ends.left, 'left');
  const rightTop = topStrandOverhang(ends.right, 'right');
  return {
    leftTop,
    leftBottom: leftTop > 0 ? 0 : ends.left.overhang.length,
    rightTop,
    rightBottom: rightTop > 0 ? 0 : ends.right.overhang.length,
  };
}

/**
 * Sticky ends: the bases of the molecule that have nothing opposite them are
 * washed over, so an overhang reads even when the complement is hidden.
 * Drawn under everything else.
 */
function drawEndShading(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { doc, layout, theme } = p;
  if (doc.ends === null) return;
  const { leftTop, rightTop } = endOverhangs(doc);
  const top = layout.forwardTextTop(row);
  const bottom = top + layout.strandsHeight(row);
  ctx.fillStyle = withAlpha(theme.inkMuted, 0.2);
  for (const span of [
    { start: 0, end: leftTop },
    { start: doc.length - rightTop, end: doc.length },
  ]) {
    const s = Math.max(span.start, row.start);
    const e = Math.min(span.end, row.end);
    if (e <= s) continue;
    const x0 = layout.xOf(row, s);
    ctx.fillRect(x0, top, layout.xOf(row, e) - x0, bottom - top);
  }
}

/**
 * The part of a sticky end that is not in the document's own sequence: where
 * the bottom strand runs past the top one, its bases are drawn in the gutter
 * beyond the first or last column, muted like the rest of the complement.
 */
function drawEndOverhangBases(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { doc, layout, theme } = p;
  const ends = doc.ends;
  if (ends === null || !layout.metrics.showComplement) return;
  const { leftBottom, rightBottom } = endOverhangs(doc);
  ctx.font = p.monoFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.inkMuted;
  const y = layout.textBaseline(row, layout.complementTextTop(row));
  if (leftBottom > 0 && row.index === 0) {
    ctx.fillText(complement(ends.left.overhang), layout.xOfColumn(-leftBottom), y);
  }
  if (rightBottom > 0 && row.end === doc.length) {
    ctx.fillText(complement(ends.right.overhang), layout.xOf(row, row.end), y);
  }
}

/** The colour a base is drawn in while base colouring is on. */
function baseColor(colors: BaseColors, base: string): string {
  switch (base) {
    case 'A':
    case 'a':
      return colors.a;
    case 'C':
    case 'c':
      return colors.c;
    case 'G':
    case 'g':
      return colors.g;
    case 'T':
    case 't':
    case 'U':
    case 'u':
      return colors.t;
    default:
      return colors.other;
  }
}

/**
 * Where a stretch of one line of bases is drawn: from `x`, each base
 * `advance` wide, letters sitting on `y`.
 */
interface Stretch {
  readonly x: number;
  readonly advance: number;
  readonly y: number;
}

/**
 * One stretch of bases, in ten-base chunks so the text stays anchored to
 * the column grid even where the font's advance width is not exactly
 * `charWidth`. Spaces in `s` leave a column empty — that is how the paired
 * base of a single-stranded overhang is left out.
 */
function drawBaseChunks(ctx: DrawingContext, s: string, at: Stretch, color: string): void {
  ctx.fillStyle = color;
  for (let i = 0; i < s.length; i += 10) {
    const chunk = s.slice(i, i + 10);
    if (chunk.trim() === '') continue;
    ctx.fillText(chunk, at.x + i * at.advance, at.y);
  }
}

/** The colours a coloured line is drawn in, in a fixed order, without repeats. */
function distinctBaseColors(colors: BaseColors): string[] {
  return [...new Set([colors.a, colors.c, colors.g, colors.t, colors.other])];
}

/**
 * A stretch of bases in one style. Uncoloured it is one fill per ten bases;
 * coloured, the stretch is drawn once per colour with the other columns
 * blanked out, which costs a handful of passes instead of one fill per base
 * and keeps every letter exactly where the grid puts it. A colour the user
 * gave the bases (#89) is drawn instead of either.
 */
function drawBaseStretch(
  ctx: DrawingContext,
  p: RenderParams,
  s: string,
  at: Stretch,
  plain: string,
  userColor: string | undefined,
): void {
  if (userColor !== undefined || !p.colorBases) {
    drawBaseChunks(ctx, s, at, userColor ?? plain);
    return;
  }
  const colors = p.theme.baseColors;
  for (const color of distinctBaseColors(colors)) {
    let masked = '';
    for (const ch of s) masked += baseColor(colors, ch) === color && ch !== ' ' ? ch : ' ';
    drawBaseChunks(ctx, masked, at, color);
  }
}

/**
 * `font` (a CSS font string that starts with its size in px) at `scale`
 * times the size, and bold when asked: how a styled base is drawn (#91).
 */
export function styledFont(font: string, scale: number, bold: boolean): string {
  const sized =
    scale === 1
      ? font
      : font.replace(/^(\d+(?:\.\d+)?)px/, (_, px: string) => `${Number(px) * scale}px`);
  return bold ? `bold ${sized}` : sized;
}

/** The stretches of a row that share one style, the unstyled ones included (`style` null). */
function styleStretches(
  p: RenderParams,
  row: RowLayout,
): { start: number; end: number; style: BaseStyle | null }[] {
  const out: { start: number; end: number; style: BaseStyle | null }[] = [];
  let at = row.start;
  for (const run of p.doc.styles.within(row.start, row.end)) {
    if (run.start > at) out.push({ start: at, end: run.start, style: null });
    out.push(run);
    at = run.end;
  }
  if (at < row.end) out.push({ start: at, end: row.end, style: null });
  return out;
}

/**
 * A line of bases of `row`, `s` holding one letter per base. Each stretch
 * of one style is drawn in its own font and colour, at its own size, every
 * letter on the line's one baseline, the way larger words sit in a line of
 * text.
 */
function drawBaseLine(
  ctx: DrawingContext,
  p: RenderParams,
  row: RowLayout,
  s: string,
  top: number,
  plain: string,
): void {
  const { layout } = p;
  const y = layout.textBaseline(row, top);
  for (const stretch of styleStretches(p, row)) {
    const style = stretch.style;
    const scale = style?.size ?? 1;
    ctx.font = style === null ? p.monoFont : styledFont(p.monoFont, scale, style.bold === true);
    drawBaseStretch(
      ctx,
      p,
      s.slice(stretch.start - row.start, stretch.end - row.start),
      { x: layout.xOf(row, stretch.start), advance: layout.metrics.charWidth * scale, y },
      plain,
      // Letters on a highlight are drawn to read on it, dark theme or light.
      style?.color ??
        (style?.highlight === undefined ? undefined : contrastingText(style.highlight)),
    );
  }
  ctx.font = p.monoFont;
}

/**
 * Highlights the user put behind runs of bases (#89): a band of the colour
 * over both strands, under everything else drawn on them.
 */
function drawHighlights(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { layout } = p;
  const top = layout.forwardTextTop(row);
  const height = layout.strandsHeight(row);
  for (const run of p.doc.styles.within(row.start, row.end)) {
    const color = run.style.highlight;
    if (color === undefined) continue;
    const x0 = layout.xOf(row, run.start);
    ctx.fillStyle = color;
    ctx.fillRect(x0, top, layout.xOf(row, run.end) - x0, height);
  }
}

/**
 * The complement of `text` with a gap wherever the top strand is on its own:
 * the single-stranded bases of a sticky end have no partner to draw.
 */
function pairedComplement(text: string, p: RenderParams, row: RowLayout): string {
  const { doc } = p;
  if (doc.ends === null) return complement(text);
  const { leftTop, rightTop } = endOverhangs(doc);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const at = row.start + i;
    const unpaired = at < leftTop || at >= doc.length - rightTop;
    out += unpaired ? ' ' : complement(text[i] ?? '');
  }
  return out;
}

function drawStrands(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { doc, layout, theme } = p;
  const m = layout.metrics;
  const text = doc.sequence.slice(row.start, row.end);
  ctx.font = p.monoFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  drawBaseLine(ctx, p, row, text, layout.forwardTextTop(row), theme.ink);
  if (m.showComplement) {
    drawBaseLine(
      ctx,
      p,
      row,
      pairedComplement(text, p, row),
      layout.complementTextTop(row),
      theme.inkMuted,
    );
  }
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
        const x0 = layout.xOf(row, run.start);
        const x1 = layout.xOf(row, run.end);
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

/** Dash for the outline of a feature whose bases did not change, only its label. */
const EDIT_DASH = [3, 2];

/** The colour a changed annotation is outlined in, and the line it is drawn with. */
interface EditOutline {
  readonly color: string;
  /** Broken, for a feature whose bases are the same and whose label is not. */
  readonly dashed: boolean;
}

/**
 * How an annotation that changed since the baseline is outlined: the colour
 * of the change, and whether the line is broken.
 *
 * A solid line means the feature covers different bases than it did. A
 * broken one means the same bases, described differently — retyped, renamed,
 * a qualifier edited. That is the one distinction a line can carry, and it
 * is the one worth carrying: the first can break a construct, the second
 * cannot.
 */
function editOutline(p: RenderParams, feature: Feature): EditOutline | null {
  const { edits, theme } = p;
  if (edits === null) return null;
  if (edits.featuresAdded.has(feature.id)) return { color: theme.editInsert, dashed: false };
  const before = edits.featuresChanged.get(feature.id);
  if (before === undefined) return null;
  return { color: theme.editChange, dashed: sameFeatureLocation(before, feature) };
}

/** Strokes the path already in place with an edit outline, dash and all. */
function strokeOutline(ctx: DrawingContext, outline: EditOutline): void {
  ctx.strokeStyle = outline.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(outline.dashed ? EDIT_DASH : []);
  ctx.stroke();
  ctx.setLineDash([]);
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
        const x = layout.xOf(row, seg.position);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - 5, top);
        ctx.lineTo(x + 5, top);
        ctx.lineTo(x, top + height);
        ctx.closePath();
        ctx.fill();
        if (outline !== null) {
          strokeOutline(ctx, outline);
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
      x0: layout.xOf(row, s),
      x1: layout.xOf(row, e),
      arrowRight: feature.strand === 'forward' && piece.last && e === piece.end,
      arrowLeft: feature.strand === 'reverse' && piece.first && s === piece.start,
    };
    ctx.fillStyle = color;
    ribbonPath(ctx, ribbon, top, height);
    ctx.fill();
    if (outline !== null) {
      // The fill leaves the path in place, so the outline needs no second one.
      strokeOutline(ctx, outline);
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

/** Dash pattern that says a span is a preview and not an annotation. */
const PREVIEW_DASH = [4, 3];

/**
 * The preview band, outside the feature lanes: an `arrow` span is a hollow
 * dashed ribbon pointing the way it reads, a `span` is a thin bracket
 * between two of them. Everything here is drawn in one colour of its own and
 * never filled solid, so it cannot be taken for something the document
 * holds.
 */
function drawOverlays(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { doc, layout, theme, overlay, overlayLanes } = p;
  if (row.overlays === 0 || overlay.length === 0) return;
  const m = layout.metrics;
  const color = theme.preview;
  ctx.font = p.sansFont;
  ctx.textBaseline = 'middle';
  for (const span of overlay) {
    const lane = overlayLanes.laneOf.get(span.id);
    if (lane === undefined || lane >= row.overlays) continue;
    const top = layout.overlayTop(row, lane) + 2;
    const height = m.overlayHeight - 5;
    const mid = top + height / 2;
    const pieces = overlayPieces(span, doc.length);
    pieces.forEach((piece, index) => {
      const s = Math.max(piece.start, row.start);
      const e = Math.min(piece.end, row.end);
      if (e <= s) return;
      const x0 = layout.xOf(row, s);
      const x1 = layout.xOf(row, e);
      const first = index === 0 && s === piece.start;
      const last = index === pieces.length - 1 && e === piece.end;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(PREVIEW_DASH);
      if (span.shape === 'span') {
        ctx.beginPath();
        ctx.moveTo(x0, mid);
        ctx.lineTo(x1, mid);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [x, draw] of [
          [x0, first],
          [x1, last],
        ] as const) {
          if (!draw) continue;
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, top);
          ctx.lineTo(Math.round(x) + 0.5, top + height);
          ctx.stroke();
        }
      } else {
        const ribbon: Ribbon = {
          x0,
          x1,
          arrowRight: span.strand === 'forward' && last,
          arrowLeft: span.strand === 'reverse' && first,
        };
        ribbonPath(ctx, ribbon, top, height);
        ctx.fillStyle = withAlpha(color, 0.14);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawOverlayLabel(ctx, p, span, x0, x1, mid, color);
      // A primer's mismatches, one cell each across the ribbon (#32).
      for (const mark of span.marks ?? []) {
        const at = ((mark % doc.length) + doc.length) % doc.length;
        if (at < s || at >= e) continue;
        const mx0 = layout.xOf(row, at);
        const mx1 = layout.xOf(row, at + 1);
        ctx.fillStyle = theme.editChange;
        ctx.fillRect(mx0, top, Math.max(2, mx1 - mx0), height);
      }
    });
  }
  ctx.setLineDash([]);
}

/**
 * The span's name, inside an arrow where it fits and over the middle of a
 * bracket (on a patch of background, so the line does not run through the
 * letters). Skipped where there is no room rather than shortened to nothing.
 */
function drawOverlayLabel(
  ctx: DrawingContext,
  p: RenderParams,
  span: OverlaySpan,
  x0: number,
  x1: number,
  mid: number,
  color: string,
): void {
  if (span.label === '') return;
  const available = x1 - x0 - (span.shape === 'arrow' ? ARROW + 8 : 8);
  if (available < 16) return;
  const text = fitText(ctx, span.label, available);
  if (text === '') return;
  ctx.fillStyle = color;
  if (span.shape === 'span') {
    const width = ctx.measureText(text).width;
    const centre = (x0 + x1) / 2;
    ctx.fillStyle = p.theme.background;
    ctx.fillRect(centre - width / 2 - 3, mid - 6, width + 6, 12);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, centre, mid + 0.5);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(text, x0 + (span.strand === 'reverse' ? ARROW : 0) + 4, mid + 0.5);
  }
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
  const strandBottom = strandTop + layout.strandsHeight(row);
  const mid = m.showComplement ? strandTop + layout.lineHeight(row) : strandBottom;
  const labelBaseline = row.top + 11;
  ctx.font = p.sansFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 1;
  let lastLabelEnd = -Infinity;
  const ordered = [...sites].sort((a, b) => a.cut - b.cut);
  for (const site of ordered) {
    const xTop =
      Math.round(layout.xOf(row, Math.min(Math.max(site.cut, row.start), row.end))) + 0.5;
    const xBottom =
      Math.round(layout.xOf(row, Math.min(Math.max(site.cutBottom, row.start), row.end))) + 0.5;
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

/**
 * A sequencing read's chromatogram over the row's bases (#52), each base's
 * peak over its letter, between the ruler and the strands.
 */
function drawReadTrace(ctx: DrawingContext, p: RenderParams, row: RowLayout): void {
  const { layout, doc, theme } = p;
  const m = layout.metrics;
  const read = doc.read;
  if (m.traceHeight === 0 || read?.trace == null) return;
  const bases = [];
  for (let k = row.start; k < row.end; k++) {
    bases.push({ index: k, x: layout.xOf(row, k) + layout.widthOf(row, k) / 2 });
  }
  drawTrace(ctx, {
    read,
    bases,
    top: layout.traceTop(row) + 2,
    height: m.traceHeight - 4,
    charWidth: m.charWidth,
    colors: { ...theme.baseColors, quality: theme.traceQuality },
  });
}

/** Draws the visible part of the linear view onto a canvas that covers the viewport. */
export function renderLinearView(ctx: DrawingContext, p: RenderParams): void {
  const { layout, doc, scrollTop, scrollLeft, width, height, devicePixelRatio: dpr } = p;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = p.theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(-scrollLeft, -scrollTop);

  for (const row of layout.rowsInWindow(scrollTop, scrollTop + height)) {
    drawHighlights(ctx, p, row);
    drawEndShading(ctx, p, row);
    drawEdits(ctx, p, row);
    drawSelection(ctx, p, row);
    drawRuler(ctx, p, row);
    drawReadTrace(ctx, p, row);
    drawStrands(ctx, p, row);
    drawEndOverhangBases(ctx, p, row);
    drawTranslations(ctx, p, row);
    drawCutSites(ctx, p, row);
    drawOverlays(ctx, p, row);
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
