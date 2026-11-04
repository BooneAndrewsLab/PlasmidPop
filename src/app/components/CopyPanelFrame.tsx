import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { copySummary, largeCopyWarning, previewLines, type CopyOutput } from '../alignmentCopy';
import { AlignmentPopover } from './AlignmentPopover';

interface Props {
  /** Where the panel hangs from, in the positioned parent's coordinates. */
  readonly left: number;
  readonly top: number;
  /** What a copy would put on the clipboard, for the preview and the foot. */
  readonly output: CopyOutput;
  /** Why the preview is empty, as "the row has no residues in these columns". */
  readonly emptyReason: string;
  /** The choices (an `astack-pop__form`'s rows). */
  readonly children: ReactNode;
  readonly onCopy: () => void;
  readonly onClose: () => void;
}

/**
 * The shell of an Advanced copy panel, shared by the large view's (#366) and
 * the multiple alignment's (#368): the popover hung from the bar, Esc and a
 * press outside to close it, lifting itself off the window's foot, then the
 * preview with its counts, the large-copy warning and the Copy button. The
 * choices are the caller's, as they differ with the data.
 */
export function CopyPanelFrame({
  left,
  top,
  output,
  emptyReason,
  children,
  onCopy,
  onClose,
}: Props) {
  const preview = previewLines(output.text);
  const warning = largeCopyWarning(output);

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

  return (
    <div ref={box} className="astack-copy" style={{ left, top: top - lift }}>
      <AlignmentPopover
        title="Advanced copy"
        closeLabel="Close advanced copy"
        onClose={onClose}
        className="astack-pop--copy"
      >
        <div className="astack-pop__form">{children}</div>
        <div className="astack-pop__section">
          <span className="astack-pop__subhead">Preview</span>
          <span className="astack-pop__status astack-copy__count">
            {output.text === '' ? '' : copySummary(output)}
          </span>
        </div>
        {output.text === '' ? (
          <p className="astack-copy__preview astack-copy__preview--empty">
            Nothing to copy: {emptyReason}.
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
            onClick={onCopy}
          >
            Copy
          </button>
        </div>
      </AlignmentPopover>
    </div>
  );
}

/** The Names and Coordinates chips of a copy panel's Extras row. */
export function CopyExtras({
  fasta,
  names,
  coordinates,
  coordinatesTip,
  onNames,
  onCoordinates,
}: {
  readonly fasta: boolean;
  readonly names: boolean;
  readonly coordinates: boolean;
  readonly coordinatesTip: string;
  readonly onNames: (on: boolean) => void;
  readonly onCoordinates: (on: boolean) => void;
}) {
  return (
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
          checked={fasta || names}
          disabled={fasta}
          onChange={(e) => {
            onNames(e.target.checked);
          }}
        />
        Names
      </label>
      <label className="astack-pop__chip" data-tip={coordinatesTip}>
        <input
          type="checkbox"
          checked={coordinates}
          onChange={(e) => {
            onCoordinates(e.target.checked);
          }}
        />
        Coordinates
      </label>
    </span>
  );
}
