import { analytics } from '../analytics';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  type AlignmentMode,
  type Alphabet,
  type Feature,
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
  unitName,
} from '@/core';
import { parseSequenceFile, readSequenceData, writeFastaRecords } from '@/io';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { SEQUENCE_FILE_ACCEPT } from '../openFile';
import {
  type ReadAlignment,
  type ReferenceInput,
  alignedRegionInDocument,
  alignedRegionSpan,
  finishReadAlignment,
  prepareReadAlignment,
  readRange,
  suggestAlignMode,
} from '../readAlignment';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { BATCH_LIMIT, type BatchRow, runReadBatch } from '../readBatch';
import type { StackSample } from '../alignmentStack';
import type { SampleFeatures } from '../alignmentSampleTrack';
import { AlignmentDialog } from './AlignmentDialog';
import { useAlignedRegionPointer } from './useAlignedRegionPointer';
import { ReadBatchList } from './ReadBatchList';

interface Props {
  readonly doc: SeqDocument;
}

interface SequenceRecord {
  readonly name: string;
  readonly sequence: string;
  /** Whether it is a circle, for a record that is the reference (#57). */
  readonly circular: boolean;
  /** Its qualities, and an AB1's trace, for a record read from a sequencing file. */
  readonly read?: SequencingRead;
  /** The file it came from, when several files were loaded together (#106). */
  readonly file?: string;
  /** Its own features, for a GenBank or SnapGene record or an open tab (#128). */
  readonly features?: readonly Feature[];
}

/** A record's own features, kept only when it has some (#128). */
function featuresOf(d: SeqDocument): { readonly features?: readonly Feature[] } {
  const all = d.features.all();
  return all.length === 0 ? {} : { features: all };
}

/** What a sample brings to the large view's rows (#128), from the record it was aligned as. */
function sampleFeaturesOf(r: SequenceRecord): { readonly features?: SampleFeatures } {
  return r.features === undefined
    ? {}
    : { features: { features: r.features, circular: r.circular } };
}

type Records =
  | { readonly ok: true; readonly records: readonly SequenceRecord[] }
  | { readonly ok: false; readonly message: string };

/**
 * The records in whatever the user pasted or dropped: raw bases (one
 * record), or every record of a FASTA or GenBank text (#46).
 */
function readRecords(text: string, alphabet: Alphabet = 'nucleotide'): Records {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, records: [] };
  try {
    if (trimmed.startsWith('>') || trimmed.startsWith('LOCUS')) {
      const records = parseSequenceFile(trimmed).documents.map((d) => ({
        name: d.name,
        sequence: d.sequence.toString(),
        circular: d.isCircular,
        ...featuresOf(d),
      }));
      return { ok: true, records };
    }
    return {
      ok: true,
      records: [
        {
          name: 'Pasted sequence',
          // In front of a protein, pasted letters are residues (#95).
          sequence: normalizeSequenceInput(trimmed, alphabet),
          circular: false,
        },
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
  /**
   * What the reader warned about, such as a FASTQ in the old Phred + 64
   * encoding (#146): the qualities weigh each difference, so a note under
   * the box says so rather than the warning being dropped.
   */
  readonly warnings?: readonly string[];
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
    ...featuresOf(d),
  }));
  return { text, records, warnings: parsed.warnings.map((w) => w.message) };
}

/** The reader's warnings about a loaded file, as sentences after the note. */
function warned(read: LoadedFile, fileName?: string): string {
  return (read.warnings ?? [])
    .map((w) => ` ${fileName === undefined ? '' : `${fileName}: `}${w}.`)
    .join('');
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
}: {
  differences: readonly ReadDifference[];
  confidentFrom: number;
  referenceName: string;
  /** Where each difference is in the document, which is the reference or the read. */
  locate: (d: ReadDifference) => Located;
}) {
  const confident = differences.filter((d) => d.confident);
  const poor = differences.length - confident.length;
  return (
    <div className="read-summary">
      <p className="panel__note">
        {differences.length === 0
          ? `No differences from ${referenceName} over the aligned stretch.`
          : `${confident.length === 0 ? 'No' : confident.length.toLocaleString()} ${confident.length === 1 ? 'difference' : 'differences'} at confident bases (Q${confidentFrom}+)${poor === 0 ? '' : `, ${poor.toLocaleString()} at poor ones`}.`}
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
 * confidence, and the Large view, which is where the alignment itself is
 * read.
 */
function AlignmentResult({
  result,
  docName,
  docLength,
  onOpenLarge,
}: {
  result: ShownAlignment;
  docName: string;
  /** For drawing the region in the document's views. */
  docLength: number;
  /** Opens the alignment in the large view. */
  onOpenLarge: () => void;
}) {
  const { readConfidentQuality } = useEditorState();
  const shownAs = result.docIsRead;
  const referenceName = shownAs === null ? docName : shownAs.referenceName;
  const pointing = useAlignedRegionPointer(result, shownAs !== null, docLength);
  return (
    <div className="panel__section">
      <h3 className="panel__heading">
        <button
          type="button"
          className="panel__heading-pick"
          title="Show in document: hover to see the aligned region, click to select it"
          {...pointing.handlers}
          onClick={pointing.select}
        >
          {result.alignment.mode === 'global' ? 'Global alignment' : 'Local alignment'}
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
        </button>
      </h3>
      <button
        type="button"
        className="button button--primary button--small"
        title="Show the alignment in a window of its own, wide enough to read along a long sequence"
        onClick={onOpenLarge}
      >
        Large view
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
          differences={readDifferences(result.alignment, result.qualities, readConfidentQuality)}
          confidentFrom={readConfidentQuality}
          referenceName={referenceName}
          locate={(d) =>
            shownAs === null
              ? locateInReference(result, d)
              : locateInRead(result, d, shownAs.referenceName)
          }
        />
      )}
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
  /** What it was aligned to, for the large view (#103). */
  readonly reference: ReferenceInput;
  /** The sample's own features for its row in the large view (#128): the record's, or the document's when it is the read. */
  readonly sampleFeatures: { readonly features?: SampleFeatures };
}

export function AlignPanel({ doc }: Props) {
  const {
    selection,
    readTrimCutoff,
    readConfidentQuality,
    documents: openTabs,
    documentId,
  } = useEditorState();
  const [other, setOther] = useState('');
  const [picked, setPicked] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [trim, setTrim] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * The mode picked by hand, kept while the panel is open whatever the box
   * then holds; null until then, for the one `suggestAlignMode` gives (#86).
   */
  const [pickedMode, setPickedMode] = useState<AlignmentMode | null>(null);
  const [useSelection, setUseSelection] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Fraction of the running alignment done; null until it first reports. */
  const [progress, setProgress] = useState<number | null>(null);
  const running = useRef<AbortController | null>(null);
  const [result, setResult] = useState<ShownAlignment | null>(null);
  /** Counts results, so each new one is drawn afresh (no focus, the trace shown). */
  const [resultKey, setResultKey] = useState(0);
  /** The options the result on screen was aligned with; a change of either marks it stale (#117). */
  const [alignedWith, setAlignedWith] = useState<string | null>(null);
  /** Whether a document that is itself a read is aligned as the read (#57). */
  const [docAsRead, setDocAsRead] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Every record aligned at once (#59): the rows so far, and how many were asked for. */
  const [batch, setBatch] = useState<{
    readonly rows: readonly BatchRow[];
    readonly total: number;
    readonly cancelled: boolean;
    readonly reference: ReferenceInput;
    /** Each record's own features, by its index, for the large view's rows (#128). */
    readonly features: readonly { readonly features?: SampleFeatures }[];
  } | null>(null);
  /** The file index of the batch row whose alignment is shown. */
  const [batchPicked, setBatchPicked] = useState<number | null>(null);
  /** The large view (#103): the rows it stacks, and the one to start on. */
  const [large, setLarge] = useState<{
    readonly reference: ReferenceInput;
    readonly referenceName: string;
    readonly documentIsRead: boolean;
    readonly document: SeqDocument | null;
    readonly samples: readonly StackSample[];
    readonly initialRow?: number;
  } | null>(null);

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
        : readRecords(other, doc.alphabet),
    [loaded, other, doc.alphabet],
  );
  const records = parsed.ok ? parsed.records : [];
  /** "All records" chosen in the picker: the one button then aligns each of them. */
  const all = picked === -1 && records.length > 1 && records.length <= BATCH_LIMIT;
  const record = records[all ? 0 : Math.min(Math.max(picked, 0), records.length - 1)];
  /** Records from more than one file, each named with its file in the batch. */
  const several = new Set(records.map((r) => r.file)).size > 1;

  // The other open tabs of the same alphabet, to align against (#105).
  const otherTabs = useMemo(
    () =>
      openTabs.filter(
        (t) => t.documentId !== documentId && t.history.present.alphabet === doc.alphabet,
      ),
    [openTabs, documentId, doc.alphabet],
  );

  /** Takes a tab's current sequence, unsaved edits and read included, as the sample. */
  const loadTab = (id: string): void => {
    const tab = otherTabs.find((t) => t.documentId === id);
    if (tab === undefined) return;
    const d = tab.history.present;
    const record: SequenceRecord = {
      name: d.name,
      sequence: d.sequence.toString(),
      circular: d.isCircular,
      ...(d.read === null ? {} : { read: d.read }),
      ...featuresOf(d),
    };
    setText(writeFastaRecords([d]));
    setLoaded({ text: writeFastaRecords([d]), records: [record] });
    setFileNote(`From the open tab ${d.name}${d.read === null ? '' : ', with base qualities'}.`);
  };

  /**
   * The input changed, so what was aligned no longer belongs to it (#117):
   * stop a running alignment and drop the result or the batch.
   */
  const clearResults = (): void => {
    running.current?.abort();
    setResult(null);
    setBatch(null);
    setBatchPicked(null);
  };
  const setText = (text: string): void => {
    clearResults();
    setOther(text);
    setPicked(0);
    setError(null);
    setBatch(null);
  };

  const load = (files: readonly File[]): void => {
    if (files.length === 0) return;
    // Every file is read; one that cannot be is named and the rest are kept.
    Promise.all(
      files.map((file) =>
        readFile(file).then(
          (read) => ({ file, read }),
          (e: unknown) => ({
            file,
            failure: `Could not read "${file.name}": ${e instanceof Error ? e.message : String(e)}`,
          }),
        ),
      ),
    )
      .then((results) => {
        const good = results.flatMap((r) => ('read' in r ? [{ file: r.file, read: r.read }] : []));
        const failures = results.flatMap((r) => ('failure' in r ? [r.failure] : []));
        if (good.length === 0) {
          setError(failures.join(' '));
          return;
        }
        const [only] = good;
        if (good.length === 1 && only !== undefined) {
          setText(only.read.text);
          setLoaded(only.read);
          const withQualities = only.read.records.some((r) => r.read !== undefined);
          setFileNote(
            `From ${only.file.name}${withQualities ? ', with base qualities' : ''}.` +
              warned(only.read),
          );
        } else {
          // Several files: their records are the samples, file order then record
          // order. The box is emptied; its text would be unwieldy (AB1 especially).
          const records = good.flatMap((g) =>
            g.read.records.map((r) => ({ ...r, file: g.file.name })),
          );
          setText('');
          setLoaded({ text: '', records });
          // Several files are a batch: align them all unless one is picked.
          setPicked(-1);
          setFileNote(
            `${good.length} files, ${records.length} ${records.length === 1 ? 'record' : 'records'}.` +
              good.map((g) => warned(g.read, g.file.name)).join(''),
          );
        }
        if (failures.length > 0) setError(failures.join(' '));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
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

  // The document is itself a read (an opened AB1 or FASTQ, still as it came
  // off the sequencer) and the box holds a plain sequence: the box is taken
  // as the reference and the document as the read, so its qualities and
  // trace are used (#57). A box that holds a read of its own keeps the usual
  // way round.
  const docRead = doc.read;
  const docIsRead = docRead !== null && record?.read === undefined && docAsRead;
  /** The qualities the alignment will use, if any: the record's or the document's. */
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
    setAlignedWith(optionsKey);
    analytics.track('align', 'batch', pickedMode ?? 'auto');
    // Wrapping for the reads aligned locally; runReadBatch drops it for the rest.
    const reference = documentReference(true);
    const controller = begin();
    setProgress(0);
    setResult(null);
    setBatchPicked(null);
    setBatch({
      rows: [],
      total: records.length,
      cancelled: false,
      reference,
      features: records.map(sampleFeaturesOf),
    });
    runReadBatch(
      records.map((r) => ({
        name: several ? `${r.name} (${r.file ?? ''})` : r.name,
        sequence: r.sequence,
        read: r.read ?? null,
      })),
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
      reference = documentReference(mode === 'local');
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
    setAlignedWith(optionsKey);
    const controller = begin();
    setBatch(null);
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
        {
          onProgress: setProgress,
          signal: controller.signal,
        },
      )
      .then((best) => {
        setResultKey((k) => k + 1);
        setResult({
          ...finishReadAlignment(job, best),
          docIsRead: shownAs,
          reference,
          sampleFeatures,
        });
      })
      .catch((e: unknown) => {
        if (e instanceof AnalysisCancelledError) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        end(controller);
      });
  };

  /** Every read aligned so far in the large view, starting on `index` when one is picked. */
  const openBatchLarge = (index: number | undefined): void => {
    if (batch === null) return;
    const aligned = batch.rows.flatMap((r) => (r.status === 'aligned' ? [r] : []));
    setLarge({
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
    });
  };

  // The batch row under the pointer or focus: its region is pointed at in the views (#108).
  const [pointedRow, setPointedRow] = useState<number | null>(null);
  const pointedSpan = useMemo(() => {
    if (batch === null || pointedRow === null) return null;
    const row = batch.rows.find((r) => r.index === pointedRow);
    return row?.status === 'aligned' ? alignedRegionSpan(row.result, false, doc.length) : null;
  }, [batch, pointedRow, doc.length]);
  useEffect(() => {
    if (pointedSpan === null) return;
    editorStore.setPreview('align', [pointedSpan]);
    return () => {
      editorStore.clearPreview('align');
    };
  }, [pointedSpan]);
  /** Picking a batch row shows its alignment and selects the region it covers. */
  const pickBatchRow = (index: number): void => {
    setBatchPicked(index);
    setPointedRow(null);
    const row = batch?.rows.find((r) => r.index === index);
    if (row?.status !== 'aligned') return;
    const range = alignedRegionInDocument(row.result, false);
    if (range !== null) {
      editorStore.setSelection(range);
      editorStore.revealPosition(range.start);
    }
  };

  const anyReads = readInUse !== null || records.some((r) => r.read !== undefined);
  const stale = (result !== null || batch !== null) && alignedWith !== optionsKey;
  /** The batch's list is shown once a read is in it, or when the batch has ended with none. */
  const showBatch = batch !== null && (batch.rows.length > 0 || !busy);
  const batchPickedRow =
    batch === null || batchPicked === null
      ? undefined
      : batch.rows.find((r) => r.index === batchPicked);

  return (
    <div className="panel">
      <p className="panel__note">
        {docIsRead
          ? `${doc.name} is a read: it is aligned to the sequence in the box, as the reference, with its own qualities${docRead.trace === null ? '' : ' and trace'}. Whichever orientation of it aligns better is shown.`
          : `Align sequences to ${useSelection && hasSelection ? 'the selection' : doc.name}. Paste one below, or choose or drop files. Pick several at once to align them all together; a new pick replaces the ones loaded. Whichever orientation of each aligns better is shown.`}
      </p>
      <textarea
        className={`panel__textarea${dragging ? ' panel__textarea--over' : ''}`}
        rows={5}
        spellCheck={false}
        placeholder={`Paste ${unitName(doc.alphabet, true)}, FASTA or GenBank, or drop one or more files here`}
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
          multiple
          hidden
          onChange={(e) => {
            load(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        {otherTabs.length > 0 && (
          <label className="panel__field panel__field--row">
            <select
              className="panel__select"
              aria-label="Open tab to align"
              value=""
              onChange={(e) => {
                loadTab(e.target.value);
              }}
            >
              <option value="">Open tab…</option>
              {otherTabs.map((t) => (
                <option key={t.documentId} value={t.documentId}>
                  {t.history.present.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {records.length > 1 && (
          <label className="panel__field panel__field--row">
            <select
              className="panel__select"
              aria-label="Record to align"
              value={all ? -1 : Math.min(Math.max(picked, 0), records.length - 1)}
              onChange={(e) => {
                clearResults();
                setPicked(Number(e.target.value));
              }}
            >
              {records.length <= BATCH_LIMIT && (
                <option value={-1}>All {records.length.toLocaleString()} records</option>
              )}
              {records.map((r, i) => (
                <option key={i} value={i}>
                  {several ? `${r.name} (${r.file ?? ''})` : r.name} (
                  {r.sequence.length.toLocaleString()} bp)
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
              ? `${records.length.toLocaleString()} records; the one chosen is aligned. Aligning all takes at most ${BATCH_LIMIT} at a time (a plate): split the file to align them all.`
              : records.length > 1
                ? `${records.length} records; the one chosen is aligned, or choose All records to align each of them.`
                : null,
          ]
            .filter((t) => t !== null)
            .join(' ')}
        </p>
      )}
      <div className="panel__controls align-run">
        <button
          type="button"
          className="button button--small"
          disabled={busy || (!all && other.trim() === '' && record === undefined)}
          title={
            all
              ? 'Align every record against this document, one after another, and list them'
              : undefined
          }
          onClick={all ? runAll : run}
        >
          {busy ? (all ? 'Aligning all…' : 'Aligning…') : all ? 'Align all' : 'Align'}
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
      <fieldset className="panel__group">
        <legend>Options</legend>
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
        <div className="panel__controls">
          <label className="panel__field panel__field--row">
            <span>Mode</span>
            <select
              className="panel__select"
              aria-label="Alignment mode"
              value={mode}
              onChange={(e) => {
                setPickedMode(e.target.value as AlignmentMode);
              }}
            >
              <option value="global">Global (end to end)</option>
              <option value="local">Local (best region)</option>
            </select>
          </label>
          <label
            className="toggle"
            title={
              docIsRead
                ? 'Not used: the whole read is aligned'
                : hasSelection
                  ? undefined
                  : 'Select part of the document first'
            }
          >
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
        </div>
        {pickedMode === null && suggested.reason !== null && (
          <p className="panel__note">
            {`Local, since ${docIsRead ? 'this document' : 'the sequence in the box'} is ${suggested.reason}: Global would score it across the whole of the other. Choose Global to align end to end anyway.`}
            {records.length > 1 ? ' Aligning all chooses for each record the same way.' : ''}
          </p>
        )}
      </fieldset>
      {anyReads && (
        <fieldset className="panel__group">
          <legend>Reads</legend>
          <div className="panel__controls">
            {
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
            }
          </div>
          <QualitySettings trim={trim} />
        </fieldset>
      )}
      {(showBatch || result !== null) && (
        <fieldset
          className={`panel__group align-results${stale ? ' align-results--stale' : ''}`}
          disabled={stale}
        >
          <legend>{showBatch ? 'Results' : 'Result'}</legend>
          {stale && (
            <p className="panel__note align-stale-note" role="status">
              Input changed, align again.
            </p>
          )}
          {showBatch && (
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
              {batch.rows.some((r) => r.status === 'aligned') && (
                <button
                  type="button"
                  className="button button--primary button--small"
                  title="Show every aligned read at once, stacked under the document, in a window of its own; the read picked in the list is the one selected there"
                  onClick={() => {
                    openBatchLarge(
                      batchPickedRow?.status === 'aligned' ? batchPickedRow.index : undefined,
                    );
                  }}
                >
                  Large view of all
                </button>
              )}
              <ReadBatchList
                rows={batch.rows}
                confidentFrom={readConfidentQuality}
                selected={batchPicked}
                onSelect={pickBatchRow}
                onPoint={setPointedRow}
              />
            </div>
          )}
          {result !== null && (
            <AlignmentResult
              key={resultKey}
              result={result}
              docName={doc.name}
              docLength={doc.length}
              onOpenLarge={() => {
                setLarge({
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
                });
              }}
            />
          )}
        </fieldset>
      )}
      {large !== null && (
        <AlignmentDialog
          {...large}
          onClose={() => {
            setLarge(null);
          }}
        />
      )}
    </div>
  );
}
