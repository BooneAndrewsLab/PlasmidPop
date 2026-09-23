import { type Enzyme, type Topology, ENZYMES, findCutSites, isPalindromicSite } from '@/core';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './restriction.json';

/**
 * Restriction analysis against Biopython's Bio.Restriction
 * (scripts/oracle/generate.py): the same enzymes on the same sequences
 * must cut in the same places — real plasmids, sites straddling the origin
 * or hugging the ends of a linear molecule, and random sequences — and our
 * curated enzyme table must say what REBASE (through Biopython) says.
 */

interface Definition {
  readonly name: string;
  readonly site: string;
  readonly cutTop: number;
  readonly cutBottom: number;
}

function enzymeFrom(d: Definition): Enzyme {
  return { ...d, palindromic: isPalindromicSite(d.site) };
}

interface Case {
  readonly label: string;
  readonly topology: Topology;
  readonly sequence?: string;
  readonly fixture?: string;
  readonly cuts: Readonly<Record<string, readonly number[]>>;
}

const cases = oracle.cases as readonly Case[];
const enzymes: readonly Enzyme[] = oracle.enzymes.map(enzymeFrom);
const byName = new Map(enzymes.map((e) => [e.name, e]));

function sequenceOf(c: Case): string {
  if (c.sequence !== undefined) return c.sequence;
  if (c.fixture === undefined) throw new Error('case has no input');
  const doc = parseGenBank(readFixture(c.fixture)).documents[0];
  if (doc === undefined) throw new Error(`${c.fixture}: no record`);
  return doc.sequence.toString().toUpperCase();
}

describe('restriction analysis against Biopython', () => {
  it('cuts where Biopython cuts', () => {
    const problems: string[] = [];
    for (const c of cases) {
      const expected = c.cuts;
      // Single-enzyme cases scan with that enzyme only, as Biopython did.
      const panel =
        c.label.startsWith('random') || c.fixture !== undefined
          ? enzymes
          : enzymes.filter((e) => c.label.startsWith(`${e.name} `));
      const found = new Map<string, number[]>();
      const edgeOnly = new Set<string>();
      const sequence = sequenceOf(c);
      for (const s of findCutSites(sequence, c.topology, panel)) {
        // KNOWN DIFFERENCE: on a linear molecule we list a cut whose top or
        // bottom strand is cut exactly at an end. That is no double-strand
        // break, and Biopython leaves it out. Tolerated only in that shape.
        const L = sequence.length;
        if (c.topology === 'linear' && [s.cut, s.cutBottom].some((p) => p === 0 || p === L)) {
          edgeOnly.add(`${s.enzyme}@${s.cut}`);
        }
        const list = found.get(s.enzyme) ?? [];
        list.push(s.cut);
        found.set(s.enzyme, list);
      }
      for (const e of panel) {
        const ours = [...new Set(found.get(e.name) ?? [])]
          .filter((p) => !edgeOnly.has(`${e.name}@${p}`) || expected[e.name]?.includes(p) === true)
          .sort((a, b) => a - b);
        const theirs = expected[e.name] ?? [];
        if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
          problems.push(
            `${c.label}: ${e.name} ${e.site} cuts [${ours.join(',')}], Biopython [${theirs.join(',')}]`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('ships an enzyme table that agrees with REBASE', () => {
    const problems: string[] = [];
    const bundled = oracle.bundled as Record<string, Definition | null>;
    for (const ours of ENZYMES) {
      const theirs = bundled[ours.name];
      if (theirs === undefined || theirs === null) {
        problems.push(`${ours.name}: not in Biopython's REBASE`);
        continue;
      }
      if (
        ours.site !== theirs.site ||
        ours.cutTop !== theirs.cutTop ||
        ours.cutBottom !== theirs.cutBottom
      ) {
        problems.push(
          `${ours.name}: ours ${ours.site} (${ours.cutTop}, ${ours.cutBottom}), REBASE ${theirs.site} (${theirs.cutTop}, ${theirs.cutBottom})`,
        );
      }
    }
    expect(problems).toEqual([]);
    expect(byName.size).toBeGreaterThan(200);
  });
});
