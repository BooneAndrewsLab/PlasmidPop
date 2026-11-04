import { describe, expect, it } from 'vitest';

import {
  MSA_BAR_HEIGHT,
  MSA_BAR_WIDTH,
  MSA_CONSENSUS_ROW,
  extendMsaSelection,
  msaBarAt,
  msaCellHasLetter,
  msaColumnAt,
  msaColumnUnder,
  msaCopiedNote,
  msaRowAt,
  msaRowText,
  msaSelectionColumns,
  msaSelectionText,
  msaSelectionValid,
  startMsaSelection,
} from './msaSelection';
import {
  MSA_CHAR_WIDTH,
  MSA_HEADER_HEIGHT,
  MSA_NAME_WIDTH,
  MSA_ROW_HEIGHT,
  MSA_RULER_HEIGHT,
} from './components/msaDraw';

const rows = ['AC-GTA', 'ACTG-A', '--TGTA'];
const consensus = 'ACTGTA';

describe('selection columns', () => {
  it('covers both ends whichever is first, and stays inside the alignment', () => {
    const s = extendMsaSelection(startMsaSelection(0, 4), 1);
    expect(msaSelectionColumns(6, s)).toEqual({ start: 1, end: 5 });
    expect(msaSelectionColumns(3, s)).toEqual({ start: 1, end: 3 });
    expect(msaSelectionColumns(1, startMsaSelection(0, 4))).toBeNull();
  });
  it('is valid only for a row that exists (or the consensus) and columns that remain', () => {
    expect(msaSelectionValid(3, 6, startMsaSelection(2, 5))).toBe(true);
    expect(msaSelectionValid(3, 6, startMsaSelection(MSA_CONSENSUS_ROW, 0))).toBe(true);
    expect(msaSelectionValid(2, 6, startMsaSelection(2, 5))).toBe(false);
    expect(msaSelectionValid(3, 4, startMsaSelection(0, 5))).toBe(false);
  });
});

describe('where the pointer is', () => {
  it('names the consensus band, a sequence row under the header, or nothing', () => {
    expect(msaRowAt(MSA_RULER_HEIGHT + 2, 0, 3)).toBe(MSA_CONSENSUS_ROW);
    expect(msaRowAt(2, 0, 3)).toBeNull(); // ruler
    expect(msaRowAt(MSA_HEADER_HEIGHT - 2, 0, 3)).toBeNull(); // conservation bar
    expect(msaRowAt(MSA_HEADER_HEIGHT + 1, 0, 3)).toBe(0);
    expect(msaRowAt(MSA_HEADER_HEIGHT + MSA_ROW_HEIGHT * 2 + 1, 0, 3)).toBe(2);
    expect(msaRowAt(MSA_HEADER_HEIGHT + MSA_ROW_HEIGHT * 3 + 1, 0, 3)).toBeNull();
    // Scrolled by a row, the second row is under the header.
    expect(msaRowAt(MSA_HEADER_HEIGHT + 1, MSA_ROW_HEIGHT, 3)).toBe(1);
  });
  it('maps x to a column, scrolled and clamped', () => {
    expect(msaColumnAt(MSA_NAME_WIDTH + MSA_CHAR_WIDTH * 2 + 1, 0, 6)).toBe(2);
    expect(msaColumnAt(MSA_NAME_WIDTH + 1, MSA_CHAR_WIDTH * 3, 6)).toBe(3);
    expect(msaColumnAt(0, 0, 6)).toBe(0);
    expect(msaColumnAt(10_000, 0, 6)).toBe(5);
  });
  it('also says which column is under x past the ends, for a press on blank space (#370)', () => {
    expect(msaColumnUnder(MSA_NAME_WIDTH + MSA_CHAR_WIDTH * 6 + 1, 0)).toBe(6);
    expect(msaColumnUnder(0, 0)).toBeLessThan(0);
    expect(msaColumnUnder(MSA_NAME_WIDTH + 1, MSA_CHAR_WIDTH * 3)).toBe(3);
  });
  it('finds a letter, a gap included, in every column of a row or the consensus, and none past the end', () => {
    expect(msaCellHasLetter(rows, consensus, 0, 2)).toBe(true); // a gap
    expect(msaCellHasLetter(rows, consensus, 2, 0)).toBe(true);
    expect(msaCellHasLetter(rows, consensus, MSA_CONSENSUS_ROW, 5)).toBe(true);
    expect(msaCellHasLetter(rows, consensus, MSA_CONSENSUS_ROW, 6)).toBe(false);
    expect(msaCellHasLetter(rows, consensus, 1, 6)).toBe(false);
    expect(msaCellHasLetter(rows, consensus, 1, -1)).toBe(false);
    expect(msaCellHasLetter(rows, consensus, 7, 0)).toBe(false);
  });
});

describe('what Ctrl+C copies', () => {
  it("copies the row's own letters, or the row as drawn", () => {
    const r = { start: 0, end: 5 };
    expect(msaRowText(rows, consensus, 0, r, 'residues')).toBe('ACGT');
    expect(msaRowText(rows, consensus, 0, r, 'aligned')).toBe('AC-GT');
    expect(msaRowText(rows, consensus, 2, r, 'residues')).toBe('TGT');
  });
  it('copies the consensus row too', () => {
    const sel = extendMsaSelection(startMsaSelection(MSA_CONSENSUS_ROW, 1), 3);
    expect(msaSelectionText(rows, consensus, 6, sel, 'residues')).toBe('CTG');
  });
  it('is empty when the selection no longer fits', () => {
    expect(msaSelectionText(rows, consensus, 6, startMsaSelection(7, 0), 'residues')).toBe('');
    expect(msaSelectionText(rows, consensus, 6, startMsaSelection(0, 9), 'residues')).toBe('');
  });
  it('says what was copied in the unit of the alphabet', () => {
    expect(msaCopiedNote('s1', 'base', 'ACG', 'residues')).toBe('Copied 3 bases of s1');
    expect(msaCopiedNote('s1', 'residue', 'A', 'aligned')).toBe(
      'Copied 1 residue of s1, gaps kept',
    );
  });
});

describe('the bar', () => {
  const view = { width: 800, height: 400 };
  it('sits above a row with room under the header, below otherwise', () => {
    const low = startMsaSelection(5, 10);
    const bar = msaBarAt(low, 100, { left: 0, top: 0 }, view);
    expect(bar).not.toBeNull();
    expect(bar?.top).toBe(MSA_HEADER_HEIGHT + 5 * MSA_ROW_HEIGHT - MSA_BAR_HEIGHT - 4);
    expect(bar?.columns).toBe(1);
    const first = msaBarAt(startMsaSelection(0, 10), 100, { left: 0, top: 0 }, view);
    expect(first?.top).toBe(MSA_HEADER_HEIGHT + MSA_ROW_HEIGHT + 4);
  });
  it('goes just under the header for the consensus, in content space when scrolled', () => {
    const bar = msaBarAt(startMsaSelection(MSA_CONSENSUS_ROW, 3), 100, { left: 90, top: 50 }, view);
    expect(bar?.top).toBe(50 + MSA_HEADER_HEIGHT + 4);
    expect(bar?.left).toBe(90 + MSA_NAME_WIDTH + 4);
  });
  it('stays inside the view sideways, and is gone when the row scrolled out', () => {
    const far = msaBarAt(startMsaSelection(5, 90), 100, { left: 0, top: 0 }, view);
    expect(far?.left).toBe(view.width - MSA_BAR_WIDTH);
    expect(msaBarAt(startMsaSelection(0, 1), 100, { left: 0, top: 500 }, view)).toBeNull();
    expect(msaBarAt(startMsaSelection(30, 1), 100, { left: 0, top: 0 }, view)).toBeNull();
  });
});
