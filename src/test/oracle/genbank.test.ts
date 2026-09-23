import { type SeqDocument, formatLocation } from '@/core';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './genbank.json';

/**
 * Our GenBank parser and location writer against Biopython's
 * (scripts/oracle/generate.py). For every record — hand-written edge
 * cases, records Biopython wrote itself, and the real NCBI fixtures — we must
 * read the same bases, the same topology, and for every feature the same
 * type, strand, qualifiers and extracted sequence; and we must write each
 * location the way Biopython does.
 */

interface ExpectedFeature {
  readonly type: string;
  readonly strand: string;
  readonly location: string;
  readonly sequence: string;
  readonly qualifiers: Record<string, string[]>;
}

interface Expected {
  readonly name: string;
  readonly length: number;
  readonly sequence: string;
  readonly topology: string;
  readonly features: readonly ExpectedFeature[];
}

interface Case {
  readonly label: string;
  readonly genbank?: string;
  readonly fixture?: string;
  readonly expected: Expected;
}

/** Every way `doc` differs from what Biopython read. */
export function compareToOracle(doc: SeqDocument, expected: Expected): string[] {
  const out: string[] = [];
  if (doc.length !== expected.length) out.push(`length ${doc.length} ≠ ${expected.length}`);
  // Biopython uppercases what it reads; we keep the file's case (tested elsewhere).
  if (doc.sequence.toString().toUpperCase() !== expected.sequence) out.push('sequence differs');
  if (doc.topology !== expected.topology)
    out.push(`topology ${doc.topology} ≠ ${expected.topology}`);
  const features = doc.features.all();
  if (features.length !== expected.features.length) {
    out.push(`${features.length} features ≠ ${expected.features.length}`);
    return out;
  }
  expected.features.forEach((want, i) => {
    const f = features[i];
    if (f === undefined) return;
    const at = `feature ${i} (${want.type} ${want.location})`;
    if (f.type !== want.type) out.push(`${at}: type ${f.type}`);
    if (want.strand !== 'none' && f.strand !== want.strand) out.push(`${at}: strand ${f.strand}`);
    const location = formatLocation(f, doc.length, doc.topology);
    // KNOWN DIFFERENCE: we read order(...) as join(...) (with a warning on
    // opening) and so write it back as join(...). Tolerated only as that.
    const orderAsJoin = want.location.replace(/\border\(/g, 'join(');
    if (location !== want.location && location !== orderAsJoin)
      out.push(`${at}: we write ${location}`);
    const seq = doc.featureSequence(f).toUpperCase();
    if (seq !== want.sequence) out.push(`${at}: reads ${seq}, Biopython ${want.sequence}`);
    for (const [key, values] of Object.entries(want.qualifiers)) {
      const ours = f.qualifiers.filter((q) => q.name === key).map((q) => q.value ?? '');
      if (JSON.stringify(ours) !== JSON.stringify(values)) {
        out.push(`${at}: /${key} ${JSON.stringify(ours)} ≠ ${JSON.stringify(values)}`);
      }
    }
  });
  return out;
}

function textOf(c: Case): string {
  if (c.genbank !== undefined) return c.genbank;
  if (c.fixture !== undefined) return readFixture(c.fixture);
  throw new Error(`${c.label}: no input`);
}

describe('GenBank against Biopython', () => {
  const groups: [string, readonly Case[]][] = [
    ['hand-written edge cases', oracle.static],
    ['records Biopython wrote', oracle.random],
    ['real NCBI records', oracle.fixtures],
  ];
  for (const [name, cases] of groups) {
    it(`reads and writes ${name} the way Biopython does`, () => {
      const problems: string[] = [];
      for (const c of cases) {
        const parsed = parseGenBank(textOf(c));
        const doc = parsed.documents[0];
        if (parsed.documents.length !== 1 || doc === undefined) {
          problems.push(`${c.label}: ${parsed.documents.length} records`);
          continue;
        }
        for (const p of compareToOracle(doc, c.expected)) problems.push(`${c.label}: ${p}`);
      }
      expect(problems).toEqual([]);
    });
  }
});
