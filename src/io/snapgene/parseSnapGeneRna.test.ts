import { firstQualifier } from '@/core';
import { parseGenBank, writeGenBank } from '@/io/genbank';
import { listLocalSnapGeneRnaFiles } from '@/test/fixtures';

import { parseSequenceData, readSequenceData } from '../detect';
import { FormatError } from '../types';
import { isSnapGene, parseSnapGene } from './parseSnapGene';

/**
 * SnapGene .rna files (#112). The layout is the one SnapGene 8.2's two sample
 * RNAs have (ECO 16S rRNA, Homo sapiens mitochondrial tRNA-Ala), which cannot
 * be committed: the cookie's kind of sequence is 7 where a .dna has 1, the
 * bases come in packet 0x20 after a flags byte of 0 (T for U, never U), and
 * features (0x0A), notes (0x06), properties (0x08) and primers (0x05) are the
 * packets a .dna has. The file built here follows that layout; the tests at
 * the end read the real ones when SnapGene is installed.
 */

const enc = new TextEncoder();

function packet(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

const html = (text: string): string => `&lt;html&gt;&lt;body&gt;${text}&lt;/body&gt;&lt;/html&gt;`;

// 24 bases, as SnapGene writes an RNA's: with T.
const BASES = 'AAGGGCTTAGCTTAATTAAAGTGG';

const FEATURES = `<?xml version="1.0"?><Features nextValidID="3">
<Feature recentID="0" name="source" type="source" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1" visible="0"><Segment range="1-24" color="#ffffff" type="standard"/><Q name="mol_type"><V predef="tRNA"/></Q><Q name="organism"><V text="${html('Homo sapiens')}"/></Q></Feature>
<Feature recentID="1" name="tRNA" directionality="1" type="tRNA" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1"><Segment range="1-24" color="#228b22" type="standard"/><Q name="product"><V text="${html('tRNA-Ala')}"/></Q></Feature>
<Feature recentID="2" name="m1a" type="modified_base" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1"><Segment range="9-9" color="#a6acb3" type="standard"/><Q name="mod_base"><V predef="m1a"/></Q></Feature>
</Features>`;

const NOTES = `<Notes>
<UUID>17f3fc60-4abb-4617-8784-c234eaf3198d</UUID>
<Type>Natural</Type>
<Description>Homo sapiens mitochondrial tRNA-Ala, complete sequence.</Description>
<Created UTC="12:0:0">2020.8.31</Created>
<AccessionNumber>LC530712</AccessionNumber>
<Organism>mitochondrion Homo sapiens (human)</Organism>
<SequenceClass>UNA</SequenceClass>
<TransformedInto>unspecified</TransformedInto>
</Notes>`;

const PROPERTIES =
  '<AdditionalSequenceProperties><UpstreamStickiness>0</UpstreamStickiness><DownstreamStickiness>0</DownstreamStickiness><UpstreamModification>Unmodified</UpstreamModification><DownstreamModification>Unmodified</DownstreamModification></AdditionalSequenceProperties>';

const PRIMERS =
  '<?xml version="1.0"?><Primers nextValidID="0"><HybridizationParams minContinuousMatchLen="10" allowMismatch="1" minMeltingTemperature="40" showAdditionalFivePrimeMatches="1" minimumFivePrimeAnnealing="15"/></Primers>';

function buildRna(
  opts: { bases?: string; kind?: number; sequencePacket?: number; flags?: number } = {},
): Uint8Array {
  const kind = opts.kind ?? 7;
  const cookie = concat([enc.encode('SnapGene'), new Uint8Array([0, kind, 0, 15, 0, 19])]);
  return concat([
    packet(0x09, cookie),
    packet(
      opts.sequencePacket ?? 0x20,
      concat([new Uint8Array([opts.flags ?? 0]), enc.encode(opts.bases ?? BASES)]),
    ),
    packet(0x08, enc.encode(PROPERTIES)),
    packet(0x0a, enc.encode(FEATURES)),
    packet(0x05, enc.encode(PRIMERS)),
    packet(0x06, enc.encode(NOTES)),
    packet(0x0d, new Uint8Array(345)),
  ]);
}

function only(data: Uint8Array, name = 'tRNA-Ala.rna') {
  const result = parseSnapGene(data, name);
  const doc = result.documents[0];
  if (doc === undefined) throw new Error('no document');
  return { doc, warnings: result.warnings };
}

describe('SnapGene .rna (#112)', () => {
  it('opens a linear nucleotide document, named after the file', () => {
    const data = buildRna();
    expect(isSnapGene(data)).toBe(true);
    const { doc, warnings } = only(data);
    expect(warnings).toEqual([]);
    expect(doc.isProtein).toBe(false);
    expect(doc.topology).toBe('linear');
    expect(doc.ends).toBeNull();
    expect(doc.sequence.toString()).toBe(BASES);
    expect(doc.name).toBe('tRNA-Ala');
  });

  it('keeps the molecule type RNA and reads the notes as for DNA', () => {
    expect(only(buildRna()).doc.metadata).toMatchObject({
      moleculeType: 'RNA',
      accession: 'LC530712',
      organism: 'mitochondrion Homo sapiens (human)',
      division: 'UNA',
      date: '31-AUG-2020',
    });
  });

  it('places features on bases, 1-based and inclusive, with their strand', () => {
    const { doc } = only(buildRna());
    const byType = (type: string) => doc.features.all().find((f) => f.type === type);
    expect(byType('tRNA')?.segments).toMatchObject([{ start: 0, end: 24 }]);
    expect(byType('tRNA')?.strand).toBe('forward');
    expect(byType('modified_base')?.segments).toMatchObject([{ start: 8, end: 9 }]);
    expect(doc.subsequence({ start: 8, end: 9 })).toBe('A');
  });

  it('does not read the flags byte: bit 0 is not a circle, nor bit 1 Dam', () => {
    const { doc } = only(buildRna({ flags: 3 }));
    expect(doc.topology).toBe('linear');
    expect(doc.methylation).toEqual(only(buildRna()).doc.methylation);
  });

  it('downloads as GenBank written as RNA and opens again the same', () => {
    const { doc } = only(buildRna());
    const text = writeGenBank(doc);
    expect(text.split('\n')[0]).toMatch(/^LOCUS +tRNA-Ala +24 bp +RNA +linear +UNA /);
    const back = parseGenBank(text).documents[0];
    expect(back?.metadata.moleculeType).toBe('RNA');
    expect(back?.sequence.toString()).toBe(BASES);
    expect(back?.features.size).toBe(doc.features.size);
  });

  it('opens through the same doors as a .dna', async () => {
    const data = buildRna();
    expect(parseSequenceData(data, 'r.rna').documents[0]?.metadata.moleculeType).toBe('RNA');
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const read = await readSequenceData(buffer as ArrayBuffer, 'r.rna');
    expect(read.format).toBe('snapgene');
    expect(read.documents[0]?.metadata.moleculeType).toBe('RNA');
  });

  it('removes what is not a base, and says how much', () => {
    const { doc, warnings } = only(
      buildRna({ bases: `${BASES.slice(0, 10)}12-${BASES.slice(10)}` }),
    );
    expect(doc.sequence.toString()).toBe(BASES);
    expect(warnings.map((w) => w.message)).toEqual([
      '3 non-nucleotide characters removed from the sequence',
    ]);
  });

  it('takes the kind from the cookie, not from the packets', () => {
    expect(() => parseSnapGene(buildRna({ sequencePacket: 0x00 }))).toThrow(FormatError);
    expect(() => parseSnapGene(buildRna({ sequencePacket: 0x00 }))).toThrow(/RNA file has no/);
    // A DNA cookie reads packet 0x00 only, as before.
    expect(() => parseSnapGene(buildRna({ kind: 1 }))).toThrow(/no DNA sequence packet/);
  });
});

const localRnaFiles = listLocalSnapGeneRnaFiles();

describe.skipIf(localRnaFiles.length === 0)('real SnapGene .rna files', () => {
  it.each(localRnaFiles.map((f) => [f.name, f.data] as const))(
    '%s opens as the RNA SnapGene shows',
    (name, data) => {
      const { doc, warnings } = only(data, name);
      expect(warnings).toEqual([]);
      expect(doc.metadata.moleculeType).toBe('RNA');
      expect(doc.topology).toBe('linear');
      expect(doc.metadata.accession).not.toBe('');
      expect(doc.sequence.toString()).not.toMatch(/u/i);
      const all = doc.features.all();
      const source = all.find((f) => f.type === 'source');
      expect(source?.segments).toMatchObject([{ start: 0, end: doc.length }]);
      // The bases under what SnapGene says they are: a modified base is named
      // for the base it modifies (m1a is an A, cm a C, p a pseudouridine, a U
      // written T), and a variation's note starts with the base the file has
      // there. An off-by-one in the packet or a range would show here.
      let checked = 0;
      for (const f of all) {
        const seg = f.segments[0];
        if (seg?.kind !== 'range') continue;
        const here = doc.subsequence({ start: seg.start, end: seg.end }).toLowerCase();
        if (f.type === 'modified_base') {
          const mod = firstQualifier(f, 'mod_base') ?? '';
          const letter = mod === 'p' ? 'u' : /^(?:m\d)?([acgu])/.exec(mod)?.[1];
          if (letter === undefined) continue;
          expect(here, `${f.name} at ${seg.start}`).toBe(letter === 'u' ? 't' : letter);
          checked++;
        } else if (f.type === 'variation') {
          const first = /^([acgtu]+) in /.exec(firstQualifier(f, 'note') ?? '')?.[1];
          if (first === undefined) continue;
          expect(here, `variation at ${seg.start}`).toBe(first.replace(/u/g, 't'));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(3);
      const back = parseGenBank(writeGenBank(doc)).documents[0];
      expect(back?.metadata.moleculeType).toBe('RNA');
      expect(back?.features.size).toBe(doc.features.size);
    },
  );
});
