import { SvgContext } from '@/view/svg';

import { NAME_WIDTH, drawStack, type StackDrawing } from './components/alignmentStackDraw';
import { clampRange, type ColumnRange } from './alignmentText';

/**
 * The large view as a picture file (#126): SVG through `SvgContext` and PNG
 * through a canvas, both by the window's own `drawStack`, so what is saved is
 * what is seen. The whole picture is drawn at once, so its size is capped.
 */

export type PictureKind = 'svg' | 'png';

/** Cells (columns times rows, the reference's included) an SVG may hold: each base is an element. */
export const MAX_SVG_CELLS = 100_000;
/** Cells a PNG may hold; its pixels are capped as well. */
export const MAX_PNG_CELLS = 400_000;
/** The longest side of a PNG, in pixels. */
export const MAX_PNG_SIDE = 16_000;
/** The most pixels of a PNG. */
export const MAX_PNG_PIXELS = 100_000_000;

export interface PictureSize {
  readonly width: number;
  readonly height: number;
  readonly cells: number;
}

/** The size of the picture of `range`, in CSS pixels. */
export function pictureSize(d: StackDrawing, range: ColumnRange): PictureSize {
  const n = Math.max(0, range.end - range.start);
  return {
    width: NAME_WIDTH + n * d.charWidth,
    height: d.layout.contentHeight,
    cells: n * (d.stack.rows.length + 1),
  };
}

/** The scale a PNG of `size` is drawn at (2 for sharp text, 1 when that is too large), or null when even 1 is. */
export function pngScale(size: PictureSize): 1 | 2 | null {
  for (const scale of [2, 1] as const) {
    const w = Math.ceil(size.width * scale);
    const h = Math.ceil(size.height * scale);
    if (w <= MAX_PNG_SIDE && h <= MAX_PNG_SIDE && w * h <= MAX_PNG_PIXELS) return scale;
  }
  return null;
}

/** Why `range` cannot be exported as `kind`, in words for the user, or null when it can. */
export function pictureLimit(
  d: StackDrawing,
  range: ColumnRange,
  kind: PictureKind,
): string | null {
  const r = clampRange(d.stack, range);
  if (r === null) return 'The column range holds no columns.';
  const size = pictureSize(d, r);
  const cells = `${(r.end - r.start).toLocaleString()} columns of ${(d.stack.rows.length + 1).toLocaleString()} rows`;
  if (kind === 'svg' && size.cells > MAX_SVG_CELLS) {
    return `Too large for SVG: ${cells} is ${size.cells.toLocaleString()} bases and the limit is ${MAX_SVG_CELLS.toLocaleString()}. Choose a shorter column range, or copy as text or aligned FASTA instead.`;
  }
  if (kind === 'png' && (size.cells > MAX_PNG_CELLS || pngScale(size) === null)) {
    return `Too large for PNG: ${cells} would be ${Math.ceil(size.width).toLocaleString()} by ${Math.ceil(size.height).toLocaleString()} pixels, over what a browser can draw. Choose a shorter column range, or copy as text or aligned FASTA instead.`;
  }
  return null;
}

/** The view that draws exactly `range`: scrolled to its first column, as wide as its columns. */
function viewOf(d: StackDrawing, r: ColumnRange, size: PictureSize) {
  return { left: r.start * d.charWidth, top: 0, width: size.width, height: size.height };
}

/** The picture of `range` as an SVG document; throws the limit's message when it is too large. */
export function alignmentSvg(d: StackDrawing, range: ColumnRange, title: string): string {
  const limit = pictureLimit(d, range, 'svg');
  const r = clampRange(d.stack, range);
  if (limit !== null || r === null) throw new Error(limit ?? 'No columns to export.');
  const size = pictureSize(d, r);
  const ctx = new SvgContext(Math.ceil(size.width), Math.ceil(size.height));
  drawStack(ctx, d, viewOf(d, r, size));
  return ctx.toSvg({
    title,
    description: `Alignment columns ${r.start + 1} to ${r.end}, ${d.stack.rows.length} samples against ${d.referenceName}`,
  });
}

/** The picture of `range` as a PNG; rejects with the limit's message when it is too large. */
export function alignmentPng(d: StackDrawing, range: ColumnRange): Promise<Blob> {
  const limit = pictureLimit(d, range, 'png');
  const r = clampRange(d.stack, range);
  if (limit !== null || r === null) return Promise.reject(new Error(limit ?? 'No columns.'));
  const size = pictureSize(d, r);
  const scale = pngScale(size) ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(size.width * scale);
  canvas.height = Math.ceil(size.height * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return Promise.reject(new Error('This browser cannot draw the picture.'));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawStack(ctx, d, viewOf(d, r, size));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('The browser could not encode the PNG.'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** A file name for a picture or text of `range`: the reference's name, the 1-based columns, the extension. */
export function exportFileName(
  referenceName: string,
  range: ColumnRange,
  extension: string,
): string {
  const stem =
    referenceName
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_') || 'alignment';
  return `${stem}-alignment-${range.start + 1}-${range.end}.${extension}`;
}
