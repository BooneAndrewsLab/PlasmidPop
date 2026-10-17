import { MAX_PNG_SIDE, pngSize, pngSizeOf, rasterizeSvg, svgPixelSize } from './mapPng';

const svg = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(w)}" height="${String(h)}" viewBox="0 0 ${String(w)} ${String(h)}"><title>x width="5"</title></svg>`;

describe('map PNG size (#212)', () => {
  it('reads the size from the root element only', () => {
    expect(svgPixelSize(svg(900, 640.5))).toEqual({ width: 900, height: 640.5 });
    expect(svgPixelSize('<svg viewBox="0 0 1 1"></svg>')).toBeNull();
    expect(svgPixelSize('not svg')).toBeNull();
    // An A4 page of the sequence export is in millimetres (#236).
    const a4 = svgPixelSize('<svg width="210mm" height="297mm"></svg>');
    expect(a4?.width).toBeCloseTo(793.7, 1);
    expect(a4?.height).toBeCloseTo(1122.5, 1);
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

  it('sizes a figure known by its layout, without an SVG (#243)', () => {
    expect(pngSizeOf({ width: 564, height: 7670.4 }, 2)).toEqual({
      ok: true,
      width: 1128,
      height: 15341,
    });
    const r = pngSizeOf({ width: 564, height: 7670 }, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('2256 × 30680');
  });

  it('refuses an SVG without a size', () => {
    expect(pngSize('<svg></svg>', 1).ok).toBe(false);
  });

  it('reads only a positive, finite width and height', () => {
    expect(svgPixelSize('<svg width="0" height="5"></svg>')).toBeNull();
    expect(svgPixelSize('<svg width="5" height="0"></svg>')).toBeNull();
    expect(svgPixelSize('<svg width="." height="5"></svg>')).toBeNull();
    expect(svgPixelSize(`<svg width="${'9'.repeat(400)}" height="5"></svg>`)).toBeNull();
    expect(svgPixelSize('<svg width="5"></svg>')).toBeNull();
    expect(svgPixelSize('<svg height="5"></svg>')).toBeNull();
    expect(svgPixelSize('<svg width="3" height="4"></svg>')).toEqual({ width: 3, height: 4 });
  });

  it('says why an SVG without a size cannot be drawn', () => {
    expect(pngSize('<svg></svg>', 1)).toEqual({
      ok: false,
      message: 'The map has no size to draw.',
    });
  });

  it('allows exactly the largest side on either axis and refuses one past it', () => {
    expect(pngSize(svg(100, MAX_PNG_SIDE), 1)).toEqual({
      ok: true,
      width: 100,
      height: MAX_PNG_SIDE,
    });
    expect(pngSize(svg(MAX_PNG_SIDE, 100), 1).ok).toBe(true);
    const tall = pngSize(svg(100, MAX_PNG_SIDE + 1), 1);
    expect(tall.ok).toBe(false);
    if (!tall.ok) expect(tall.message).toContain(`100 × ${String(MAX_PNG_SIDE + 1)} pixels`);
  });
});

describe('rasterizeSvg (#212)', () => {
  interface FakeCanvas {
    width: number;
    height: number;
    getContext: (kind: string) => unknown;
    toBlob: (cb: (b: Blob | null) => void, type: string) => void;
  }

  function stubBrowser(opts: { ctx?: boolean; blob?: Blob | null }) {
    const calls = {
      created: [] as Blob[],
      revoked: [] as string[],
      element: [] as string[],
      context: [] as string[],
      draw: [] as unknown[][],
      encode: [] as string[],
      src: [] as string[],
    };
    const canvas: FakeCanvas = {
      width: 0,
      height: 0,
      getContext: (kind) => {
        calls.context.push(kind);
        return opts.ctx === false
          ? null
          : {
              drawImage: (...a: unknown[]) => {
                calls.draw.push(a);
              },
            };
      },
      toBlob: (cb, type) => {
        calls.encode.push(type);
        cb(opts.blob === undefined ? new Blob(['png'], { type: 'image/png' }) : opts.blob);
      },
    };
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      calls.created.push(b as Blob);
      return 'blob:fake';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => {
      calls.revoked.push(u);
    });
    vi.stubGlobal(
      'Image',
      class {
        set src(v: string) {
          calls.src.push(v);
        }
        decode() {
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        calls.element.push(tag);
        return canvas;
      },
    });
    return { calls, canvas };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws the SVG at the scaled size and returns the encoded PNG', async () => {
    const out = new Blob(['png'], { type: 'image/png' });
    const { calls, canvas } = stubBrowser({ blob: out });
    const text = svg(300, 200);
    const result = await rasterizeSvg(text, 2);
    expect(result).toBe(out);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]?.type).toBe('image/svg+xml;charset=utf-8');
    expect(await calls.created[0]?.text()).toBe(text);
    expect(calls.src).toEqual(['blob:fake']);
    expect(calls.element).toEqual(['canvas']);
    expect(calls.context).toEqual(['2d']);
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(calls.draw).toHaveLength(1);
    expect(calls.draw[0]?.slice(1)).toEqual([0, 0, 600, 400]);
    expect(calls.encode).toEqual(['image/png']);
    expect(calls.revoked).toEqual(['blob:fake']);
  });

  it('refuses an impossible size before touching the browser', async () => {
    const { calls } = stubBrowser({});
    await expect(rasterizeSvg('<svg></svg>', 1)).rejects.toThrow('The map has no size to draw.');
    await expect(rasterizeSvg(svg(MAX_PNG_SIDE, 10), 2)).rejects.toThrow('choose a smaller scale');
    expect(calls.created).toHaveLength(0);
  });

  it('says so when there is no 2d context, and still releases the URL', async () => {
    const { calls } = stubBrowser({ ctx: false });
    await expect(rasterizeSvg(svg(10, 10), 1)).rejects.toThrow(
      'This browser cannot draw the picture.',
    );
    expect(calls.draw).toHaveLength(0);
    expect(calls.revoked).toEqual(['blob:fake']);
  });

  it('says so when the browser cannot encode, and still releases the URL', async () => {
    const { calls } = stubBrowser({ blob: null });
    await expect(rasterizeSvg(svg(10, 10), 1)).rejects.toThrow(
      'The browser could not encode the PNG.',
    );
    expect(calls.revoked).toEqual(['blob:fake']);
  });
});
