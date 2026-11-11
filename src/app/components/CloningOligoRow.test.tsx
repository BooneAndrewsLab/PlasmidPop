// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type CloningPrimer } from '@/core';
import { analyzePrimer } from '@/core/primers/primerDesign';

import { CloningOligoRow } from './CloningOligoRow';

afterEach(cleanup);

const COVERS = { label: 'insert', tip: 'The insert bases covered' };

/** A primer whose annealing part is `annealing` (ends in C: a clamp) and whose tail is `tail`. */
const primerOf = (tail: string, annealing: string): CloningPrimer => {
  const sequence = tail + annealing;
  return {
    name: 'x-F-BsaI',
    sequence,
    segments: { padding: tail, site: '', spacer: '', annealing },
    enzyme: 'BsaI',
    tm: 61.26,
    annealing: analyzePrimer(annealing),
    paddingRaised: null,
  };
};

const renderRow = (strand: 'forward' | 'reverse', primer: CloningPrimer, covered: number) =>
  render(
    <table>
      <tbody>
        <CloningOligoRow strand={strand} primer={primer} coveredLength={covered} covers={COVERS} />
      </tbody>
    </table>,
  );

describe('CloningOligoRow', () => {
  it('tells a forward primer from the first base of what it covers', () => {
    renderRow('forward', primerOf('ggt', 'ATGAAACTGC'), 1200);
    expect(screen.getByRole('rowheader').textContent).toBe('→ Forward');
    expect(screen.getByText('insert 1–10')).toBeTruthy();
    expect(screen.getByText('13 nt')).toBeTruthy();
    expect(screen.getByText('Tm 61.3')).toBeTruthy();
    expect(screen.getByText('clamp').className).toBe('dt__ok');
  });

  it('counts a reverse primer back from the last base, in 1-based figures', () => {
    renderRow('reverse', primerOf('ggt', 'ATGAAACTGA'), 1200);
    expect(screen.getByRole('rowheader').textContent).toBe('← Reverse');
    expect(screen.getByText('insert 1,191–1,200')).toBeTruthy();
    expect(screen.getByText('no clamp').className).toBe('dt__warn');
  });

  it('gives the label and the tooltip it was given', () => {
    renderRow('forward', primerOf('', 'ATGAAACTGC'), 30);
    const cell = screen.getByText('insert 1–10');
    expect(cell.getAttribute('data-tip')).toBe('The insert bases covered');
  });
});
