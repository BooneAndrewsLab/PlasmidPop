import { randomDna, randomInt, seededRandom } from '@/test/random';

import { Rope } from './rope';

describe('Rope', () => {
  it('round-trips strings of various sizes', () => {
    for (const len of [0, 1, 100, 1023, 1024, 1025, 5000, 70000]) {
      const text = 'ACGT'.repeat(Math.ceil(len / 4)).slice(0, len);
      const rope = Rope.from(text);
      expect(rope.length).toBe(len);
      expect(rope.toString()).toBe(text);
    }
  });

  it('slices and indexes like a string', () => {
    const rand = seededRandom(1);
    const text = randomDna(rand, 20000);
    const rope = Rope.from(text);
    for (let i = 0; i < 500; i++) {
      const a = randomInt(rand, 0, text.length + 1);
      const b = randomInt(rand, a, text.length + 1);
      expect(rope.slice(a, b)).toBe(text.slice(a, b));
      expect(rope.charAt(a)).toBe(text.charAt(a));
    }
    expect(rope.slice(5)).toBe(text.slice(5));
    expect(rope.charAt(-1)).toBe('');
    expect(rope.charAt(text.length)).toBe('');
  });

  it('matches a string reference under random inserts and removes', () => {
    const rand = seededRandom(42);
    let text = randomDna(rand, 3000);
    let rope = Rope.from(text);
    const versions: { text: string; rope: Rope }[] = [];
    for (let step = 0; step < 600; step++) {
      if (rand() < 0.55) {
        const pos = randomInt(rand, 0, text.length + 1);
        const ins = randomDna(rand, randomInt(rand, 1, 300));
        text = text.slice(0, pos) + ins + text.slice(pos);
        rope = rope.insert(pos, ins);
      } else {
        const a = randomInt(rand, 0, text.length + 1);
        const b = randomInt(rand, a, Math.min(text.length, a + 400) + 1);
        text = text.slice(0, a) + text.slice(b);
        rope = rope.remove(a, b);
      }
      expect(rope.length).toBe(text.length);
      if (step % 50 === 0) versions.push({ text, rope });
    }
    expect(rope.toString()).toBe(text);
    // Old versions are untouched (persistence).
    for (const v of versions) expect(v.rope.toString()).toBe(v.text);
  });

  it('stays shallow under many small edits', () => {
    let rope = Rope.from('A');
    for (let i = 0; i < 5000; i++) rope = rope.insert(rope.length, 'C');
    expect(rope.length).toBe(5001);
    expect(rope.depth).toBeLessThan(40);

    let middle = Rope.from(randomDna(seededRandom(7), 100000));
    const rand = seededRandom(9);
    for (let i = 0; i < 3000; i++)
      middle = middle.insert(randomInt(rand, 0, middle.length + 1), 'G');
    expect(middle.depth).toBeLessThan(40);
  });

  it('rejects out-of-bounds edits and keeps identity for no-ops', () => {
    const rope = Rope.from('ACGT');
    expect(() => rope.insert(5, 'A')).toThrow(RangeError);
    expect(() => rope.remove(2, 5)).toThrow(RangeError);
    expect(() => rope.remove(3, 2)).toThrow(RangeError);
    expect(rope.insert(2, '')).toBe(rope);
    expect(rope.remove(2, 2)).toBe(rope);
  });
});
