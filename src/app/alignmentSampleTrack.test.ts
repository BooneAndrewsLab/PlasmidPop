import { alignEitherStrand, createFeature, rangeSegment, reverseComplement } from '@/core';

import { stackAlignments } from './alignmentStack';
import { buildSampleTrack, sampleColumns } from './alignmentSampleTrack';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
const ref = { sequence: reference, offset: 0, wrap: null };

function rowOf(sequence: string) {
  const prepared = prepareReadAlignment(ref, { sequence, read: null }, null);
  if (!prepared.ok) throw new Error(prepared.message);
  const { job } = prepared;
  const result = finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' }));
  const row = stackAlignments(ref, [{ name: 's', result }]).rows[0];
  if (row === undefined) throw new Error('no row');
  return row;
}

function feature(start: number, end: number, name = 'f') {
  return createFeature({ type: 'CDS', name, segments: [rangeSegment(start, end)] });
}

describe("a sample's own features on its row", () => {
  it('numbers the columns of the sample bases', () => {
    const row = rowOf(reference.slice(10, 50));
    const { start, columns } = sampleColumns(row);
    expect(start).toBe(0);
    expect(columns.length).toBe(40);
    expect(columns[0]).toBe(10);
    expect(columns[39]).toBe(49);
  });

  it('puts a feature on the columns its bases aligned to', () => {
    const row = rowOf(reference.slice(10, 50));
    const track = buildSampleTrack(row, { features: [feature(5, 15)], circular: false }, 3);
    expect(track.items[0]?.spans).toEqual([{ start: 15, end: 25 }]);
    expect(track.items[0]?.annotation.strand).toBe('forward');
  });

  it("covers the sample's own insertion inside a feature", () => {
    const part = reference.slice(10, 50);
    const sample = `${part.slice(0, 15)}TTT${part.slice(15)}`;
    const row = rowOf(sample);
    // Sample bases 10..23 hold the three inserted ones, in columns before reference base 25.
    const track = buildSampleTrack(row, { features: [feature(10, 23)], circular: false }, 3);
    expect(track.items[0]?.spans).toEqual([{ start: 20, end: 33 }]);
  });

  it('turns the features of a sample that aligned reversed, strand and all', () => {
    const row = rowOf(reverseComplement(reference.slice(10, 50)));
    expect(row.result.strand).toBe('reverse');
    // The sample's first ten bases are the last ten of the stretch as shown.
    const track = buildSampleTrack(row, { features: [feature(0, 10)], circular: false }, 3);
    expect(track.items[0]?.spans).toEqual([{ start: 40, end: 50 }]);
    expect(track.items[0]?.annotation.strand).toBe('reverse');
  });

  it('draws only the part of a feature the sample aligned over, and leaves out one wholly outside', () => {
    const row = rowOf(reference.slice(10, 50));
    const track = buildSampleTrack(
      row,
      { features: [feature(30, 60, 'over the end'), feature(45, 60, 'past it')], circular: false },
      3,
    );
    expect(track.items.map((i) => i.annotation.name)).toEqual(['over the end']);
    expect(track.items[0]?.spans).toEqual([{ start: 40, end: 50 }]);
  });

  it("finds a circular sample's feature on both sides of its origin", () => {
    const row = rowOf(reference.slice(10, 50));
    // Written past the sample's 40 bases, as a feature over a circle's origin is.
    const track = buildSampleTrack(row, { features: [feature(35, 45)], circular: true }, 3);
    expect(track.items[0]?.spans).toEqual([
      { start: 10, end: 15 },
      { start: 45, end: 50 },
    ]);
  });

  it('packs overlapping features into lanes and counts those past the cap', () => {
    const row = rowOf(reference.slice(10, 50));
    const features = [feature(0, 20), feature(5, 25), feature(10, 30), feature(15, 35)];
    const track = buildSampleTrack(row, { features, circular: false }, 3);
    expect(track.lanes).toBe(3);
    expect(track.hidden).toBe(1);
  });
});
