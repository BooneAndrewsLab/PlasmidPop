import { describe, expect, it, vi } from 'vitest';

import { detectFeatures } from './detect';
import { codingProtein, loadFeatureLibrary, parseLibraryFile } from './library';

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

  it('reads exact as a flag, kept only when true', () => {
    const [yes] = parseLibraryFile(file({ ...GOOD, exact: true }), 'core');
    expect(yes).toEqual({ ...GOOD, exact: true, source: 'core' });
    for (const exact of [false, undefined]) {
      const [no] = parseLibraryFile(file({ ...GOOD, exact }), 'core');
      expect(no).not.toHaveProperty('exact');
    }
    for (const exact of ['true', 1, null]) {
      expect(() => parseLibraryFile(file({ ...GOOD, exact }), 'core')).toThrow('malformed exact');
    }
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
  it('marks lacUV5 exact and the plain lac promoter not', async () => {
    const lib = await loadFeatureLibrary();
    expect(lib.parts.find((p) => p.name === 'lacUV5 promoter')?.exact).toBe(true);
    expect(lib.parts.find((p) => p.name === 'lac promoter')).not.toHaveProperty('exact');
    expect(lib.parts.find((p) => p.name === 'H1 promoter')?.location).toBe('152..366');
  });

  it('names the promoter between the CMV enhancer and the intron of CAG chicken beta-actin (#279)', async () => {
    const lib = await loadFeatureLibrary();
    const byName = (name: string): string => {
      const part = lib.parts.find((p) => p.name === name);
      expect(part, name).toBeDefined();
      return part?.sequence ?? '';
    };
    const promoter = lib.parts.find((p) => p.name === 'chicken beta-actin promoter (CAG)');
    expect(promoter?.accession).toBe('X00182.1');
    expect(promoter?.location).toBe('268..543');
    // A CAG promoter put together from its three parts reads as those three.
    const cag =
      byName('CMV enhancer') + byName('chicken beta-actin promoter (CAG)') + byName('CAG intron');
    const names = detectFeatures(cag, 'linear', lib).map((h) => lib.parts[h.part]?.name);
    expect(names).toEqual(['CMV enhancer', 'chicken beta-actin promoter (CAG)', 'CAG intron']);
    // On the native gene it lies inside the longer part, which is the one called.
    const gene = byName('chicken beta-actin promoter');
    const onGene = detectFeatures(gene, 'linear', lib).map((h) => lib.parts[h.part]?.name);
    expect(onGene).toContain('chicken beta-actin promoter');
    expect(onGene).not.toContain('chicken beta-actin promoter (CAG)');
  });

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
    // The tags every vector spells its own way are among them, each cited
    // to a protein record that carries it exactly once (#98).
    const byName = new Map(lib.parts.map((p) => [p.name, p]));
    expect(byName.get('FLAG')?.protein).toBe('DYKDDDDK');
    expect(byName.get('Myc')?.protein).toBe('EQKLISEEDL');
    expect(byName.get('SV40 NLS')).toMatchObject({ protein: 'PKKKRKV', sequence: '' });
    expect(byName.get('T7 tag')?.protein).toBe('MASMTGGQQMG');
    for (const [name, peptide] of [
      ['6xHis', 'HHHHHH'],
      ['Avi-tag', 'GLNDIFEAQKIEWHE'],
      ['Strep-tag II', 'WSHPQFEK'],
      ['HA', 'YPYDVPDYA'],
      ['V5', 'GKPIPNPLLGLDST'],
      ['S-tag', 'KETAAAKFERQHMDS'],
      ['TEV site', 'ENLYFQ'],
    ] as const) {
      const part = byName.get(name);
      expect(part?.protein, name).toBe(peptide);
      expect(part?.sequence, name).toBe('');
      // The accession is a record, not a FASTA header (#98).
      expect(part?.accession, name).toMatch(/^[A-Za-z0-9_]+\.\d+$/);
    }
    // A protein-only part still cites where its sequence came from.
    for (const p of lib.parts) {
      if (p.sequence === '') expect(p.accession.length, p.name).toBeGreaterThan(0);
    }
  });
});

describe('parseLibraryFile and codingProtein edge cases (mutation survivors)', () => {
  it('says an empty protein with no bases is nothing, not a malformed protein', () => {
    expect(() => parseLibraryFile(file({ ...GOOD, sequence: '', protein: '' }), 'core')).toThrow(
      'part 0 has neither bases nor a protein',
    );
  });

  it('keeps no protein key on a part without one', () => {
    const [plain] = parseLibraryFile(file(GOOD), 'core');
    expect(plain).not.toHaveProperty('protein');
  });

  it('reads a protein off a CDS of exactly the shortest length, and no shorter', () => {
    const codons = 'ATGAAAGGGCCCTTTAAAGGGCCC';
    // Eight codons: eight residues, the least that is a protein.
    expect(codingProtein('CDS', codons)).toBe('MKGPFKGP');
    // Seven residues and a closing stop is too short once the stop is dropped.
    expect(codingProtein('CDS', `${codons.slice(0, 21)}TAA`)).toBeUndefined();
    expect(codingProtein('CDS', `${codons}TAA`)).toBe('MKGPFKGP');
  });
});

describe('loadFeatureLibrary after a failed load', () => {
  it('tries again on the next call rather than keeping the failure', async () => {
    vi.resetModules();
    vi.doMock('./data/core-parts.json?raw', () => {
      throw new Error('offline');
    });
    try {
      const fresh = await import('./library');
      const first = fresh.loadFeatureLibrary();
      await expect(first).rejects.toThrow();
      const second = fresh.loadFeatureLibrary();
      expect(second).not.toBe(first);
      await expect(second).rejects.toThrow();
    } finally {
      vi.doUnmock('./data/core-parts.json?raw');
      vi.resetModules();
    }
  });
});
