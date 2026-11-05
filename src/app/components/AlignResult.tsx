import {
  type Range,
  type ReadDifference,
  CONFIDENT_QUALITY_CHOICES,
  TRIM_CUTOFF_CHOICES,
  qualityOfError,
  readDifferences,
} from '@/core';

import type { ShownAlignment } from '../alignSession';
import { alignmentKind, alignmentNumbers, differencesLine, formatErrorRate } from '../alignSummary';
import { analytics } from '../analytics';
import { type ReadAlignment, readRange } from '../readAlignment';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { useAlignedRegionPointer } from './useAlignedRegionPointer';

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
 * What the qualities say about the differences (#56): the count line, with
 * each confident one listed to be looked at in the document.
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
  return (
    <div className="read-summary">
      <p className="panel__note">{differencesLine(differences, confidentFrom, referenceName)}</p>
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

/**
 * Where a read's bases count as confident and where its ends are trimmed
 * (#56), remembered with the view preferences: Q20 and 5% suit Sanger
 * reads, a nanopore consensus wants Q40, raw nanopore reads Q10.
 */
export function QualitySettings({ trim }: { trim: boolean }) {
  const { readConfidentQuality, readTrimCutoff } = useEditorState();
  return (
    <div className="panel__controls">
      <label
        className="panel__field"
        data-tip="A difference on a read base of at least this quality counts as confident; poorer bases are shaded. Q20 is one error in a hundred, Q30 one in a thousand."
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
        data-tip="Trimming keeps the stretch whose bases are mostly better than this error rate"
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
 * One alignment as the Results page shows it: the heading with its numbers,
 * a way to select what it covers, the trimming, the differences by
 * confidence, and the Large view, which is where the alignment itself is
 * read.
 */
export function AlignmentResult({
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
          data-tip="Show in document: hover to see the aligned region, click to select it"
          {...pointing.handlers}
          onClick={pointing.select}
        >
          {alignmentKind(result)}
          <span className="panel__heading-note">{alignmentNumbers(result)}</span>
        </button>
      </h3>
      <button
        type="button"
        className="button button--primary button--small"
        data-tip="Show the alignment in a window of its own, wide enough to read along a long sequence"
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
