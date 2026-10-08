import fc from 'fast-check';

import { SeqDocument } from '../document';
import { type Segment, createFeature, rangeSegment } from '../features';
import { diffDocuments } from './documentDiff';

/**
 * A feature's edges, every segment's included, are placed by one reading of
 * the diff at a time (#189). An indel in a repeat can be drawn at any point
 * along it, and the diff accepts a feature wherever one of those drawings
 * carries it — but a start read under one drawing and an end under another
 * is a feature no editor kept.
 */

/** Bases from a fixed seed, so a test's sequence is the same every run. */
function bases(n: number, seed: number): string {
  let s = seed;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((s >> 16) & 3);
  }
  return out;
}

function withFeature(
  sequence: string,
  segments: readonly (readonly [number, number])[],
  topology: 'linear' | 'circular' = 'linear',
  id?: string,
): SeqDocument {
  return SeqDocument.create({
    sequence,
    topology,
    features: [
      createFeature({
        ...(id === undefined ? {} : { id }),
        type: 'misc_feature',
        name: 'f',
        segments: segments.map(([start, end]) => rangeSegment(start, end)),
      }),
    ],
  });
}

const only = (doc: SeqDocument): string => [...doc.features][0]?.id ?? '';

/** Whether `after`, the sequence of `edited` with the feature at `segments`, reads as changed. */
function changed(
  base: SeqDocument,
  edited: SeqDocument,
  segments: readonly (readonly [number, number])[],
): boolean {
  const moved = edited.updateFeature(only(edited), {
    segments: segments.map(([start, end]) => rangeSegment(start, end)),
  });
  return diffDocuments(base, moved).featuresChanged.has(only(edited));
}

/** Every single-segment location in `[lo, hi]` the diff calls unchanged. */
function accepted(base: SeqDocument, edited: SeqDocument, lo: number, hi: number): string[] {
  const out: string[] = [];
  for (let s = lo; s < hi; s++) {
    for (let e = s + 1; e <= hi; e++) if (!changed(base, edited, [[s, e]])) out.push(`${s}-${e}`);
  }
  return out;
}

describe('one reading for a whole feature (#189)', () => {
  it('reports a feature hand-moved after one copy of a duplicate was deleted', () => {
    const copy = bases(300, 3);
    const base = withFeature(bases(100, 5) + copy + copy + bases(100, 6), [[350, 450]]);
    const edited = base.delete({ start: 400, end: 700 });
    expect(edited.getFeature(only(base))?.segments).toEqual([rangeSegment(350, 400)]);
    expect(changed(base, edited, [[350, 400]])).toBe(false);
    // Its start read as if the other copy went, its end as if this one did.
    expect(changed(base, edited, [[150, 401]])).toBe(true);
  });

  it('reports it in a compare of two files too, where ids do not pair', () => {
    const copy = bases(300, 3);
    const a = bases(100, 5) + copy + copy + bases(100, 6);
    const b = a.slice(0, 400) + a.slice(700);
    const diff = diffDocuments(withFeature(a, [[350, 450]]), withFeature(b, [[150, 401]]));
    expect(diff.featuresAdded.size).toBe(1);
    expect(diff.featuresRemoved.size).toBe(1);
  });

  it('accepts exactly the places the deleted copy could have been drawn or overwritten', () => {
    const copy = bases(30, 3);
    const base = withFeature(bases(40, 5) + copy + copy + bases(40, 6), [[55, 85]]);
    const edited = base.delete({ start: 70, end: 100 });
    // Deleting at d in [40, 70] leaves [d, 55) or [55, d); replacing the
    // copy and up to 8 bases after it by those bases leaves [55, 71..78).
    const expected = [
      ...Array.from({ length: 15 }, (_, i) => `${40 + i}-55`),
      ...Array.from({ length: 23 }, (_, i) => `55-${56 + i}`),
    ];
    expect(accepted(base, edited, 30, 110)).toEqual(expected);
  });

  it('does not grow a feature by a base deleted from a homopolymer', () => {
    const base = withFeature(`GCTAGC${'A'.repeat(20)}GCTTGC`, [[10, 20]]);
    const edited = base.delete({ start: 15, end: 16 });
    expect(accepted(base, edited, 0, 31)).toEqual(['9-19', '10-19', '10-20']);
  });

  it('reads every segment of a join under the same drawing', () => {
    const base = withFeature(`GCTAGC${'A'.repeat(20)}GCTTGC`, [
      [10, 14],
      [18, 24],
    ]);
    const edited = base.delete({ start: 15, end: 16 });
    expect(
      changed(base, edited, [
        [10, 14],
        [17, 23],
      ]),
    ).toBe(false);
    // The first segment as if the A went before it, the second as if after it.
    expect(
      changed(base, edited, [
        [9, 13],
        [18, 24],
      ]),
    ).toBe(true);
  });

  it('does not read an insertion as overwritten for one edge and inserted for the other', () => {
    const base = withFeature(bases(40, 9), [[0, 8]]);
    const edited = base.insert(0, 'GAG');
    expect(edited.getFeature(only(base))?.segments).toEqual([rangeSegment(3, 11)]);
    expect(changed(base, edited, [[3, 11]])).toBe(false);
    expect(changed(base, edited, [[3, 8]])).toBe(true);
  });

  it('does not shrink a feature at the origin to the bases an insertion slid past', () => {
    const base = withFeature('GGGCCGACGA', [[0, 4]], 'circular');
    const edited = base.insert(6, 'ACG');
    expect(edited.getFeature(only(base))?.segments).toEqual([rangeSegment(0, 4)]);
    expect(changed(base, edited, [[0, 4]])).toBe(false);
    expect(changed(base, edited, [[0, 1]])).toBe(true);
  });

  it('does not place an end past the end of the sequence', () => {
    const base = withFeature(`AGAGTCAG${'T'.repeat(11)}`, [[14, 19]], 'circular');
    const edited = base.replace({ start: 15, end: 19 }, 'GCG');
    expect(edited.getFeature(only(base))?.segments).toEqual([rangeSegment(14, 18)]);
    expect(changed(base, edited, [[14, 18]])).toBe(false);
    expect(changed(base, edited, [[14, 19]])).toBe(true);
  });
});

describe('a replace by shorter text (#190)', () => {
  it.each([
    // In a repeat the diff draws the edit away from the origin, with no
    // stretch either side of it to merge.
    ['TTCGTTCGTTCG', 8, 13, 'C', [[0, 6]], [[0, 5]]],
    ['ACCACCCCCCCCCCC', 14, 18, '', [[10, 14]], [[7, 11]]],
    ['GGCGGCGGCATAGGGGG', 14, 20, 'C', [[13, 21]], [[10, 13]]],
    [
      'TTTTTTTTTTTTT',
      9,
      16,
      'T',
      [
        [2, 5],
        [6, 10],
      ],
      [
        [0, 2],
        [3, 7],
      ],
    ],
    // The A is overwritten by C where the diff only deletes.
    ['GGGGGGGGCGCACGC', 11, 16, 'C', [[11, 12]], [[10, 11]]],
  ] as const)(
    'keeps a feature through %s with [%i, %i) replaced over the origin by "%s"',
    (sequence, start, end, text, before, after) => {
      const base = withFeature(sequence, before, 'circular');
      const edited = base.replace({ start, end }, text);
      expect(edited.getFeature(only(base))?.segments).toEqual(
        after.map(([s, e]) => rangeSegment(s, e)),
      );
      expect(changed(base, edited, after)).toBe(false);
    },
  );

  it('keeps every feature of a poly-A circle through a deletion over its origin', () => {
    const base = SeqDocument.create({
      sequence: 'A'.repeat(200),
      topology: 'circular',
      features: Array.from({ length: 18 }, (_, i) =>
        createFeature({
          type: 'misc_feature',
          name: `f${i}`,
          segments: [rangeSegment(15 + i * 10, 20 + i * 10)],
        }),
      ),
    });
    const edited = base.delete({ start: 190, end: 215 });
    expect(diffDocuments(base, edited).featuresChanged.size).toBe(0);
  });

  it('keeps a feature over the origin through a replace there outside a repeat', () => {
    const sequence = bases(40, 11);
    const base = withFeature(sequence, [[30, 44]], 'circular');
    const edited = base.replace({ start: 36, end: 43 }, 'GA');
    const kept = edited.getFeature(only(base))?.segments[0];
    expect(kept?.kind).toBe('range');
    if (kept?.kind !== 'range') return;
    expect(changed(base, edited, [[kept.start, kept.end]])).toBe(false);
    expect(changed(base, edited, [[kept.start, kept.end - 1]])).toBe(true);
    expect(changed(base, edited, [[kept.start + 1, kept.end]])).toBe(true);
  });

  it.each([
    ['ATTATTATTAATATATATGGGGGG', 17, 20, 'G', [[19, 24]], [[18, 22]]],
    [
      'ACCGCAAACTTGACA',
      0,
      4,
      'CG',
      [
        [1, 3],
        [4, 5],
      ],
      [
        [1, 2],
        [2, 3],
      ],
    ],
  ] as const)(
    'keeps a feature in %s with [%i, %i) overwritten by "%s"',
    (sequence, start, end, text, before, after) => {
      const base = withFeature(sequence, before);
      const edited = base.replace({ start, end }, text);
      expect(edited.getFeature(only(base))?.segments).toEqual(
        after.map(([s, e]) => rangeSegment(s, e)),
      );
      expect(changed(base, edited, after)).toBe(false);
    },
  );
});

/** Where the editor puts each feature for every single replace that turns `base` into `b`. */
function reachable(base: SeqDocument, b: string): Set<string> {
  const a = base.sequence.toString();
  const out = new Set<string>();
  for (let start = 0; start <= a.length && a.slice(0, start) === b.slice(0, start); start++) {
    for (let end = start; end <= a.length; end++) {
      const textEnd = b.length - (a.length - end);
      if (textEnd < start || a.slice(end) !== b.slice(textEnd)) continue;
      const text = b.slice(start, textEnd);
      if (end === start && text === '') continue;
      for (const f of base.replace({ start, end }, text).features) out.add(key(f.segments));
    }
  }
  return out;
}

const key = (segments: readonly Segment[]): string =>
  JSON.stringify(segments.map((s) => (s.kind === 'range' ? [s.start, s.end] : [s.position])));

/** A sequence of short repeats, where an indel can be drawn in many places. */
const repeatsArb = fc
  .array(fc.tuple(fc.stringMatching(/^[ACGT]{1,3}$/), fc.integer({ min: 1, max: 4 })), {
    minLength: 3,
    maxLength: 8,
  })
  .map((runs) => runs.map(([unit, times]) => unit.repeat(times)).join(''))
  .filter((s) => s.length >= 8 && s.length <= 30);

describe('one reading for a whole feature, at random (#189)', () => {
  it('calls a location next to an indel in a repeat unchanged only where an editor could have put it', () => {
    fc.assert(
      fc.property(
        repeatsArb,
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.boolean(),
        fc.integer({ min: 1, max: 4 }),
        (sequence, f, g, at, insert, n) => {
          const length = sequence.length;
          const start = f % (length - 1);
          const end = start + 1 + (g % (length - start - 1));
          const base = withFeature(sequence, [[start, end]]);
          const p = at % length;
          // An indel of a copy of the bases there, so it can slide.
          const edited = insert
            ? base.insert(p, sequence.slice(p, p + n) || 'A')
            : base.delete({ start: p, end: Math.min(length, p + n) });
          const b = edited.sequence.toString();
          if (b === sequence || b.length < 2) return;
          const kept = edited.getFeature(only(base));
          if (kept?.segments[0]?.kind !== 'range') return;
          const reach = reachable(base, b);
          const s0 = kept.segments[0].start;
          const e0 = kept.segments[0].end;
          for (let ds = -3; ds <= 3; ds++) {
            for (let de = -3; de <= 3; de++) {
              const s = s0 + ds;
              const e = e0 + de;
              if (s < 0 || e <= s || e > b.length) continue;
              if (!changed(base, edited, [[s, e]]))
                expect(reach).toContain(key([rangeSegment(s, e)]));
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('a replace by shorter text, at random (#190)', () => {
  const replaceArb = fc.record({
    sequence: repeatsArb,
    circular: fc.boolean(),
    f: fc.nat(),
    g: fc.nat(),
    at: fc.nat(),
    length: fc.integer({ min: 1, max: 8 }),
    // Kept bases of the selection, or new ones: a replace by shorter text.
    text: fc.oneof(fc.nat(), fc.stringMatching(/^[ACGT]{0,3}$/)),
  });

  it('keeps every feature where the editor put it, over the origin too', () => {
    fc.assert(
      fc.property(replaceArb, ({ sequence, circular, f, g, at, length, text }) => {
        const n = sequence.length;
        const start = f % (n - 1);
        const end = start + 1 + (g % (n - start - 1));
        const base = withFeature(sequence, [[start, end]], circular ? 'circular' : 'linear');
        const from = at % n;
        const to = circular ? from + length : Math.min(n, from + length);
        const selected = (sequence + sequence).slice(from, to);
        const by = typeof text === 'number' ? selected.slice(0, text % selected.length) : text;
        if (by.length >= to - from) return;
        const edited = base.replace({ start: from, end: to }, by);
        if (edited.length < 2) return;
        const kept = edited.getFeature(only(base));
        const diff = diffDocuments(base, edited);
        // A short sequence mostly replaced may read better reverse-complemented.
        if (kept === undefined || diff.reversed) return;
        expect(diff.featuresChanged.has(kept.id)).toBe(false);
      }),
      { numRuns: 3000 },
    );
  });

  // With new bases the diff as drawn can keep a base the editor overwrote,
  // which no single replace gives; keeping the selection's first bases, every
  // drawing is a deletion and some editor's.
  it('calls a location next to an overwrite by kept bases unchanged only where an editor could have put it', () => {
    fc.assert(
      fc.property(replaceArb, ({ sequence, f, g, at, length, text }) => {
        const n = sequence.length;
        const start = f % (n - 1);
        const end = start + 1 + (g % (n - start - 1));
        const base = withFeature(sequence, [[start, end]]);
        const from = at % n;
        const to = Math.min(n, from + length);
        const selected = sequence.slice(from, to);
        if (typeof text !== 'number') return;
        const by = selected.slice(0, text % selected.length);
        const edited = base.replace({ start: from, end: to }, by);
        const kept = edited.getFeature(only(base))?.segments[0];
        if (kept?.kind !== 'range' || edited.length < 2) return;
        if (diffDocuments(base, edited).reversed) return;
        const reach = reachable(base, edited.sequence.toString());
        for (let ds = -3; ds <= 3; ds++) {
          for (let de = -3; de <= 3; de++) {
            const s = kept.start + ds;
            const e = kept.end + de;
            if (s < 0 || e <= s || e > edited.length) continue;
            if (!changed(base, edited, [[s, e]]))
              expect(reach).toContain(key([rangeSegment(s, e)]));
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('a lengthening edit near the origin of a circle (#191)', () => {
  // An overwrite that added bases reaches over the origin only as the editor
  // does it: the bases it adds go right after the origin, so one that ends
  // there puts them at 0, and one the diff drew at the end of the sequence
  // added none at 0.
  it.each([
    ['CACACACACAGGCATTTTTT', 'T', 18, [7, 17], [[6, 17]]],
    ['GAATGAATCCC', 'G', 3, [0, 11], [[0, 11]]],
  ] as const)(
    'calls a feature moved off the editor’s place changed after %s gains "%s" at %i',
    (sequence, text, at, before, moved) => {
      const base = withFeature(sequence, [before], 'circular');
      const edited = base.insert(at, text);
      const kept = edited.getFeature(only(base))?.segments[0];
      expect(kept?.kind).toBe('range');
      if (kept?.kind !== 'range') return;
      expect(changed(base, edited, [[kept.start, kept.end]])).toBe(false);
      for (const segment of moved) expect(changed(base, edited, [segment])).toBe(true);
    },
  );
});

describe('a replace the refined diff draws as a base deleted between insertions (#192)', () => {
  // The affine re-alignment may draw a replace as bases inserted, the old
  // base deleted, and more inserted. The editor overwrites the selection
  // from its first base, so the deleted base is drawn where the first of
  // those insertions starts, not where the next one does.
  it.each([
    ['GCCTGCCTAGAGAGAGCGTAAGCC', 'linear', 12, 13, 'CGAT', [[12, 14]], [[15, 17]]],
    [
      'TTTTTTTGCGTGG',
      'linear',
      6,
      8,
      'ACTCC',
      [
        [2, 3],
        [6, 11],
      ],
      [
        [2, 3],
        [9, 14],
      ],
    ],
    [
      'TATATATAGGAGCGAGCGAGCGATTATT',
      'linear',
      12,
      14,
      'CCGCT',
      [
        [13, 15],
        [17, 18],
      ],
      [
        [16, 18],
        [20, 21],
      ],
    ],
    [
      'ATAATAATACCA',
      'circular',
      0,
      1,
      'CAT',
      [
        [0, 1],
        [2, 5],
      ],
      [
        [2, 3],
        [4, 7],
      ],
    ],
  ] as const)(
    'calls the feature changed off the editor’s place after %s (%s) has [%i, %i) replaced by %s',
    (sequence, topology, start, end, text, before, moved) => {
      const base = withFeature(sequence, before, topology);
      const edited = base.replace({ start, end }, text);
      const kept = edited.getFeature(only(base))?.segments ?? [];
      const segments = kept.map((s) =>
        s.kind === 'range' ? ([s.start, s.end] as const) : ([0, 0] as const),
      );
      expect(changed(base, edited, segments)).toBe(false);
      expect(changed(base, edited, moved)).toBe(true);
    },
  );
});

describe('a replace over the origin of a circle that leaves a few bases untouched (#193)', () => {
  // With no more than MERGE_GAP equal bases between any two edits the circle
  // is one stretch all round. The editor's selection starts after the bases
  // it left, wherever the diff cut the circle.
  it.each([
    ['TTCTATATA', 8, 13, 'CAG', [1, 3], [2, 3]],
    ['GCGCCGCTT', 8, 15, 'CCG', [5, 7], [3, 4]],
    ['ATGGCA', 4, 9, 'TTTT', [2, 5], [3, 4]],
    ['GGGGGCCCCC', 9, 12, 'TTTTG', [1, 7], [2, 9]],
    ['GCAAAATTTTCC', 4, 13, 'GAGAGAATTTT', [4, 10], [7, 12]],
  ] as const)(
    'keeps the feature where the editor put it after %s has [%i, %i) replaced by %s',
    (sequence, start, end, text, before, moved) => {
      const base = withFeature(sequence, [before], 'circular');
      const edited = base.replace({ start, end }, text);
      const kept = edited.getFeature(only(base))?.segments[0];
      expect(kept?.kind).toBe('range');
      if (kept?.kind !== 'range') return;
      expect(changed(base, edited, [[kept.start, kept.end]])).toBe(false);
      expect(changed(base, edited, [moved])).toBe(true);
    },
  );
});

describe('a replace over the origin of a circle drawn elsewhere along a repeat (#195)', () => {
  // The editor leaves the origin where it was when its overwrite runs past
  // it, but a repeat lets the diff draw the edit flush against the origin or
  // at the other end of the run. The #190 property test found the last case.
  it.each([
    ['TTTTTTTTTTT', 9, 13, 'GCT', [1, 3], [4, 7]],
    ['GGGGGGGG', 6, 10, 'CTG', [1, 3], [4, 7]],
    ['AAAAAAAAATC', 9, 13, 'CAA', [1, 3], [4, 7]],
    ['ACACACTTTTTTTTTTTG', 16, 24, 'CGT', [0, 1], [1, 2]],
    ['CAAAAAAA', 3, 9, 'TTGAGGCA', [1, 4], [2, 6]],
    ['GGGGGGCC', 4, 9, 'TTGGGGG', [4, 5], [7, 8]],
    ['CCCCCCCCCAA', 5, 12, 'ATGGGGGG', [5, 8], [7, 10]],
    // The whole circle, none of it left untouched.
    ['GGGTTTTA', 7, 15, 'GGA', [1, 3], [2, 3]],
  ] as const)(
    'keeps the feature where the editor put it after %s has [%i, %i) replaced by %s',
    (sequence, start, end, text, before, moved) => {
      const base = withFeature(sequence, [before], 'circular');
      const edited = base.replace({ start, end }, text);
      const kept = edited.getFeature(only(base))?.segments[0];
      expect(kept?.kind).toBe('range');
      if (kept?.kind !== 'range') return;
      expect(changed(base, edited, [[kept.start, kept.end]])).toBe(false);
      expect(changed(base, edited, [moved])).toBe(true);
    },
  );
});

describe('a stretch the diff drew over the origin of a circle (#196)', () => {
  // Edits either side of the origin merge into one stretch over it, read as
  // an overwrite like any other. One that lost bases deletes over the origin,
  // which moves it, and one that gained bases adds them past it: the
  // overwrite as drawn leaves neither, so it no longer reads as one.
  it.each([
    ['AACTAACTAACTCCCATCTCA', 17, 22, 'A', [0, 8], [1, 7]],
    ['AACTAACTAACTCCCATCTCA', 17, 22, 'A', [0, 18], [1, 17]],
    ['TTTTTTTTTCCCCATCAAAAGA', 20, 25, 'G', [0, 22], [1, 19]],
    ['TTATTATTAAAGAGAGGCGCGCGC', 20, 25, 'A', [0, 24], [1, 21]],
    ['GTAGGTAG', 7, 10, 'TTTTA', [0, 8], [0, 8]],
  ] as const)(
    'keeps the feature where the editor put it after %s has [%i, %i) replaced by %s',
    (sequence, start, end, text, before, moved) => {
      const base = withFeature(sequence, [before], 'circular');
      const edited = base.replace({ start, end }, text);
      const kept = edited.getFeature(only(base))?.segments[0];
      expect(kept?.kind).toBe('range');
      if (kept?.kind !== 'range') return;
      expect(changed(base, edited, [[kept.start, kept.end]])).toBe(false);
      expect(changed(base, edited, [moved])).toBe(true);
    },
  );

  // Two replaces, as the diff draws them, put the feature there: a reading of
  // the diff as drawn, kept by design like #194.
  it.each([
    [
      'GGCCACACACACTTTTTTTT',
      5,
      9,
      'TCC',
      [
        [6, 8],
        [11, 12],
      ],
      [
        [6, 7],
        [10, 11],
      ],
    ],
    [
      'GCATCTCACACACAA',
      7,
      11,
      'TGTAA',
      [
        [4, 6],
        [9, 10],
      ],
      [
        [4, 6],
        [10, 11],
      ],
    ],
  ] as const)(
    'reads %s with [%i, %i) replaced by %s as two replaces',
    (sequence, start, end, text, before, drawn) => {
      const base = withFeature(sequence, before, 'linear');
      const edited = base.replace({ start, end }, text);
      expect(changed(base, edited, drawn)).toBe(false);
    },
  );
});

describe('a range that lost every base at the end of a circle (#197)', () => {
  // Both its edges land at the new length, the origin: on a circle that is
  // either nothing or the whole circle, and only an overwrite over the origin
  // (#196) makes the whole circle of one. A range whose bases were all
  // deleted is gone, and the whole circle is not where the editor put it.
  const a = bases(1000, 197);
  const repeat = bases(200, 1970) + 'CG'.repeat(150);
  it.each([
    ['its bases deleted', a, [[900, 1000]], 900, 1000, [[0, 900]]],
    ['more than its bases deleted', a, [[950, 1000]], 900, 1000, [[0, 900]]],
    [
      'one segment of a join',
      a,
      [
        [100, 200],
        [900, 1000],
      ],
      900,
      1000,
      [
        [100, 200],
        [0, 900],
      ],
    ],
    ['a 4 bp circle', 'ACGA', [[3, 4]], 2, 4, [[0, 2]]],
    ['a deletion a repeat lets the diff draw over it', repeat, [[400, 500]], 250, 350, [[0, 400]]],
  ] as const)(
    'does not read the whole circle as unchanged: %s',
    (_, sequence, before, start, end, after) => {
      const id = 'x';
      const base = withFeature(sequence, before, 'circular', id);
      const edited = base.delete({ start, end });
      const whole = withFeature(edited.sequence.toString(), after, 'circular', id);
      expect(diffDocuments(base, whole).featuresChanged.has(id)).toBe(true);
      // Parsed separately, with ids of their own, it is a removal and an addition.
      const fresh = withFeature(edited.sequence.toString(), after, 'circular');
      const compared = diffDocuments(base, fresh);
      expect(compared.featuresRemoved.size + compared.featuresChanged.size).toBe(1);
    },
  );

  it('still reads the editor result in the repeat as unchanged', () => {
    const base = withFeature(repeat, [[400, 500]], 'circular');
    const edited = base.delete({ start: 250, end: 350 });
    expect(edited.getFeature(only(base))?.segments).toMatchObject([{ start: 300, end: 400 }]);
    expect(diffDocuments(base, edited).featuresChanged.size).toBe(0);
  });

  it('says a removed feature was at the origin, not past the end', () => {
    const base = withFeature(a, [[900, 1000]], 'circular');
    const edited = base.delete({ start: 900, end: 1000 });
    const removed = diffDocuments(base, edited).featuresRemoved.get(only(base));
    expect(removed?.segments).toMatchObject([{ start: 0, end: 0 }]);
  });
});

describe('a feature round the whole circle after an edit (#198)', () => {
  // The editor keeps a feature that covers the whole circle round the whole
  // circle under every edit, from wherever it starts, so it is unchanged only
  // at a location that covers the whole new circle.
  const a = bases(1000, 198);
  it.each([
    [[6, 1006], 0, 300],
    [[6, 1006], 0, 1],
    [[500, 1500], 495, 300],
    [[500, 1500], 500, 50],
    [[3, 1003], 0, 200],
  ] as const)('keeps [%j] whole after inserting at %i (%i bp)', (before, at, n) => {
    const base = withFeature(a, [before], 'circular');
    const edited = base.insert(at, bases(n, 1980 + n));
    const kept = edited.getFeature(only(base))?.segments[0];
    if (kept?.kind !== 'range') throw new Error('expected a range');
    expect(kept.end - kept.start).toBe(1000 + n);
    expect(changed(base, edited, [[kept.start, kept.end]])).toBe(false);
    // The old length, from the same start or the end's, is not the whole circle.
    expect(changed(base, edited, [[kept.start, kept.end - n]])).toBe(true);
    expect(changed(base, edited, [[kept.start + n, kept.end]])).toBe(true);
  });

  it('reads an insertion slid onto the origin as moving the whole circle, never shortening it', () => {
    const sequence = 'G' + bases(999, 1981).replace(/^G+/, 'A');
    const base = withFeature(sequence, [[0, 1000]], 'circular');
    const text = 'T'.repeat(299) + 'G';
    const edited = base.insert(1, text);
    expect(edited.getFeature(only(base))?.segments).toMatchObject([{ start: 0, end: 1300 }]);
    expect(changed(base, edited, [[0, 1300]])).toBe(false);
    expect(changed(base, edited, [[300, 1300]])).toBe(true);
    // The same sequence comes of inserting G and the Ts at the origin, which
    // moves the whole circle's start past them: a reading, as for #194.
    const atOrigin = base.insert(0, 'G' + 'T'.repeat(299));
    expect(atOrigin.sequence.toString()).toBe(edited.sequence.toString());
    expect(atOrigin.getFeature(only(base))?.segments).toMatchObject([{ start: 300, end: 1600 }]);
    expect(changed(base, edited, [[300, 1600]])).toBe(false);
  });

  it("rejects the #194 repro's shortened circle but keeps its shifted one", () => {
    const base = withFeature('AACCAAAAACC', [[0, 11]], 'circular');
    const edited = base.replace({ start: 9, end: 14 }, 'TACCAAC');
    expect(edited.getFeature(only(base))?.segments).toMatchObject([{ start: 0, end: 13 }]);
    expect(changed(base, edited, [[0, 13]])).toBe(false);
    expect(changed(base, edited, [[2, 15]])).toBe(false);
    expect(changed(base, edited, [[2, 13]])).toBe(true);
  });

  it('says a changed whole circle was round the whole new circle', () => {
    const base = withFeature(a, [[6, 1006]], 'circular');
    const edited = base.insert(0, bases(300, 1982));
    const moved = edited.updateFeature(only(base), { segments: [rangeSegment(306, 1306)] });
    const was = diffDocuments(base, moved).featuresChanged.get(only(base));
    expect(was?.segments).toMatchObject([{ start: 306, end: 1606 }]);
  });
});
