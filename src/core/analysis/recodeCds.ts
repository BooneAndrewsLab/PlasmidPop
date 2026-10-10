import { type EditOp, type SeqDocument } from '../document';
import { type Feature, type Qualifier, qualifierValues } from '../features';
import { complement, reverseComplement } from '../sequence';
import { translateCds } from './cdsTranslation';
import { type TranslationTable, STOP } from './codons';
import { type CodonUsageTable } from './codonUsageTables';
import { type CodonSlot, type RecodeResult, codonAdaptationIndex } from './recode';

/**
 * Recoding a CDS feature in place (#209). The document side of `recode.ts`:
 * what is read from the CDS before the search (its residues, the codons to
 * leave alone, the bases either side) and what is made of the answer (one
 * same-length replacement, the feature's note), with the protein checked
 * against the document the replacement makes.
 */

/** Bases of flank either side of the CDS that the search sees, for sites across its ends. */
export const RECODE_FLANK = 24;

/** A CDS read for recoding, ready for `recodeSlots`. */
export interface CdsRecodeJob {
  readonly slots: readonly CodonSlot[];
  /** The codons now, 5′ to 3′ of the gene. */
  readonly current: readonly string[];
  readonly prefix: string;
  readonly suffix: string;
  readonly table: TranslationTable;
  /** The protein the CDS codes for, as the line under it shows it. */
  readonly protein: string;
}

/** What the CDS would become: apply `edit`, then `patch` to the feature. */
export interface CdsRecodePlan {
  readonly edit: Extract<EditOp, { type: 'replace' }>;
  readonly qualifiers: readonly Qualifier[];
  readonly result: RecodeResult;
  readonly caiBefore: number;
  /** Codons that differ from what they were. */
  readonly changed: number;
  readonly protein: string;
}

export type CdsRecodeJobOrReason =
  | { readonly job: CdsRecodeJob; readonly reason?: undefined }
  | { readonly job?: undefined; readonly reason: string };

const NOTE_PREFIX = 'Recoded for ';

/** Why a CDS cannot be recoded here, or null. */
export function recodeRefusal(doc: SeqDocument, feature: Feature): string | null {
  if (doc.alphabet !== 'nucleotide') return 'Only a DNA document can be recoded.';
  if (feature.type !== 'CDS') return 'Only a CDS can be recoded.';
  const ranges = feature.segments.filter((s) => s.kind === 'range');
  if (ranges.length !== 1 || feature.segments.length !== 1) {
    return 'A CDS made of several pieces (a join) is not recoded: its introns are not part of what the host reads.';
  }
  const seg = ranges[0];
  if (seg === undefined || seg.start >= seg.end) {
    return 'A CDS that runs across the origin is not recoded.';
  }
  if (qualifierValues(feature, 'transl_except').length > 0) {
    return 'A CDS with /transl_except is not recoded: its exceptions name codons by position.';
  }
  const t = translateCds(doc, feature);
  if (t.unknownTable !== null) return `The genetic code ${t.unknownTable} is not one we have.`;
  if (t.codons.length === 0) return 'The CDS has no complete codon.';
  return null;
}

/** Reads a CDS for recoding, or says why not. */
export function prepareRecodeCds(doc: SeqDocument, feature: Feature): CdsRecodeJobOrReason {
  const reason = recodeRefusal(doc, feature);
  if (reason !== null) return { reason };
  const seg = feature.segments[0];
  if (seg?.kind !== 'range') return { reason: 'Only a CDS can be recoded.' };
  const t = translateCds(doc, feature);
  const reverse = feature.strand === 'reverse';
  const bio = (from: number, to: number): string => {
    const text = doc.sequence.slice(Math.max(0, from), Math.min(doc.length, to)).toUpperCase();
    return reverse ? reverseComplement(text) : text;
  };
  const whole = bio(seg.start, seg.end);
  const first = t.codons[0];
  const lastCodon = t.codons[t.codons.length - 1];
  if (first === undefined || lastCodon === undefined) return { reason: 'The CDS has no codon.' };
  const lead = whole.length === 0 ? 0 : t.codonStart - 1;
  const used = t.codons.length * 3;
  const upstream = reverse
    ? bio(seg.end, seg.end + RECODE_FLANK)
    : bio(seg.start - RECODE_FLANK, seg.start);
  const downstream = reverse
    ? bio(seg.start - RECODE_FLANK, seg.start)
    : bio(seg.end, seg.end + RECODE_FLANK);
  const current = t.codons.map((_, i) => whole.slice(lead + i * 3, lead + i * 3 + 3));
  const slots = t.codons.map((codon, i): CodonSlot => {
    const text = current[i] ?? '';
    // Start and stop codons are the author's; so is anything that is not plain bases.
    const keep =
      i === 0 || codon.aminoAcid === STOP || !/^[ACGT]{3}$/.test(text) || codon.aminoAcid === 'X';
    return { aminoAcid: codon.aminoAcid, fixed: keep ? text : null };
  });
  return {
    job: {
      slots,
      current,
      prefix: upstream + whole.slice(0, lead),
      suffix: whole.slice(lead + used) + downstream,
      table: t.table,
      protein: t.protein,
    },
  };
}

/**
 * The plan for the answer: the same-length replacement over the CDS, and its
 * qualifiers with a note saying it was recoded. The protein is read again
 * from the document the replacement makes; a difference throws, and nothing
 * is applied.
 */
export function finishRecodeCds(
  doc: SeqDocument,
  feature: Feature,
  job: CdsRecodeJob,
  result: RecodeResult,
  host: CodonUsageTable,
): CdsRecodePlan {
  const seg = feature.segments[0];
  if (seg?.kind !== 'range') throw new Error('Only a CDS can be recoded.');
  if (result.codons.length !== job.slots.length)
    throw new Error('The recoding has the wrong length');
  const reverse = feature.strand === 'reverse';
  const t = translateCds(doc, feature);
  const original = doc.sequence.slice(seg.start, seg.end);
  const chars = Array.from(original);
  let changed = 0;
  t.codons.forEach((codon, i) => {
    const next = result.codons[i] ?? '';
    if (next === (job.current[i] ?? '')) return;
    changed++;
    // Bases go back to where they came from, complemented on the reverse strand.
    const forward = reverse ? complement(next) : next;
    codon.positions.forEach((p, k) => {
      const old = original.charAt(p - seg.start);
      const base = forward.charAt(k);
      chars[p - seg.start] =
        old === old.toLowerCase() && old !== old.toUpperCase() ? base.toLowerCase() : base;
    });
  });
  const text = chars.join('');
  const edit = {
    type: 'replace',
    range: { start: seg.start, end: seg.end },
    text,
  } as const;
  const after = doc.replace(edit.range, text);
  const proteinAfter = translateCds(after, feature).protein;
  if (proteinAfter !== job.protein) {
    throw new Error('Recoding would change the protein; nothing was changed');
  }
  const caiBefore = codonAdaptationIndex(job.current, host, job.table);
  const note: Qualifier = {
    name: 'note',
    value: `${NOTE_PREFIX}${host.name} codon usage with PlasmidPop (CAI ${caiBefore.toFixed(2)} to ${result.cai.toFixed(2)}, ${changed} codon${changed === 1 ? '' : 's'} changed, protein unchanged)`,
  };
  const qualifiers = [
    ...feature.qualifiers.filter(
      (q) => !(q.name === 'note' && q.value?.startsWith(NOTE_PREFIX) === true),
    ),
    note,
  ];
  return { edit, qualifiers, result, caiBefore, changed, protein: proteinAfter };
}
