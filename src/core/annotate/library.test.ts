import { describe, expect, it, vi } from 'vitest';

import { reverseComplement } from '@/core/sequence/alphabet';

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

  it('reads fragment as a flag, kept only when true (#286)', () => {
    const [yes] = parseLibraryFile(file({ ...GOOD, fragment: true }), 'core');
    expect(yes).toEqual({ ...GOOD, fragment: true, source: 'core' });
    for (const fragment of [false, undefined]) {
      const [no] = parseLibraryFile(file({ ...GOOD, fragment }), 'core');
      expect(no).not.toHaveProperty('fragment');
    }
    for (const fragment of ['true', 1, null]) {
      expect(() => parseLibraryFile(file({ ...GOOD, fragment }), 'core')).toThrow(
        'malformed fragment',
      );
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

  it('names the HIV-1 LTR parts without claiming a copy, and marks R-U5 a fragment (#286)', async () => {
    const lib = await loadFeatureLibrary();
    // K03455 annotates the 5' LTR at 1..634 and the 3' LTR at 9086..9719;
    // the two differ at 8 bases, all of them in U3, and share R and U5
    // (454..634) base for base, so neither copy's name belongs to the part.
    const ltr = lib.parts.find((p) => p.name === 'HIV-1 LTR');
    expect(ltr?.location).toBe('1..634');
    const ru5 = lib.parts.find((p) => p.name === 'HIV-1 LTR (R-U5)');
    expect(ru5?.location).toBe('454..634');
    expect(ru5?.fragment).toBe(true);
    expect(ru5?.sequence).toBe(ltr?.sequence.slice(453));
    expect(
      lib.parts.filter((p) => p.name.startsWith('HIV-1') && p.name.includes('LTR')),
    ).toHaveLength(3);
    expect(lib.parts.filter((p) => p.type === 'LTR').map((p) => p.name)).toEqual([
      'RSV LTR',
      'HIV-1 LTR',
      'HIV-1 LTR (R-U5)',
      // The ΔU3 LTR of a self-inactivating vector: its U3 is deleted, which
      // is a difference the bases carry, so it keeps the 3' of its name.
      "HIV-1 3' dLTR",
    ]);
    // R-U5 inside a whole LTR is the LTR's own end, not a second feature.
    const names = detectFeatures(ltr?.sequence ?? '', 'linear', lib).map(
      (h) => lib.parts[h.part]?.name,
    );
    expect(names).toContain('HIV-1 LTR');
    expect(names).not.toContain('HIV-1 LTR (R-U5)');
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

  it('calls lacIq only on the Iq base, and one lacI promoter part per locus (#283)', async () => {
    const lib = await loadFeatureLibrary();
    const part = (name: string) => lib.parts.find((p) => p.name === name);
    const wild = part('lacI promoter');
    const iq = part('lacIq promoter');
    const tail = part("lacI promoter (3' end)");
    expect([wild?.accession, wild?.location]).toEqual(['J01636.1', '1..78']);
    expect([iq?.accession, iq?.location]).toEqual(['U13853.1', '3240..3317']);
    expect([tail?.accession, tail?.location]).toEqual(['J01636.1', '44..78']);
    const seq = wild?.sequence ?? '';
    // The two 78 bp regions differ at position 16 alone (the -35 box, C to T),
    // and the 35 bp part is the end both share.
    const diffs = seq.split('').flatMap((b, i) => (b === iq?.sequence[i] ? [] : [i + 1]));
    expect(diffs).toEqual([16]);
    expect(seq.endsWith(tail?.sequence ?? '-')).toBe(true);
    const at16 = (base: string): string => seq.slice(0, 15) + base + seq.slice(16);
    const called = (s: string, minIdentity?: number): string[] =>
      detectFeatures(s, 'linear', lib, minIdentity === undefined ? {} : { minIdentity })
        .filter((h) => (lib.parts[h.part]?.name ?? '').startsWith('lacI'))
        .map((h) => lib.parts[h.part]?.name ?? '');
    for (const identity of [0.9, 0.95, 0.98, 1]) {
      expect(called(seq, identity), `wild type at ${identity}`).toEqual(['lacI promoter']);
      expect(called(at16('T'), identity), `Iq at ${identity}`).toEqual(['lacIq promoter']);
    }
    // Neither base at 16, or no base read there: both fit as well, and the
    // wild type is the one called. The 3' end, matched in full where the
    // region is not, stays beside it, as any part fitting better than the
    // longer one around it does (keepBest).
    expect(called(at16('N'))).toEqual(['lacI promoter', "lacI promoter (3' end)"]);
    expect(called(at16('A'))).toEqual(['lacI promoter', "lacI promoter (3' end)"]);
    // Cut off before the Iq base by a linear end, it cannot be told Iq.
    expect(called(at16('T').slice(20))).toEqual(['lacI promoter']);
    // The 3' end alone, with what lies before it changed, is the short part.
    const unrelated = 'GTTTAAACGGATCCTCTAGAGTCGACCTGCAGGCA'.slice(0, 43);
    expect(called(unrelated + (tail?.sequence ?? ''))).toEqual(["lacI promoter (3' end)"]);
  });

  it('says what names each variant part, and what the element is (#284)', async () => {
    const lib = await loadFeatureLibrary();
    const variant = (name: string) => lib.parts.find((p) => p.name === name)?.variant;
    // The one base of the -35/-10 spacer that tells trc from tac lies in
    // the part's bases 176..204 (TTGACA at 176, TATAAT at 199).
    expect(variant('trc promoter region')).toEqual({ bases: { start: 176, end: 204 } });
    const trc = lib.parts.find((p) => p.name === 'trc promoter region')?.sequence ?? '';
    expect(trc.slice(175, 181)).toBe('TTGACA');
    expect(trc.slice(198, 204)).toBe('TATAAT');
    // kanMX's first eight residues, MGKEKTHV, where the transposon's gene
    // reads MSHIQRET; no family, as `KanR (Tn903)` is the part for that.
    expect(variant('kanMX KanR')).toEqual({ protein: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(lib.parts.find((p) => p.name === 'kanMX KanR')?.protein?.slice(0, 8)).toBe('MGKEKTHV');
    expect(lib.parts.find((p) => p.name === 'KanR (Tn903)')?.protein?.slice(0, 8)).toBe('MSHIQRET');
    // The four residues an rtTA's repressor differs in (E71K, D95N, L101S,
    // G102D), and the element both TetR parts belong to.
    expect(variant('TetR (Tn10)')).toEqual({ family: 'TetR', protein: [71, 95, 101, 102] });
    const tetR = lib.parts.find((p) => p.name === 'TetR (Tn10)')?.protein ?? '';
    expect([tetR[70], tetR[94], tetR[100], tetR[101]]).toEqual(['E', 'D', 'L', 'G']);
    expect(variant('TetR (class C)')).toEqual({ family: 'TetR' });
    // luc+ and luc2 code for one protein, so only the bases can tell them
    // apart, and a hit made on the protein is a firefly luciferase.
    expect(variant('luciferase (luc+)')).toEqual({ family: 'firefly luciferase', codons: true });
    expect(lib.parts.some((p) => p.name === 'firefly luciferase')).toBe(true);
    // The fluorescent proteins ask for their whole protein.
    expect(variant('avGFP')).toEqual({ family: 'GFP', protein: 'exact' });
    expect(variant('DsRed-Express2')).toEqual({ family: 'DsRed', protein: 'exact' });
    // No part is named after a family that is itself a variant.
    for (const p of lib.parts) {
      const family = p.variant?.family;
      if (family === undefined) continue;
      expect(lib.parts.find((q) => q.name === family)?.variant).toBeUndefined();
    }
  });

  it("carries one filamentous-phage origin, under both phages' names (#284)", async () => {
    const lib = await loadFeatureLibrary();
    // f1 and M13 differ at two bases over the origin, and deposited records
    // name the same bases either way, so there is one part, not two.
    expect(
      lib.parts
        .filter((p) => p.category === 'origin' && /\bf1\b|M13/.test(p.name))
        .map((p) => p.name),
    ).toEqual(['f1/M13 ori']);
    const ori = lib.parts.find((p) => p.name === 'f1/M13 ori');
    expect([ori?.accession, ori?.location]).toEqual(['U47295.2', '4072..4527']);
    expect(ori?.sequence).toHaveLength(456);
  });

  it('reads the CaMV poly(A) signal on the strand it terminates (#287)', async () => {
    const lib = await loadFeatureLibrary();
    const part = lib.parts.find((p) => p.name === 'CaMV poly(A) signal');
    // AF234296 gives the 3' UTR no strand, but the hptII gene it ends is
    // complement(6873..7898): the part is the complement of the record's bases.
    expect([part?.accession, part?.location]).toEqual(['AF234296.1', 'complement(6649..6857)']);
    const seq = part?.sequence ?? '';
    expect(seq).toHaveLength(209);
    // The hexamer is on this strand alone.
    expect(seq.indexOf('AATAAA')).toBe(149);
    expect(reverseComplement(seq)).not.toContain('AATAAA');
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
