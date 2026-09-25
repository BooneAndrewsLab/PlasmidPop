import { analytics } from '../analytics';
import { type DragEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  type Alignment,
  type AlignmentMode,
  type Range,
  type ReadDifference,
  type SeqDocument,
  type SequencingRead,
  CONFIDENT_QUALITY_CHOICES,
  TRIM_CUTOFF_CHOICES,
  isEmptyRange,
  normalizeSequenceInput,
  qualityOfError,
  readDifferences,
} from '@/core';
import { parseSequenceFile, readSequenceData, writeFastaRecords } from '@/io';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { measureCharWidth } from '@/view/linear';

import { SEQUENCE_FILE_ACCEPT } from '../openFile';
import {
  type ReadAlignment,
  type ReferenceInput,
  alignedReferenceRange,
  finishReadAlignment,
  prepareReadAlignment,
  readRange,
} from '../readAlignment';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { BATCH_LIMIT, type BatchRow, runReadBatch } from '../readBatch';
import { AlignmentTrace } from './AlignmentTrace';
import { ReadBatchList } from './ReadBatchList';

interface Props {
  readonly doc: SeqDocument;
}

const BLOCK = 60;

interface SequenceRecord {
  readonly name: string;
  readonly sequence: string;
  /** Whether it is a circle, for a record that is the reference (#57). */
  readonly circular: boolean;
  /** Its qualities, and an AB1's trace, for a record read from a sequencing file. */
  readonly read?: SequencingRead;
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
        circular: d.isCircular,
      }));
      return { ok: true, records };
    }
    return {
      ok: true,
      records: [
        { name: 'Pasted sequence', sequence: normalizeSequenceInput(trimmed), circular: false },
      ],
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
    circular: d.isCircular,
    ...(d.read === null ? {} : { read: d.read }),
  }));
  return { text, records };
}

/** The read's quality class under a column: poor below the confident threshold. */
function qualityClass(q: number | undefined, confidentFrom: number): string {
  return q === undefined || q >= confidentFrom ? '' : 'alignment__q-low';
}

/**
 * The second sequence's line of a block, its poor bases (below the
 * confident threshold, Q20 unless set otherwise) marked when there are
 * qualities: runs of one class, so a block is a few spans.
 */
function ReadLine({
  bases,
  qualities,
  confidentFrom,
}: {
  bases: string;
  qualities: readonly number[] | null;
  confidentFrom: number;
}) {
  if (qualities === null) return <>{bases}</>;
  const runs: { text: string; cls: string }[] = [];
  for (let k = 0; k < bases.length; k++) {
    const cls = qualityClass(qualities[k], confidentFrom);
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

/** Characters before a block's first column: seven for the position and a space. */
const INDENT = 8;

function AlignmentBlocks({
  alignment,
  offsetA,
  offsetB,
  wrap,
  qualities,
  confidentFrom,
  trace,
  focus,
}: {
  alignment: Alignment;
  offsetA: number;
  offsetB: number;
  /** A circular document's length, when positions past its end go round again. */
  wrap: number | null;
  /** The read's quality under each column, or null without qualities. */
  qualities: readonly number[] | null;
  /** The quality a read base counts as confident from. */
  confidentFrom: number;
  /**
   * The read with its trace, turned the way it aligned and indexed as the
   * read's line is numbered, when there is a trace to draw under each block.
   */
  trace: SequencingRead | null;
  /** A column to bring into view and mark, with a nonce to do it again. */
  focus: { readonly column: number; readonly nonce: number } | null;
}) {
  const pre = useRef<HTMLPreElement>(null);
  const [charWidth, setCharWidth] = useState(7);
  useLayoutEffect(() => {
    const el = pre.current;
    if (el !== null) setCharWidth(measureCharWidth(getComputedStyle(el).font));
  }, []);
  useEffect(() => {
    if (focus === null) return;
    const block = pre.current?.children[Math.floor(focus.column / BLOCK)];
    // Guarded because jsdom, where the app's tests run, has no scrollIntoView.
    if (typeof block?.scrollIntoView === 'function') block.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const blocks: {
    a: string;
    m: string;
    b: string;
    posA: number;
    posB: number;
    at: number;
    bases: { index: number; column: number }[];
  }[] = [];
  let posA = alignment.startA + offsetA;
  let posB = alignment.startB + offsetB;
  for (let i = 0; i < alignment.columns; i += BLOCK) {
    const a = alignment.alignedA.slice(i, i + BLOCK);
    const b = alignment.alignedB.slice(i, i + BLOCK);
    const bases: { index: number; column: number }[] = [];
    let index = posB;
    for (let c = 0; c < b.length; c++) {
      if (b.charAt(c) !== '-') bases.push({ index: index++, column: c });
    }
    blocks.push({ a, m: alignment.matchLine.slice(i, i + BLOCK), b, posA, posB, at: i, bases });
    posA += a.replace(/-/g, '').length;
    posB = index;
  }
  const focusBlock = focus === null ? -1 : Math.floor(focus.column / BLOCK);
  return (
    <pre className="alignment" ref={pre}>
      {blocks.map((blk, k) => (
        <div
          key={`${blk.posA}-${blk.posB}`}
          className={`alignment__block${k === focusBlock ? ' alignment__block--focus' : ''}`}
        >
          {`${String((wrap === null ? blk.posA : blk.posA % wrap) + 1).padStart(7)} ${blk.a}\n${' '.repeat(INDENT)}${blk.m}\n${String(blk.posB + 1).padStart(7)} `}
          <ReadLine
            bases={blk.b}
            qualities={qualities === null ? null : qualities.slice(blk.at, blk.at + BLOCK)}
            confidentFrom={confidentFrom}
          />
          {'\n'}
          {trace !== null && blk.bases.length > 0 && (
            <AlignmentTrace
              read={trace}
              bases={blk.bases}
              columns={blk.b.length}
              indent={INDENT}
              charWidth={charWidth}
            />
          )}
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

/** Where a difference is in the document, to select it, and how the list names it. */
interface Located {
  readonly range: Range;
  readonly label: string;
}

/**
 * What the qualities say about the differences: how many sit on bases the
 * read was sure of (Q20+, or the threshold set, #56) and how many on poor
 * ones, with each confident one listed to be looked at in the document.
 * "Does my clone match" comes down to the first number.
 */
function ReadSummary({
  differences,
  confidentFrom,
  referenceName,
  locate,
  onPick,
}: {
  differences: readonly ReadDifference[];
  confidentFrom: number;
  referenceName: string;
  /** Where each difference is in the document, which is the reference or the read. */
  locate: (d: ReadDifference) => Located;
  /** Told the column of a difference picked, to show it in the alignment. */
  onPick: (column: number) => void;
}) {
  const confident = differences.filter((d) => d.confident);
  const poor = differences.length - confident.length;
  return (
    <div className="read-summary">
      <p className="panel__note">
        {differences.length === 0
          ? `No differences from ${referenceName} over the aligned stretch.`
          : `${confident.length === 0 ? 'No' : confident.length.toLocaleString()} ${confident.length === 1 ? 'difference' : 'differences'} at confident bases (Q${confidentFrom}+)${poor === 0 ? '' : `, ${poor.toLocaleString()} at poor ones, shaded in the read`}.`}
      </p>
      {confident.length > 0 && (
        <ul className="read-summary__list">
          {confident.slice(0, 50).map((d) => {
            const { range, label } = locate(d);
            return (
              <li key={d.column}>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={() => {
                    editorStore.setSelection(range);
                    editorStore.revealPosition(range.start);
                    onPick(d.column);
                  }}
                >
                  {label}, Q{d.quality}
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

/**
 * A difference located in the reference, which is the document: a base
 * the read lacks or has instead is that base, an extra base in the read the
 * point after the reference base it follows.
 */
function locateInReference(result: ReadAlignment, d: ReadDifference): Located {
  const raw = result.offset + d.positionA;
  const at = result.wrap === null ? raw : raw % result.wrap;
  const point = d.kind === 'insertion';
  return {
    range: { start: at, end: point ? at : at + 1 },
    label: `${KIND_LABEL[d.kind]} at ${(point ? at : at + 1).toLocaleString()}${point ? ' (after)' : ''}`,
  };
}

/**
 * A difference located in the read, which is the document (#57): the read
 * base at the column, or for a base the read lacks the point before the
 * read base it comes before, mirrored when the read aligned reversed; the
 * reference position is named beside it.
 */
function locateInRead(result: ReadAlignment, d: ReadDifference, referenceName: string): Located {
  const at = result.offsetB + d.positionB;
  const point = d.kind === 'deletion';
  const range = readRange(result, at, point ? at : at + 1);
  const raw = result.offset + d.positionA;
  const ref = (result.wrap === null ? raw : raw % result.wrap) + (d.kind === 'insertion' ? 0 : 1);
  return {
    range,
    label: `${KIND_LABEL[d.kind]} at ${(point ? range.start : range.start + 1).toLocaleString()}${point ? ' (after)' : ''} (${referenceName} ${ref.toLocaleString()}${d.kind === 'insertion' ? ', after' : ''})`,
  };
}

/** An error rate as a percentage for a label: 5%, 0.1%. */
function formatErrorRate(p: number): string {
  return `${String(Number((p * 100).toPrecision(2)))}%`;
}

/**
 * Where a read's bases count as confident and where its ends are trimmed
 * (#56), remembered with the view preferences: Q20 and 5% suit Sanger
 * reads, a nanopore consensus wants Q40, raw nanopore reads Q10.
 */
function QualitySettings({ trim }: { trim: boolean }) {
  const { readConfidentQuality, readTrimCutoff } = useEditorState();
  return (
    <div className="panel__controls">
      <label
        className="panel__field"
        title="A difference on a read base of at least this quality counts as confident; poorer bases are shaded. Q20 is one error in a hundred, Q30 one in a thousand."
      >
        <span>Confident from</span>
        <select
          className="panel__select"
          aria-label="Confident from"
          value={readConfidentQuality}
          onChange={(e) => {
            analytics.trackOnce('align', 'quality', 'confident');
            editorStore.setReadConfidentQuality(Number(e.target.value));
          }}
        >
          {CONFIDENT_QUALITY_CHOICES.map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
        </select>
      </label>
      <label
        className="panel__field"
        title="Trimming keeps the stretch whose bases are mostly better than this error rate"
      >
        <span>Trim at</span>
        <select
          className="panel__select"
          aria-label="Trim at"
          value={readTrimCutoff}
          disabled={!trim}
          onChange={(e) => {
            analytics.trackOnce('align', 'quality', 'trim');
            editorStore.setReadTrimCutoff(Number(e.target.value));
          }}
        >
          {TRIM_CUTOFF_CHOICES.map((p) => (
            <option key={p} value={p}>
              Q{qualityOfError(p)} ({formatErrorRate(p)} error)
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * One alignment as the Align tab shows it: the heading with its numbers,
 * a way to select what it covers, the trimming, the differences by
 * confidence and the blocks. Its own focus and trace toggle, so a new
 * result starts afresh.
 */
function AlignmentResult({
  result,
  docName,
  title,
}: {
  result: ShownAlignment;
  docName: string;
  /** Named in the heading, for a read picked from a batch. */
  title?: string;
}) {
  const { readConfidentQuality } = useEditorState();
  const [showTrace, setShowTrace] = useState(true);
  const [focus, setFocus] = useState<{ readonly column: number; readonly nonce: number } | null>(
    null,
  );
  const shownAs = result.docIsRead;
  const referenceName = shownAs === null ? docName : shownAs.referenceName;
  return (
    <div className="panel__section">
      <h3 className="panel__heading">
        {result.alignment.mode === 'global' ? 'Global alignment' : 'Local alignment'}
        {title === undefined ? '' : ` of ${title}`}
        <span className="panel__heading-note">
          score {result.alignment.score}, identity {Math.round(result.alignment.identity * 100)}%
          over {result.alignment.columns.toLocaleString()} columns, {result.alignment.gaps} gap{' '}
          {result.alignment.gaps === 1 ? 'column' : 'columns'}
          {result.strand === 'reverse'
            ? shownAs === null
              ? ', reverse complement of the pasted sequence'
              : ', reverse complement of this read'
            : ''}
        </span>
      </h3>
      <button
        type="button"
        className="button button--quiet button--small"
        onClick={() => {
          const range =
            shownAs === null
              ? alignedReferenceRange(result)
              : readRange(
                  result,
                  result.offsetB + result.alignment.startB,
                  result.offsetB + result.alignment.endB,
                );
          if (range !== null && range.end > range.start) {
            editorStore.setSelection(range);
            editorStore.revealPosition(range.start);
          }
        }}
      >
        Select aligned region in this document
      </button>
      {result.trace !== null && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={showTrace}
            onChange={(e) => {
              setShowTrace(e.target.checked);
            }}
          />
          Show the trace under the read
        </label>
      )}
      {result.trimmed !== null && (
        <p className="panel__note">
          {result.trimmed.start + result.trimmed.end === 0
            ? 'The read’s ends are of good quality; nothing was trimmed.'
            : `Trimmed ${result.trimmed.start.toLocaleString()} ${result.trimmed.start === 1 ? 'base' : 'bases'} from the start of the read and ${result.trimmed.end.toLocaleString()} from the end, where the quality falls off.`}
        </p>
      )}
      {result.qualities !== null && (
        <ReadSummary
          differences={readDifferences(result.alignment, result.qualities, readConfidentQuality)}
          confidentFrom={readConfidentQuality}
          referenceName={referenceName}
          locate={(d) =>
            shownAs === null
              ? locateInReference(result, d)
              : locateInRead(result, d, shownAs.referenceName)
          }
          onPick={(column) => {
            setFocus((f) => ({ column, nonce: (f?.nonce ?? 0) + 1 }));
          }}
        />
      )}
      <AlignmentBlocks
        alignment={result.alignment}
        offsetA={result.offset}
        offsetB={result.offsetB}
        wrap={result.wrap}
        qualities={result.qualities}
        confidentFrom={readConfidentQuality}
        trace={showTrace ? result.trace : null}
        focus={focus}
      />
    </div>
  );
}

/** An alignment on screen, and which of the two the document was. */
interface ShownAlignment extends ReadAlignment {
  /**
   * Set when the document was the read and the box's record the reference
   * (#57): the record's name, for the positions named beside the read's.
   */
  readonly docIsRead: { readonly referenceName: string } | null;
}

export function AlignPanel({ doc }: Props) {
  const { selection, readTrimCutoff, readConfidentQuality } = useEditorState();
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
  const [result, setResult] = useState<ShownAlignment | null>(null);
  /** Counts results, so each new one is drawn afresh (no focus, the trace shown). */
  const [resultKey, setResultKey] = useState(0);
  /** Whether a document that is itself a read is aligned as the read (#57). */
  const [docAsRead, setDocAsRead] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Every record aligned at once (#59): the rows so far, and how many were asked for. */
  const [batch, setBatch] = useState<{
    readonly rows: readonly BatchRow[];
    readonly total: number;
    readonly cancelled: boolean;
  } | null>(null);
  /** The file index of the batch row whose alignment is shown. */
  const [batchPicked, setBatchPicked] = useState<number | null>(null);

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
    setBatch(null);
  };

  const load = (file: File | undefined): void => {
    if (file === undefined) return;
    readFile(file)
      .then((read) => {
        setText(read.text);
        setLoaded(read);
        const withQualities = read.records.some((r) => r.read !== undefined);
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

  // The document is itself a read (an opened AB1 or FASTQ, still as it came
  // off the sequencer) and the box holds a plain sequence: the box is taken
  // as the reference and the document as the read, so its qualities and
  // trace are used (#57). A box that holds a read of its own keeps the usual
  // way round.
  const docRead = doc.read;
  const docIsRead = docRead !== null && record?.read === undefined && docAsRead;
  /** The qualities the alignment will use, if any: the record's or the document's. */
  const readInUse = docIsRead ? docRead : (record?.read ?? null);

  /** The document, or its selection, as the reference a read is aligned to. */
  const documentReference = (): ReferenceInput => {
    const target =
      useSelection && selection !== null && hasSelection
        ? selection
        : { start: 0, end: doc.length };
    // A read of a circular plasmid may run through its origin: a local
    // alignment is made against the sequence with its start repeated after
    // its end, far enough for the read to fit (#51).
    const whole = target.start === 0 && target.end === doc.length;
    const wrap = whole && doc.isCircular && mode === 'local' && doc.length > 1 ? doc.length : null;
    return { sequence: doc.subsequence(target), offset: target.start, wrap };
  };

  /** Starts a request to the worker that the Cancel button and leaving the tab can stop. */
  const begin = (): AbortController => {
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setProgress(null);
    setError(null);
    return controller;
  };
  const end = (controller: AbortController): void => {
    if (running.current === controller) running.current = null;
    setBusy(false);
    setProgress(null);
  };

  /**
   * Aligns every record against the document, one after another in the
   * worker, listing each as it is done (#59). The document is the
   * reference, whichever way round a single alignment would go.
   */
  const runAll = (): void => {
    if (records.length > BATCH_LIMIT) return;
    analytics.track('align', 'batch', mode);
    const reference = documentReference();
    const controller = begin();
    setProgress(0);
    setResult(null);
    setBatchPicked(null);
    setBatch({ rows: [], total: records.length, cancelled: false });
    runReadBatch(
      records.map((r) => ({ name: r.name, sequence: r.sequence, read: r.read ?? null })),
      reference,
      (a, b, options, long) => analysisClient.alignEitherStrand(a, b, options, long),
      {
        // Banded whatever the size: the same answers, three to five times sooner.
        options: { mode, fast: true },
        trimCutoff: trim ? readTrimCutoff : null,
        onRow: (row) => {
          setBatch((b) => (b === null ? b : { ...b, rows: [...b.rows, row] }));
        },
        onProgress: setProgress,
        signal: controller.signal,
      },
    )
      .then((outcome) => {
        setBatch((b) => (b === null ? b : { ...b, cancelled: outcome.cancelled }));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        end(controller);
      });
  };

  const run = (): void => {
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    if (record === undefined || record.sequence === '') {
      setError(
        docIsRead
          ? 'Paste the reference to align this read against.'
          : 'Paste the sequence to align against this document.',
      );
      return;
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
      reference = documentReference();
      // A read's unreliable ends are trimmed off before it is aligned (#50).
      prepared = prepareReadAlignment(
        reference,
        { sequence: record.sequence, read: record.read ?? null },
        trim ? readTrimCutoff : null,
      );
    }
    if (!prepared.ok) {
      setError(prepared.message);
      return;
    }
    const { job } = prepared;
    const shownAs = docIsRead ? { referenceName: record.name } : null;
    analytics.track('align', 'run', mode);
    if (docIsRead) analytics.trackOnce('align', 'document-read');
    const controller = begin();
    setBatch(null);
    analysisClient
      .alignEitherStrand(
        job.a,
        job.b,
        { mode },
        {
          onProgress: setProgress,
          signal: controller.signal,
        },
      )
      .then((best) => {
        setResultKey((k) => k + 1);
        setResult({ ...finishReadAlignment(job, best), docIsRead: shownAs });
      })
      .catch((e: unknown) => {
        if (e instanceof AnalysisCancelledError) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        end(controller);
      });
  };

  const anyReads = readInUse !== null || records.some((r) => r.read !== undefined);
  const batchPickedRow =
    batch === null || batchPicked === null
      ? undefined
      : batch.rows.find((r) => r.index === batchPicked);

  return (
    <div className="panel">
      <p className="panel__note">
        {docIsRead
          ? `${doc.name} is a read: it is aligned to the sequence in the box, as the reference, with its own qualities${docRead.trace === null ? '' : ' and trace'}. Whichever orientation of it aligns better is shown.`
          : `Align another sequence to ${useSelection && hasSelection ? 'the selection' : doc.name}. Whichever orientation of it aligns better is shown.`}
      </p>
      {docRead !== null && record?.read === undefined && (
        <label
          className="toggle"
          title="Untick to align the box's sequence to this document instead, as to any other; the read's qualities are then not used"
        >
          <input
            type="checkbox"
            checked={docAsRead}
            onChange={(e) => {
              setDocAsRead(e.target.checked);
            }}
          />
          This document is the read
        </label>
      )}
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
            records.length > BATCH_LIMIT
              ? `${records.length.toLocaleString()} records; the one chosen is aligned. Align all takes at most ${BATCH_LIMIT} at a time (a plate): split the file to align them all.`
              : records.length > 1
                ? `${records.length} records; the one chosen is aligned, or Align all aligns each of them.`
                : null,
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
        {anyReads && (
          <label
            className="toggle"
            title={`Mott's algorithm: keep the stretch whose bases are mostly better than Q${qualityOfError(readTrimCutoff)} (${formatErrorRate(readTrimCutoff)} error)`}
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
            checked={useSelection && hasSelection && !docIsRead}
            disabled={!hasSelection || docIsRead}
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
          {busy && batch === null ? 'Aligning…' : 'Align'}
        </button>
        {records.length > 1 && (
          <button
            type="button"
            className="button button--small"
            disabled={busy || records.length > BATCH_LIMIT}
            title={
              records.length > BATCH_LIMIT
                ? `At most ${BATCH_LIMIT} records are aligned at once`
                : 'Align every record against this document, one after another, and list them'
            }
            onClick={runAll}
          >
            {busy && batch !== null ? 'Aligning all…' : 'Align all'}
          </button>
        )}
      </div>
      {anyReads && <QualitySettings trim={trim} />}
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
            {batch === null
              ? `${Math.floor(progress * 100)}%`
              : `${batch.rows.length} of ${batch.total}`}
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
      {batch !== null && (batch.rows.length > 0 || !busy) && (
        <div className="panel__section">
          <h3 className="panel__heading">
            {batch.total} reads
            <span className="panel__heading-note">
              {batch.cancelled
                ? `cancelled after ${batch.rows.length}`
                : batch.rows.length < batch.total
                  ? `${batch.rows.length} aligned so far`
                  : `against ${useSelection && hasSelection ? 'the selection' : doc.name}`}
              {batch.rows.some((r) => r.status === 'failed')
                ? `, ${batch.rows.filter((r) => r.status === 'failed').length} could not be aligned`
                : ''}
            </span>
          </h3>
          <ReadBatchList
            rows={batch.rows}
            confidentFrom={readConfidentQuality}
            selected={batchPicked}
            onSelect={setBatchPicked}
          />
          {batchPickedRow?.status === 'aligned' && (
            <AlignmentResult
              key={`batch-${String(batchPickedRow.index)}`}
              result={{ ...batchPickedRow.result, docIsRead: null }}
              docName={doc.name}
              title={batchPickedRow.name}
            />
          )}
        </div>
      )}
      {result !== null && <AlignmentResult key={resultKey} result={result} docName={doc.name} />}
    </div>
  );
}
