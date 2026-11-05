import { type Alphabet, MAX_MSA_SEQUENCES } from '@/core';

import { type AlphabetChoice, type AlphabetUse, alphabetInUse, documentJoins } from './msaAlphabet';

/*
 * What a multiple alignment is about to run on (#207, #369): the records of
 * a box, with or without an open document as one more, scored as the
 * letters say or as the user chose. Pure, so the Align tab's group and the
 * window with no document (`MsaWindow`) decide the same way.
 */

/** The open document as a candidate for the alignment; `null` when none is open. */
export interface MsaDocument {
  readonly name: string;
  readonly alphabet: Alphabet;
  readonly length: number;
  /** Its bases or residues, read only when it joins. */
  readonly sequence: () => string;
}

export interface MsaRecord {
  readonly name: string;
  readonly sequence: string;
}

export interface MsaPlan {
  readonly use: AlphabetUse;
  /** Whether the document is one of the sequences aligned. */
  readonly include: boolean;
  /** Whether the document could join at all; `why` says why it cannot. */
  readonly joins: { readonly ok: boolean; readonly why: string | null };
  readonly total: number;
  readonly names: readonly string[];
  readonly sequences: readonly string[];
  /** Why Align is off: too few or too many sequences, or no settled alphabet. */
  readonly reason: string | null;
  /** The alphabet scored by, and why; `null` while none is settled. */
  readonly alphabetNote: string | null;
  /** Whether the document is in, in one line; `null` with no document. */
  readonly docNote: string | null;
}

export function planMsa(
  records: readonly MsaRecord[],
  choice: AlphabetChoice,
  doc: MsaDocument | null,
  withDoc: boolean,
): MsaPlan {
  const use = alphabetInUse(
    records.map((r) => r.sequence),
    choice,
  );
  const joins =
    doc === null ? { ok: false, why: null } : documentJoins(doc.alphabet, doc.length, use);
  const include = doc !== null && withDoc && joins.ok;
  const total = records.length + (include ? 1 : 0);
  const names = [...(doc !== null && include ? [doc.name] : []), ...records.map((r) => r.name)];
  const sequences = [
    ...(doc !== null && include ? [doc.sequence()] : []),
    ...records.map((r) => r.sequence),
  ];
  const held = doc === null ? 'the box holds' : 'the box and this document make';
  const reason =
    use.alphabet === null
      ? use.detection.message
      : total < 3
        ? `A multiple alignment needs at least three sequences: add records to the box${doc === null ? '' : ', or include this document'}.`
        : total > MAX_MSA_SEQUENCES
          ? `A multiple alignment takes at most ${MAX_MSA_SEQUENCES} sequences; ${held} ${total}.`
          : null;
  const alphabetNote = use.chosen
    ? `Scored as ${use.alphabet}, as chosen${use.detection.alphabet !== null && use.detection.alphabet !== use.alphabet ? `; the letters read as ${use.detection.alphabet}` : ''}.`
    : use.alphabet === null
      ? null
      : `Scored as ${use.alphabet}: ${use.detection.message.toLowerCase()}`;
  const docNote =
    doc === null
      ? null
      : !withDoc
        ? `${doc.name} is not included (unticked).`
        : include
          ? `${doc.name} is included as one more sequence.`
          : `${doc.name} is not included. ${joins.why ?? ''}`;
  return { use, include, joins, total, names, sequences, reason, alphabetNote, docNote };
}
