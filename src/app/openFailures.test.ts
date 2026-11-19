// @vitest-environment jsdom
import { strToU8, zipSync } from 'fflate';
import { type MockInstance } from 'vitest';

import { OPEN_FAILURE_REASONS, openFailureReason, readSequenceData, readZip } from '@/io';

import { analytics, formatOfFileName, openFailedName } from './analytics';
import { ACCEPTED_FORMATS, describeOpenFailure, openFile } from './openFile';
import { editorStore } from './state/editorStore';

/** One small synthetic input per class of failed open (#447, item 38). */
async function failureOf(bytes: Uint8Array, name: string) {
  const buffer = bytes.slice().buffer;
  try {
    await readSequenceData(buffer, name);
  } catch (e) {
    return describeOpenFailure(e);
  }
  throw new Error('expected the open to fail');
}

describe('why an open fails (#447)', () => {
  it('names an unrecognised format and lists the accepted ones', async () => {
    const f = await failureOf(strToU8('name,age\nann,3\n'), 'people.csv');
    expect(f.reason).toBe('unrecognised-format');
    expect(f.message).toContain(ACCEPTED_FORMATS);
  });

  it('calls prose in a .txt unrecognised, not a sequence', async () => {
    const f = await failureOf(strToU8('Dear Ann, the plasmid is in the freezer.'), 'note.txt');
    expect(f.reason).toBe('unrecognised-format');
  });

  it('calls an empty or blank file empty', async () => {
    expect((await failureOf(new Uint8Array(0), 'a.gb')).reason).toBe('empty');
    const blank = await failureOf(strToU8('  \n\n '), 'a.fasta');
    expect(blank.reason).toBe('empty');
    expect(blank.message).toContain('empty');
  });

  it('calls a file with NUL bytes binary (PDF, image, UTF-16 text)', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect((await failureOf(png, 'map.png')).reason).toBe('binary');
    const utf16 = Uint8Array.from([0xff, 0xfe, 0x3e, 0, 0x61, 0, 0x0a, 0, 0x61, 0]);
    expect((await failureOf(utf16, 'a.fasta')).reason).toBe('binary');
  });

  it('calls a damaged gzip corrupt', async () => {
    const f = await failureOf(Uint8Array.from([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6]), 'r.fastq.gz');
    expect(f.reason).toBe('corrupt');
  });

  it('calls a truncated AB1 or SnapGene file corrupt', async () => {
    const ab1 = Uint8Array.from([...strToU8('ABIF'), 0, 101, 0, 0]);
    expect((await failureOf(ab1, 'x.ab1')).reason).toBe('corrupt');
  });

  it('calls a parser complaint a parse error', async () => {
    const gb = await failureOf(strToU8('LOCUS x 4 bp\nORIGIN\n        1 ac?!\n//\n'), 'x.gb');
    expect(gb.reason).toBe('parse-error');
    const fq = await failureOf(strToU8('@r1\nACGT\n'), 'x.fastq');
    expect(fq.reason).toBe('parse-error');
    // The extension said FASTA, the content is not: unrecognised, not damaged.
    const fa = await failureOf(strToU8('12345678 !!\n'), 'x.fa');
    expect(fa.reason).toBe('unrecognised-format');
  });

  it('classes anything that is not a FormatError as other', () => {
    expect(describeOpenFailure(new TypeError('boom')).reason).toBe('other');
    expect(describeOpenFailure('text').reason).toBe('other');
  });

  it('calls an archive over its limits too large', () => {
    const zip = zipSync({ 'a.gb': strToU8('x'), 'b.gb': strToU8('y') });
    let caught: unknown;
    try {
      readZip(zip, { maxEntries: 1, maxEntryBytes: 10, maxTotalBytes: 10 });
    } catch (e) {
      caught = e;
    }
    expect(openFailureReason(caught)).toBe('too-large');
  });

  it('keeps every reason in the fixed list', () => {
    expect([...OPEN_FAILURE_REASONS].sort()).toEqual(
      [
        'binary',
        'corrupt',
        'empty',
        'other',
        'parse-error',
        'too-large',
        'unreadable',
        'unrecognised-format',
        'unsupported',
      ].sort(),
    );
  });
});

describe('the open-failed event name (#447)', () => {
  let track: MockInstance<typeof analytics.track>;
  beforeEach(() => {
    editorStore.closeAllDocuments();
    track = vi.spyOn(analytics, 'track').mockImplementation(() => undefined);
  });
  afterEach(() => {
    track.mockRestore();
  });

  it('is the guessed format and the reason, never the file name or the message', async () => {
    const secret = 'secret-project-x.docx';
    const opened = await openFile(new File(['PK-not-really text'], secret));
    expect(opened).toBeNull();
    expect(track).toHaveBeenCalledWith('file', 'open-failed', 'other:unrecognised-format');
    expect(JSON.stringify(track.mock.calls)).not.toContain('secret');
    expect(editorStore.getState().error).toContain(ACCEPTED_FORMATS);
  });

  it('reports an empty file with its format guess', async () => {
    await openFile(new File([], 'a.gb'));
    expect(track).toHaveBeenCalledWith('file', 'open-failed', 'genbank:empty');
  });

  it('reports a Geneious file as unsupported', async () => {
    await openFile(new File(['x'], 'a.geneious'));
    expect(track).toHaveBeenCalledWith('file', 'open-failed', 'geneious:unsupported');
  });

  it('reports a damaged ZIP as corrupt, and does not count a skipped member', async () => {
    const bad = Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8]);
    await openFile(new File([bad.slice().buffer], 'z.zip'));
    expect(track).toHaveBeenCalledWith('file', 'open-failed', 'other:corrupt');
    track.mockClear();
    const ok = zipSync({ 'a.csv': strToU8('x,y\n') });
    await openFile(new File([ok.slice().buffer], 'z.zip'));
    expect(track).not.toHaveBeenCalled();
  });

  it('builds names only from fixed halves', () => {
    expect(openFailedName('Anything.weird', 'empty')).toBe(`${formatOfFileName('x')}:empty`);
  });
});
