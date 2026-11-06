import type { CrisprGuide, NickStrand, Nuclease, Range, SeqDocument } from '@/core';
import { DEFAULT_PBS, MAX_PAIR_OFFSET, OLIGO_SCHEMES } from '@/core';

import { createDocumentSession } from './state/documentSession';

/*
 * What the CRISPR tab holds, per document (item 133): the settings, the
 * scan and its answer, the filters, and the fields of the nickase and
 * pegRNA sections. In a store outside React for the reason `alignSession.ts`
 * is (item 129): the scan is a worker promise that resolves after the panel
 * that asked may have unmounted, and a tab switch no longer throws the
 * answer away, so coming back does not scan again. Nothing is persisted: a
 * reload starts clean, as the panel always did.
 */

/**
 * The column the guide list is in the order of. `offTargets` is the exact
 * column's, fewest exact hits then fewest near ones; `mm1`…`mm4` order by the
 * count at that many mismatches.
 */
export type SortBy =
  'position' | 'offTargets' | 'gc' | 'specificity' | 'mm1' | 'mm2' | 'mm3' | 'mm4';

/** One scan: the question put to the worker. */
export interface Request {
  readonly sequence: string;
  readonly topology: SeqDocument['topology'];
  readonly nuclease: Nuclease;
  readonly maxMismatches: number;
  readonly region: Range | null;
  readonly background: readonly {
    readonly sequence: string;
    readonly topology: SeqDocument['topology'];
  }[];
}

/** Another open document the off-targets are counted in. */
export interface Background {
  readonly name: string;
  readonly sequence: string;
  readonly topology: SeqDocument['topology'];
}

/** What came back, and which question it answers. */
export interface Answer {
  readonly request: Request;
  readonly guides?: readonly CrisprGuide[];
  readonly error?: string;
  /** The worker failed outright on it (#373); Try again is on offer once. */
  readonly stopped?: { readonly detail: string; readonly canRetry: boolean };
}

/** The pegRNA section's boxes, as typed (item 81). */
export interface PegEdit {
  readonly position: string;
  readonly replace: string;
  readonly insert: string;
  readonly pbs: string;
}

export interface CrisprSession {
  /** The preset's id, or `custom` for the PAM typed below. */
  readonly nucleaseId: string;
  readonly pam: string;
  /** The custom nuclease's spacer length, as typed. */
  readonly spacerLength: string;
  readonly maxMismatches: number;
  /**
   * The region the scan is narrowed to, taken from the selection when the
   * box is ticked and kept until it is ticked again: a guide clicked in the
   * list selects its protospacer, and narrowing to that would empty the
   * list it was clicked in.
   */
  readonly narrowed: { readonly documentId: string; readonly range: Range } | null;
  readonly searchOthers: boolean;
  /** The other documents searched, kept so a remount asks the question it was answered. */
  readonly others: readonly Background[];
  /** The scan last asked for; an answer is kept only while it is still this one. */
  readonly request: Request | null;
  readonly answer: Answer | null;
  readonly sortBy: SortBy;
  /** The column's order turned round: its natural one is the first click's. */
  readonly sortReversed: boolean;
  // The filters sit on the result, not the scan: changing one is instant.
  readonly spacerFilter: string;
  readonly pamFilter: string;
  // Flagged guides are hidden until asked for: the clean ones are the shortlist.
  readonly showFlagged: boolean;
  readonly schemeId: string;
  readonly baseEditorId: string;
  readonly onlyEditable: boolean;
  /**
   * The row last clicked. Which guide the panel shows is the one the
   * selection covers, so a guide clicked on the map or in the sequence
   * opens here too; two guides can share a range on opposite strands, and
   * this says which of the two was meant when the click came from a row.
   */
  readonly clicked: string | null;
  readonly nickStrand: NickStrand;
  /** The most the two nicks may be apart, as typed. */
  readonly maxOffset: string;
  readonly pegEdit: PegEdit;
  /**
   * The Pairs and Prime pages' open rows, by `pairId` and `pegId`: kept so a
   * page left and come back to still has its pair or pegRNA drawn on the views.
   */
  readonly pairPicked: string | null;
  readonly pegPicked: string | null;
}

export const INITIAL_CRISPR_SESSION: CrisprSession = {
  nucleaseId: 'spcas9',
  pam: 'NGG',
  spacerLength: '20',
  maxMismatches: 3,
  narrowed: null,
  searchOthers: false,
  others: [],
  request: null,
  answer: null,
  sortBy: 'position',
  sortReversed: false,
  spacerFilter: '',
  pamFilter: '',
  showFlagged: false,
  schemeId: OLIGO_SCHEMES[0]?.id ?? 'none',
  baseEditorId: '',
  onlyEditable: false,
  clicked: null,
  nickStrand: 'target',
  maxOffset: String(MAX_PAIR_OFFSET),
  pegEdit: { position: '', replace: '1', insert: '', pbs: String(DEFAULT_PBS) },
  pairPicked: null,
  pegPicked: null,
};

const session = createDocumentSession<CrisprSession>(INITIAL_CRISPR_SESSION);

export const readCrisprSession = session.read;
export const updateCrisprSession = session.update;
/** The session of the document in front, live. */
export const useCrisprSession = session.use;
/** Forgets every session, for tests. */
export const forgetCrisprSessions = session.forget;
