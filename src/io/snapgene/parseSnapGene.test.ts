import { parseGenBank, writeGenBank } from '@/io/genbank';
import { listLocalSnapGeneFiles } from '@/test/fixtures';

import { parseSequenceData } from '../detect';
import { FormatError } from '../types';
import { isSnapGene, parseSnapGene } from './parseSnapGene';

const enc = new TextEncoder();

function packet(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/** Builds a minimal but realistic .dna file in memory. */
function buildFile(opts: {
  sequence: string;
  circular: boolean;
  features?: string;
  primers?: string;
  notes?: string;
  properties?: string;
}): Uint8Array {
  const cookie = concat([enc.encode('SnapGene'), new Uint8Array([0, 1, 0, 15, 0, 19])]);
  const seq = concat([new Uint8Array([(opts.circular ? 1 : 0) | 2]), enc.encode(opts.sequence)]);
  const parts = [
    packet(0x09, cookie),
    packet(0x00, seq),
    packet(0x08, enc.encode(opts.properties ?? '<AdditionalSequenceProperties/>')),
  ];
  if (opts.features !== undefined) parts.push(packet(0x0a, enc.encode(opts.features)));
  if (opts.primers !== undefined) parts.push(packet(0x05, enc.encode(opts.primers)));
  if (opts.notes !== undefined) parts.push(packet(0x06, enc.encode(opts.notes)));
  parts.push(packet(0x1c, enc.encode('<EnzymeVisibilities vals=""/>')));
  return concat(parts);
}

const SEQ = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAGACGTACGTACGT'; // 51 bp

const FEATURES = `<?xml version="1.0"?><Features nextValidID="3">
<Feature recentID="0" name="orf" directionality="1" type="CDS" translationMW="1.0" hitsStopCodon="1">
  <Segment range="1-3" color="#05fd14" type="standard" translated="1"/>
  <Segment range="4-9" color="noColor" type="gap"/>
  <Segment range="10-24" color="#05fd14" type="standard" translated="1"/>
  <Q name="codon_start"><V int="1"/></Q>
  <Q name="product"><V text="&lt;html&gt;&lt;body&gt;test &amp;amp; protein&lt;/body&gt;&lt;/html&gt;"/></Q>
  <Q name="translation"><V text="M,A,IVMGR*"/></Q>
  <Q name="db_xref"><V text="123" predef="GeneID"/><V text="456" predef="GI"/></Q>
  <Q name="pseudo"/>
</Feature>
<Feature recentID="1" name="wrap" directionality="2" type="misc_feature">
  <Segment range="45-5" color="#ff0000" type="standard"/>
</Feature>
<Feature recentID="2" name="bad" type="misc_feature"><Segment range="60-70" color="#ff0000" type="standard"/></Feature>
</Features>`;

const PRIMERS = `<?xml version="1.0"?><Primers nextValidID="2"><HybridizationParams minContinuousMatchLen="10"/>
<Primer recentID="0" name="fwd" sequence="ATGGCCATTG" description="&lt;html&gt;&lt;body&gt;forward&lt;/body&gt;&lt;/html&gt;"><BindingSite location="0-9" boundStrand="0" meltingTemperature="30"/></Primer>
<Primer recentID="1" name="rev" sequence="ACGTACGTAC"><BindingSite location="41-50" boundStrand="1"/><BindingSite simplified="1" location="41-50" boundStrand="1"/></Primer>
<Primer recentID="2" name="orphan" sequence="GGGGGGGGGG"/>
</Primers>`;

const NOTES = `<Notes>
<UUID>x</UUID>
<Type>Synthetic</Type>
<Created UTC="4:0:0">2012.4.15</Created>
<LastModified UTC="16:19:55">2023.4.7</LastModified>
<Description>&lt;html>&lt;body>A &lt;b>test&lt;/b> plasmid&lt;/body>&lt;/html></Description>
<AccessionNumber>X12345</AccessionNumber>
<Organism>Escherichia coli</Organism>
<SequenceClass>UNA</SequenceClass>
<Comments>Made by hand</Comments>
<References>
<Reference type="Journal Article" pubMedID="17018144" journal="&lt;html>&lt;body>BMC Bioinformatics 2006&lt;/body>&lt;/html>" title="&lt;html>&lt;body>MICA&lt;/body>&lt;/html>" authors="Stokes WA, Glick BS."/>
</References>
</Notes>`;

describe('parseSnapGene (synthetic file)', () => {
  const file = buildFile({
    sequence: SEQ,
    circular: true,
    features: FEATURES,
    primers: PRIMERS,
    notes: NOTES,
  });
  const result = parseSnapGene(file, 'dir/my plasmid.dna');
  const doc = result.documents[0];
  if (doc === undefined) throw new Error('no document');

  it('detects the signature', () => {
    expect(isSnapGene(file)).toBe(true);
    expect(isSnapGene(enc.encode('LOCUS x'))).toBe(false);
    expect(() => parseSnapGene(enc.encode('LOCUS x'))).toThrow(FormatError);
    expect(parseSequenceData(file, 'x.dna').format).toBe('snapgene');
    expect(parseSequenceData(enc.encode('>a\nACGT\n')).format).toBe('fasta');
  });

  it('reads the sequence, topology and name', () => {
    expect(doc.sequence.toString()).toBe(SEQ);
    expect(doc.topology).toBe('circular');
    expect(doc.name).toBe('my plasmid');
    expect(result.format).toBe('snapgene');
  });

  it('converts features, skipping gaps and bad ranges, keeping qualifiers and colour', () => {
    const orf = doc.features.all().find((f) => f.name === 'orf');
    expect(orf).toMatchObject({ type: 'CDS', strand: 'forward' });
    expect(orf?.segments).toEqual([
      expect.objectContaining({ start: 0, end: 3 }),
      expect.objectContaining({ start: 9, end: 24 }),
    ]);
    expect(orf?.qualifiers).toEqual([
      { name: 'codon_start', value: '1' },
      { name: 'product', value: 'test & protein' },
      { name: 'translation', value: 'MAIVMGR' },
      { name: 'db_xref', value: 'GeneID:123' },
      { name: 'db_xref', value: 'GI:456' },
      { name: 'pseudo', value: null },
      { name: 'note', value: 'color: #05fd14' },
    ]);
    const wrap = doc.features.all().find((f) => f.name === 'wrap');
    expect(wrap).toMatchObject({ strand: 'reverse' });
    expect(wrap?.segments[0]).toMatchObject({ start: 44, end: 5 + SEQ.length });
    expect(doc.features.all().some((f) => f.name === 'bad')).toBe(false);
    expect(result.warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(/"bad".*invalid/),
      expect.stringMatching(/"bad" has no usable segments/),
      expect.stringMatching(/"orphan" has no binding site/),
    ]);
  });

  it('imports primers as primer_bind features with strand', () => {
    const primers = doc.features.all().filter((f) => f.type === 'primer_bind');
    expect(primers.map((p) => [p.name, p.strand])).toEqual([
      ['fwd', 'forward'],
      ['rev', 'reverse'],
    ]);
    expect(primers[0]?.qualifiers).toEqual([
      { name: 'note', value: 'sequence: ATGGCCATTG' },
      { name: 'note', value: 'forward' },
    ]);
    // SnapGene counts binding sites from 0, both ends included, unlike
    // feature ranges: each site is exactly where its primer's bases are.
    const [fwd, rev] = primers;
    if (fwd === undefined || rev === undefined) throw new Error('primers');
    expect(doc.featureSequence(fwd.id)).toBe('ATGGCCATTG');
    expect(doc.featureSequence(rev.id)).toBe('ACGTACGTAC');
  });

  it('maps notes onto metadata', () => {
    expect(doc.metadata).toMatchObject({
      description: 'A test plasmid',
      accession: 'X12345',
      organism: 'Escherichia coli',
      division: 'UNA',
      date: '07-APR-2023',
      comments: ['Made by hand'],
      moleculeType: 'DNA',
    });
    expect(doc.metadata.references[0]).toMatchObject({
      pubmed: '17018144',
      title: 'MICA',
      authors: 'Stokes WA, Glick BS.',
    });
  });

  it('writes to GenBank and back without losing features', () => {
    const gb = writeGenBank(doc);
    const back = parseGenBank(gb).documents[0];
    expect(back?.features.size).toBe(doc.features.size);
    expect(back?.sequence.toString()).toBe(SEQ);
    expect(back?.metadata.description).toBe('A test plasmid');
  });

  it('handles minimal and malformed files', () => {
    const bare = parseSnapGene(buildFile({ sequence: 'acgt', circular: false }));
    expect(bare.documents[0]).toMatchObject({ name: 'Untitled', topology: 'linear', length: 4 });
    const badXml = parseSnapGene(
      buildFile({ sequence: 'acgt', circular: false, features: '<Features><Feature></Features>' }),
    );
    expect(badXml.warnings[0]?.message).toMatch(/Could not read features/);
    const truncated = buildFile({ sequence: 'acgt', circular: false }).subarray(0, 20);
    expect(() => parseSnapGene(truncated)).toThrow(/Truncated/);
    const noSeq = concat([packet(0x09, concat([enc.encode('SnapGene'), new Uint8Array(6)]))]);
    expect(() => parseSnapGene(noSeq)).toThrow(/no DNA sequence/);
  });
});

describe('sticky ends', () => {
  const props = (up: number, down: number) =>
    `<AdditionalSequenceProperties><UpstreamStickiness>${up}</UpstreamStickiness><DownstreamStickiness>${down}</DownstreamStickiness></AdditionalSequenceProperties>`;
  const read = (sequence: string, up: number, down: number, features?: string) => {
    const doc = parseSnapGene(
      buildFile({
        sequence,
        circular: false,
        properties: props(up, down),
        ...(features === undefined ? {} : { features }),
      }),
    ).documents[0];
    if (doc === undefined) throw new Error('no document');
    return doc;
  };

  it('reads a TA vector: a 3′ T at each end, one of them on the bottom strand only', () => {
    // SnapGene's sequence spans both strands, so it starts with the A under
    // the bottom strand's overhanging T and ends with the top strand's T.
    const doc = read('AGGGCCCAAATTTGGGCCCT', -1, -1);
    expect(doc.sequence.toString()).toBe('GGGCCCAAATTTGGGCCCT');
    expect(doc.ends).toEqual({
      left: { kind: "3'", overhang: 'A', enzyme: null },
      right: { kind: "3'", overhang: 'T', enzyme: null },
    });
  });

  it('reads a 4-base 5′ overhang downstream, taking it out of the top strand', () => {
    const features = `<Features><Feature name="tip" type="misc_feature" directionality="0"><Segment range="15-20" type="standard"/></Feature></Features>`;
    const doc = read('ATGCATGCATGCATGCCACC', 0, 4, features);
    expect(doc.sequence.toString()).toBe('ATGCATGCATGCATGC');
    expect(doc.ends?.right).toEqual({ kind: "5'", overhang: 'CACC', enzyme: null });
    expect(doc.ends?.left.kind).toBe('blunt');
    // A feature running onto the bottom-strand bases is clipped to the top strand.
    const [tip] = [...doc.features];
    expect(tip?.segments[0]).toMatchObject({ start: 14, end: 16 });
  });

  it('survives a GenBank round trip', () => {
    const doc = read('AGGGCCCAAATTTGGGCCCT', -1, -1);
    expect(parseGenBank(writeGenBank(doc)).documents[0]?.ends).toEqual(doc.ends);
  });

  it('ignores stickiness on a circle, and overhangs longer than the molecule', () => {
    const circle = parseSnapGene(
      buildFile({ sequence: SEQ, circular: true, properties: props(-1, -1) }),
    ).documents[0];
    expect(circle?.ends).toBeNull();
    const result = parseSnapGene(
      buildFile({ sequence: 'ACGTAC', circular: false, properties: props(-4, 4) }),
    );
    expect(result.documents[0]?.ends).toBeNull();
    expect(result.warnings.map((w) => w.message).join()).toMatch(/longer than the molecule/);
  });
});

const localSnapGeneFiles = listLocalSnapGeneFiles();

describe.skipIf(localSnapGeneFiles.length === 0)(
  'real SnapGene files from a local installation',
  () => {
    const files = localSnapGeneFiles;
    it.each(files.map((f) => [f.name, f.data] as const))('%s parses', (name, data) => {
      const result = parseSnapGene(data, name);
      const doc = result.documents[0];
      if (doc === undefined) throw new Error('no document');
      expect(doc.length).toBeGreaterThan(100);
      expect(doc.features.size).toBeGreaterThan(0);
      for (const f of doc.features) expect(f.name).not.toBe('');
      expect(result.warnings.filter((w) => w.message.includes('Could not read'))).toEqual([]);
      // GenBank export of the imported document must round-trip.
      const back = parseGenBank(writeGenBank(doc)).documents[0];
      expect(back?.features.size).toBe(doc.features.size);
      expect(back?.length).toBe(doc.length);
    });
  },
);
