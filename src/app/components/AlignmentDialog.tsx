import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { nextDifference, stackAlignments, type StackSample } from '../alignmentStack';
import { alignedRegionInDocument, type ReferenceInput } from '../readAlignment';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { AlignmentStackView } from './AlignmentStackView';

interface Props {
  /** What every sample was aligned to. */
  readonly reference: ReferenceInput;
  readonly referenceName: string;
  readonly samples: readonly StackSample[];
  /** Whether the document is the read and the reference the box's record (#57). */
  readonly documentIsRead: boolean;
  /** The sample to start on, an index into `samples`. */
  readonly initialRow?: number;
  readonly onClose: () => void;
}

/**
 * The alignment results in a window of their own (#103): the reference and
 * every sample stacked as rows under one scroll, with an overview of every
 * difference above. The sidebar's Align panel is too narrow for a plasmid
 * against a plasmid, or ninety-six reads at once.
 *
 * Esc closes it and focus goes back to where it was. Alt+N goes to the next
 * difference, with Shift the previous, as Next change does in the views.
 */
export function AlignmentDialog({
  reference,
  referenceName,
  samples,
  documentIsRead,
  initialRow,
  onClose,
}: Props) {
  const { readConfidentQuality } = useEditorState();
  const stack = useMemo(() => stackAlignments(reference, samples), [reference, samples]);
  const [selected, setSelected] = useState<number | null>(
    initialRow ?? (samples.length === 1 ? 0 : null),
  );
  const [focus, setFocus] = useState<{ column: number; nonce: number } | null>(null);
  const current = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      before?.focus();
    };
  }, []);

  const go = useCallback(
    (backwards: boolean): void => {
      const column = nextDifference(stack.differences, current.current, backwards);
      if (column === null) return;
      current.current = column;
      setFocus((f) => ({ column, nonce: (f?.nonce ?? 0) + 1 }));
    },
    [stack.differences],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        go(e.shiftKey);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, go]);

  const row = selected === null ? null : (stack.rows[selected] ?? null);
  const shown = row?.result.alignment ?? null;
  const reads =
    samples.length === 1 ? 'one sequence' : `${samples.length.toLocaleString()} sequences`;

  return createPortal(
    <div className="dialog-backdrop dialog-backdrop--full">
      <div
        className="dialog dialog--alignment"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alignment-title"
      >
        <div className="astack-head">
          <h2 id="alignment-title" className="dialog__title">
            Alignment of {reads} to {referenceName}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="button button--quiet button--small"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="astack-tools">
          <span className="astack-tools__note" aria-live="polite">
            {shown === null
              ? `${stack.differences.length.toLocaleString()} differing columns. Click a name to see its score.`
              : `${row?.name ?? ''}: ${shown.mode === 'global' ? 'global' : 'local'}, score ${shown.score}, identity ${Math.round(shown.identity * 100)}% over ${shown.columns.toLocaleString()} columns, ${shown.gaps} gap ${shown.gaps === 1 ? 'column' : 'columns'}${row?.result.strand === 'reverse' ? ', reverse complement' : ''}`}
          </span>
          <button
            type="button"
            className="button button--quiet button--small"
            disabled={stack.differences.length === 0}
            title="Alt+Shift+N"
            onClick={() => {
              go(true);
            }}
          >
            Previous difference
          </button>
          <button
            type="button"
            className="button button--quiet button--small"
            disabled={stack.differences.length === 0}
            title="Alt+N"
            onClick={() => {
              go(false);
            }}
          >
            Next difference
          </button>
          <button
            type="button"
            className="button button--quiet button--small"
            disabled={row === null}
            onClick={() => {
              if (row === null) return;
              const range = alignedRegionInDocument(row.result, documentIsRead);
              if (range !== null) {
                editorStore.setSelection(range);
                editorStore.revealPosition(range.start);
              }
            }}
          >
            Select aligned region in this document
          </button>
        </div>
        <AlignmentStackView
          stack={stack}
          referenceName={referenceName}
          confidentFrom={readConfidentQuality}
          selectedRow={selected}
          onSelectRow={setSelected}
          focus={focus}
        />
      </div>
    </div>,
    document.body,
  );
}
