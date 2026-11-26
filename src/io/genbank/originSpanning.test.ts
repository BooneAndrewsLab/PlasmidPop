import { type SeqDocument, translateCds } from '@/core';

import { parseGenBank } from './parseGenBank';
import { writeGenBank } from './writeGenBank';

// 30 bp: bases 28..30 then 1..6 read ATG GCC TAA, so a CDS across the end
// translates to M A *.
const SEQ = `GCCTAA${'C'.repeat(21)}ATG`;
const ORIGIN = `ORIGIN\n        1 ${SEQ.slice(0, 10)} ${SEQ.slice(10, 20)} ${SEQ.slice(20)}\n//\n`;

function record(locus: string, features: string[]): string {
  return `${locus}\nFEATURES             Location/Qualifiers\n${features.join('\n')}\n${ORIGIN}`;
}

const LINEAR = 'LOCUS       X                         30 bp    DNA     linear   SYN 01-JAN-2020';
const WRAPPING = [
  '     CDS             28..6',
  '                     /label="wrapper"',
  '                     /codon_start=1',
  '     misc_feature    complement(29..3)',
  '     misc_feature    10..12',
];

function only(doc: readonly SeqDocument[]): SeqDocument {
  const d = doc[0];
  if (d === undefined) throw new Error('expected a document');
  return d;
}

describe('features across the end of a linear record (#462)', () => {
  it('by default drops them with the warning and says how many there were', () => {
    const result = parseGenBank(record(LINEAR, WRAPPING));
    const doc = only(result.documents);
    expect(doc.topology).toBe('linear');
    expect(doc.features.size).toBe(1);
    expect(
      result.warnings.filter((w) => w.message.includes('spans the origin of a linear')),
    ).toHaveLength(2);
    expect(result.originSpanning).toEqual([2]);
  });

  it('with wrappingAsCircular opens circular and keeps them, with no warning', () => {
    const result = parseGenBank(record(LINEAR, WRAPPING), { wrappingAsCircular: true });
    const doc = only(result.documents);
    expect(doc.topology).toBe('circular');
    expect(doc.features.size).toBe(3);
    expect(result.warnings).toEqual([]);
    expect(result.originSpanning).toEqual([2]);
  });

  it('translates a wrapping CDS across the end', () => {
    const doc = only(
      parseGenBank(record(LINEAR, WRAPPING), { wrappingAsCircular: true }).documents,
    );
    const cds = doc.features.all().find((f) => f.type === 'CDS');
    if (cds === undefined) throw new Error('CDS missing');
    expect(translateCds(doc, cds).protein).toBe('MA*');
  });

  it('writes the circular LOCUS and reads the same document back', () => {
    const doc = only(
      parseGenBank(record(LINEAR, WRAPPING), { wrappingAsCircular: true }).documents,
    );
    const text = writeGenBank(doc);
    expect(text).toMatch(/^LOCUS .* circular /);
    expect(text).toContain('CDS             join(28..30,1..6)');
    const back = parseGenBank(text);
    expect(back.originSpanning).toBeUndefined();
    const again = only(back.documents);
    expect(again.topology).toBe('circular');
    expect(again.features.all().map((f) => f.segments)).toEqual(
      doc.features.all().map((f) => f.segments),
    );
    expect(back.warnings).toEqual([]);
  });

  it('a record with no topology on its LOCUS line is asked about as well', () => {
    const result = parseGenBank(record('LOCUS       X 30 bp DNA', WRAPPING));
    expect(result.originSpanning).toEqual([2]);
    expect(
      only(
        parseGenBank(record('LOCUS       X 30 bp DNA', WRAPPING), { wrappingAsCircular: true })
          .documents,
      ).topology,
    ).toBe('circular');
  });

  it('a circular LOCUS never asks and keeps them', () => {
    const circular = LINEAR.replace('linear  ', 'circular');
    const result = parseGenBank(record(circular, WRAPPING));
    expect(result.originSpanning).toBeUndefined();
    expect(only(result.documents).features.size).toBe(3);
  });

  it('features out of bounds for other reasons do not count', () => {
    const result = parseGenBank(
      record(LINEAR, ['     misc_feature    5..50', '     misc_feature    0..3', '     gene 2..4']),
      { wrappingAsCircular: true },
    );
    expect(result.originSpanning).toBeUndefined();
    expect(only(result.documents).topology).toBe('linear');
    expect(result.warnings.filter((w) => w.message.includes('outside the sequence'))).toHaveLength(
      2,
    );
  });

  it('a linear join of end and start pieces is not a wrapping range', () => {
    const result = parseGenBank(record(LINEAR, ['     misc_feature    join(28..30,1..6)']));
    expect(result.originSpanning).toBeUndefined();
    expect(only(result.documents).features.size).toBe(1);
  });

  it('in a many-record file only the records with such features turn circular', () => {
    const text = record(LINEAR, WRAPPING) + record(LINEAR, ['     misc_feature    10..12']);
    const result = parseGenBank(text, { wrappingAsCircular: true });
    expect(result.originSpanning).toEqual([2, 0]);
    expect(result.documents.map((d) => d.topology)).toEqual(['circular', 'linear']);
  });
});
