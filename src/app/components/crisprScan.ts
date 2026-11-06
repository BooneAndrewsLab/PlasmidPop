import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type CrisprGuide,
  type Nuclease,
  type Range,
  type SeqDocument,
  GC_HIGH,
  BASE_EDITORS,
  GC_LOW,
  HOMOPOLYMER_FLAG,
  NUCLEASES,
  baseEditWindow,
  guideFeature,
  isEmptyRange,
  isValidRange,
  matchPositions,
  nucleaseProblem,
  patternMasks,
  rangesEqual,
  sequenceMasks,
  supportsBaseEditing,
} from '@/core';

import { type OverlaySpan } from '@/view/overlay';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import {
  type Background,
  type CrisprSession,
  type Request,
  readCrisprSession,
  updateCrisprSession,
  useCrisprSession,
} from '../crisprSession';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** As the ORF list does, past this many the views are left alone (#32). */
export const MAX_PREVIEWED = 200;

export const guideId = (g: CrisprGuide): string => `${g.strand}:${String(g.range.start)}`;

/** Annotates the protospacer, offers its name for editing, and goes to the feature list. */
export function addGuideAsFeature(guide: CrisprGuide): void {
  analytics.track('crispr', 'add');
  const feature = guideFeature(guide);
  editorStore.apply({ type: 'addFeature', feature }, guide.range);
  editorStore.requestRename(feature.id);
  editorStore.setSidebarTab('features');
}
/** Everything wrong with a guide, worst first; empty when there is nothing to say. */
export function flagsOf(g: CrisprGuide): string[] {
  const flags: string[] = [];
  if ((g.offTargets[0] ?? 0) > 0) flags.push('Binds somewhere else exactly');
  if (g.polyT) flags.push('TTTT ends a U6 transcript');
  if (g.gc < GC_LOW) flags.push('Low GC');
  if (g.gc > GC_HIGH) flags.push('High GC');
  if (g.longestRun >= HOMOPOLYMER_FLAG) flags.push(`${String(g.longestRun)} of one base in a row`);
  return flags;
}

/** Fewest exact hits first, then fewest near ones, then along the molecule. */
function byOffTargets(a: CrisprGuide, b: CrisprGuide): number {
  for (let i = 0; i < Math.max(a.offTargets.length, b.offTargets.length); i++) {
    const d = (a.offTargets[i] ?? 0) - (b.offTargets[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.range.start - b.range.start;
}

const backgroundKey = (d: Background): string => `${d.name}\0${d.topology}\0${d.sequence}`;

function sameBackground(a: readonly Background[], b: readonly Background[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const n = b[i];
      return n !== undefined && backgroundKey(p) === backgroundKey(n);
    })
  );
}

/** Whether two requests are the same question, whatever objects they are. */
function sameRequest(a: Request, b: Request): boolean {
  return (
    a.sequence === b.sequence &&
    a.topology === b.topology &&
    a.maxMismatches === b.maxMismatches &&
    (a.region === null || b.region === null
      ? a.region === b.region
      : rangesEqual(a.region, b.region)) &&
    JSON.stringify(a.nuclease) === JSON.stringify(b.nuclease) &&
    a.background.length === b.background.length &&
    a.background.every((p, i) => {
      const n = b.background[i];
      return p.sequence === n?.sequence && p.topology === n.topology;
    })
  );
}

/**
 * The CRISPR tab's scan and what is made of it (item 133): the session for
 * the document in front, the scan it asks for, the list filtered and sorted,
 * the guide opened, and the arrows on the views while a host is mounted. The
 * panel and, later, the workspace read this; the state is in the session, so
 * a host that gives way to the other does not scan again.
 */
export function useCrisprScan(doc: SeqDocument) {
  const { selection, previewActivated: activated, documents, documentId } = useEditorState();
  const s = useCrisprSession(documentId);
  const set = (patch: Partial<CrisprSession>): void => {
    updateCrisprSession(documentId, patch);
  };
  const { nucleaseId, pam, spacerLength, maxMismatches, narrowed, searchOthers } = s;

  const custom = nucleaseId === 'custom';
  const length = Number.parseInt(spacerLength, 10);
  const problem = custom ? nucleaseProblem(pam.trim().toUpperCase(), length) : null;

  const nuclease = useMemo<Nuclease | null>(() => {
    if (!custom) return NUCLEASES.find((n) => n.id === nucleaseId) ?? null;
    if (problem !== null) return null;
    // A custom PAM is taken to be a Cas9-like one: on the 3' side of the
    // spacer, cutting bluntly three bases in from it. That is what the
    // engineered PAM variants (xCas9, SpRY, SaCas9-KKH) do; a nuclease with
    // another geometry needs a preset (item 74).
    return {
      id: 'custom',
      name: `Custom (${pam.trim().toUpperCase()})`,
      pam: pam.trim().toUpperCase(),
      pamSide: '3prime',
      spacerLength: length,
      cut: { pamStrand: length - 3, targetStrand: length - 3 },
    };
  }, [custom, nucleaseId, pam, length, problem]);

  const baseEditing = nuclease !== null && supportsBaseEditing(nuclease);
  const baseEditor = useMemo(
    () => (baseEditing ? BASE_EDITORS.find((e) => e.id === s.baseEditorId) : undefined),
    [baseEditing, s.baseEditorId],
  );
  const editableCount = (g: CrisprGuide): number =>
    baseEditor === undefined ? 0 : (baseEditWindow(g, baseEditor)?.editable.length ?? 0);

  const usableSelection = selection !== null && !isEmptyRange(selection) ? selection : null;
  // Dropped with the document it was taken in, or once an edit leaves it off the end.
  const region =
    narrowed !== null &&
    narrowed.documentId === documentId &&
    isValidRange(narrowed.range, doc.length, doc.topology)
      ? narrowed.range
      : null;
  const narrowTo = (range: Range | null): void => {
    set({ narrowed: range === null || documentId === null ? null : { documentId, range } });
    if (range !== null) analytics.track('crispr', 'region');
  };
  // `documents` is a new array on every selection change in any of them, so
  // the list is kept as state and replaced only when what is searched has
  // changed: otherwise the request below would be a new one per click, and
  // every click would scan the molecule again. It starts from the session's,
  // so a remount asks the question the session holds the answer to.
  const [others, setOthers] = useState<readonly Background[]>(s.others);
  const nextOthers = useMemo<readonly Background[]>(
    () =>
      searchOthers
        ? documents
            .filter(
              (d) => d.documentId !== documentId && d.history.present.alphabet === 'nucleotide',
            )
            .map((d) => ({
              name: d.history.present.name,
              sequence: d.history.present.sequence.toString(),
              topology: d.history.present.topology,
            }))
        : [],
    [searchOthers, documents, documentId],
  );
  if (!sameBackground(others, nextOthers)) setOthers(nextOthers);
  useEffect(() => {
    if (!sameBackground(readCrisprSession(documentId).others, others)) {
      updateCrisprSession(documentId, { others });
    }
  }, [documentId, others]);

  // Everything one scan is: a change to any of it is a different question,
  // and the answer to the previous one stops being shown the moment it is.
  const sequence = doc.sequence.toString();
  const asked = useMemo<Request | null>(
    () =>
      nuclease === null
        ? null
        : {
            sequence,
            topology: doc.topology,
            nuclease,
            maxMismatches,
            region,
            background: others.map(({ sequence: q, topology }) => ({ sequence: q, topology })),
          },
    [sequence, doc.topology, nuclease, maxMismatches, region, others],
  );
  // The session's own object when it is the same question, so what it holds
  // is recognised by identity after a remount made a new one.
  const kept = s.request;
  const request = asked !== null && kept !== null && sameRequest(asked, kept) ? kept : asked;

  // The scan itself, in the worker, so a big plasmid does not hold up typing.
  // It is the session's to answer, not the panel's: the answer lands whether
  // or not a host is mounted, and a question the session already holds (asked
  // by an earlier mount, answered or still out) is not put again.
  useEffect(() => {
    if (request === null || readCrisprSession(documentId).request === request) return;
    updateCrisprSession(documentId, { request });
    // Still the question asked for when it comes back, or it is dropped.
    const current = (): boolean => readCrisprSession(documentId).request === request;
    analysisClient
      .crisprGuides(request.sequence, request.topology, request.nuclease, {
        maxMismatches: request.maxMismatches,
        ...(request.region === null ? {} : { region: request.region }),
        ...(request.background.length === 0 ? {} : { background: request.background }),
      })
      .then((guides) => {
        if (current()) updateCrisprSession(documentId, { answer: { request, guides } });
      })
      .catch((e: unknown) => {
        if (current()) {
          updateCrisprSession(documentId, {
            answer: { request, error: e instanceof Error ? e.message : String(e) },
          });
        }
      });
  }, [request, documentId]);

  const answered = s.answer !== null && s.answer.request === request ? s.answer : null;
  const guides = answered?.guides ?? null;
  const error = answered?.error ?? null;
  const scanning = request !== null && answered === null;

  // Once per nuclease chosen, not once per keystroke of a custom PAM.
  const nucleaseKind = nuclease?.id ?? null;
  useEffect(() => {
    if (nucleaseKind !== null) analytics.track('crispr', 'scan', nucleaseKind);
  }, [nucleaseKind]);

  // The PAMs actually found: NGG is four of them, NNGRRT up to sixty-four,
  // and which one a guide has is worth filtering on (SpCas9 prefers some).
  const pams = useMemo(() => [...new Set((guides ?? []).map((g) => g.pam))].sort(), [guides]);
  const pamChosen = pams.includes(s.pamFilter) ? s.pamFilter : '';

  const { sortBy, spacerFilter, showFlagged, onlyEditable } = s;
  const sorted = useMemo(() => {
    const pattern = spacerFilter.trim().toUpperCase();
    const masks = pattern === '' ? null : patternMasks(pattern);
    const list = (guides ?? []).filter((g) => {
      if (pamChosen !== '' && g.pam !== pamChosen) return false;
      if (!showFlagged && flagsOf(g).length > 0) return false;
      if (
        baseEditor !== undefined &&
        onlyEditable &&
        (baseEditWindow(g, baseEditor)?.editable.length ?? 0) === 0
      ) {
        return false;
      }
      if (masks === null) return true;
      // IUPAC, so "GRCC" or "N" work as they do in Find; an unknown letter
      // is a mask of nothing and matches no guide.
      const spacer = sequenceMasks(g.spacer);
      return matchPositions(spacer, masks, g.spacer.length - masks.length).length > 0;
    });
    if (sortBy === 'offTargets') list.sort(byOffTargets);
    else if (sortBy === 'gc') list.sort((a, b) => b.gc - a.gc || a.range.start - b.range.start);
    else if (sortBy === 'specificity') {
      list.sort(
        (a, b) => (b.specificity ?? -1) - (a.specificity ?? -1) || a.range.start - b.range.start,
      );
    }
    return list;
  }, [guides, sortBy, spacerFilter, pamChosen, showFlagged, baseEditor, onlyEditable]);
  const filtered = guides !== null && sorted.length !== guides.length;

  const covered = sorted.filter(
    (g) => selection !== null && g.range.start === selection.start && g.range.end === selection.end,
  );
  const selected = covered.find((g) => guideId(g) === s.clicked) ?? covered[0] ?? null;
  const selectedId = selected === null ? null : guideId(selected);

  const previewed = useMemo<OverlaySpan[]>(
    () =>
      sorted.length > MAX_PREVIEWED
        ? []
        : sorted.map((g) => ({
            id: guideId(g),
            label: g.pam,
            range: g.range,
            strand: g.strand,
            shape: 'arrow',
            clickable: true,
          })),
    [sorted],
  );
  useEffect(() => {
    editorStore.setPreview('crispr', previewed);
  }, [previewed]);
  useEffect(
    () => () => {
      editorStore.clearPreview('crispr');
    },
    [],
  );

  const handledClick = useRef(activated?.nonce ?? 0);
  useEffect(() => {
    if (activated?.owner !== 'crispr' || activated.nonce === handledClick.current) return;
    handledClick.current = activated.nonce;
    const g = sorted.find((x) => guideId(x) === activated.id);
    if (g === undefined) return;
    editorStore.setSelection(g.range);
    editorStore.revealPosition(g.range.start);
  }, [activated, sorted]);

  return {
    s,
    set,
    selection,
    usableSelection,
    custom,
    problem,
    nuclease,
    baseEditing,
    baseEditor,
    editableCount,
    region,
    narrowTo,
    guides,
    error,
    scanning,
    pams,
    pamChosen,
    sorted,
    filtered,
    covered,
    selected,
    selectedId,
    others,
  };
}
