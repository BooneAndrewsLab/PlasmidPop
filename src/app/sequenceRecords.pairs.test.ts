import { describe, expect, it } from 'vitest';

import { findRecordPairs, readFile } from './sequenceRecords';

const fastq = (headers: string[]): File =>
  new File([headers.map((h) => `@${h}\nACGTACGT\n+\nIIIIIIII\n`).join('')], 'reads.fastq');

describe('pairing records read from a FASTQ (#415)', () => {
  it('pairs the two mates of a CASAVA header, whose read number is in the description', async () => {
    const loaded = await readFile(
      fastq(['A00:1:H:1:1101:1:1 1:N:0:ACGT', 'A00:1:H:1:1101:1:1 2:N:0:ACGT']),
    );
    expect(loaded.records.map((r) => r.name)).toEqual(['A00:1:H:1:1101:1:1', 'A00:1:H:1:1101:1:1']);
    const { pairs, ambiguous } = findRecordPairs(loaded.records);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.first).toBe(0);
    expect(pairs[0]?.second).toBe(1);
    expect(ambiguous).toHaveLength(0);
  });

  it('does not pair two same-named records that are not mates', async () => {
    const loaded = await readFile(fastq(['dup runid=abc', 'dup runid=def']));
    expect(findRecordPairs(loaded.records).pairs).toHaveLength(0);
    const plain = await readFile(fastq(['dup', 'dup']));
    expect(findRecordPairs(plain.records).pairs).toHaveLength(0);
  });

  it('does not take free text ending in a number for a mate', async () => {
    const loaded = await readFile(fastq(['dup sample 1', 'dup sample 2']));
    expect(findRecordPairs(loaded.records).pairs).toHaveLength(0);
  });

  it('does not pair two forward mates of one name', async () => {
    const loaded = await readFile(fastq(['x 1:N:0:AC', 'x 1:N:0:AC']));
    expect(findRecordPairs(loaded.records).pairs).toHaveLength(0);
  });
});
