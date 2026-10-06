import {
  type EditOp,
  type Feature,
  SeqDocument,
  createFeature,
  rangeSegment,
  reverseComplement,
  translateCds,
} from '@/core';

import oracle from './editing.json';

/**
 * Single edits against an independent answer (scripts/oracle/editing.py):
 * seeded documents, linear and circular, with multi-segment, both-strand and
 * origin-wrapping features and CDSs of every /codon_start, each take one
 * delete, insert, replace, setOrigin or reverseComplement. The expected
 * sequence comes from Biopython slicing (a base-identity model where the edit
 * wraps), the bases of each feature from that model, checked against
 * SeqRecord.reverse_complement(features=True) and pydna's shifted(), and for
 * a CDS the codons whose reading frame the edit leaves alone, translated by
 * Biopython: a delete that cuts into the start of a CDS must move
 * /codon_start (#160).
 *
 * Left out: copy, extract and paste of a region (#162), and the first residue
 * of a CDS whose start was cut off, where M or the plain residue is accepted
 * (#163).
 */

type Seg = readonly number[];
interface InFeature {
  readonly id: string;
  readonly type: string;
  readonly strand: 'forward' | 'reverse';
  readonly segments: readonly Seg[];
  readonly codon_start: number;
}
interface OutFeature {
  readonly id: string;
  readonly strand: 'forward' | 'reverse';
  readonly bases: string;
  readonly codons?: readonly string[];
  readonly protein?: string;
  readonly first?: readonly string[];
  readonly start_cut?: boolean;
}
interface Case {
  readonly topology: 'linear' | 'circular';
  readonly seq: string;
  readonly features: readonly InFeature[];
  readonly op: { readonly type: string } & Record<string, unknown>;
  readonly after: {
    readonly seq: string;
    readonly features: readonly OutFeature[];
    readonly gone: readonly string[];
  };
}

const cases = oracle.cases as unknown as readonly Case[];

function toFeature(f: InFeature): Feature {
  return createFeature({
    id: f.id,
    type: f.type,
    name: f.id,
    strand: f.strand,
    segments: f.segments.map(([a, b]) => rangeSegment(a ?? 0, b ?? 0)),
    qualifiers: f.codon_start > 0 ? [{ name: 'codon_start', value: String(f.codon_start) }] : [],
  });
}

/** The bases a feature reads: its segments in order, reverse-complemented on the reverse strand. */
function readBases(doc: SeqDocument, f: Feature): string {
  const L = doc.length;
  let text = '';
  for (const s of f.segments) {
    if (s.kind !== 'range') continue;
    for (let p = s.start; p < s.end; p++) text += doc.sequence.slice(p % L, (p % L) + 1);
  }
  return f.strand === 'reverse' ? reverseComplement(text) : text;
}

describe('single edits against Biopython and a base-identity model', () => {
  it('has cases of every edit, topology and frame', () => {
    expect(cases.length).toBeGreaterThanOrEqual(300);
    const ops = new Set(cases.map((c) => c.op.type));
    for (const o of ['delete', 'insert', 'replace', 'setOrigin', 'reverseComplement']) {
      expect(ops.has(o), o).toBe(true);
    }
    expect(cases.some((c) => c.topology === 'circular')).toBe(true);
    const cut = cases.flatMap((c) => c.after.features).filter((f) => f.start_cut === true);
    expect(cut.length).toBeGreaterThanOrEqual(100);
  });

  it('gives the expected sequence, feature bases and reading frames', () => {
    const problems: string[] = [];
    for (const [i, c] of cases.entries()) {
      const label = `#${String(i)} ${c.topology} ${c.op.type}`;
      const doc = SeqDocument.create({
        sequence: c.seq,
        topology: c.topology,
        features: c.features.map(toFeature),
      });
      const after = doc.apply(c.op as unknown as EditOp);
      if (after.sequence.toString() !== c.after.seq) {
        problems.push(`${label}: sequence differs`);
        continue;
      }
      const got = new Map(after.features.all().map((f) => [f.id, f]));
      const expectedIds = new Set(c.after.features.map((f) => f.id));
      for (const id of c.after.gone) {
        if (got.has(id)) problems.push(`${label}: ${id} should be gone`);
      }
      for (const id of got.keys()) {
        if (!expectedIds.has(id)) problems.push(`${label}: unexpected feature ${id}`);
      }
      for (const e of c.after.features) {
        const f = got.get(e.id);
        if (f === undefined) {
          problems.push(`${label}: ${e.id} vanished`);
          continue;
        }
        if (f.strand !== e.strand) problems.push(`${label}: ${e.id} strand ${f.strand}`);
        const bases = readBases(after, f);
        if (bases !== e.bases) {
          problems.push(`${label}: ${e.id} reads ${bases}, expected ${e.bases}`);
          continue;
        }
        if (e.codons === undefined || e.protein === undefined || e.first === undefined) continue;
        const cs = Number(f.qualifiers.find((q) => q.name === 'codon_start')?.value ?? '1');
        const codons: string[] = [];
        for (let k = cs - 1; k + 3 <= bases.length && codons.length < e.codons.length; k += 3) {
          codons.push(bases.slice(k, k + 3));
        }
        if (codons.join() !== e.codons.join()) {
          problems.push(
            `${label}: ${e.id} codon_start ${String(cs)} reads ${codons.join()}, expected ${e.codons.join()}`,
          );
          continue;
        }
        if (e.protein === '') continue;
        const protein = translateCds(after, f).protein;
        const n = e.protein.length;
        if (protein.slice(1, n) !== e.protein.slice(1) || !e.first.includes(protein.slice(0, 1))) {
          problems.push(`${label}: ${e.id} protein ${protein}, expected ${e.protein}`);
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });
});
