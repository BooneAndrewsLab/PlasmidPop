import { type Feature, qualifierValues } from '../features';
import { type SeqDocument } from '../document';
import { type LibraryPart, codingProtein } from './library';
import { SEED } from './detect';
import { PROTEIN_SEED } from './protein';

/**
 * My parts (#210, item 86): the parts a lab keeps itself (in-house
 * promoters, tags, landing pads, toolkit parts), looked for by Detect
 * features beside the bundled list. They live in this browser; nothing is
 * bundled and nothing leaves it but a download.
 */

/** What parts the user wrote or saved themselves are labelled as. */
export const MY_PARTS_ORIGIN = 'My parts';

/** A part as the collection keeps it. */
export interface MyPart {
  readonly id: string;
  readonly name: string;
  /** GenBank feature key a hit is annotated as. */
  readonly type: string;
  /** 5′→3′, upper case A/C/G/T; empty for a part known only by its protein. */
  readonly sequence: string;
  /** One letter per residue, for a part matched in the translation. */
  readonly protein?: string;
  readonly notes: string;
  /** Which list it came from: `My parts`, or `pLannotate: snapgene`. */
  readonly origin: string;
}

/** A part on its way in, before it has an id. */
export type PartDraft = Omit<MyPart, 'id'>;

/** The shortest part Detect features can find (the matcher's seed length). */
export const MIN_PART_BASES = SEED;
/** The shortest protein part (the matcher's protein seed length). */
export const MIN_PART_RESIDUES = PROTEIN_SEED;

/** `sequence` as a part's bases (letters only, upper case, U read as T), or null when it is not plain A/C/G/T. */
export function readPartBases(sequence: string): string | null {
  const bases = sequence
    .replace(/[\s\d]/g, '')
    .toUpperCase()
    .replace(/U/g, 'T');
  return /^[ACGT]*$/.test(bases) ? bases : null;
}

/** What preparing a batch of drafts came to. */
export interface PartsReport {
  readonly ready: readonly PartDraft[];
  /** Already kept under the same name and bases (or protein). */
  readonly duplicates: number;
  /** Shorter than Detect features can match, or with nothing to match. */
  readonly tooShort: number;
  /** DNA with bases other than A, C, G and T, which cannot be matched. */
  readonly ambiguous: number;
}

function keyOf(p: { name: string; sequence: string; protein?: string | undefined }): string {
  return `${p.name}\u0000${p.sequence}\u0000${p.protein ?? ''}`;
}

/** Cleans the drafts and leaves out those that could not be matched or are kept already. */
export function preparePartDrafts(
  existing: readonly Pick<MyPart, 'name' | 'sequence' | 'protein'>[],
  drafts: readonly PartDraft[],
): PartsReport {
  const seen = new Set(existing.map(keyOf));
  const ready: PartDraft[] = [];
  let duplicates = 0;
  let tooShort = 0;
  let ambiguous = 0;
  for (const d of drafts) {
    const name = d.name.trim();
    const protein = d.protein?.replace(/[\s\d*]/g, '').toUpperCase();
    const bases = readPartBases(d.sequence);
    if (bases === null) {
      ambiguous++;
      continue;
    }
    const long = bases.length >= MIN_PART_BASES;
    const proteinOk =
      protein !== undefined && /^[A-Z]+$/.test(protein) && protein.length >= MIN_PART_RESIDUES;
    // A part is matched by its bases or by its protein; one with neither long enough matches nothing.
    if (name === '' || (!long && !proteinOk)) {
      tooShort++;
      continue;
    }
    const part: PartDraft = {
      name,
      type: d.type.trim() === '' ? 'misc_feature' : d.type.trim(),
      sequence: long ? bases : '',
      ...(proteinOk ? { protein } : {}),
      notes: d.notes.trim(),
      origin: d.origin.trim() === '' ? MY_PARTS_ORIGIN : d.origin.trim(),
    };
    const key = keyOf(part);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    ready.push(part);
  }
  return { ready, duplicates, tooShort, ambiguous };
}

/** A kept part as Detect features matches it. */
export function myPartToLibraryPart(part: MyPart): LibraryPart {
  const protein = part.protein ?? codingProtein(part.type, part.sequence);
  return {
    name: part.name,
    type: part.type,
    category: part.origin === MY_PARTS_ORIGIN ? 'my part' : 'imported part',
    sequence: part.sequence,
    accession: part.origin,
    location: '',
    source: 'mine',
    origin: part.origin,
    ...(part.notes === '' ? {} : { note: part.notes }),
    ...(protein === undefined ? {} : { protein }),
  };
}

/**
 * The parts a document holds, read from its features: each feature (but the
 * `source`) is a part of its own bases, read in the feature's direction. A
 * document without features is one part, named for it. A protein document is
 * a part matched by its translation.
 */
export function partsFromDocument(doc: SeqDocument, origin: string = MY_PARTS_ORIGIN): PartDraft[] {
  if (doc.alphabet === 'protein') {
    return [
      {
        name: doc.name,
        type: 'CDS',
        sequence: '',
        protein: doc.sequence.toString(),
        notes: doc.metadata.description,
        origin,
      },
    ];
  }
  const features = doc.features.all().filter((f) => f.type !== 'source');
  if (features.length === 0) {
    return [
      {
        name: doc.name,
        type: 'misc_feature',
        sequence: doc.sequence.toString(),
        notes: doc.metadata.description,
        origin,
      },
    ];
  }
  return features.map((f) => ({ ...partFromFeature(doc, f), origin }));
}

/** One feature of a document as a part: its bases in its own direction, its type, name and notes. */
export function partFromFeature(
  doc: { featureSequence(feature: Feature): string },
  feature: Feature,
): PartDraft {
  return {
    name: feature.name,
    type: feature.type,
    sequence: doc.featureSequence(feature),
    notes: qualifierValues(feature, 'note').join('; '),
    origin: MY_PARTS_ORIGIN,
  };
}
