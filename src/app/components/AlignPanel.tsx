import { analytics } from '../analytics';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  type Alignment,
  type AlignmentMode,
  type SeqDocument,
  isEmptyRange,
  normalizeSequenceInput,
} from '@/core';
import { parseSequenceData, parseSequenceFile, writeFastaRecords } from '@/io';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { SEQUENCE_FILE_ACCEPT } from '../openFile';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

const BLOCK = 60;

interface SequenceRecord {
  readonly name: string;
  readonly sequence: string;
}

type Records =
  | { readonly ok: true; readonly records: readonly SequenceRecord[] }
  | { readonly ok: false; readonly message: string };

/**
 * The records in whatever the user pasted or dropped: raw bases (one
 * record), or every record of a FASTA or GenBank text (#46).
 */
function readRecords(text: string): Records {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, records: [] };
  try {
    if (trimmed.startsWith('>') || trimmed.startsWith('LOCUS')) {
      const records = parseSequenceFile(trimmed).documents.map((d) => ({
        name: d.name,
        sequence: d.sequence.toString(),
      }));
      return { ok: true, records };
    }
    return {
      ok: true,
      records: [{ name: 'Pasted sequence', sequence: normalizeSequenceInput(trimmed) }],
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A picked or dropped file as text for the box: a text format as it is, a
 * SnapGene file (binary) as FASTA of its sequence. Throws if the file is not
 * one the app can read.
 */
async function fileAsText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const parsed = parseSequenceData(data, file.name);
  return parsed.format === 'snapgene'
    ? writeFastaRecords(parsed.documents)
    : new TextDecoder('utf-8').decode(data);
}

function AlignmentBlocks({
  alignment,
  offsetA,
  offsetB,
}: {
  alignment: Alignment;
  offsetA: number;
  offsetB: number;
}) {
  const blocks: { a: string; m: string; b: string; posA: number; posB: number }[] = [];
  let posA = alignment.startA + offsetA;
  let posB = alignment.startB + offsetB;
  for (let i = 0; i < alignment.columns; i += BLOCK) {
    const a = alignment.alignedA.slice(i, i + BLOCK);
    const b = alignment.alignedB.slice(i, i + BLOCK);
    blocks.push({ a, m: alignment.matchLine.slice(i, i + BLOCK), b, posA, posB });
    posA += a.replace(/-/g, '').length;
    posB += b.replace(/-/g, '').length;
  }
  return (
    <pre className="alignment">
      {blocks.map((blk) => (
        <div key={`${blk.posA}-${blk.posB}`} className="alignment__block">
          {`${String(blk.posA + 1).padStart(7)} ${blk.a}\n${' '.repeat(8)}${blk.m}\n${String(blk.posB + 1).padStart(7)} ${blk.b}\n`}
        </div>
      ))}
    </pre>
  );
}

export function AlignPanel({ doc }: Props) {
  const { selection } = useEditorState();
  const [other, setOther] = useState('');
  const [picked, setPicked] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<AlignmentMode>('global');
  const [useSelection, setUseSelection] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Fraction of the running alignment done; null until it first reports. */
  const [progress, setProgress] = useState<number | null>(null);
  const running = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{
    alignment: Alignment;
    strand: 'forward' | 'reverse';
    offset: number;
    lengthB: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Leaving the tab stops an alignment nobody would see the end of.
  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const hasSelection = selection !== null && !isEmptyRange(selection);
  const parsed = useMemo(() => readRecords(other), [other]);
  const records = parsed.ok ? parsed.records : [];
  const record = records[Math.min(picked, records.length - 1)];

  const setText = (text: string): void => {
    setOther(text);
    setPicked(0);
    setError(null);
  };

  const load = (file: File | undefined): void => {
    if (file === undefined) return;
    fileAsText(file)
      .then((text) => {
        setText(text);
        setFileNote(`From ${file.name}.`);
      })
      .catch((e: unknown) => {
        setError(`Could not read "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
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
    load(e.dataTransfer.files[0]);
  };

  const run = (): void => {
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const b = record?.sequence ?? '';
    if (b === '') {
      setError('Paste the sequence to align against this document.');
      return;
    }
    const target =
      useSelection && selection !== null && hasSelection
        ? selection
        : { start: 0, end: doc.length };
    const a = doc.subsequence(target);
    analytics.track('align', 'run', mode);
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setProgress(null);
    setError(null);
    analysisClient
      .alignEitherStrand(a, b, { mode }, { onProgress: setProgress, signal: controller.signal })
      .then((best) => {
        setResult({ ...best, offset: target.start, lengthB: b.length });
      })
      .catch((e: unknown) => {
        if (e instanceof AnalysisCancelledError) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (running.current === controller) running.current = null;
        setBusy(false);
        setProgress(null);
      });
  };

  return (
    <div className="panel">
      <p className="panel__note">
        Align another sequence to {useSelection && hasSelection ? 'the selection' : doc.name}.
        Whichever orientation of it aligns better is shown.
      </p>
      <textarea
        className={`panel__textarea${dragging ? ' panel__textarea--over' : ''}`}
        rows={5}
        spellCheck={false}
        placeholder="Paste bases, FASTA or GenBank, or drop a file here"
        aria-label="Sequence to align"
        value={other}
        onChange={(e) => {
          setText(e.target.value);
          setFileNote(null);
        }}
        onDragOver={onDragOver}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
      />
      <div className="panel__controls">
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => fileInput.current?.click()}
        >
          Choose file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={SEQUENCE_FILE_ACCEPT}
          aria-label="File to align"
          hidden
          onChange={(e) => {
            load(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {records.length > 1 && (
          <label className="panel__field">
            <select
              className="panel__select"
              aria-label="Record to align"
              value={Math.min(picked, records.length - 1)}
              onChange={(e) => {
                setPicked(Number(e.target.value));
              }}
            >
              {records.map((r, i) => (
                <option key={i} value={i}>
                  {r.name} ({r.sequence.length.toLocaleString()} bp)
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {(fileNote !== null || records.length > 1) && (
        <p className="panel__note">
          {[
            fileNote,
            records.length > 1 ? `${records.length} records; the one chosen is aligned.` : null,
          ]
            .filter((t) => t !== null)
            .join(' ')}
        </p>
      )}
      <div className="panel__controls">
        <label className="panel__field">
          <select
            className="panel__select"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as AlignmentMode);
            }}
          >
            <option value="global">Global (end to end)</option>
            <option value="local">Local (best region)</option>
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={useSelection && hasSelection}
            disabled={!hasSelection}
            onChange={(e) => {
              setUseSelection(e.target.checked);
            }}
          />
          Against selection only
        </label>
        <button
          type="button"
          className="button button--small"
          disabled={busy || other.trim() === ''}
          onClick={run}
        >
          {busy ? 'Aligning…' : 'Align'}
        </button>
      </div>
      {/* Only an alignment long enough to report shows this, so a quick one does not flash it. */}
      {busy && progress !== null && (
        <div className="align-progress">
          <progress
            className="align-progress__bar"
            value={progress}
            max={1}
            aria-label="Alignment progress"
          />
          <span className="align-progress__label" aria-live="polite">
            {Math.floor(progress * 100)}%
          </span>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              running.current?.abort();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {error !== null && <p className="panel__error">{error}</p>}
      {result !== null && (
        <div className="panel__section">
          <h3 className="panel__heading">
            {result.alignment.mode === 'global' ? 'Global alignment' : 'Local alignment'}
            <span className="panel__heading-note">
              score {result.alignment.score}, identity {Math.round(result.alignment.identity * 100)}
              % over {result.alignment.columns.toLocaleString()} columns, {result.alignment.gaps}{' '}
              gap {result.alignment.gaps === 1 ? 'column' : 'columns'}
              {result.strand === 'reverse' ? ', reverse complement of the pasted sequence' : ''}
            </span>
          </h3>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              const start = result.offset + result.alignment.startA;
              const end = result.offset + result.alignment.endA;
              if (end > start) {
                editorStore.setSelection({ start, end });
                editorStore.revealPosition(start);
              }
            }}
          >
            Select aligned region in this document
          </button>
          <AlignmentBlocks alignment={result.alignment} offsetA={result.offset} offsetB={0} />
        </div>
      )}
    </div>
  );
}
