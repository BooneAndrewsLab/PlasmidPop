import { documentChecksum, lsseguid } from '../checksum';
import { createFeature, rangeSegment } from '../features';
import { AlphabetMismatchError, InvalidResiduesError, InvalidSequenceError } from '../sequence';
import { extractRange } from './extract';
import { fragmentFromRange, fragmentToJSON, parseFragmentJSON } from './fragment';
import { SeqDocument } from './seqDocument';
import { type DocumentTool, hasTool, unitName } from './tools';

const HBB = 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPK';

function protein(sequence = HBB): SeqDocument {
  return SeqDocument.create({
    name: 'HBB',
    sequence,
    alphabet: 'protein',
    features:
      sequence.length < 20
        ? []
        : [createFeature({ type: 'Region', name: 'helix', segments: [rangeSegment(10, 20)] })],
  });
}

describe('a protein document (#66)', () => {
  it('is nucleotide unless it says otherwise', () => {
    const dna = SeqDocument.create({ sequence: 'ACGT' });
    expect(dna.alphabet).toBe('nucleotide');
    expect(dna.isProtein).toBe(false);
    expect(protein().alphabet).toBe('protein');
    expect(protein().isProtein).toBe(true);
  });

  it('takes residues and refuses what is not one', () => {
    expect(protein('MKV*').sequence.toString()).toBe('MKV*');
    expect(() => protein('MK#V')).toThrow(InvalidResiduesError);
    expect(() => protein('MK#V')).toThrow(/amino-acid alphabet: "#"/);
    // The residues a DNA sequence would refuse, and the other way about.
    expect(() => SeqDocument.create({ sequence: 'MEL' })).toThrow(InvalidSequenceError);
    const doc = protein();
    expect(doc.insert(0, 'EFIL').sequence.toString()).toBe(`EFIL${HBB}`);
    expect(() => doc.insert(0, 'E1')).toThrow(InvalidResiduesError);
    expect(doc.replace({ start: 0, end: 1 }, 'Q').sequence.toString()).toBe(`Q${HBB.slice(1)}`);
  });

  it('keeps its alphabet through every edit', () => {
    const doc = protein()
      .insert(5, 'PQ')
      .delete({ start: 0, end: 2 })
      .rename('beta')
      .changeCase({ start: 0, end: 4 }, 'lower')
      .styleBases({ start: 0, end: 3 }, { bold: true });
    expect(doc.alphabet).toBe('protein');
    expect(doc.features.all()[0]?.segments[0]).toMatchObject({ start: 10, end: 20 });
  });

  it('is linear, with no ends, no methylation to set and no strand to turn over', () => {
    expect(() =>
      SeqDocument.create({ sequence: 'MKV', alphabet: 'protein', topology: 'circular' }),
    ).toThrow(/linear/);
    const doc = protein();
    expect(() => doc.setTopology('circular')).toThrow(/linear/);
    expect(() => doc.reverseComplement()).toThrow(/complement/);
    const ends = {
      left: { kind: "5'" as const, overhang: 'AATT', enzyme: 'EcoRI' },
      right: { kind: 'blunt' as const, overhang: '', enzyme: '' },
    };
    expect(doc.setEnds(ends)).toBe(doc);
    expect(SeqDocument.create({ sequence: 'MKV', alphabet: 'protein', ends }).ends).toBeNull();
    expect(doc.setMethylation({ dam: false, dcm: false })).toBe(doc);
  });

  it('reads a feature as it stands, never reverse-complemented', () => {
    const doc = SeqDocument.create({
      sequence: 'MKVLE',
      alphabet: 'protein',
      features: [
        createFeature({
          type: 'Site',
          name: 'odd',
          strand: 'reverse',
          segments: [rangeSegment(1, 4)],
        }),
      ],
    });
    const [feature] = doc.features.all();
    if (feature === undefined) throw new Error('expected the feature');
    expect(doc.featureSequence(feature)).toBe('KVL');
  });

  it('keeps its alphabet in a stretch taken out of it', () => {
    const part = extractRange(protein(), { start: 5, end: 25 });
    expect(part.alphabet).toBe('protein');
    expect(part.sequence.toString()).toBe(HBB.slice(5, 25));
    expect(part.features.size).toBe(1);
  });

  it('copies and pastes as residues, and never into DNA', () => {
    const doc = protein();
    const fragment = fragmentFromRange(doc, { start: 0, end: 30 });
    expect(fragment.alphabet).toBe('protein');
    const back = parseFragmentJSON(fragmentToJSON(fragment));
    expect(back).toEqual(fragment);
    // A fragment of bases says nothing about its alphabet, as before proteins.
    const dna = SeqDocument.create({ sequence: 'ACGTACGT' });
    const bases = fragmentFromRange(dna, { start: 0, end: 4 });
    expect(bases.alphabet).toBeUndefined();
    expect(fragmentToJSON(bases)).not.toMatch(/alphabet/);
    expect(parseFragmentJSON(fragmentToJSON(bases))).toEqual(bases);
    // Letters that are not residues, or an alphabet we do not know, are no fragment.
    expect(
      parseFragmentJSON(
        JSON.stringify({
          format: 'plasmidpop-fragment',
          version: 1,
          sequence: 'MK#',
          features: [],
          alphabet: 'protein',
        }),
      ),
    ).toBeNull();
    expect(
      parseFragmentJSON(
        JSON.stringify({
          format: 'plasmidpop-fragment',
          version: 1,
          sequence: 'MK',
          features: [],
          alphabet: 'rna',
        }),
      ),
    ).toBeNull();
    expect(doc.insertFragment({ start: 0, end: 0 }, fragment).length).toBe(HBB.length + 30);
    expect(() => doc.insertFragment({ start: 0, end: 0 }, bases)).toThrow(AlphabetMismatchError);
    expect(() => dna.insertFragment({ start: 0, end: 0 }, fragment)).toThrow(AlphabetMismatchError);
  });

  it('checks out as one chain, whatever the case of its letters', () => {
    const doc = protein();
    expect(documentChecksum(doc)?.text).toBe(lsseguid(HBB).text);
    expect(documentChecksum(doc.changeCase({ start: 0, end: 10 }, 'lower'))?.text).toBe(
      lsseguid(HBB).text,
    );
  });
});

describe('the tools a document has (#66)', () => {
  const nucleotideOnly: readonly DocumentTool[] = [
    'complement',
    'translations',
    'enzymes',
    'orfs',
    'translate',
    'primers',
    'cloning',
    'detectFeatures',
    'reverseComplement',
    'circular',
    'ends',
    'methylation',
  ];

  it('gives DNA its tools and a protein its own', () => {
    const dna = SeqDocument.create({ sequence: 'ACGT' });
    for (const tool of nucleotideOnly) {
      expect(hasTool(dna, tool)).toBe(true);
      expect(hasTool(protein(), tool)).toBe(false);
    }
    expect(hasTool(protein(), 'proteinProperties')).toBe(true);
    expect(hasTool(dna, 'proteinProperties')).toBe(false);
    // Aligning belongs to both: reads against DNA, a protein against a
    // protein, scored by BLOSUM62 rather than by bases (#95).
    expect(hasTool(dna, 'align')).toBe(true);
    expect(hasTool(protein(), 'align')).toBe(true);
  });

  it('calls a letter a base or a residue', () => {
    expect(unitName('nucleotide')).toBe('base');
    expect(unitName('nucleotide', true)).toBe('bases');
    expect(unitName('protein')).toBe('residue');
    expect(unitName('protein', true)).toBe('residues');
  });
});
