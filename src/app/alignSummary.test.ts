import type { Assembly, ReadDifference } from '@/core';

import type { AlignBatch, ShownAlignment } from './alignSession';
import {
  alignmentKind,
  alignmentNumbers,
  assemblyLine,
  batchLine,
  differencesLine,
} from './alignSummary';

function shown(
  over: Partial<ShownAlignment['alignment']> = {},
  strand = 'forward',
): ShownAlignment {
  return {
    alignment: {
      mode: 'local',
      score: 42,
      identity: 0.975,
      columns: 1234,
      gaps: 1,
      ...over,
    },
    strand,
    docIsRead: null,
  } as unknown as ShownAlignment;
}

describe('alignSummary (item 129)', () => {
  it('names the alignment and its numbers as the Results heading does', () => {
    expect(alignmentKind(shown())).toBe('Local alignment');
    expect(alignmentKind(shown({ mode: 'global' }))).toBe('Global alignment');
    expect(alignmentNumbers(shown())).toBe(
      'score 42, identity 98% over 1,234 columns, 1 gap column',
    );
    expect(alignmentNumbers(shown({ gaps: 0 }, 'reverse'))).toBe(
      'score 42, identity 98% over 1,234 columns, 0 gap columns, reverse complement of the pasted sequence',
    );
  });

  it('counts the differences by confidence', () => {
    const d = (confident: boolean): ReadDifference => ({
      confident,
      kind: 'mismatch',
      column: 0,
      positionA: 0,
      positionB: 0,
      quality: 20,
    });
    expect(differencesLine([], 20, 'pX')).toBe('No differences from pX over the aligned stretch.');
    expect(differencesLine([d(true), d(true), d(false)], 20, 'pX')).toBe(
      '2 differences at confident bases (Q20+), 1 at poor ones.',
    );
    expect(differencesLine([d(false)], 30, 'pX')).toBe(
      'No differences at confident bases (Q30+), 1 at poor ones.',
    );
  });

  it('says how a batch stands', () => {
    const row = (status: 'aligned' | 'failed') => ({ status }) as AlignBatch['rows'][number];
    const batch = (rows: AlignBatch['rows'], total: number, cancelled = false): AlignBatch =>
      ({ rows, total, cancelled }) as AlignBatch;
    expect(batchLine(batch([row('aligned')], 3), 'pX')).toBe('3 reads · 1 aligned so far');
    expect(batchLine(batch([row('aligned'), row('failed'), row('aligned')], 3), 'pX')).toBe(
      '3 reads · against pX, 1 could not be aligned',
    );
    expect(batchLine(batch([row('aligned')], 3, true), 'the selection')).toBe(
      '3 reads · cancelled after 1',
    );
    expect(batchLine(batch([row('aligned')], 1), 'pX')).toBe('1 read · against pX');
  });

  it('sums an assembly up, with what was left out and what a repeat may have done', () => {
    const contig = (reads: number, warnings = 0) =>
      ({
        reads: Array.from({ length: reads }),
        warnings: Array.from({ length: warnings }),
      }) as unknown as Assembly['contigs'][number];
    expect(assemblyLine({ contigs: [], skipped: [] } as unknown as Assembly)).toBe(
      'Nothing to assemble.',
    );
    expect(assemblyLine({ contigs: [contig(3)], skipped: [] } as unknown as Assembly)).toBe(
      '3 reads in 1 contig',
    );
    expect(
      assemblyLine({ contigs: [contig(4, 1), contig(2)], skipped: [0] } as unknown as Assembly),
    ).toBe('6 reads in 2 contigs, 1 left out; a repeat may have fooled it');
    expect(
      assemblyLine({ contigs: [contig(4, 1), contig(2, 2)], skipped: [] } as unknown as Assembly),
    ).toBe('6 reads in 2 contigs; a repeat may have fooled 2 contigs');
  });
});
