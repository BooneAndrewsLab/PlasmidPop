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

  it('keeps literal markup and entities in names, qualifiers and notes (#237)', () => {
    const doc = Doc.create({
      name: 'a <b>&amp; c',
      sequence: seq,
      features: [
        createFeature({
          name: '<i>x</i> &lt; y',
          type: 'CDS',
          strand: 'forward',
          segments: [rangeSegment(0, 30)],
          qualifiers: [{ name: 'note', value: 'a <b>bold</b> &amp; <html><body>c</body></html>' }],
        }),
      ],
      metadata: createMetadata({ description: '<p>d</p> &quot;', comments: ['&lt;br&gt;'] }),
    });
    const { again } = roundTrip(doc);
    expect(again.name).toBe(doc.name);
    expect(again.features.all()[0]?.name).toBe('<i>x</i> &lt; y');
    expect(again.features.all()[0]?.qualifiers[0]?.value).toBe(
      'a <b>bold</b> &amp; <html><body>c</body></html>',
    );
    expect(again.metadata.description).toBe('<p>d</p> &quot;');
    expect(again.metadata.comments).toEqual(['&lt;br&gt;']);
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

describe('writer: exact bytes (mutation)', () => {
  const text = (doc: SeqDocument, uuid = 'U-1') =>
    new TextDecoder().decode(writeSnapGene(doc, { uuid }).bytes);
  const seq = 'ACGTTGCAAC'.repeat(12);
  const notesOf = (doc: SeqDocument) => /<Notes>\n([\s\S]*?)\n<\/Notes>\n/.exec(text(doc))?.[1];
  const lossesOf = (doc: SeqDocument) => writeSnapGene(doc).losses;
  const withMeta = (meta: Parameters<typeof createMetadata>[0], extra = {}) =>
    Doc.create({ name: 'p', sequence: seq, metadata: createMetadata(meta), ...extra });
  type Qs = { name: string; value: string | null }[];
  const feat = (qualifiers: Qs, extra = {}) =>
    Doc.create({
      name: 'p',
      sequence: seq,
      topology: 'circular',
      features: [
        createFeature({
          name: 'f',
          type: 'misc_feature',
          strand: 'forward',
          segments: [rangeSegment(2, 12)],
          qualifiers,
          ...extra,
        }),
      ],
    });

  it('drops control characters and escapes attribute whitespace', () => {
    const xml = text(
      feat([{ name: 'note', value: 'a\u0001b\u0008c\u000bd\u000ee\u001ff\r\n\tg"<>&' }]),
    );
    expect(xml).toContain('<V text="abcdef&#13;&#10;&#9;g&quot;&lt;&gt;&amp;"/>');
    // Tab, LF and CR are legal in XML text and kept.
    expect(text(withMeta({ description: 'a\u0000b\tc\nd\re\u000cf' }))).toContain(
      '<Description>ab\tc\nd\ref</Description>',
    );
  });

  it.each([
    ['15-APR-2012', '2012.4.15'],
    ['5-JAN-2012', '2012.1.5'],
    ['01-DEC-1999', '1999.12.1'],
    [' 3-feb-2020 ', '2020.2.3'],
    ['x15-APR-2012', null],
    ['15-APR-2012x', null],
    ['15-XYZ-2012', null],
    ['', null],
  ])('writes the date %j as %j', (date, written) => {
    const notes = notesOf(withMeta({ date })) ?? '';
    const m = /<LastModified UTC="0:0:0">([^<]*)<\/LastModified>/.exec(notes);
    expect(m === null ? null : m[1]).toBe(written);
  });

  it('writes the notes block exactly, with every field and in order', () => {
    const doc = withMeta(
      {
        description: 'd & <e>',
        accession: 'AB1',
        organism: 'Orgo',
        division: 'SYN',
        date: '15-APR-2012',
        comments: ['one', 'two'],
        references: [
          createReference({ number: 1, authors: 'A "B"', title: 'T', journal: 'J', pubmed: '123' }),
          createReference({ number: 2, authors: 'C', title: 'U', journal: 'K' }),
        ],
      },
      { name: 'nm<' },
    );
    expect(notesOf(doc)).toBe(
      [
        '<UUID>U-1</UUID>',
        '<Type>Synthetic</Type>',
        '<Description>d &amp; &lt;e&gt;</Description>',
        '<LastModified UTC="0:0:0">2012.4.15</LastModified>',
        '<AccessionNumber>AB1</AccessionNumber>',
        '<Organism>Orgo</Organism>',
        '<SequenceClass>SYN</SequenceClass>',
        '<Comments>one\n\ntwo</Comments>',
        '<References>',
        '<Reference authors="A &quot;B&quot;" title="T" journal="J" pubMedID="123"/>',
        '<Reference authors="C" title="U" journal="K"/>',
        '</References>',
        '<CustomMapLabel>nm&lt;</CustomMapLabel>',
        '<UseCustomMapLabel>1</UseCustomMapLabel>',
      ].join('\n'),
    );
  });

  it('writes a bare notes block for a bare document', () => {
    expect(notesOf(withMeta({ division: 'PLN', comments: ['x'] }, { name: 'q' }))).toBe(
      [
        '<UUID>U-1</UUID>',
        '<Type>Natural</Type>',
        '<SequenceClass>PLN</SequenceClass>',
        '<Comments>x</Comments>',
        '<CustomMapLabel>q</CustomMapLabel>',
        '<UseCustomMapLabel>1</UseCustomMapLabel>',
      ].join('\n'),
    );
    expect(notesOf(withMeta({}, { name: 'q' }))).toBe(
      [
        '<UUID>U-1</UUID>',
        '<Type>Natural</Type>',
        '<CustomMapLabel>q</CustomMapLabel>',
        '<UseCustomMapLabel>1</UseCustomMapLabel>',
      ].join('\n'),
    );
  });

  it('names what the notes cannot hold, and only when it applies', () => {
    const ref = (o: object) => createReference({ number: 1, ...o });
    const refs = 'Reference remarks, consortia and base ranges are not written.';
    const made = 'PlasmidPop’s record of what this molecule was made from is not written.';
    const cases: [string, Parameters<typeof createMetadata>[0], string | null][] = [
      ['one comment', { comments: ['a'] }, null],
      [
        'two comments',
        { comments: ['a', 'b'] },
        'The comments are joined into the one comment SnapGene has.',
      ],
      ['plain reference', { references: [ref({ authors: 'A' })] }, null],
      ['remark', { references: [ref({ remark: 'r' })] }, refs],
      ['consortium', { references: [ref({ consortium: 'c' })] }, refs],
      ['location', { references: [ref({ location: '1..2' })] }, refs],
      [
        'extra headers',
        {
          extraHeaders: [
            { keyword: 'K', value: 'v' },
            { keyword: 'L', value: 'w' },
          ],
        },
        '2 further GenBank header line(s) are not written.',
      ],
      ['source = organism', { source: 'O', organism: 'O' }, null],
      ['no source', { organism: 'O' }, null],
      [
        'source differs',
        { source: 'S', organism: 'O' },
        'The source name, where it differs from the organism, is not written.',
      ],
      ['derived from', { derivedFrom: { checksum: 'cdseguid=x', fileName: 'f' } }, made],
      [
        'lineage',
        { lineage: { name: 'n', checksum: null, topology: 'linear', length: 1, step: null } },
        made,
      ],
      ['DNA molecule type', { moleculeType: 'DNA' }, null],
    ];
    for (const [label, meta, loss] of cases)
      expect(lossesOf(withMeta(meta)), label).toEqual(loss === null ? [] : [loss]);
    const protein = (moleculeType: string) =>
      Doc.create({
        name: 'p',
        sequence: 'MKVLA',
        alphabet: 'protein',
        metadata: createMetadata({ moleculeType }),
      });
    expect(lossesOf(protein('AA'))).toEqual(['The molecule type is not written.']);
    expect(lossesOf(protein(''))).toEqual([]);
  });

  it('writes an RNA with its Us as Ts, and lists that only when there are Us', () => {
    const rna = (sequence: string) => withMeta({ moleculeType: 'RNA' }, { sequence });
    expect(lossesOf(rna('GGAUCC'))).toEqual([
      'SnapGene writes an RNA with T where the RNA has U; the Us become Ts.',
    ]);
    expect(lossesOf(rna('ggaucc'))).toHaveLength(1);
    expect(lossesOf(rna('GGATCC'))).toEqual([]);
    expect(readBack(writeSnapGene(rna('GGAUCCuagU')).bytes).sequence.toString()).toBe('GGATCCtagT');
  });

  it('records overhangs only on a linear fragment, and names the enzymes only when set', () => {
    const ends = (l: string | null, r: string | null): DocumentEnds => ({
      left: { kind: "5'", overhang: 'AATT', enzyme: l },
      right: { kind: "3'", overhang: 'TT', enzyme: r },
    });
    const lin = (e: DocumentEnds) =>
      Doc.create({ name: 'f', sequence: 'AATTGATTACAGATTACATT', topology: 'linear', ends: e });
    expect(lossesOf(lin(ends(null, null)))).toEqual([]);
    for (const e of [ends('EcoRI', null), ends(null, 'EcoRI')])
      expect(lossesOf(lin(e))).toEqual([
        'The enzymes that made the ends are not recorded; the overhangs are.',
      ]);
    const xml = text(lin(ends(null, null)));
    expect(xml).toContain('<UpstreamStickiness>4</UpstreamStickiness>');
    expect(xml).toContain('<DownstreamStickiness>-2</DownstreamStickiness>');
    const circ = Doc.create({
      name: 'c',
      sequence: seq,
      topology: 'circular',
      ends: ends('E', 'E'),
    });
    const cx = text(circ);
    expect(cx).not.toContain('<UpstreamStickiness>4<');
    expect(cx).not.toContain('<DownstreamStickiness>-2<');
    expect(lossesOf(circ)).toEqual([]);
  });

  it('writes qualifiers as <Q> elements: grouped by name, flags, and integers only where SnapGene reads them', () => {
    const only = (qualifiers: Qs) =>
      (text(feat(qualifiers)).match(/<Q [\s\S]*?<\/Q>|<Q [^>]*\/>/g) ?? []).join('');
    expect(
      only([
        { name: 'note', value: 'a' },
        { name: 'note', value: 'b&' },
        { name: 'gene', value: 'x' },
        { name: 'note', value: 'c' },
      ]),
    ).toBe(
      '<Q name="note"><V text="a"/><V text="b&amp;"/></Q><Q name="gene"><V text="x"/></Q><Q name="note"><V text="c"/></Q>',
    );
    expect(only([{ name: 'pseudo', value: null }])).toBe('<Q name="pseudo"/>');
    expect(
      only([
        { name: 'gene', value: 'x' },
        { name: 'gene', value: null },
      ]),
    ).toBe('<Q name="gene"><V text="x"/></Q>');
    const numeric: [string, string, string][] = [
      ['codon_start', '3', '<V int="3"/>'],
      ['transl_table', '11', '<V int="11"/>'],
      ['transl_table', '1a', '<V text="1a"/>'],
      ['codon_start', 'a1', '<V text="a1"/>'],
      ['codon_start', 'x', '<V text="x"/>'],
      ['codon_start', '', '<V text=""/>'],
      ['note', '5', '<V text="5"/>'],
      ['gene', '11', '<V text="11"/>'],
    ];
    for (const [name, value, v] of numeric)
      expect(only([{ name, value }]), `${name}=${value}`).toBe(`<Q name="${name}">${v}</Q>`);
  });

  describe('primers', () => {
    const body = 'GATTACAGGCTTAACCGTAGCTAGGATCCA';
    const prim = (
      segments: (ReturnType<typeof rangeSegment> | ReturnType<typeof siteSegment>)[],
      qualifiers: Qs,
      extra: object = {},
      docExtra: object = {},
    ) =>
      Doc.create({
        name: 'p',
        sequence: body,
        topology: 'circular',
        ...docExtra,
        features: [
          createFeature({
            name: 'pr',
            type: 'primer_bind',
            strand: 'forward',
            segments,
            qualifiers,
            ...extra,
          }),
        ],
      });
    const isPrimer = (doc: SeqDocument) => text(doc).includes('<Primer recentID="0"');
    const r = (a: number, b: number) => [rangeSegment(a, b)];

    it('writes the site, its bases and the description', () => {
      let xml = text(prim(r(2, 8), []));
      expect(xml).toContain('<Primer recentID="0" name="pr" sequence="TTACAG">');
      expect(xml).toContain(
        '<BindingSite location="2-7" boundStrand="0" annealedBases="TTACAG"><Component hybridizedRange="2-7" bases="TTACAG"/></BindingSite>',
      );
      xml = text(prim(r(2, 8), [{ name: 'note', value: 'a "d"' }], { strand: 'reverse' }));
      expect(xml).toContain(
        '<Primer recentID="0" name="pr" sequence="CTGTAA" description="a &quot;d&quot;">',
      );
      expect(xml).toContain('boundStrand="1" annealedBases="CTGTAA"');
      expect(text(prim(r(2, 8), []))).not.toContain(' description=');
      expect(
        text(
          prim(r(2, 8), [
            { name: 'note', value: 'sequence: TTT' },
            { name: 'note', value: '' },
          ]),
        ),
      ).toContain('sequence="TTT">');
      // Across the origin
      xml = text(prim([rangeSegment(26, 34)], []));
      expect(xml).toContain('location="26-3" boundStrand="0" annealedBases="TCCAGATT"');
    });

    it('shifts the site by the bases a 3′ overhang adds in front', () => {
      const doc = prim(
        r(2, 8),
        [],
        {},
        {
          topology: 'linear',
          ends: {
            left: { kind: "3'", overhang: 'CG', enzyme: null },
            right: { kind: 'blunt', overhang: '', enzyme: null },
          },
        },
      );
      expect(text(doc)).toContain('location="4-9" boundStrand="0" annealedBases="TTACAG"');
    });

    it('keeps anything SnapGene’s primer list cannot hold whole as a feature', () => {
      const note = (value: string | null) => ({ name: 'note', value });
      const cases: [string, SeqDocument][] = [
        ['site', prim([siteSegment(5)], [])],
        ['two segments', prim([rangeSegment(2, 5), rangeSegment(8, 12)], [])],
        ['partial start', prim([rangeSegment(2, 8, { partialStart: true })], [])],
        ['partial end', prim([rangeSegment(2, 8, { partialEnd: true })], [])],
        ['joined', prim(r(2, 8), [], { joining: 'order' })],
        ['other qualifier', prim(r(2, 8), [{ name: 'label', value: 'x' }])],
        ['null note', prim(r(2, 8), [note(null)])],
        ['two descriptions', prim(r(2, 8), [note('a'), note('b')])],
        ['two sequences', prim(r(2, 8), [note('sequence: AA'), note('sequence: CC')])],
      ];
      for (const [label, doc] of cases) expect(isPrimer(doc), label).toBe(false);
      expect(
        isPrimer(prim(r(2, 8), [note('sequence: AA'), note('b')])),
        'sequence + description',
      ).toBe(true);
    });
  });
});

describe('writer: exact bytes, packets and layout (mutation)', () => {
  const dec = new TextDecoder();
  const seq = 'ACGTTGCAAC'.repeat(12);
  type Qs = { name: string; value: string | null }[];
  const note = (value: string | null, name = 'note') => ({ name, value });
  const packetsOf = (bytes: Uint8Array) => {
    const out: { type: number; payload: Uint8Array }[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = 0; at < bytes.length;) {
      const length = view.getUint32(at + 1, false);
      out.push({ type: bytes[at] ?? -1, payload: bytes.subarray(at + 5, at + 5 + length) });
      at += 5 + length;
    }
    return out;
  };
  const featureXml = (doc: SeqDocument, options = {}) =>
    dec
      .decode(packetsOf(writeSnapGene(doc, options).bytes).find((p) => p.type === 0x0a)?.payload)
      .split('<Feature ')
      .slice(1)
      .map((f) => '<Feature ' + f.replace('</Features>', ''));
  const make = (features: ReturnType<typeof createFeature>[], extra: object = {}) =>
    Doc.create({ name: 'p', sequence: seq, topology: 'circular', features, ...extra });
  const mk = (init: object) =>
    createFeature({
      name: 'f',
      type: 'misc_feature',
      strand: 'forward',
      segments: [rangeSegment(2, 12)],
      ...init,
    });
  const losses = (doc: SeqDocument) => writeSnapGene(doc).losses;

  describe('packets', () => {
    it.each([
      ['dna', { topology: 'circular' as const }, 1, 0x00, [0x09, 0x00, 0x08, 0x0a, 0x05, 0x06]],
      ['rna', { metadata: createMetadata({ moleculeType: 'RNA' }) }, 7, 0x20, undefined],
      ['prot', { alphabet: 'protein' as const }, 2, 0x15, [0x09, 0x15, 0x08, 0x0a, 0x06]],
    ])('lays out a %s file', (kind, extra, cookieKind, seqType, order) => {
      const doc = Doc.create({
        name: 'p',
        sequence: kind === 'prot' ? 'MKVLAAGIVG' : seq,
        methylation: { dam: true, dcm: true },
        ...extra,
      });
      const out = writeSnapGene(doc, { uuid: 'U-9' });
      const packets = packetsOf(out.bytes);
      expect(packets.map((p) => p.type)).toEqual(order ?? [0x09, seqType, 0x08, 0x0a, 0x05, 0x06]);
      const cookie = packets[0]?.payload ?? new Uint8Array();
      expect(cookie.length).toBe(14);
      expect(dec.decode(cookie.subarray(0, 8))).toBe('SnapGene');
      expect(Array.from(cookie.subarray(8))).toEqual([0, cookieKind, 0, 15, 0, 19]);
      // The packet length is a 4-byte big-endian count.
      expect(Array.from(out.bytes.subarray(0, 5))).toEqual([0x09, 0, 0, 0, 14]);
      const sequence = packets[1]?.payload ?? new Uint8Array();
      expect(dec.decode(sequence.subarray(1))).toBe(kind === 'prot' ? 'MKVLAAGIVG' : seq);
      expect(sequence[0]).toBe(kind === 'dna' ? 0x0f : 0);
    });

    it('writes the sequence flags byte from topology and methylation', () => {
      const flagsOf = (extra: object) =>
        packetsOf(
          writeSnapGene(
            Doc.create({
              name: 'p',
              sequence: seq,
              methylation: { dam: false, dcm: false },
              ...extra,
            }),
          ).bytes,
        )[1]?.payload[0];
      expect(flagsOf({ topology: 'linear' })).toBe(0x02);
      expect(flagsOf({ topology: 'circular' })).toBe(0x03);
      expect(flagsOf({ topology: 'linear', methylation: { dam: true, dcm: false } })).toBe(0x06);
      expect(flagsOf({ topology: 'linear', methylation: { dam: false, dcm: true } })).toBe(0x0a);
      expect(flagsOf({ topology: 'circular', methylation: { dam: true, dcm: true } })).toBe(0x0f);
    });

    it('writes the properties, features, empty primers and notes packets exactly', () => {
      const doc = Doc.create({ name: 'p', sequence: seq, topology: 'circular' });
      const packets = packetsOf(writeSnapGene(doc, { uuid: 'U-9' }).bytes);
      const at = (i: number) => dec.decode(packets[i]?.payload);
      expect(at(2)).toBe(
        '<AdditionalSequenceProperties><UpstreamStickiness>0</UpstreamStickiness>' +
          '<DownstreamStickiness>0</DownstreamStickiness>' +
          '<UpstreamModification>Unmodified</UpstreamModification>' +
          '<DownstreamModification>Unmodified</DownstreamModification>' +
          '</AdditionalSequenceProperties>',
      );
      expect(at(3)).toBe('<?xml version="1.0"?><Features nextValidID="0"></Features>');
      expect(at(4)).toBe(
        '<?xml version="1.0"?><Primers nextValidID="0"><HybridizationParams minContinuousMatchLen="10" allowMismatch="1" minMeltingTemperature="40" showAdditionalFivePrimeMatches="1" minimumFivePrimeAnnealing="15"/></Primers>\n',
      );
      expect(at(5).startsWith('<Notes>\n<UUID>U-9</UUID>\n')).toBe(true);
      expect(at(5).endsWith('\n</Notes>\n')).toBe(true);
    });
  });

  describe('losses', () => {
    it('lists a sequencing read', () => {
      const doc = Doc.create({
        name: 'p',
        sequence: 'ACGT',
        read: { qualities: new Uint8Array([30, 30, 30, 30]), trace: null },
      });
      expect(losses(doc)).toEqual([
        'The sequencing read (qualities and trace) is not written; only its bases are.',
      ]);
      expect(losses(Doc.create({ name: 'p', sequence: 'ACGT' }))).toEqual([]);
    });

    it('lists features between bases, named or not, and writes none of them', () => {
      const doc = make([
        mk({ name: 'nm', segments: [siteSegment(3)] }),
        mk({ name: '', type: 'gene', segments: [siteSegment(5)] }),
        mk({ name: 'kept' }),
      ]);
      expect(losses(doc)).toEqual([
        '2 feature(s) located between bases only are left out: “nm”, “gene”.',
      ]);
      expect(featureXml(doc)).toHaveLength(1);
      expect(featureXml(doc)[0]).toContain('recentID="0" name="kept"');
    });

    it('says what is lost of a feature with a site among its segments, and only then', () => {
      const mixed = make([mk({ name: 'm', segments: [rangeSegment(2, 12), siteSegment(20)] })]);
      expect(losses(mixed)).toEqual([
        'Feature “m”: a location between two bases cannot be written; the rest of it is.',
      ]);
      expect(featureXml(mixed)).toHaveLength(1);
      expect(losses(make([mk({ segments: [rangeSegment(2, 12), rangeSegment(20, 30)] })]))).toEqual(
        [],
      );
      expect(losses(make([mk({ segments: [rangeSegment(2, 12)] })]))).toEqual([]);
    });

    it('counts order(...) features, not join(...) ones', () => {
      const two = [rangeSegment(2, 12), rangeSegment(20, 30)];
      expect(losses(make([mk({ segments: two, joining: 'order' })]))).toEqual([
        '1 feature(s) with order(…) locations are written as joined.',
      ]);
      expect(
        losses(
          make([mk({ segments: two, joining: 'order' }), mk({ segments: two, joining: 'order' })]),
        ),
      ).toEqual(['2 feature(s) with order(…) locations are written as joined.']);
      expect(losses(make([mk({ segments: two })]))).toEqual([]);
    });

    it('counts features that lose partial marks, one per feature', () => {
      const partial = (s: number, e: number, o: object) => rangeSegment(s, e, o);
      expect(
        losses(
          make([
            mk({ segments: [partial(2, 12, { partialStart: true })] }),
            mk({ segments: [partial(2, 12, { partialEnd: true }), partial(20, 30, {})] }),
            mk({ segments: [partial(2, 12, {})] }),
          ]),
        ),
      ).toEqual(['2 feature(s) lose their partial-end marks (< and >).']);
    });
  });

  describe('features', () => {
    it('writes a feature element exactly, without a direction for a forward misc_feature', () => {
      const [f] = featureXml(make([mk({ qualifiers: [note('hi')] })]));
      expect(f).toBe(
        '<Feature recentID="0" name="f" type="misc_feature" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1">' +
          '<Segment range="3-12" color="noColor" type="standard"/>' +
          '<Q name="note"><V text="hi"/></Q></Feature>',
      );
    });

    it('writes the Features packet as one string, the features joined with nothing between them', () => {
      const doc = make([mk({ name: 'a' }), mk({ name: 'b', segments: [rangeSegment(20, 30)] })]);
      const packet = packetsOf(writeSnapGene(doc).bytes).find((q) => q.type === 0x0a);
      const attrs = (name: string, range: string) =>
        `<Feature recentID="${name === 'a' ? 0 : 1}" name="${name}" type="misc_feature" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1">` +
        `<Segment range="${range}" color="noColor" type="standard"/></Feature>`;
      expect(dec.decode(packet?.payload)).toBe(
        '<?xml version="1.0"?><Features nextValidID="2">' +
          attrs('a', '3-12') +
          attrs('b', '21-30') +
          '</Features>',
      );
    });

    it('writes directions: reverse always, forward unless the type is undirected', () => {
      const dir = (init: object) => featureXml(make([mk(init)]))[0] ?? '';
      expect(dir({ strand: 'reverse' })).toContain(' directionality="2" type="misc_feature"');
      expect(dir({ type: 'gene' })).toContain(' directionality="1" type="gene"');
      expect(dir({ type: 'misc_feature' })).not.toContain('directionality');
    });

    it('colours: the colour note, then the callback, then none', () => {
      const color = (qualifiers: Qs, options = {}) =>
        /<Segment range="[^"]*" color="([^"]*)"/.exec(
          featureXml(make([mk({ qualifiers })]), options)[0] ?? '',
        )?.[1];
      expect(color([])).toBe('noColor');
      expect(color([], { colorOf: () => '#123456' })).toBe('#123456');
      expect(color([note('color: #AbCdEf')], { colorOf: () => '#123456' })).toBe('#abcdef');
      // Only a `note` qualifier holding the colour counts; the rest stay.
      const doc = make([mk({ qualifiers: [note('color: #AbCdEf', 'label'), note(null)] })]);
      const xml = featureXml(doc)[0] ?? '';
      expect(xml).toContain('color="noColor"');
      expect(xml).toContain('<Q name="label"><V text="color: #AbCdEf"/></Q><Q name="note"/>');
      const coloured = featureXml(make([mk({ qualifiers: [note('color: #AbCdEf')] })]))[0] ?? '';
      expect(coloured).not.toContain('<Q');
    });

    it('segments: a gap between pieces, none between adjacent ones', () => {
      const xml = (segments: ReturnType<typeof rangeSegment>[]) =>
        featureXml(make([mk({ segments })]))[0] ?? '';
      expect(xml([rangeSegment(2, 12), rangeSegment(20, 30)])).toContain(
        '<Segment range="3-12" color="noColor" type="standard"/>' +
          '<Segment range="13-20" color="noColor" type="gap"/>' +
          '<Segment range="21-30" color="noColor" type="standard"/>',
      );
      expect(xml([rangeSegment(2, 12), rangeSegment(12, 30)])).not.toContain('gap');
      expect(xml([rangeSegment(20, 30), rangeSegment(2, 12)])).not.toContain('gap');
    });

    it('translated and reading frame: only a CDS with a codon_start of 1 to 3', () => {
      const one = (init: object) => featureXml(make([mk(init)]))[0] ?? '';
      const cds = (qualifiers: Qs, strand = 'forward') => one({ type: 'CDS', qualifiers, strand });
      expect(cds([note('2', 'codon_start')])).toContain(
        ' type="CDS" readingFrame="2" allowSegmentOverlaps',
      );
      expect(cds([note('2', 'codon_start')])).toContain('type="standard" translated="1"/>');
      expect(cds([note('2', 'codon_start')], 'reverse')).toContain('readingFrame="-2"');
      // The codon_start is found by name, wherever it is among the qualifiers.
      expect(cds([note('9', 'label'), note('3', 'codon_start')])).toContain('readingFrame="3"');
      for (const bad of ['0', '4', '12', '31', '41', 'x'])
        expect(cds([note(bad, 'codon_start')])).not.toContain('readingFrame');
      expect(cds([note('9', 'label')])).not.toContain('readingFrame');
      expect(cds([])).not.toContain('readingFrame');
      const gene = one({ type: 'gene', qualifiers: [note('2', 'codon_start')] });
      expect(gene).not.toContain('readingFrame');
      expect(gene).not.toContain('translated');
    });
  });

  describe('primer groups', () => {
    const body = 'ACGTTGCAACACGTTGCAACTTTTGGGGAAAA';
    const pr = (name: string, start: number, qualifiers: Qs = [], strand = 'forward') =>
      createFeature({
        name,
        type: 'primer_bind',
        strand: strand as 'forward',
        segments: [rangeSegment(start, start + 8)],
        qualifiers,
      });
    const groups = (features: ReturnType<typeof createFeature>[]) => {
      const doc = Doc.create({ name: 'p', sequence: body, topology: 'circular', features });
      const xml = dec.decode(
        packetsOf(writeSnapGene(doc).bytes).find((p) => p.type === 0x05)?.payload,
      );
      return xml.split('<Primer ').length - 1;
    };
    const sites = (features: ReturnType<typeof createFeature>[]) =>
      groups(features) === 1 ? 'one' : 'many';
    it('merges a primer found twice, and nothing that differs in any one field', () => {
      // Positions 0 and 10 hold the same bases.
      expect(sites([pr('a', 0), pr('a', 10)])).toBe('one');
      expect(sites([pr('a', 0, [note('d')]), pr('a', 10, [note('d')])])).toBe('one');
      expect(groups([pr('a', 0), pr('b', 10)])).toBe(2);
      expect(groups([pr('a', 0), pr('a', 20)])).toBe(2);
      expect(groups([pr('a', 0, [note('d')]), pr('a', 10, [note('e')])])).toBe(2);
      expect(groups([pr('a', 0, [note('d')]), pr('a', 10)])).toBe(2);
    });

    it('lists the sites of a merged primer under one element', () => {
      const doc = Doc.create({
        name: 'p',
        sequence: body,
        topology: 'circular',
        features: [pr('a', 0), pr('a', 10)],
      });
      const xml = dec.decode(
        packetsOf(writeSnapGene(doc).bytes).find((p) => p.type === 0x05)?.payload,
      );
      expect(xml.match(/<BindingSite /g)).toHaveLength(2);
      expect(xml).toContain('<Primer recentID="0" name="a" sequence="ACGTTGCA">');
      expect(xml).toContain('<BindingSite location="0-7" boundStrand="0"');
      expect(xml).toContain('<BindingSite location="10-17" boundStrand="0"');
    });
  });

  describe('feature ends regained from an overhang', () => {
    const body = 'GATTACAGATTACAGATTACAGATTACA';
    const ends: DocumentEnds = {
      left: { kind: "3'", overhang: 'CG', enzyme: null },
      right: { kind: "5'", overhang: 'GATC', enzyme: null },
    };
    const cds = (name: string, segments: ReturnType<typeof rangeSegment>[], init: object = {}) =>
      createFeature({
        name,
        type: 'CDS',
        strand: 'forward',
        segments,
        qualifiers: [note('2', 'codon_start')],
        ...init,
      });
    const doc = (features: ReturnType<typeof createFeature>[], e = ends) =>
      Doc.create({ name: 'frag', sequence: body, topology: 'linear', ends: e, features });
    const one = (f: ReturnType<typeof createFeature>, e = ends) => {
      const [x] = featureXml(doc([f], e));
      return {
        ranges: [
          ...(x ?? '').matchAll(/<Segment range="([^"]*)" color="[^"]*" type="standard"/g),
        ].map((m) => m[1]),
        frame: /codon_start"><V int="(\d+)"/.exec(x ?? '')?.[1],
        reading: /readingFrame="(-?\d)"/.exec(x ?? '')?.[1],
        lost: losses(doc([f], e)).some((l) => l.includes('partial-end')),
      };
    };
    const ps = { partialStart: true };
    const pe = { partialEnd: true };

    it.each([
      // Cut-off start regained (shift 2): the range reaches base 1, the frame moves by 2.
      [
        'forward, partial start at 0',
        cds('a', [rangeSegment(0, 10, ps)]),
        ['1-12'],
        '1',
        '1',
        false,
      ],
      // Not partial: starts after the shift, frame untouched.
      ['forward, whole, at 0', cds('a', [rangeSegment(0, 10)]), ['3-12'], '2', '2', false],
      ['partial start not at 0', cds('a', [rangeSegment(4, 10, ps)]), ['7-12'], '2', '2', true],
      [
        'reverse, partial start at 0',
        cds('a', [rangeSegment(0, 10, ps)], { strand: 'reverse' }),
        ['1-12'],
        '2',
        '-2',
        false,
      ],
      // Cut-off end regained (back 4): the reverse frame moves by 4.
      [
        'reverse, partial end at the end',
        cds('a', [rangeSegment(18, 28, pe)], { strand: 'reverse' }),
        ['21-34'],
        '3',
        '-3',
        false,
      ],
      [
        'forward, partial end at the end',
        cds('a', [rangeSegment(18, 28, pe)]),
        ['21-34'],
        '2',
        '2',
        false,
      ],
      [
        'partial end short of the end',
        cds('a', [rangeSegment(10, 20, pe)], { strand: 'reverse' }),
        ['13-22'],
        '2',
        '-2',
        true,
      ],
      [
        'whole, at the end',
        cds('a', [rangeSegment(18, 28)], { strand: 'reverse' }),
        ['21-30'],
        '2',
        '-2',
        false,
      ],
      // Only the first piece of a forward feature and the last of a reverse one carries the frame.
      [
        'forward, partial piece not first',
        cds('a', [rangeSegment(10, 20), rangeSegment(0, 5, ps)]),
        ['13-22', '1-7'],
        '2',
        '2',
        false,
      ],
      [
        'reverse, partial piece not last',
        cds('a', [rangeSegment(18, 28, pe), rangeSegment(0, 5)], { strand: 'reverse' }),
        ['21-34', '3-7'],
        '2',
        '-2',
        false,
      ],
      [
        'forward, two pieces, first partial',
        cds('a', [rangeSegment(0, 5, ps), rangeSegment(10, 20)]),
        ['1-7', '13-22'],
        '1',
        '1',
        false,
      ],
      [
        'reverse, two pieces, last partial',
        cds('a', [rangeSegment(0, 5), rangeSegment(18, 28, pe)], { strand: 'reverse' }),
        ['3-7', '21-34'],
        '3',
        '-3',
        false,
      ],
    ])('%s', (_name, f, ranges, frame, reading, lost) => {
      expect(one(f)).toEqual({ ranges, frame, reading, lost });
    });

    it('moves a codon_start by the bases regained, modulo 3, and only a valid one', () => {
      const frames = (qualifiers: Qs) =>
        one(cds('a', [rangeSegment(0, 10, ps)], { qualifiers })).frame;
      expect(frames([note('1', 'codon_start')])).toBe('3');
      expect(frames([note('3', 'codon_start')])).toBe('2');
      for (const bad of ['0', '4', '31', '41'])
        expect(frames([note(bad, 'codon_start')])).toBe(bad);
      // Another qualifier with such a value stays as it is.
      const q = featureXml(
        doc([cds('a', [rangeSegment(0, 10, ps)], { qualifiers: [note('1', 'label')] })]),
      )[0];
      expect(q).toContain('<Q name="label"><V text="1"/></Q>');
    });

    it('shifts a feature past a left overhang only', () => {
      const left: DocumentEnds = {
        left: { kind: "3'", overhang: 'CG', enzyme: null },
        right: { kind: 'blunt', overhang: '', enzyme: null },
      };
      const right: DocumentEnds = {
        left: { kind: 'blunt', overhang: '', enzyme: null },
        right: { kind: "5'", overhang: 'GATC', enzyme: null },
      };
      // No overhang at the start: a partial start keeps its place and its mark is lost.
      expect(one(cds('a', [rangeSegment(0, 10, ps)]), right)).toMatchObject({
        ranges: ['1-10'],
        frame: '2',
        lost: true,
      });
      // No overhang at the end: likewise.
      expect(one(cds('a', [rangeSegment(18, 28, pe)], { strand: 'reverse' }), left)).toMatchObject({
        ranges: ['21-30'],
        frame: '2',
        lost: true,
      });
    });
  });
});
