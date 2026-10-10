import { describe, expect, it } from 'vitest';

import { findCutSites } from '@/core';

import { parseCustomEnzyme } from './customEnzyme';
import { parseRebaseWithRefM } from './withrefm';

function ok(name: string, notation: string) {
  const r = parseCustomEnzyme(name, notation);
  if (!r.ok) throw new Error(r.error);
  return r.enzyme;
}

describe('parseCustomEnzyme (#217)', () => {
  it('reads a caret as a symmetric cut', () => {
    expect(ok('MyEco', 'G^AATTC')).toMatchObject({
      site: 'GAATTC',
      cutTop: 1,
      cutBottom: 5,
      palindromic: true,
      custom: true,
    });
  });

  it('reads the bottom cut written out with an underscore', () => {
    expect(ok('MyEco', 'G^AATT_C')).toMatchObject({ site: 'GAATTC', cutTop: 1, cutBottom: 5 });
    // A bottom cut that is not the mirror image is taken as written: a 3' overhang.
    expect(ok('Odd', 'GTAC_G^T')).toMatchObject({ site: 'GTACGT', cutTop: 5, cutBottom: 4 });
  });

  it('reads Type IIS offsets', () => {
    expect(ok('MyBsa', 'GGTCTC(1/5)')).toMatchObject({
      site: 'GGTCTC',
      cutTop: 7,
      cutBottom: 11,
      palindromic: false,
    });
    expect(ok('Back', 'CAGGTACCC(-12/-16)')).toMatchObject({ cutTop: -3, cutBottom: -7 });
  });

  it('accepts IUPAC codes in either case and flags a degenerate palindrome', () => {
    expect(ok('HincLike', 'gtY^RAc')).toMatchObject({ site: 'GTYRAC', palindromic: true });
  });

  it('reads an N-padded caret once the bottom cut is given', () => {
    expect(ok('Pad', 'GGTCTCN^NNNN_')).toMatchObject({ site: 'GGTCTC', cutTop: 7, cutBottom: 11 });
  });

  it('says why a notation is refused', () => {
    const bad = (n: string, notation: string) => {
      const r = parseCustomEnzyme(n, notation);
      return r.ok ? null : r.error;
    };
    expect(bad('', 'G^AATTC')).toMatch(/name/);
    expect(bad('A B', 'G^AATTC')).toMatch(/spaces/);
    expect(bad('X', '')).toMatch(/recognition site/);
    expect(bad('X', 'GAATTC')).toMatch(/Mark where/);
    expect(bad('X', 'G^AA^TTC')).toMatch(/Mark where/);
    expect(bad('X', 'GAATTC(?/?)')).toMatch(/question marks/);
    expect(bad('X', 'G^AAXTC')).toMatch(/IUPAC/);
    expect(bad('X', 'CASTGNN^')).toMatch(/underscore/);
    expect(bad('X', 'C^N')).toMatch(/unspecific/);
  });

  it('reads the notation exactly as the REBASE import does', () => {
    for (const notation of ['G^AATTC', 'GGTCTC(1/5)', 'GT^MKAC', '(10/12)CGANNNNNNTGC(12/10)']) {
      const file = `REBASE version 1\n\n<1>X\n<2>\n<3>${notation}\n<4>\n<5>\n<6>\n<7>\n<8>r\n`;
      const [imported] = parseRebaseWithRefM(file).enzymes;
      const { custom: _c, ...typed } = ok('X', notation);
      expect(typed).toEqual(imported);
    }
  });

  it('cuts a sequence, wrapping the origin of a circle', () => {
    const enzyme = ok('MyEco', 'G^AATT_C');
    // GA at the end and ATTC at the start: the site GAATTC straddles the origin.
    const seq = 'ATTC' + 'C'.repeat(50) + 'GA';
    const sites = findCutSites(seq, 'circular', [enzyme]);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ enzyme: 'MyEco', siteStart: 54, cut: 55, cutBottom: 3 });
  });
});
