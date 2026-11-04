// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { alignEitherStrand } from '@/core';

import { finishReadAlignment, prepareReadAlignment } from '../readAlignment';
import { AlignmentDialog } from './AlignmentDialog';
import type * as Draw from './alignmentStackDraw';
import { NAME_WIDTH, ROW_HEIGHT, RULER_HEIGHT, drawStack } from './alignmentStackDraw';

// The canvas is not drawn in jsdom: what would be drawn is what the test reads.
vi.mock('./alignmentStackDraw', async (importOriginal) => ({
  ...(await importOriginal<typeof Draw>()),
  drawStack: vi.fn(),
}));

/**
 * The large view's Esc chain (#370): the Find or Go to form closes first,
 * then the selection clears, and the window closes on the next press.
 */

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
const ref = { sequence: reference, offset: 0, wrap: null };
function sample(name: string, sequence: string) {
  const prepared = prepareReadAlignment(ref, { sequence, read: null }, null);
  if (!prepared.ok) throw new Error(prepared.message);
  const { job } = prepared;
  return {
    name,
    result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
  };
}

const WIDTH = 800;
const HEIGHT = 400;
const CHAR = 8;
const context = new Proxy({} as CanvasRenderingContext2D, {
  get: (_, key) => (key === 'measureText' ? () => ({ width: CHAR * 10 }) : () => undefined),
  set: () => true,
});
/** No document, so no track or residues: the first sample's bases sit right under the reference's. */
const ROW0_Y = RULER_HEIGHT + ROW_HEIGHT + ROW_HEIGHT / 2;
const columnX = (c: number): number => NAME_WIDTH + c * CHAR + CHAR / 2;
const mouse = { button: 0, pointerId: 1, pointerType: 'mouse' };

let descriptors: PropertyDescriptor[] = [];
function setup() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const onClose = vi.fn();
  render(
    <AlignmentDialog
      reference={ref}
      referenceName="ref"
      samples={[sample('r', reference.slice(10, 40))]}
      documentIsRead={false}
      document={null}
      onClose={onClose}
    />,
  );
  const canvas = document.querySelector('canvas.astack__canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, HEIGHT);
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.hasPointerCapture = () => false;
  return { canvas, onClose };
}

const selected = () => {
  const call = vi.mocked(drawStack).mock.calls.at(-1);
  if (call === undefined) throw new Error('nothing drawn');
  return call[1].selection ?? null;
};
const escape = () => {
  fireEvent.keyDown(document, { key: 'Escape' });
};

describe('Esc in the large view (#370)', () => {
  beforeEach(() => {
    vi.mocked(drawStack).mockClear();
    descriptors = ['clientWidth', 'clientHeight'].map((p) => {
      const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, p) ?? {
        configurable: true,
      };
      Object.defineProperty(HTMLElement.prototype, p, {
        configurable: true,
        get: () => (p === 'clientWidth' ? WIDTH : HEIGHT),
      });
      return d;
    });
  });
  afterEach(() => {
    ['clientWidth', 'clientHeight'].forEach((p, i) => {
      const d = descriptors[i];
      if (d !== undefined && 'get' in d) Object.defineProperty(HTMLElement.prototype, p, d);
      else Reflect.deleteProperty(HTMLElement.prototype, p);
    });
    vi.restoreAllMocks();
  });

  it('closes the Find form, then clears the selection, then closes the window', () => {
    const { canvas, onClose } = setup();
    fireEvent.pointerDown(canvas, { ...mouse, clientX: columnX(12), clientY: ROW0_Y });
    fireEvent.pointerMove(canvas, { ...mouse, clientX: columnX(16), clientY: ROW0_Y });
    fireEvent.pointerUp(canvas, { ...mouse, clientX: columnX(16), clientY: ROW0_Y });
    expect(selected()).toMatchObject({ row: 0, anchor: 12, head: 16 });
    expect(screen.getByRole('toolbar', { name: 'Selected residues' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(screen.getByPlaceholderText('GAATTC, RGATCY')).toBeInTheDocument();
    escape();
    expect(screen.queryByPlaceholderText('GAATTC, RGATCY')).toBeNull();
    expect(selected()).toMatchObject({ row: 0, anchor: 12, head: 16 });
    expect(onClose).not.toHaveBeenCalled();

    escape();
    expect(selected()).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Selected residues' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
