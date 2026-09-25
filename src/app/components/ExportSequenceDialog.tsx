import { useEffect, useState } from 'react';

import { type Range, type SeqDocument, isEmptyRange } from '@/core';
import {
  type LinearExportOptions,
  MAX_EXPORT_BASES_PER_ROW,
  MIN_EXPORT_BASES_PER_ROW,
  countLinearSvgPages,
  exportLinearSvg,
  exportLinearSvgPages,
} from '@/view/svg';

import { analytics } from '../analytics';
import { downloadText } from '../saveFile';
import {
  type ExportRangeKind,
  MAX_EXPORT_PAGES,
  downloadPages,
  rangeBoxes,
  readBasesPerRow,
  readExportRange,
} from '../sequenceExport';

interface Props {
  readonly doc: SeqDocument;
  readonly selection: Range | null;
  /** The view's own bases per row, or null when it fits the window. */
  readonly basesPerRow: number | null;
  /** Everything else the export follows from the view: format, cut sites, edit marks. */
  readonly format: Omit<LinearExportOptions, 'range' | 'basesPerRow' | 'selection'>;
  /** The file name the downloads start from, without extension. */
  readonly stem: string;
  readonly onClose: () => void;
  /** Where a file goes; the browser's download unless a test says otherwise. */
  readonly download?: (name: string, text: string) => void;
}

/**
 * Export sequence view as SVG (#30): which bases, how many to a row, and
 * whether on A4 pages. The picture is drawn by the same renderer as the
 * view, so only these three things are asked; the rest follows the view.
 */
export function ExportSequenceDialog({
  doc,
  selection,
  basesPerRow,
  format,
  stem,
  onClose,
  download = downloadText,
}: Props) {
  const selected = selection !== null && !isEmptyRange(selection) ? selection : null;
  const hasSelection = selected !== null;
  const [kind, setKind] = useState<ExportRangeKind>(hasSelection ? 'selection' : 'whole');
  const initial =
    selected !== null ? rangeBoxes(doc, selected) : { from: '1', to: String(doc.length) };
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [perRow, setPerRow] = useState(String(basesPerRow ?? 60));
  const [pages, setPages] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const range = readExportRange(doc, kind, selection, from, to);
  const rowWidth = readBasesPerRow(perRow);
  const options: LinearExportOptions | null =
    range.ok && rowWidth !== null
      ? {
          ...format,
          range: range.range,
          basesPerRow: rowWidth,
          // The selection is shown highlighted when it is what is exported, as before.
          selection: kind === 'selection' ? selection : null,
        }
      : null;
  // Counting lays the rows out without drawing them, so it is cheap enough to keep up to date.
  const pageCount = ((): { n: number } | { error: string } | null => {
    if (!pages || options === null) return null;
    try {
      return { n: countLinearSvgPages(doc, options) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  })();

  const problem = !range.ok
    ? range.message
    : rowWidth === null
      ? `Bases per row is a number from ${MIN_EXPORT_BASES_PER_ROW} to ${MAX_EXPORT_BASES_PER_ROW}.`
      : pageCount !== null && 'error' in pageCount
        ? pageCount.error
        : pageCount !== null && pageCount.n > MAX_EXPORT_PAGES
          ? `That is ${pageCount.n} pages, more than the ${MAX_EXPORT_PAGES} downloaded at once: choose a shorter range or more bases per row.`
          : null;
  const [failure, setFailure] = useState<string | null>(null);

  const submit = (): void => {
    if (options === null || !range.ok || problem !== null) return;
    const name = `${stem}_${range.suffix}`;
    try {
      if (pages) {
        const drawn = exportLinearSvgPages(doc, options);
        analytics.track('file', 'export', 'sequence-svg-pages');
        downloadPages(name, drawn, download);
      } else {
        const svg = exportLinearSvg(doc, options);
        analytics.track('file', 'export', kind === 'selection' ? 'selection-svg' : 'sequence-svg');
        download(`${name}.svg`, svg);
      }
      onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    }
  };

  const kinds: readonly (readonly [ExportRangeKind, string])[] = [
    ['whole', 'Whole sequence'],
    ['selection', 'Selection'],
    ['custom', 'From–to'],
  ];

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-sequence-title"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="export-sequence-title" className="dialog__title">
          Export sequence view as SVG
        </h2>
        <div className="dialog__body export-sequence">
          <div className="segmented" role="group" aria-label="Bases to export">
            {kinds.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`segmented__button${kind === k ? ' segmented__button--active' : ''}`}
                aria-pressed={kind === k}
                disabled={k === 'selection' && !hasSelection}
                onClick={() => {
                  setKind(k);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === 'custom' && (
            <div className="export-sequence__range">
              <label className="panel__field">
                <span>From</span>
                <input
                  className="panel__number"
                  inputMode="numeric"
                  aria-label="From base"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                  }}
                />
              </label>
              <label className="panel__field">
                <span>to</span>
                <input
                  className="panel__number"
                  inputMode="numeric"
                  aria-label="To base"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                  }}
                />
              </label>
              <span className="export-sequence__hint">
                {doc.isCircular
                  ? 'Bases 1-based, both included; a “to” before “from” runs through the origin.'
                  : 'Bases 1-based, both included.'}
              </span>
            </div>
          )}
          <label className="panel__field">
            <span>Bases per row</span>
            <input
              className="panel__number"
              inputMode="numeric"
              aria-label="Bases per row"
              value={perRow}
              onChange={(e) => {
                setPerRow(e.target.value);
              }}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={pages}
              onChange={(e) => {
                setPages(e.target.checked);
              }}
            />
            Split into A4 pages
          </label>
          <p className="export-sequence__hint" aria-live="polite">
            {problem ??
              failure ??
              (pageCount !== null && 'n' in pageCount
                ? pageCount.n === 1
                  ? 'One page, downloaded as one SVG file.'
                  : `${pageCount.n} pages, each downloaded as an SVG file of its own; your browser may ask to allow several downloads.`
                : 'Whole rows, numbered as in the document: the first and last may hold a few bases either side of the range.')}
          </p>
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={problem !== null}>
            Export
          </button>
        </div>
      </form>
    </div>
  );
}
