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

describe('FASTA and the host methylation (#71)', () => {
  const HOSTS = [
    { dam: true, dcm: true },
    { dam: true, dcm: false },
    { dam: false, dcm: true },
    { dam: false, dcm: false },
  ] as const;

  it('round-trips every host, and writes a tag only for one that is not the default', () => {
    for (const host of HOSTS) {
      const doc = SeqDocument.create({ name: 'p1', sequence: 'ACGTGATC', methylation: host });
      const text = writeFasta(doc);
      const plain = host.dam && host.dcm;
      expect(text.includes('PlasmidPop-methylation')).toBe(!plain);
      const back = parseFasta(text).documents[0];
      expect(back?.methylation).toEqual(host);
      // The tag is ours: it leaves the description on read and is written once.
      expect(back?.metadata.description).not.toContain('PlasmidPop-methylation');
      if (back !== undefined) expect(writeFasta(back)).toBe(text);
    }
  });

  it('sits beside the ends tag and the topology tag, in either order', () => {
    const doc = SeqDocument.create({
      name: 'frag',
      sequence: 'AATTCGGG',
      ends: {
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: 'blunt', overhang: '', enzyme: null },
      },
      methylation: { dam: false, dcm: false },
      metadata: { description: 'insert' },
    });
    const text = writeFasta(doc);
    const back = parseFasta(text).documents[0];
    expect(back?.ends).toEqual(doc.ends);
    expect(back?.methylation).toEqual({ dam: false, dcm: false });
    expect(back?.metadata.description).toBe('insert');
    const swapped =
      ">frag insert [PlasmidPop-methylation: dam-; dcm-] [PlasmidPop-ends: left=5' AATT/EcoRI; right=blunt]\nAATTCGGG\n";
    const other = parseFasta(swapped).documents[0];
    expect(other?.ends).toEqual(doc.ends);
    expect(other?.methylation).toEqual({ dam: false, dcm: false });
  });

  it('keeps a tag it cannot read as part of the description, through a save', () => {
    const text = '>p1 note [PlasmidPop-methylation: garbage]\nACGT\n';
    const back = parseFasta(text).documents[0];
    expect(back?.methylation).toEqual({ dam: true, dcm: true });
    expect(back?.metadata.description).toContain('[PlasmidPop-methylation: garbage]');
    if (back !== undefined) expect(writeFasta(back)).toContain('[PlasmidPop-methylation: garbage]');
  });
});
