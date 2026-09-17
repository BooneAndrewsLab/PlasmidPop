import { SeqDocument } from '@/core';
import { parseGenBank } from '@/io';

import { fileNameFor, saveDocument } from './saveFile';

describe('saveFile', () => {
  const doc = SeqDocument.create({
    name: 'my plasmid: v2/final',
    sequence: 'ACGTACGT',
    topology: 'circular',
  });

  it('builds safe file names', () => {
    expect(fileNameFor(doc, 'genbank')).toBe('my_plasmid__v2_final.gb');
    expect(fileNameFor(doc, 'fasta')).toBe('my_plasmid__v2_final.fasta');
    expect(fileNameFor(SeqDocument.create({ name: '  ', sequence: 'A' }), 'genbank')).toBe(
      'Untitled.gb',
    );
  });

  it('hands the serialized document to the downloader', () => {
    const download = vi.fn();
    saveDocument(doc, 'genbank', download);
    expect(download).toHaveBeenCalledTimes(1);
    const [name, text] = download.mock.calls[0] as [string, string];
    expect(name).toBe('my_plasmid__v2_final.gb');
    const back = parseGenBank(text).documents[0];
    expect(back?.sequence.toString()).toBe('ACGTACGT');
    expect(back?.topology).toBe('circular');
    saveDocument(doc, 'fasta', download);
    expect((download.mock.calls[1] as [string, string])[1]).toMatch(/^>my_plasmid:_v2\/final/);
  });
});
