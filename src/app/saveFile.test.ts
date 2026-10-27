// @vitest-environment jsdom

import { SeqDocument } from '@/core';
import { parseGenBank } from '@/io';

import {
  DOWNLOAD_TYPE,
  asDownload,
  downloadBlob,
  downloadText,
  fileNameFor,
  saveDocument,
} from './saveFile';

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

describe('downloads (#295)', () => {
  /** What the browser was handed: the blob behind the URL and the anchor's name. */
  const captureDownloads = (): { blobs: Blob[]; names: string[] } => {
    const blobs: Blob[] = [];
    const names: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      value: (b: Blob) => {
        blobs.push(b);
        return 'blob:download';
      },
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    return { blobs, names };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is typed as no format, so iOS Safari neither renames nor previews it', () => {
    expect(DOWNLOAD_TYPE).toBe('application/octet-stream');
  });

  it('hands text over as UTF-8 bytes, typed as no format, under exactly the name given', async () => {
    const { blobs, names } = captureDownloads();
    const files = [
      ['pBR322_copy.gb', 'LOCUS       pBR322 4361 bp DNA circular\n//\n'],
      ['pUC19.fasta', '>pUC19\nACGT\n'],
      ['read.fastq', '@r\nACGT\n+\nIIII\n'],
      ['insulin.gp', 'LOCUS       ins 110 aa\n//\n'],
      ['insulin.faa', '>ins\nMALW\n'],
      ['pUC19_map.svg', '<svg xmlns="http://www.w3.org/2000/svg">µ</svg>'],
      ['primers.csv', 'name,sequence\nM13F,GTAAAACGACGGCCAGT\n'],
      ['alignment.aln', 'CLUSTAL\n'],
    ] as const;
    for (const [name, text] of files) downloadText(name, text);
    expect(names).toEqual(files.map(([name]) => name));
    for (const [i, [, text]] of files.entries()) {
      expect(blobs[i]?.type).toBe(DOWNLOAD_TYPE);
      expect(await blobs[i]?.text()).toBe(text);
    }
  });

  it('retypes a blob made as a format, bytes and name untouched', async () => {
    const { blobs, names } = captureDownloads();
    const made = [
      ['pUC19_map.svg', new Blob(['<svg/>'], { type: 'image/svg+xml;charset=utf-8' })],
      ['pUC19.pdf', new Blob(['%PDF-1.3'], { type: 'application/pdf' })],
      [
        'pUC19_map.png',
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
      ],
      ['pUC19_pages.zip', new Blob([new Uint8Array([0x50, 0x4b])], { type: 'application/zip' })],
      ['pUC19.dna', new Blob([new Uint8Array([0x09, 0, 0])], { type: 'application/octet-stream' })],
      ['notes.gb', new Blob(['LOCUS'], { type: 'text/plain;charset=utf-8' })],
    ] as const;
    for (const [name, blob] of made) downloadBlob(name, blob);
    expect(names).toEqual(made.map(([name]) => name));
    for (const [i, [, blob]] of made.entries()) {
      const handed = blobs[i];
      if (handed === undefined) throw new Error(`no download for ${String(i)}`);
      expect(handed.type).toBe(DOWNLOAD_TYPE);
      expect(new Uint8Array(await handed.arrayBuffer())).toEqual(
        new Uint8Array(await blob.arrayBuffer()),
      );
    }
  });

  it('leaves a blob already typed as no format as it is', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: DOWNLOAD_TYPE });
    expect(asDownload(blob)).toBe(blob);
  });
});
