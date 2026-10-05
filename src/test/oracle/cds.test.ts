import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { firstQualifier } from '@/core';
import { translateCds } from '@/core/analysis/cdsTranslation';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './cds.json';

/**
 * Conceptual translation of CDS features against NCBI's own /translation
 * qualifiers (scripts/oracle/cds.py): every CDS with a protein_id in the NCBI
 * fixtures and in ncbi-cds.gbk, sixteen small real records chosen for
 * /codon_start 2 and 3, /transl_table 2, 4, 5 and 9, complement, multi-exon
 * join and partial ends. Biopython translates the same features in the
 * generator and has to agree, except where /transl_except applies. A
 * 3'-partial CDS ending in a two-base codon is left out (issue #142).
 */

interface Case {
  readonly file: string;
  readonly where: 'fixture' | 'oracle';
  readonly record: number;
  readonly recordId: string;
  readonly proteinId: string;
  readonly translation: string;
}

function textOf(c: Case): string {
  return c.where === 'fixture'
    ? readFixture(c.file)
    : readFileSync(fileURLToPath(new URL(`./${c.file}`, import.meta.url)), 'utf8');
}

describe('CDS translation against NCBI /translation', () => {
  const cases = oracle.cases as readonly Case[];

  it('covers the reading frames, codes and layouts the NCBI records offer', () => {
    expect(cases.length).toBeGreaterThan(30);
    const kinds = new Set(oracle.cases.map((c) => `${c.codonStart}/${c.translTable}`));
    for (const k of ['2/1', '3/1', '1/2', '1/4', '2/4', '3/5', '2/9']) expect(kinds).toContain(k);
  });

  it('translates every CDS as NCBI did', () => {
    const problems: string[] = [];
    const parsed = new Map<string, ReturnType<typeof parseGenBank>>();
    for (const c of cases) {
      let file = parsed.get(c.file);
      if (file === undefined) {
        file = parseGenBank(textOf(c));
        parsed.set(c.file, file);
      }
      const doc = file.documents[c.record];
      if (doc === undefined) {
        problems.push(`${c.recordId}: record missing`);
        continue;
      }
      const feature = doc.features
        .all()
        .find((f) => f.type === 'CDS' && firstQualifier(f, 'protein_id') === c.proteinId);
      if (feature === undefined) {
        problems.push(`${c.recordId} ${c.proteinId}: feature missing`);
        continue;
      }
      const ours = translateCds(doc, feature).protein.replace(/\*$/, '');
      if (ours !== c.translation) {
        problems.push(
          `${c.recordId} ${c.proteinId}: ${ours.slice(0, 40)} vs ${c.translation.slice(0, 40)}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
