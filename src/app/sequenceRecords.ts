import {
  type Alphabet,
  type Feature,
  type SeqDocument,
  type SequencingRead,
  normalizeSequenceInput,
} from '@/core';
import { parseSequenceFile, readSequenceData, writeFastaRecords } from '@/io';

/*
 * The records of pasted or dropped text, shared by the Align tab's box
 * and the multiple alignment window (#369).
 */

export interface SequenceRecord {
  readonly name: string;
  readonly sequence: string;
  /** Whether it is a circle, for a record that is the reference (#57). */
  readonly circular: boolean;
  /** Its qualities, and an AB1's trace, for a record read from a sequencing file. */
  readonly read?: SequencingRead;
  /** The file it came from, when several files were loaded together (#106). */
  readonly file?: string;
  /** Its own features, for a GenBank or SnapGene record or an open tab (#128). */
  readonly features?: readonly Feature[];
}

/** A record's own features, kept only when it has some (#128). */
export function featuresOf(d: SeqDocument): { readonly features?: readonly Feature[] } {
  const all = d.features.all();
  return all.length === 0 ? {} : { features: all };
}

export type Records =
  | { readonly ok: true; readonly records: readonly SequenceRecord[] }
  | { readonly ok: false; readonly message: string };

/**
 * The records in whatever the user pasted or dropped: raw bases (one
 * record), or every record of a FASTA or GenBank text (#46).
 */
export function readRecords(text: string, alphabet: Alphabet = 'nucleotide'): Records {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, records: [] };
  try {
    if (trimmed.startsWith('>') || trimmed.startsWith('LOCUS')) {
      const records = parseSequenceFile(trimmed).documents.map((d) => ({
        name: d.name,
        sequence: d.sequence.toString(),
        circular: d.isCircular,
        ...featuresOf(d),
      }));
      return { ok: true, records };
    }
    return {
      ok: true,
      records: [
        {
          name: 'Pasted sequence',
          // In front of a protein, pasted letters are residues (#95).
          sequence: normalizeSequenceInput(trimmed, alphabet),
          circular: false,
        },
      ],
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const TEXT_FORMATS: readonly string[] = ['genbank', 'fasta', 'raw'];

/** A file read into the box: the text it shows, and its records as read. */
export interface LoadedFile {
  readonly text: string;
  readonly records: readonly SequenceRecord[];
  /**
   * What the reader warned about, such as a FASTQ in the old Phred + 64
   * encoding (#146): the qualities weigh each difference, so a note under
   * the box says so rather than the warning being dropped.
   */
  readonly warnings?: readonly string[];
}

/**
 * A picked or dropped file for the box. The box shows GenBank or FASTA as
 * it is, and anything else — SnapGene and AB1, which are binary, FASTQ, a
 * gzipped file — as FASTA of its records; the records keep the qualities
 * a read has, which FASTA cannot show (#50). Throws if the file is not one
 * the app can read.
 */
export async function readFile(file: File): Promise<LoadedFile> {
  const data = await file.arrayBuffer();
  const parsed = await readSequenceData(data, file.name);
  const bytes = new Uint8Array(data, 0, Math.min(2, data.byteLength));
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text =
    TEXT_FORMATS.includes(parsed.format) && !gzipped
      ? new TextDecoder('utf-8').decode(data)
      : writeFastaRecords(parsed.documents);
  const records = parsed.documents.map((d) => ({
    name: d.name,
    sequence: d.sequence.toString(),
    circular: d.isCircular,
    ...(d.read === null ? {} : { read: d.read }),
    ...featuresOf(d),
  }));
  return { text, records, warnings: parsed.warnings.map((w) => w.message) };
}
