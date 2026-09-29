import { alignEitherStrand, createFeature, rangeSegment, siteSegment } from '@/core';
import { featureColor } from '@/view/featureColors';

import { stackAlignments } from './alignmentStack';
import {
  annotationsOf,
  buildTrack,
  classifyColumns,
  ColumnClass,
  countByClass,
  differencesText,
  itemAt,
  type TrackAnnotation,
} from './alignmentTrack';
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

  it('gives a circular feature its columns on both sides of a read through the origin, in order', () => {
    const wrapRef = { sequence: reference, offset: 0, wrap: reference.length };
    const read = reference.slice(45) + reference.slice(0, 15);
    const stack = stackOf(wrapRef, [read]);
    const over = note(reference.length - 6, reference.length + 4);
    const item = buildTrack(stack, [over], reference.length, 8).items[0];
    expect(item?.spans).toEqual([
      { start: 0, end: 4 },
      { start: 54, end: 64 },
    ]);
    expect([item?.start, item?.end]).toEqual([0, 64]);
    // Without a period the range is only where it is written.
    const flat = buildTrack(stack, [over], 0, 8).items[0];
    expect(flat?.spans).toEqual([{ start: 54, end: 64 }]);
  });

  it('sorts the pieces of a join by column and spans from the first start to the last end', () => {
    const stack = stackOf(ref, [reference]);
    const join = note(0, 0, {
      ranges: [
        { start: 40, end: 45 },
        { start: 30, end: 35 },
        { start: 5, end: 10 },
      ],
    });
    const item = buildTrack(stack, [join], 0, 8).items[0];
    expect(item?.spans).toEqual([
      { start: 5, end: 10 },
      { start: 30, end: 35 },
      { start: 40, end: 45 },
    ]);
    expect([item?.start, item?.end]).toEqual([5, 45]);
  });

  it('places the first and last bases of the reference, and nothing for an empty range', () => {
    const stack = stackOf(ref, [reference]);
    expect(buildTrack(stack, [note(0, 1)], 0, 8).items[0]?.spans).toEqual([{ start: 0, end: 1 }]);
    const last = reference.length;
    expect(buildTrack(stack, [note(last - 10, last)], 0, 8).items[0]?.spans).toEqual([
      { start: last - 10, end: last },
    ]);
    expect(buildTrack(stack, [note(10, 10)], 0, 8).items).toEqual([]);
  });

  it('still places a feature at the end when the stack ends in an inserted column', () => {
    const prepared = prepareReadAlignment(ref, { sequence: `${reference}TTT`, read: null }, null);
    if (!prepared.ok) throw new Error(prepared.message);
    const { job } = prepared;
    const result = finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'global' }));
    const stack = stackAlignments(ref, [{ name: 'g', result }]);
    expect(stack.columns).toBe(reference.length + 3);
    const item = buildTrack(stack, [note(50, 60)], 0, 8).items[0];
    expect(item?.spans).toEqual([{ start: 50, end: 60 }]);
  });

  it('shares a lane between annotations that do not overlap, whatever order they come in', () => {
    const stack = stackOf(ref, [reference]);
    const apart = buildTrack(stack, [note(30, 40), note(0, 10), note(11, 20)], 0, 8);
    expect(apart.items.map((i) => i.lane)).toEqual([0, 0, 0]);
    expect(apart.lanes).toBe(1);
    // A column apart shares a lane; touching ones (one ends where the next starts) do not.
    const touching = buildTrack(stack, [note(0, 10), note(10, 20)], 0, 8);
    expect(touching.items.map((i) => i.lane)).toEqual([0, 1]);
    expect(touching.lanes).toBe(2);
  });

  it('finds the item at a column by its half-open spans, in its own lane', () => {
    const stack = stackOf(ref, [reference]);
    const join = note(0, 0, {
      ranges: [
        { start: 5, end: 10 },
        { start: 30, end: 40 },
      ],
    });
    const track = buildTrack(stack, [join], 0, 8);
    expect(itemAt(track, 0, 5)).not.toBeNull();
    expect(itemAt(track, 0, 9)).not.toBeNull();
    expect(itemAt(track, 0, 10)).toBeNull();
    expect(itemAt(track, 0, 20)).toBeNull();
    expect(itemAt(track, 0, 30)).not.toBeNull();
    expect(itemAt(track, 0, 39)).not.toBeNull();
    expect(itemAt(track, 0, 40)).toBeNull();
    expect(itemAt(track, 1, 7)).toBeNull();
  });
});

describe('turning a document into annotations', () => {
  it('takes features but not the source, and skips a feature of sites alone', () => {
    const gene = createFeature({
      type: 'gene',
      name: 'lacZ',
      strand: 'reverse',
      segments: [rangeSegment(10, 20), siteSegment(25), rangeSegment(30, 40)],
    });
    const source = createFeature({ type: 'source', segments: [rangeSegment(0, 60)] });
    const sites = createFeature({ type: 'misc_feature', segments: [siteSegment(5)] });
    const out = annotationsOf([source, gene, sites], []);
    expect(out).toEqual([
      {
        name: 'lacZ',
        type: 'gene',
        strand: 'reverse',
        colour: featureColor(gene),
        ranges: [
          { start: 10, end: 20 },
          { start: 30, end: 40 },
        ],
        orf: false,
      },
    ]);
  });

  it('names an unnamed feature by its type', () => {
    const f = createFeature({ type: 'promoter', segments: [rangeSegment(1, 5)] });
    expect(annotationsOf([f], [])[0]?.name).toBe('promoter');
  });

  it('adds ORFs after the features, named by their length', () => {
    const f = createFeature({ type: 'CDS', name: 'x', segments: [rangeSegment(1, 5)] });
    const out = annotationsOf(
      [f],
      [{ range: { start: 100, end: 4000 }, strand: 'reverse', frame: 1, codons: 1299 }],
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.orf).toBe(false);
    expect(out[1]).toEqual({
      name: `ORF ${(1299).toLocaleString()} aa`,
      type: 'ORF',
      strand: 'reverse',
      colour: '#b455a8',
      ranges: [{ start: 100, end: 4000 }],
      orf: true,
    });
  });
});

describe('classifying columns by what they fall in (#104)', () => {
  const ref = { sequence: reference, offset: 0, wrap: null };
  const other = (start: number, end: number): TrackAnnotation =>
    note(start, end, { type: 'promoter' });

  it('gives a CDS or ORF the top class, another feature the middle, the rest none', () => {
    const stack = stackOf(ref, [reference]);
    const k = classifyColumns(
      stack,
      [other(5, 25), note(15, 30), note(40, 45, { type: 'ORF', orf: true })],
      0,
    );
    expect(k[2]).toBe(ColumnClass.None);
    expect(k[10]).toBe(ColumnClass.Feature);
    expect(k[20]).toBe(ColumnClass.Cds);
    expect(k[29]).toBe(ColumnClass.Cds);
    expect(k[30]).toBe(ColumnClass.None);
    expect(k[42]).toBe(ColumnClass.Cds);
    expect(k).toHaveLength(stack.columns);
  });

  it('keeps a CDS class where a plain feature is met after it', () => {
    const stack = stackOf(ref, [reference]);
    const k = classifyColumns(stack, [note(10, 30), other(5, 25)], 0);
    expect(k[7]).toBe(ColumnClass.Feature);
    expect(k[15]).toBe(ColumnClass.Cds);
    expect(k[27]).toBe(ColumnClass.Cds);
  });

  it('is all none without annotations', () => {
    const stack = stackOf(ref, [reference]);
    expect(classifyColumns(stack, [], 0).every((c) => c === ColumnClass.None)).toBe(true);
  });

  it('gives a column inserted inside a feature its class, and not one beside it', () => {
    const inserted = reference.slice(10, 40);
    const withExtra = `${inserted.slice(0, 15)}TTT${inserted.slice(15)}`;
    const stack = stackOf(ref, [withExtra]);
    const k = classifyColumns(stack, [note(20, 30)], 0);
    expect([...k.slice(20, 33)].every((c) => c === ColumnClass.Cds)).toBe(true);
    expect(k[19]).toBe(ColumnClass.None);
    expect(k[33]).toBe(ColumnClass.None);
  });

  it('shifts by a selection used as the reference', () => {
    const sel = { sequence: reference.slice(20, 50), offset: 20, wrap: null };
    const stack = stackOf(sel, [reference.slice(20, 50)]);
    const k = classifyColumns(stack, [note(25, 30), other(0, 22)], 0);
    expect(k[0]).toBe(ColumnClass.Feature);
    expect(k[1]).toBe(ColumnClass.Feature);
    expect(k[2]).toBe(ColumnClass.None);
    expect(k[5]).toBe(ColumnClass.Cds);
    expect(k[9]).toBe(ColumnClass.Cds);
    expect(k[10]).toBe(ColumnClass.None);
  });

  it('follows a feature across the origin of a circle', () => {
    const wrapRef = { sequence: reference, offset: 0, wrap: reference.length };
    const read = reference.slice(45) + reference.slice(0, 15);
    const stack = stackOf(wrapRef, [read]);
    const over = note(reference.length - 6, reference.length + 4);
    const k = classifyColumns(stack, [over], reference.length);
    const cds = [...k].flatMap((c, i) =>
      c === ColumnClass.Cds ? [stack.reference.charAt(i)] : [],
    );
    // A read through the origin sees the feature at both ends of the reference row.
    expect(cds.join('')).toContain(reference.slice(-6));
    expect(cds.join('')).toContain(reference.slice(0, 4));
    expect(k[20]).toBe(ColumnClass.None);
  });

  it('counts differing columns per class', () => {
    const classes = Uint8Array.from([0, 1, 2, 2, 1, 0]);
    expect(countByClass([0, 2, 3, 4, 5], classes)).toEqual({ cds: 2, feature: 1, none: 2 });
    expect(countByClass([], classes)).toEqual({ cds: 0, feature: 0, none: 0 });
  });

  it('words the counts for the heading', () => {
    expect(differencesText(12, { cds: 3, feature: 5, none: 4 })).toBe(
      '12 differing columns: 3 in a CDS or ORF, 5 in other features, 4 outside features',
    );
    expect(differencesText(1, null)).toBe('1 differing column');
    expect(differencesText(0, { cds: 0, feature: 0, none: 0 })).toBe('0 differing columns');
  });
});
