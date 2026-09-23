import { SeqDocument } from '@/core';

import { FormatError } from '../types';
import { formatFastaRecord, parseFasta, writeFasta, writeFastaRecords } from './fasta';

describe('FASTA', () => {
  it('parses multiple records with names, descriptions and wrapped sequences', () => {
    const text =
      '>seq1 first sequence\nACGT\nacgt\n\n>seq2\nNNNN\n>seq3 plasmid [topology=circular]\r\nGGCC\r\n';
    const result = parseFasta(text);
    expect(result.warnings).toEqual([]);
    expect(
      result.documents.map((d) => [
        d.name,
        d.metadata.description,
        d.sequence.toString(),
        d.topology,
      ]),
    ).toEqual([
      ['seq1', 'first sequence', 'ACGTacgt', 'linear'],
      ['seq2', '', 'NNNN', 'linear'],
      ['seq3', 'plasmid [topology=circular]', 'GGCC', 'circular'],
    ]);
  });

  it('strips gaps and digits with a warning, ignores comment lines, and rejects protein', () => {
    const result = parseFasta('; a comment\n>x\n1 ACG-T\n11 ac.gt\n');
    expect(result.documents[0]?.sequence.toString()).toBe('ACGTacgt');
    expect(result.warnings[0]?.message).toMatch(/Gap/);
    expect(() => parseFasta('>p\nMKVLLA*\n')).toThrow(FormatError);
    expect(() => parseFasta('ACGT\n')).toThrow(/start with a ">"/);
    expect(() => parseFasta('')).toThrow(/No FASTA records/);
    expect(parseFasta('>\nACGT\n').documents[0]?.name).toBe('Untitled');
  });

  it('writes 70-column records and round-trips', () => {
    const seq = 'ACGT'.repeat(40);
    const doc = SeqDocument.create({
      name: 'my plasmid',
      sequence: seq,
      topology: 'circular',
      metadata: { description: 'test vector' },
    });
    const text = writeFasta(doc);
    const lines = text.split('\n');
    expect(lines[0]).toBe('>my_plasmid test vector [topology=circular]');
    expect(lines[1]).toHaveLength(70);
    expect(lines.at(-1)).toBe('');
    const back = parseFasta(text).documents[0];
    if (back === undefined) throw new Error('expected one document');
    expect(back.sequence.toString()).toBe(seq);
    expect(back.topology).toBe('circular');
    expect(back.name).toBe('my_plasmid');
    expect(writeFasta(back)).toBe(text);
    expect(writeFastaRecords([doc, doc]).match(/^>/gm)).toHaveLength(2);
  });

  it('carries sticky ends in the header, and keeps them out of the description', () => {
    const ends = {
      left: { kind: "5'" as const, overhang: 'AATT', enzyme: 'EcoRI' },
      right: { kind: "3'" as const, overhang: 'TGCA', enzyme: 'PstI' },
    };
    const doc = SeqDocument.create({
      name: 'frag',
      sequence: 'AATTCGGATCCTGCA',
      ends,
      metadata: { description: 'insert' },
    });
    const text = writeFasta(doc);
    expect(text.split('\n')[0]).toBe(
      ">frag insert [PlasmidPop-ends: left=5' AATT/EcoRI; right=3' TGCA/PstI]",
    );
    const back = parseFasta(text).documents[0];
    expect(back?.ends).toEqual(ends);
    expect(back?.metadata.description).toBe('insert');
    // Written again, the tag is there once.
    if (back === undefined) throw new Error('no document');
    expect(writeFasta(back)).toBe(text);
    // A damaged tag is dropped rather than read half-way.
    const damaged = parseFasta('>x [PlasmidPop-ends: left=7 AA]\nACGT\n').documents[0];
    expect(damaged?.ends).toBeNull();
    expect(damaged?.metadata.description).toBe('');
  });

  it('formats a single record of any alphabet', () => {
    expect(formatFastaRecord('p frame +1', 'MKV*')).toBe('>p frame +1\nMKV*\n');
    expect(formatFastaRecord('long', 'A'.repeat(71)).split('\n')).toEqual([
      '>long',
      'A'.repeat(70),
      'A',
      '',
    ]);
  });
});
