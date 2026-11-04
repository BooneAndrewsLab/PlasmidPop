import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COPY_OPTIONS,
  LARGE_COPY_CHARS,
  coordinateNote,
  copyLimits,
  copyOutput,
  copySummary,
  effectiveOptions,
  largeCopyWarning,
  loadCopyOptions,
  normalizeCopyOptions,
  optionsForSelection,
  previewLines,
  saveCopyOptions,
  type CopyContext,
  type CopyOptions,
} from './alignmentCopy';
import { REFERENCE_ROW, startSelection } from './alignmentSelection';
import {
  SAMPLE_FRAME as frame,
  SAMPLE_STACK as stack,
  row,
  stackOf,
} from '../test/alignmentStackFixture';

const sel = (r: number, a: number, b: number, track: 'bases' | 'aa' = 'bases') => ({
  ...startSelection(r, track, a),
  head: b,
});

/** s1, columns 2-8, residues in view. */
const ctx: CopyContext = {
  stack,
  frames: [frame],
  referenceName: 'ref',
  selection: sel(0, 2, 8),
};
const opts = (o: Partial<CopyOptions>): CopyOptions => ({ ...DEFAULT_COPY_OPTIONS, ...o });

describe('copyLimits and effectiveOptions', () => {
  it('keeps gaps once several rows go out', () => {
    expect(copyLimits(opts({ rows: 'selected' }), ctx).gapsKept).toBe(false);
    expect(copyLimits(opts({ rows: 'with-reference' }), ctx).gapsKept).toBe(true);
    expect(copyLimits(opts({ rows: 'all' }), ctx).gapsKept).toBe(true);
    expect(effectiveOptions(opts({ rows: 'all', gaps: 'dropped' }), ctx).gaps).toBe('kept');
  });
  it('is bases only without residues in view', () => {
    const bare = { ...ctx, frames: null };
    expect(copyLimits(opts({}), bare).basesOnly).toBe(true);
    expect(effectiveOptions(opts({ tracks: 'both' }), bare).tracks).toBe('bases');
    expect(copyLimits(opts({}), { ...ctx, frames: [] }).basesOnly).toBe(true);
    expect(copyLimits(opts({}), ctx).basesOnly).toBe(false);
  });
  it('treats "with the reference" on the reference as the row alone, gaps still droppable', () => {
    const onRef = { ...ctx, selection: sel(REFERENCE_ROW, 2, 8) };
    const limits = copyLimits(opts({ rows: 'with-reference' }), onRef);
    expect(limits.onReference).toBe(true);
    expect(limits.gapsKept).toBe(false);
    expect(effectiveOptions(opts({ rows: 'with-reference' }), onRef).rows).toBe('selected');
  });
  it('opens on the strip the selection is on, unless both were wanted', () => {
    expect(optionsForSelection(opts({ tracks: 'bases' }), sel(0, 1, 2, 'aa')).tracks).toBe('aa');
    expect(optionsForSelection(opts({ tracks: 'aa' }), sel(0, 1, 2)).tracks).toBe('bases');
    expect(optionsForSelection(opts({ tracks: 'both' }), sel(0, 1, 2)).tracks).toBe('both');
  });
});

describe('copyOutput', () => {
  it('is the selected row without gaps by default, as Ctrl+C, with no newline', () => {
    // s1 is ATG-AAGCCC; columns 2-8 are G-AAGCC.
    expect(copyOutput(opts({}), ctx)).toEqual({ text: 'GAAGCC', rows: 1, columns: 7 });
  });
  it('keeps gaps, and writes the columns a sample does not reach as -', () => {
    expect(copyOutput(opts({ gaps: 'kept' }), ctx).text).toBe('G-AAGCC');
    const s2 = { ...ctx, selection: sel(1, 0, 9) };
    expect(copyOutput(opts({ gaps: 'kept' }), s2).text).toBe('--GAAA-CC-');
    expect(copyOutput(opts({}), s2).text).toBe('GAAACC');
  });
  it('puts the reference above the row, in register, and every row for all', () => {
    expect(copyOutput(opts({ rows: 'with-reference' }), ctx)).toEqual({
      text: 'GAAA-CC\nG-AAGCC',
      rows: 2,
      columns: 7,
    });
    expect(copyOutput(opts({ rows: 'all', columns: 'all' }), ctx).text).toBe(
      'ATGAAA-CCC\nATG-AAGCCC\n--GAAA-CC-',
    );
  });
  it('does not list the reference twice when the selection is on it', () => {
    const onRef = { ...ctx, selection: sel(REFERENCE_ROW, 0, 9) };
    expect(copyOutput(opts({ rows: 'with-reference' }), onRef).text).toBe('ATGAAACCC');
    expect(copyOutput(opts({ rows: 'all' }), onRef).rows).toBe(3);
  });
  it('names the lines in one padded column, the names cut to one line', () => {
    const named = { ...ctx, referenceName: 'plasmid  pUC19\nlong' };
    expect(copyOutput(opts({ rows: 'with-reference', names: true }), named).text).toBe(
      'plasmid pUC19 long GAAA-CC\ns1                 G-AAGCC',
    );
  });
  it('leads text with a coordinate line and adds it to FASTA headers', () => {
    expect(copyOutput(opts({ coordinates: true }), ctx).text).toBe(
      'Columns 3-9, reference 3-8\nGAAGCC',
    );
    expect(copyOutput(opts({ coordinates: true, format: 'fasta' }), ctx).text).toBe(
      '>s1 columns 3-9, reference 3-8\nGAAGCC\n',
    );
    // Only an inserted column: no reference position to name.
    expect(coordinateNote(stack, { start: 6, end: 7 })).toBe('columns 7-7');
  });
  it('writes FASTA records, each ending in a newline, the reference first', () => {
    expect(copyOutput(opts({ rows: 'all', format: 'fasta' }), ctx).text).toBe(
      '>ref\nGAAA-CC\n>s1\nG-AAGCC\n>s2\nGAAA-CC\n',
    );
  });
  it('copies amino acids, or both tracks, each CDS a named line', () => {
    const aa = { ...ctx, selection: sel(REFERENCE_ROW, 0, 9, 'aa') };
    expect(copyOutput(opts({ tracks: 'aa' }), aa)).toEqual({ text: 'MKP', rows: 1, columns: 10 });
    const both = copyOutput(opts({ tracks: 'both', rows: 'with-reference', names: true }), aa);
    expect(both.rows).toBe(2);
    // On the reference alone the gap is droppable, and dropped by default.
    expect(both.text).toBe('ref      ATGAAACCC\nref|x|aa MKP');
    expect(copyOutput(opts({ tracks: 'both', format: 'fasta' }), aa).text).toBe(
      '>ref\nATGAAACCC\n>ref|x|aa\nMKP\n',
    );
  });
  it('is bases when residues are not in view, whatever the track asks', () => {
    expect(copyOutput(opts({ tracks: 'aa' }), { ...ctx, frames: null }).text).toBe('GAAGCC');
  });
  it('is empty when no row has anything in the columns', () => {
    const late = stackOf('ATGAAA-CCC', [row('s3', '      -CCC')]);
    const none = { ...ctx, stack: late, selection: sel(0, 0, 4) };
    expect(copyOutput(opts({}), none)).toEqual({ text: '', rows: 0, columns: 0 });
    expect(copyOutput(opts({ gaps: 'kept' }), none).text).toBe('-----');
    expect(copyOutput(opts({}), { ...ctx, selection: sel(0, 20, 30) }).text).toBe('');
  });
});

describe('copySummary, largeCopyWarning and previewLines', () => {
  it('counts rows, columns and characters', () => {
    expect(copySummary({ text: 'GAAA-CC\nG-AAGCC', rows: 2, columns: 7 })).toBe(
      '2 rows × 7 columns, 15 characters',
    );
    expect(copySummary({ text: 'G', rows: 1, columns: 1 })).toBe('1 row × 1 column, 1 characters');
  });
  it('warns above the limit only', () => {
    expect(largeCopyWarning({ text: 'ACGT', rows: 1, columns: 4 })).toBeNull();
    const big = { text: 'A'.repeat(LARGE_COPY_CHARS + 200_000), rows: 1, columns: 1 };
    expect(largeCopyWarning(big)).toContain('1.2 MB');
  });
  it('shows the first lines, cut to the width, and says how many more', () => {
    expect(previewLines('')).toEqual({ lines: [], more: 0 });
    const text = ['a'.repeat(80), 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
    const p = previewLines(text, 6, 10);
    expect(p.lines).toEqual(['aaaaaaaaa…', 'b', 'c', 'd', 'e', 'f']);
    expect(p.more).toBe(2);
    // A FASTA's final newline is not a line.
    expect(previewLines('>s\nAC\n')).toEqual({ lines: ['>s', 'AC'], more: 0 });
  });
});

describe('remembering the options', () => {
  const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    };
  };
  it('round-trips, and starts at the defaults with nothing saved', () => {
    const store = memory();
    expect(loadCopyOptions(store)).toEqual(DEFAULT_COPY_OPTIONS);
    const o = opts({ rows: 'all', format: 'fasta', coordinates: true });
    saveCopyOptions(o, store);
    expect(loadCopyOptions(store)).toEqual(o);
  });
  it('takes each field it recognises and defaults the rest', () => {
    expect(normalizeCopyOptions({ rows: 'all', gaps: 'sideways', names: 'yes' })).toEqual({
      ...DEFAULT_COPY_OPTIONS,
      rows: 'all',
    });
    expect(normalizeCopyOptions(null)).toEqual(DEFAULT_COPY_OPTIONS);
    expect(normalizeCopyOptions('all')).toEqual(DEFAULT_COPY_OPTIONS);
  });
  it('shrugs off a broken or missing store', () => {
    const broken: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadCopyOptions(broken)).toEqual(DEFAULT_COPY_OPTIONS);
    expect(() => {
      saveCopyOptions(DEFAULT_COPY_OPTIONS, broken);
    }).not.toThrow();
    const store = memory();
    store.data.set('plasmidpop.alignmentCopy', '{not json');
    expect(loadCopyOptions(store)).toEqual(DEFAULT_COPY_OPTIONS);
    expect(loadCopyOptions(null)).toEqual(DEFAULT_COPY_OPTIONS);
  });
});
