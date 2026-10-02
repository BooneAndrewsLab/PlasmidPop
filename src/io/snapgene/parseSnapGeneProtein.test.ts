import { firstQualifier, proteinProperties } from '@/core';
import { parseGenBank, writeGenBank } from '@/io/genbank';
import { listLocalSnapGeneProteinFiles } from '@/test/fixtures';

import { parseSequenceData, readSequenceData } from '../detect';
import { FormatError } from '../types';
import { isSnapGene, parseSnapGene } from './parseSnapGene';

/**
 * SnapGene .prot files (#95). The layout is the one SnapGene 8.2's two sample
 * proteins have (KPYK1_ECOLI, THYX_MYCTU), which cannot be committed: the
 * cookie's kind of sequence is 2 where every .dna has 1, the residues come in
 * packet 0x15 after a flags byte of 0, and features (0x0A), notes (0x06),
 * properties (0x08) and display settings (0x0D) are the packets a .dna has.
 * The file built here follows that layout; the tests at the end read the
 * real ones when SnapGene is installed.
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

// 30 residues.
const RESIDUES = 'MKKTKIVCTIGPKTESEEMLAKMLDAGMNV';

const FEATURES = `<?xml version="1.0"?><Features nextValidID="4">
<Feature recentID="0" name="source" type="source" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1" visible="0"><Segment range="1-30" color="#ffffff" type="standard"/><Q name="db_xref"><V text="83333" predef="taxon"/></Q><Q name="organism"><V text="${html('Escherichia coli K-12')}"/></Q></Feature>
<Feature recentID="1" name="PK-1" type="Protein" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1" visible="0"><Segment range="1-30" color="#a6acb3" type="standard"/><Q name="product"><V text="${html('Pyruvate kinase I')}"/></Q></Feature>
<Feature recentID="2" name="Domain" type="Region" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1"><Segment range="7-23" color="#cc99b2" type="standard"/><Q name="region_name"><V text="Domain"/></Q></Feature>
<Feature recentID="3" name="domain interfaces [active]" type="Site" subType="active" directionality="2" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1"><Segment range="3-4" color="noColor" type="standard"/><Segment range="10-10" color="noColor" type="standard"/><Segment range="28-30" color="noColor" type="standard"/><Q name="site_type"><V text="active"/></Q></Feature>
</Features>`;

const NOTES = `<Notes>
<UUID>723f0f28-31a9-41b7-bfa7-dcd22dea5cdf</UUID>
<Type>Natural</Type>
<Product>Pyruvate kinase I</Product>
<Description>RecName: Full=Pyruvate kinase I; AltName: Full=PK-1.</Description>
<Created UTC="11:0:0">2023.2.21</Created>
<LastModified UTC="11:0:0">2023.2.21</LastModified>
<AccessionNumber>P0AD61</AccessionNumber>
<Organism>Escherichia coli K-12</Organism>
<SequenceClass>UNA</SequenceClass>
<TransformedInto>unspecified</TransformedInto>
<References>
<Reference volume="86" authors="Ohara O, Dorit RL, Gilbert W." pages="6883-6887" journalName="Proc Natl Acad Sci U S A" type="Journal Article" journal="Proc Natl Acad Sci U S A 86 (18), 6883-6887 (1989)" issue="18" date="1989" title="Direct genomic sequencing of bacterial DNA: the pyruvate kinase I gene of Escherichia coli" pubMedID="2674937"/>
</References>
</Notes>`;

const PROPERTIES =
  '<AdditionalSequenceProperties><UpstreamStickiness>0</UpstreamStickiness><DownstreamStickiness>0</DownstreamStickiness><UpstreamModification>Unmodified</UpstreamModification><DownstreamModification>Unmodified</DownstreamModification></AdditionalSequenceProperties>';

function buildProt(
  opts: { residues?: string; kind?: number; sequencePacket?: number; flags?: number } = {},
): Uint8Array {
  const kind = opts.kind ?? 2;
  const cookie = concat([enc.encode('SnapGene'), new Uint8Array([0, kind, 0, 15, 0, 19])]);
  return concat([
    packet(0x09, cookie),
    packet(
      opts.sequencePacket ?? 0x15,
      concat([new Uint8Array([opts.flags ?? 0]), enc.encode(opts.residues ?? RESIDUES)]),
    ),
    packet(0x08, enc.encode(PROPERTIES)),
    packet(0x0a, enc.encode(FEATURES)),
    packet(0x06, enc.encode(NOTES)),
    packet(0x0d, new Uint8Array(345)),
  ]);
}

function only(data: Uint8Array, name = 'KPYK1_ECOLI.prot') {
  const result = parseSnapGene(data, name);
  const doc = result.documents[0];
  if (doc === undefined) throw new Error('no document');
  return { doc, warnings: result.warnings };
}

describe('SnapGene .prot (#95)', () => {
  it('opens a protein document, named after the file', () => {
    const data = buildProt();
    expect(isSnapGene(data)).toBe(true);
    const { doc, warnings } = only(data);
    expect(warnings).toEqual([]);
    expect(doc.alphabet).toBe('protein');
    expect(doc.topology).toBe('linear');
    expect(doc.ends).toBeNull();
    expect(doc.sequence.toString()).toBe(RESIDUES);
    expect(doc.name).toBe('KPYK1_ECOLI');
  });

  it('reads the notes as it does for DNA, with no molecule type', () => {
    const { metadata } = only(buildProt()).doc;
    expect(metadata).toMatchObject({
      accession: 'P0AD61',
      organism: 'Escherichia coli K-12',
      description: 'RecName: Full=Pyruvate kinase I; AltName: Full=PK-1.',
      division: 'UNA',
      date: '21-FEB-2023',
      moleculeType: '',
    });
    expect(metadata.references[0]?.pubmed).toBe('2674937');
  });

  it('places features on residues, 1-based and inclusive, all on the one strand', () => {
    const { doc } = only(buildProt());
    const byType = (type: string) => doc.features.all().find((f) => f.type === type);
    expect(byType('Region')?.segments).toMatchObject([{ start: 6, end: 23 }]);
    expect(byType('Protein')?.segments).toMatchObject([{ start: 0, end: 30 }]);
    // Markup in a value is stripped, as in a .dna.
    expect(byType('Protein')?.qualifiers).toContainEqual({
      name: 'product',
      value: 'Pyruvate kinase I',
    });
    const site = byType('Site');
    expect(site?.segments).toMatchObject([
      { start: 2, end: 4 },
      { start: 9, end: 10 },
      { start: 27, end: 30 },
    ]);
    // A protein has one strand, so a feature's direction is not kept.
    expect(site?.strand).toBe('forward');
    expect(doc.features.all().map((f) => f.type)).toEqual(['source', 'Protein', 'Region', 'Site']);
  });

  it('downloads as GenPept and opens again the same', () => {
    const { doc } = only(buildProt());
    const text = writeGenBank(doc);
    expect(text.split('\n')[0]).toMatch(/^LOCUS +KPYK1_ECOLI +30 aa +linear +UNA /);
    const back = parseGenBank(text).documents[0];
    expect(back?.alphabet).toBe('protein');
    expect(back?.sequence.toString()).toBe(RESIDUES);
    expect(back?.features.all().map((f) => [f.type, f.segments])).toEqual(
      doc.features.all().map((f) => [f.type, f.segments]),
    );
  });

  it('opens through the same doors as a .dna', async () => {
    const data = buildProt();
    expect(parseSequenceData(data, 'p.prot').documents[0]?.alphabet).toBe('protein');
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const read = await readSequenceData(buffer as ArrayBuffer, 'p.prot');
    expect(read.format).toBe('snapgene');
    expect(read.documents[0]?.alphabet).toBe('protein');
  });

  it('removes what is not a residue, and says how much', () => {
    const { doc, warnings } = only(
      buildProt({ residues: `${RESIDUES.slice(0, 20)}12-${RESIDUES.slice(20)}` }),
    );
    expect(doc.sequence.toString()).toBe(RESIDUES);
    expect(warnings.map((w) => w.message)).toEqual([
      '3 non-residue characters removed from the sequence',
    ]);
  });

  it('takes the kind from the cookie, not from the packets', () => {
    // A protein cookie without residues is an error, not an empty protein.
    expect(() => parseSnapGene(buildProt({ sequencePacket: 0x00 }))).toThrow(FormatError);
    expect(() => parseSnapGene(buildProt({ sequencePacket: 0x00 }))).toThrow(/residues packet/);
    // A DNA cookie reads packet 0x00 only, as before.
    expect(() => parseSnapGene(buildProt({ kind: 1 }))).toThrow(/no DNA sequence packet/);
    // The protein's flags byte is not the DNA's: a set bit 0 is not a circle.
    expect(only(buildProt({ flags: 1 })).doc.topology).toBe('linear');
  });
});

const localProteinFiles = listLocalSnapGeneProteinFiles();

/** SnapGene's own `calculated_mol_wt`, "50.7 kDa", in Da; null when absent. */
function statedWeight(text: string | undefined): number | null {
  const m = /^([\d.]+) kDa$/.exec(text ?? '');
  return m?.[1] === undefined ? null : Number(m[1]) * 1000;
}

describe.skipIf(localProteinFiles.length === 0)('real SnapGene .prot files', () => {
  it.each(localProteinFiles.map((f) => [f.name, f.data] as const))(
    '%s opens as the protein SnapGene shows',
    (name, data) => {
      const { doc, warnings } = only(data, name);
      expect(warnings).toEqual([]);
      expect(doc.alphabet).toBe('protein');
      expect(doc.metadata.accession).not.toBe('');
      const source = doc.features.all().find((f) => f.type === 'source');
      // The source covers every residue the packet holds.
      expect(source?.segments).toMatchObject([{ start: 0, end: doc.length }]);
      // Every feature with one segment carries SnapGene's weight of the
      // residues it covers; ours, computed as ProtParam does, agrees to the
      // 0.1 kDa SnapGene rounds to, so residues and ranges are read right.
      let checked = 0;
      for (const f of doc.features.all()) {
        const seg = f.segments[0];
        const stated = statedWeight(firstQualifier(f, 'calculated_mol_wt'));
        if (stated === null || f.segments.length !== 1 || seg?.kind !== 'range') continue;
        const ours = proteinProperties(doc.subsequence({ start: seg.start, end: seg.end }));
        expect(Math.abs(ours.molecularWeight - stated), `${f.type} ${f.name}`).toBeLessThan(51);
        checked++;
      }
      expect(checked).toBeGreaterThan(3);
      const back = parseGenBank(writeGenBank(doc)).documents[0];
      expect(back?.alphabet).toBe('protein');
      expect(back?.features.size).toBe(doc.features.size);
    },
  );
});
