import { createHash } from 'node:crypto';

import { type SeqDocument } from '@/core';
import {
  type CloningInsert,
  designCloningEnds,
  insertSequence,
  resolveVectorRegion,
  scanForCloningNow,
} from '@/core/cloning/cloningEnds';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './cloningEnds.json';

/**
 * Restriction-cloning ends (item 108) against Bio.Restriction and pydna
 * (scripts/oracle/cloningends.py): where each candidate enzyme cuts the
 * insert stretch and pUC19, which is what the pair suggestions are built
 * on, and what cloning the insert into pUC19 with a pair makes — the
 * vector's backbone joined to the digested amplicon by pydna, both ways
 * round — which `simulate()` must reproduce whatever padding it chose.
 */

interface Product {
  readonly pair: readonly string[];
  readonly flipped: boolean;
  readonly length: number;
  readonly sha256: string;
  readonly head: string;
}

interface Insert {
  readonly name: string;
  readonly fixture: string;
  readonly start: number;
  readonly end: number;
  readonly strand: 'forward' | 'reverse';
  readonly length: number;
  readonly cuts: Readonly<Record<string, readonly number[]>>;
  readonly products: readonly Product[];
}

const MCS = { start: 395, end: 452 };

function fixture(name: string): SeqDocument {
  const doc = parseGenBank(readFixture(name)).documents[0];
  if (doc === undefined) throw new Error(`${name}: no record`);
  return doc;
}

function sha256(text: string): string {
  return createHash('sha256').update(text.toUpperCase()).digest('hex');
}

describe('cloning ends against Biopython and pydna', () => {
  const vector = fixture(oracle.vector.fixture);
  const inserts = oracle.inserts as readonly Insert[];
  const enzymes = Object.keys(oracle.vector.cuts);

  it('has the cases', () => {
    expect(inserts).toHaveLength(2);
    expect(inserts.flatMap((i) => i.products).length).toBeGreaterThanOrEqual(12);
  });

  it.each(inserts.map((i) => [i.name, i] as const))(
    'cuts the %s insert stretch and the vector where Bio.Restriction does',
    (_name, spec) => {
      const insert: CloningInsert = {
        document: fixture(spec.fixture),
        range: { start: spec.start, end: spec.end },
        strand: spec.strand,
        name: spec.name,
      };
      expect(insertSequence(insert)).toHaveLength(spec.length);
      const scans = scanForCloningNow(vector, insert);
      const cutsOf = (sites: typeof scans.insertSites, enzyme: string): number[] =>
        sites
          .filter((s) => s.enzyme === enzyme)
          .map((s) => s.cut)
          .sort((a, b) => a - b);
      for (const enzyme of enzymes) {
        expect(cutsOf(scans.insertSites, enzyme), `${enzyme} on the insert`).toEqual(
          spec.cuts[enzyme],
        );
        expect(cutsOf(scans.vectorSites, enzyme), `${enzyme} on the vector`).toEqual(
          oracle.vector.cuts[enzyme as keyof typeof oracle.vector.cuts],
        );
      }
    },
  );

  it('simulates the product pydna makes, in both orientations', () => {
    const problems: string[] = [];
    for (const spec of inserts) {
      const insert: CloningInsert = {
        document: fixture(spec.fixture),
        range: { start: spec.start, end: spec.end },
        strand: spec.strand,
        name: spec.name,
      };
      const scans = scanForCloningNow(vector, insert);
      for (const p of spec.products) {
        const [a, b] = p.pair;
        if (a === undefined || b === undefined) throw new Error('pair');
        const ctx = {
          vector,
          region: resolveVectorRegion(vector, MCS),
          insert,
          flipped: p.flipped,
          scans,
        };
        const pair = p.flipped ? { forward: b, reverse: a } : { forward: a, reverse: b };
        const sim = designCloningEnds(ctx, pair).simulate();
        const label = `${spec.name} ${a}·${b}${p.flipped ? ' flipped' : ''}`;
        const product = sim.product;
        if (product === null) {
          problems.push(`${label}: ${sim.problem ?? 'no product'}`);
          continue;
        }
        const text = product.sequence.toString();
        if (!product.isCircular) problems.push(`${label}: not circular`);
        if (text.length !== p.length) problems.push(`${label}: ${text.length} bp vs ${p.length}`);
        if (!text.toUpperCase().startsWith(p.head)) problems.push(`${label}: origin moved`);
        if (sha256(text) !== p.sha256) problems.push(`${label}: sequence differs`);
      }
    }
    expect(problems).toEqual([]);
  });
});
