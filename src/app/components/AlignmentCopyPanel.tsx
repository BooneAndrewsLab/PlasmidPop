import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  copiedSummaryNote,
  copyLimits,
  copyOutput,
  copySummary,
  effectiveOptions,
  largeCopyWarning,
  loadCopyOptions,
  optionsForSelection,
  previewLines,
  saveCopyOptions,
  type CopyContext,
  type CopyOptions,
} from '../alignmentCopy';
import { analytics } from '../analytics';
import type { ResidueFrame } from '../alignmentResidues';
import { REFERENCE_ROW, selectionColumns, type AlignmentSelection } from '../alignmentSelection';
import type { Stack } from '../alignmentStack';
import { copyText } from '../clipboard';
import { AlignmentPopover } from './AlignmentPopover';
import { SegmentedChoices } from './SegmentedChoices';

interface Props {
  readonly stack: Stack;
  readonly frames: readonly ResidueFrame[] | null;
  readonly referenceName: string;
  readonly selection: AlignmentSelection;
  /** Where the panel hangs from, in the `.astack`'s coordinates. */
  readonly left: number;
  readonly top: number;
  /** A copy was made: the line to show under the alignment. */
  readonly onCopied: (note: string) => void;
  readonly onClose: () => void;
}

/**
 * The Advanced copy panel (#366), opened from the bar beside a selection:
 * rows, columns, gaps, tracks, format and extras composed from options,
 * with a preview of what the clipboard gets. A choice the others rule out
 * is greyed with the reason, and the copy is what the preview shows. The
 * options are remembered per browser; the track opens on the strip the
 * selection is on. One of the `astack-pop` family, hung from the bar.
 */
export function AlignmentCopyPanel({
  stack,
  frames,
  referenceName,
  selection,
  left,
  top,
  onCopied,
  onClose,
}: Props) {
  const [options, setOptions] = useState<CopyOptions>(() =>
    optionsForSelection(loadCopyOptions(), selection),
  );
  const set = (patch: Partial<CopyOptions>): void => {
    setOptions((o) => {
      const next = { ...o, ...patch };
      saveCopyOptions(next);
      return next;
    });
  };
  const ctx = useMemo<CopyContext>(
    () => ({ stack, frames, referenceName, selection }),
    [stack, frames, referenceName, selection],
  );
  const limits = copyLimits(options, ctx);
  const effective = effectiveOptions(options, ctx);
  const output = useMemo(() => copyOutput(options, ctx), [options, ctx]);
  const preview = previewLines(output.text);
  const warning = largeCopyWarning(output);
  const selected = selectionColumns(stack, selection);
  const selectedColumns = selected === null ? 0 : selected.end - selected.start;
  const onReference = selection.row === REFERENCE_ROW;
  const fasta = effective.format === 'fasta';

  // Esc closes the panel and nothing else: the window's own Esc listens on
  // the document in the capture phase, so this one is on the window, which
  // the event reaches first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  // A press outside the panel and its bar closes it.
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest('.astack-pop--copy, .selection-bar') !== null
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  // Hung from the bar, and lifted by as much as it would pass the window's
  // foot, never above the alignment's top.
  const box = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  useLayoutEffect(() => {
    const el = box.current?.firstElementChild;
    if (!(el instanceof HTMLElement)) return;
    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 16);
    setLift(over > 0 ? Math.min(top, Math.ceil(over)) : 0);
    // The keyboard starts on the first choice made, not on the close button.
    (
      el.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      el.querySelector<HTMLElement>('button')
    )?.focus();
  }, [top]);

  const copy = (): void => {
    if (output.text === '') return;
    copyText(output.text);
    analytics.track('alignment-selection', 'copy', effective.format);
    onCopied(copiedSummaryNote(output, effective.format));
    onClose();
  };

  return (
    <div ref={box} className="astack-copy" style={{ left, top: top - lift }}>
      <AlignmentPopover
        title="Advanced copy"
        closeLabel="Close advanced copy"
        onClose={onClose}
        className="astack-pop--copy"
      >
        <div className="astack-pop__form">
          <span>Rows</span>
          <SegmentedChoices
            small
            label="Rows"
            value={effective.rows}
            choices={[
              {
                value: 'selected',
                label: onReference ? 'Reference' : 'This row',
                title: 'The row the selection is on',
              },
              {
                value: 'with-reference',
                label: 'With reference',
                title: 'The reference above the row, the two in register',
                disabled: limits.onReference,
                disabledTitle: 'The selection is on the reference',
              },
              {
                value: 'all',
                label: `All ${(stack.rows.length + 1).toLocaleString()}`,
                title: 'The reference and every sample shown, in register',
              },
            ]}
            onChange={(rows) => {
              set({ rows });
            }}
          />
          <span>Columns</span>
          <SegmentedChoices
            small
            label="Columns"
            value={effective.columns}
            choices={[
              {
                value: 'selection',
                label: `Selection (${selectedColumns.toLocaleString()})`,
                title: 'The selected columns',
              },
              {
                value: 'all',
                label: `All ${stack.columns.toLocaleString()}`,
                title: 'Every column of the alignment',
              },
            ]}
            onChange={(columns) => {
              set({ columns });
            }}
          />
          <span>Gaps</span>
          <SegmentedChoices
            small
            label="Gaps"
            value={effective.gaps}
            disabled={limits.gapsKept}
            disabledTitle="Several rows stay in register, so their gaps are kept"
            choices={[
              {
                value: 'kept',
                label: 'Kept as -',
                title: 'The row as drawn: gaps, and columns the sample does not reach, as -',
              },
              {
                value: 'dropped',
                label: 'Dropped',
                title: "The row's own residues only, as Ctrl+C",
              },
            ]}
            onChange={(gaps) => {
              set({ gaps });
            }}
          />
          <span>Tracks</span>
          <SegmentedChoices
            small
            label="Tracks"
            value={effective.tracks}
            disabled={limits.basesOnly}
            disabledTitle="Turn on Amino acids ▸ Residues to copy amino acids"
            choices={[
              { value: 'bases', label: 'Bases' },
              {
                value: 'aa',
                label: 'Amino acids',
                title: 'The amino acids of the codons the columns touch, one line per CDS',
              },
              { value: 'both', label: 'Both', title: 'Each row’s bases, then its amino acids' },
            ]}
            onChange={(tracks) => {
              set({ tracks });
            }}
          />
          <span>Format</span>
          <SegmentedChoices
            small
            label="Format"
            value={effective.format}
            choices={[
              { value: 'text', label: 'Text', title: 'One sequence per line' },
              { value: 'fasta', label: 'FASTA', title: 'A named record per sequence, 60 per line' },
            ]}
            onChange={(format) => {
              set({ format });
            }}
          />
          <span>Extras</span>
          <span className="astack-pop__chips">
            <label
              className="astack-pop__chip"
              data-tip={
                fasta
                  ? 'FASTA records are always named'
                  : 'Each line led by its name, in one padded column'
              }
            >
              <input
                type="checkbox"
                checked={fasta || effective.names}
                disabled={fasta}
                onChange={(e) => {
                  set({ names: e.target.checked });
                }}
              />
              Names
            </label>
            <label
              className="astack-pop__chip"
              data-tip="Which columns these are, and the reference positions they span"
            >
              <input
                type="checkbox"
                checked={effective.coordinates}
                onChange={(e) => {
                  set({ coordinates: e.target.checked });
                }}
              />
              Coordinates
            </label>
          </span>
        </div>
        <div className="astack-pop__section">
          <span className="astack-pop__subhead">Preview</span>
          <span className="astack-pop__status astack-copy__count">
            {output.text === '' ? '' : copySummary(output)}
          </span>
        </div>
        {output.text === '' ? (
          <p className="astack-copy__preview astack-copy__preview--empty">
            Nothing to copy: the row has no residues in these columns.
          </p>
        ) : (
          <pre className="astack-copy__preview" aria-label="Preview of the text to copy">
            {preview.lines.join('\n')}
            {preview.more > 0 && (
              <span className="astack-copy__more">
                {'\n'}… {preview.more.toLocaleString()} more {preview.more === 1 ? 'line' : 'lines'}
              </span>
            )}
          </pre>
        )}
        <div className="astack-pop__foot">
          <span className="astack-pop__status astack-copy__warn" aria-live="polite">
            {warning ?? ''}
          </span>
          <button
            type="button"
            className="button button--primary astack-pop__button"
            disabled={output.text === ''}
            onClick={copy}
          >
            Copy
          </button>
        </div>
      </AlignmentPopover>
    </div>
  );
}
