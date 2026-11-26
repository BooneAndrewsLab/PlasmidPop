import { describe, expect, it } from 'vitest';

import { parseSequenceFile } from './detect';
import { FormatError } from './types';

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof FormatError) return e.message;
    throw e;
  }
  throw new Error('did not throw');
}

const RECORD =
  'LOCUS       t   8 bp    DNA     linear   01-JAN-2000\nORIGIN\n        1 acgtacgt\n//\n';

describe('failure hints (#465)', () => {
  it('says a one-line record with literal \\n sequences is JSON-escaped', () => {
    const escaped = RECORD.replace(/\n/g, '\\n');
    const m = message(() => parseSequenceFile(escaped, 'x.gb'));
    expect(m).toMatch(/JSON-escaped/);
    expect(m).toMatch(/plain text/);
    expect(message(() => parseSequenceFile('>a\\nACGT\\n', 'x.fa'))).toMatch(/JSON-escaped/);
    expect(message(() => parseSequenceFile(RECORD.replace(/\n/g, '\\r\\n'), 'x.gb'))).toMatch(
      /JSON-escaped/,
    );
  });

  it('names a stray backslash-n in a multi-line file only as a possibility', () => {
    expect(parseSequenceFile(RECORD, 'x.gb').documents).toHaveLength(1);
    const m = message(() => parseSequenceFile('>a\nAC\\nGT\n', 'x.fa'));
    expect(m).toMatch(/may be JSON-escaped/); // backslash plus n among the bases
  });

  it('hints at "*" and "." only', () => {
    expect(
      message(() => parseSequenceFile(RECORD.replace('acgtacgt', 'acgt*cgt'), 'x.gb')),
    ).toMatch(/stop codon/);
    expect(
      message(() => parseSequenceFile(RECORD.replace('acgtacgt', 'acgt.cgt'), 'x.gb')),
    ).toMatch(/gap or a missing base/);
    const hash = message(() => parseSequenceFile(RECORD.replace('acgtacgt', 'acgt#cgt'), 'x.gb'));
    expect(hash).toMatch(/IUPAC nucleotide alphabet: "#"$/);
  });

  it('says what No LOCUS looked for, and the likely cause', () => {
    const none = message(() => parseSequenceFile('hello world\nmore', 'x.gb'));
    expect(none).toMatch(/^No LOCUS line found; not a GenBank file/);
    expect(none).toMatch(/begins with "hello world"/);
    expect(message(() => parseSequenceFile('​LOCUS x 1 bp\n', 'x.gb'))).toMatch(/U\+200B/);
    expect(message(() => parseSequenceFile('ID   X; SV 1;\nSQ\n', 'x.gb'))).toMatch(/EMBL/);
    expect(message(() => parseSequenceFile('FEATURES   Location\nORIGIN\n', 'x.gb'))).toMatch(
      /cut off/,
    );
    const long = message(() => parseSequenceFile('x'.repeat(50) + '\nfoo', 'x.gb'));
    expect(long).toContain(`"${'x'.repeat(20)}…"`);
    expect(long).not.toContain('x'.repeat(21));
  });
});

describe('JSON-escaped text with a real carriage return after each \\n (#465)', () => {
  it('is still named, but a file with one stray \\n is not', () => {
    const mixed = RECORD.replace(/\n/g, '\\n\r');
    expect(message(() => parseSequenceFile(mixed, 'x.gb'))).toMatch(/JSON-escaped/);
    const stray = RECORD.replace('ORIGIN', 'ORIGIN \\n');
    expect(parseSequenceFile(stray, 'x.gb').documents).toHaveLength(1);
  });
});
