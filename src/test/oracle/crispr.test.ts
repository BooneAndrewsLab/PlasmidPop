import { type Nuclease, type Topology, findCrisprGuides } from '@/core';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './crispr.json';

/**
 * CRISPR guides against Biopython (scripts/oracle/crispr.py), whose PAM
 * search is Bio.SeqUtils.nt_search — the IUPAC codes expanded and matched
 * by its own regex, not by ours. Every guide of pUC19, pBR322, phiX174 and
 * the linear U49845 record, plus random circles where the origin falls
 * inside a spacer or a PAM: the protospacer's coordinates, the PAM read
 * off the document, both cut boundaries, and for pUC19 the off-target
 * counts by mismatch as well.
 *
 * pUC19 is also searched after being opened at another base: the same
 * molecule must give the same guides, rotated.
 *
 * On-target scoring is deliberately absent here and in the app: issue #206
 * asks for a published implementation to check a score against, and until
 * there is one PlasmidPop reports the flags it can stand behind instead.
 */
const nucleaseFor = (id: string): Nuclease => {
  const spec = oracle.nucleases[id as keyof typeof oracle.nucleases];
  return { id, name: id, ...spec, pamSide: spec.pamSide as Nuclease['pamSide'] };
};

function sequenceOf(c: { fixture?: string; sequence?: string }): string {
  if (c.sequence !== undefined) return c.sequence;
  if (c.fixture === undefined) throw new Error('a case has neither a sequence nor a fixture');
  return parseGenBank(readFixture(c.fixture)).documents[0]?.sequence.toString() ?? '';
}

describe('CRISPR guides against Biopython', () => {
  for (const c of oracle.cases) {
    it(c.label, () => {
      const sequence = sequenceOf(c);
      const guides = findCrisprGuides(sequence, c.topology as Topology, nucleaseFor(c.nuclease), {
        maxMismatches: oracle.maxMismatches,
      });
      // Off-targets are only pinned where the oracle counted them; where it
      // did not, its counts are all zero and are not compared.
      const counted = c.guides.some((g) => g.offTargets.some((n) => n > 0));
      expect(
        guides.map((g) => ({
          range: [g.range.start, g.range.end],
          strand: g.strand,
          spacer: g.spacer,
          pam: g.pam,
          pamRange: [g.pamRange.start, g.pamRange.end],
          cut: [g.cut.forward, g.cut.reverse],
          ...(counted ? { offTargets: g.offTargets } : {}),
        })),
      ).toEqual(
        c.guides.map((g) => ({
          range: g.range,
          strand: g.strand,
          spacer: g.spacer,
          pam: g.pam,
          pamRange: g.pamRange,
          cut: g.cut,
          ...(counted ? { offTargets: g.offTargets } : {}),
        })),
      );
    });
  }
});
