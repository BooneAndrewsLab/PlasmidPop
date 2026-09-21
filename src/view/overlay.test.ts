import { type OverlaySpan, overlayLanes, overlayPieces, overlaysPerRow } from './overlay';

const span = (
  id: string,
  start: number,
  end: number,
  shape: OverlaySpan['shape'] = 'arrow',
): OverlaySpan => ({ id, label: id, range: { start, end }, strand: 'forward', shape });

describe('overlayPieces', () => {
  it('splits a span that runs past the origin', () => {
    expect(overlayPieces(span('w', 90, 110), 100)).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });

  it('drops an empty span', () => {
    expect(overlayPieces(span('e', 10, 10), 100)).toEqual([]);
  });
});

describe('overlayLanes', () => {
  it('stacks a pair over the product it would amplify', () => {
    // What the Primers tab previews: the amplicon and the two primers on it.
    const lanes = overlayLanes(
      [span('product', 100, 400, 'span'), span('forward', 100, 120), span('reverse', 380, 400)],
      1000,
    );
    expect(lanes.laneCount).toBe(2);
    expect(lanes.laneOf.get('product')).toBe(0);
    expect(lanes.laneOf.get('forward')).toBe(1);
    expect(lanes.laneOf.get('reverse')).toBe(1);
  });

  it('keeps spans that do not touch in one lane', () => {
    const lanes = overlayLanes([span('a', 0, 10), span('b', 20, 30)], 100);
    expect(lanes.laneCount).toBe(1);
  });

  it('has nothing to place for an empty preview', () => {
    expect(overlayLanes([], 100).laneCount).toBe(0);
  });
});

describe('overlaysPerRow', () => {
  it('counts the preview lanes each row of the sequence view must make room for', () => {
    const spans = [span('long', 0, 25, 'span'), span('short', 5, 12)];
    const lanes = overlayLanes(spans, 100);
    expect(overlaysPerRow(spans, lanes, 100, 10)).toEqual([2, 2, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('counts the row a wrapped span comes back into', () => {
    const spans = [span('w', 95, 105)];
    const lanes = overlayLanes(spans, 100);
    expect(overlaysPerRow(spans, lanes, 100, 10)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });
});
