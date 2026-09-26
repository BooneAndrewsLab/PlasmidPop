import { type LabelCandidate, isResidueNumbering, placeLabels, residueStep } from './residueLabels';

/** The kept candidates' x, for reading a result at a glance. */
function keptXs(candidates: readonly LabelCandidate[], gap: number): number[] {
  const kept = placeLabels(candidates, gap);
  return candidates.filter((_, i) => kept[i] === true).map((c) => c.x);
}

describe('residue numbering settings', () => {
  it('knows its three values and nothing else', () => {
    expect(['off', 'tens', 'every'].every(isResidueNumbering)).toBe(true);
    expect(isResidueNumbering('all')).toBe(false);
    expect(isResidueNumbering(10)).toBe(false);
    expect(isResidueNumbering(null)).toBe(false);
  });

  it('numbers every tenth, every one, or none', () => {
    expect(residueStep('tens')).toBe(10);
    expect(residueStep('every')).toBe(1);
    expect(residueStep('off')).toBeNull();
  });
});

describe('placeLabels', () => {
  it('keeps every label that has room', () => {
    const labels = [0, 30, 60].map((x) => ({ x, width: 10, major: false }));
    expect(placeLabels(labels, 4)).toEqual([true, true, true]);
  });

  it('keeps exactly the gap apart, and drops one closer than that', () => {
    // Extents [−5, 5] and [9, 19]: 4 apart.
    expect(
      placeLabels(
        [
          { x: 0, width: 10, major: false },
          { x: 14, width: 10, major: false },
        ],
        4,
      ),
    ).toEqual([true, true]);
    expect(
      placeLabels(
        [
          { x: 0, width: 10, major: false },
          { x: 13.9, width: 10, major: false },
        ],
        4,
      ),
    ).toEqual([true, false]);
  });

  it('places the tens first, so a crowd of ones gives way to them', () => {
    // Every 12 px, 10 px wide: only every other one fits. The major at 36
    // would be lost to a left-to-right pass that kept 24.
    const labels = [0, 12, 24, 36, 48, 60].map((x) => ({ x, width: 10, major: x === 36 }));
    expect(keptXs(labels, 4)).toEqual([0, 36, 60]);
  });

  it('fills what room is left between the tens, left to right', () => {
    const labels = [
      { x: 0, width: 10, major: true },
      { x: 10, width: 10, major: false },
      { x: 20, width: 10, major: false },
      { x: 30, width: 10, major: false },
      { x: 40, width: 10, major: true },
    ];
    // 10 is too near 0; 20 fits; 30 is too near both 20 and 40.
    expect(keptXs(labels, 2)).toEqual([0, 20, 40]);
  });

  it('never keeps two that overlap, in any order given', () => {
    let seed = 5;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 200; trial++) {
      const labels = Array.from({ length: 30 }, () => ({
        x: random() * 300,
        width: 4 + random() * 20,
        major: random() < 0.2,
      }));
      const kept = placeLabels(labels, 3);
      const extents = labels
        .filter((_, i) => kept[i] === true)
        .map((l) => [l.x - l.width / 2, l.x + l.width / 2] as const)
        .sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < extents.length; i++) {
        expect((extents[i]?.[0] ?? 0) - (extents[i - 1]?.[1] ?? 0)).toBeGreaterThanOrEqual(3);
      }
      // Nothing was dropped that had room beside what was kept.
      labels.forEach((l, i) => {
        if (kept[i] === true) return;
        const clash = labels.some(
          (o, j) => kept[j] === true && Math.abs(o.x - l.x) < (o.width + l.width) / 2 + 3,
        );
        expect(clash).toBe(true);
      });
      // A major is dropped only for another major.
      labels.forEach((l, i) => {
        if (!l.major || kept[i] === true) return;
        const byMajor = labels.some(
          (o, j) =>
            kept[j] === true && o.major && Math.abs(o.x - l.x) < (o.width + l.width) / 2 + 3,
        );
        expect(byMajor).toBe(true);
      });
    }
  });

  it('keeps nothing of nothing', () => {
    expect(placeLabels([], 4)).toEqual([]);
  });
});
