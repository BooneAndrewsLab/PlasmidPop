import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MSA_COPY_OPTIONS,
  effectiveMsaOptions,
  loadMsaCopyOptions,
  msaCopyOutput,
  normalizeMsaCopyOptions,
  residueNote,
  saveMsaCopyOptions,
  type MsaCopyContext,
  type MsaCopyOptions,
} from './msaCopy';
import { MSA_CONSENSUS_ROW, extendMsaSelection, startMsaSelection } from './msaSelection';

const ctx = (row: number, from = 1, to = 4): MsaCopyContext => ({
  rows: ['AC-GTA', 'ACTG-A', '--TGTA'],
  consensus: 'ACTGTA',
  names: ['one', 'two', 'three'],
  columns: 6,
  selection: extendMsaSelection(startMsaSelection(row, from), to),
});
const opts = (patch: Partial<MsaCopyOptions>): MsaCopyOptions => ({
  ...DEFAULT_MSA_COPY_OPTIONS,
  ...patch,
});

describe('msaCopyOutput', () => {
  it('defaults to what Ctrl+C copies', () => {
    expect(msaCopyOutput(DEFAULT_MSA_COPY_OPTIONS, ctx(0))).toEqual({
      text: 'CGT',
      rows: 1,
      columns: 4,
    });
  });
  it('keeps gaps as -, from a choice or because several rows go out', () => {
    expect(msaCopyOutput(opts({ gaps: 'kept' }), ctx(0)).text).toBe('C-GT');
    const all = msaCopyOutput(opts({ rows: 'sequences', gaps: 'dropped' }), ctx(0));
    expect(all.text).toBe('C-GT\nCTG-\n-TGT');
    expect(all.rows).toBe(3);
    expect(effectiveMsaOptions(opts({ rows: 'sequences', gaps: 'dropped' })).gaps).toBe('kept');
  });
  it('adds the consensus above every sequence', () => {
    const out = msaCopyOutput(opts({ rows: 'with-consensus', names: true }), ctx(2));
    expect(out.text).toBe(
      ['Consensus CTGT', 'one       C-GT', 'two       CTG-', 'three     -TGT'].join('\n'),
    );
  });
  it('copies the consensus row when the selection is on it', () => {
    expect(msaCopyOutput(DEFAULT_MSA_COPY_OPTIONS, ctx(MSA_CONSENSUS_ROW)).text).toBe('CTGT');
  });
  it('takes every column, selected or not', () => {
    const out = msaCopyOutput(opts({ columns: 'all', gaps: 'kept' }), ctx(1));
    expect(out).toEqual({ text: 'ACTG-A', rows: 1, columns: 6 });
  });
  it('writes FASTA with names always, and coordinates after each name', () => {
    const out = msaCopyOutput(
      opts({ format: 'fasta', rows: 'with-consensus', coordinates: true }),
      ctx(0),
    );
    expect(out.text).toBe(
      '>Consensus columns 2-5\nCTGT\n>one columns 2-5, residues 2-4\nC-GT\n' +
        '>two columns 2-5, residues 2-4\nCTG-\n>three columns 2-5, residues 1-3\n-TGT\n',
    );
  });
  it('heads text with the columns, and the residues when one row goes out', () => {
    expect(msaCopyOutput(opts({ coordinates: true }), ctx(2)).text).toBe(
      'Columns 2-5, residues 1-3\nTGT',
    );
    expect(
      msaCopyOutput(opts({ coordinates: true, rows: 'sequences' }), ctx(2)).text.split('\n')[0],
    ).toBe('Columns 2-5');
  });
  it('leaves a row with nothing in the columns out, and is empty when none is left', () => {
    const c = { ...ctx(0, 0, 1), rows: ['AC-GTA', '--TGTA'], names: ['a', 'b'] };
    expect(msaCopyOutput(opts({ rows: 'sequences', gaps: 'kept' }), c).rows).toBe(2);
    const gap: MsaCopyContext = { ...ctx(1, 0, 1) };
    expect(msaCopyOutput(DEFAULT_MSA_COPY_OPTIONS, gap).text).toBe('AC');
    const blank: MsaCopyContext = { ...ctx(2, 0, 1) };
    expect(msaCopyOutput(DEFAULT_MSA_COPY_OPTIONS, blank)).toEqual({
      text: '',
      rows: 0,
      columns: 0,
    });
  });
  it('is empty when the selection does not fit', () => {
    expect(msaCopyOutput(DEFAULT_MSA_COPY_OPTIONS, ctx(0, 10, 12)).text).toBe('');
  });
});

describe('residueNote', () => {
  it('numbers a row by its own letters, none for the consensus or an all-gap stretch', () => {
    const rows = ['AC-GTA'];
    expect(residueNote(rows, 0, { start: 3, end: 6 })).toBe('residues 3-5');
    expect(residueNote(rows, 0, { start: 2, end: 3 })).toBeNull();
    expect(residueNote(rows, MSA_CONSENSUS_ROW, { start: 0, end: 3 })).toBeNull();
  });
});

describe('remembered options', () => {
  const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { value: string | null } => {
    const m = {
      value: null as string | null,
      getItem: () => m.value,
      setItem: (_: string, v: string) => {
        m.value = v;
      },
    };
    return m;
  };
  it('round-trips, and falls back field by field', () => {
    const m = memory();
    const o = opts({ rows: 'sequences', format: 'fasta', names: true });
    saveMsaCopyOptions(o, m);
    expect(loadMsaCopyOptions(m)).toEqual(o);
    expect(normalizeMsaCopyOptions({ rows: 'nope', gaps: 'kept', names: 3 })).toEqual({
      ...DEFAULT_MSA_COPY_OPTIONS,
      gaps: 'kept',
    });
    expect(normalizeMsaCopyOptions(null)).toEqual(DEFAULT_MSA_COPY_OPTIONS);
  });
  it('survives unreadable or missing storage', () => {
    expect(loadMsaCopyOptions(null)).toEqual(DEFAULT_MSA_COPY_OPTIONS);
    const bad = { getItem: () => '{oops', setItem: () => undefined };
    expect(loadMsaCopyOptions(bad)).toEqual(DEFAULT_MSA_COPY_OPTIONS);
    expect(() => {
      saveMsaCopyOptions(DEFAULT_MSA_COPY_OPTIONS, {
        getItem: () => null,
        setItem: () => {
          throw new Error('full');
        },
      });
    }).not.toThrow();
  });
});
