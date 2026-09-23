import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { detectFormat, parseSequenceData, readSequenceData } from './detect';

const abif = join(fileURLToPath(new URL('./fixtures/abif', import.meta.url)));

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('reads (#49)', () => {
  it('opens an AB1 file by its signature, named after the file', () => {
    const r = parseSequenceData(
      new Uint8Array(readFileSync(join(abif, 'sanger.ab1'))),
      'clone3.ab1',
    );
    expect(r.format).toBe('abif');
    expect(r.documents[0]?.name).toBe('clone3');
    expect(r.documents[0]?.read?.trace).not.toBeNull();
  });

  it('detects FASTQ by its @ header, and by extension', () => {
    expect(detectFormat('@r\nACGT\n+\nIIII\n')).toBe('fastq');
    expect(detectFormat('', 'reads.fq')).toBe('fastq');
  });

  it('decompresses a gzipped FASTQ', async () => {
    const text = '@r1\nACGT\n+\nIIII\n';
    const r = await readSequenceData(buffer(gzipSync(text)), 'reads.fastq.gz');
    expect(r.format).toBe('fastq');
    expect(r.documents[0]?.sequence.toString()).toBe('ACGT');
  });

  it('says so when handed gzip it cannot decompress', async () => {
    const broken = Uint8Array.from([0x1f, 0x8b, 1, 2, 3, 4]);
    await expect(readSequenceData(buffer(broken), 'x.gz')).rejects.toThrow(
      /could not be decompressed/,
    );
    expect(() => parseSequenceData(broken)).toThrow(/gzipped/);
  });
});
