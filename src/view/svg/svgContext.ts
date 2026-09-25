import { type DrawingContext } from '../drawingContext';

/**
 * Records canvas-style drawing calls and emits SVG. Supports exactly what
 * the map and sequence renderers use: paths made of lines and arcs, filled
 * rectangles and text. Text width is estimated from the font size since
 * there is no layout engine here; renderers only use it to fit labels.
 */

interface FontSpec {
  readonly size: number;
  readonly weight: string;
  readonly family: string;
}

function parseFont(font: string): FontSpec {
  const m = /(?:(\d{3}|bold|normal)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/.exec(font.trim());
  if (m === null) return { size: 12, weight: 'normal', family: 'sans-serif' };
  return {
    size: Number.parseFloat(m[2] ?? '12'),
    weight: m[1] ?? 'normal',
    family: (m[3] ?? 'sans-serif').trim(),
  };
}

/** `text` made safe inside SVG text and attribute values. */
export function escapeSvgText(text: string): string {
  return esc(text);
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, '');
}

function paintAttr(
  name: 'fill' | 'stroke',
  style: string | CanvasGradient | CanvasPattern,
): string {
  return `${name}="${typeof style === 'string' ? esc(style) : 'currentColor'}"`;
}

/**
 * Advance widths of Helvetica and Arial, in thousandths of an em. There is
 * no layout engine here, so text has to be estimated — and since the map's
 * label pass now decides what fits from the estimate, a flat average is not
 * good enough: "MCS" is 2.2 em of Helvetica and 1.65 em of a 0.55 average,
 * which is the difference between two labels clearing each other in an
 * export and running together.
 */
const UPPER = [
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611,
];
const LOWER = [
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500,
];
const PUNCTUATION: Readonly<Record<string, number>> = {
  ' ': 278,
  '.': 278,
  ',': 278,
  ':': 278,
  ';': 278,
  "'": 191,
  '"': 355,
  '(': 333,
  ')': 333,
  '[': 278,
  ']': 278,
  '-': 333,
  '/': 278,
  '+': 584,
  '\u2026': 1000,
  '\u2032': 247,
};
/** Anything else, including the Greek and accented letters a plasmid name carries. */
const DEFAULT_ADVANCE = 550;

/** Width of `text` in ems of a proportional font, as `measureText` sees it. */
export function textAdvance(text: string): number {
  let em = 0;
  for (const ch of text) em += advance(ch);
  return em;
}

/** Whether a colour paints nothing, so a plate behind text can be skipped. */
export function isTransparent(color: string): boolean {
  return /^(transparent|rgba?\([^)]*,\s*0(\.0+)?\s*\))$/i.test(color.trim());
}

function advance(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) return (UPPER[code - 65] ?? DEFAULT_ADVANCE) / 1000;
  if (code >= 97 && code <= 122) return (LOWER[code - 97] ?? DEFAULT_ADVANCE) / 1000;
  if (code >= 48 && code <= 57) return 0.556;
  return (PUNCTUATION[ch] ?? DEFAULT_ADVANCE) / 1000;
}

interface State {
  tx: number;
  ty: number;
}

export class SvgContext implements DrawingContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  font = '10px sans-serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  private dash: readonly number[] = [];
  private readonly parts: string[] = [];
  private path: string[] = [];
  private hasCurrentPoint = false;
  private state: State = { tx: 0, ty: 0 };
  private readonly stack: State[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  save(): void {
    this.stack.push({ ...this.state });
  }

  restore(): void {
    const s = this.stack.pop();
    if (s !== undefined) this.state = s;
  }

  /** Only translations are honoured; renderers use setTransform for device-pixel scaling, which SVG does not need. */
  setTransform(_a: number, _b: number, _c: number, _d: number, e: number, f: number): void {
    this.state = { tx: e, ty: f };
  }

  translate(x: number, y: number): void {
    this.state = { tx: this.state.tx + x, ty: this.state.ty + y };
  }

  private px(x: number): string {
    return num(x + this.state.tx);
  }

  private py(y: number): string {
    return num(y + this.state.ty);
  }

  beginPath(): void {
    this.path = [];
    this.hasCurrentPoint = false;
  }

  closePath(): void {
    if (this.path.length > 0) this.path.push('Z');
    this.hasCurrentPoint = false;
  }

  moveTo(x: number, y: number): void {
    this.path.push(`M${this.px(x)} ${this.py(y)}`);
    this.hasCurrentPoint = true;
  }

  lineTo(x: number, y: number): void {
    this.path.push(`${this.hasCurrentPoint ? 'L' : 'M'}${this.px(x)} ${this.py(y)}`);
    this.hasCurrentPoint = true;
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    const twoPi = Math.PI * 2;
    let sweep = endAngle - startAngle;
    if (!counterclockwise && sweep < 0) sweep += twoPi * Math.ceil(-sweep / twoPi);
    if (counterclockwise && sweep > 0) sweep -= twoPi * Math.ceil(sweep / twoPi);
    const full = Math.abs(sweep) >= twoPi - 1e-9;
    if (full) sweep = counterclockwise ? -twoPi : twoPi;
    const sx = x + radius * Math.cos(startAngle);
    const sy = y + radius * Math.sin(startAngle);
    this.path.push(`${this.hasCurrentPoint ? 'L' : 'M'}${this.px(sx)} ${this.py(sy)}`);
    const sweepFlag = sweep >= 0 ? 1 : 0;
    const r = num(radius);
    if (full) {
      // Two half arcs; a single arc command cannot describe a full circle.
      const mid = startAngle + sweep / 2;
      const mx = x + radius * Math.cos(mid);
      const my = y + radius * Math.sin(mid);
      this.path.push(`A${r} ${r} 0 0 ${sweepFlag} ${this.px(mx)} ${this.py(my)}`);
      this.path.push(`A${r} ${r} 0 0 ${sweepFlag} ${this.px(sx)} ${this.py(sy)}`);
    } else {
      const ex = x + radius * Math.cos(startAngle + sweep);
      const ey = y + radius * Math.sin(startAngle + sweep);
      const large = Math.abs(sweep) > Math.PI ? 1 : 0;
      this.path.push(`A${r} ${r} 0 ${large} ${sweepFlag} ${this.px(ex)} ${this.py(ey)}`);
    }
    this.hasCurrentPoint = true;
  }

  setLineDash(segments: number[]): void {
    this.dash = [...segments];
  }

  fill(): void {
    if (this.path.length === 0) return;
    this.parts.push(
      `<path d="${this.path.join(' ')}" ${paintAttr('fill', this.fillStyle)} stroke="none"/>`,
    );
  }

  stroke(): void {
    if (this.path.length === 0) return;
    const cap = this.lineCap === 'butt' ? '' : ` stroke-linecap="${this.lineCap}"`;
    const dash =
      this.dash.length === 0 ? '' : ` stroke-dasharray="${this.dash.map(num).join(' ')}"`;
    this.parts.push(
      `<path d="${this.path.join(' ')}" fill="none" ${paintAttr('stroke', this.strokeStyle)} stroke-width="${num(this.lineWidth)}"${cap}${dash}/>`,
    );
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.parts.push(
      `<rect x="${this.px(x)}" y="${this.py(y)}" width="${num(w)}" height="${num(h)}" ${paintAttr('fill', this.fillStyle)}/>`,
    );
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    if (text === '') return;
    const f = parseFont(this.font);
    const anchor =
      this.textAlign === 'center'
        ? 'middle'
        : this.textAlign === 'right' || this.textAlign === 'end'
          ? 'end'
          : 'start';
    const baseline =
      this.textBaseline === 'middle'
        ? ' dominant-baseline="central"'
        : this.textBaseline === 'top' || this.textBaseline === 'hanging'
          ? ' dominant-baseline="hanging"'
          : '';
    const width = this.measureText(text).width;
    const fit =
      maxWidth !== undefined && width > maxWidth
        ? ` textLength="${num(maxWidth)}" lengthAdjust="spacingAndGlyphs"`
        : '';
    const weight = f.weight === 'normal' ? '' : ` font-weight="${f.weight}"`;
    // SVG collapses leading, trailing and repeated spaces unless told not to.
    // The sequence rows are drawn with spaces standing in for columns that
    // stay empty (a base of another colour, the gap opposite an overhang), so
    // those runs have to survive or every letter after them shifts left.
    const space = /^\s|\s$|\s\s/.test(text) ? ' xml:space="preserve"' : '';
    this.parts.push(
      `<text x="${this.px(x)}" y="${this.py(y)}" font-family="${esc(f.family)}" font-size="${num(f.size)}"${weight} text-anchor="${anchor}"${baseline}${space} ${paintAttr('fill', this.fillStyle)}${fit}>${esc(text)}</text>`,
    );
  }

  measureText(text: string): { readonly width: number } {
    const f = parseFont(this.font);
    if (/mono|menlo|consolas|courier/i.test(f.family)) return { width: text.length * f.size * 0.6 };
    return { width: textAdvance(text) * f.size };
  }

  /** The drawing alone, without an `<svg>` around it, to be placed in another (#30). */
  body(): string {
    return this.parts.join('');
  }

  toSvg(options: { readonly title?: string; readonly description?: string } = {}): string {
    const title = options.title === undefined ? '' : `<title>${esc(options.title)}</title>`;
    const desc =
      options.description === undefined ? '' : `<desc>${esc(options.description)}</desc>`;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${num(this.width)}" height="${num(this.height)}" viewBox="0 0 ${num(this.width)} ${num(this.height)}">` +
      `${title}${desc}${this.parts.join('')}</svg>`
    );
  }
}
