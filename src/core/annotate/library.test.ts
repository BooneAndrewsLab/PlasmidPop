import { describe, expect, it } from 'vitest';

import { loadFeatureLibrary, parseLibraryFile } from './library';

const GOOD = {
  name: 'lac operator',
  type: 'protein_bind',
  category: 'operator',
  sequence: 'TTGTGAGCGGATAACAA',
  accession: 'J01636.1',
  location: '1277..1293',
};

function file(...parts: unknown[]): string {
  return JSON.stringify({ source: 'test', parts });
}

describe('parseLibraryFile', () => {
  it('reads each part with the source it came from', () => {
    expect(parseLibraryFile(file(GOOD), 'core')).toEqual([{ ...GOOD, source: 'core' }]);
  });

  it('keeps a note and an FPbase page only when the part has them', () => {
    const [plain] = parseLibraryFile(file(GOOD), 'fpbase');
    expect(plain).not.toHaveProperty('note');
    expect(plain).not.toHaveProperty('fpbase');
    const page = 'https://www.fpbase.org/protein/egfp/';
    const [full] = parseLibraryFile(file({ ...GOOD, note: 'a note', fpbase: page }), 'fpbase');
    expect(full).toEqual({ ...GOOD, note: 'a note', fpbase: page, source: 'fpbase' });
    // A field of the wrong kind is taken as missing.
    const [odd] = parseLibraryFile(file({ ...GOOD, note: 3, fpbase: null }), 'core');
    expect(odd).toEqual({ ...GOOD, source: 'core' });
  });

  it('throws on a file without a list of parts', () => {
    for (const json of ['null', '[]', '"parts"', '{}', '{"parts":{}}']) {
      expect(() => parseLibraryFile(json, 'core'), json).toThrow(
        'Feature library (core): no parts',
      );
    }
  });

  it('throws on a part that is not an object, naming it', () => {
    for (const bad of [null, 'part', 7]) {
      expect(() => parseLibraryFile(file(GOOD, bad), 'fpbase')).toThrow(
        'Feature library (fpbase): part 1 is not an object',
      );
    }
  });

  it('throws on a part missing any field, or with a field that is not text', () => {
    for (const key of Object.keys(GOOD)) {
      const { [key as keyof typeof GOOD]: _gone, ...rest } = GOOD;
      expect(() => parseLibraryFile(file(GOOD, GOOD, rest), 'core'), key).toThrow(
        'Feature library (core): part 2 is malformed',
      );
      expect(() => parseLibraryFile(file({ ...GOOD, [key]: 1 }), 'core'), key).toThrow(
        'Feature library (core): part 0 is malformed',
      );
    }
  });

  it('throws on bases other than upper-case A, C, G and T, anywhere in the part', () => {
    for (const sequence of ['', 'ACGTN', 'NACGT', 'ACGNT', 'acgt', 'ACGU']) {
      expect(() => parseLibraryFile(file({ ...GOOD, sequence }), 'core'), sequence).toThrow(
        'Feature library (core): part 0 is malformed',
      );
    }
  });
});

describe('the bundled library, as loaded', () => {
  it('carries notes, and FPbase pages on the fluorescent proteins alone', async () => {
    const lib = await loadFeatureLibrary();
    expect(lib.parts.some((p) => p.source === 'core' && p.note !== undefined)).toBe(true);
    for (const p of lib.parts) {
      expect(/^[ACGT]+$/.test(p.sequence), p.name).toBe(true);
      expect(p.fpbase !== undefined, p.name).toBe(p.source === 'fpbase');
    }
  });
});
