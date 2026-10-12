import { MAX_PNG_SIDE, pngSize, svgPixelSize } from './mapPng';

const svg = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(w)}" height="${String(h)}" viewBox="0 0 ${String(w)} ${String(h)}"><title>x width="5"</title></svg>`;

describe('map PNG size (#212)', () => {
  it('reads the size from the root element only', () => {
    expect(svgPixelSize(svg(900, 640.5))).toEqual({ width: 900, height: 640.5 });
    expect(svgPixelSize('<svg viewBox="0 0 1 1"></svg>')).toBeNull();
    expect(svgPixelSize('not svg')).toBeNull();
  });

  it('multiplies by the scale', () => {
    expect(pngSize(svg(900, 900), 2)).toEqual({ ok: true, width: 1800, height: 1800 });
    expect(pngSize(svg(901, 900), 0.5)).toEqual({ ok: true, width: 451, height: 450 });
  });

  it('refuses what a browser cannot draw, and says the size', () => {
    const r = pngSize(svg(MAX_PNG_SIDE / 2 + 1, 100), 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('choose a smaller scale');
    expect(pngSize(svg(MAX_PNG_SIDE / 2, 100), 2).ok).toBe(true);
  });

  it('refuses an SVG without a size', () => {
    expect(pngSize('<svg></svg>', 1).ok).toBe(false);
  });
});
