import { InvalidSequenceError, SeqDocument, createFeature, rangeSegment } from '@/core';

import {
  clampPosition,
  deleteBackward,
  deleteForward,
  pasteFragment,
  selectionAfterOp,
  selectionBetween,
  typeText,
} from './editing';

const linear = SeqDocument.create({ sequence: 'ACGTACGTAC' }); // 10 bp
const circular = SeqDocument.create({ sequence: 'ACGTACGTAC', topology: 'circular' });

describe('typeText', () => {
  it('inserts at a caret and moves the caret past the text', () => {
    expect(typeText(linear, { start: 3, end: 3 }, 'gg')).toEqual({
      op: { type: 'insert', position: 3, text: 'gg' },
      selectionAfter: { start: 5, end: 5 },
    });
    expect(typeText(circular, { start: 10, end: 10 }, 'G')).toMatchObject({
      op: { type: 'insert', position: 0, text: 'G' },
      selectionAfter: { start: 1, end: 1 },
    });
  });

  it('replaces a selection and normalises pasted text', () => {
    expect(typeText(linear, { start: 2, end: 6 }, ' 1 ac\ngt 11 ')).toEqual({
      op: { type: 'replace', range: { start: 2, end: 6 }, text: 'acgt' },
      selectionAfter: { start: 6, end: 6 },
    });
    // replacing the wrapped tail of a circular sequence wraps the caret
    expect(typeText(circular, { start: 8, end: 12 }, 'AAAAAA')?.selectionAfter).toEqual({
      start: 2,
      end: 2,
    });
  });

  it('rejects non-nucleotide text and ignores empty input', () => {
    expect(() => typeText(linear, { start: 0, end: 0 }, 'hello')).toThrow(InvalidSequenceError);
    expect(typeText(linear, { start: 0, end: 0 }, '  \n')).toBeNull();
    expect(typeText(linear, null, 'A')).toBeNull();
  });
});

describe('pasteFragment', () => {
  const fragment = {
    sequence: 'GGGGGG',
    features: [createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(1, 5)] })],
  };

  it('builds an insertFragment op with fresh feature ids and a caret after the paste', () => {
    const plan = pasteFragment(linear, { start: 3, end: 3 }, fragment);
    expect(plan?.op.type).toBe('insertFragment');
    if (plan?.op.type !== 'insertFragment') throw new Error('unexpected op');
    expect(plan.op.range).toEqual({ start: 3, end: 3 });
    expect(plan.op.fragment.sequence).toBe('GGGGGG');
    expect(plan.op.fragment.features[0]?.id).not.toBe('f');
    expect(plan.op.fragment.features[0]?.segments).toEqual([rangeSegment(1, 5)]);
    expect(plan.selectionAfter).toEqual({ start: 9, end: 9 });
    const again = pasteFragment(linear, { start: 3, end: 3 }, fragment);
    expect(again?.op.type === 'insertFragment' && again.op.fragment.features[0]?.id).not.toBe(
      plan.op.fragment.features[0]?.id,
    );
  });

  it('replaces a selection and puts the caret after the paste, wrapping on circles', () => {
    expect(pasteFragment(linear, { start: 2, end: 6 }, fragment)?.selectionAfter).toEqual({
      start: 8,
      end: 8,
    });
    // Removing 8,9,0,1 leaves the cut at the origin: the paste occupies 0..6.
    const plan = pasteFragment(circular, { start: 8, end: 12 }, fragment);
    expect(plan?.selectionAfter).toEqual({ start: 6, end: 6 });
    if (plan === null) throw new Error('no plan');
    expect(circular.apply(plan.op).sequence.toString()).toBe('GGGGGG' + 'GTACGT');
    // A paste filling the whole circle leaves the caret at 0, not at the length.
    const whole = pasteFragment(circular, { start: 0, end: 10 }, fragment);
    expect(whole?.selectionAfter).toEqual({ start: 0, end: 0 });
  });

  it('falls back to plain text for a fragment without features', () => {
    expect(pasteFragment(linear, { start: 2, end: 6 }, { sequence: 'GG', features: [] })).toEqual(
      typeText(linear, { start: 2, end: 6 }, 'GG'),
    );
  });

  it('rejects bad bases and needs a selection', () => {
    expect(() =>
      pasteFragment(linear, { start: 0, end: 0 }, { ...fragment, sequence: 'HELLO!' }),
    ).toThrow(InvalidSequenceError);
    expect(pasteFragment(linear, null, fragment)).toBeNull();
  });
});

describe('deleteBackward / deleteForward', () => {
  it('deletes a selection either way', () => {
    const plan = {
      op: { type: 'delete', range: { start: 2, end: 6 } },
      selectionAfter: { start: 2, end: 2 },
    };
    expect(deleteBackward(linear, { start: 2, end: 6 })).toEqual(plan);
    expect(deleteForward(linear, { start: 2, end: 6 })).toEqual(plan);
    // a selection wrapping the origin leaves the caret at the origin
    expect(deleteForward(circular, { start: 8, end: 12 })?.selectionAfter).toEqual({
      start: 0,
      end: 0,
    });
    expect(deleteForward(circular, { start: 0, end: 10 })?.selectionAfter).toEqual({
      start: 0,
      end: 0,
    });
  });

  it('deletes single bases around the caret, wrapping only on circular sequences', () => {
    expect(deleteBackward(linear, { start: 4, end: 4 })).toMatchObject({
      op: { type: 'delete', range: { start: 3, end: 4 } },
      selectionAfter: { start: 3, end: 3 },
    });
    expect(deleteBackward(linear, { start: 0, end: 0 })).toBeNull();
    expect(deleteBackward(circular, { start: 0, end: 0 })).toMatchObject({
      op: { type: 'delete', range: { start: 9, end: 10 } },
      selectionAfter: { start: 0, end: 0 },
    });
    expect(deleteForward(linear, { start: 4, end: 4 })).toMatchObject({
      op: { type: 'delete', range: { start: 4, end: 5 } },
      selectionAfter: { start: 4, end: 4 },
    });
    expect(deleteForward(linear, { start: 10, end: 10 })).toBeNull();
    expect(deleteForward(circular, { start: 10, end: 10 })?.op).toEqual({
      type: 'delete',
      range: { start: 0, end: 1 },
    });
    expect(deleteForward(linear, null)).toBeNull();
    expect(deleteBackward(SeqDocument.create({ sequence: '' }), { start: 0, end: 0 })).toBeNull();
  });
});

describe('positions and selections', () => {
  it('clamps on linear and wraps on circular sequences', () => {
    expect(clampPosition(linear, -3)).toBe(0);
    expect(clampPosition(linear, 14)).toBe(10);
    expect(clampPosition(circular, -3)).toBe(7);
    expect(clampPosition(circular, 14)).toBe(4);
    expect(clampPosition(SeqDocument.create({ sequence: '' }), 5)).toBe(0);
  });

  it('orders anchor and focus', () => {
    expect(selectionBetween(5, 2)).toEqual({ start: 2, end: 5 });
    expect(selectionBetween(2, 5)).toEqual({ start: 2, end: 5 });
  });

  it('follows the selection through reverse complement, set origin and topology changes', () => {
    expect(selectionAfterOp(linear, { start: 2, end: 5 }, { type: 'reverseComplement' })).toEqual({
      start: 5,
      end: 8,
    });
    expect(
      selectionAfterOp(circular, { start: 8, end: 12 }, { type: 'reverseComplement' }),
    ).toEqual({ start: 8, end: 12 });
    expect(
      selectionAfterOp(circular, { start: 8, end: 12 }, { type: 'setOrigin', position: 8 }),
    ).toEqual({ start: 0, end: 4 });
    expect(
      selectionAfterOp(
        circular,
        { start: 8, end: 12 },
        { type: 'setTopology', topology: 'linear' },
      ),
    ).toBeNull();
    expect(
      selectionAfterOp(circular, { start: 2, end: 4 }, { type: 'setTopology', topology: 'linear' }),
    ).toEqual({ start: 2, end: 4 });
    expect(selectionAfterOp(linear, { start: 2, end: 4 }, { type: 'rename', name: 'x' })).toEqual({
      start: 2,
      end: 4,
    });
    expect(selectionAfterOp(linear, null, { type: 'reverseComplement' })).toBeNull();
  });

  it('follows the selection through the window a sticky flip moves', () => {
    // EcoRI at the left, PstI at the right: eight of the eighteen bases are
    // single-stranded and leave the molecule when it is turned over.
    const cut = SeqDocument.create({
      sequence: 'AATTGACCTAGGCATGCA',
      ends: {
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' },
      },
    });
    expect(cut.reverseComplement().length).toBe(10);
    // GAC, the first three bases of the double-stranded middle, come out as
    // the last three of the ten that are left.
    expect(selectionAfterOp(cut, { start: 4, end: 7 }, { type: 'reverseComplement' })).toEqual({
      start: 7,
      end: 10,
    });
    // A selection on the overhang has nothing left to be on.
    expect(selectionAfterOp(cut, { start: 0, end: 4 }, { type: 'reverseComplement' })).toEqual({
      start: 10,
      end: 10,
    });
    // One that reaches into the middle keeps the part that survives.
    expect(selectionAfterOp(cut, { start: 0, end: 7 }, { type: 'reverseComplement' })).toEqual({
      start: 7,
      end: 10,
    });
  });
});

describe('undo runs', () => {
  it('chains one-base typing and leaves longer text alone', () => {
    const first = typeText(linear, { start: 3, end: 3 }, 'G');
    const second = typeText(linear.insert(3, 'G'), { start: 4, end: 4 }, 'G');
    // The key the first change offers is the one the second asks to follow.
    expect(first?.coalesce?.key).toBe(second?.coalesce?.follows);
    expect(second?.coalesce?.key).not.toBe(second?.coalesce?.follows);
    expect(first?.coalesce?.relabel?.(4)).toBe('Insert 4 bases');
    // Typing somewhere else does not continue the run.
    expect(typeText(linear, { start: 8, end: 8 }, 'G')?.coalesce?.follows).not.toBe(
      first?.coalesce?.key,
    );
    // A paste is one step of its own.
    expect(typeText(linear, { start: 3, end: 3 }, 'GG')?.coalesce).toBeUndefined();
    expect(typeText(linear, { start: 2, end: 6 }, 'G')?.coalesce).toBeUndefined();
  });

  it('carries a typing run across the origin of a circular sequence', () => {
    // Typing at the last position leaves the caret at the end, which is the
    // origin again once the base is in.
    const atEnd = typeText(circular, { start: 9, end: 9 }, 'G');
    expect(atEnd?.selectionAfter).toEqual({ start: 10, end: 10 });
    const next = typeText(circular.insert(9, 'G'), { start: 10, end: 10 }, 'G');
    expect(next?.coalesce?.follows).toBe(atEnd?.coalesce?.key);
  });

  it('chains Backspace leftwards and Delete in place', () => {
    const back = deleteBackward(linear, { start: 4, end: 4 });
    const backAgain = deleteBackward(linear.delete({ start: 3, end: 4 }), { start: 3, end: 3 });
    expect(backAgain?.coalesce?.follows).toBe(back?.coalesce?.key);
    expect(back?.coalesce?.relabel?.(3)).toBe('Delete 3 bases');

    const forward = deleteForward(linear, { start: 4, end: 4 });
    const forwardAgain = deleteForward(linear.delete({ start: 4, end: 5 }), { start: 4, end: 4 });
    expect(forwardAgain?.coalesce?.follows).toBe(forward?.coalesce?.key);

    // The two directions are separate runs, and neither joins a typing run.
    expect(back?.coalesce?.key).not.toBe(forward?.coalesce?.key);
    expect(deleteBackward(linear, { start: 2, end: 6 })?.coalesce).toBeUndefined();
    expect(typeText(linear, { start: 3, end: 3 }, 'G')?.coalesce?.key).not.toBe(
      back?.coalesce?.key,
    );
  });
});
