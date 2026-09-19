import { newId } from './ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('returns a version 4 uuid', () => {
    expect(newId()).toMatch(UUID);
  });

  it('returns a different id every time', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });

  it('still works where randomUUID is missing, as on a plain http origin', () => {
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { getRandomValues: (a: Uint8Array<ArrayBuffer>) => real.getRandomValues(a) },
      });
      const ids = new Set(Array.from({ length: 200 }, () => newId()));
      expect(ids.size).toBe(200);
      for (const id of ids) expect(id).toMatch(UUID);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
    }
  });

  it('falls back to Math.random with no web crypto at all', () => {
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      expect(newId()).toMatch(UUID);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
    }
  });
});
