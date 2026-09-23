import { useLayoutEffect, useRef } from 'react';

import { type SequencingRead } from '@/core';
import { type TraceBaseAt, drawTrace } from '@/view/trace';

import { readLinearTheme } from './linearTheme';

/** Height of a block's trace, in CSS pixels. */
const HEIGHT = 44;

/**
 * The chromatogram under one block of an alignment (#52): the read's trace
 * for the columns of the block, each base's peak under its letter, stretched
 * across the columns where the read has a gap. Drawn once per block on a
 * canvas as wide as the block's text.
 */
export function AlignmentTrace({
  read,
  bases,
  columns,
  indent,
  charWidth,
}: {
  read: SequencingRead;
  /** The block's read bases: index in `read` and column in the block. */
  bases: readonly { readonly index: number; readonly column: number }[];
  /** Columns in the block. */
  columns: number;
  /** Characters before the first column (the position numbers). */
  indent: number;
  /** Advance width of one character of the alignment's text. */
  charWidth: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = Math.ceil((indent + columns) * charWidth);

  useLayoutEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null) return;
    const dpr = globalThis.devicePixelRatio || 1;
    el.width = Math.round(width * dpr);
    el.height = Math.round(HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const theme = readLinearTheme(el);
    const at: TraceBaseAt[] = bases.map((b) => ({
      index: b.index,
      x: (indent + b.column) * charWidth + charWidth / 2,
    }));
    drawTrace(ctx, {
      read,
      bases: at,
      top: 2,
      height: HEIGHT - 4,
      charWidth,
      colors: { ...theme.baseColors, quality: theme.traceQuality },
    });
  }, [read, bases, indent, charWidth, width]);

  return (
    <canvas
      ref={canvas}
      className="alignment__trace"
      style={{ width: `${width}px`, height: `${HEIGHT}px` }}
      aria-hidden="true"
    />
  );
}
