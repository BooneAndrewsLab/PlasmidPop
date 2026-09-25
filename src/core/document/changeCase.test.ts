import { createFeature, rangeSegment } from '../features';

import { describeEditOp } from './editOp';
import { SeqDocument } from './seqDocument';

/** Upper, lower and toggled case on a selection (#90). */
describe('changeCase', () => {
  const doc = (topology: 'linear' | 'circular' = 'linear'): SeqDocument =>
    SeqDocument.create({
      sequence: 'acgtACGTnnRYacgt',
      topology,
      features: [createFeature({ id: 'g', type: 'gene', segments: [rangeSegment(2, 10)] })],
    });

  it('writes the range in capitals, in small letters, or each letter swapped', () => {
    const r = { start: 0, end: 12 };
    expect(doc().changeCase(r, 'upper').sequence.toString()).toBe('ACGTACGTNNRYacgt');
    expect(doc().changeCase(r, 'lower').sequence.toString()).toBe('acgtacgtnnryacgt');
    expect(doc().changeCase(r, 'toggle').sequence.toString()).toBe('ACGTacgtNNryacgt');
  });

  it('runs over the origin of a circle', () => {
    const d = doc('circular').changeCase({ start: 14, end: 18 }, 'upper');
    expect(d.sequence.toString()).toBe('ACgtACGTnnRYacGT');
  });

  it('moves nothing and keeps the features, styles and a read', () => {
    const read = {
      qualities: Uint8Array.from(Array.from({ length: 16 }, (_, i) => i)),
      trace: null,
    };
    const before = doc().styleBases({ start: 0, end: 4 }, { color: '#ff0000' }).setRead(read);
    const after = before.changeCase({ start: 0, end: 16 }, 'upper');
    expect(after.features.all()).toEqual(before.features.all());
    expect(after.styles).toBe(before.styles);
    expect(after.read).toBe(read);
  });

  it('is the same document when no letter changes', () => {
    const d = doc();
    expect(d.changeCase({ start: 4, end: 8 }, 'upper')).toBe(d);
  });

  it('names the History step by what it did', () => {
    const r = { start: 0, end: 1 };
    expect(describeEditOp({ type: 'changeCase', range: r, mode: 'upper' })).toBe('Uppercase');
    expect(describeEditOp({ type: 'changeCase', range: r, mode: 'lower' })).toBe('Lowercase');
    expect(describeEditOp({ type: 'changeCase', range: r, mode: 'toggle' })).toBe('Toggle case');
  });
});
