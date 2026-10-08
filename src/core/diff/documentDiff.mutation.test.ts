import { SeqDocument } from '../document';
import { type Feature, createFeature, rangeSegment, siteSegment } from '../features';
import { EMPTY_DIFF, diffDocuments, isEmptyDiff } from './documentDiff';

// Tests written against the survivors of a mutation run (item 50): each one
// pins a decision the ordinary tests left free to change.

/** Deterministic bases with no 20-mer that turns up twice by chance. */
function bases(length: number, seed = 7): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    out += 'ACGT'.charAt((x >> 16) % 4);
  }
  return out;
}

const OTHER: Record<string, string> = { A: 'C', C: 'G', G: 'T', T: 'A' };

/** `s` with the bases at `positions` each swapped for another. */
function mutate(s: string, positions: readonly number[]): string {
  return Array.from(s, (c, i) => (positions.includes(i) ? (OTHER[c] ?? c) : c)).join('');
}

function reverseComplement(s: string): string {
  return SeqDocument.create({ name: 'x', sequence: s }).reverseComplement().sequence.toString();
}

function linear(sequence: string, features: Feature[] = [], name = 'test'): SeqDocument {
  return SeqDocument.create({ name, sequence, topology: 'linear', features });
}

function misc(id: string, name: string, start: number, end: number): Feature {
  return createFeature({ id, type: 'misc_feature', name, segments: [rangeSegment(start, end)] });
}

describe('diffDocuments, when the molecule may have been turned over', () => {
  // A palindrome reads the same on both strands; changing a base or two in
  // its first half gives a molecule close to, but not the same as, its own
  // reverse complement.
  const HALF = 'ATGACCATGATTACGCCAAG';
  const PALINDROME = HALF + reverseComplement(HALF); // 40 bases

  it('returns the very same empty diff for one document against itself', () => {
    const d = linear(PALINDROME);
    expect(diffDocuments(d, d)).toBe(EMPTY_DIFF);
  });

  it('does not look for a turn when less than half of the molecule differs', () => {
    // Forward, two bases differ; turned over, none do. Two of forty is a
    // plain edit, and a plain edit is what the diff reports.
    const before = mutate(PALINDROME, [3]);
    const diff = diffDocuments(linear(before), linear(reverseComplement(before)));
    expect(diff.reversed).toBe(false);
    expect(diff.basesChanged).toBe(2);
  });

  it('weighs the change against the longer of two lengths', () => {
    // Thirty bases added make the newer one 70 long: 32 differing bases are
    // under half of that, so the forward reading stands, though 32 is more
    // than half of the older 40 and the turned reading differs by only 30.
    const before = mutate(PALINDROME, [3]);
    const after = `${reverseComplement(before)}${'G'.repeat(30)}`;
    const diff = diffDocuments(linear(before), linear(after));
    expect(diff.reversed).toBe(false);
    expect(diff.basesInserted + diff.basesChanged + diff.basesDeleted).toBe(32);
  });

  it('looks for a turn when exactly half of the molecule differs, changed bases counted', () => {
    // Twenty of forty bases changed forward, none turned over.
    const before = mutate(PALINDROME, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    const diff = diffDocuments(linear(before), linear(reverseComplement(before)));
    expect(diff.reversed).toBe(true);
    expect(diff.basesChanged).toBe(0);
    expect(diff.renamed).toBe(false);
  });

  it('says a turned-over molecule was renamed when it was', () => {
    const before = mutate(PALINDROME, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    const diff = diffDocuments(
      linear(before, [], 'old'),
      linear(reverseComplement(before), [], 'new'),
    );
    expect(diff.reversed).toBe(true);
    expect(diff.renamed).toBe(true);
  });

  it('keeps the forward reading when turning over does no better', () => {
    // A palindrome turned over is itself, so both readings differ from an
    // unrelated sequence by the same amount; a tie is not a turn.
    const unrelated = 'GATCCTTAGGCATTCGAGCTAACGTTGCAAGTCCGATAGC';
    const diff = diffDocuments(linear(PALINDROME), linear(unrelated));
    expect(diff.reversed).toBe(false);
  });
});

describe('diffDocuments, a feature kept under the same id', () => {
  const SEQ = bases(60);

  /** The diff of one feature, changed from `before` to `after` with nothing else touched. */
  function change(before: Feature, after: Feature) {
    return diffDocuments(linear(SEQ, [before]), linear(SEQ, [after]));
  }

  it('is changed, and the diff not empty, when only its strand turned', () => {
    const diff = change(
      createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(5, 20)] }),
      createFeature({ id: 'f', type: 'gene', strand: 'reverse', segments: [rangeSegment(5, 20)] }),
    );
    expect([...diff.featuresChanged.keys()]).toEqual(['f']);
    expect(diff.marks).toEqual([]);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it('is changed when a qualifier value changed', () => {
    const diff = change(
      createFeature({
        id: 'f',
        type: 'CDS',
        segments: [rangeSegment(5, 20)],
        qualifiers: [{ name: 'note', value: 'one' }],
      }),
      createFeature({
        id: 'f',
        type: 'CDS',
        segments: [rangeSegment(5, 20)],
        qualifiers: [{ name: 'note', value: 'two' }],
      }),
    );
    expect([...diff.featuresChanged.keys()]).toEqual(['f']);
  });

  it('is changed when a qualifier was renamed but kept its value', () => {
    const diff = change(
      createFeature({
        id: 'f',
        type: 'CDS',
        segments: [rangeSegment(5, 20)],
        qualifiers: [{ name: 'note', value: 'same' }],
      }),
      createFeature({
        id: 'f',
        type: 'CDS',
        segments: [rangeSegment(5, 20)],
        qualifiers: [{ name: 'product', value: 'same' }],
      }),
    );
    expect([...diff.featuresChanged.keys()]).toEqual(['f']);
  });

  it('is changed when only its start moved', () => {
    const diff = change(misc('f', 'x', 5, 20), misc('f', 'x', 6, 20));
    expect([...diff.featuresChanged.keys()]).toEqual(['f']);
  });

  it('is changed when only an end was marked partial', () => {
    const before = misc('f', 'x', 5, 20);
    const partialStart = createFeature({
      ...before,
      segments: [rangeSegment(5, 20, { partialStart: true })],
    });
    const partialEnd = createFeature({
      ...before,
      segments: [rangeSegment(5, 20, { partialEnd: true })],
    });
    expect([...change(before, partialStart).featuresChanged.keys()]).toEqual(['f']);
    expect([...change(before, partialEnd).featuresChanged.keys()]).toEqual(['f']);
  });

  it('is changed when it gained a segment after the ones it had', () => {
    const segments = [rangeSegment(2, 5), rangeSegment(8, 12)];
    const diff = change(
      createFeature({ id: 'f', type: 'mRNA', segments }),
      createFeature({ id: 'f', type: 'mRNA', segments: [...segments, rangeSegment(14, 18)] }),
    );
    expect([...diff.featuresChanged.keys()]).toEqual(['f']);
  });

  it('is changed when only its second segment moved', () => {
    const diff = change(
      createFeature({ id: 'f', type: 'mRNA', segments: [rangeSegment(2, 5), rangeSegment(8, 12)] }),
      createFeature({ id: 'f', type: 'mRNA', segments: [rangeSegment(2, 5), rangeSegment(9, 12)] }),
    );
    expect([...diff.featuresChanged.keys()]).toEqual(['f']);
  });

  it('is changed when a range became a site', () => {
    const diff = change(
      createFeature({ id: 'f', type: 'misc_feature', segments: [rangeSegment(8, 9)] }),
      createFeature({ id: 'f', type: 'misc_feature', segments: [siteSegment(8)] }),
    );
    expect([...diff.featuresChanged.keys()]).toEqual(['f']);
  });

  it('reports a removed site where the edit moved it', () => {
    const before = linear(SEQ, [
      createFeature({ id: 's', type: 'misc_feature', segments: [siteSegment(30)] }),
    ]);
    const after = before.insert(2, 'GGGGG').removeFeature('s');
    const diff = diffDocuments(before, after);
    expect(diff.featuresRemoved.get('s')?.segments).toEqual([{ kind: 'site', position: 35 }]);
  });
});

describe('diffDocuments, pairing features across two files', () => {
  // Two files parsed separately give their features different ids, so every
  // feature below starts out unmatched and the three passes decide.
  const SEQ = bases(200);

  it('pairs a renamed feature with its old self and still reports an unrelated loss', () => {
    const diff = diffDocuments(
      linear(SEQ, [misc('r1', 'lacZ', 10, 40), misc('r2', 'bla', 60, 70)]),
      linear(SEQ, [misc('a1', 'lacZ-alpha', 10, 40)]),
    );
    expect(diff.featuresChanged.get('a1')?.name).toBe('lacZ');
    expect([...diff.featuresRemoved.keys()]).toEqual(['r2']);
    expect(diff.featuresAdded.size).toBe(0);
  });

  it('does not take a namesake somewhere else for the same feature', () => {
    // Same type, name and strand, but fifteen bases elsewhere: too short to
    // pair by bases, and nowhere near where the old one was.
    const diff = diffDocuments(
      linear(SEQ, [misc('r', 'lacZ', 10, 25)]),
      linear(SEQ, [misc('a', 'lacZ', 60, 75)]),
    );
    expect([...diff.featuresRemoved.keys()]).toEqual(['r']);
    expect([...diff.featuresAdded]).toEqual(['a']);
    expect(diff.featuresChanged.size).toBe(0);
  });

  it('pairs one changed feature with only one of two old ones at its place', () => {
    const gene = (id: string, name: string): Feature =>
      createFeature({ id, type: 'gene', name, segments: [rangeSegment(10, 40)] });
    const diff = diffDocuments(
      linear(SEQ, [gene('a', 'first'), gene('b', 'second')]),
      linear(SEQ, [gene('c', 'third')]),
    );
    expect(diff.featuresChanged.get('c')?.name).toBe('first');
    expect([...diff.featuresRemoved.keys()]).toEqual(['b']);
  });

  it('does not pair two unnamed features of different types by their empty names', () => {
    const at = (id: string, type: string): Feature =>
      createFeature({ id, type, segments: [rangeSegment(10, 40)] });
    const diff = diffDocuments(linear(SEQ, [at('r', 'gene')]), linear(SEQ, [at('a', 'CDS')]));
    expect([...diff.featuresRemoved.keys()]).toEqual(['r']);
    expect([...diff.featuresAdded]).toEqual(['a']);
    expect(diff.featuresChanged.size).toBe(0);
  });

  describe('by their bases (the third pass)', () => {
    // The same stretch at 10, 100 and 150, so a feature can move between
    // copies of it and keep its bases.
    const S = SEQ.slice(10, 40);
    const REPEATED = `${SEQ.slice(0, 100)}${S}${SEQ.slice(130, 150)}${S}${SEQ.slice(180)}`;

    it('pairs a feature that moved and was renamed, at exactly twenty bases', () => {
      const diff = diffDocuments(
        linear(REPEATED, [misc('r', 'old', 10, 30)]),
        linear(REPEATED, [misc('a', 'new', 100, 120)]),
      );
      expect(diff.featuresChanged.get('a')?.name).toBe('old');
      expect(diff.featuresAdded.size).toBe(0);
      expect(diff.featuresRemoved.size).toBe(0);
    });

    it('leaves a moved feature of nineteen bases unpaired', () => {
      const diff = diffDocuments(
        linear(REPEATED, [misc('r', 'old', 10, 29)]),
        linear(REPEATED, [misc('a', 'new', 100, 119)]),
      );
      expect(diff.featuresChanged.size).toBe(0);
      expect([...diff.featuresAdded]).toEqual(['a']);
    });

    it('leaves a feature unpaired when two new ones have its bases', () => {
      const diff = diffDocuments(
        linear(REPEATED, [misc('r', 'old', 10, 40)]),
        linear(REPEATED, [misc('a1', 'copy 1', 100, 130), misc('a2', 'copy 2', 150, 180)]),
      );
      expect(diff.featuresChanged.size).toBe(0);
      expect([...diff.featuresRemoved.keys()]).toEqual(['r']);
      expect([...diff.featuresAdded]).toEqual(['a1', 'a2']);
    });

    it('leaves a new feature unpaired when two old ones had its bases', () => {
      const diff = diffDocuments(
        linear(REPEATED, [misc('r1', 'copy 1', 100, 130), misc('r2', 'copy 2', 150, 180)]),
        linear(REPEATED, [misc('a', 'new', 10, 40)]),
      );
      expect(diff.featuresChanged.size).toBe(0);
      expect([...diff.featuresRemoved.keys()]).toEqual(['r1', 'r2']);
      expect([...diff.featuresAdded]).toEqual(['a']);
    });

    it('does not offer an old feature already matched in full', () => {
      // `r1` and `a1` are the same feature, though a base inside it changed;
      // `a2` elsewhere has the bases `r1` had, and is new all the same.
      const before = `${SEQ.slice(0, 100)}${S}${SEQ.slice(130)}`;
      const after = mutate(before, [20]);
      const diff = diffDocuments(
        linear(before, [misc('r1', 'gene1', 10, 40)]),
        linear(after, [misc('a1', 'gene1', 10, 40), misc('a2', 'other', 100, 130)]),
      );
      expect(diff.featuresChanged.size).toBe(0);
      expect(diff.featuresRemoved.size).toBe(0);
      expect([...diff.featuresAdded]).toEqual(['a2']);
    });

    it('does not offer a new feature already matched in full', () => {
      // `r1` and `a1` are the same feature, though a base inside it changed
      // to what `r2` elsewhere reads; `r2` is gone all the same.
      const edited = mutate(S, [10]);
      const before = `${SEQ.slice(0, 100)}${edited}${SEQ.slice(130)}`;
      const after = mutate(before, [20]);
      const diff = diffDocuments(
        linear(before, [misc('r1', 'gene1', 10, 40), misc('r2', 'other', 100, 130)]),
        linear(after, [misc('a1', 'gene1', 10, 40)]),
      );
      expect(diff.featuresChanged.size).toBe(0);
      expect([...diff.featuresRemoved.keys()]).toEqual(['r2']);
      expect(diff.featuresAdded.size).toBe(0);
    });
  });
});

describe('diffDocuments, a feature on a circle an edit took the tail of', () => {
  const circle = (sequence: string, segments: readonly (readonly [number, number])[]) =>
    SeqDocument.create({
      sequence,
      topology: 'circular',
      features: [
        createFeature({
          id: 'f',
          type: 'misc_feature',
          name: 'f',
          segments: segments.map(([start, end]) => rangeSegment(start, end)),
        }),
      ],
    });
  /** Where the older feature was, in the newer document, once it is renamed there. */
  const was = (base: SeqDocument, edited: SeqDocument): readonly unknown[] | undefined =>
    diffDocuments(base, edited.updateFeature('f', { name: 'g' })).featuresChanged.get('f')
      ?.segments;
  const removedWas = (base: SeqDocument, edited: SeqDocument): readonly unknown[] | undefined =>
    diffDocuments(base, edited.removeFeature('f')).featuresRemoved.get('f')?.segments;

  it('puts a feature that wrapped the origin back at the origin when its start is deleted', () => {
    // The start lands at the new length, the origin, and the end is past it:
    // one turn back, not a collapsed range and not left past the end.
    const base = circle(bases(20), [[14, 26]]);
    const edited = base.delete({ start: 14, end: 20 });
    expect(edited.getFeature('f')?.segments).toMatchObject([{ start: 0, end: 6 }]);
    expect(was(base, edited)).toMatchObject([{ start: 0, end: 6 }]);
    expect(removedWas(base, edited)).toMatchObject([{ start: 0, end: 6 }]);
  });

  it('does not read a range as the whole circle when it holds exactly the bases deleted', () => {
    // More than half the circle, so the range is as long as what is left.
    const base = circle(bases(40, 3), [[15, 40]]);
    const edited = base.delete({ start: 15, end: 40 });
    expect(edited.getFeature('f')).toBeUndefined();
    const whole = circle(edited.sequence.toString(), [[0, 15]]);
    expect(diffDocuments(base, whole).featuresChanged.has('f')).toBe(true);
    expect(removedWas(base, edited)).toMatchObject([{ start: 0, end: 0 }]);
  });

  it('does not read a join as unchanged when its second segment is round the shorter circle', () => {
    // The second segment of the join lost more bases than it holds.
    const base = circle('AATTTT', [
      [0, 3],
      [1, 4],
    ]);
    const edited = base.delete({ start: 2, end: 6 });
    const kept = edited.getFeature('f')?.segments;
    expect(kept).toMatchObject([
      { start: 0, end: 2 },
      { start: 1, end: 2 },
    ]);
    const moved = edited.updateFeature('f', {
      segments: [rangeSegment(0, 2), rangeSegment(0, 2)],
    });
    expect(diffDocuments(base, moved).featuresChanged.has('f')).toBe(true);
    expect(diffDocuments(base, edited).featuresChanged.size).toBe(0);
  });

  it('reads a whole circle left by a start that was deleted as unchanged', () => {
    // [8, 18) goes once round a circle of 10; the edit takes its first two
    // bases, which puts its start at the origin of the shorter circle.
    const base = circle(bases(10), [[8, 18]]);
    const edited = base.delete({ start: 8, end: 10 });
    expect(edited.getFeature('f')?.segments).toMatchObject([{ start: 0, end: 8 }]);
    expect(diffDocuments(base, edited).featuresChanged.size).toBe(0);
    expect(was(base, edited)).toMatchObject([{ start: 0, end: 8 }]);
  });

  it('says a whole circle that lost its start was round the whole new circle, from the origin', () => {
    const base = circle('AAAAAACCCCCC', [[6, 18]]);
    const edited = base.delete({ start: 6, end: 12 });
    expect(was(base, edited)).toMatchObject([{ start: 0, end: 6 }]);
  });

  it('only wraps a feature back a turn when both documents are circular', () => {
    const sequence = 'ACGTTGCAGGATCCATGC';
    const tail = (topology: 'linear' | 'circular') =>
      SeqDocument.create({
        sequence,
        topology,
        features: [
          createFeature({
            id: 'f',
            type: 'misc_feature',
            name: 'f',
            segments: [rangeSegment(12, 18)],
          }),
        ],
      });
    const shorter = (topology: 'linear' | 'circular') =>
      SeqDocument.create({ sequence: sequence.slice(0, 12), topology });
    for (const [from, to] of [
      ['circular', 'linear'],
      ['linear', 'circular'],
      ['linear', 'linear'],
    ] as const) {
      const removed = diffDocuments(tail(from), shorter(to)).featuresRemoved.get('f');
      expect(removed?.segments).toMatchObject([{ start: 12, end: 12 }]);
    }
  });
});
