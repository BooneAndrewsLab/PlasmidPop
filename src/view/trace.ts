import { type SequencingRead, type Trace, type TraceBase, TRACE_BASES } from '@/core';

import { type DrawingContext } from './drawingContext';

/**
 * The chromatogram of a sequencing read (#52): the four dye signals drawn
 * so that each base's peak sits over its letter, and the base qualities as
 * faint bars behind. Used by the sequence view, above a read document's
 * bases, and by the Align panel, under an aligned read.
 *
 * The caller lists the bases to draw and where each one's centre is. The
 * signal between two listed bases' peaks is stretched to span the distance
 * between their centres, which is what lines the trace up with evenly
 * spaced letters although the peaks are not evenly spaced, and what lets
 * the Align panel draw across a gap in the read by simply leaving a column
 * out. Half a base's worth of signal is drawn beyond the first and last.
 */

export interface TraceColors {
  readonly a: string;
  readonly c: string;
  readonly g: string;
  readonly t: string;
  /** The quality bars behind the signal. */
  readonly quality: string;
}

/** A base to draw: its index in the read and the x its peak goes at. */
export interface TraceBaseAt {
  readonly index: number;
  readonly x: number;
}

export interface TraceDraw {
  readonly read: SequencingRead;
  readonly bases: readonly TraceBaseAt[];
  readonly top: number;
  readonly height: number;
  /** Width of one base column, for the quality bars and the ends. */
  readonly charWidth: number;
  readonly colors: TraceColors;
}

/** Quality drawn full height: Q60, as good as base callers report. */
const QUALITY_TOP = 60;

const scaleCache = new WeakMap<Trace, number>();

/**
 * The signal height drawn full height: the 99th percentile of the tallest
 * channel at each point, sampled, so a few huge peaks (a dye blob) do not
 * flatten the rest. Cached per trace; the same for every row, so rows can
 * be compared by eye.
 */
export function traceScale(trace: Trace): number {
  const cached = scaleCache.get(trace);
  if (cached !== undefined) return cached;
  const { A, C, G, T } = trace.channels;
  const step = Math.max(1, Math.floor(A.length / 4000));
  const tallest: number[] = [];
  for (let s = 0; s < A.length; s += step) {
    tallest.push(Math.max(A[s] ?? 0, C[s] ?? 0, G[s] ?? 0, T[s] ?? 0));
  }
  tallest.sort((x, y) => x - y);
  const scale = Math.max(1, tallest[Math.floor(tallest.length * 0.99)] ?? 1);
  scaleCache.set(trace, scale);
  return scale;
}

function channelColor(colors: TraceColors, base: TraceBase): string {
  return base === 'A' ? colors.a : base === 'C' ? colors.c : base === 'G' ? colors.g : colors.t;
}

/** Trace position (fractional sample) and x for each drawn segment's ends. */
interface Knot {
  readonly sample: number;
  readonly x: number;
}

/**
 * The knots the signal is stretched between: each listed base's peak at its
 * x, and half a base's worth beyond the first and the last.
 */
function knots(trace: Trace, bases: readonly TraceBaseAt[], charWidth: number): Knot[] {
  const peaks = trace.peaks;
  const out: Knot[] = [];
  const peakOf = (i: number): number => peaks[Math.max(0, Math.min(peaks.length - 1, i))] ?? 0;
  const first = bases[0];
  const last = bases[bases.length - 1];
  if (first === undefined || last === undefined) return out;
  // Half the way to the neighbouring peak, or half a spacing when there is none.
  const before =
    first.index > 0
      ? (peakOf(first.index - 1) + peakOf(first.index)) / 2
      : peakOf(0) - (peakOf(1) - peakOf(0)) / 2;
  out.push({ sample: before, x: first.x - charWidth / 2 });
  for (const b of bases) out.push({ sample: peakOf(b.index), x: b.x });
  const after =
    last.index < peaks.length - 1
      ? (peakOf(last.index) + peakOf(last.index + 1)) / 2
      : peakOf(last.index) + (peakOf(last.index) - peakOf(last.index - 1)) / 2;
  out.push({ sample: after, x: last.x + charWidth / 2 });
  return out;
}

export function drawTrace(ctx: DrawingContext, d: TraceDraw): void {
  const trace = d.read.trace;
  if (trace === null || d.bases.length === 0) return;
  const { top, height, charWidth, colors } = d;
  const bottom = top + height;

  // Qualities first, behind.
  ctx.fillStyle = colors.quality;
  const barWidth = Math.max(1, charWidth - 2);
  for (const b of d.bases) {
    const q = Math.min(QUALITY_TOP, d.read.qualities[b.index] ?? 0);
    const h = (q / QUALITY_TOP) * height;
    if (h > 0) ctx.fillRect(b.x - barWidth / 2, bottom - h, barWidth, h);
  }

  const scale = traceScale(trace);
  const yOf = (v: number): number => bottom - Math.max(0, Math.min(1, v / scale)) * (height - 2);
  const path = knots(trace, d.bases, charWidth);
  const samples = trace.channels.A.length;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  for (const base of TRACE_BASES) {
    const signal = trace.channels[base];
    const at = (s: number): number => {
      // Between whole samples, linearly: knots at half-way points land there.
      const i = Math.max(0, Math.min(samples - 1, Math.floor(s)));
      const f = s - Math.floor(s);
      const v0 = signal[i] ?? 0;
      const v1 = signal[Math.min(samples - 1, i + 1)] ?? v0;
      return v0 + (v1 - v0) * f;
    };
    ctx.strokeStyle = channelColor(colors, base);
    ctx.beginPath();
    let started = false;
    for (let k = 1; k < path.length; k++) {
      const p = path[k - 1];
      const q = path[k];
      if (p === undefined || q === undefined) continue;
      const span = q.sample - p.sample;
      if (!started) {
        ctx.moveTo(p.x, yOf(at(p.sample)));
        started = true;
      }
      if (span <= 0) {
        ctx.lineTo(q.x, yOf(at(q.sample)));
        continue;
      }
      // Every whole sample between the two knots, then the far knot.
      for (let s = Math.ceil(p.sample); s < q.sample; s++) {
        ctx.lineTo(p.x + ((s - p.sample) / span) * (q.x - p.x), yOf(at(s)));
      }
      ctx.lineTo(q.x, yOf(at(q.sample)));
    }
    ctx.stroke();
  }
}
