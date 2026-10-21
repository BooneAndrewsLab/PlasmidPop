import {
  InvalidSequenceError,
  SeqDocument,
  createFeature,
  createMetadata,
  rangeSegment,
} from '@/core';

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
    expect(typeText(circular, { start: 0, end: 0 }, 'G')).toMatchObject({
      op: { type: 'insert', position: 0, text: 'G' },
      selectionAfter: { start: 1, end: 1 },
    });
  });

  it('appends at a caret after the last base of a circle, and carries on there (#265)', () => {
    const plan = typeText(circular, { start: 10, end: 10 }, 'G');
    expect(plan).toMatchObject({
      op: { type: 'insert', position: 10, text: 'G' },
      selectionAfter: { start: 11, end: 11 },
    });
    if (plan === null) throw new Error('no plan');
    expect(circular.apply(plan.op).sequence.toString()).toBe('ACGTACGTACG');
  });

  it('types base after base into an empty circle in order (#265)', () => {
    for (const topology of ['linear', 'circular'] as const) {
      let doc = SeqDocument.create({ sequence: '', topology });
      let selection = { start: 0, end: 0 };
      for (const base of 'actg') {
        const plan = typeText(doc, selection, base);
        if (plan === null) throw new Error('no plan');
        doc = doc.apply(plan.op);
        selection = plan.selectionAfter;
      }
      expect(doc.sequence.toString()).toBe('actg');
      expect(selection).toEqual({ start: 4, end: 4 });
    }
  });

  it('types into the middle of a circle at the caret', () => {
    const plan = typeText(circular, { start: 4, end: 4 }, 'ggg');
    expect(plan?.selectionAfter).toEqual({ start: 7, end: 7 });
    if (plan === null) throw new Error('no plan');
    expect(circular.apply(plan.op).sequence.toString()).toBe('ACGTgggACGTAC');
  });

  it('replaces a selection and normalises pasted text', () => {
    expect(typeText(linear, { start: 2, end: 6 }, ' 1 ac\ngt 11 ')).toEqual({
      op: { type: 'replace', range: { start: 2, end: 6 }, text: 'acgt' },
      selectionAfter: { start: 6, end: 6 },
    });
    // Replacing a selection that wraps the origin: the first four bases
    // overwrite 8,9,0,1 and the last two go in after them, so the caret
    // lands after old base 1, past all six.
    const wrapped = typeText(circular, { start: 8, end: 12 }, 'gggggg');
    expect(wrapped?.selectionAfter).toEqual({ start: 4, end: 4 });
    if (wrapped === null) throw new Error('no plan');
    expect(circular.apply(wrapped.op).sequence.toString()).toBe('ggggGTACGTgg');
  });

  it('replaces a selection running to the end of a circle there, not at the front (#265)', () => {
    // Longer: the extra bases follow at the end.
    const longer = typeText(circular, { start: 8, end: 10 }, 'gggg');
    expect(longer?.selectionAfter).toEqual({ start: 12, end: 12 });
    if (longer === null) throw new Error('no plan');
    expect(circular.apply(longer.op).sequence.toString()).toBe('ACGTACGTgggg');
    // Shorter: the caret stays after what was typed, at the end.
    const shorter = typeText(circular, { start: 8, end: 10 }, 'g');
    expect(shorter?.selectionAfter).toEqual({ start: 9, end: 9 });
    if (shorter === null) throw new Error('no plan');
    expect(circular.apply(shorter.op).sequence.toString()).toBe('ACGTACGTg');
    // Shorter, wrapping, the typed bases reaching the end: the rest comes off the front.
    const front = typeText(circular, { start: 8, end: 13 }, 'gg');
    expect(front?.selectionAfter).toEqual({ start: 7, end: 7 });
    if (front === null) throw new Error('no plan');
    expect(circular.apply(front.op).sequence.toString()).toBe('TACGTgg');
    // Shorter, wrapping, the deletion carrying on past the origin.
    const past = typeText(circular, { start: 8, end: 12 }, 'g');
    expect(past?.selectionAfter).toEqual({ start: 7, end: 7 });
    if (past === null) throw new Error('no plan');
    expect(circular.apply(past.op).sequence.toString()).toBe('GTACGTg');
  });

  it('rejects non-nucleotide text and ignores empty input', () => {
    expect(() => typeText(linear, { start: 0, end: 0 }, 'hello')).toThrow(InvalidSequenceError);
    expect(typeText(linear, { start: 0, end: 0 }, '  \n')).toBeNull();
    expect(typeText(linear, null, 'A')).toBeNull();
  });
});

describe('typeText in an RNA document (#113)', () => {
  const rna = SeqDocument.create({
    sequence: 'ACGTACGTAC',
    metadata: createMetadata({ moleculeType: 'RNA' }),
  });

  it('stores a typed or pasted U as T', () => {
    expect(typeText(rna, { start: 3, end: 3 }, 'GuU')).toMatchObject({
      op: { type: 'insert', position: 3, text: 'GtT' },
    });
    expect(typeText(rna, { start: 1, end: 3 }, 'U')).toMatchObject({
      op: { type: 'replace', text: 'T' },
    });
  });

  it('leaves a DNA document as it was: U is kept as typed', () => {
    expect(typeText(linear, { start: 3, end: 3 }, 'U')).toMatchObject({
      op: { type: 'insert', text: 'U' },
    });
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

  it('replaces a selection and puts the caret after the paste, on circles too', () => {
    expect(pasteFragment(linear, { start: 2, end: 6 }, fragment)?.selectionAfter).toEqual({
      start: 8,
      end: 8,
    });
    // Removing 8,9,0,1 leaves the cut at the origin, which is the end of
    // what is left: the paste goes in after old base 7.
    const plan = pasteFragment(circular, { start: 8, end: 12 }, fragment);
    expect(plan?.selectionAfter).toEqual({ start: 12, end: 12 });
    if (plan === null) throw new Error('no plan');
    expect(circular.apply(plan.op).sequence.toString()).toBe('GTACGT' + 'GGGGGG');
    // A paste filling the whole circle leaves the caret after it.
    const whole = pasteFragment(circular, { start: 0, end: 10 }, fragment);
    expect(whole?.selectionAfter).toEqual({ start: 6, end: 6 });
  });

  it('pastes at a caret after the last base of a circle by appending (#265)', () => {
    const plan = pasteFragment(circular, { start: 10, end: 10 }, fragment);
    expect(plan?.selectionAfter).toEqual({ start: 16, end: 16 });
    if (plan === null) throw new Error('no plan');
    const next = circular.apply(plan.op);
    expect(next.sequence.toString()).toBe('ACGTACGTAC' + 'GGGGGG');
    expect(next.features.all().map((f) => f.segments)).toEqual([[rangeSegment(11, 15)]]);
    // And into the middle, and into an empty circle.
    expect(pasteFragment(circular, { start: 4, end: 4 }, fragment)?.selectionAfter).toEqual({
      start: 10,
      end: 10,
    });
    const empty = SeqDocument.create({ sequence: '', topology: 'circular' });
    const first = pasteFragment(empty, { start: 0, end: 0 }, fragment);
    expect(first?.selectionAfter).toEqual({ start: 6, end: 6 });
    if (first === null) throw new Error('no plan');
    expect(empty.apply(first.op).sequence.toString()).toBe('GGGGGG');
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
    // A selection wrapping the origin leaves the caret where it was cut,
    // which is the end of what is left.
    expect(deleteForward(circular, { start: 8, end: 12 })?.selectionAfter).toEqual({
      start: 6,
      end: 6,
    });
    // One running to the end of a circle leaves the caret at the end, not at 0 (#265).
    expect(deleteBackward(circular, { start: 7, end: 10 })?.selectionAfter).toEqual({
      start: 7,
      end: 7,
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
    // At the end of a circle (#265): Backspace eats the last base and the
    // caret stays at the end; Delete eats the first, the base after it on the
    // circle, and the caret is still the end.
    expect(deleteBackward(circular, { start: 10, end: 10 })).toMatchObject({
      op: { type: 'delete', range: { start: 9, end: 10 } },
      selectionAfter: { start: 9, end: 9 },
    });
    expect(deleteForward(circular, { start: 10, end: 10 })).toMatchObject({
      op: { type: 'delete', range: { start: 0, end: 1 } },
      selectionAfter: { start: 9, end: 9 },
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
  });

  it('lets the caret reach the end of a circle, and steps from either end to the other (#265)', () => {
    expect(clampPosition(circular, 10)).toBe(10);
    expect(clampPosition(circular, 0)).toBe(0);
    expect(clampPosition(circular, 11)).toBe(0);
    expect(clampPosition(circular, -1)).toBe(10);
    expect(clampPosition(circular, 12)).toBe(2);
    expect(clampPosition(circular, -2)).toBe(8);
    expect(clampPosition(SeqDocument.create({ sequence: '' }), 5)).toBe(0);
  });

  it('stops a Shift+arrow at the ends of a circle', () => {
    expect(clampPosition(circular, 11, true)).toBe(10);
    expect(clampPosition(circular, -1, true)).toBe(0);
    expect(clampPosition(circular, 4, true)).toBe(4);
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
