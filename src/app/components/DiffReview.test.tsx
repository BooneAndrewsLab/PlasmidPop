// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, createFeature, diffDocuments, rangeSegment } from '@/core';
import { CircularLayout } from '@/view/circular';

import { DiffReview } from './DiffReview';

/**
 * A review of a 4 kb circle after two things were done to it: 40 bases
 * inserted at 3,000 and the feature at 2,000..2,400 removed. Returns the
 * rendered review and a way to point at its map, whose geometry is the one
 * `DiffMap` builds: 380 px square, 12 px lanes, 92 px for the labels, and one
 * lane, which the ghost shares with the live feature.
 */
function setup() {
  const before = SeqDocument.create({
    name: 'pBefore',
    sequence: 'ACGT'.repeat(1000),
    topology: 'circular',
    features: [
      createFeature({ id: 'keep', type: 'CDS', name: 'kept', segments: [rangeSegment(100, 900)] }),
      createFeature({
        id: 'gone',
        type: 'CDS',
        name: 'lost',
        segments: [rangeSegment(2000, 2400)],
      }),
    ],
  });
  const after = before.insert(3000, 'G'.repeat(40)).removeFeature('gone');
  const diff = diffDocuments(before, after);
  const view = render(
    <div className="save-review">
      <DiffReview doc={after} baseline={before} diff={diff} />
    </div>,
  );
  const canvas = view.container.querySelector('.diff-map canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no map');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 380, 380);
  const layout = new CircularLayout(after.length, 'circular', {
    width: 380,
    height: 380,
    laneCount: 1,
    ringWidth: 12,
    outerMargin: 92,
  });
  const at = (position: number, r: number) => {
    const pt = layout.pointAt(position, r);
    return { clientX: pt.x, clientY: pt.y, button: 0 };
  };
  return { view, canvas, layout, at };
}

describe('DiffReview', () => {
  const scrolled: Element[] = [];
  beforeEach(() => {
    scrolled.length = 0;
    // jsdom has no scrollIntoView; the review guards for that, and a test
    // gives it one that says what was scrolled to.
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('scrolls to the strip a clicked mark is in, and lights it for a moment', () => {
    vi.useFakeTimers();
    try {
      const { view, canvas, layout, at } = setup();
      fireEvent.pointerDown(canvas, at(3020, layout.radius));
      const strip = view.container.querySelector('.diff-strip');
      expect(strip?.classList.contains('is-flashed')).toBe(true);
      expect(scrolled).toContain(strip);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(strip?.classList.contains('is-flashed')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls to a removed feature's line when its ghost is clicked", () => {
    const { view, canvas, layout, at } = setup();
    fireEvent.pointerDown(canvas, at(2200, layout.laneRadius(0)));
    const lit = view.container.querySelector('.save-review__features li.is-flashed');
    expect(lit?.textContent).toContain('lost');
    expect(scrolled).toContain(lit);
  });

  it('does nothing for a click on the map away from any change', () => {
    const { view, canvas, layout, at } = setup();
    fireEvent.pointerDown(canvas, at(500, layout.laneRadius(0)));
    expect(view.container.querySelector('.is-flashed')).toBeNull();
    expect(scrolled).toHaveLength(0);
  });

  it("points at a removed feature's ghost on the map from its line", () => {
    const { view } = setup();
    const line = screen.getByRole('button', { name: 'lost' });
    expect(line.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(line);
    expect(line.getAttribute('aria-pressed')).toBe('true');
    expect(scrolled).toContain(view.container.querySelector('.diff-map'));
  });
});
