import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { alignEitherStrand, alignMultiple, alignPairwise, summariseColumns } from '@/core';
import { parseFasta } from '@/io/fasta/fasta';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { DEFAULT_MSA_COPY_OPTIONS, msaCopyOutput } from './msaCopy';
import { planMsa } from './msaPlan';
import { extendMsaSelection, startMsaSelection } from './msaSelection';
import { prepareReadAlignment, suggestAlignMode } from './readAlignment';

/**
 * Verifies docs/tutorials/align.md: the files it hands out and every number
 * it prints, through the functions the Align tab and the multiple-alignment
 * window call (`prepareReadAlignment`, `alignEitherStrand`, `alignPairwise`,
 * `planMsa`, `alignMultiple`, `msaCopyOutput`).
 */

const DIR = join(__dirname, '../../docs/tutorials/files');
const text = (f: string): string => readFileSync(join(DIR, f), 'utf8');
const records = (f: string) =>
  parseFasta(text(f)).documents.map((d) => ({
    name: d.name,
    alphabet: d.alphabet,
    sequence: d.sequence.toString().toUpperCase(),
  }));
const plasmid = (() => {
  const doc = parseGenBank(text('AL-Plasmid.gb')).documents[0];
  if (doc === undefined) throw new Error('AL-Plasmid has no record');
  return doc;
})();
const ref = plasmid.sequence.toString().toUpperCase();
const asDocument = (doc: typeof plasmid) => ({
  name: doc.name,
  alphabet: doc.alphabet,
  length: doc.length,
  sequence: () => doc.sequence.toString().toUpperCase(),
});
const notConserved = (rows: readonly string[]): number[] =>
  summariseColumns(rows).flatMap((c, i) => (c.conservation < 1 ? [i + 1] : []));

describe('the Align tutorial files', () => {
  it('are the sizes the page gives', () => {
    expect([plasmid.length, plasmid.topology, plasmid.alphabet]).toEqual([
      480,
      'circular',
      'nucleotide',
    ]);
    expect([...plasmid.features].map((f) => f.name)).toEqual([
      'synthetic promoter',
      'synthORF',
      'synthetic terminator',
    ]);
    expect(records('AL-Read.fasta').map((r) => r.sequence.length)).toEqual([100]);
    expect(records('AL-Clones.fasta').map((r) => [r.name, r.sequence.length])).toEqual([
      ['AL-Clone2', 480],
      ['AL-Clone3', 480],
      ['AL-Clone4', 477],
    ]);
    expect(records('AL-Protein.fasta').map((r) => [r.alphabet, r.sequence.length])).toEqual([
      ['protein', 60],
    ]);
    expect(
      records('AL-Proteins.fasta').map((r) => [r.name, r.alphabet, r.sequence.length]),
    ).toEqual([
      ['AL-Protein2', 'protein', 60],
      ['AL-Protein3', 'protein', 60],
      ['AL-Protein4', 'protein', 57],
    ]);
  });
});

describe('Exercise 1: a read against the plasmid', () => {
  const [read] = records('AL-Read.fasta');
  if (read === undefined) throw new Error('no read');

  it('starts in Local mode, because the read is under half the plasmid', () => {
    expect(suggestAlignMode({ length: read.sequence.length, isRead: false }, ref.length).mode).toBe(
      'local',
    );
  });

  it('aligns on the reverse strand, 99% identical over 100 columns, with no gap', () => {
    const p = prepareReadAlignment(
      { sequence: ref, offset: 0, wrap: ref.length },
      { sequence: read.sequence, read: null },
      null,
    );
    if (!p.ok) throw new Error(p.message);
    const r = alignEitherStrand(p.job.a, p.job.b, { mode: 'local', wrap: ref.length });
    const a = r.alignment;
    expect(r.strand).toBe('reverse');
    expect([a.score, Math.round(a.identity * 100), a.columns, a.gaps, a.identities]).toEqual([
      491, 99, 100, 0, 99,
    ]);
    // The read covers plasmid bases 181 to 280, and differs at base 230.
    expect([a.startA + 1, a.endA]).toEqual([181, 280]);
    const col = a.matchLine.indexOf('.');
    expect(a.matchLine.split('.').length - 1).toBe(1);
    expect(a.startA + col + 1).toBe(230);
    expect([a.alignedA[col], a.alignedB[col]]).toEqual(['A', 'G']);
  });
});

describe('Exercise 2: four clones', () => {
  const clones = records('AL-Clones.fasta');
  const box = clones.map((c) => ({ name: c.name, sequence: c.sequence }));

  it('the box and the document make four sequences, scored as bases', () => {
    const plan = planMsa(box, 'auto', asDocument(plasmid), true);
    expect([plan.total, plan.include, plan.reason, plan.use.alphabet]).toEqual([
      4,
      true,
      null,
      'nucleotide',
    ]);
    expect(plan.names).toEqual(['AL-Plasmid', 'AL-Clone2', 'AL-Clone3', 'AL-Clone4']);
  });

  it('five columns are not conserved, and the consensus is the plasmid', () => {
    const rows = alignMultiple([ref, ...clones.map((c) => c.sequence)]).rows;
    expect(rows[0]?.length).toBe(480);
    // Base 230 (clones 2 and 3), the three bases clone 4 lacks (250 to 252), base 400 (clone 3).
    expect(notConserved(rows)).toEqual([230, 250, 251, 252, 400]);
    expect(
      summariseColumns(rows)
        .map((c) => c.consensus)
        .join(''),
    ).toBe(ref);
    expect(rows[3]?.slice(249, 252)).toBe('---');
  });
});

describe('Exercise 3: proteins', () => {
  const doc = records('AL-Protein.fasta')[0];
  const others = records('AL-Proteins.fasta');
  if (doc === undefined) throw new Error('no protein');

  it('two proteins: 98% identical, one substitution, no gap', () => {
    const p2 = others[0];
    if (p2 === undefined) throw new Error('no protein 2');
    expect(
      suggestAlignMode({ length: p2.sequence.length, isRead: false }, doc.sequence.length).mode,
    ).toBe('global');
    const a = alignPairwise(doc.sequence, p2.sequence, { mode: 'global', alphabet: 'protein' });
    expect([a.score, Math.round(a.identity * 100), a.columns, a.gaps]).toEqual([339, 98, 60, 0]);
    expect(a.matchLine.replace(/\|/g, '')).toBe('.');
    // Residue 20: N in protein 1, L in protein 2.
    expect([a.matchLine.indexOf('.') + 1, a.alignedA[19], a.alignedB[19]]).toEqual([20, 'N', 'L']);
  });

  it('four proteins: read as protein, five columns not conserved', () => {
    const box = others.map((c) => ({ name: c.name, sequence: c.sequence }));
    const plan = planMsa(box, 'auto', asDocument(plasmid), true);
    // A DNA plasmid open beside protein records is left out.
    expect([plan.include, plan.total, plan.use.alphabet]).toEqual([false, 3, 'protein']);
    const protein = {
      name: 'AL-Protein1',
      alphabet: 'protein' as const,
      length: 60,
      sequence: () => doc.sequence,
    };
    const withDoc = planMsa(box, 'auto', protein, true);
    expect([withDoc.include, withDoc.total]).toEqual([true, 4]);
    const rows = alignMultiple([doc.sequence, ...others.map((c) => c.sequence)], {
      alphabet: 'protein',
    }).rows;
    expect(notConserved(rows)).toEqual([20, 30, 31, 32, 45]);
  });
});

describe('Exercise 4: copying a range', () => {
  const clones = records('AL-Clones.fasta');
  const rows = alignMultiple([ref, ...clones.map((c) => c.sequence)]).rows;
  const names = ['AL-Plasmid', ...clones.map((c) => c.name)];
  // Four columns before the three dashes of clone 4 and five after: 246 to 257, 12 columns.
  const ctx = (row: number) => ({
    rows,
    consensus: summariseColumns(rows)
      .map((c) => c.consensus)
      .join(''),
    names,
    columns: rows[0]?.length ?? 0,
    selection: extendMsaSelection(startMsaSelection(row, 245), 256),
  });

  it('Copy gives the row’s own letters, 12 of them', () => {
    expect(msaCopyOutput(DEFAULT_MSA_COPY_OPTIONS, ctx(0))).toEqual({
      text: 'ACCAACGACCGA',
      rows: 1,
      columns: 12,
    });
    expect(ref.slice(245, 257)).toBe('ACCAACGACCGA');
  });

  it('on the row of clone 4 the same columns lose the three dashes', () => {
    expect(msaCopyOutput(DEFAULT_MSA_COPY_OPTIONS, ctx(3)).text).toBe('ACCAACCGA');
  });

  it('Advanced copy: all four rows as FASTA with names, the dashes kept', () => {
    const out = msaCopyOutput(
      { ...DEFAULT_MSA_COPY_OPTIONS, rows: 'sequences', format: 'fasta' },
      ctx(0),
    );
    expect(out).toEqual({
      text: '>AL-Plasmid\nACCAACGACCGA\n>AL-Clone2\nACCAACGACCGA\n>AL-Clone3\nACCAACGACCGA\n>AL-Clone4\nACCA---ACCGA\n',
      rows: 4,
      columns: 12,
    });
  });
});
