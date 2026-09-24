import { parseGenBank, writeGenBank } from '@/io/genbank';

import { parseSequenceData } from '../detect';
import { parseSnapGene } from './parseSnapGene';

/**
 * The flags byte at the head of a SnapGene sequence packet (#45, item 44):
 * bit 0 circular, bit 1 Dam, bit 2 Dcm, bit 3 EcoKI. Every one of the 16
 * low-nibble values is read, from a synthetic file built in memory (the
 * same packet layout `parseSnapGene.test.ts` builds; no SnapGene file is
 * read): topology from bit 0 alone, the host from bits 1 and 2 alone, and
 * bit 3 changing nothing, since no enzyme in the table is blocked by
 * EcoKI. The setting then survives the trip out through GenBank.
 */

const enc = new TextEncoder();

function packet(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

const SEQ = 'GATCCTGGAAGCTTACGTACGTAC';

/** A minimal .dna file whose sequence packet starts with `flags`. */
function file(flags: number): Uint8Array {
  const cookie = concat([enc.encode('SnapGene'), new Uint8Array([0, 1, 0, 15, 0, 19])]);
  return concat([
    packet(0x09, cookie),
    packet(0x00, concat([new Uint8Array([flags]), enc.encode(SEQ)])),
    packet(0x08, enc.encode('<AdditionalSequenceProperties/>')),
  ]);
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const FLAGS = Array.from({ length: 16 }, (_, n) => n);

describe('the SnapGene sequence flags', () => {
  it.each(FLAGS)('reads flags %i bit by bit', (flags) => {
    const doc = must(parseSnapGene(file(flags), 'x.dna').documents[0], 'a document');
    expect(doc.sequence.toString()).toBe(SEQ);
    expect(doc.topology).toBe((flags & 1) !== 0 ? 'circular' : 'linear');
    expect(doc.methylation).toEqual({ dam: (flags & 2) !== 0, dcm: (flags & 4) !== 0 });
  });

  it('ignores bit 3 (EcoKI): each value reads as the one without it', () => {
    for (const flags of FLAGS.filter((f) => (f & 8) !== 0)) {
      const withIt = must(parseSnapGene(file(flags)).documents[0], 'a document');
      const without = must(parseSnapGene(file(flags & 7)).documents[0], 'a document');
      expect(withIt.topology).toBe(without.topology);
      expect(withIt.methylation).toEqual(without.methylation);
      expect(withIt.features.all()).toEqual(without.features.all());
    }
  });

  it('reads the same through format detection, and keeps the host through GenBank', () => {
    for (const flags of FLAGS) {
      const doc = must(parseSequenceData(file(flags), 'x.dna').documents[0], 'a document');
      expect(doc.methylation).toEqual({ dam: (flags & 2) !== 0, dcm: (flags & 4) !== 0 });
      const back = must(parseGenBank(writeGenBank(doc)).documents[0], 'a record');
      expect(back.methylation).toEqual(doc.methylation);
      expect(back.topology).toBe(doc.topology);
    }
  });
});
