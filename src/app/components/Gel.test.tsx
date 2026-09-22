// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';

import { type GelBand, gelProfile } from '@/core';

import { Gel } from './Gel';

/** The sample lane's bands, top of the lane first, as drawn. */
function sampleBands(container: HTMLElement): { y: number; opacity: number }[] {
  return [...container.querySelectorAll('.gel__band:not(.gel__band--ladder)')].map((el) => ({
    y: Number(el.getAttribute('y')),
    opacity: Number(el.getAttribute('opacity')),
  }));
}

describe('Gel', () => {
  it('runs the long fragments near the well and the short ones down the lane', () => {
    // Lengths the ladder does not also carry, so a label is the lane's own.
    const { container } = render(
      <Gel lanes={[{ profile: gelProfile([4321, 1234, 321]), label: 'EcoRI' }]} />,
    );
    const bands = sampleBands(container);
    expect(bands).toHaveLength(3);
    expect(bands[0]?.y).toBeLessThan(bands[1]?.y ?? 0);
    expect(bands[1]?.y).toBeLessThan(bands[2]?.y ?? 0);
    // And each is labelled beside the lane.
    expect(screen.getByText('4,321')).toBeInTheDocument();
    expect(screen.getByText('321')).toBeInTheDocument();
  });

  it('stains a short band faintly', () => {
    const { container } = render(
      <Gel lanes={[{ profile: gelProfile([4000, 200]), label: 'EcoRI' }]} />,
    );
    const bands = sampleBands(container);
    expect(bands[0]?.opacity).toBe(1);
    expect(bands[1]?.opacity).toBeLessThan(0.5);
  });

  it('puts a ladder beside it, chosen to span the sample', () => {
    const { container, rerender } = render(
      <Gel lanes={[{ profile: gelProfile([4000, 1000]), label: 'D' }]} />,
    );
    expect(container.querySelectorAll('.gel__band--ladder').length).toBeGreaterThan(5);
    expect(screen.getByText('1 kb')).toBeInTheDocument();
    rerender(<Gel lanes={[{ profile: gelProfile([600, 300]), label: 'D' }]} />);
    expect(screen.getByText('100 bp')).toBeInTheDocument();
  });

  it('says what is under a band that hides something', () => {
    const { container } = render(
      <Gel lanes={[{ profile: gelProfile([2181, 2180, 432]), label: 'D' }]} />,
    );
    expect(screen.getByText('2,181 ×2')).toBeInTheDocument();
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent);
    expect(titles).toContain('2,181 ×2 bp: 2181 + 2180 bp');
  });

  it('pushes a crowded label clear of its neighbour and joins it back', () => {
    // 900 and 700 resolve as two bands but are only a few units apart in the
    // lane, so the second number is moved down and given a leader.
    const { container } = render(<Gel lanes={[{ profile: gelProfile([900, 700]), label: 'D' }]} />);
    expect(container.querySelectorAll('.gel__leader').length).toBeGreaterThan(0);
  });

  it('is only clickable where the caller says what a click does', () => {
    const picked: GelBand[] = [];
    const { container, rerender } = render(
      <Gel lanes={[{ profile: gelProfile([4000, 1000]), label: 'D' }]} />,
    );
    expect(container.querySelectorAll('.gel__pick')).toHaveLength(0);

    rerender(
      <Gel
        lanes={[
          {
            profile: gelProfile([4000, 1000]),
            label: 'D',
            onPick: (band) => picked.push(band),
            pickTitle: (band) => `Select ${band.length}`,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select 1000' }));
    expect(picked.map((b) => b.length)).toEqual([1000]);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Select 4000' }), { key: 'Enter' });
    expect(picked.map((b) => b.length)).toEqual([1000, 4000]);
  });

  it('sets lanes side by side, writing sizes beside the last one only', () => {
    const { container } = render(
      <Gel
        lanes={[
          { profile: gelProfile([3456, 987]), label: 'EcoRI' },
          { profile: gelProfile([2345, 2098]), label: 'BsaXI-HF' },
          { profile: gelProfile([2345, 1111, 456]), label: 'Both' },
        ]}
      />,
    );
    const lanes = [...container.querySelectorAll('.gel__lane')];
    expect(lanes).toHaveLength(3);
    // Each lane is further right than the one before it.
    const xs = lanes.map((l) => Number(l.querySelector('.gel__band')?.getAttribute('x')));
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
    expect(xs[1]).toBeLessThan(xs[2] ?? 0);
    // Only the combined lane's sizes are written; the others are on hover.
    expect(screen.getByText('1,111')).toBeInTheDocument();
    expect(screen.queryByText('3,456')).toBeNull();
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent);
    expect(titles).toContain('EcoRI: 3,456 bp: 3456 bp');
    // A name too long for a shared lane is cut short and said in full on hover.
    expect(screen.getByText('BsaXI-\u2026')).toBeInTheDocument();
    expect(titles).toContain('BsaXI-HF');
    // The gel grows rather than shrinking its text.
    const one = render(<Gel lanes={[{ profile: gelProfile([4000]), label: 'D' }]} />);
    const width = (el: Element | null) =>
      parseInt((el as SVGElement | null)?.style.maxWidth ?? '0', 10);
    expect(width(container.querySelector('svg'))).toBeGreaterThan(
      width(one.container.querySelector('svg')),
    );
  });
});
