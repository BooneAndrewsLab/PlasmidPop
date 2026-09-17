import { createFeature, rangeSegment, siteSegment } from '@/core';

import { assignLanes, lanesPerRow } from './lanes';

const f = (id: string, start: number, end: number) =>
  createFeature({ id, type: 'misc', segments: [rangeSegment(start, end)] });

describe('assignLanes', () => {
  it('puts non-overlapping features in one lane and stacks overlapping ones', () => {
    const lanes = assignLanes([f('a', 0, 10), f('b', 10, 20), f('c', 5, 15)], 100);
    expect(lanes.laneCount).toBe(2);
    expect(lanes.laneOf.get('a')).toBe(0);
    expect(lanes.laneOf.get('b')).toBe(0);
    expect(lanes.laneOf.get('c')).toBe(1);
  });

  it('gives the longest feature the bottom lane', () => {
    const lanes = assignLanes([f('small', 40, 45), f('big', 0, 100)], 100);
    expect(lanes.laneOf.get('big')).toBe(0);
    expect(lanes.laneOf.get('small')).toBe(1);
  });

  it('treats wrapped features as two pieces', () => {
    const wrapped = f('w', 90, 110); // covers 90..100 and 0..10
    const lanes = assignLanes([wrapped, f('x', 0, 5), f('y', 50, 60)], 100);
    expect(lanes.laneOf.get('w')).toBe(0);
    expect(lanes.laneOf.get('x')).toBe(1);
    expect(lanes.laneOf.get('y')).toBe(0);
  });

  it('places sites in a lane like a two-base feature', () => {
    const site = createFeature({ id: 's', type: 'misc', segments: [siteSegment(50)] });
    const lanes = assignLanes([site, f('a', 49, 51)], 100);
    expect(lanes.laneCount).toBe(2);
  });

  it('handles the empty set', () => {
    expect(assignLanes([], 100).laneCount).toBe(0);
  });
});

describe('lanesPerRow', () => {
  it('counts the lanes each row must draw', () => {
    const features = [f('a', 0, 25), f('b', 5, 12), f('w', 90, 110)];
    const lanes = assignLanes(features, 100);
    const rows = lanesPerRow(features, lanes, 100, 10);
    // a (longest) -> lane 0; w's tail piece overlaps a -> lane 1; b overlaps both -> lane 2.
    // rows of 10 bases: a spans rows 0-2, b rows 0-1, w rows 9 and 0.
    expect(lanes.laneOf.get('w')).toBe(1);
    expect(lanes.laneOf.get('b')).toBe(2);
    expect(rows).toEqual([3, 3, 1, 0, 0, 0, 0, 0, 0, 2]);
  });

  it('always yields at least one row', () => {
    expect(lanesPerRow([], assignLanes([], 0), 0, 10)).toEqual([0]);
  });
});
