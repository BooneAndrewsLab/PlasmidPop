import { SeqDocument, translateSixFrames } from '@/core';

import { rangeBounds, sixFrameFasta, sixFrameFileName } from './sixFrameExport';

describe('rangeBounds', () => {
  it('counts from 1 and includes the last base', () => {
    // [0, 9) is bases 1 to 9; [3, 4) is the one base 4.
    expect(rangeBounds({ start: 0, end: 9 }, 20)).toEqual({ from: 1, to: 9 });
    expect(rangeBounds({ start: 3, end: 4 }, 20)).toEqual({ from: 4, to: 4 });
  });

  it('ends on the last base, not on 0, for a range that runs to the end', () => {
    expect(rangeBounds({ start: 14, end: 20 }, 20)).toEqual({ from: 15, to: 20 });
  });

  it('folds the end of a range across the origin back onto the sequence', () => {
    // [17, 23) on 20 bases: 18, 19, 20, 1, 2, 3.
    expect(rangeBounds({ start: 17, end: 23 }, 20)).toEqual({ from: 18, to: 3 });
    // One base past the origin ends on base 1.
    expect(rangeBounds({ start: 17, end: 21 }, 20)).toEqual({ from: 18, to: 1 });
    // A whole turn from base 6 ends on base 5.
    expect(rangeBounds({ start: 5, end: 25 }, 20)).toEqual({ from: 6, to: 5 });
  });
});

describe('six-frame export of a range across the origin', () => {
  const doc = SeqDocument.create({
    name: 'pWrap',
    sequence: 'ATGGCCAAATTTGGGCCCTAA',
    topology: 'circular',
  });
  const wrapping = { start: 18, end: 27 };

  it('names the file by the folded end', () => {
    expect(sixFrameFileName(doc, wrapping)).toBe('pWrap_19-6_6frames.fasta');
  });

  it('writes the folded end in each header', () => {
    const fasta = sixFrameFasta(doc, wrapping, translateSixFrames('TAAATGGCC'));
    expect(fasta).toContain('>pWrap_19-6_frame+1 pWrap 19..6 frame +1, 3 aa\n');
  });
});
