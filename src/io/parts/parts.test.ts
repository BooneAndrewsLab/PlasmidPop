import { describe, expect, it } from 'vitest';

import { type MyPart } from '@/core';

import {
  databaseStem,
  pairPlannotateFiles,
  readDelimited,
  readDescriptions,
  readFastaRecords,
  readPartsFile,
  readPlannotate,
  writePartsGenBank,
} from './index';

const PROMOTER = 'TTGACAATTAATCATCGGCTCGTATAATGTGTGGA';

describe('readFastaRecords', () => {
  it('takes the first word of a header as the id and strips whitespace from the sequence', () => {
    expect(readFastaRecords('>a1 some text\nAC GT\nACGT\n>b\r\nMKV*\r\n')).toEqual([
      { id: 'a1', description: 'some text', sequence: 'ACGTACGT' },
      { id: 'b', description: '', sequence: 'MKV' },
    ]);
  });
});

describe('readDelimited', () => {
  it('handles quotes, doubled quotes, embedded newlines and CRLF', () => {
    expect(readDelimited('a,"b,1","c ""q""\nx"\r\nd,,\n', ',')).toEqual([
      ['a', 'b,1', 'c "q"\nx'],
      ['d', '', ''],
    ]);
  });
});

describe('readDescriptions', () => {
  it('reads pLannotate current columns', () => {
    const m = readDescriptions(
      'sseqid,name,type,blurb\nT7_promoter,T7 promoter,promoter,"for T7, phage"\n',
    );
    expect(m.get('T7_promoter')).toEqual({
      name: 'T7 promoter',
      type: 'promoter',
      blurb: 'for T7, phage',
    });
  });

  it('reads the legacy columns, in any case, and keeps the first row of an id', () => {
    const m = readDescriptions(
      'sseqid,Feature,Type,Description\nCmR_(2),CmR,CDS,first\nCmR_(2),dup,CDS,second\n',
    );
    expect(m.get('CmR_(2)')).toEqual({ name: 'CmR', type: 'CDS', blurb: 'first' });
  });

  it('accepts id/accession aliases and tab separation', () => {
    const m = readDescriptions('Accession\tGene\tdesc\nX1\tfoo\tbar\n');
    expect(m.get('X1')).toEqual({ name: 'foo', type: '', blurb: 'bar' });
  });

  it('reads the headerless slug, name, blurb TSV of the FPbase gatherer', () => {
    const m = readDescriptions('egfp\tEGFP\tEGFP is a green fluorescent protein.\n');
    expect(m.get('egfp')).toEqual({
      name: 'EGFP',
      type: '',
      blurb: 'EGFP is a green fluorescent protein.',
    });
  });
});

describe('readPlannotate', () => {
  it('maps name, type and description onto parts labelled with the database', () => {
    const r = readPlannotate(
      `>T7_promoter\n${PROMOTER}\n>unlisted extra words\n${PROMOTER}A\n`,
      'sseqid,name,type,blurb\nT7_promoter,T7 promoter,promoter,Phage promoter\n',
      'snapgene',
    );
    expect(r).toMatchObject({ records: 2, described: 1 });
    expect(r.drafts).toEqual([
      {
        name: 'T7 promoter',
        type: 'promoter',
        sequence: PROMOTER,
        notes: 'Phage promoter',
        origin: 'pLannotate: snapgene',
      },
      {
        name: 'unlisted',
        type: 'misc_feature',
        sequence: `${PROMOTER}A`,
        notes: 'extra words',
        origin: 'pLannotate: snapgene',
      },
    ]);
  });

  it('reads an FPbase protein FASTA as parts matched by protein', () => {
    const r = readPlannotate(
      '>egfp\nMVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKF\n',
      'egfp\tEGFP\tGreen\n',
      'fpbase',
    );
    expect(r.drafts).toEqual([
      {
        name: 'EGFP',
        type: 'CDS',
        sequence: '',
        protein: 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKF',
        notes: 'Green',
        origin: 'pLannotate: fpbase',
      },
    ]);
  });
});

describe('pairing chosen files', () => {
  const f = (name: string, text: string) => ({ name, text });
  it('pairs a table with the FASTA of the same stem', () => {
    const { pairs, unpaired } = pairPlannotateFiles([
      f('fpbase.csv', 'a,b'),
      f('snapgene.fasta', '>x\nACGT'),
      f('fpbase.fasta', '>y\nMK'),
      f('snapgene.csv', 'a,b'),
    ]);
    expect(pairs.map((p) => [p.list, p.table?.name])).toEqual([
      ['snapgene', 'snapgene.csv'],
      ['fpbase', 'fpbase.csv'],
    ]);
    expect(unpaired).toEqual([]);
  });

  it('pairs a lone table with a lone FASTA whatever it is called', () => {
    const { pairs } = pairPlannotateFiles([f('x.fa', '>x\nACGT'), f('descriptions.tsv', 'a\tb')]);
    expect(pairs[0]?.table?.name).toBe('descriptions.tsv');
  });

  it('strips description suffixes from a stem', () => {
    expect(databaseStem('C:\\data\\snapgene_descriptions.csv')).toBe('snapgene');
  });

  it('reports a table with no FASTA', () => {
    const { pairs, unpaired } = pairPlannotateFiles([f('snapgene.csv', 'a,b')]);
    expect(pairs).toEqual([]);
    expect(unpaired).toHaveLength(1);
  });
});

describe('parts as GenBank', () => {
  const parts: MyPart[] = [
    {
      id: '1',
      name: 'my promoter',
      type: 'promoter',
      sequence: PROMOTER,
      notes: 'in-house',
      origin: 'My parts',
    },
    {
      id: '2',
      name: 'tag',
      type: 'CDS',
      sequence: '',
      protein: 'DYKDDDDK',
      notes: '',
      origin: 'My parts',
    },
  ];

  it('writes one record per part, counts the protein-only ones, and reads back the same parts', () => {
    const { text, skipped } = writePartsGenBank(parts);
    expect(skipped).toBe(1);
    expect(readPartsFile(text, 'my-parts.gb')).toEqual([
      {
        name: 'my promoter',
        type: 'promoter',
        sequence: PROMOTER,
        notes: 'in-house',
        origin: 'My parts',
      },
    ]);
  });

  it('writes nothing for no DNA parts', () => {
    expect(writePartsGenBank([]).text).toBe('');
  });

  it('reads a FASTA of parts and refuses other files', () => {
    expect(readPartsFile(`>lox\n${PROMOTER}\n`, 'p.fa')).toMatchObject([
      { name: 'lox', sequence: PROMOTER },
    ]);
    expect(() => readPartsFile('hello there, not a sequence', 'a.pdf')).toThrow(/GenBank or FASTA/);
  });
});
