/**
 * How runs of bases are drawn (#89, #91): a colour for their letters, a
 * highlight behind them, bold, a larger size. A mark on the bases a user
 * wants to point at, the way one colours words in a text; not an
 * annotation, so it takes no lane and is no feature.
 *
 * The styles are kept as sorted, non-overlapping runs over the unrolled
 * coordinates `[0, length)`: a run never wraps the origin, a style over the
 * origin of a circle is two runs. Neighbouring runs of the same style merge,
 * so there is one way to write any set of styles and two can be compared
 * run by run.
 */

/** The sizes a base can be drawn at, as a multiple of the view's own. */
export const BASE_SIZES = [1.25, 1.5, 2] as const;
export type BaseSize = (typeof BASE_SIZES)[number];

export function isBaseSize(n: unknown): n is BaseSize {
  return typeof n === 'number' && (BASE_SIZES as readonly number[]).includes(n);
}

export interface BaseStyle {
  /** Colour of the letters, `#rrggbb`. */
  readonly color?: string;
  /** Colour behind them, `#rrggbb`. */
  readonly highlight?: string;
  readonly bold?: boolean;
  /** Larger than the rest of the sequence; absent is the ordinary size. */
  readonly size?: BaseSize;
}

/**
 * A change to the style of some bases: a value sets that part of the style,
 * `null` takes it off, and a part left out stays as each base has it. So
 * colouring a stretch keeps whatever of it was bold.
 */
export interface BaseStylePatch {
  readonly color?: string | null;
  readonly highlight?: string | null;
  readonly bold?: boolean | null;
  readonly size?: BaseSize | null;
}

/** The patch that takes every part of the style off. */
export const CLEAR_BASE_STYLE: BaseStylePatch = {
  color: null,
  highlight: null,
  bold: null,
  size: null,
};

export interface StyleRun {
  readonly start: number;
  readonly end: number;
  readonly style: BaseStyle;
}

const HEX = /^#[0-9a-f]{6}$/;

export function isStyleColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** `#abc`, `#AABBCC` and the like as the `#aabbcc` a style keeps, or null. */
export function normalizeStyleColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v.slice(1).replace(/./g, '$&$&')}`;
  return HEX.test(v) ? v : null;
}

/** Whether `value` is a style this model can hold: known keys, valid values, not empty. */
export function isBaseStyle(value: unknown): value is BaseStyle {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  return (
    keys.length > 0 &&
    keys.every((k) => k === 'color' || k === 'highlight' || k === 'bold' || k === 'size') &&
    (v['color'] === undefined || isStyleColor(v['color'])) &&
    (v['highlight'] === undefined || isStyleColor(v['highlight'])) &&
    (v['bold'] === undefined || v['bold'] === true) &&
    (v['size'] === undefined || isBaseSize(v['size']))
  );
}

export function baseStylesEqual(a: BaseStyle, b: BaseStyle): boolean {
  return (
    a.color === b.color && a.highlight === b.highlight && a.bold === b.bold && a.size === b.size
  );
}

/** `style` with `patch` applied, or null when nothing is left of it. */
function patched(style: BaseStyle | null, patch: BaseStylePatch): BaseStyle | null {
  const out: { color?: string; highlight?: string; bold?: boolean; size?: BaseSize } = {};
  const pick = <K extends keyof BaseStylePatch>(key: K): BaseStylePatch[K] | undefined =>
    patch[key] ?? (patch[key] === null ? null : style?.[key]);
  const color = pick('color');
  const highlight = pick('highlight');
  const bold = pick('bold');
  const size = pick('size');
  if (color != null) out.color = color;
  if (highlight != null) out.highlight = highlight;
  if (bold === true) out.bold = true;
  if (size != null) out.size = size;
  return Object.keys(out).length === 0 ? null : out;
}

/** Runs sorted, clipped of empties, and neighbours of one style merged. */
function tidy(runs: readonly StyleRun[]): StyleRun[] {
  const out: StyleRun[] = [];
  for (const run of runs) {
    if (run.end <= run.start) continue;
    const last = out[out.length - 1];
    if (last?.end === run.start && baseStylesEqual(last.style, run.style)) {
      out[out.length - 1] = { start: last.start, end: run.end, style: last.style };
    } else out.push(run);
  }
  return out;
}

/**
 * An immutable set of styled runs. Every edit of the document moves them the
 * way it moves the bases they are on (`SeqDocument`), so a run stays on its
 * bases however the sequence around it changes.
 */
export class BaseStyles {
  static readonly EMPTY = new BaseStyles([]);

  private constructor(readonly runs: readonly StyleRun[]) {}

  /**
   * Styles from runs as a file or a store gives them: sorted, not
   * overlapping, inside `[0, length)`. Throws otherwise, the way a feature
   * out of range does.
   */
  static from(runs: readonly StyleRun[], length: number): BaseStyles {
    let previous = 0;
    for (const run of runs) {
      if (
        !Number.isInteger(run.start) ||
        !Number.isInteger(run.end) ||
        run.start < previous ||
        run.end <= run.start ||
        run.end > length ||
        !isBaseStyle(run.style)
      ) {
        throw new RangeError(`Base style ${run.start}..${run.end} is not valid here`);
      }
      previous = run.end;
    }
    const tidied = tidy(runs);
    return tidied.length === 0 ? BaseStyles.EMPTY : new BaseStyles(tidied);
  }

  private static of(runs: readonly StyleRun[]): BaseStyles {
    const tidied = tidy(runs);
    return tidied.length === 0 ? BaseStyles.EMPTY : new BaseStyles(tidied);
  }

  get isEmpty(): boolean {
    return this.runs.length === 0;
  }

  equals(other: BaseStyles): boolean {
    if (other === this) return true;
    if (other.runs.length !== this.runs.length) return false;
    return this.runs.every((run, i) => {
      const o = other.runs[i];
      return o?.start === run.start && o.end === run.end && baseStylesEqual(o.style, run.style);
    });
  }

  /** Index of the first run that ends after `position`. */
  private firstEndingAfter(position: number): number {
    let lo = 0;
    let hi = this.runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.runs[mid]?.end ?? 0) <= position) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The runs that touch `[start, end)`, clipped to it. */
  within(start: number, end: number): StyleRun[] {
    const out: StyleRun[] = [];
    for (let i = this.firstEndingAfter(start); i < this.runs.length; i++) {
      const run = this.runs[i];
      if (run === undefined || run.start >= end) break;
      out.push({
        start: Math.max(start, run.start),
        end: Math.min(end, run.end),
        style: run.style,
      });
    }
    return out;
  }

  /** The style of the base at `position`, or null for an ordinary one. */
  at(position: number): BaseStyle | null {
    const run = this.runs[this.firstEndingAfter(position)];
    return run !== undefined && run.start <= position ? run.style : null;
  }

  /** `patch` applied to every base of `[start, end)`, styled or not. */
  restyle(start: number, end: number, patch: BaseStylePatch): BaseStyles {
    if (end <= start) return this;
    const out: StyleRun[] = [];
    const add = (s: number, e: number, style: BaseStyle | null): void => {
      if (style !== null && e > s) out.push({ start: s, end: e, style });
    };
    let cursor = start;
    for (const run of this.runs) {
      if (run.end <= start || run.start >= end) {
        out.push(run);
        continue;
      }
      add(run.start, start, run.style);
      // The gap before this run is unstyled bases, which take the patch too.
      add(cursor, Math.max(cursor, run.start), patched(null, patch));
      add(Math.max(start, run.start), Math.min(end, run.end), patched(run.style, patch));
      add(end, run.end, run.style);
      cursor = Math.min(end, run.end);
    }
    add(cursor, end, patched(null, patch));
    out.sort((a, b) => a.start - b.start);
    return BaseStyles.of(out);
  }

  /** The runs of `[start, end)` replaced by `runs`, which are relative to `start`. */
  replaceWithin(start: number, end: number, runs: readonly StyleRun[]): BaseStyles {
    const out: StyleRun[] = [];
    for (const run of this.runs) {
      if (run.end <= start || run.start >= end) {
        out.push(run);
        continue;
      }
      if (run.start < start) out.push({ start: run.start, end: start, style: run.style });
      if (run.end > end) out.push({ start: end, end: run.end, style: run.style });
    }
    for (const run of runs) {
      const s = Math.max(start, start + run.start);
      const e = Math.min(end, start + run.end);
      if (e > s) out.push({ start: s, end: e, style: run.style });
    }
    out.sort((a, b) => a.start - b.start);
    return BaseStyles.of(out);
  }

  /**
   * `count` bases inserted before `position`. Bases inserted inside a run
   * take its style, as letters typed into coloured text do; at either edge
   * of one they are ordinary.
   */
  insert(position: number, count: number): BaseStyles {
    if (count === 0 || this.isEmpty) return this;
    return BaseStyles.of(
      this.runs.map((run) =>
        run.end <= position
          ? run
          : run.start >= position
            ? { start: run.start + count, end: run.end + count, style: run.style }
            : { start: run.start, end: run.end + count, style: run.style },
      ),
    );
  }

  /** The bases of `[start, end)` removed, and their styles with them. */
  delete(start: number, end: number): BaseStyles {
    const count = end - start;
    if (count <= 0 || this.isEmpty) return this;
    const move = (p: number): number => (p <= start ? p : p >= end ? p - count : start);
    return BaseStyles.of(
      this.runs.map((run) => ({ start: move(run.start), end: move(run.end), style: run.style })),
    );
  }

  /** Base `origin` of a circle of `length` made base 0 (Set origin). */
  rotate(origin: number, length: number): BaseStyles {
    if (origin === 0 || this.isEmpty) return this;
    const out: StyleRun[] = [];
    for (const run of this.runs) {
      const pieces: [number, number][] =
        run.start < origin && run.end > origin
          ? [
              [run.start, origin],
              [origin, run.end],
            ]
          : [[run.start, run.end]];
      for (const [s, e] of pieces) {
        const shift = s >= origin ? -origin : length - origin;
        out.push({ start: s + shift, end: e + shift, style: run.style });
      }
    }
    out.sort((a, b) => a.start - b.start);
    return BaseStyles.of(out);
  }

  /** The sequence of `length` read the other way (reverse complement). */
  reverse(length: number): BaseStyles {
    if (this.isEmpty) return this;
    return BaseStyles.of(
      [...this.runs]
        .reverse()
        .map((run) => ({ start: length - run.end, end: length - run.start, style: run.style })),
    );
  }

  /** The runs of `[start, end)`, counted from `start`: the styles of an extract. */
  slice(start: number, end: number): StyleRun[] {
    return this.within(start, end).map((run) => ({
      start: run.start - start,
      end: run.end - start,
      style: run.style,
    }));
  }
}
