import { alignEitherStrand } from '@/core';

import { stackAlignments } from './alignmentStack';
import { buildTrack, itemAt, type TrackAnnotation } from './alignmentTrack';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';

function stackOf(ref: { sequence: string; offset: number; wrap: number | null }, reads: string[]) {
  const samples = reads.map((sequence, i) => {
    const prepared = prepareReadAlignment(ref, { sequence, read: null }, null);
    if (!prepared.ok) throw new Error(prepared.message);
    const { job } = prepared;
    return {
      name: `r${i}`,
      result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
    };
  });
  return stackAlignments(ref, samples);
}

function note(start: number, end: number, extra: Partial<TrackAnnotation> = {}): TrackAnnotation {
  return {
    name: 'x',
    type: 'CDS',
    strand: 'forward',
    colour: '#000000',
    ranges: [{ start, end }],
    orf: false,
    ...extra,
  };
}

describe('annotations on the alignment columns', () => {
  const ref = { sequence: reference, offset: 0, wrap: null };

  it('puts a feature on the columns of its bases', () => {
    const stack = stackOf(ref, [reference.slice(0, 50)]);
    const track = buildTrack(stack, [note(10, 20)], 0, 8);
    expect(track.items[0]?.spans).toEqual([{ start: 10, end: 20 }]);
  });

  it("stretches a feature over another sample's insertion inside it, not one beside it", () => {
    const inserted = reference.slice(10, 40);
    const withExtra = `${inserted.slice(0, 15)}TTT${inserted.slice(15)}`;
    const stack = stackOf(ref, [withExtra]);
    // The three gap columns sit before reference base 25.
    const inside = buildTrack(stack, [note(20, 30)], 0, 8).items[0]?.spans[0];
    expect(inside).toEqual({ start: 20, end: 33 });
    const before = buildTrack(stack, [note(10, 25)], 0, 8).items[0]?.spans[0];
    expect(before).toEqual({ start: 10, end: 25 });
    const after = buildTrack(stack, [note(25, 30)], 0, 8).items[0]?.spans[0];
    expect(after).toEqual({ start: 28, end: 33 });
  });

  it('keeps the pieces of a join apart', () => {
    const stack = stackOf(ref, [reference.slice(0, 50)]);
    const join = note(0, 0, {
      ranges: [
        { start: 5, end: 10 },
        { start: 30, end: 40 },
      ],
    });
    expect(buildTrack(stack, [join], 0, 8).items[0]?.spans).toEqual([
      { start: 5, end: 10 },
      { start: 30, end: 40 },
    ]);
  });

  it('offsets by a selection used as the reference and drops what lies outside it', () => {
    const sel = { sequence: reference.slice(20, 50), offset: 20, wrap: null };
    const stack = stackOf(sel, [reference.slice(20, 50)]);
    const track = buildTrack(stack, [note(25, 30), note(0, 10), note(15, 25)], 0, 8);
    expect(track.items.map((i) => i.spans[0])).toEqual([
      { start: 5, end: 10 },
      { start: 0, end: 5 },
    ]);
  });

  it('places a feature across the origin of a circle, on both sides of a read through it', () => {
    const wrapRef = { sequence: reference, offset: 0, wrap: reference.length };
    const read = reference.slice(45) + reference.slice(0, 15);
    const stack = stackOf(wrapRef, [read]);
    // Written past the end as GenBank does for a feature over the origin.
    const over = note(reference.length - 6, reference.length + 4);
    const spans = buildTrack(stack, [over], reference.length, 8).items[0]?.spans ?? [];
    const covered = new Set<number>();
    for (const s of spans) for (let c = s.start; c < s.end; c++) covered.add(c);
    const bases = [...covered].map((c) => stack.reference.charAt(c)).join('');
    expect(bases.replace(/-/g, '')).toContain(reference.slice(-6) + reference.slice(0, 4));
  });

  it('packs overlapping annotations into lanes, features above ORFs, and counts what did not fit', () => {
    const stack = stackOf(ref, [reference]);
    const track = buildTrack(
      stack,
      [note(0, 30), note(10, 40), note(20, 30, { orf: true }), note(21, 40, { orf: true })],
      0,
      3,
    );
    expect(track.items.map((i) => i.lane)).toEqual([0, 1, 2]);
    expect(track.orfLane).toBe(2);
    expect(track.hidden).toBe(1);
    expect(itemAt(track, 1, 15)?.start).toBe(10);
    expect(itemAt(track, 1, 5)).toBeNull();
  });
});
