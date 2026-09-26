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
    for (const sequence of ['ACGTN', 'NACGT', 'ACGNT', 'acgt', 'ACGU']) {
      expect(() => parseLibraryFile(file({ ...GOOD, sequence }), 'core'), sequence).toThrow(
        'Feature library (core): part 0 is malformed',
      );
    }
  });

  it('takes a part looked for in the translation, and refuses one that is nothing (#93)', () => {
    const tag = parseLibraryFile(file({ ...GOOD, sequence: '', protein: 'HHHHHH' }), 'core');
    expect(tag[0]).toMatchObject({ sequence: '', protein: 'HHHHHH' });
    // Both is allowed: a part may be looked for by its bases and its protein.
    expect(parseLibraryFile(file({ ...GOOD, protein: 'MKV' }), 'core')[0]?.protein).toBe('MKV');
    expect(() => parseLibraryFile(file({ ...GOOD, sequence: '' }), 'core')).toThrow(
      'part 0 has neither bases nor a protein',
    );
    for (const protein of ['', 'mkv', 'MK V', 'MK1']) {
      expect(() => parseLibraryFile(file({ ...GOOD, sequence: '', protein }), 'core')).toThrow(
        /part 0 has (neither bases nor a protein|a malformed protein)/,
      );
    }
  });
});

describe('the bundled library, as loaded', () => {
  it('carries notes, and FPbase pages on the fluorescent proteins alone', async () => {
    const lib = await loadFeatureLibrary();
    expect(lib.parts.some((p) => p.source === 'core' && p.note !== undefined)).toBe(true);
    for (const p of lib.parts) {
      // Bases, a protein, or both; a part with neither would match nothing (#93).
      expect(/^[ACGT]*$/.test(p.sequence), p.name).toBe(true);
      expect(p.sequence !== '' || (p.protein ?? '') !== '', p.name).toBe(true);
      expect(p.fpbase !== undefined, p.name).toBe(p.source === 'fpbase');
    }
  });

  it('has the fluorescent proteins and the peptide tags to match in a translation (#93)', async () => {
    const lib = await loadFeatureLibrary();
    const withProtein = lib.parts.filter((p) => (p.protein ?? '') !== '');
    expect(withProtein.length).toBeGreaterThan(80);
    // Every fluorescent protein is matched by its protein, whether or not a
    // coding sequence was found for it.
    for (const p of lib.parts) {
      if (p.source === 'fpbase') expect((p.protein ?? '') !== '', p.name).toBe(true);
    }
    // The tags every vector spells its own way are among them.
    const byName = new Map(lib.parts.map((p) => [p.name, p]));
    expect(byName.get('FLAG')?.protein).toBe('DYKDDDDK');
    expect(byName.get('Myc')?.protein).toBe('EQKLISEEDL');
    expect(byName.get('SV40 NLS')).toMatchObject({ protein: 'PKKKRKV', sequence: '' });
    expect(byName.get('T7 tag')?.protein).toBe('MASMTGGQQMG');
    // A protein-only part still cites where its sequence came from.
    for (const p of lib.parts) {
      if (p.sequence === '') expect(p.accession.length, p.name).toBeGreaterThan(0);
    }
  });
});
