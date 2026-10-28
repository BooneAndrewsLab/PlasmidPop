import { describe, expect, it } from 'vitest';

import { getEnzyme } from '../analysis/restriction';
import { DEFAULT_END_FLANK, END_FLANK, endFlank } from './endFlanks';

describe('end flanks', () => {
  it('holds small whole numbers, mostly for enzymes of the bundled table', () => {
    const known = Object.keys(END_FLANK).filter((name) => getEnzyme(name) !== undefined);
    expect(known.length).toBeGreaterThanOrEqual(25);
    for (const flank of Object.values(END_FLANK)) {
      expect(Number.isInteger(flank)).toBe(true);
      expect(flank).toBeGreaterThanOrEqual(0);
      expect(flank).toBeLessThanOrEqual(8);
    }
  });

  it('gives the chart value, or the default for an enzyme the chart does not list', () => {
    expect(endFlank('NotI')).toBe(8);
    expect(endFlank('NdeI')).toBe(7);
    expect(endFlank('EcoRI')).toBe(1);
    expect(endFlank('BsaI')).toBe(DEFAULT_END_FLANK);
    expect(DEFAULT_END_FLANK).toBe(6);
  });
});
