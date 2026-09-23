import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type SeqDocument, rangePieces } from '@/core';
import { parseSnapGene } from '@/io';

import oracle from './snapgene.json';

/**
 * Our SnapGene reader against Biopython's, on the .dna fixtures
 * scripts/oracle/snapgene_fixtures.py writes (#44): the same bases, the same
 * topology, and every feature and primer at the same place on the same
 * strand.
 *
 * Biopython keeps SnapGene's sequence as it is, running over both strands
 * of a sticky end, and does not read the ends; ours holds the top strand
 * and the ends. So the top strand is put back together with the bases a
 * bottom-strand overhang carries before comparing, and Biopython's
 * locations are clipped to the part we keep.
 */

const dir = join(fileURLToPath(new URL('../../io/fixtures/snapgene', import.meta.url)));

interface Expected {
  readonly file: string;
  readonly length: number;
  readonly sequence: string;
  readonly topology: string;
  readonly features: readonly {
    readonly type: string;
    readonly strand: string;
    readonly parts: readonly (readonly number[])[];
    readonly label: string;
  }[];
}

/** A feature as a comparable string: type, strand, and its pieces sorted. */
function key(type: string, reverse: boolean, parts: readonly (readonly number[])[]): string {
  const pieces = parts.map((p) => `${p[0] ?? 0}..${p[1] ?? 0}`).sort();
  return `${type} ${reverse ? '-' : '+'} ${pieces.join(',')}`;
}

/** Every way `doc` differs from what Biopython read. */
function differences(doc: SeqDocument, expected: Expected): string[] {
  const out: string[] = [];
  const head = doc.ends?.left.kind === "3'" ? doc.ends.left.overhang : '';
  const tail = doc.ends?.right.kind === "5'" ? doc.ends.right.overhang : '';
  if (head + doc.sequence.toString() + tail !== expected.sequence) out.push('sequence');
  if (doc.topology !== expected.topology) out.push(`topology ${doc.topology}`);

  const ours = new Map<string, number>();
  for (const f of doc.features) {
    const parts = f.segments
      .flatMap((s) => (s.kind === 'range' ? rangePieces(s, doc.length) : []))
      .map((r) => [r.start + head.length, r.end + head.length]);
    const k = key(f.type, f.strand === 'reverse', parts);
    ours.set(k, (ours.get(k) ?? 0) + 1);
  }
  const end = head.length + doc.length;
  for (const f of expected.features) {
    const parts = f.parts
      .map(([s = 0, e = 0]) => [Math.max(s, head.length), Math.min(e, end)])
      .filter(([s = 0, e = 0]) => e > s);
    if (parts.length === 0) continue;
    const k = key(f.type, f.strand === 'reverse', parts);
    const n = ours.get(k) ?? 0;
    if (n === 0) out.push(`missing ${k} (${f.label})`);
    else ours.set(k, n - 1);
  }
  for (const [k, n] of ours) if (n > 0) out.push(`extra ${k}`);
  return out;
}

describe('SnapGene reader against Biopython', () => {
  it('has fixtures to compare', () => {
    expect(oracle.files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(oracle.files.map((f) => [f.file, f] as const))('%s', (file, expected) => {
    const result = parseSnapGene(new Uint8Array(readFileSync(join(dir, file))), file);
    const doc = result.documents[0];
    if (doc === undefined) throw new Error('no document');
    expect(differences(doc, expected)).toEqual([]);
  });

  it('reads the ends Biopython does not', () => {
    const read = (file: string) =>
      parseSnapGene(new Uint8Array(readFileSync(join(dir, file))), file).documents[0];
    expect(read('ta-vector.dna')?.ends).toEqual({
      left: { kind: "3'", overhang: 'A', enzyme: null },
      right: { kind: "3'", overhang: 'T', enzyme: null },
    });
    expect(read('d-topo.dna')?.ends?.right).toEqual({
      kind: "5'",
      overhang: 'CACC',
      enzyme: null,
    });
    expect(read('plasmid.dna')?.ends).toBeNull();
  });
});

/**
 * The same comparison over a whole SnapGene installation's bundled files,
 * run by `scripts/oracle/run.sh snapgene-local`, which sets SNAPGENE_ORACLE
 * to Biopython's reading of them. Skipped everywhere else.
 */
const local = process.env['SNAPGENE_ORACLE'];
describe.skipIf(local === undefined || !existsSync(local))(
  'SnapGene reader against Biopython, local installation',
  () => {
    it('agrees on every file', () => {
      const { files } = JSON.parse(readFileSync(local ?? '', 'utf8')) as {
        files: Expected[];
      };
      const problems = files.flatMap((expected) => {
        const doc = parseSnapGene(new Uint8Array(readFileSync(expected.file)), expected.file)
          .documents[0];
        return doc === undefined
          ? [`${expected.file}: no document`]
          : differences(doc, expected).map((d) => `${expected.file}: ${d}`);
      });
      expect(files.length).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });
  },
);
