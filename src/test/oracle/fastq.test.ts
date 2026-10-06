import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FormatError, parseFastq } from '@/io';

import oracle from './fastq.json';

/**
 * FASTQ reading against Biopython (scripts/oracle/fastq.py), on Biopython's
 * own Tests/Quality files in src/io/fixtures/fastq: the valid ones must give
 * the same count, ids, bases and Phred qualities, and the truncated or ragged
 * ones must be refused, as Biopython refuses them. Files Biopython refuses
 * and we read, or the reverse (control characters as qualities, '-' or '.'
 * as bases), are left out (#159).
 */

const dir = fileURLToPath(new URL('../../io/fixtures/fastq', import.meta.url));
const text = (file: string): string => readFileSync(join(dir, file), 'utf8');

describe('FASTQ reader against Biopython', () => {
  it('has files of both kinds to compare', () => {
    expect(oracle.valid.length).toBeGreaterThanOrEqual(30);
    expect(oracle.refused.length).toBeGreaterThanOrEqual(14);
  });

  it.each(oracle.valid.map((f) => [f.file, f] as const))(
    'reads %s as Biopython does',
    (_file, expected) => {
      const { documents } = parseFastq(text(expected.file));
      expect(documents.map((d) => d.name)).toEqual(expected.records.map((r) => r.id));
      expect(documents.map((d) => d.sequence.toString())).toEqual(
        expected.records.map((r) => r.sequence.toUpperCase()),
      );
      expect(documents.map((d) => [...(d.read?.qualities ?? [])])).toEqual(
        expected.records.map((r) => r.qualities),
      );
    },
  );

  it.each(oracle.refused.map((f) => [f.file, f.error] as const))('refuses %s (%s)', (file) => {
    expect(() => parseFastq(text(file))).toThrow(FormatError);
  });
});
