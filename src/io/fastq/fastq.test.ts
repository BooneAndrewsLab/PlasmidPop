import { SeqDocument } from '@/core';

import { FormatError } from '../types';
import { parseFastq, writeFastq } from './fastq';

describe('parseFastq', () => {
  it('reads records with Phred+33 qualities as reads without a trace', () => {
    const r = parseFastq('@read1 runid=abc ch=12\nACGTN\n+\n!+5?I\n@read2\nGG\n+read2\nII\n');
    expect(r.format).toBe('fastq');
    expect(r.documents.map((d) => d.name)).toEqual(['read1', 'read2']);
    const [one] = r.documents;
    expect(one?.sequence.toString()).toBe('ACGTN');
    expect(one?.metadata.description).toBe('runid=abc ch=12');
    expect([...(one?.read?.qualities ?? [])]).toEqual([0, 10, 20, 30, 40]);
    expect(one?.read?.trace).toBeNull();
  });

  it('reads wrapped records, and a quality line that starts with @', () => {
    const r = parseFastq('@x\nACGT\nACGT\n+\n@@@@\nIIII\n@y\nA\n+\nI\n');
    expect(r.documents[0]?.sequence.toString()).toBe('ACGTACGT');
    expect(r.documents[0]?.read?.qualities[0]).toBe(31);
    expect(r.documents[1]?.name).toBe('y');
  });

  it('refuses a record whose quality does not match its bases', () => {
    expect(() => parseFastq('@x\nACGT\n+\nII\n')).toThrow(/2 quality values for 4 bases/);
    expect(() => parseFastq('@x\nACGT\n')).toThrow(FormatError);
    expect(() => parseFastq('x\nACGT\n+\nIIII\n')).toThrow(/"@" header/);
    expect(() => parseFastq('@x\nAXGT\n+\nIIII\n')).toThrow(/IUPAC/);
  });

  it('accepts Windows line endings and blank lines between records', () => {
    const r = parseFastq('@a\r\nAC\r\n+\r\nII\r\n\r\n@b\r\nG\r\n+\r\nI\r\n');
    expect(r.documents).toHaveLength(2);
  });

  it('warns when the qualities look like the old Phred + 64 encoding (#146)', () => {
    // Biopython's illumina_full_range: "@" (Q0 in + 64) up to "~".
    const r = parseFastq('@r1\nACGT\n+\n@Ah~\n@r2\nGG\n+\nhh\n');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.message).toMatch(/Phred \+ 64 \(Illumina 1\.3–1\.7\)/);
    // Still read as Phred + 33, as every reader does without being told.
    expect([...(r.documents[0]?.read?.qualities ?? [])]).toEqual([31, 32, 71, 93]);
  });

  it('warns about Solexa qualities, which go down to ";"', () => {
    const r = parseFastq('@r1\nACGT\n+\n;?h~\n');
    expect(r.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/Solexa/)]);
  });

  it('does not warn about Phred + 33 files, poor or very good', () => {
    expect(parseFastq('@r1\nACGT\n+\n!5?I\n@r2\nGGA\n+\n@@@\n').warnings).toEqual([]);
    // Reads of Q26 and up, and of Q31 and up, as Illumina 1.8 writes them
    // ("J" is Q41, the most it writes).
    expect(parseFastq('@r1\nACGT\n+\n;?FJ\n').warnings).toEqual([]);
    expect(parseFastq('@r1\nACGT\n+\n@FIJ\n').warnings).toEqual([]);
  });

  it('wants both a low and a high character before it calls an encoding old', () => {
    // A wide Phred + 33 range reaches "h" and past "J" but starts at "!".
    expect(parseFastq('@r1\nACGT\n+\n!5Kh\n').warnings).toEqual([]);
    expect(parseFastq('@r1\nACGT\n+\n:5Kh\n').warnings).toEqual([]);
    // Solexa's top is "h" itself, not above it.
    expect(parseFastq('@r1\nAC\n+\n;h\n').warnings).toHaveLength(1);
  });
});

describe('parseFastq odd bases and qualities (#159)', () => {
  const quals = (r: ReturnType<typeof parseFastq>): number[] => [
    ...(r.documents[0]?.read?.qualities ?? []),
  ];

  it('reads U as T and says how many', () => {
    const r = parseFastq('@r1\nACUUG\n+\nIIIII\n');
    expect(r.documents[0]?.sequence.toString()).toBe('ACTTG');
    expect(r.warnings.map((w) => w.message)).toEqual(['2 U bases read as T']);
    expect(quals(r)).toEqual([40, 40, 40, 40, 40]);
  });

  it('reads - and . as N, with a count, keeping one quality per base', () => {
    const r = parseFastq('@r1\nA-C.G\n+\n!5?I5\n');
    expect(r.documents[0]?.sequence.toString()).toBe('ANCNG');
    expect(r.warnings.map((w) => w.message)).toEqual(['2 "-" or "." bases read as N']);
    expect(quals(r)).toEqual([0, 20, 30, 40, 20]);
  });

  it('warns once for a single U', () => {
    expect(parseFastq('@r1\nAU\n+\nII\n').warnings[0]?.message).toBe('1 U base read as T');
  });

  it('says "base" for a single - or .', () => {
    expect(parseFastq('@r1\nA-\n+\nII\n').warnings[0]?.message).toBe('1 "-" or "." base read as N');
  });

  it('counts a single DEL as one quality character', () => {
    expect(parseFastq('@r1\nAC\n+\n!\x7f\n').warnings[0]?.message).toMatch(
      /^1 quality character (is|are) DEL \(0x7f\), above Q93; read as Q93$/,
    );
  });

  it('still refuses other characters in the bases', () => {
    expect(() => parseFastq('@r1\nA*C\n+\nIII\n')).toThrow(FormatError);
  });

  it('reads quality characters below "!" as 0, with a warning', () => {
    const r = parseFastq('@r1\nACG\n+\n\x1e\x1fI\n');
    expect(quals(r)).toEqual([0, 0, 40]);
    expect(r.warnings.map((w) => w.message)).toEqual(['Quality characters below "!" read as 0']);
  });

  it('clamps DEL (0x7f) to Q93 and says so', () => {
    const r = parseFastq('@r1\nACG\n+\nI\x7f\x7f\n');
    expect(quals(r)).toEqual([40, 93, 93]);
    expect(r.warnings.map((w) => w.message)).toContain(
      '2 quality characters are DEL (0x7f), above Q93; read as Q93',
    );
  });
});

describe('writeFastq (#58)', () => {
  const qualities = Uint8Array.from({ length: 94 }, (_, i) => i);
  const bases = 'ACGTN'.repeat(19).slice(0, 94);

  it('round-trips bases, qualities, name and description through parseFastq', () => {
    const doc = SeqDocument.create({
      name: 'clone 3 M13F',
      sequence: bases,
      read: { qualities, trace: null },
      metadata: { description: 'runid=abc\tch=12' },
    });
    const text = writeFastq(doc);
    expect(text.split('\n')).toHaveLength(5); // four lines and the last newline
    expect(text.startsWith('@clone_3_M13F runid=abc ch=12\n')).toBe(true);
    const back = parseFastq(text).documents[0];
    expect(back?.name).toBe('clone_3_M13F');
    expect(back?.metadata.description).toBe('runid=abc ch=12');
    expect(back?.sequence.toString()).toBe(bases);
    expect([...(back?.read?.qualities ?? [])]).toEqual([...qualities]);
    // What was read writes back the same.
    if (back !== undefined) expect(writeFastq(back)).toBe(text);
  });

  it('round-trips a file written by another tool, record by record', () => {
    const text = '@r1 x\nACGT\n+\n!5?I\n@r2\nGGA\n+\n@@@\n';
    expect(parseFastq(text).documents.map(writeFastq).join('')).toBe(text);
  });

  it('writes qualities above 93 as 93, and names a nameless read', () => {
    const doc = SeqDocument.create({
      name: ' ',
      sequence: 'AC',
      read: { qualities: Uint8Array.from([93, 120]), trace: null },
    });
    expect(writeFastq(doc)).toBe('@Untitled\nAC\n+\n~~\n');
  });

  it('refuses a document without a read', () => {
    expect(() => writeFastq(SeqDocument.create({ sequence: 'ACGT' }))).toThrow(/no base qualities/);
  });
});
