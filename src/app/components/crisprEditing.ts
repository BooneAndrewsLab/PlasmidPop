import { useMemo } from 'react';

import {
  type CrisprGuide,
  type NickPair,
  type Nuclease,
  type PegRna,
  type PrimeEdit,
  type Range,
  type SeqDocument,
  MAX_PAIR_OFFSET,
  designPegRnas,
  pairNickases,
  primeEditProblem,
  shortWayRound,
  supportsNickPairs,
  supportsPrimeEditing,
} from '@/core';

import { useCrisprSession } from '../crisprSession';
import { useEditorState } from '../state/useEditorStore';
import { guideId } from './crisprScan';

/*
 * What the Pairs and Prime pages list (item 133, C5), worked out once in the
 * workspace so the rail can badge its pages with the counts while another
 * page is in front. Both read the session's fields and the scan's guides,
 * all of them: the Guides filters are for the table there, not for these.
 */

/** A pair's identity: the two guides, as the Guides table knows each. */
export const pairId = (p: NickPair): string =>
  `${guideId(p.forwardNick)}|${guideId(p.reverseNick)}`;

/** A pegRNA's: its guide's, of which it has at most one. */
export const pegId = (p: PegRna): string => guideId(p.guide);

/**
 * The bases a pair covers, the two guides together: what a click on its row
 * selects. On a circle the two may lie either side of the origin, and the
 * span is the short way round them.
 */
export function pairSpan(p: NickPair, length: number, topology: SeqDocument['topology']): Range {
  const a = p.forwardNick.range;
  const b = p.reverseNick.range;
  if (topology !== 'circular') {
    return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
  }
  const d = shortWayRound(b.start - a.start, length);
  const start = Math.min(a.start, a.start + d);
  const end = Math.max(a.end, a.start + d + (b.end - b.start));
  return start < 0
    ? { start: start + length, end: Math.min(end, start + length) + length }
    : { start, end: Math.min(end, start + length) };
}

/** The Pairs page's list: the pairs of guides the nickase and the distance allow. */
export function useNickPairs(
  doc: SeqDocument,
  guides: readonly CrisprGuide[] | null,
  nuclease: Nuclease | null,
) {
  const { documentId } = useEditorState();
  // In the session, so the choice survives a tab switch.
  const { nickStrand, maxOffset: maxText } = useCrisprSession(documentId);
  const typed = Number.parseInt(maxText, 10);
  // What the box means when it is empty or not a number: the default distance.
  const maxOffset = Number.isNaN(typed) ? MAX_PAIR_OFFSET : Math.max(0, typed);
  const allowed = nuclease !== null && supportsNickPairs(nuclease);
  const pairs = useMemo<readonly NickPair[]>(
    () =>
      guides === null || !allowed
        ? []
        : pairNickases(guides, doc.length, doc.topology, { nickStrand, maxOffset }),
    [guides, allowed, doc.length, doc.topology, nickStrand, maxOffset],
  );
  return { pairs, nickStrand, maxText, maxOffset, allowed };
}

/** The Prime page's list: a pegRNA for each guide near enough to the edit asked for. */
export function usePegRnas(
  doc: SeqDocument,
  guides: readonly CrisprGuide[] | null,
  nuclease: Nuclease | null,
) {
  const { documentId } = useEditorState();
  // The boxes are in the session, so they survive a tab switch.
  const { pegEdit } = useCrisprSession(documentId);
  const { position, replace, insert, pbs } = pegEdit;

  const start = Number.parseInt(position, 10) - 1;
  const deleteLength = Number.parseInt(replace, 10);
  const text = insert.trim().toUpperCase();
  const pbsLength = Number.parseInt(pbs, 10);
  const asked = position.trim() !== '';
  const problem = !asked
    ? null
    : Number.isNaN(start) || Number.isNaN(deleteLength)
      ? 'Enter a position and how many bases to replace.'
      : primeEditProblem({ start, deleteLength, insert: text }, doc.length, doc.topology);
  const allowed = nuclease !== null && supportsPrimeEditing(nuclease);
  const edit = useMemo<PrimeEdit | null>(
    () => (asked && problem === null ? { start, deleteLength, insert: text } : null),
    [asked, problem, start, deleteLength, text],
  );

  const pegs = useMemo<readonly PegRna[]>(
    () =>
      guides === null || nuclease === null || !allowed || edit === null
        ? []
        : designPegRnas(
            doc.sequence.toString(),
            doc.topology,
            guides,
            nuclease,
            edit,
            Number.isNaN(pbsLength) ? {} : { pbsLength },
          ),
    [doc, guides, nuclease, allowed, edit, pbsLength],
  );
  return { pegs, pegEdit, asked, problem, edit, allowed };
}
