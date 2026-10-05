import { SeqDocument } from '@/core';
import { pcr } from '@/core/cloning/pcr';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './pcr.json';

/**
 * PCR products against the textbook product, forward primer + template
 * between + reverse complement of the reverse primer (scripts/oracle/pcr.py),
 * which pydna.amplify.pcr also builds; the generator checks that they agree
 * wherever pydna takes the case. Linear and circular templates, products
 * across the origin, 5' tails, inverse PCR, mismatches in the annealing part.
 */

interface Case {
  readonly id: string;
  readonly circular: boolean;
  readonly primers: readonly { name: string; sequence: string }[];
  readonly product: string;
  readonly template?: string;
  readonly fixture?: string;
}

function templateOf(c: Case): SeqDocument {
  const topology = c.circular ? 'circular' : 'linear';
  if (c.template !== undefined) {
    return SeqDocument.create({ name: c.id, sequence: c.template, topology });
  }
  const doc = parseGenBank(readFixture(c.fixture ?? '')).documents[0];
  if (doc === undefined) throw new Error(`${c.fixture}: no record`);
  return SeqDocument.create({ name: c.id, sequence: doc.sequence.toString(), topology });
}

describe('PCR against the textbook product (pydna)', () => {
  const cases = oracle.cases as readonly Case[];

  it('has the cases', () => {
    expect(cases.length).toBeGreaterThan(60);
  });

  it('builds the expected product from every case', () => {
    const problems: string[] = [];
    for (const c of cases) {
      const result = pcr(templateOf(c), c.primers);
      const got = result.products.map((p) => p.document.sequence.toString().toUpperCase());
      if (got.length !== 1 || got[0] !== c.product) {
        problems.push(
          `${c.id}: ${got.length} products, ${got.map((g) => g.length).join('/')} bp vs ${c.product.length}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
