import { type SeqDocument, documentChecksum, formatLocation } from '@/core';
import { listFixtures, listLocalFixtures, readFixture } from '@/test/fixtures';

import { type ParseResult, FormatError } from '../types';
import { parseGenBank } from './parseGenBank';
import { writeGenBank } from './writeGenBank';

function only(result: ParseResult): SeqDocument {
  const doc = result.documents[0];
  if (doc === undefined) throw new Error('expected one document');
  return doc;
}

/** Everything that should survive a round-trip, minus random feature ids. */
function fingerprint(doc: SeqDocument) {
  return {
    name: doc.name,
    topology: doc.topology,
    sequence: doc.sequence.toString(),
    // A record without a division is written as SYN (see writeGenBank).
    metadata: { ...doc.metadata, division: doc.metadata.division || 'SYN' },
    ends: doc.ends,
    features: doc.features.all().map(({ id: _id, ...rest }) => rest),
  };
}

/** Feature locations of a GenBank text, with wrapped locations re-joined. */
function originalLocations(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.startsWith('FEATURES'));
  const end = lines.findIndex((l) => l.startsWith('ORIGIN'));
  const out: string[] = [];
  let inLocation = false;
  for (const line of lines.slice(start + 1, end)) {
    const key = /^ {5}(\S+)\s+(\S.*)$/.exec(line);
    if (key !== null) {
      out.push((key[2] ?? '').trim());
      inLocation = true;
    } else if (line.trim().startsWith('/')) {
      inLocation = false;
    } else if (inLocation && out.length > 0) {
      out[out.length - 1] = (out[out.length - 1] ?? '') + line.trim();
    }
  }
  return out;
}

function expectRoundTrip(text: string, label: string): void {
  const first = parseGenBank(text);
  expect(first.documents.length, label).toBeGreaterThan(0);
  const written = first.documents.map(writeGenBank).join('');
  const second = parseGenBank(written);
  expect(second.documents.map(fingerprint), `${label}: semantic round-trip`).toEqual(
    first.documents.map(fingerprint),
  );
  const rewritten = second.documents.map(writeGenBank).join('');
  expect(rewritten, `${label}: writer is idempotent`).toBe(written);
  for (const line of written.split('\n')) {
    // A long LOCUS name may push that one line past 79 columns; NCBI allows it.
    if (line.length > 79 && !line.startsWith('LOCUS')) {
      // Only unbreakable words may overflow.
      expect(line.slice(21).includes(' '), `${label}: overlong line "${line}"`).toBe(false);
    }
  }
}

describe('GenBank fixtures from NCBI', () => {
  const fixtures = listFixtures();

  it('has the expected fixture set', () => {
    expect(fixtures).toEqual([
      'AF177870.gb',
      'AJ237582.gb',
      'J01749.gb',
      'L09137.gb',
      'NC_001422.1.gb',
      'NM_000581.gb',
      'U49845.gb',
    ]);
  });

  for (const name of fixtures) {
    describe(name, () => {
      // Built in each test that needs it, not once while the file loads: work
      // done at load cannot be told apart per test by mutation testing (#77).
      const parsed = () => {
        const text = readFixture(name);
        const result = parseGenBank(text);
        const doc = result.documents[0];
        if (doc === undefined) throw new Error('no document');
        return { text, result, doc };
      };

      it('checks out against the reference SEGUID implementation', () => {
        const { doc } = parsed();
        // These are not our numbers: each was computed by the reference
        // JavaScript implementation (`seguid/seguid-javascript`) over the
        // same fixture, so they pin the whole path — parsing the ORIGIN
        // block, the topology off the LOCUS line, the strand and the
        // rotation — against somebody else's arithmetic on a real record,
        // where the published vectors are eight bases long.
        const expected: Readonly<Record<string, string>> = {
          'AF177870.gb': 'ldseguid=6W6l7BQluAQXJj6Svj_GGDX9aVQ',
          'AJ237582.gb': 'ldseguid=ZseyAgw6r3sfU0fqs2FIbjtghok',
          'J01749.gb': 'cdseguid=H-FY2ZzvKeazrRW2dNeSeMikjoc',
          'L09137.gb': 'cdseguid=mCC0B3UMZfgLyh3Pl574MVjm30U',
          'NC_001422.1.gb': 'cdseguid=QnQ29umcBWohNMhfcFbI9fv1zwA',
          // Added later and computed by a separate Python implementation of
          // the spec (hashlib), which reproduces the linear values above.
          'NM_000581.gb': 'ldseguid=kNDFGKxWhpOW_tBzh6GlnduF5UM',
          'U49845.gb': 'ldseguid=nNE7TwWKYuNXOHdAmChDxGK9QTg',
        };
        expect(documentChecksum(doc)?.text).toBe(expected[name]);
      });

      it('parses without warnings and with the LOCUS length', () => {
        const { text, result, doc } = parsed();
        expect(result.warnings).toEqual([]);
        expect(result.documents).toHaveLength(1);
        const locusLength = Number(/(\d+) bp/.exec(text)?.[1]);
        expect(doc.length).toBe(locusLength);
        expect(doc.features.size).toBeGreaterThan(0);
      });

      it('re-formats every feature location exactly as NCBI wrote it', () => {
        const { text, doc } = parsed();
        const originals = originalLocations(text);
        const ours = doc.features.all().map((f) => formatLocation(f, doc.length, doc.topology));
        expect(ours).toEqual(originals);
      });

      it('round-trips through the writer', () => {
        const { text } = parsed();
        expectRoundTrip(text, name);
      });
    });
  }

  it('reads pUC19 header fields', () => {
    const doc = parseGenBank(readFixture('L09137.gb')).documents[0];
    if (doc === undefined) throw new Error('no document');
    expect(doc.name).toBe('SYNPUC19CV');
    expect(doc.topology).toBe('circular');
    expect(doc.length).toBe(2686);
    expect(doc.metadata).toMatchObject({
      description: 'Cloning vector pUC19c, complete sequence.',
      accession: 'L09137 X02514',
      version: 'L09137.2',
      keywords: '',
      source: 'Cloning vector pUC19c',
      organism: 'Cloning vector pUC19c',
      taxonomy: 'other sequences; artificial sequences; vectors.',
      moleculeType: 'DNA',
      division: 'SYN',
      date: '22-MAY-2002',
    });
    expect(doc.metadata.references).toHaveLength(5);
    expect(doc.metadata.references[0]).toMatchObject({
      number: 1,
      location: '(bases 1 to 2686)',
      authors: 'Yanisch-Perron,C., Vieira,J. and Messing,J.',
    });
    expect(doc.metadata.comments[0]).toMatch(/^On Apr 11, 2002/);
  });

  it('merges phiX174 origin-spanning joins into single wrapped segments', () => {
    const doc = parseGenBank(readFixture('NC_001422.1.gb')).documents[0];
    if (doc === undefined) throw new Error('no document');
    expect(doc.topology).toBe('circular');
    const spanning = doc.features
      .all()
      .filter((f) => f.segments.some((s) => s.kind === 'range' && s.end > doc.length));
    expect(spanning.length).toBe(6);
    const geneA = spanning.find(
      (f) => f.type === 'gene' && f.segments[0]?.kind === 'range' && f.segments[0].start === 3980,
    );
    expect(geneA?.segments).toEqual([expect.objectContaining({ start: 3980, end: 5386 + 136 })]);
    expect(doc.featureSequence(geneA?.id ?? '')).toHaveLength(5386 - 3980 + 136);
  });

  it('keeps multi-exon and partial locations (AJ237582)', () => {
    const doc = parseGenBank(readFixture('AJ237582.gb')).documents[0];
    if (doc === undefined) throw new Error('no document');
    const mrna = doc.features.all().find((f) => f.type === 'mRNA');
    expect(mrna?.segments).toEqual([
      expect.objectContaining({ start: 0, end: 48, partialStart: true, partialEnd: false }),
      expect.objectContaining({ start: 142, end: 206, partialStart: false, partialEnd: true }),
    ]);
    const cds = doc.features.all().find((f) => f.type === 'CDS');
    expect(cds?.qualifiers.find((q) => q.name === 'translation')?.value).toMatch(/^[A-Z]+$/);
    expect(cds?.qualifiers.find((q) => q.name === 'codon_start')?.value).toBe('2');
  });

  it('reads reverse-strand features (U49845)', () => {
    const doc = parseGenBank(readFixture('U49845.gb')).documents[0];
    if (doc === undefined) throw new Error('no document');
    const rev = doc.features.all().filter((f) => f.strand === 'reverse');
    expect(rev.length).toBeGreaterThan(0);
    const first = doc.features.all().find((f) => f.type === 'CDS');
    expect(first?.segments[0]).toMatchObject({ start: 0, end: 206, partialStart: true });
    expect(first?.name).toBe('TCP1-beta');
  });
});

const localFixtures = listLocalFixtures();

// Skipped where the private fixtures are absent (CI); Vitest fails a suite with no tests.
describe.skipIf(localFixtures.length === 0)(
  'local GenBank fixtures (fixtures/local, not committed)',
  () => {
    const local = localFixtures;
    it.each(local.map((f) => [f.name, f.text] as const))(
      '%s parses and round-trips',
      (name, text) => {
        const result = parseGenBank(text);
        expect(result.documents).toHaveLength(1);
        const doc = result.documents[0];
        if (doc === undefined) throw new Error('no document');
        expect(doc.length).toBeGreaterThan(0);
        expect(doc.features.size).toBeGreaterThan(0);
        for (const f of doc.features) expect(f.name).not.toBe('');
        expectRoundTrip(text, name);
      },
    );
  },
);

describe('GenBank parser edge cases', () => {
  const seq = 'ACGTACGTACGTACGTACGT'; // 20 bp
  const originLines = `ORIGIN\n        1 ${seq.slice(0, 10)} ${seq.slice(10)}\n//\n`;
  const record = (locus: string, features: string, extraHeader = ''): string =>
    `${locus}\n${extraHeader}FEATURES             Location/Qualifiers\n${features}${originLines}`;

  it('handles SnapGene, ApE and spaced LOCUS lines', () => {
    const snap = parseGenBank(
      record('LOCUS       Exported                  20 bp DNA     circular SYN 01-JAN-2020', ''),
    ).documents[0];
    expect(snap).toMatchObject({ name: 'Exported', topology: 'circular' });
    expect(snap?.metadata).toMatchObject({
      moleculeType: 'DNA',
      division: 'SYN',
      date: '01-JAN-2020',
    });

    const ape = parseGenBank(
      record('LOCUS       pMy(1)                  20 bp ds-DNA     linear       25-FEB-2026', ''),
    ).documents[0];
    expect(ape).toMatchObject({ name: 'pMy(1)', topology: 'linear' });
    expect(ape?.metadata).toMatchObject({
      moleculeType: 'ds-DNA',
      division: '',
      date: '25-FEB-2026',
    });

    const spaced = parseGenBank(record('LOCUS       my plasmid 20 bp DNA circular', ''))
      .documents[0];
    expect(spaced?.name).toBe('my plasmid');

    const bare = parseGenBank(record('LOCUS       NAME', '')).documents[0];
    expect(bare).toMatchObject({ name: 'NAME', topology: 'linear', length: 20 });
  });

  it('parses qualifier values: escaped quotes, wrapping, translation, flags, numbers', () => {
    const text = record(
      'LOCUS       X 20 bp DNA linear',
      [
        '     CDS             1..9',
        '                     /gene="lacZ"',
        '                     /note="say ""hi"" and',
        '                     keep going /not-a-qualifier',
        '                     end"',
        '                     /translation="MKV',
        '                     LLA"',
        '                     /pseudo',
        '                     /codon_start=1',
        '                     /citation=[1]',
        '                     /product="beta-galactosidase"',
        '',
      ].join('\n'),
    );
    const result = parseGenBank(text);
    expect(result.warnings).toEqual([]);
    const f = result.documents[0]?.features.all()[0];
    // A CDS is named by its /product, not the /gene it belongs to.
    expect(f?.name).toBe('beta-galactosidase');
    expect(f?.qualifiers).toEqual([
      { name: 'gene', value: 'lacZ' },
      { name: 'note', value: 'say "hi" and keep going /not-a-qualifier end' },
      { name: 'translation', value: 'MKVLLA' },
      { name: 'pseudo', value: null },
      { name: 'codon_start', value: '1' },
      { name: 'citation', value: '[1]' },
      { name: 'product', value: 'beta-galactosidase' },
    ]);
    const written = writeGenBank(only(result));
    expect(written).toContain('/note="say ""hi"" and keep going /not-a-qualifier end"');
    expect(written).toContain('/pseudo\n');
    expect(written).toContain('/codon_start=1\n');
    expect(written).toContain('/citation=[1]\n');
    expect(written).not.toContain('/label=');
  });

  it('takes /gene as a name only on a gene and its products', () => {
    const text = record(
      'LOCUS       X 20 bp DNA linear',
      [
        '     gene            1..9',
        '                     /gene="tet"',
        '     CDS             1..9',
        '                     /gene="tet"',
        '                     /product="tetracycline resistance protein"',
        '     mRNA            1..9',
        '                     /gene="tet"',
        '     misc_binding    11..14',
        '                     /gene="tet"',
        '     misc_feature    16..17',
        '                     /gene="tet"',
        '                     /label="a name of its own"',
        '     CDS             18..20',
        '                     /locus_tag="b0001"',
        '',
      ].join('\n'),
    );
    const doc = only(parseGenBank(text));
    expect(doc.features.all().map((f) => f.name)).toEqual([
      'tet',
      'tetracycline resistance protein',
      'tet',
      '',
      'a name of its own',
      'b0001',
    ]);
    // The names survive a round trip, and nothing gains a /label it did not
    // have: every one of them is derived from a qualifier already there.
    const written = writeGenBank(doc);
    expect(written.match(/\/label=/g)).toHaveLength(1);
    expect(
      only(parseGenBank(written))
        .features.all()
        .map((f) => f.name),
    ).toEqual(doc.features.all().map((f) => f.name));
  });

  it('writes a /label when the name is not what reading back would derive', () => {
    const text = record(
      'LOCUS       X 20 bp DNA linear',
      ['     CDS             1..9', '                     /product="P"', ''].join('\n'),
    );
    const doc = only(parseGenBank(text));
    const id = doc.features.all()[0]?.id ?? '';
    expect(doc.features.all()[0]?.name).toBe('P');
    // Renaming it away from /product has to be written down, or the name is
    // lost to the next read.
    const renamed = doc.updateFeature(id, { name: 'My CDS' });
    const written = writeGenBank(renamed);
    expect(written).toContain('/label="My CDS"');
    expect(only(parseGenBank(written)).features.all()[0]?.name).toBe('My CDS');
  });

  it('derives names by priority and writes /label only when needed', () => {
    const text = record(
      'LOCUS       X 20 bp DNA linear',
      [
        '     gene            1..3',
        '                     /product="P"',
        '                     /gene="G"',
        '                     /label="L"',
        '     misc_feature    5..7',
        '                     /note="nothing to name it by"',
        '',
      ].join('\n'),
    );
    const doc = only(parseGenBank(text));
    expect(doc.features.all().map((f) => f.name)).toEqual(['L', '']);
    const renamed = doc.updateFeature(doc.features.all()[1]?.id ?? '', { name: 'My site' });
    const written = writeGenBank(renamed);
    expect(written.match(/\/label=/g)).toHaveLength(2);
    expect(written).toContain('     misc_feature    5..7\n                     /label="My site"\n');
  });

  it('reports unparseable locations as warnings and keeps the rest', () => {
    const text = record(
      'LOCUS       X 20 bp DNA linear',
      [
        '     misc_feature    15..5',
        '     misc_feature    J00194.1:1..3',
        '     misc_feature    0..3',
        '     misc_feature    1..3',
        '',
      ].join('\n'),
    );
    const result = parseGenBank(text);
    expect(result.documents[0]?.features.size).toBe(1);
    expect(result.warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(/spans the origin of a linear/),
      expect.stringMatching(/remote/),
      expect.stringMatching(/outside the sequence/),
    ]);
    expect(result.warnings[0]?.line).toBe(3);
  });

  it('wraps long locations and long notes, and re-reads them', () => {
    const parts = Array.from({ length: 12 }, (_, i) => `${i * 10 + 1}..${i * 10 + 5}`).join(',');
    const note = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const long = 'ACGTTGCA'.repeat(20); // 160 bp
    const text =
      `LOCUS       X 160 bp DNA linear 01-JAN-2020\nFEATURES             Location/Qualifiers\n` +
      `     misc_feature    join(${parts})\n                     /note="${note}"\nORIGIN\n        1 ${long}\n//\n`;
    const doc = only(parseGenBank(text));
    const written = writeGenBank(doc);
    const featureLines = written
      .split('\n')
      .filter((l) => l.startsWith('     misc_feature') || l.startsWith(' '.repeat(21)));
    expect(featureLines.length).toBeGreaterThan(3);
    for (const l of featureLines) expect(l.length).toBeLessThanOrEqual(79);
    const again = only(parseGenBank(written));
    expect(fingerprint(again)).toEqual(fingerprint(doc));
  });

  it('handles CRLF, multiple records, missing sections and length mismatch', () => {
    const two =
      `${record('LOCUS       A 20 bp DNA linear', '')}${record('LOCUS       B 20 bp DNA circular', '')}`.replace(
        /\n/g,
        '\r\n',
      );
    const result = parseGenBank(two);
    expect(result.documents.map((d) => d.name)).toEqual(['A', 'B']);
    expect(result.documents[1]?.topology).toBe('circular');

    const noFeatures = parseGenBank(`LOCUS       C 20 bp DNA linear\n${originLines}`);
    expect(noFeatures.documents[0]?.features.size).toBe(0);
    expect(noFeatures.documents[0]?.length).toBe(20);

    const mismatch = parseGenBank(record('LOCUS       D 99 bp DNA linear', ''));
    expect(mismatch.documents[0]?.length).toBe(20);
    expect(mismatch.warnings[0]?.message).toMatch(/LOCUS says 99 bp/);

    const noOrigin = parseGenBank(
      'LOCUS       E 0 bp DNA linear\nFEATURES             Location/Qualifiers\n//\n',
    );
    expect(noOrigin.documents[0]?.length).toBe(0);
  });

  it('strips gaps with a warning and rejects non-nucleotide sequences', () => {
    const gapped = parseGenBank('LOCUS       G 6 bp DNA linear\nORIGIN\n        1 ac-gt-a\n//\n');
    expect(gapped.documents[0]?.sequence.toString()).toBe('acgta');
    expect(gapped.warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(/Gap characters/),
      expect.stringMatching(/LOCUS says 6 bp/),
    ]);
    expect(() =>
      parseGenBank('LOCUS       P 3 bp DNA linear\nORIGIN\n        1 MKV*\n//\n'),
    ).toThrow(FormatError);
    expect(() =>
      parseGenBank('LOCUS       P 3 aa PROTEIN linear\nORIGIN\n        1 MKV\n//\n'),
    ).toThrow(/Protein/);
    expect(() => parseGenBank('just some text')).toThrow(/No LOCUS/);
  });

  it('preserves unknown header keywords and comments', () => {
    const text = record(
      'LOCUS       H 20 bp DNA circular SYN 01-JAN-2020',
      '',
      [
        'DEFINITION  A plasmid with a rather long definition line that will need to be',
        '            wrapped when written back out again by the writer.',
        'DBLINK      BioProject: PRJNA1',
        '            BioSample: SAMN1',
        'SOURCE      synthetic DNA construct',
        '  ORGANISM  synthetic DNA construct',
        '            other sequences; artificial sequences.',
        'REFERENCE   1  (bases 1 to 20)',
        '  AUTHORS   Doe,J.',
        '  TITLE     Direct Submission',
        '  JOURNAL   Submitted (01-JAN-2020)',
        '   PUBMED   12345',
        'COMMENT     First comment line.',
        '            Second line, indented   oddly.',
        'PRIMARY     REFSEQ_SPAN  PRIMARY_IDENTIFIER',
        '            1-20         X00001.1',
        '',
      ].join('\n'),
    );
    const doc = only(parseGenBank(text));
    expect(doc.metadata).toMatchObject({
      description:
        'A plasmid with a rather long definition line that will need to be wrapped when written back out again by the writer.',
      dbLinks: ['BioProject: PRJNA1', 'BioSample: SAMN1'],
      organism: 'synthetic DNA construct',
      taxonomy: 'other sequences; artificial sequences.',
      comments: ['First comment line.\nSecond line, indented   oddly.'],
      extraHeaders: [
        { keyword: 'PRIMARY', value: 'REFSEQ_SPAN  PRIMARY_IDENTIFIER\n1-20         X00001.1' },
      ],
    });
    expect(doc.metadata.references[0]).toMatchObject({
      pubmed: '12345',
      title: 'Direct Submission',
    });
    expectRoundTrip(text, 'header fixture');
  });

  it('writes a LOCUS line in NCBI layout with sensible defaults', () => {
    const doc = only(parseGenBank(record('LOCUS       X 20 bp DNA linear', '')));
    const locus = writeGenBank(doc.rename('my plasmid')).split('\n')[0] ?? '';
    expect(locus).toMatch(
      /^LOCUS {7}my_plasmid +20 bp {4}DNA {5}linear {3}SYN \d{2}-[A-Z]{3}-\d{4}$/,
    );
    // NCBI layout: name starts at column 13, length is right-aligned to end at column 40.
    expect(locus.indexOf('my_plasmid')).toBe(12);
    expect(locus.indexOf('bp')).toBe(41);
    // The division is required (Biopython refuses a line without one), and
    // the date starts at column 69.
    expect(locus.slice(64, 68)).toBe('SYN ');
    const withDivision = writeGenBank(
      doc.setMetadata({ division: 'PLN', date: '01-JAN-2020' }),
    ).split('\n')[0];
    expect(withDivision).toMatch(/ linear {3}PLN 01-JAN-2020$/);
  });
});

describe('sticky ends', () => {
  const seq = 'AATTCGGGCCCGGGTTTAAA'; // 20 bp, starting with an EcoRI overhang
  const record = (extraHeader = ''): string =>
    `LOCUS       X 20 bp DNA linear\n${extraHeader}FEATURES             Location/Qualifiers\n` +
    `ORIGIN\n        1 ${seq.slice(0, 10)} ${seq.slice(10)}\n//\n`;
  const sticky = (): SeqDocument =>
    only(parseGenBank(record())).setEnds({
      left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
      right: { kind: 'blunt', overhang: '', enzyme: 'SmaI' },
    });

  it('writes the ends as a comment and reads them back', () => {
    const text = writeGenBank(sticky());
    expect(text).toContain("COMMENT     PlasmidPop-ends: left=5' AATT/EcoRI; right=blunt/SmaI");
    const reparsed = only(parseGenBank(text));
    expect(reparsed.ends).toEqual(sticky().ends);
    // The line is the document's ends, not one of its comments, so writing it
    // again produces the same file rather than a second copy.
    expect(reparsed.metadata.comments).toEqual([]);
    expect(writeGenBank(reparsed)).toBe(text);
    expectRoundTrip(text, 'sticky ends');
  });

  it('leaves an ordinary linear record alone', () => {
    const plain = only(parseGenBank(record()));
    expect(plain.ends).toBeNull();
    expect(writeGenBank(plain)).not.toContain('PlasmidPop-ends');
  });

  it('ignores a damaged ends comment, keeping it as a comment', () => {
    const parsed = only(
      parseGenBank(record('COMMENT     PlasmidPop-ends: left=sideways; right=blunt\n')),
    );
    expect(parsed.ends).toBeNull();
    expect(parsed.metadata.comments).toEqual(['PlasmidPop-ends: left=sideways; right=blunt']);
  });
});

describe('where a document came from', () => {
  const record = (extraHeader = ''): string =>
    `LOCUS       X 20 bp DNA linear\n${extraHeader}FEATURES             Location/Qualifiers\n` +
    `ORIGIN\n        1 AATTCGGGCC CGGGTTTAAA\n//\n`;
  const derivedFrom = {
    checksum: 'cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A',
    fileName: 'pBR322.gb',
  };

  it('writes the provenance as a comment and reads it back', () => {
    const doc = only(parseGenBank(record())).setMetadata({ derivedFrom });
    const text = writeGenBank(doc);
    expect(text).toContain(
      'COMMENT     PlasmidPop-derived-from: cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A pBR322.gb',
    );
    const reparsed = only(parseGenBank(text));
    expect(reparsed.metadata.derivedFrom).toEqual(derivedFrom);
    // The line is the document's provenance, not one of its comments, so
    // writing it again produces the same file rather than a second copy.
    expect(reparsed.metadata.comments).toEqual([]);
    expect(writeGenBank(reparsed)).toBe(text);
  });

  it('leaves a record that came from nowhere alone', () => {
    const plain = only(parseGenBank(record()));
    expect(plain.metadata.derivedFrom).toBeNull();
    expect(writeGenBank(plain)).not.toContain('PlasmidPop-derived-from');
  });

  it('keeps a file name with spaces in it', () => {
    const doc = only(parseGenBank(record())).setMetadata({
      derivedFrom: { ...derivedFrom, fileName: 'my plasmid v2.gb' },
    });
    expect(only(parseGenBank(writeGenBank(doc))).metadata.derivedFrom?.fileName).toBe(
      'my plasmid v2.gb',
    );
  });

  it('writes a checksum with no file name behind it', () => {
    const doc = only(parseGenBank(record())).setMetadata({
      derivedFrom: { ...derivedFrom, fileName: '' },
    });
    const reparsed = only(parseGenBank(writeGenBank(doc)));
    expect(reparsed.metadata.derivedFrom).toEqual({ ...derivedFrom, fileName: '' });
  });

  it('ignores a damaged line, keeping it as a comment', () => {
    const parsed = only(
      parseGenBank(record('COMMENT     PlasmidPop-derived-from: not-a-checksum\n')),
    );
    expect(parsed.metadata.derivedFrom).toBeNull();
    expect(parsed.metadata.comments).toEqual(['PlasmidPop-derived-from: not-a-checksum']);
  });
});
