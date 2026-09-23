import { analytics } from '../analytics';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  type Alignment,
  type AlignmentMode,
  type ReadDifference,
  type SeqDocument,
  CONFIDENT_QUALITY,
  columnQualities,
  isEmptyRange,
  normalizeSequenceInput,
  readDifferences,
  trimByQuality,
} from '@/core';
import { parseSequenceFile, readSequenceData, writeFastaRecords } from '@/io';
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
  /** Per-base Phred qualities, for a record read from an AB1 or FASTQ file. */
  readonly qualities?: Uint8Array;
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

const TEXT_FORMATS: readonly string[] = ['genbank', 'fasta', 'raw'];

/** A file read into the box: the text it shows, and its records as read. */
interface LoadedFile {
  readonly text: string;
  readonly records: readonly SequenceRecord[];
}

/**
 * A picked or dropped file for the box. The box shows GenBank or FASTA as
 * it is, and anything else — SnapGene and AB1, which are binary, FASTQ, a
 * gzipped file — as FASTA of its records; the records keep the qualities
 * a read has, which FASTA cannot show (#50). Throws if the file is not one
 * the app can read.
 */
async function readFile(file: File): Promise<LoadedFile> {
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
    ...(d.read === null ? {} : { qualities: d.read.qualities }),
  }));
  return { text, records };
}

/** The read's quality class under a column: poor below Q20. */
function qualityClass(q: number | undefined): string {
  return q === undefined || q >= CONFIDENT_QUALITY ? '' : 'alignment__q-low';
}

/**
 * The second sequence's line of a block, its poor bases (below Q20) marked
 * when there are qualities: runs of one class, so a block is a few spans.
 */
function ReadLine({ bases, qualities }: { bases: string; qualities: readonly number[] | null }) {
  if (qualities === null) return <>{bases}</>;
  const runs: { text: string; cls: string }[] = [];
  for (let k = 0; k < bases.length; k++) {
    const cls = qualityClass(qualities[k]);
    const last = runs[runs.length - 1];
    if (last?.cls === cls) last.text += bases.charAt(k);
    else runs.push({ text: bases.charAt(k), cls });
  }
  return (
    <>
      {runs.map((r, i) =>
        r.cls === '' ? (
          r.text
        ) : (
          <span key={i} className={r.cls}>
            {r.text}
          </span>
        ),
      )}
    </>
  );
}

function AlignmentBlocks({
  alignment,
  offsetA,
  offsetB,
  wrap,
  qualities,
}: {
  alignment: Alignment;
  offsetA: number;
  offsetB: number;
  /** A circular document's length, when positions past its end go round again. */
  wrap: number | null;
  /** The read's quality under each column, or null without qualities. */
  qualities: readonly number[] | null;
}) {
  const blocks: { a: string; m: string; b: string; posA: number; posB: number; at: number }[] = [];
  let posA = alignment.startA + offsetA;
  let posB = alignment.startB + offsetB;
  for (let i = 0; i < alignment.columns; i += BLOCK) {
    const a = alignment.alignedA.slice(i, i + BLOCK);
    const b = alignment.alignedB.slice(i, i + BLOCK);
    blocks.push({ a, m: alignment.matchLine.slice(i, i + BLOCK), b, posA, posB, at: i });
    posA += a.replace(/-/g, '').length;
    posB += b.replace(/-/g, '').length;
  }
  return (
    <pre className="alignment">
      {blocks.map((blk) => (
        <div key={`${blk.posA}-${blk.posB}`} className="alignment__block">
          {`${String((wrap === null ? blk.posA : blk.posA % wrap) + 1).padStart(7)} ${blk.a}\n${' '.repeat(8)}${blk.m}\n${String(blk.posB + 1).padStart(7)} `}
          <ReadLine
            bases={blk.b}
            qualities={qualities === null ? null : qualities.slice(blk.at, blk.at + BLOCK)}
          />
          {'\n'}
        </div>
      ))}
    </pre>
  );
}

const KIND_LABEL: Readonly<Record<ReadDifference['kind'], string>> = {
  mismatch: 'Mismatch',
  insertion: 'Extra base in the read',
  deletion: 'Base missing from the read',
};

/**
 * What the qualities say about the differences: how many sit on bases the
 * read was sure of (Q20+) and how many on poor ones, with each confident
 * one listed to be looked at in the document. "Does my clone match" comes
 * down to the first number.
 */
function ReadSummary({
  differences,
  offset,
  wrap,
  docName,
}: {
  differences: readonly ReadDifference[];
  offset: number;
  wrap: number | null;
  docName: string;
}) {
  const confident = differences.filter((d) => d.confident);
  const poor = differences.length - confident.length;
  return (
    <div className="read-summary">
      <p className="panel__note">
        {differences.length === 0
          ? `No differences from ${docName} over the aligned stretch.`
          : `${confident.length === 0 ? 'No' : confident.length.toLocaleString()} ${confident.length === 1 ? 'difference' : 'differences'} at confident bases (Q${CONFIDENT_QUALITY}+)${poor === 0 ? '' : `, ${poor.toLocaleString()} at poor ones, shaded in the read`}.`}
      </p>
      {confident.length > 0 && (
        <ul className="read-summary__list">
          {confident.slice(0, 50).map((d) => {
            const at = wrap === null ? offset + d.positionA : (offset + d.positionA) % wrap;
            return (
              <li key={d.column}>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={() => {
                    const end = d.kind === 'insertion' ? at : at + 1;
                    editorStore.setSelection({ start: at, end });
                    editorStore.revealPosition(at);
                  }}
                >
                  {KIND_LABEL[d.kind]} at {(d.kind === 'insertion' ? at : at + 1).toLocaleString()}
                  {d.kind === 'insertion' ? ' (after)' : ''}, Q{d.quality}
                </button>
              </li>
            );
          })}
          {confident.length > 50 && <li>…and {(confident.length - 50).toLocaleString()} more</li>}
        </ul>
      )}
    </div>
  );
}

export function AlignPanel({ doc }: Props) {
  const { selection } = useEditorState();
  const [other, setOther] = useState('');
  const [picked, setPicked] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [trim, setTrim] = useState(true);
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
    /** The document's length when the alignment may run past its origin, else null. */
    wrap: number | null;
    /** Where the aligned stretch of the other sequence starts, as numbered on screen. */
    offsetB: number;
    lengthB: number;
    /** Bases trimmed from each end of a read before aligning. */
    trimmed: { readonly start: number; readonly end: number } | null;
    /** The read's quality under each column, when it had qualities. */
    qualities: readonly number[] | null;
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
  // A file's records, qualities and all, while the box still shows its text;
  // once the text is edited it is read afresh and the qualities are gone.
  const parsed = useMemo<Records>(
    () =>
      loaded !== null && loaded.text === other
        ? { ok: true, records: loaded.records }
        : readRecords(other),
    [loaded, other],
  );
  const records = parsed.ok ? parsed.records : [];
  const record = records[Math.min(picked, records.length - 1)];

  const setText = (text: string): void => {
    setOther(text);
    setPicked(0);
    setError(null);
  };

  const load = (file: File | undefined): void => {
    if (file === undefined) return;
    readFile(file)
      .then((read) => {
        setText(read.text);
        setLoaded(read);
        const withQualities = read.records.some((r) => r.qualities !== undefined);
        setFileNote(`From ${file.name}${withQualities ? ', with base qualities' : ''}.`);
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
    const full = record?.sequence ?? '';
    if (full === '') {
      setError('Paste the sequence to align against this document.');
      return;
    }
    // A read's unreliable ends are trimmed off before it is aligned (#50).
    const allQualities = record?.qualities ?? null;
    const kept =
      allQualities !== null && trim ? trimByQuality(allQualities) : { start: 0, end: full.length };
    if (kept.end <= kept.start) {
      setError(
        'No stretch of this read is of good enough quality to align. Untick the trimming to align it all.',
      );
      return;
    }
    const b = full.slice(kept.start, kept.end);
    const qualities = allQualities === null ? null : allQualities.slice(kept.start, kept.end);
    const trimmed =
      allQualities !== null && trim ? { start: kept.start, end: full.length - kept.end } : null;
    const target =
      useSelection && selection !== null && hasSelection
        ? selection
        : { start: 0, end: doc.length };
    // A read of a circular plasmid may run through its origin: a local
    // alignment is made against the sequence with its start repeated after
    // its end, far enough for the read to fit (#51).
    const whole = target.start === 0 && target.end === doc.length;
    const wrap = whole && doc.isCircular && mode === 'local' && doc.length > 1 ? doc.length : null;
    const own = doc.subsequence(target);
    const a = wrap === null ? own : own + own.slice(0, Math.min(b.length, own.length - 1));
    analytics.track('align', 'run', mode);
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setProgress(null);
    setError(null);
    analysisClient
      .alignEitherStrand(a, b, { mode }, { onProgress: setProgress, signal: controller.signal })
      .then((best) => {
        const reverse = best.strand === 'reverse';
        // The reverse complement's qualities run the other way; so does its
        // numbering, which counts along the reverse complement of the whole read.
        const oriented =
          qualities === null ? null : reverse ? qualities.slice().reverse() : qualities;
        // Found wholly in the repeated start: the same alignment one turn back.
        const turn = wrap !== null && best.alignment.startA >= wrap ? wrap : 0;
        const alignment =
          turn === 0
            ? best.alignment
            : {
                ...best.alignment,
                startA: best.alignment.startA - turn,
                endA: best.alignment.endA - turn,
              };
        setResult({
          ...best,
          alignment,
          offset: target.start,
          wrap,
          offsetB: reverse ? full.length - kept.end : kept.start,
          lengthB: b.length,
          trimmed,
          qualities: oriented === null ? null : columnQualities(alignment, oriented),
        });
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
          setLoaded(null);
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
        {record?.qualities !== undefined && (
          <label
            className="toggle"
            title="Mott's algorithm: keep the stretch whose bases are mostly better than Q13 (5% error)"
          >
            <input
              type="checkbox"
              checked={trim}
              onChange={(e) => {
                setTrim(e.target.checked);
              }}
            />
            Trim poor ends
          </label>
        )}
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
              // Past the origin is fine (a wrapping range); round it more than once is not.
              const end = Math.min(
                result.offset + result.alignment.endA,
                start + (result.wrap ?? Number.POSITIVE_INFINITY),
              );
              if (end > start) {
                editorStore.setSelection({ start, end });
                editorStore.revealPosition(start);
              }
            }}
          >
            Select aligned region in this document
          </button>
          {result.trimmed !== null && (
            <p className="panel__note">
              {result.trimmed.start + result.trimmed.end === 0
                ? 'The read’s ends are of good quality; nothing was trimmed.'
                : `Trimmed ${result.trimmed.start.toLocaleString()} ${result.trimmed.start === 1 ? 'base' : 'bases'} from the start of the read and ${result.trimmed.end.toLocaleString()} from the end, where the quality falls off.`}
            </p>
          )}
          {result.qualities !== null && (
            <ReadSummary
              differences={readDifferences(result.alignment, result.qualities)}
              offset={result.offset}
              wrap={result.wrap}
              docName={doc.name}
            />
          )}
          <AlignmentBlocks
            alignment={result.alignment}
            offsetA={result.offset}
            offsetB={result.offsetB}
            wrap={result.wrap}
            qualities={result.qualities}
          />
        </div>
      )}
    </div>
  );
}
