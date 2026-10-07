import {
  type DigestFragment,
  type EditOp,
  type Feature,
  SeqDocument,
  createFeature,
  digest,
  documentFromFragment,
  emptyVector,
  extractRange,
  flipFragment,
  firstQualifier,
  ligate,
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
 * Region copy (extractRange) and delete are held to the same model on one
 * feature in a 24-63 bp plasmid (the second and third describe below).
 *
 * Left out: paste of a region (#162), and the first residue
 * of a CDS whose start was cut off, where M or the plain residue is accepted
 * (#163). Copies leave out whole-circle regions that a feature reads across
 * the cut of (#174), partial marks other than where a copy cuts inside one
 * segment (#176), and /translation and /transl_except (#179).
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

type SrcSeg = readonly [number, number, boolean, boolean];
interface SrcFeature {
  readonly type: string;
  readonly strand: 'forward' | 'reverse';
  readonly segments: readonly SrcSeg[];
  readonly codon_start: number;
}
interface CopyOut {
  readonly min: number;
  readonly bases: string;
  readonly cut5: boolean;
  readonly cut3: boolean;
  readonly codon_start?: number;
  readonly protein?: string;
  readonly tail2?: boolean;
}
interface CopyCase {
  readonly topology: 'linear' | 'circular';
  readonly seq: string;
  readonly feature: SrcFeature;
  readonly region: readonly [number, number];
  readonly extract: string;
  readonly out: readonly CopyOut[];
}
interface DeleteCase {
  readonly topology: 'linear' | 'circular';
  readonly seq: string;
  readonly feature: SrcFeature;
  readonly range: readonly [number, number];
  readonly after_seq: string;
  readonly after: {
    readonly gone: boolean;
    readonly bases?: string;
    readonly codon_start?: number;
    readonly protein?: string;
    readonly cut5?: boolean;
  };
}
const copies = (oracle as unknown as { copies: readonly CopyCase[] }).copies;
const deletes = (oracle as unknown as { deletes: readonly DeleteCase[] }).deletes;

function sourceFeature(f: SrcFeature): Feature {
  return createFeature({
    type: f.type,
    name: 'f',
    strand: f.strand,
    segments: f.segments.map(([a, b, ps, pe]) =>
      rangeSegment(a, b, { partialStart: ps, partialEnd: pe }),
    ),
    qualifiers: f.codon_start > 0 ? [{ name: 'codon_start', value: String(f.codon_start) }] : [],
  });
}

/** Which ends of a feature are marked partial, as [5', 3'] on its own strand. */
function partialEnds(f: Feature): [boolean, boolean] {
  const r = f.segments.filter((s) => s.kind === 'range');
  const first = r[0];
  const last = r[r.length - 1];
  if (first?.kind !== 'range' || last?.kind !== 'range') return [false, false];
  return f.strand === 'reverse'
    ? [last.partialEnd, first.partialStart]
    : [first.partialStart, last.partialEnd];
}

function minStart(f: Feature): number {
  return Math.min(...f.segments.map((s) => (s.kind === 'range' ? s.start : s.position)));
}

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

describe('copying a region against a base-identity model and Biopython translation', () => {
  it('has splits, regions across the origin, reverse strands and clipped CDSs', () => {
    expect(copies.length).toBeGreaterThanOrEqual(250);
    expect(copies.filter((c) => c.out.length > 1).length).toBeGreaterThanOrEqual(30);
    expect(copies.filter((c) => c.region[1] > c.seq.length).length).toBeGreaterThanOrEqual(60);
    expect(copies.filter((c) => c.feature.strand === 'reverse').length).toBeGreaterThanOrEqual(80);
    expect(copies.filter((c) => c.out.some((o) => o.protein !== undefined)).length).toBeGreaterThan(
      150,
    );
  });

  it('keeps the bases, strand, codon_start and protein of every stretch', () => {
    const problems: string[] = [];
    for (const [i, c] of copies.entries()) {
      const label = `#${String(i)} ${c.topology} [${c.region.join(',')})`;
      const doc = SeqDocument.create({
        sequence: c.seq,
        topology: c.topology,
        features: [sourceFeature(c.feature)],
      });
      const ex = extractRange(doc, { start: c.region[0], end: c.region[1] });
      if (ex.sequence.toString() !== c.extract) {
        problems.push(`${label}: extract differs`);
        continue;
      }
      const got = [...ex.features].sort((a, b) => minStart(a) - minStart(b));
      if (got.length !== c.out.length) {
        problems.push(`${label}: ${String(got.length)} features, expected ${String(c.out.length)}`);
        continue;
      }
      for (const [k, e] of c.out.entries()) {
        const f = got[k];
        if (f === undefined) continue;
        if (f.strand !== c.feature.strand) problems.push(`${label}: strand`);
        const bases = readBases(ex, f);
        if (bases !== e.bases) {
          problems.push(`${label}: reads ${bases}, expected ${e.bases}`);
          continue;
        }
        // A copy that cuts inside a segment marks that end partial.
        const [five, three] = partialEnds(f);
        if (e.cut5 && !five) problems.push(`${label}: 5' cut not marked partial`);
        if (e.cut3 && !three) problems.push(`${label}: 3' cut not marked partial`);
        if (e.protein === undefined || e.codon_start === undefined) continue;
        const cs = Number(firstQualifier(f, 'codon_start') ?? '1');
        if (cs !== e.codon_start) {
          problems.push(`${label}: codon_start ${String(cs)}, expected ${String(e.codon_start)}`);
          continue;
        }
        const protein = translateCds(ex, f).protein;
        // A 2-base partial codon at the 3' end reads as one more residue (#142).
        const ok =
          protein === e.protein || (e.tail2 === true && protein.slice(0, -1) === e.protein);
        if (!ok) problems.push(`${label}: protein ${protein}, expected ${e.protein}`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });
});

describe('deleting a region that trims a CDS', () => {
  it('has trimmed CDSs on both strands and topologies', () => {
    expect(deletes.length).toBeGreaterThanOrEqual(200);
    const trimmed = deletes.filter(
      (d) => d.after.cut5 === true && d.after.codon_start !== undefined,
    );
    expect(trimmed.length).toBeGreaterThanOrEqual(90);
    expect(new Set(trimmed.map((d) => d.feature.strand)).size).toBe(2);
    expect(new Set(trimmed.map((d) => d.topology)).size).toBe(2);
  });

  it('leaves the remaining bases, moves codon_start and marks the cut start partial', () => {
    const problems: string[] = [];
    for (const [i, d] of deletes.entries()) {
      const label = `#${String(i)} ${d.topology} [${d.range.join(',')})`;
      const doc = SeqDocument.create({
        sequence: d.seq,
        topology: d.topology,
        features: [sourceFeature(d.feature)],
      });
      const after = doc.delete({ start: d.range[0], end: d.range[1] });
      if (after.sequence.toString() !== d.after_seq) {
        problems.push(`${label}: sequence differs`);
        continue;
      }
      const f = [...after.features][0];
      if (d.after.gone) {
        if (f !== undefined) problems.push(`${label}: should be gone`);
        continue;
      }
      if (f === undefined) {
        problems.push(`${label}: vanished`);
        continue;
      }
      const bases = readBases(after, f);
      if (bases !== d.after.bases) {
        problems.push(`${label}: reads ${bases}, expected ${String(d.after.bases)}`);
        continue;
      }
      if (d.after.codon_start === undefined) continue;
      const cs = Number(firstQualifier(f, 'codon_start') ?? '1');
      if (cs !== d.after.codon_start) {
        problems.push(
          `${label}: codon_start ${String(cs)}, expected ${String(d.after.codon_start)}`,
        );
      }
      if (partialEnds(f)[0] !== d.after.cut5) problems.push(`${label}: 5' mark`);
      const protein = translateCds(after, f).protein;
      const want = d.after.protein ?? '';
      if (protein.slice(1) !== want.slice(1) && protein.slice(1, want.length) !== want.slice(1)) {
        problems.push(`${label}: protein ${protein}, expected ${want}`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });
});

/**
 * Features through a digest and a ligation against a base-identity model
 * (scripts/oracle/editing.py, ligation_cases): circular plasmids with CDSs
 * (joins, both strands, across the origin, /codon_start 1-3, other tables,
 * /transl_except, partial starts) cut at one to three sites with blunt, 5'
 * or 3' ends, then self-closed, joined in order or swapped, closed one
 * fragment at a time with the rest dropped out, or made an empty vector. The
 * product must read the sequence the identity model says and each feature the
 * bases, strand, /codon_start, partial marks and (Biopython-translated)
 * protein it says, with its other qualifiers kept (so a CDS clipped by a cut
 * keeps its frame and gets partial ends, and one a ligation rejoins is whole
 * again).
 *
 * Left out (#182): a /transl_except whose codon a cut splits, a rejoin over
 * lost bases or of same-named pieces of different features, a join cut in its
 * intron and religated. Not covered: bluntEnds then emptyVector (#183), and a
 * flipped fragment with an overhang, which drops the annotation on those
 * bases by design (item 34).
 */
describe('features through a digest and a ligation', () => {
  interface LigFeature {
    readonly type: string;
    readonly name: string;
    readonly strand: 'forward' | 'reverse';
    readonly segments: string;
    readonly partialStart: boolean;
    readonly codon_start?: number;
    readonly table?: number;
    readonly te?: readonly number[] | null;
  }
  interface LigPlan {
    readonly parts: readonly string[];
    readonly circular: boolean;
    readonly empty: boolean;
    readonly sequence: string;
    readonly expect: readonly string[];
  }
  interface LigCase {
    readonly seq: string;
    readonly features: readonly LigFeature[];
    readonly cuts: readonly string[];
    readonly plans: readonly LigPlan[];
  }
  const cases = (oracle as unknown as { ligation: readonly LigCase[] }).ligation;
  const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };

  function sourceDocument(c: LigCase): SeqDocument {
    return SeqDocument.create({
      name: 'src',
      sequence: c.seq,
      topology: 'circular',
      features: c.features.map((f) =>
        createFeature({
          type: f.type,
          name: f.name,
          strand: f.strand,
          segments: f.segments.split(',').map((t, i) => {
            const [a, b] = t.split('-').map(Number);
            return rangeSegment(a ?? 0, b ?? 0, { partialStart: i === 0 && f.partialStart });
          }),
          qualifiers:
            f.type !== 'CDS'
              ? []
              : [
                  { name: 'codon_start', value: String(f.codon_start) },
                  ...(f.table !== 1 ? [{ name: 'transl_table', value: String(f.table) }] : []),
                  { name: 'translation', value: 'XXXX' },
                  { name: 'note', value: `n-${f.name}` },
                  ...(f.te
                    ? [
                        {
                          name: 'transl_except',
                          value: `(pos:${
                            f.strand === 'forward'
                              ? `${String(f.te[0])}..${String(f.te[2])}`
                              : `complement(${String(f.te[0])}..${String(f.te[2])})`
                          },aa:Sec)`,
                        },
                      ]
                    : []),
                ],
        }),
      ),
    });
  }

  /** What a feature of the product reads, as the oracle writes it. */
  function describe_(doc: SeqDocument, f: Feature): string {
    const seq = doc.sequence.toString().toUpperCase();
    const L = seq.length;
    const ranges = f.segments.flatMap((s) => (s.kind === 'range' ? [s] : []));
    let pos = ranges.flatMap((s) =>
      Array.from({ length: s.end - s.start }, (_, k) => (s.start + k) % L),
    );
    if (f.strand === 'reverse') pos = pos.reverse();
    const bases = pos
      .map((p) => (f.strand === 'forward' ? seq[p] : (COMPLEMENT[seq[p] ?? ''] ?? '')))
      .join('');
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    const five = f.strand === 'reverse' ? last?.partialEnd : first?.partialStart;
    const three = f.strand === 'reverse' ? first?.partialStart : last?.partialEnd;
    const t = f.type === 'CDS' ? translateCds(doc, f) : null;
    return [
      f.type,
      f.name,
      f.strand,
      bases,
      t === null ? '-' : String(t.codonStart),
      five === true ? 'P' : 'c',
      three === true ? 'P' : 'c',
      t === null ? '-' : t.protein,
    ].join('|');
  }

  /** Equal as lists; an expected protein that starts with '?' accepts M or any first residue. */
  function sameFeatures(got: readonly string[], expect: readonly string[]): boolean {
    if (got.length !== expect.length) return false;
    const left = [...expect];
    for (const g of got) {
      const fields = g.split('|');
      const protein = fields[7] ?? '';
      const wild = [...fields.slice(0, 7), `?${protein.slice(1)}`].join('|');
      const at = left.findIndex((e) => e === g || e === wild);
      if (at < 0) return false;
      left.splice(at, 1);
    }
    return true;
  }

  const kept = (doc: SeqDocument): string[] =>
    doc.features
      .all()
      .filter((f) => f.type === 'CDS')
      .flatMap((f) => [
        `${f.name}:${firstQualifier(f, 'note') ?? ''}:${firstQualifier(f, 'transl_table') ?? ''}`,
      ]);

  it('covers every cut count, strand and a good number of CDSs', () => {
    expect(cases.length).toBeGreaterThanOrEqual(250);
    expect(new Set(cases.map((c) => c.cuts.length))).toEqual(new Set([1, 2, 3]));
    expect(cases.flatMap((c) => c.plans).length).toBeGreaterThanOrEqual(900);
    expect(new Set(cases.flatMap((c) => c.features.map((f) => f.strand))).size).toBe(2);
    expect(cases.flatMap((c) => c.plans).some((p) => p.empty)).toBe(true);
  });

  it('carries each feature through the cut and the ligation as the identity model says', () => {
    const problems: string[] = [];
    for (const [ci, c] of cases.entries()) {
      const doc = sourceDocument(c);
      const fragments = digest(
        doc,
        c.cuts.map((t) => {
          const [cut, bottom] = t.split(':').map(Number);
          return {
            enzyme: 'X',
            cut: cut ?? 0,
            cutBottom: bottom ?? 0,
            siteStart: cut ?? 0,
            strand: 'forward' as const,
          };
        }),
      );
      for (const [pi, plan] of c.plans.entries()) {
        const tag = `case ${String(ci)} plan ${String(pi)} ${plan.parts.join(',')}`;
        try {
          const parts: DigestFragment[] = plan.parts.map((p) => {
            const fragment = fragments[Number.parseInt(p, 10)];
            if (fragment === undefined) throw new Error('no such fragment');
            return p.endsWith('!') ? flipFragment(fragment) : fragment;
          });
          const first = parts[0];
          if (first === undefined) throw new Error('no fragments');
          const products = plan.empty
            ? [emptyVector(documentFromFragment(first)), emptyVector(first)]
            : [ligate(parts, { name: 'p', circular: plan.circular })];
          for (const product of products) {
            if (product === null) {
              problems.push(`${tag}: no product`);
              continue;
            }
            if (product.sequence.toString().toUpperCase() !== plan.sequence.toUpperCase()) {
              problems.push(`${tag}: wrong sequence`);
              continue;
            }
            const got = product.features
              .all()
              .map((f) => describe_(product, f))
              .sort();
            if (!sameFeatures(got, plan.expect)) {
              problems.push(
                `${tag}:\n  got ${got.join('\n      ')}\n  exp ${plan.expect.join('\n      ')}`,
              );
            }
            // CDS qualifiers other than the frame ones ride along on every piece
            const expectedKept = kept(doc).map((k) => k.split(':'));
            for (const entry of kept(product)) {
              const [name, note, table] = entry.split(':');
              const src = expectedKept.find((k) => k[0] === name);
              if (src === undefined || src[1] !== note || src[2] !== table) {
                problems.push(`${tag}: qualifiers of ${String(name)} changed`);
              }
            }
          }
        } catch (e) {
          problems.push(`${tag}: ${String(e)}`);
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  }, 120_000);
});
