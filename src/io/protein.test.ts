import {
  type SeqDocument,
  SeqDocument as Doc,
  createFeature,
  formatLocation,
  rangeSegment,
} from '@/core';
import { readFixture } from '@/test/fixtures';

import { parseSequenceFile } from './detect';
import { parseFasta, writeFasta } from './fasta';
import { decodeSharePayload, encodeSharePayload } from './share';
import { parseGenBank, writeGenBank } from './genbank';

function only(docs: readonly SeqDocument[]): SeqDocument {
  const doc = docs[0];
  if (doc === undefined) throw new Error('expected a document');
  return doc;
}

/** What should survive a round-trip, minus random feature ids. */
function fingerprint(doc: SeqDocument) {
  return {
    alphabet: doc.alphabet,
    name: doc.name,
    topology: doc.topology,
    sequence: doc.sequence.toString(),
    metadata: doc.metadata,
    features: doc.features.all().map((f) => ({
      type: f.type,
      name: f.name,
      location: formatLocation(f, doc.length, doc.topology),
      qualifiers: f.qualifiers,
    })),
  };
}

const HBB =
  'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH';

describe('protein FASTA (#66)', () => {
  it('reads a protein record as a protein, and a DNA one beside it as DNA', () => {
    const result = parseFasta(
      `>HBB hemoglobin beta\n${HBB.slice(0, 70)}\n${HBB.slice(70)}\n>dna\nACGTRYKMN\n`,
    );
    const [protein, dna] = result.documents;
    expect(protein?.alphabet).toBe('protein');
    expect(protein?.sequence.toString()).toBe(HBB);
    expect(protein?.name).toBe('HBB');
    expect(protein?.metadata.description).toBe('hemoglobin beta');
    expect(dna?.alphabet).toBe('nucleotide');
  });

  it('keeps a stop, strips gaps, and never makes a protein circular', () => {
    const result = parseFasta('>p a circular peptide\nMKV-LE*\n');
    const doc = only(result.documents);
    expect(doc.sequence.toString()).toBe('MKVLE*');
    expect(doc.topology).toBe('linear');
    expect(result.warnings[0]?.message).toMatch(/Gap/);
  });

  it('round-trips, with no topology in the header', () => {
    const doc = Doc.create({
      name: 'HBB',
      sequence: HBB,
      alphabet: 'protein',
      metadata: { description: 'hemoglobin beta' },
    });
    const text = writeFasta(doc);
    expect(text.split('\n')[0]).toBe('>HBB hemoglobin beta');
    const back = only(parseFasta(text).documents);
    expect(back.alphabet).toBe('protein');
    expect(back.sequence.toString()).toBe(HBB);
    expect(writeFasta(back)).toBe(text);
  });

  it('opens as a protein through format detection, from a .faa file too', () => {
    expect(only(parseSequenceFile(`>x\n${HBB}\n`, 'x.faa').documents).alphabet).toBe('protein');
  });
});

describe('GenPept (#66)', () => {
  const text = readFixture('NP_000509.gp');

  it('reads an NCBI protein record: residues, header and features', () => {
    const result = parseGenBank(text);
    const doc = only(result.documents);
    expect(doc.alphabet).toBe('protein');
    expect(doc.name).toBe('NP_000509');
    expect(doc.length).toBe(147);
    expect(doc.sequence.toString().toUpperCase()).toBe(HBB);
    expect(doc.topology).toBe('linear');
    expect(doc.metadata.division).toBe('PRI');
    expect(doc.metadata.moleculeType).toBe('');
    expect(doc.metadata.description).toBe('hemoglobin subunit beta [Homo sapiens].');
    expect(doc.metadata.references[0]?.location).toBe('(residues 1 to 147)');
    // DBSOURCE is GenPept's own; it is kept as it stands.
    expect(doc.metadata.extraHeaders.map((h) => h.keyword)).toContain('DBSOURCE');
    const types = new Set(doc.features.all().map((f) => f.type));
    expect(types).toEqual(new Set(['source', 'Protein', 'Region', 'Site', 'mat_peptide', 'CDS']));
    // Features sit on residues: the Region is residues 8 to 146.
    const region = doc.features.all().find((f) => f.type === 'Region');
    expect(region?.segments[0]).toMatchObject({ start: 7, end: 146 });
    const cds = doc.features.all().find((f) => f.type === 'CDS');
    expect(cds?.qualifiers).toContainEqual({ name: 'coded_by', value: 'NM_000518.5:51..494' });
    // No LOCUS length mismatch, no unreadable feature.
    expect(result.warnings.filter((w) => !w.message.includes('order('))).toEqual([]);
  });

  it('writes a GenPept LOCUS line, in NCBI’s columns', () => {
    const doc = only(parseGenBank(text).documents);
    const locus = writeGenBank(doc).split('\n')[0] ?? '';
    expect(locus).toMatch(/^LOCUS {7}NP_000509 {16}147 aa {12}linear {3}PRI \d\d-[A-Z]{3}-\d{4}$/);
    // Columns as NCBI puts them: length ending at 40, `aa` at 42, topology at 56.
    expect(locus.slice(28, 40).trim()).toBe('147');
    expect(locus.slice(41, 43)).toBe('aa');
    expect(locus.slice(55, 61)).toBe('linear');
    expect(locus.slice(64, 67)).toBe('PRI');
  });

  it('round-trips a real record', () => {
    const doc = only(parseGenBank(text).documents);
    const written = writeGenBank(doc);
    const back = only(parseGenBank(written).documents);
    expect(fingerprint(back)).toEqual(fingerprint(doc));
    expect(writeGenBank(back)).toBe(written);
    const insulin = only(parseGenBank(readFixture('NP_000198.gp')).documents);
    expect(fingerprint(only(parseGenBank(writeGenBank(insulin)).documents))).toEqual(
      fingerprint(insulin),
    );
  });

  it('writes a protein made here as GenPept, and reads it back a protein', () => {
    const doc = Doc.create({
      name: 'my protein',
      sequence: 'MKVLEHHHHHH*',
      alphabet: 'protein',
      features: [
        createFeature({ type: 'Region', name: 'His tag', segments: [rangeSegment(5, 11)] }),
      ],
    });
    const written = writeGenBank(doc);
    expect(written).toMatch(/^LOCUS {7}my_protein {16}12 aa {12}linear {3}SYN /);
    expect(written).toContain('     Region          6..11\n                     /label="His tag"');
    expect(written).toContain('        1 MKVLEHHHHH H*\n');
    const back = only(parseGenBank(written).documents);
    expect(back.alphabet).toBe('protein');
    expect(back.sequence.toString()).toBe('MKVLEHHHHHH*');
    expect(back.features.all()[0]?.name).toBe('His tag');
  });

  it('opens by content whatever the file is called, and by .gp', () => {
    expect(only(parseSequenceFile(text, 'x.gp').documents).alphabet).toBe('protein');
    expect(only(parseSequenceFile(text).documents).alphabet).toBe('protein');
  });

  it('goes through a share link a protein, since a link is GenBank text', async () => {
    const doc = only(parseGenBank(text).documents);
    const back = only(
      parseGenBank(await decodeSharePayload(await encodeSharePayload(writeGenBank(doc)))).documents,
    );
    expect(back.alphabet).toBe('protein');
    expect(back.sequence.toString()).toBe(doc.sequence.toString());
  });
});
