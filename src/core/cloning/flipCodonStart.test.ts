import { describe, expect, it } from 'vitest';
import {
  type DigestFragment,
  type Feature,
  type Strand,
  SeqDocument,
  createFeature,
  digest,
  documentFromFragment,
  flipFragment,
  flipWindow,
  rangeSegment,
  reverseComplement,
  translateCds,
} from '@/core';

// A CDS whose frame skips `skip` bases (/codon_start) and reads from a GTG
// start (a start only in table 11, so a partial 5' end reads it as V and a
// whole one as M), then GCC AAA TAA. `lead` and `tail` are plain flank.
const READING = 'GTGGCCAAATAA';
const FLANK = 'TTACGA';

interface Built {
  readonly doc: SeqDocument;
  readonly cds: { start: number; end: number };
}

function build(strand: Strand, skip: number, circular = false): Built {
  const coding = 'C'.repeat(skip) + READING; // forward reading of the whole feature
  const forward = FLANK + coding + FLANK;
  const sequence = strand === 'forward' ? forward : reverseComplement(forward);
  const start = strand === 'forward' ? FLANK.length : FLANK.length;
  const end = start + coding.length;
  const doc = SeqDocument.create({
    name: 'src',
    sequence,
    topology: circular ? 'circular' : 'linear',
    features: [
      createFeature({
        type: 'CDS',
        name: 'g',
        strand,
        segments: [rangeSegment(start, end)],
        qualifiers: [
          { name: 'transl_table', value: '11' },
          ...(skip > 0 ? [{ name: 'codon_start', value: String(skip + 1) }] : []),
        ],
      }),
    ],
  });
  return { doc, cds: { start, end } };
}

function second(fragment: DigestFragment | undefined): DigestFragment {
  if (fragment === undefined) throw new Error('no fragment');
  return fragment;
}

function cdsOf(doc: SeqDocument): Feature {
  const f = doc.features.all().find((x) => x.type === 'CDS');
  if (f === undefined) throw new Error('no CDS');
  return f;
}

function protein(fragment: DigestFragment): { protein: string; feature: Feature } {
  const doc = documentFromFragment(fragment);
  const feature = cdsOf(doc);
  return { protein: translateCds(doc, feature).protein, feature };
}

const CODE: Readonly<Record<string, string>> = { GTG: 'V', GCC: 'A', AAA: 'K', TAA: '*' };

/**
 * What the CDS of a piece should read, from the source alone: the codons of
 * the reading whose three bases are all in the piece's annotated window (the
 * fragment's own top strand, narrowed to the new top strand when turned
 * over), the first of them `M` only when it is the CDS's real start codon.
 */
function expectedProtein(
  skip: number,
  strand: Strand,
  cds: Built['cds'],
  from: number,
  to: number,
) {
  const reading: number[] = [];
  for (let i = 0; i < skip + READING.length; i++) {
    reading.push(strand === 'forward' ? cds.start + i : cds.end - 1 - i);
  }
  const present = (i: number): boolean => {
    const p = reading[i];
    return p !== undefined && p >= from && p < to;
  };
  let out = '';
  for (let i = skip; i + 3 <= reading.length; i += 3) {
    if (!present(i) || !present(i + 1) || !present(i + 2)) {
      if (out !== '') break;
      continue;
    }
    out += i === skip ? 'M' : (CODE[READING.slice(i - skip, i - skip + 3)] ?? '?');
  }
  return out;
}

function expectedFor(
  fragment: DigestFragment,
  flipped: boolean,
  skip: number,
  strand: Strand,
  cds: Built['cds'],
) {
  const { head, tail, trimStart, trimEnd } = flipWindow(fragment);
  const lo = fragment.range.start;
  const hi = fragment.range.end;
  // The annotated bases are the fragment's top strand; turned over, only those
  // that are still in the new top strand.
  const from = flipped ? Math.max(lo, lo - head.length + trimStart) : lo;
  const to = flipped ? Math.min(hi, hi + tail.length - trimEnd) : hi;
  return expectedProtein(skip, strand, cds, from, to);
}

describe('a CDS cut so that only its /codon_start skip bases go (#186)', () => {
  it('keeps its start codon and first residue when the piece is turned over', () => {
    const { doc, cds } = build('forward', 1);
    // Top strand cut at the CDS start, bottom strand one base in: a 1-base 5' overhang.
    const [, right] = digest(doc, [
      {
        enzyme: 'X',
        cut: cds.start,
        cutBottom: cds.start + 1,
        siteStart: cds.start,
        strand: 'forward',
      },
    ]);
    const flipped = flipFragment(second(right));
    const got = protein(flipped);
    expect(got.protein).toBe('MAK*');
    expect(got.feature.segments.every((s) => s.kind === 'range' && !s.partialStart)).toBe(true);
  });

  it('still marks a CDS cut into its reading partial, and keeps one that was partial', () => {
    const { doc, cds } = build('forward', 1);
    // The skip base and one base of the reading go.
    const [, right] = digest(doc, [
      {
        enzyme: 'X',
        cut: cds.start + 2,
        cutBottom: cds.start + 5,
        siteStart: cds.start,
        strand: 'forward',
      },
    ]);
    const got = protein(second(right));
    expect(got.protein).toBe('AK*');
    expect(got.feature.segments[0]).toMatchObject({ partialStart: true });
    const partial = SeqDocument.create({
      name: 'p',
      sequence: doc.sequence.toString(),
      topology: 'linear',
      features: [
        {
          ...cdsOf(doc),
          segments: [rangeSegment(cds.start, cds.end, { partialStart: true })],
        },
      ],
    });
    const [, rightOfPartial] = digest(partial, [
      {
        enzyme: 'X',
        cut: cds.start,
        cutBottom: cds.start + 1,
        siteStart: cds.start,
        strand: 'forward',
      },
    ]);
    // turned over, the CDS reads from the other end
    const kept = protein(flipFragment(second(rightOfPartial)));
    expect(kept.protein).toBe('VAK*');
    expect(kept.feature.segments[0]).toMatchObject({ partialEnd: true });
  });
});

describe('a cut fragment, turned over or not, reads its CDS in frame (#186)', () => {
  const failures: string[] = [];
  let checked = 0;
  for (const strand of ['forward', 'reverse'] as const) {
    for (const skip of [0, 1, 2]) {
      const { doc, cds } = build(strand, skip);
      const edges = [cds.start, cds.end];
      for (const edge of edges) {
        for (let d = -4; d <= 4; d++) {
          for (let ov = -3; ov <= 3; ov++) {
            const cut = edge + d;
            const site = {
              enzyme: 'X',
              cut,
              cutBottom: cut - ov,
              siteStart: cut,
              strand: 'forward' as const,
            };
            let fragments: DigestFragment[];
            try {
              fragments = digest(doc, [site]);
            } catch {
              continue;
            }
            for (const fragment of fragments) {
              for (const flipped of [false, true]) {
                const piece = flipped ? flipFragment(fragment) : fragment;
                const cdsFeature = piece.features.find((f) => f.type === 'CDS');
                const want = expectedFor(fragment, flipped, skip, strand, cds);
                if (cdsFeature === undefined) {
                  if (want !== '')
                    failures.push(
                      `${strand} cs${skip + 1} cut ${cut} ov ${ov} flip ${flipped}: CDS gone`,
                    );
                  continue;
                }
                checked++;
                const got = protein(piece).protein;
                const n = want.length;
                // a trailing part-codon may read as one more residue
                if (got.slice(0, n) !== want || got.length > n + 1) {
                  failures.push(
                    `${strand} cs${skip + 1} cut ${cut} ov ${ov} flip ${flipped}: got ${got} want ${want}`,
                  );
                }
              }
            }
          }
        }
      }
    }
  }
  it('matches the codons of the source in every cut, overhang and orientation', () => {
    expect(checked).toBeGreaterThan(500);
    expect(failures).toEqual([]);
  });
});

describe('a circular source cut across its origin (#186)', () => {
  it('keeps the start codon when the skip base is the only part taken, turned over or not', () => {
    for (const strand of ['forward', 'reverse'] as const) {
      const { doc: linear } = build(strand, 1);
      // Rotate so that the CDS's low end sits just past the origin and its
      // high end before it: the CDS runs across the origin.
      const L = linear.sequence.length;
      const rotate = 5;
      const seq = linear.sequence.toString();
      const rotated = seq.slice(rotate) + seq.slice(0, rotate);
      const start = (FLANK.length - rotate + L) % L;
      const end = start + 1 + READING.length;
      const doc = SeqDocument.create({
        name: 'c',
        sequence: rotated,
        topology: 'circular',
        features: [
          createFeature({
            type: 'CDS',
            name: 'g',
            strand,
            segments: [rangeSegment(start, end)],
            qualifiers: [
              { name: 'transl_table', value: '11' },
              { name: 'codon_start', value: '2' },
            ],
          }),
        ],
      });
      // Cut just inside the skip base on the reading's own side, 1-base 5'
      // overhang, and at the far side of the circle so the piece spans the origin.
      const cut = strand === 'forward' ? start : end - 1;
      const other = (cut + 20) % L;
      for (const ov of [-1, 1]) {
        const sites = [cut, other].map((c) => ({
          enzyme: 'X',
          cut: c,
          cutBottom: (c - ov + L) % L,
          siteStart: c,
          strand: 'forward' as const,
        }));
        for (const fragment of digest(doc, sites)) {
          for (const flipped of [false, true]) {
            const piece = flipped ? flipFragment(fragment) : fragment;
            if (!piece.features.some((f) => f.type === 'CDS')) continue;
            const got = protein(piece).protein;
            expect(got.replace(/.$/, '')).toMatch(/^[MV]?A?K?\*?$/);
            if (got.length >= 3) expect(got.startsWith('M') || got.startsWith('V')).toBe(true);
          }
        }
      }
    }
  });
});
