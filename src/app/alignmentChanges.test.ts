import { alignEitherStrand, createFeature, rangeSegment, SeqDocument } from '@/core';
import { describe, expect, it } from 'vitest';

import {
  codonAtColumn,
  placeTags,
  residueChangeText,
  residueLabel,
  residueTitle,
  rulerTicks,
  sampleChanges,
  tagRank,
} from './alignmentChanges';
import { buildFrames, Change } from './alignmentResidues';
import { stackAlignments } from './alignmentStack';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

// ATG AAA GGG TTT CCC TAA, then a tail
const sequence = 'GCATGAAAGGGTTTCCCTAAGCGCGATCGATTAGC';

function stackOf(reads: string[], reference = sequence) {
  const ref = { sequence: reference, offset: 0, wrap: null };
  const samples = reads.map((read, i) => {
    const prepared = prepareReadAlignment(ref, { sequence: read, read: null }, null);
    if (!prepared.ok) throw new Error(prepared.message);
    const { job } = prepared;
    return {
      name: `r${i}`,
      result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
    };
  });
  return stackAlignments(ref, samples);
}

function framesOf(stack: ReturnType<typeof stackOf>, strand: 'forward' | 'reverse', text: string) {
  const doc = SeqDocument.create({ sequence: text, topology: 'linear' });
  const cds = createFeature({
    type: 'CDS',
    name: 'bla',
    strand,
    segments: [rangeSegment(2, 20)],
  });
  return buildFrames(stack, doc, [cds], 0);
}

describe('residueChangeText', () => {
  const codon = { columns: [0, 1, 2], reference: 'R', index: 239, first: false } as const;
  it('names missense, nonsense and stop-lost changes without a prefix', () => {
    expect(residueChangeText(codon, { letter: 'S', change: Change.Missense })).toBe('R240S');
    expect(residueChangeText(codon, { letter: '*', change: Change.Nonsense })).toBe('R240*');
    const stop = { ...codon, reference: '*', index: 249 };
    expect(residueChangeText(stop, { letter: 'K', change: Change.StopLost })).toBe('*250K');
  });

  it('names nothing for silent, same, indel or blank', () => {
    for (const change of [Change.Same, Change.Synonymous, Change.Indel, Change.Blank]) {
      expect(residueChangeText(codon, { letter: 'R', change })).toBeNull();
    }
    expect(residueLabel(codon)).toBe('R240');
  });
});

describe('sampleChanges', () => {
  it('lists the named changes of a sample and skips silent ones', () => {
    // AAA→AAG silent; GGG→GAG G→E; TTT→TAA stop gained
    const read = sequence.slice(0, 5) + 'AAG' + 'GAG' + 'TAA' + sequence.slice(14);
    const stack = stackOf([read]);
    const row = stack.rows[0];
    const frames = framesOf(stack, 'forward', sequence);
    if (row === undefined) throw new Error('no row');
    expect(sampleChanges(frames, row).map((c) => c.text)).toEqual(['G3E', 'F4*']);
  });

  it('is empty for an identical read', () => {
    const stack = stackOf([sequence]);
    const row = stack.rows[0];
    if (row === undefined) throw new Error('no row');
    expect(sampleChanges(framesOf(stack, 'forward', sequence), row)).toEqual([]);
  });
});

describe('rulerTicks', () => {
  function longCds(strand: 'forward' | 'reverse') {
    // 25 codons, ATG then AAA, no stop
    const text = `CC${'ATG' + 'AAA'.repeat(24)}CC`;
    const stack = stackOf([text], text);
    const doc = SeqDocument.create({ sequence: text, topology: 'linear' });
    const cds = createFeature({
      type: 'CDS',
      name: 'g',
      strand,
      segments: [rangeSegment(2, 77)],
    });
    const [frame] = buildFrames(stack, doc, [cds], 0);
    if (frame === undefined) throw new Error('no frame');
    return frame;
  }

  it('numbers every tenth residue from the first codon, left to right', () => {
    const ticks = rulerTicks(longCds('forward'));
    expect(ticks.map((t) => t.number)).toEqual([10, 20]);
    expect(ticks.map((t) => t.start)).toEqual([2 + 27, 2 + 57]);
    expect(ticks[0]?.end).toBe(2 + 30);
  });

  it('runs right to left on a reverse-strand CDS', () => {
    const ticks = rulerTicks(longCds('reverse'));
    expect(ticks.map((t) => t.number)).toEqual([10, 20]);
    // the first codon is at the right end (columns 74-76), so 10 is right of 20
    expect((ticks[0]?.start ?? 0) > (ticks[1]?.start ?? 0)).toBe(true);
    expect(ticks[0]?.start).toBe(77 - 30);
  });

  it('counts across a circle’s origin', () => {
    // 72 bp circle, CDS join(36..72, 0..24): 20 codons, the origin inside codon 13
    const text = 'ATG' + 'AAA'.repeat(11) + 'GCA'.repeat(12);
    expect(text.length).toBe(72);
    const reference = text + text.slice(0, 24);
    const stack = stackOf([reference], reference);
    const doc = SeqDocument.create({ sequence: text, topology: 'circular' });
    const cds = createFeature({
      type: 'CDS',
      name: 'g',
      strand: 'forward',
      segments: [rangeSegment(36, 72), rangeSegment(0, 24)],
    });
    const frames = buildFrames(stack, doc, [cds], 72);
    // the read continues past the origin, so the last codon is also at the circle's start
    const ticks = frames.flatMap((f) => rulerTicks(f));
    expect(ticks.map((t) => [t.number, t.start])).toEqual([
      [10, 36 + 27],
      [20, 21],
      [20, 36 + 57],
    ]);
  });
});

describe('placeTags', () => {
  it('keeps tags that clear each other, with the gap', () => {
    const boxes = [
      { centre: 0, width: 20, rank: 2 },
      { centre: 23, width: 20, rank: 2 },
      { centre: 45, width: 20, rank: 2 },
    ];
    expect(placeTags(boxes, 3)).toEqual([true, true, false]);
    expect(placeTags(boxes, 0)).toEqual([true, true, true]);
  });

  it('ranks nonsense before stop-lost before missense, then by position', () => {
    expect(tagRank(Change.Nonsense)).toBeLessThan(tagRank(Change.StopLost));
    expect(tagRank(Change.StopLost)).toBeLessThan(tagRank(Change.Missense));
    // the loud middle one beats its two missense neighbours
    const boxes = [
      { centre: 0, width: 20, rank: tagRank(Change.Missense) },
      { centre: 15, width: 20, rank: tagRank(Change.Nonsense) },
      { centre: 30, width: 20, rank: tagRank(Change.Missense) },
    ];
    expect(placeTags(boxes, 2)).toEqual([false, true, false]);
  });

  it('prefers the left of two equal ranks that collide', () => {
    const boxes = [
      { centre: 10, width: 20, rank: 2 },
      { centre: 0, width: 20, rank: 2 },
    ];
    expect(placeTags(boxes, 2)).toEqual([false, true]);
  });

  it('keeps nothing from nothing', () => {
    expect(placeTags([], 3)).toEqual([]);
  });
});

describe('residueTitle', () => {
  // GGG (codon 3) → GAG: G3E, GGG→GAG
  const read = sequence.slice(0, 8) + 'GAG' + sequence.slice(11);

  it('names a residue of the reference', () => {
    const stack = stackOf([read]);
    const frames = framesOf(stack, 'forward', sequence);
    expect(residueTitle(frames, stack, null, 9)).toBe('G3 · bla');
  });

  it('names a changed residue with its codons', () => {
    const stack = stackOf([read]);
    const frames = framesOf(stack, 'forward', sequence);
    expect(residueTitle(frames, stack, 0, 9)).toBe('G3E · GGG→GAG · bla');
  });

  it('names an unchanged residue of a sample plainly', () => {
    const stack = stackOf([read]);
    const frames = framesOf(stack, 'forward', sequence);
    expect(residueTitle(frames, stack, 0, 3)).toBe('M1 · bla');
  });

  it('is null outside a CDS and where the sample is not there', () => {
    const stack = stackOf([sequence.slice(0, 12)]);
    const frames = framesOf(stack, 'forward', sequence);
    expect(residueTitle(frames, stack, 0, 0)).toBeNull();
    expect(residueTitle(frames, stack, 0, 18)).toBeNull();
    expect(residueTitle(frames, stack, 5, 3)).toBeNull();
  });

  it('shows the codons in reading order on the reverse strand', () => {
    // the reverse complement of ATG AAA GGG TTT CCC TAA's first five codons
    const rc = 'CCTTAGGGAAACCCTTTCATCC';
    // CCC→CTC reads GGG→GAG on the reverse strand
    const changed = rc.slice(0, 12) + 'T' + rc.slice(13);
    const stack = stackOf([changed], rc);
    const frames = framesOf(stack, 'reverse', rc);
    expect(codonAtColumn(frames, 12)?.codon.reference).toBe('G');
    expect(residueTitle(frames, stack, 0, 12)).toBe('G3E · GGG→GAG · bla');
  });
});
