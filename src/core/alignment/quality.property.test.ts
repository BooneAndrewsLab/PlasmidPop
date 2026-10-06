import { trimByQuality, TRIM_CUTOFF_CHOICES } from './quality';

/**
 * trimByQuality against a brute-force search: no stretch of the read has a
 * higher sum of (cutoff - error probability) than the one it keeps, over
 * 2,000 seeded quality strings of up to 40 bases at each cutoff the app
 * offers, and the stretch it keeps is inside the read.
 */

let seed = 99;
/** A seeded uniform number in [0, 1). */
function rnd(): number {
  seed = ((Math.imul(seed, 1103515245) + 12345) >>> 0) % 2147483648;
  return seed / 2147483648;
}

describe('trimByQuality against a brute-force maximal-sum search', () => {
  it('keeps a stretch as good as the best one', () => {
    let cases = 0;
    const problems: string[] = [];
    for (let t = 0; t < 400; t++) {
      const length = Math.floor(rnd() * 40);
      const q = Array.from({ length }, () => Math.floor(rnd() * 45));
      for (const cutoff of TRIM_CUTOFF_CHOICES) {
        const score = q.map((x) => cutoff - 10 ** (-x / 10));
        let best = 0;
        for (let i = 0; i < length; i++) {
          let sum = 0;
          for (let j = i; j < length; j++) {
            sum += score[j] ?? 0;
            if (sum > best) best = sum;
          }
        }
        const got = trimByQuality(q, cutoff);
        cases++;
        const kept = score.slice(got.start, got.end).reduce((x, y) => x + y, 0);
        const inside = got.start >= 0 && got.start <= got.end && got.end <= length;
        if (!inside || Math.abs(kept - best) > 1e-9) {
          problems.push(
            `${q.join()} @${String(cutoff)}: kept ${String(got.start)}-${String(got.end)}`,
          );
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(2000);
    expect(problems).toEqual([]);
  });
});
