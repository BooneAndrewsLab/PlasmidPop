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
