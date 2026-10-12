import { readFileSync, readdirSync } from 'node:fs';

import {
  type DocumentEnds,
  type SeqDocument,
  SeqDocument as Doc,
  createFeature,
  createMetadata,
  createReference,
  rangeSegment,
  siteSegment,
} from '@/core';
import { parseGenBank } from '@/io/genbank';
import {
  listLocalSnapGeneFiles,
  listLocalSnapGeneProteinFiles,
  listLocalSnapGeneRnaFiles,
} from '@/test/fixtures';

import { isSnapGene, parseSnapGene } from './parseSnapGene';
import { writeSnapGene } from './writeSnapGene';

function only(docs: readonly SeqDocument[]): SeqDocument {
  const doc = docs[0];
  if (doc === undefined) throw new Error('the file holds no document');
  return doc;
}

/** What a read gives, in an order that does not depend on how the features were listed. */
function shape(doc: SeqDocument, synthetic = false): unknown {
  const features = doc.features
    .all()
    .map((f) => ({
      name: f.name,
      type: f.type,
      strand: f.strand,
      segments: f.segments,
      // The colour is a note that a read puts last, wherever the file's own
      // notes were, so it is compared on its own.
      qualifiers: f.qualifiers.filter((q) => !(q.value ?? '').startsWith('color: #')),
      color: f.qualifiers.find((q) => (q.value ?? '').startsWith('color: #'))?.value ?? null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const m = doc.metadata;
  return {
    name: doc.name,
    alphabet: doc.alphabet,
    sequence: doc.sequence.toString(),
    topology: doc.topology,
    methylation: doc.methylation,
    ends: doc.ends,
    features,
    metadata: {
      description: m.description,
      accession: m.accession,
      organism: m.organism,
      division: m.division,
      date: m.date,
      moleculeType: synthetic ? '' : m.moleculeType,
      references: m.references.map((r) => ({ ...r })),
      comments: m.comments,
    },
  };
}

function roundTrip(doc: SeqDocument): {
  again: SeqDocument;
  losses: readonly string[];
  ext: string;
} {
  const out = writeSnapGene(doc);
  expect(isSnapGene(out.bytes)).toBe(true);
  const result = parseSnapGene(out.bytes);
  expect(result.warnings).toEqual([]);
  return { again: only(result.documents), losses: out.losses, ext: out.extension };
}

function readBack(bytes: Uint8Array, name?: string): SeqDocument {
  return only(parseSnapGene(bytes, name).documents);
}

describe('read, write, read (#204)', () => {
  const dir = new URL('../fixtures/snapgene/', import.meta.url);
  const files = [
    ...readdirSync(dir).filter((f) => f.endsWith('.dna')),
    ...readdirSync(new URL('frames/', dir)).map((f) => `frames/${f}`),
  ];

  it.each(files)('the committed fixture %s survives', (file) => {
    const first = readBack(new Uint8Array(readFileSync(new URL(file, dir))), file);
    const { again, ext } = roundTrip(first);
    expect(ext).toBe('dna');
    expect(shape(again)).toEqual(shape(first));
  });

  it('the files of a local SnapGene installation survive (skips when there are none)', () => {
    for (const { name, data } of listLocalSnapGeneFiles(400)) {
      const first = readBack(data, name);
      const { again } = roundTrip(first);
      expect(shape(again), name).toEqual(shape(first));
    }
  });

  it('local .prot files survive, and are written as .prot', () => {
    for (const { name, data } of listLocalSnapGeneProteinFiles()) {
      const first = readBack(data, name);
      const { again, ext } = roundTrip(first);
      expect(ext).toBe('prot');
      expect(shape(again), name).toEqual(shape(first));
    }
  });

  it('local .rna files survive, and are written as .rna', () => {
    for (const { name, data } of listLocalSnapGeneRnaFiles()) {
      const first = readBack(data, name);
      const { again, ext } = roundTrip(first);
      expect(ext).toBe('rna');
      expect(shape(again), name).toEqual(shape(first));
    }
  });

  it('writes the same bytes twice for the same document', () => {
    const doc = readBack(new Uint8Array(readFileSync(new URL('plasmid.dna', dir))));
    const a = writeSnapGene(doc, { uuid: 'x' }).bytes;
    const b = writeSnapGene(doc, { uuid: 'x' }).bytes;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('writes outside a secure context, where crypto.randomUUID is missing', () => {
    const doc = readBack(new Uint8Array(readFileSync(new URL('plasmid.dna', dir))));
    const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(() => writeSnapGene(doc)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(crypto, 'randomUUID', original);
    }
  });
});

describe('what the packets hold', () => {
  const seq = 'ACGTTGCAAC'.repeat(12);

  it('writes the cookie, flags and packets in SnapGene’s order', () => {
    const doc = Doc.create({
      name: 'p',
      sequence: seq,
      topology: 'circular',
      methylation: { dam: true, dcm: false },
    });
    const { bytes } = writeSnapGene(doc);
    expect(Array.from(bytes.subarray(0, 5))).toEqual([0x09, 0, 0, 0, 14]);
    expect(new TextDecoder().decode(bytes.subarray(5, 13))).toBe('SnapGene');
    expect(Array.from(bytes.subarray(13, 19))).toEqual([0, 1, 0, 15, 0, 19]);
    const types: number[] = [];
    let i = 0;
    while (i < bytes.length) {
      types.push(bytes[i] ?? -1);
      i += 5 + new DataView(bytes.buffer, bytes.byteOffset + i + 1, 4).getUint32(0, false);
    }
    expect(types).toEqual([0x09, 0x00, 0x08, 0x0a, 0x05, 0x06]);
    // circular | double-stranded | Dam
    expect(bytes[19 + 5]).toBe(0x01 | 0x02 | 0x04);
  });

  it('keeps text that XML and HTML would mangle', () => {
    const doc = Doc.create({
      name: 'a "quoted" & more',
      sequence: seq,
      features: [
        createFeature({
          name: 'x & "y" < z',
          type: 'CDS',
          strand: 'forward',
          segments: [rangeSegment(0, 30)],
          qualifiers: [
            { name: 'note', value: 'line one\nline two\ttabbed' },
            { name: 'product', value: 'β-lactamase — 5′→3′' },
            { name: 'pseudo', value: null },
            { name: 'db_xref', value: 'GI:123' },
            { name: 'db_xref', value: 'GeneID:9' },
          ],
        }),
      ],
      metadata: createMetadata({ description: 'a & b < 3', comments: ['one\n\ntwo'] }),
    });
    const { again } = roundTrip(doc);
    expect(again.name).toBe(doc.name);
    expect(again.features.all()[0]?.name).toBe('x & "y" < z');
    expect(again.features.all()[0]?.qualifiers.map((q) => q.value)).toEqual(
      doc.features.all()[0]?.qualifiers.map((q) => q.value),
    );
    expect(again.metadata.description).toBe('a & b < 3');
    expect(again.metadata.comments).toEqual(['one\n\ntwo']);
  });

  it('writes a reverse CDS with its frame, and a feature over the origin', () => {
    const doc = Doc.create({
      name: 'p',
      sequence: seq,
      topology: 'circular',
      features: [
        createFeature({
          name: 'rev',
          type: 'CDS',
          strand: 'reverse',
          segments: [rangeSegment(20, 80)],
          qualifiers: [{ name: 'codon_start', value: '2' }],
        }),
        createFeature({
          name: 'wrap',
          type: 'misc_feature',
          strand: 'forward',
          segments: [rangeSegment(110, 130)],
        }),
        createFeature({
          name: 'split',
          type: 'CDS',
          strand: 'forward',
          segments: [rangeSegment(0, 10), rangeSegment(40, 50)],
        }),
      ],
    });
    const xml = new TextDecoder().decode(writeSnapGene(doc).bytes);
    expect(xml).toContain('readingFrame="-2"');
    expect(xml).toContain('range="111-10"');
    expect(xml).toContain('range="11-40" color="noColor" type="gap"');
    const { again } = roundTrip(doc);
    expect(shape(again, true)).toEqual(shape(doc, true));
  });

  it('writes primers as primers, and keeps a labelled primer_bind a feature', () => {
    const doc = Doc.create({
      name: 'p',
      sequence: seq,
      topology: 'circular',
      features: [
        createFeature({
          name: 'fwd',
          type: 'primer_bind',
          strand: 'forward',
          segments: [rangeSegment(10, 30)],
          // Without it a read gives the primer this note, from the bases.
          qualifiers: [{ name: 'note', value: 'sequence: ACGTTGCAACACGTTGCAAC' }],
        }),
        createFeature({
          name: 'rev',
          type: 'primer_bind',
          strand: 'reverse',
          segments: [rangeSegment(60, 80)],
          qualifiers: [
            { name: 'note', value: 'sequence: GGGACGT' },
            { name: 'note', value: 'a reverse primer' },
          ],
        }),
        createFeature({
          name: 'labelled',
          type: 'primer_bind',
          strand: 'forward',
          segments: [rangeSegment(90, 100)],
          qualifiers: [{ name: 'label', value: 'labelled' }],
        }),
      ],
    });
    const xml = new TextDecoder().decode(writeSnapGene(doc).bytes);
    expect(xml).toContain('<Primer recentID="0" name="fwd" sequence="ACGTTGCAACACGTTGCAAC"');
    expect(xml).toContain('location="10-29" boundStrand="0"');
    expect(xml).toContain('location="60-79" boundStrand="1"');
    expect(xml).toContain('sequence="GGGACGT"');
    expect(xml).toContain(
      '<Feature recentID="0" name="labelled" directionality="1" type="primer_bind"',
    );
    const { again } = roundTrip(doc);
    expect(shape(again, true)).toEqual(shape(doc, true));
  });

  it('merges one primer’s sites into one primer', () => {
    const site = (start: number): ReturnType<typeof createFeature> =>
      createFeature({
        name: 'twice',
        type: 'primer_bind',
        strand: 'forward',
        segments: [rangeSegment(start, start + 10)],
      });
    const doc = Doc.create({
      name: 'p',
      sequence: 'ACGTACGTAC'.repeat(10),
      features: [site(0), site(10)],
    });
    const xml = new TextDecoder().decode(writeSnapGene(doc).bytes);
    expect(xml.match(/<Primer /g)).toHaveLength(1);
    expect(xml.match(/<BindingSite /g)).toHaveLength(2);
  });

  it('carries a feature colour in the segment and takes it from a callback otherwise', () => {
    const doc = Doc.create({
      name: 'p',
      sequence: seq,
      features: [
        createFeature({
          name: 'coloured',
          type: 'gene',
          strand: 'forward',
          segments: [rangeSegment(0, 10)],
          qualifiers: [{ name: 'note', value: 'color: #112233' }],
        }),
        createFeature({
          name: 'plain',
          type: 'gene',
          strand: 'forward',
          segments: [rangeSegment(20, 30)],
        }),
      ],
    });
    const xml = new TextDecoder().decode(writeSnapGene(doc, { colorOf: () => '#abcdef' }).bytes);
    expect(xml).toContain('range="1-10" color="#112233"');
    expect(xml).toContain('range="21-30" color="#abcdef"');
    // The colour is the segment's, not a note SnapGene would show.
    expect(xml).not.toContain('color: #112233');
    const { again } = roundTrip(doc);
    expect(again.features.all()[0]?.qualifiers).toEqual([
      { name: 'note', value: 'color: #112233' },
    ]);
  });

  describe('overhangs', () => {
    const body = 'GATTACAGATTACAGATTACAGATTACA';
    const cases: { name: string; ends: DocumentEnds; sequence: string }[] = [
      {
        name: "5' left, 3' right",
        sequence: 'AATT' + body + 'TT',
        ends: {
          left: { kind: "5'", overhang: 'AATT', enzyme: null },
          right: { kind: "3'", overhang: 'TT', enzyme: null },
        },
      },
      {
        name: "3' left, 5' right",
        sequence: body,
        ends: {
          left: { kind: "3'", overhang: 'CG', enzyme: null },
          right: { kind: "5'", overhang: 'GATC', enzyme: null },
        },
      },
      {
        name: 'blunt left, 5′ right',
        sequence: body,
        ends: {
          left: { kind: 'blunt', overhang: '', enzyme: null },
          right: { kind: "5'", overhang: 'CACC', enzyme: null },
        },
      },
    ];
    it.each(cases)('$name', ({ ends, sequence }) => {
      const doc = Doc.create({
        name: 'frag',
        sequence,
        topology: 'linear',
        ends,
        features: [
          createFeature({
            name: 'f',
            type: 'misc_feature',
            strand: 'forward',
            segments: [rangeSegment(2, 12)],
          }),
        ],
      });
      const { again } = roundTrip(doc);
      expect(shape(again, true)).toEqual(shape(doc, true));
    });

    it('records the overhangs as SnapGene does, with the bottom strand’s bases in the sequence', () => {
      const doc = Doc.create({
        name: 'frag',
        sequence: body,
        topology: 'linear',
        ends: {
          left: { kind: "3'", overhang: 'CG', enzyme: 'AccI' },
          right: { kind: "5'", overhang: 'GATC', enzyme: null },
        },
      });
      const out = writeSnapGene(doc);
      const text = new TextDecoder().decode(out.bytes);
      expect(text).toContain('<UpstreamStickiness>-2</UpstreamStickiness>');
      expect(text).toContain('<DownstreamStickiness>4</DownstreamStickiness>');
      expect(text).toContain('CG' + body + 'GATC');
      expect(out.losses.join(' ')).toContain('enzymes');
    });
  });

  it('writes a protein as .prot, with residues in packet 0x15', () => {
    const doc = Doc.create({
      name: 'prot',
      sequence: 'MKVLAAGIVGLLLAQ',
      alphabet: 'protein',
      features: [
        createFeature({
          name: 'dom',
          type: 'Region',
          strand: 'forward',
          segments: [rangeSegment(2, 9)],
        }),
      ],
    });
    const out = writeSnapGene(doc);
    expect(out.extension).toBe('prot');
    expect(Array.from(out.bytes.subarray(13, 15))).toEqual([0x00, 0x02]);
    const { again } = roundTrip(doc);
    expect(shape(again, true)).toEqual(shape(doc, true));
  });

  it('writes a linear RNA as .rna, with T for U', () => {
    const doc = Doc.create({
      name: 'r',
      sequence: 'GGAUCCAUGGCUAA',
      metadata: createMetadata({ moleculeType: 'RNA' }),
    });
    const out = writeSnapGene(doc);
    expect(out.extension).toBe('rna');
    expect(out.losses.join(' ')).toContain('U');
    expect(readBack(out.bytes).sequence.toString()).toBe('GGATCCATGGCTAA');
  });
});

describe('what is listed as not representable', () => {
  const doc = Doc.create({
    name: 'p',
    sequence: 'ACGT'.repeat(30),
    features: [
      createFeature({
        name: 'partial',
        type: 'CDS',
        strand: 'forward',
        segments: [rangeSegment(0, 30, { partialStart: true })],
      }),
      createFeature({
        name: 'cut',
        type: 'misc_feature',
        strand: 'forward',
        segments: [siteSegment(50)],
      }),
      createFeature({
        name: 'ordered',
        type: 'misc_binding',
        strand: 'forward',
        joining: 'order',
        segments: [rangeSegment(60, 62), rangeSegment(70, 72)],
      }),
    ],
    styles: [{ start: 0, end: 5, style: { bold: true } }],
    metadata: createMetadata({
      keywords: 'plasmid',
      version: 'X1.1',
      taxonomy: 'Bacteria',
      dbLinks: ['BioProject: PRJ1'],
      comments: ['a', 'b'],
      references: [createReference({ number: 1, remark: 'r' })],
    }),
  });

  it('names each thing, and writes the rest', () => {
    const out = writeSnapGene(doc);
    const text = out.losses.join('\n');
    for (const word of [
      'partial-end',
      '“cut”',
      'order(',
      'colours',
      'keywords',
      'version',
      'taxonomic',
      'DBLINK',
      'comments are joined',
      'remarks',
    ])
      expect(text).toContain(word);
    const again = readBack(out.bytes);
    expect(again.features.all().map((f) => f.name)).toEqual(['partial', 'ordered']);
  });

  it('lists nothing for a document SnapGene can hold whole', () => {
    const plain = Doc.create({ name: 'p', sequence: 'ACGT'.repeat(30) });
    expect(writeSnapGene(plain).losses).toEqual([]);
  });

  it('lists a GenBank record’s header lines SnapGene has no place for', () => {
    const gb = only(
      parseGenBank(
        [
          'LOCUS       X   20 bp    DNA     linear   SYN 15-APR-2012',
          'DEFINITION  test.',
          'ACCESSION   X',
          'VERSION     X.2',
          'KEYWORDS    kw.',
          'SOURCE      Thing',
          '  ORGANISM  Thing',
          '            Bacteria; Things.',
          'ORIGIN',
          '        1 acgtacgtac gtacgtacgt',
          '//',
        ].join('\n'),
      ).documents,
    );
    const out = writeSnapGene(gb);
    expect(out.losses.join(' ')).toContain('keywords');
    const again = readBack(out.bytes);
    expect(again.metadata.date).toBe('15-APR-2012');
    expect(again.metadata.division).toBe('SYN');
    expect(again.metadata.description).toBe('test.');
  });
});
