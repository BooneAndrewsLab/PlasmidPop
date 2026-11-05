import { type DragEvent, useMemo, useState } from 'react';

import type { Alphabet } from '@/core';

import { fastaRecord } from '../alignmentText';

import {
  type LoadedFile,
  type Records,
  type SequenceRecord,
  readFiles,
  readRecords,
  warned,
} from '../sequenceRecords';

/**
 * What a box of records holds (#46, #59, #106): its text, the file or tabs
 * read into it while the text is still theirs, and what to say about them.
 * The owner keeps it where it likes — plain state for a window, panel
 * memory for a tab whose panel and workspace share one box (item 129).
 */
export interface RecordBoxState {
  readonly text: string;
  /** A file's records, qualities and all, while the box still shows its text. */
  readonly loaded: LoadedFile | null;
  /** Where the records came from, and what the reader warned about. */
  readonly note: string | null;
  /** A file that could not be read, named; the rest are kept. */
  readonly problem: string | null;
}

export const EMPTY_RECORD_BOX: RecordBoxState = {
  text: '',
  loaded: null,
  note: null,
  problem: null,
};

export interface RecordBox extends RecordBoxState {
  readonly parsed: Records;
  readonly records: readonly SequenceRecord[];
  /** Records from more than one file, each to be named with its file. */
  readonly several: boolean;
  readonly dragging: boolean;
  /** The box typed into: read afresh, the loaded file's qualities gone. */
  readonly setText: (text: string) => void;
  /** Picked or dropped files read into the box. */
  readonly load: (files: readonly File[]) => void;
  /** Records from elsewhere (open tabs, #262) put in as a file's would be. */
  readonly loadRecords: (loaded: LoadedFile, note: string) => void;
  /**
   * One record taken out (item 129). A set from several files stays a set;
   * otherwise the box's text becomes the rest as FASTA, qualities kept.
   */
  readonly removeRecord: (index: number) => void;
  readonly dragHandlers: {
    readonly onDragOver: (e: DragEvent) => void;
    readonly onDragLeave: () => void;
    readonly onDrop: (e: DragEvent) => void;
  };
}

type SetBox = (next: RecordBoxState | ((previous: RecordBoxState) => RecordBoxState)) => void;

/**
 * The paste-or-drop box of records the Align tab and the multiple
 * alignment window share. `onChange` is told whenever what the box holds
 * changes, with whether it now holds a batch (several files or tabs, to be
 * aligned all together) or one text, so the owner can drop results that no
 * longer belong to the input (#117).
 */
export function useRecordBox(
  state: RecordBoxState,
  setState: SetBox,
  alphabet: Alphabet,
  onChange?: (batch: boolean) => void,
): RecordBox {
  const [dragging, setDragging] = useState(false);
  const { text, loaded } = state;
  // Once the text is edited it is read afresh and the qualities are gone.
  const parsed = useMemo<Records>(
    () =>
      loaded !== null && loaded.text === text
        ? { ok: true, records: loaded.records }
        : readRecords(text, alphabet),
    [loaded, text, alphabet],
  );
  const records = parsed.ok ? parsed.records : [];
  const several = new Set(records.map((r) => r.file)).size > 1;

  const setText = (next: string): void => {
    setState({ text: next, loaded: null, note: null, problem: null });
    onChange?.(false);
  };

  const loadRecords = (next: LoadedFile, note: string): void => {
    setState({ text: next.text, loaded: next, note, problem: null });
    onChange?.(next.text === '');
  };

  const removeRecord = (index: number): void => {
    const remaining = records.filter((_, i) => i !== index);
    const fromFiles = loaded !== null && loaded.text === '';
    if (remaining.length === 0) {
      setState(EMPTY_RECORD_BOX);
      onChange?.(false);
      return;
    }
    const nextText = fromFiles
      ? ''
      : remaining.map((r) => fastaRecord(r.name, r.sequence)).join('');
    setState((s) => ({
      ...s,
      text: nextText,
      loaded: { text: nextText, records: remaining },
    }));
    onChange?.(fromFiles);
  };

  const load = (files: readonly File[]): void => {
    if (files.length === 0) return;
    readFiles(files)
      .then(({ good, failures }) => {
        const problem = failures.length === 0 ? null : failures.join(' ');
        if (good.length === 0) {
          setState((s) => ({ ...s, problem }));
          return;
        }
        const [only] = good;
        if (good.length === 1 && only !== undefined) {
          const withQualities = only.read.records.some((r) => r.read !== undefined);
          setState({
            text: only.read.text,
            loaded: only.read,
            note:
              `From ${only.file.name}${withQualities ? ', with base qualities' : ''}.` +
              warned(only.read),
            problem,
          });
          onChange?.(false);
          return;
        }
        // Several files: their records are the samples, file order then record
        // order. The box is emptied; its text would be unwieldy (AB1 especially).
        const records = good.flatMap((g) =>
          g.read.records.map((r) => ({ ...r, file: g.file.name })),
        );
        setState({
          text: '',
          loaded: { text: '', records },
          note:
            `${good.length} files, ${records.length} ${records.length === 1 ? 'record' : 'records'}.` +
            good.map((g) => warned(g.read, g.file.name)).join(''),
          problem,
        });
        onChange?.(true);
      })
      .catch((e: unknown) => {
        setState((s) => ({ ...s, problem: e instanceof Error ? e.message : String(e) }));
      });
  };

  // A dragged file is claimed here with preventDefault, so the app-wide
  // handler (which would open it in a new tab) leaves it alone; dragged
  // text drops into the box as usual.
  const onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    if (!dragging) setDragging(true);
  };
  const onDrop = (e: DragEvent): void => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(false);
    load(Array.from(e.dataTransfer.files));
  };

  return {
    ...state,
    parsed,
    records,
    several,
    dragging,
    setText,
    load,
    loadRecords,
    removeRecord,
    dragHandlers: {
      onDragOver,
      onDragLeave: () => {
        setDragging(false);
      },
      onDrop,
    },
  };
}
