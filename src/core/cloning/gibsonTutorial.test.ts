import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type SeqDocument, BUNDLED_ENZYME_SET, setActiveEnzymeSet, translate } from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import { gibson } from './index';

/**
 * Verifies docs/tutorials/gibson.md: the files it hands out and every number
 * it prints, through the function the Gibson panel calls.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}
const names = (doc: SeqDocument): string[] => [...doc.features].map((f) => f.name);
const seq = (doc: SeqDocument): string => doc.sequence.toString().toUpperCase();
/** Occurrences of `needle` in the circle `text`. */
function onCircle(text: string, needle: string): number {
  const wrapped = text + text.slice(0, needle.length - 1);
  let n = 0;
  for (let i = wrapped.indexOf(needle); i >= 0; i = wrapped.indexOf(needle, i + 1)) n++;
  return n;
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

const FILES = ['GB-Vector', 'GB-Insert1', 'GB-Insert2', 'GB-bad-Insert2'];

describe('gibson.md: the files', () => {
  it.each(FILES)('%s parses, round-trips and says it is synthetic', (f) => {
    const doc = tut(f);
    expect(doc.metadata.description).toMatch(/synthetic/i);
    expect(doc.topology).toBe('linear');
    const again = parseGenBank(writeGenBank(doc)).documents[0];
    expect(again?.sequence.toString()).toBe(doc.sequence.toString());
    expect(names(again ?? doc)).toEqual(names(doc));
  });

  it('are the sizes the page gives', () => {
    expect(FILES.map((f) => tut(f).length)).toEqual([1506, 508, 449, 449]);
  });

  it('end in the homology the next one starts with: 28, 30 and 26 bp', () => {
    const [v, a, b] = [tut('GB-Vector'), tut('GB-Insert1'), tut('GB-Insert2')].map(seq) as [
      string,
      string,
      string,
    ];
    expect(v.slice(-28)).toBe(a.slice(0, 28));
    expect(a.slice(-30)).toBe(b.slice(0, 30));
    expect(b.slice(-26)).toBe(v.slice(0, 26));
  });

  it('the bad insert differs from the good one by one base, in its 30 bp arm', () => {
    const good = seq(tut('GB-Insert2'));
    const bad = seq(tut('GB-bad-Insert2'));
    const diff = good.split('').flatMap((c, i) => (c === bad[i] ? [] : [i]));
    expect(diff).toEqual([13]);
  });
});

describe('gibson.md: the assembly', () => {
  // The page opens the vector, then insert 2, then insert 1: the order of the
  // tabs is not the order of the circle.
  const tube = [tut('GB-Vector'), tut('GB-Insert2'), tut('GB-Insert1')];
  const result = gibson(tube);
  const assembly = result.assembly;
  if (assembly === null) throw new Error('no assembly');
  const product = assembly.product;

  it('finds the order from the homology, not from the tabs', () => {
    expect(result.problem).toBeNull();
    expect(result.dropped).toEqual([]);
    expect(assembly.order.map((p) => p.document.name)).toEqual([
      'GB-Vector',
      'GB-Insert1',
      'GB-Insert2',
    ]);
    expect(assembly.order.some((p) => p.flipped)).toBe(false);
  });

  it('reports 28, 30 and the closing 26 bp overlaps, Tm 61, 65 and 65 °C, no warnings', () => {
    expect(assembly.joins.map((j) => [j.length, Number(j.tm.toFixed(0))])).toEqual([
      [28, 61],
      [30, 65],
      [26, 65],
    ]);
    expect(assembly.joins.every((j) => j.tm >= 48)).toBe(true);
    expect(assembly.warnings).toEqual([]);
  });

  it('makes a 2,379 bp circle: 1,506 + 508 + 449 less the 84 bp shared', () => {
    expect(product.name).toBe('GB-Vector+GB-Insert1+GB-Insert2 assembly');
    expect(product.length).toBe(2379);
    expect(product.length).toBe(1506 + 508 + 449 - (28 + 30 + 26));
    expect(product.topology).toBe('circular');
  });

  it('carries every feature once, and each overlap once', () => {
    expect(names(product)).toEqual([
      'synthetic terminator',
      'KanR',
      'ori',
      'synthetic promoter',
      'synthDomainA',
      'linker',
      'synthDomainB',
    ]);
    const text = seq(product);
    for (const [doc, from, to] of [
      ['GB-Vector', -28, undefined],
      ['GB-Insert1', -30, undefined],
      ['GB-Insert2', -26, undefined],
    ] as const) {
      expect(onCircle(text, seq(tut(doc)).slice(from, to))).toBe(1);
    }
  });

  it('reads as one frame: 150 + 10 + 130 residues, then the stop', () => {
    const text = seq(product);
    const start = text.indexOf('ATG', 1506);
    expect(start).toBe(1506);
    const protein = translate((text + text).slice(start));
    expect(protein.indexOf('*')).toBe(290);
  });

  it('with the bad insert: nothing follows insert 1, 1 of 3 parts never reached', () => {
    const r = gibson([tut('GB-Vector'), tut('GB-Insert1'), tut('GB-bad-Insert2')]);
    expect(r.assembly).toBeNull();
    expect(r.problem).toBe(
      'Nothing follows GB-Insert1: no other part starts with its last 15 bases or more. 1 of 3 parts were never reached.',
    );
  });

  it('lowering Overlap to 12 bp does not rescue it', () => {
    const r = gibson([tut('GB-Vector'), tut('GB-Insert1'), tut('GB-bad-Insert2')], {
      minOverlap: 12,
    });
    expect(r.problem).toBe(
      'Nothing follows GB-Insert1: no other part starts with its last 12 bases or more. 1 of 3 parts were never reached.',
    );
  });
});
