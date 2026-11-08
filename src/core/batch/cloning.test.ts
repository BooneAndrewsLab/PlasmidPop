import { describe, expect, it } from 'vitest';

import { ggDestination, ifGene, linearVector, pUC19 } from '@/test/cloningFixtures';

import { type FidelityTable } from '../cloning/fidelity';
import { designMultiOverlapPrimers } from '../cloning/overlapAssembly';
import { homologyVectorProblem } from '../cloning/overlapPrimers';
import { opensNothing } from '../cloning/goldenGateEnds';
import { SeqDocument } from '../document';
import { range } from '../range';
import {
  type CloningBatchRecipe,
  checkCloningVector,
  insertNameClashes,
  readKit,
  rowRecipe,
} from './cloning';
import { type DesignOverrides, type DesignRow } from './rows';

function row(name: string, overrides: DesignOverrides = {}, line = 2): DesignRow {
  return {
    line,
    name,
    template: null,
    source: { kind: 'sequence', bases: 'ACGT' },
    overrides,
    notes: '',
    warnings: [],
  };
}

const RESTRICTION: CloningBatchRecipe = {
  recipe: 'restriction',
  forward: 'EcoRI',
  reverse: 'BamHI',
};
const GOLDEN: CloningBatchRecipe = { recipe: 'golden-gate', enzyme: 'BsaI' };
const HOMOLOGY: CloningBatchRecipe = { recipe: 'homology', kit: 'in-fusion' };

describe('readKit', () => {
  it.each([
    ['in-fusion', 'in-fusion'],
    ['In-Fusion', 'in-fusion'],
    ['infusion', 'in-fusion'],
    ['NEBuilder HiFi', 'nebuilder'],
    ['Yeast assembly', 'yeast'],
    ['YEAST', 'yeast'],
  ])('%s is %s', (text, kit) => {
    expect(readKit(text)).toBe(kit);
  });

  it('knows no other', () => {
    expect(readKit('Gateway')).toBeUndefined();
    expect(readKit('')).toBeUndefined();
  });
});

describe('rowRecipe: restriction', () => {
  it('keeps the batch’s pair, and the settings, for a row with no columns', () => {
    const r = rowRecipe(row('a'), RESTRICTION, { padding: 8 });
    expect(r).toEqual({ ok: true, recipe: RESTRICTION, settings: { padding: 8 }, warnings: [] });
  });

  it('reads the enzyme column as the pair, forward first, in the list’s own spelling', () => {
    for (const cell of ['xbai/sali', 'XbaI, SalI', 'XbaI + SalI', 'XbaI SalI']) {
      const r = rowRecipe(row('a', { enzyme: cell }), RESTRICTION);
      expect(r.ok && r.recipe).toMatchObject({ forward: 'XbaI', reverse: 'SalI' });
    }
  });

  it('refuses one enzyme, three, and a name that is not in the list', () => {
    expect(rowRecipe(row('a', { enzyme: 'EcoRI' }), RESTRICTION)).toEqual({
      ok: false,
      message:
        'The enzyme column needs two enzymes for a restriction pair, forward first (for example EcoRI/BamHI); “EcoRI” has 1.',
    });
    const three = rowRecipe(row('a', { enzyme: 'EcoRI/BamHI/XbaI' }), RESTRICTION);
    expect(three.ok).toBe(false);
    expect(rowRecipe(row('a', { enzyme: 'EcoRI/NoSuchI' }), RESTRICTION)).toEqual({
      ok: false,
      message: 'NoSuchI is not in the enzyme set.',
    });
  });

  it('reads left and right as the extra bases, and says what it does not use', () => {
    const r = rowRecipe(
      row('a', { left: 'GCCACC', right: 'TAA', kit: 'yeast', includeStart: true }),
      RESTRICTION,
      { extra5: 'AAA' },
    );
    expect(r).toEqual({
      ok: true,
      recipe: RESTRICTION,
      settings: { extra5: 'GCCACC', extra3: 'TAA' },
      warnings: [
        'The kit column is not used by this recipe and was ignored.',
        'The include_start column is not used by this recipe and was ignored.',
      ],
    });
  });
});

describe('rowRecipe: Golden Gate', () => {
  it('takes one enzyme, or two that share the tube', () => {
    expect(rowRecipe(row('a', { enzyme: 'bsmbi' }), GOLDEN)).toMatchObject({
      ok: true,
      recipe: { enzyme: 'BsmBI' },
    });
    const two = rowRecipe(row('a', { enzyme: 'BsaI/BbsI' }), GOLDEN);
    expect(two.ok && two.recipe).toMatchObject({ enzyme: 'BsaI', secondEnzyme: 'BbsI' });
    expect(rowRecipe(row('a', { enzyme: 'BsaI/BbsI/SapI' }), GOLDEN).ok).toBe(false);
    expect(rowRecipe(row('a', { enzyme: 'Nope' }), GOLDEN)).toEqual({
      ok: false,
      message: 'Nope is not in the enzyme set.',
    });
  });

  it('takes the overhangs and the include flags over the batch’s', () => {
    const r = rowRecipe(
      row('a', { left: 'AATG', right: 'GCTT', includeStart: false, includeStop: true }),
      { ...GOLDEN, left: 'CCCC', includeStart: true },
    );
    expect(r.ok && r.recipe).toEqual({
      recipe: 'golden-gate',
      enzyme: 'BsaI',
      left: 'AATG',
      right: 'GCTT',
      includeStart: false,
      includeStop: true,
    });
  });
});

describe('rowRecipe: homology', () => {
  it('reads the kit column, and refuses a name that is not a kit', () => {
    expect(rowRecipe(row('a', { kit: 'NEBuilder HiFi' }), HOMOLOGY)).toMatchObject({
      ok: true,
      recipe: { recipe: 'homology', kit: 'nebuilder' },
    });
    expect(rowRecipe(row('a', { kit: 'Gateway' }), HOMOLOGY)).toEqual({
      ok: false,
      message: 'The kit “Gateway” is not one of “In-Fusion”, “NEBuilder HiFi”, “Yeast assembly”.',
    });
  });

  it('drops extra bases and says which columns it ignored', () => {
    const r = rowRecipe(row('a', { enzyme: 'BsaI', left: 'AAA' }), HOMOLOGY, {
      padding: 6,
      extra5: 'GCC',
    });
    expect(r).toEqual({
      ok: true,
      recipe: HOMOLOGY,
      settings: { padding: 6 },
      warnings: [
        'The enzyme column is not used by this recipe and was ignored.',
        'The left column is not used by this recipe and was ignored.',
      ],
    });
  });
});

describe('checkCloningVector: homology', () => {
  it('refuses a circle with the designer’s own words', () => {
    const own = designMultiOverlapPrimers(
      pUC19,
      [{ template: ifGene, region: range(0, ifGene.length) }],
      'in-fusion',
    ).problem;
    const check = checkCloningVector(pUC19, HOMOLOGY);
    expect(check.problem).toBe(own);
    expect(check.problem).toBe(homologyVectorProblem(pUC19, 'in-fusion'));
    expect(check.problem).toMatch(/is circular, so it has no ends/);
  });

  it('accepts a linear vector, for each kit and a yeast overlap', () => {
    const vector = linearVector();
    expect(checkCloningVector(vector, HOMOLOGY).problem).toBeNull();
    expect(
      checkCloningVector(vector, { recipe: 'homology', kit: 'yeast', overlap: 60 }).problem,
    ).toBeNull();
  });

  it('refuses a vector shorter than the kit’s homology', () => {
    const tiny = SeqDocument.create({ name: 'tiny', sequence: 'ACGTACGTAC' });
    expect(checkCloningVector(tiny, HOMOLOGY).problem).toBe(
      'tiny is shorter than the 15 bases of homology In-Fusion asks for.',
    );
  });
});

describe('checkCloningVector: Golden Gate', () => {
  it('reads the destination’s overhang pair once', () => {
    const check = checkCloningVector(ggDestination, GOLDEN);
    expect(check.problem).toBeNull();
    expect(check.overhangs).toEqual({ left: 'GGAG', right: 'CGCT' });
  });

  it('keeps an overhang pair the batch names', () => {
    const check = checkCloningVector(ggDestination, { ...GOLDEN, left: 'aatg', right: 'GCTT' });
    expect(check.overhangs).toEqual({ left: 'AATG', right: 'GCTT' });
  });

  it('refuses an enzyme that opens nothing, with the designer’s words', () => {
    expect(
      checkCloningVector(ggDestination, { recipe: 'golden-gate', enzyme: 'BbsI' }).problem,
    ).toBe(opensNothing('BbsI', ggDestination.name));
  });

  it('refuses an enzyme that is not Type IIS, and one that is not in the list', () => {
    expect(
      checkCloningVector(ggDestination, { recipe: 'golden-gate', enzyme: 'EcoRI' }).problem,
    ).toMatch(/not Type IIS/);
    expect(
      checkCloningVector(ggDestination, { recipe: 'golden-gate', enzyme: 'NopeI' }).problem,
    ).toBe('NopeI is not in the enzyme set.');
    expect(checkCloningVector(ggDestination, { ...GOLDEN, secondEnzyme: 'NopeI' }).problem).toBe(
      'NopeI is not in the enzyme set.',
    );
  });

  it('without a fidelity table, says what overhangWarnings says of the pair', () => {
    const same = checkCloningVector(ggDestination, { ...GOLDEN, left: 'AATT', right: 'AATT' });
    expect(same.fidelity).toBeNull();
    expect(same.warnings.join(' ')).toMatch(/AATT/);
    expect(checkCloningVector(ggDestination, GOLDEN).warnings).toEqual([]);
  });

  it('with a table, scores the pair once, and says when the table does not cover it', () => {
    const pair = (a: string, b: string, n: number): [string, Map<string, number>] => [
      a,
      new Map([[b, n]]),
    ];
    const table: FidelityTable = {
      label: 'T4 test table',
      fileName: null,
      overhangLength: 4,
      counts: new Map([
        pair('GGAG', 'CTCC', 98),
        pair('CGCT', 'AGCG', 99),
        pair('CTCC', 'GGAG', 98),
        pair('AGCG', 'CGCT', 99),
      ]),
    };
    const check = checkCloningVector(ggDestination, GOLDEN, {}, table);
    expect(check.fidelity?.fidelity).toBe(1);
    expect(check.warnings).toEqual([
      "The destination's overhangs GGAG…CGCT ligate with a fidelity of 100 % (T4 test table).",
    ]);
    const unknown = checkCloningVector(
      ggDestination,
      { ...GOLDEN, left: 'AATG', right: 'GCTT' },
      {},
      table,
    );
    expect(unknown.warnings).toEqual(['AATG, GCTT are not covered by T4 test table.']);
  });

  it('refuses extra bases that are not A, C, G or T', () => {
    expect(checkCloningVector(ggDestination, GOLDEN, { extra5: 'GCN' }).problem).toMatch(/extra5/);
  });
});

describe('checkCloningVector: restriction', () => {
  it('accepts a pair in the enzyme set and refuses one that is not', () => {
    expect(checkCloningVector(pUC19, RESTRICTION).problem).toBeNull();
    expect(checkCloningVector(pUC19, { ...RESTRICTION, reverse: 'NopeI' }).problem).toBe(
      'NopeI is not in the enzyme set.',
    );
    expect(checkCloningVector(pUC19, RESTRICTION, { extra3: 'T-A' }).problem).toMatch(/extra3/);
  });
});

describe('insertNameClashes', () => {
  it('names the later row, with the batch’s own message for the same name', () => {
    expect(insertNameClashes([row('ACT1', {}, 2), row('TDH3', {}, 3), row('act1', {}, 4)])).toEqual(
      [{ index: 2, message: 'The name “act1” is already used on line 2.' }],
    );
  });

  it('sees names that differ only in spaces, which the primers’ names do not', () => {
    expect(insertNameClashes([row('my gene', {}, 2), row('my_gene', {}, 3)])).toEqual([
      {
        index: 1,
        message: 'The name “my_gene” gives the same primer names as “my gene” on line 2.',
      },
    ]);
  });

  it('finds nothing in distinct names', () => {
    expect(insertNameClashes([row('a'), row('b')])).toEqual([]);
  });
});
