import { describe, expect, it } from 'vitest';

import { type GibsonJoin } from '@/core';

import { WEAK_TM, gibsonVerdict, yeastVerdict } from './assemblyVerdict';

/** An overlap of `length` bases of which `gc` are G (the rest A). */
const overlapOf = (length: number, gc: number): string => 'G'.repeat(gc) + 'A'.repeat(length - gc);
const joinOf = (overlap: string, tm = 60): GibsonJoin => ({ overlap, length: overlap.length, tm });

describe('gibsonVerdict', () => {
  it('marks a junction under the weak Tm and says so, with the Tm rounded', () => {
    expect(gibsonVerdict(joinOf('ACGT', WEAK_TM - 0.4))).toEqual({
      weak: true,
      detail: 'Tm 48 °C — under 48 °C, so it may not anneal',
    });
  });

  it('leaves a junction at the weak Tm alone', () => {
    expect(gibsonVerdict(joinOf('ACGT', WEAK_TM))).toEqual({ weak: false, detail: 'Tm 48 °C' });
    expect(gibsonVerdict(joinOf('ACGT', 61.6)).detail).toBe('Tm 62 °C');
  });
});

describe('yeastVerdict', () => {
  it('judges by length: 30 bp is enough, 29 is not', () => {
    expect(yeastVerdict(joinOf(overlapOf(30, 15))).weak).toBe(false);
    expect(yeastVerdict(joinOf(overlapOf(29, 15))).weak).toBe(true);
  });

  it('judges by GC: 30 to 70 per cent is fine, outside it is marked', () => {
    expect(yeastVerdict(joinOf(overlapOf(30, 9))).weak).toBe(false); // 30 %
    expect(yeastVerdict(joinOf(overlapOf(30, 8))).weak).toBe(true); // 26.7 %
    expect(yeastVerdict(joinOf(overlapOf(30, 21))).weak).toBe(false); // 70 %
    expect(yeastVerdict(joinOf(overlapOf(30, 22))).weak).toBe(true); // 73.3 %
  });

  it('gives the GC rounded, never the Tm', () => {
    expect(yeastVerdict(joinOf(overlapOf(30, 15), 12))).toEqual({ weak: false, detail: '50% GC' });
  });
});
