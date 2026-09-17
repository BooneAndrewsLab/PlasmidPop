/** Small seeded PRNG (mulberry32) so randomized tests are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rand: () => number, min: number, maxExclusive: number): number {
  return min + Math.floor(rand() * (maxExclusive - min));
}

export function randomDna(rand: () => number, length: number): string {
  const bases = 'ACGT';
  let out = '';
  for (let i = 0; i < length; i++) out += bases.charAt(randomInt(rand, 0, 4));
  return out;
}
