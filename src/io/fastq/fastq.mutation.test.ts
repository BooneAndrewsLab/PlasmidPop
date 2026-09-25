import { SeqDocument } from '@/core';

import { FormatError } from '../types';
import { parseFastq, writeFastq } from './fastq';

// Survivors of the 1.6 mutation run (item 50): exact refusals with their
// line numbers, whitespace around every line, the below-"!" warning, and
// the header's name and description at their edges.

function formatError(run: () => unknown): FormatError {
  try {
    run();
  } catch (e) {
    if (e instanceof FormatError) return e;
    throw e;
  }
  throw new Error('expected a FormatError');
}

describe('parseFastq refusals, exactly', () => {
  it('says which record has no "+" line', () => {
    const e = formatError(() => parseFastq('@a\nA\n+\nI\n@x\nACGT'));
    expect(e.message).toBe('Line 5: FASTQ record has no "+" line');
    expect(e.line).toBe(5);
    expect(formatError(() => parseFastq('@x')).message).toBe(
      'Line 1: FASTQ record has no "+" line',
    );
  });

  it('numbers the header line past blank lines before it', () => {
    const e = formatError(() => parseFastq('\n\n@x\nACGT\n+\nII\n'));
    expect(e.message).toBe('Line 3: FASTQ record has 2 quality values for 4 bases');
    expect(e.line).toBe(3);
  });

  it('refuses bases that are not IUPAC as a format error on the header line', () => {
    const e = formatError(() => parseFastq('@x\nAXGT\n+\nIIII\n'));
    expect(e.message).toBe('Line 1: FASTQ sequence is not nucleotide IUPAC');
  });

  it('refuses text with no records', () => {
    for (const text of ['', '\n', '  \n\t\n']) {
      const e = formatError(() => parseFastq(text));
      expect(e.message).toBe('No FASTQ records found');
      expect(e.line).toBeUndefined();
    }
  });
});

describe('parseFastq whitespace and line endings', () => {
  it('reads old Mac line endings, a lone carriage return', () => {
    const r = parseFastq('@a\rAC\r+\rII\r');
    expect(r.documents.map((d) => d.sequence.toString())).toEqual(['AC']);
  });

  it('skips blank lines before the first record and lines of spaces between records', () => {
    const r = parseFastq('\n  \n@a\nA\n+\nI\n   \n\t\n@b\nC\n+\nI\n');
    expect(r.documents.map((d) => d.name)).toEqual(['a', 'b']);
  });

  it('trims every line: header, bases and quality', () => {
    const r = parseFastq('  @x desc  \nACGT  \n+\nIIII\t\n');
    const [doc] = r.documents;
    expect(doc?.name).toBe('x');
    expect(doc?.metadata.description).toBe('desc');
    expect(doc?.sequence.toString()).toBe('ACGT');
    expect([...(doc?.read?.qualities ?? [])]).toEqual([40, 40, 40, 40]);
  });
});

describe('parseFastq qualities below "!"', () => {
  it('warns of none for a record whose lowest quality is "!"', () => {
    const r = parseFastq('@x\nACGTN\n+\n!+5?I\n');
    expect(r.warnings).toEqual([]);
    expect([...(r.documents[0]?.read?.qualities ?? [])]).toEqual([0, 10, 20, 30, 40]);
  });

  it('reads a character below "!" as 0 and warns once, on that record’s header line', () => {
    const r = parseFastq('@a\nA\n+\nI\n@b\nACGA\n+\nI I\u0001\n');
    expect([...(r.documents[1]?.read?.qualities ?? [])]).toEqual([40, 0, 40, 0]);
    expect(r.warnings).toEqual([{ message: 'Quality characters below "!" read as 0', line: 5 }]);
  });
});

describe('parseFastq header edges', () => {
  it('names a read with no name, keeping a description that follows the "@" at once', () => {
    const [doc] = parseFastq('@ run 7 ch 3\nA\n+\nI\n').documents;
    expect(doc?.name).toBe('Untitled');
    expect(doc?.metadata.description).toBe('run 7 ch 3');
  });

  it('names a read whose header is the "@" alone', () => {
    const [doc] = parseFastq('@\nA\n+\nI\n').documents;
    expect(doc?.name).toBe('Untitled');
    expect(doc?.metadata.description).toBe('');
  });
});

describe('writeFastq header', () => {
  it('writes the name trimmed with each run of spaces one underscore, and the description on one line', () => {
    const doc = SeqDocument.create({
      name: '  clone  3 \t M13F ',
      sequence: 'AC',
      read: { qualities: Uint8Array.from([0, 40]), trace: null },
      metadata: { description: '  run  7 \n ch 3  ' },
    });
    expect(writeFastq(doc)).toBe('@clone_3_M13F run 7 ch 3\nAC\n+\n!I\n');
  });
});
