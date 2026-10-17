/**
 * Map export as PNG (#212, item 89): the figure is the SVG the map export
 * already writes, drawn onto a canvas at a chosen scale. Only the browser can
 * rasterise, so the drawing is one small function; the rest is arithmetic
 * that can be tested without one.
 */

/** Scales offered in the dialog: 1x is the SVG's own pixel size, 4x suits a poster. */
export const PNG_SCALES = [1, 2, 4] as const;
export type PngScale = (typeof PNG_SCALES)[number];

/** Browsers refuse canvases past about this many pixels on a side. */
export const MAX_PNG_SIDE = 16_384;

/** The pixel size of the SVG document, from its root `width` and `height`. */
export function svgPixelSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  // Stryker disable next-line ConditionalExpression: with no root, exec(undefined) reads the text "undefined", finds no width, and the size is null anyway
  if (root === undefined) return null;
  const read = (name: string): number | null => {
    // Pixels, or millimetres as on an A4 page (#236), at the CSS 96 pixels per inch.
    const m = new RegExp(`\\s${name}="([\\d.]+)(mm)?"`).exec(root);
    // Stryker disable next-line StringLiteral: the fallback is for a missing group 1, which a matched pattern always has
    const n = m === null ? NaN : Number.parseFloat(m[1] ?? '') * (m[2] === 'mm' ? 96 / 25.4 : 1);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const width = read('width');
  const height = read('height');
  return width === null || height === null ? null : { width, height };
}

/** The PNG's size at a scale, or why it cannot be made. */
export function pngSize(
  svg: string,
  scale: number,
): { ok: true; width: number; height: number } | { ok: false; message: string } {
  const size = svgPixelSize(svg);
  if (size === null) return { ok: false, message: 'The map has no size to draw.' };
  return pngSizeOf(size, scale);
}

/**
 * The same from a size already known, as the sequence view's layout gives
 * it without drawing (#243). The message says the scale a browser would
 * draw; the dialog adds what else could change.
 */
export function pngSizeOf(
  size: { readonly width: number; readonly height: number },
  scale: number,
): { ok: true; width: number; height: number } | { ok: false; message: string } {
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) {
    return {
      ok: false,
      message: `At ${String(scale)}× the picture would be ${String(width)} × ${String(height)} pixels, more than a browser draws (${String(MAX_PNG_SIDE)}): choose a smaller scale.`,
    };
  }
  return { ok: true, width, height };
}

/** The largest offered scale at which a picture of `size` can still be drawn, or null when none. */
export function largestPngScale(size: {
  readonly width: number;
  readonly height: number;
}): PngScale | null {
  const side = Math.max(size.width, size.height);
  const fits = PNG_SCALES.filter((s) => Math.round(side * s) <= MAX_PNG_SIDE);
  return fits[fits.length - 1] ?? null;
}

/**
 * Draws the SVG onto a canvas of `scale` times its size and returns it as a
 * PNG. A transparent figure keeps the SVG's own (clear) background.
 */
export async function rasterizeSvg(svg: string, scale: number): Promise<Blob> {
  const size = pngSize(svg, scale);
  if (!size.ok) throw new Error(size.message);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('This browser cannot draw the picture.');
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error('The browser could not encode the PNG.'));
        else resolve(blob);
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
