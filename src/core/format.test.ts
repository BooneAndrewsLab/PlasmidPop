import { formatInt } from './format';

describe('formatInt (#271)', () => {
  it('is toLocaleString with no arguments, made once', () => {
    for (const n of [0, 7, 999, 1000, 4361, 123456, 1_000_000, 4_641_652]) {
      expect(formatInt(n)).toBe(n.toLocaleString());
    }
  });
});
