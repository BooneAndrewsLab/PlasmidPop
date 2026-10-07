import { differenceRows, effectText } from '@/app/alignmentDifferences';
import { buildFrames } from '@/app/alignmentResidues';
import { differenceRegions, stackAlignments } from '@/app/alignmentStack';
import { annotationsOf } from '@/app/alignmentTrack';
import { finishReadAlignment, prepareReadAlignment } from '@/app/readAlignment';
import { runReadBatch } from '@/app/readBatch';
import { alignBanded, alignEitherStrand, alignLong, alignPairwise } from '@/core/alignment';
import type { AlignmentMode, AlignmentOptions } from '@/core/alignment';
import { reverseComplement } from '@/core/sequence/alphabet';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import oracle from './alignment.json';

/**
 * Pairwise alignment against Bio.Align.PairwiseAligner
 * (scripts/oracle/alignment.py): the optimal global and local score of about
 * ninety seeded pairs (DNA under EDNAFULL with gaps -10/-0.5, protein under
 * BLOSUM62 with -11/-1), and, where Biopython's best alignment is unique, the
 * span of each sequence it covers. Which of several equally good alignments
 * is reported is no one's rule, so ties are held to the score alone. Two
 * pairs of about 3 kb go through the banded path as well, and 24 pairs
 * built to lead the band astray (tandem repeats, an insertion near a read
 * end, #167).
 */

interface Answer {
  readonly score: number;
  readonly span?: readonly number[];
}
interface Case {
  readonly kind: string;
  readonly alphabet: string;
  readonly a: string;
  readonly b: string;
  readonly global: Answer;
  readonly local: Answer;
}

const cases = oracle.cases as readonly Case[];
const modes: readonly AlignmentMode[] = ['global', 'local'];

describe('pairwise alignment against Biopython', () => {
  it('has pairs of every kind to compare', () => {
    expect(cases.length).toBeGreaterThanOrEqual(75);
    const kinds = new Set(cases.map((c) => c.kind));
    for (const k of ['random', 'mutated', 'indel-heavy', 'iupac', 'flanked', 'tandem', 'short']) {
      expect(kinds.has(k), k).toBe(true);
    }
    expect(cases.filter((c) => c.alphabet === 'protein').length).toBeGreaterThanOrEqual(15);
  });

  it.each(modes)('%s: score, and span where the best alignment is unique', (mode) => {
    const problems: string[] = [];
    let spans = 0;
    for (const [i, c] of cases.entries()) {
      const options: AlignmentOptions = {
        mode,
        alphabet: c.alphabet === 'protein' ? 'protein' : 'nucleotide',
      };
      const r = alignPairwise(c.a, c.b, options);
      const expected = c[mode];
      const label = `#${String(i)} ${c.kind} ${c.a} / ${c.b}`;
      if (r.score !== expected.score) {
        problems.push(`${label}: score ${String(r.score)}, Biopython ${String(expected.score)}`);
      }
      // The alignment must be of the stretches it says it covers.
      if (
        r.alignedA.replaceAll('-', '').toUpperCase() !==
          c.a.slice(r.startA, r.endA).toUpperCase() ||
        r.alignedB.replaceAll('-', '').toUpperCase() !== c.b.slice(r.startB, r.endB).toUpperCase()
      ) {
        problems.push(`${label}: aligned text is not the covered span`);
      }
      if (
        mode === 'global' &&
        [r.startA, r.endA, r.startB, r.endB].join() !==
          `0,${String(c.a.length)},0,${String(c.b.length)}`
      ) {
        problems.push(`${label}: a global alignment must cover both sequences`);
      }
      if (expected.span !== undefined) {
        spans++;
        const got = [r.startA, r.endA, r.startB, r.endB];
        if (got.join() !== expected.span.join()) {
          problems.push(`${label}: span ${got.join()}, Biopython ${expected.span.join()}`);
        }
      }
    }
    expect(spans).toBeGreaterThan(mode === 'local' ? 25 : 15);
    expect(problems).toEqual([]);
  });

  it('agrees on 3 kb pairs through the full, banded and fast paths', () => {
    expect(oracle.long).toHaveLength(2);
    for (const c of oracle.long) {
      expect(alignPairwise(c.a, c.b, { mode: 'global' }).score).toBe(c.global);
      expect(alignLong(c.a, c.b, { mode: 'global', fast: true }).score).toBe(c.global);
      const banded = alignBanded(c.a, c.b, { mode: 'global' });
      expect(banded).not.toBeNull();
      expect(banded?.exact).toBe(true);
      expect(banded?.alignment.score).toBe(c.global);
    }
  }, 30_000);

  // Tandem duplications and long insertions near a read's end, where the
  // band around shared words misses the best path (#167): the check after
  // the band has to find Biopython's optimum, global and local.
  it('reaches the optimum where the band alone misses it (#167)', () => {
    const banded = oracle.banded;
    expect(banded).toHaveLength(24);
    const problems: string[] = [];
    for (const [i, c] of banded.entries()) {
      const label = `#${String(i)} ${c.kind}`;
      const global = alignBanded(c.a, c.b, { mode: 'global' });
      if (global !== null && global.alignment.score !== c.global) {
        problems.push(
          `${label} global: ${String(global.alignment.score)}, Biopython ${String(c.global)}`,
        );
      }
      const local = alignEitherStrand(c.a, c.b, { mode: 'local', fast: true }).alignment.score;
      if (local !== c.local) {
        problems.push(`${label} local: ${String(local)}, Biopython ${String(c.local)}`);
      }
    }
    expect(problems).toEqual([]);
    // 4 s here; 43 s on a busy CI runner.
  }, 180_000);
});

interface CircularCase {
  readonly kind: string;
  readonly ref: string;
  readonly read: string;
  readonly score: number;
  readonly strand: 'forward' | 'reverse';
  readonly start: number;
  readonly last: number;
  readonly regions: readonly (readonly [number, string, string])[];
}

/** Differences of an alignment: (1-based position on the circle, reference bases, read bases). */
function regions(a: string, b: string, start: number, length: number): string[] {
  const out: string[] = [];
  let cur: { first: number; last: number; ref: string; read: string } | null = null;
  let p = start;
  const flush = (): void => {
    if (cur === null) return;
    const pos = (cur.ref === '' ? cur.last : cur.first) % length;
    out.push(`${String(pos + 1)} ${cur.ref || '-'} ${cur.read || '-'}`);
    cur = null;
  };
  for (let i = 0; i < a.length; i++) {
    const x = a.charAt(i);
    const y = b.charAt(i);
    if (x !== y) {
      cur ??= { first: p, last: p - 1, ref: '', read: '' };
      if (x !== '-') cur.last = p;
      cur.ref += x === '-' ? '' : x;
      cur.read += y === '-' ? '' : y;
    } else flush();
    if (x !== '-') p++;
  }
  flush();
  return out;
}

/**
 * Reads mapped onto a circular reference as the Align tab does it, against a
 * Biopython local alignment to the reference rotated so the read lies inside
 * it: reads across the origin on both strands, a deletion before the origin,
 * an insertion at it, a deletion or insertion just after it (#165), reads
 * inside either end, and reads the length of the whole plasmid. Banded
 * tandem or end-insertion cases (#167) are left out.
 */
describe('circular read mapping against Biopython', () => {
  const circular = oracle.circular as unknown as readonly CircularCase[];

  it('has reads of every kind', () => {
    expect(circular.length).toBeGreaterThanOrEqual(40);
    const kinds = new Set(circular.map((c) => c.kind));
    for (const k of [
      'span',
      'span_rc',
      'bigdel_before',
      'bigins_origin',
      'del_after',
      'del_after_rc',
      'del_after_short',
      'ins_after',
      'whole',
      'whole_rc',
    ]) {
      expect(kinds.has(k), k).toBe(true);
    }
  });

  it('gives Biopython score, strand, span and differences', () => {
    const problems: string[] = [];
    for (const [i, c] of circular.entries()) {
      const reference = { sequence: c.ref, offset: 0, wrap: c.ref.length };
      const prep = prepareReadAlignment(reference, { sequence: c.read, read: null }, null);
      if (!prep.ok) {
        problems.push(`#${String(i)} ${c.kind}: ${prep.message}`);
        continue;
      }
      const res = finishReadAlignment(
        prep.job,
        alignEitherStrand(prep.job.a, prep.job.b, { mode: 'local' }),
      );
      const al = res.alignment;
      const L = c.ref.length;
      const got = {
        score: al.score,
        strand: res.strand,
        start: al.startA % L,
        last: (al.endA - 1) % L,
        regions: regions(al.alignedA, al.alignedB, al.startA, L),
      };
      const want = {
        score: c.score,
        strand: c.strand,
        start: c.start,
        last: c.last,
        regions: c.regions.map((r) => r.join(' ')),
      };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        problems.push(
          `#${String(i)} ${c.kind}: ${JSON.stringify(got).slice(0, 200)} vs ${JSON.stringify(want).slice(0, 200)}`,
        );
      }
    }
    expect(problems).toEqual([]);
    // 50-78 s on CI runners; give a busy one room.
  }, 240_000);
});

/**
 * Read mapping score on a circle against Biopython's local alignment to the
 * reference written twice (scripts/oracle/alignment.py): a tiny circle, half
 * of one, a deletion or an insertion before the origin, a deletion just after
 * it, a tandem repeat across it, and a read longer than the circle. Left out:
 * a read that starts within 15 bases before the origin with a mismatch at the
 * junction, which a banded path can place one copy along (#175).
 */
describe('circular read mapping score on the doubled reference', () => {
  const scored = (oracle as unknown as { circularScores: readonly ScoreCase[] }).circularScores;
  interface ScoreCase {
    readonly kind: string;
    readonly ref: string;
    readonly read: string;
    readonly score: number;
  }

  it('has reads of every kind', () => {
    expect(scored.length).toBeGreaterThanOrEqual(50);
    expect(new Set(scored.map((c) => c.kind)).size).toBe(6);
  });

  it('scores each read as Biopython does and aligns the circle bases it says', () => {
    const problems: string[] = [];
    for (const [i, c] of scored.entries()) {
      const L = c.ref.length;
      const prep = prepareReadAlignment(
        { sequence: c.ref, offset: 0, wrap: L },
        { sequence: c.read, read: null },
        null,
      );
      if (!prep.ok) {
        problems.push(`#${String(i)} ${c.kind}: ${prep.message}`);
        continue;
      }
      const res = finishReadAlignment(
        prep.job,
        alignEitherStrand(prep.job.a, prep.job.b, { mode: 'local' }),
      );
      const al = res.alignment;
      if (Math.abs(al.score - c.score) > 1e-6) {
        problems.push(`#${String(i)} ${c.kind}: score ${String(al.score)} vs ${String(c.score)}`);
      }
      // The aligned reference bases are the circle's, read on from startA.
      let circle = '';
      const aligned = al.alignedA.replace(/-/g, '');
      for (let k = 0; k < aligned.length; k++) circle += c.ref[(al.startA + k) % L] ?? '';
      if (circle.toUpperCase() !== aligned.toUpperCase()) {
        problems.push(`#${String(i)} ${c.kind}: aligned reference is not the circle`);
      }
    }
    expect(problems).toEqual([]);
  }, 240_000);
});

/**
 * The protein effect of one substitution in a read across the origin, in
 * the Align tab's difference table, against Biopython translating the CDS of
 * the plasmid with and without it: a CDS that is a join across the origin,
 * two or four segments, either strand, /codon_start 1 to 3, the plasmid
 * written as GenBank by Biopython. Left out: reads that start within 15 bases
 * before the origin (#175) and insertions just after it (#177).
 */
describe('protein effect across the origin against Biopython translation', () => {
  interface EffectCase {
    readonly loc: string;
    readonly cs: number;
    readonly seq: string;
    readonly genbank: string;
    readonly subs: readonly {
      readonly at: number;
      readonly base: string;
      readonly expected: string;
    }[];
  }
  const effects = (oracle as unknown as { effects: readonly EffectCase[] }).effects;

  it('has joins on both strands and every codon_start', () => {
    expect(effects.length).toBeGreaterThanOrEqual(30);
    expect(effects.reduce((n, c) => n + c.subs.length, 0)).toBeGreaterThanOrEqual(120);
    expect(new Set(effects.map((c) => c.cs)).size).toBe(3);
    expect(effects.some((c) => c.loc.startsWith('rev'))).toBe(true);
  });

  it('reads p.X{n}Y from a read across the origin, forward and reverse complemented', () => {
    const problems: string[] = [];
    for (const [i, c] of effects.entries()) {
      const doc = parseGenBank(c.genbank).documents[0];
      if (doc === undefined) throw new Error('no document');
      const L = c.seq.length;
      const reference = { sequence: c.seq, offset: 0, wrap: L };
      const circle = (text: string, from: number, to: number): string => {
        let out = '';
        for (let k = from; k < to; k++) out += text[((k % L) + L) % L] ?? '';
        return out;
      };
      for (const sub of c.subs) {
        const mutated = c.seq.slice(0, sub.at) + sub.base + c.seq.slice(sub.at + 1);
        const wrapping = circle(mutated, L - 250, L + 250);
        const clean = circle(c.seq, 100, 400);
        for (const [label, read] of [
          ['forward', wrapping],
          ['reverse', reverseComplement(wrapping)],
        ] as const) {
          const reads = [
            { sequence: read, name: 'r0' },
            ...(label === 'forward' ? [{ sequence: clean, name: 'r1' }] : []),
          ];
          const aligned = reads.map(({ sequence, name }) => {
            const prep = prepareReadAlignment(reference, { sequence, read: null }, null);
            if (!prep.ok) throw new Error(prep.message);
            return {
              name,
              result: finishReadAlignment(
                prep.job,
                alignEitherStrand(prep.job.a, prep.job.b, { mode: 'local' }),
              ),
            };
          });
          const stack = stackAlignments(reference, aligned);
          const frames = buildFrames(stack, doc, doc.features, L);
          const rows = differenceRows(
            stack,
            differenceRegions(stack.differences),
            annotationsOf([...doc.features], []),
            frames,
            doc,
            [],
          );
          const hit = rows.filter((r) => r.position === sub.at + 1);
          const got =
            hit.length === 1 && hit[0] !== undefined
              ? effectText(hit[0])
              : `${String(hit.length)} rows`;
          if (got !== sub.expected) {
            problems.push(
              `#${String(i)} ${c.loc} cs${String(c.cs)} ${label} at ${String(sub.at)}: ${got} vs ${sub.expected}`,
            );
          }
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  }, 240_000);
});

/**
 * Where a read across the origin maps, and its score, on a circle
 * (scripts/oracle/alignment.py): 4 kb and 12 kb random circles and one with a
 * tandem repeat across the origin, reads of 600 and 1500 bases starting from
 * 25 bases before the origin to 5 after it, with substitutions, indels or a
 * mismatch next to it, either strand, the whole circle and a little more, and
 * a change exactly at the origin (#175). The score is Biopython's local
 * alignment to the reference written twice; the position is its alignment to
 * the reference rotated to put the read in the middle. Both the single
 * alignment and the batch ("Align all") path must agree. Left out: the
 * document diff (#184).
 */
describe('circular read mapping across the origin, single and batch paths', () => {
  interface ReadCase {
    readonly ref: string;
    readonly read: string;
    readonly kind: string;
    readonly score: number;
    readonly strand: 'forward' | 'reverse';
    readonly position?: readonly number[];
  }
  const data = (
    oracle as unknown as {
      circularReads: { refs: Record<string, string>; cases: readonly ReadCase[] };
    }
  ).circularReads;

  it('has reads near the origin on every circle', () => {
    expect(data.cases.length).toBeGreaterThanOrEqual(200);
    expect(new Set(data.cases.map((c) => c.ref)).size).toBe(3);
    expect(data.cases.filter((c) => c.position !== undefined).length).toBeGreaterThan(150);
  });

  it('scores and places each read as Biopython does', async () => {
    const problems: string[] = [];
    const place = (
      a: {
        startA: number;
        endA: number;
        startB: number;
        endB: number;
      },
      L: number,
    ): string => [((a.startA % L) + L) % L, a.endA - a.startA, a.startB, a.endB].join(',');
    for (const [i, c] of data.cases.entries()) {
      const sequence = data.refs[c.ref] ?? '';
      const L = sequence.length;
      const reference = { sequence, offset: 0, wrap: L };
      const prep = prepareReadAlignment(reference, { sequence: c.read, read: null }, null);
      if (!prep.ok) {
        problems.push(`#${String(i)} ${c.ref}: ${prep.message}`);
        continue;
      }
      const single = finishReadAlignment(
        prep.job,
        alignEitherStrand(prep.job.a, prep.job.b, { mode: 'local', wrap: L }),
      );
      const batch = await runReadBatch(
        [{ name: 'r', sequence: c.read, read: null }],
        reference,
        (a, b, o) => Promise.resolve(alignEitherStrand(a, b, o)),
        { options: { fast: true }, mode: 'local', trimCutoff: null },
      );
      const row = batch.rows[0];
      const results = [
        ['single', single],
        ['batch', row?.status === 'aligned' ? row.result : null],
      ] as const;
      for (const [path, res] of results) {
        if (res === null) {
          problems.push(`#${String(i)} ${c.ref} ${c.kind} ${path}: not aligned`);
          continue;
        }
        if (Math.abs(res.alignment.score - c.score) > 1e-6) {
          problems.push(
            `#${String(i)} ${c.ref} ${c.kind} ${path}: score ${String(res.alignment.score)} vs ${String(c.score)}`,
          );
        } else if (c.position !== undefined && res.strand === c.strand) {
          const got = place(res.alignment, L);
          if (got !== c.position.join(',')) {
            problems.push(
              `#${String(i)} ${c.ref} ${c.kind} ${path}: at ${got} vs ${c.position.join(',')}`,
            );
          }
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  }, 600_000);
});
