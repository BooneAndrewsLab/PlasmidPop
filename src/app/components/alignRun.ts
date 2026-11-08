import { useEffect, useMemo } from 'react';

import {
  type AlignmentMode,
  type SeqDocument,
  type SequencingRead,
  type PairNames,
  assembleReads,
  isEmptyRange,
} from '@/core';
import { writeFastaRecords } from '@/io';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import {
  type AlignBatch,
  type AlignSession,
  type ShownAlignment,
  alignRunActive,
  beginAlignRun,
  cancelAlignRun,
  endAlignRun,
  updateAlignSession,
  useAlignSession,
} from '../alignSession';
import { tabsToRecords } from '../alignTabs';
import type { SampleFeatures } from '../alignmentSampleTrack';
import type { StackSample } from '../alignmentStack';
import {
  type ReferenceInput,
  alignedRegionInDocument,
  finishReadAlignment,
  prepareReadAlignment,
  suggestAlignMode,
} from '../readAlignment';
import { BATCH_LIMIT, type BatchRow, runReadBatch } from '../readBatch';
import { type SequenceRecord, featuresOf, findRecordPairs } from '../sequenceRecords';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { type RecordBox, useRecordBox } from './useRecordBox';

/** What a sample brings to the large view's rows (#128), from the record it was aligned as. */
export function sampleFeaturesOf(r: SequenceRecord): { readonly features?: SampleFeatures } {
  return r.features === undefined
    ? {}
    : { features: { features: r.features, circular: r.circular } };
}

/** What the large view (#103) stacks, and the row to start on. */
export interface LargeView {
  readonly reference: ReferenceInput;
  readonly referenceName: string;
  readonly documentIsRead: boolean;
  readonly document: SeqDocument | null;
  readonly samples: readonly StackSample[];
  readonly initialRow?: number;
}

export interface AlignRun {
  readonly session: AlignSession;
  readonly box: RecordBox;
  readonly records: readonly SequenceRecord[];
  /** The record the one button aligns; undefined with an empty box. */
  readonly record: SequenceRecord | undefined;
  /** "All records" chosen in the picker: the one button then aligns each of them. */
  readonly all: boolean;
  /** The other open tabs of the same alphabet, to align against (#105). */
  readonly otherTabs: readonly { readonly id: string; readonly name: string }[];
  readonly loadTabs: (ids: readonly string[]) => void;
  readonly hasSelection: boolean;
  /** The document's own read, when it is one (#57). */
  readonly docRead: SequencingRead | null;
  /** The document is the read and the box the reference (#57). */
  readonly docIsRead: boolean;
  /** The qualities the alignment will use, if any: the record's or the document's. */
  readonly readInUse: SequencingRead | null;
  /** Any read in play, so the Reads settings are worth showing. */
  readonly anyReads: boolean;
  readonly mode: AlignmentMode;
  /** Why Local was suggested, when it was and no mode is picked. */
  readonly suggestedReason: string | null;
  /** The result or the batch is from other options than those set now (#117). */
  readonly stale: boolean;
  /** The batch's list is shown once a read is in it, or when the batch has ended with none. */
  readonly showBatch: boolean;
  readonly batchPickedRow: BatchRow | undefined;
  readonly setPicked: (index: number) => void;
  readonly setTrim: (trim: boolean) => void;
  /** The read pairs the records' names give (#347): who is whose mate, and names that could not be told. */
  readonly readPairs: PairNames;
  /** The insert size as typed, and as a number of bases (null when blank or not a size). */
  readonly insertSize: string;
  readonly insertBases: number | null;
  readonly setInsertSize: (text: string) => void;
  readonly setPickedMode: (mode: AlignmentMode) => void;
  readonly setUseSelection: (on: boolean) => void;
  readonly setDocAsRead: (on: boolean) => void;
  /** Aligns the record chosen, or, with "All records", every record (#59); whether a run started. */
  readonly run: () => boolean;
  readonly runAll: () => boolean;
  readonly runAssemble: () => void;
  readonly cancel: () => void;
  /** Picking a batch row shows its alignment and selects the region it covers. */
  readonly pickBatchRow: (index: number) => void;
  /** Every read aligned so far in the large view, starting on `index` when one is picked. */
  readonly batchLarge: (index: number | undefined) => LargeView | null;
  /** The one result in the large view. */
  readonly resultLarge: () => LargeView | null;
}

/** The insert size typed, in bases, or null when it is blank or is no size (under 50 or over a million). */
export function parseInsertSize(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t));
  return n >= 50 && n <= 1_000_000 ? n : null;
}

/** How many hooks are on a document's session, so a run is stopped only when the last one goes. */
const hosts = new Map<string, number>();

/**
 * The Align tab's logic (items 46, 50, 57, 59, 86, 117, 208): what the slim
 * panel and the Align workspace share (item 129). The state is the
 * document's `AlignSession`; the runs go to the worker and write their
 * results back to it, so a run started in the panel ends in the workspace,
 * or in neither, and is there when either is looked at next. Leaving both
 * stops an alignment nobody would see the end of.
 */
export function useAlignRun(doc: SeqDocument): AlignRun {
  const {
    selection,
    readTrimCutoff,
    readConfidentQuality,
    documents: openTabs,
    documentId,
  } = useEditorState();
  const session = useAlignSession(documentId);
  const key = documentId ?? '';
  const update = (
    patch: Partial<AlignSession> | ((s: AlignSession) => Partial<AlignSession>),
  ): void => {
    updateAlignSession(documentId, patch);
  };

  // The panel gives way to the workspace in one commit: the count dips to
  // nought and is back before the timer looks, so a run survives the move
  // and is stopped only when neither is on screen.
  useEffect(() => {
    hosts.set(key, (hosts.get(key) ?? 0) + 1);
    return () => {
      hosts.set(key, (hosts.get(key) ?? 1) - 1);
      setTimeout(() => {
        if ((hosts.get(key) ?? 0) === 0 && alignRunActive(documentId)) {
          cancelAlignRun(documentId);
          updateAlignSession(documentId, { busy: false, progress: null });
        }
      }, 0);
    };
  }, [key, documentId]);

  /**
   * The input changed, so what was aligned no longer belongs to it (#117):
   * stop a running alignment and drop the result or the batch. Several
   * files or tabs are a batch: align them all unless one is picked.
   */
  const clearResults = (): void => {
    cancelAlignRun(documentId);
    update({ result: null, batch: null, batchPicked: null, assembly: null });
  };
  const box = useRecordBox(
    session.box,
    (next) => {
      update((s) => ({ box: typeof next === 'function' ? next(s.box) : next }));
    },
    doc.alphabet,
    (batch) => {
      clearResults();
      update({ picked: batch ? -1 : 0, error: null });
    },
  );
  const { parsed, records, several } = box;
  const { picked, trim, pickedMode, useSelection, docAsRead, result, batch, insertSize } = session;
  const all = picked === -1 && records.length > 1 && records.length <= BATCH_LIMIT;
  const record = records[all ? 0 : Math.min(Math.max(picked, 0), records.length - 1)];
  const hasSelection = selection !== null && !isEmptyRange(selection);
  // Mates by name (#347); the insert size is bases between the outer ends of two mates.
  const readPairs = useMemo(() => findRecordPairs(records), [records]);
  const insertBases = parseInsertSize(insertSize);

  const otherTabs = useMemo(
    () =>
      openTabs.filter(
        (t) => t.documentId !== documentId && t.history.present.alphabet === doc.alphabet,
      ),
    [openTabs, documentId, doc.alphabet],
  );

  /**
   * Takes the chosen tabs' current sequences, unsaved edits and reads
   * included, as the samples (#262). One is a single sample as it always was;
   * several are a batch, as several files are, to align all together.
   */
  const loadTabs = (ids: readonly string[]): void => {
    const tabs = ids.flatMap((id) => otherTabs.filter((t) => t.documentId === id));
    const docs = tabs.map((t) => t.history.present);
    const taken = tabsToRecords(docs, BATCH_LIMIT);
    const [only] = docs;
    if (only === undefined) return;
    if (taken.length === 1) {
      box.loadRecords(
        { text: writeFastaRecords([only]), records: taken },
        `From the open tab ${only.name}${only.read === null ? '' : ', with base qualities'}.`,
      );
      return;
    }
    // The box is emptied, as for several files; their records are the samples.
    box.loadRecords({ text: '', records: taken }, `${taken.length} open tabs.`);
  };

  // The document is itself a read (an opened AB1 or FASTQ, still as it came
  // off the sequencer) and the box holds a plain sequence: the box is taken
  // as the reference and the document as the read, so its qualities and
  // trace are used (#57). A box that holds a read of its own keeps the usual
  // way round.
  const docRead = doc.read;
  const docIsRead = docRead !== null && record?.read === undefined && docAsRead;
  const readInUse = docIsRead ? docRead : (record?.read ?? null);

  const target =
    useSelection && selection !== null && hasSelection ? selection : { start: 0, end: doc.length };
  // Local for a read or a much shorter sequence, until a mode is picked (#86).
  const suggested = docIsRead
    ? suggestAlignMode({ length: doc.length, isRead: true }, record?.sequence.length ?? 0)
    : record === undefined
      ? suggestAlignMode({ length: 0, isRead: false }, 0)
      : suggestAlignMode(
          { length: record.sequence.length, isRead: record.read !== undefined },
          target.end - target.start,
        );
  const mode = pickedMode ?? suggested.mode;
  const optionsKey = `${mode}|${useSelection && hasSelection && !docIsRead}`;

  /**
   * The document, or its selection, as the reference a read is aligned to;
   * `local` when it may be aligned through the origin of a circle.
   */
  const documentReference = (local: boolean): ReferenceInput => {
    // A read of a circular plasmid may run through its origin: a local
    // alignment is made against the sequence with its start repeated after
    // its end, far enough for the read to fit (#51).
    const whole = target.start === 0 && target.end === doc.length;
    const wrap = whole && doc.isCircular && local && doc.length > 1 ? doc.length : null;
    return { sequence: doc.subsequence(target), offset: target.start, wrap };
  };

  /** Starts a request to the worker that the Cancel button and leaving can stop. */
  const begin = (): AbortController => {
    const controller = beginAlignRun(documentId);
    update({ busy: true, progress: null, error: null });
    return controller;
  };
  const end = (controller: AbortController): void => {
    endAlignRun(documentId, controller);
    update({ busy: false, progress: null });
  };
  const setProgress = (progress: number): void => {
    update({ progress });
  };
  const fail = (e: unknown): void => {
    update({ error: e instanceof Error ? e.message : String(e) });
  };
  const named = (r: SequenceRecord): string => (several ? `${r.name} (${r.file ?? ''})` : r.name);

  /**
   * Aligns every record against the document, one after another in the
   * worker, listing each as it is done (#59). The document is the
   * reference, whichever way round a single alignment would go.
   */
  const runAll = (): boolean => {
    if (records.length > BATCH_LIMIT || records.length === 0) return false;
    analytics.track('align', 'batch', pickedMode ?? 'auto');
    // Wrapping for the reads aligned locally; runReadBatch drops it for the rest.
    const reference = documentReference(true);
    const controller = begin();
    update({
      alignedWith: optionsKey,
      progress: 0,
      result: null,
      batchPicked: null,
      assembly: null,
      batch: {
        rows: [],
        total: records.length,
        cancelled: false,
        reference,
        features: records.map(sampleFeaturesOf),
      },
    });
    const patchBatch = (f: (b: AlignBatch) => AlignBatch): void => {
      update((s) => (s.batch === null ? {} : { batch: f(s.batch) }));
    };
    runReadBatch(
      records.map((r) => ({ name: named(r), sequence: r.sequence, read: r.read ?? null })),
      reference,
      (a, b, options, long) => analysisClient.alignEitherStrand(a, b, options, long),
      {
        // Banded whatever the size, the band checked against any better path
        // (#167): the same scores, several times sooner.
        options: { fast: true },
        // Each read by the same rule as a single one, unless a mode was picked.
        mode: pickedMode,
        trimCutoff: trim ? readTrimCutoff : null,
        onRow: (row) => {
          patchBatch((b) => ({ ...b, rows: [...b.rows, row] }));
        },
        onProgress: setProgress,
        signal: controller.signal,
      },
    )
      .then((outcome) => {
        patchBatch((b) => ({ ...b, cancelled: outcome.cancelled }));
      })
      .catch(fail)
      .finally(() => {
        end(controller);
      });
    return true;
  };

  /**
   * Joins the records into contigs with no reference (#208). Each overlap is
   * an alignment in the worker, so the main thread only waits.
   */
  const runAssemble = (): void => {
    if (records.length < 2 || records.length > BATCH_LIMIT) return;
    analytics.track('align', 'assemble');
    const names = records.map(named);
    const controller = begin();
    update({ progress: 0, result: null, batch: null, batchPicked: null, assembly: null });
    assembleReads(
      records.map((r, i) => ({
        name: names[i] ?? r.name,
        sequence: r.sequence,
        qualities: r.read?.qualities ?? null,
      })),
      {
        align: (a, b, options) =>
          analysisClient.alignEitherStrand(a, b, options, { signal: controller.signal }),
        trimCutoff: trim ? readTrimCutoff : null,
        confidentFrom: readConfidentQuality,
        pairs: readPairs.pairs,
        insertSize: insertBases,
        onProgress: setProgress,
        signal: controller.signal,
      },
    )
      .then((out) => {
        update({ assembly: { assembly: out, names } });
      })
      .catch((e: unknown) => {
        if (e instanceof AnalysisCancelledError || controller.signal.aborted) return;
        fail(e);
      })
      .finally(() => {
        end(controller);
      });
  };

  const runOne = (): boolean => {
    if (!parsed.ok) {
      update({ error: parsed.message });
      return false;
    }
    if (record === undefined || record.sequence === '') {
      update({
        error: docIsRead
          ? 'Paste the reference to align this read against.'
          : 'Paste the sequence to align against this document.',
      });
      return false;
    }
    let reference: ReferenceInput;
    let prepared;
    if (docIsRead) {
      // A read of a circular reference may run through its origin, as below.
      const wrap =
        record.circular && mode === 'local' && record.sequence.length > 1
          ? record.sequence.length
          : null;
      reference = { sequence: record.sequence, offset: 0, wrap };
      prepared = prepareReadAlignment(
        reference,
        { sequence: doc.sequence.toString(), read: docRead },
        trim ? readTrimCutoff : null,
      );
    } else {
      reference = documentReference(mode === 'local');
      // A read's unreliable ends are trimmed off before it is aligned (#50).
      prepared = prepareReadAlignment(
        reference,
        { sequence: record.sequence, read: record.read ?? null },
        trim ? readTrimCutoff : null,
      );
    }
    if (!prepared.ok) {
      update({ error: prepared.message });
      return false;
    }
    const { job } = prepared;
    const shownAs = docIsRead ? { referenceName: record.name } : null;
    const sampleFeatures = docIsRead
      ? sampleFeaturesOf({
          name: doc.name,
          sequence: '',
          circular: doc.isCircular,
          ...featuresOf(doc),
        })
      : sampleFeaturesOf(record);
    analytics.track('align', 'run', mode);
    if (docIsRead) analytics.trackOnce('align', 'document-read');
    const controller = begin();
    update({ alignedWith: optionsKey, batch: null });
    analysisClient
      .alignEitherStrand(
        job.a,
        job.b,
        // A protein is scored by BLOSUM62 and has no second strand (#95).
        {
          mode,
          alphabet: doc.alphabet,
          ...(job.reference.wrap === null ? {} : { wrap: job.reference.wrap }),
        },
        { onProgress: setProgress, signal: controller.signal },
      )
      .then((best) => {
        const shown: ShownAlignment = {
          ...finishReadAlignment(job, best),
          docIsRead: shownAs,
          reference,
          sampleFeatures,
        };
        update((s) => ({ result: shown, resultKey: s.resultKey + 1 }));
      })
      .catch((e: unknown) => {
        if (e instanceof AnalysisCancelledError) return;
        fail(e);
      })
      .finally(() => {
        end(controller);
      });
    return true;
  };

  const pickBatchRow = (index: number): void => {
    update({ batchPicked: index });
    const row = batch?.rows.find((r) => r.index === index);
    if (row?.status !== 'aligned') return;
    const range = alignedRegionInDocument(row.result, false);
    if (range !== null) {
      editorStore.setSelection(range);
      editorStore.revealPosition(range.start);
    }
  };

  const batchLarge = (index: number | undefined): LargeView | null => {
    if (batch === null) return null;
    const aligned = batch.rows.flatMap((r) => (r.status === 'aligned' ? [r] : []));
    return {
      reference: batch.reference,
      referenceName: doc.name,
      documentIsRead: false,
      document: doc,
      samples: aligned.map((r) => ({
        name: r.name,
        result: r.result,
        ...batch.features[r.index],
      })),
      ...(index === undefined ? {} : { initialRow: aligned.findIndex((r) => r.index === index) }),
    };
  };

  const resultLarge = (): LargeView | null =>
    result === null
      ? null
      : {
          reference: result.reference,
          referenceName: result.docIsRead?.referenceName ?? doc.name,
          documentIsRead: result.docIsRead !== null,
          document: result.docIsRead === null ? doc : null,
          samples: [
            {
              name: result.docIsRead === null ? 'Sequence' : doc.name,
              result,
              ...result.sampleFeatures,
            },
          ],
        };

  const anyReads = readInUse !== null || records.some((r) => r.read !== undefined);
  const stale = (result !== null || batch !== null) && session.alignedWith !== optionsKey;
  const showBatch = batch !== null && (batch.rows.length > 0 || !session.busy);
  const batchPickedRow =
    batch === null || session.batchPicked === null
      ? undefined
      : batch.rows.find((r) => r.index === session.batchPicked);

  return {
    session,
    box,
    records,
    record,
    all,
    otherTabs: otherTabs.map((t) => ({ id: t.documentId, name: t.history.present.name })),
    loadTabs,
    hasSelection,
    docRead,
    docIsRead,
    readInUse,
    anyReads,
    mode,
    suggestedReason: pickedMode === null ? suggested.reason : null,
    stale,
    showBatch,
    batchPickedRow,
    setPicked: (index) => {
      clearResults();
      update({ picked: index });
    },
    setTrim: (on) => {
      update({ trim: on });
    },
    readPairs,
    insertSize,
    insertBases,
    setInsertSize: (text) => {
      update({ insertSize: text });
    },
    setPickedMode: (next) => {
      update({ pickedMode: next });
    },
    setUseSelection: (on) => {
      update({ useSelection: on });
    },
    setDocAsRead: (on) => {
      update({ docAsRead: on });
    },
    run: () => (all ? runAll() : runOne()),
    runAll,
    runAssemble,
    cancel: () => {
      cancelAlignRun(documentId);
    },
    pickBatchRow,
    batchLarge,
    resultLarge,
  };
}
