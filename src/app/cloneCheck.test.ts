import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  BUNDLED_ENZYME_SET,
  type CutSite,
  type DigestFragment,
  type Enzyme,
  type LineageNode,
  SeqDocument,
  cuttableSites,
  digest,
  findCutSites,
  flipFragment,
  gateway,
  getEnzyme,
  gibson,
  ligate,
  pcr,
  setActiveEnzymeSet,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import {
  FIXED_BY,
  cloneCheckFromParts,
  forgetCloneChecks,
  fusionContext,
  ligationOrientation,
  lineagePrimers,
  recallCloneCheck,
  registerCloneCheck,
  restrictionCloningContext,
} from './cloneCheck';

/**
 * What a reaction tells the clone check about its product (item 120): the
 * registry a product finds its context in, the ligation's orientation rule
 * and the two context builders, on the ligation tutorial's files.
 */

const DIR = join(__dirname, '../../docs/tutorials/files');

function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(`${name} has no record`);
  return doc;
}

function enz(name: string): Enzyme {
  const e = getEnzyme(name);
  if (e === undefined) throw new Error(`no enzyme ${name}`);
  return e;
}

function sitesOf(doc: SeqDocument, enzymes: readonly Enzyme[]): CutSite[] {
  const text = doc.sequence.toString();
  return cuttableSites(
    text,
    doc.topology,
    doc.methylation,
    findCutSites(text, doc.topology, enzymes),
    (n) => getEnzyme(n)?.site.length ?? 0,
  );
}

function cut(doc: SeqDocument, names: string[]): DigestFragment[] {
  return digest(doc, sitesOf(doc, names.map(enz)));
}

function longest(frags: DigestFragment[]): DigestFragment {
  const f = [...frags].sort((a, b) => b.sequence.length - a.sequence.length)[0];
  if (f === undefined) throw new Error('no fragments');
  return f;
}

function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

afterEach(() => {
  forgetCloneChecks();
});

const vector = tut('pLig-Vector');

describe('the registry', () => {
  it('finds a context by the product’s bases, not its object or name', () => {
    const backbone = longest(cut(vector, ['EcoRI', 'BamHI']));
    const piece = longest(cut(tut('Insert-EcoRI-BamHI'), ['EcoRI', 'BamHI']));
    const product = ligate([backbone, piece], { name: 'clone', circular: true });
    const context = def(
      cloneCheckFromParts(product, { document: vector, fragment: backbone }, [], 'Ligation', {
        open: false,
        note: 'fixed',
      }),
    );
    registerCloneCheck(product, context);
    expect(recallCloneCheck(product.rename('other'))).toBe(context);
    expect(recallCloneCheck(SeqDocument.create({ sequence: 'ACGT' }))).toBeNull();
  });
});

describe('ligationOrientation', () => {
  it('two different sticky ends fix the insert; one enzyme leaves it open', () => {
    const directional = [
      longest(cut(vector, ['EcoRI', 'BamHI'])),
      longest(cut(tut('Insert-EcoRI-BamHI'), ['EcoRI', 'BamHI'])),
    ];
    expect(ligationOrientation(directional, 0, true).open).toBe(false);
    const one = [
      longest(cut(vector, ['EcoRI'])),
      longest(cut(tut('Insert-EcoRI-EcoRI'), ['EcoRI'])),
    ];
    expect(ligationOrientation(one, 0, true)).toEqual({
      open: true,
      note: 'The insert’s ends join the vector either way round, so a colony may carry it reversed.',
    });
    // The vector itself is never the part turned over.
    expect(ligationOrientation([def(one[1]), def(one[0])], 1, true).open).toBe(true);
  });
});

describe('cloneCheckFromParts', () => {
  it('a one-enzyme ligation: the insert, the vector closed on itself, the orientation open', () => {
    const lin = longest(cut(vector, ['EcoRI']));
    const piece = longest(cut(tut('Insert-EcoRI-EcoRI'), ['EcoRI']));
    const product = ligate([lin, piece], { name: 'clone', circular: true });
    const context = def(
      cloneCheckFromParts(
        product,
        { document: vector, fragment: lin },
        [{ document: tut('Insert-EcoRI-EcoRI') }],
        'Ligation',
        ligationOrientation([lin, piece], 0, true),
      ),
    );
    expect(context.method).toBe('Ligation');
    expect(context.geometry.junctions).toHaveLength(2);
    expect(context.empty?.length).toBe(2664);
    expect(context.emptyNote).toBeNull();
    expect(context.orientation).toBe('open');
  });

  it('two enzymes: no empty vector, and says why; dephosphorylated: the same', () => {
    const backbone = longest(cut(vector, ['EcoRI', 'BamHI']));
    const piece = longest(cut(tut('Insert-EcoRI-BamHI'), ['EcoRI', 'BamHI']));
    const product = ligate([backbone, piece], { name: 'clone', circular: true });
    const two = def(
      cloneCheckFromParts(product, { document: vector, fragment: backbone }, [], 'Ligation', {
        open: false,
        note: '',
      }),
    );
    expect(two.empty).toBeNull();
    expect(two.emptyNote).toMatch(/cannot close on itself/);
    const lin = longest(cut(vector, ['EcoRI']));
    const one = ligate([lin, longest(cut(tut('Insert-EcoRI-EcoRI'), ['EcoRI']))], {
      name: 'x',
      circular: true,
    });
    const bare = def(
      cloneCheckFromParts(
        one,
        { document: vector, fragment: { ...lin, dephosphorylated: true } },
        [],
        'Ligation',
        { open: true, note: '' },
      ),
    );
    expect(bare.empty).toBeNull();
  });

  it('a PCR-made vector has no phosphates to close with', () => {
    const insert = 'ACGTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTC'.repeat(3);
    const linear = SeqDocument.create({
      name: 'amp',
      sequence: vector.sequence.toString().slice(0, 1500),
      topology: 'linear',
    });
    const product = SeqDocument.create({
      name: 'p',
      sequence: linear.sequence.toString() + insert,
      topology: 'circular',
    });
    const context = def(
      cloneCheckFromParts(product, { document: linear }, [], 'Gibson', { open: false, note: '' }),
    );
    expect(context.empty).toBeNull();
    expect(context.emptyNote).toMatch(/PCR product with no phosphates/);
  });

  it('is null when the vector is nowhere on the product', () => {
    const product = SeqDocument.create({
      name: 'p',
      sequence: 'ACGT'.repeat(300),
      topology: 'circular',
    });
    expect(
      cloneCheckFromParts(product, { document: vector }, [], 'Ligation', { open: false, note: '' }),
    ).toBeNull();
  });
});

describe('restrictionCloningContext', () => {
  const body = tut('Insert-EcoRI-EcoRI').sequence.toString().slice(20, 760);
  const amplify = (left: string, right: string): SeqDocument => {
    const template = SeqDocument.create({ name: 'gene', sequence: body });
    const r = pcr(template, [
      { name: 'F', sequence: left + body.slice(0, 22) },
      { name: 'R', sequence: right + reverseOf(body.slice(-22)) },
    ]);
    return def(r.products[0]).document;
  };
  const reverseOf = (s: string): string =>
    Array.from(s.toUpperCase())
      .reverse()
      .map((b) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[b] ?? b)
      .join('');

  it('EcoRI + BamHI: the backbone cannot close, the orientation is fixed, the primers are kept', () => {
    const amplicon = amplify('TTTTGAATTC', 'TTTTGGATCC');
    const backbone = longest(cut(vector, ['EcoRI', 'BamHI']));
    const piece = longest(cut(amplicon, ['EcoRI', 'BamHI']));
    const product = ligate([backbone, piece], { name: 'clone', circular: true });
    const primers = [
      { name: 'gene-EcoRI-F', sequence: 'TTTTGAATTC' + body.slice(0, 22) },
      { name: 'gene-BamHI-R', sequence: 'TTTTGGATCC' + reverseOf(body.slice(-22)) },
    ];
    const context = def(
      restrictionCloningContext(product, vector, amplicon, ['EcoRI', 'BamHI'], primers),
    );
    expect(context.method).toBe('cloning');
    expect(context.empty).toBeNull();
    expect(context.orientation).toBe('fixed');
    expect(context.primers).toEqual(primers);
    const length = context.geometry.insert.end - context.geometry.insert.start;
    expect(length).toBeGreaterThan(700);
    expect(length).toBeLessThanOrEqual(piece.sequence.length);
  });

  it('EcoRI both ends: the backbone closes on itself and the orientation is open', () => {
    const amplicon = amplify('TTTTGAATTC', 'TTTTGAATTC');
    const lin = longest(cut(vector, ['EcoRI']));
    const piece = longest(cut(amplicon, ['EcoRI']));
    const product = ligate([lin, flipFragment(piece)], { name: 'clone', circular: true });
    const context = def(
      restrictionCloningContext(product, vector, amplicon, ['EcoRI', 'EcoRI'], []),
    );
    expect(context.empty?.length).toBe(2664);
    expect(context.orientation).toBe('open');
  });
});

describe('the other methods’ contexts', () => {
  it('a Gibson of two inserts: the linearised vector has no empty form, three junctions, fixed by homology', () => {
    const vector = tut('GB-Vector');
    const inserts = ['GB-Insert1', 'GB-Insert2'].map(tut);
    const product = def(gibson([vector, ...inserts]).assembly).product;
    const context = def(
      cloneCheckFromParts(
        product,
        { document: vector },
        inserts.map((document) => ({ document })),
        'Gibson',
        { open: false, note: FIXED_BY.homology },
      ),
    );
    expect(context.geometry.junctions).toHaveLength(3);
    expect(context.empty).toBeNull();
    expect(context.emptyNote).toMatch(/PCR product with no phosphates/);
    expect(context.orientation).toBe('fixed');
  });

  it('a Gateway LR clone: the uncut destination is the empty vector, the att sites fix the orientation', () => {
    const dest = tut('GW-pDEST');
    const entry = def(gateway(tut('GW-Insert'), tut('GW-pDONR'), 'BP').product);
    const clone = def(gateway(entry, dest, 'LR').product);
    const context = def(
      cloneCheckFromParts(clone, { document: dest }, [{ document: entry }], 'Gateway', {
        open: false,
        note: FIXED_BY.att,
      }),
    );
    expect(context.empty).toBe(dest);
    expect(context.geometry.junctions).toHaveLength(2);
    expect(context.orientationNote).toBe(FIXED_BY.att);
  });

  it('an overlap-extension fusion: the whole molecule is the insert, a junction per join, no empty vector', () => {
    const a = SeqDocument.create({
      name: 'a',
      sequence: vector.sequence.toString().slice(100, 500),
    });
    const b = SeqDocument.create({
      name: 'b',
      sequence: vector.sequence.toString().slice(480, 900),
    });
    const c = SeqDocument.create({
      name: 'c',
      sequence: vector.sequence.toString().slice(880, 1300),
    });
    const fused = SeqDocument.create({
      name: 'fusion',
      sequence: vector.sequence.toString().slice(100, 1300),
    });
    const context = def(
      fusionContext(fused, [a, b, c], [{ name: 'F1', sequence: 'ACGTACGTACGTACGTACGT' }]),
    );
    expect(context.geometry.insert).toEqual({ start: 0, end: 1200 });
    // The joins are the middles of the 20-base overlaps: 380–400 and 780–800 along the fusion.
    expect(context.geometry.junctions).toEqual([390, 790]);
    expect(context.empty).toBeNull();
    expect(context.orientation).toBe('fixed');
    expect(context.primers).toHaveLength(1);
    expect(fusionContext(fused, [], [])).toBeNull();
  });
});

describe('lineagePrimers', () => {
  it('walks the tree for PCR and mutagenesis primers, nearest the product first, each once', () => {
    const leaf: LineageNode = {
      name: 'gene',
      checksum: null,
      topology: 'linear',
      length: 800,
      step: null,
    };
    const amplicon: LineageNode = {
      name: 'amp',
      checksum: null,
      topology: 'linear',
      length: 820,
      step: {
        op: 'pcr',
        parents: [leaf],
        forward: { name: 'F', sequence: 'ACGTACGTACGTACGTACGT' },
        reverse: { name: 'R', sequence: 'TTGCATGCATGCATGCATGC' },
        polymerase: 'proofreading',
      },
    };
    const mutant: LineageNode = {
      name: 'mut',
      checksum: null,
      topology: 'circular',
      length: 3000,
      step: {
        op: 'mutagenesis',
        parents: [amplicon],
        change: 'A1G',
        method: 'back-to-back',
        primers: ['GGGGCCCCAAAATTTTGGGG', 'CCAATTGGCCAATTGGCCAA'],
      },
    };
    expect(lineagePrimers(mutant).map((p) => p.name)).toEqual(['mut fwd', 'mut rev', 'F', 'R']);
    expect(lineagePrimers(null)).toEqual([]);
  });
});
