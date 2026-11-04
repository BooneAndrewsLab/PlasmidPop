import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { msaClustal, msaFasta, summariseColumns, uniqueNames } from '@/core';
import type { MultipleAlignment } from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import {
  extendMsaSelection,
  msaBarAt,
  msaCellHasLetter,
  msaColumnAt,
  msaColumnUnder,
  msaCopiedNote,
  msaRowAt,
  msaSelectionColumns,
  msaSelectionText,
  msaSelectionValid,
  startMsaSelection,
  type MsaCopyMode,
  type MsaSelection,
} from '../msaSelection';
import type { MsaCopyContext } from '../msaCopy';
import { downloadText } from '../saveFile';
import {
  barWanted,
  gestureMove,
  gesturePress,
  gestureRelease,
  idleGesture,
  type Gesture,
  type GestureOps,
} from '../selectionGesture';
import { readColours } from './alignmentStackDraw';
import { AlignmentSelectionBar } from './AlignmentSelectionBar';
import { MsaCopyPanel } from './MsaCopyPanel';
import { CopyNote } from './CopyNote';
import { MSA_NAME_WIDTH, drawMsa, msaSize, type MsaShading } from './msaDraw';

interface Props {
  readonly names: readonly string[];
  readonly alignment: MultipleAlignment;
  readonly onClose: () => void;
}

type MsaGesture = Gesture<number, MsaSelection>;
const GESTURE_OPS: GestureOps<number, MsaSelection> = {
  start: startMsaSelection,
  extend: extendMsaSelection,
};

/**
 * The multiple alignment in a window of its own (#207): every sequence in
 * one column space with the consensus above it and each column shaded by
 * how many of the sequences agree, saved as aligned FASTA or Clustal, or a
 * run of columns selected on one row and copied (#368). The
 * grid is a canvas drawn for the columns in view only; the scroll bars
 * belong to a sizer behind it.
 */
export function MsaDialog({ names, alignment, onClose }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState({ left: 0, top: 0, width: 800, height: 400 });
  const [shading, setShading] = useState<MsaShading>('conservation');
  const [note, setNote] = useState<string | null>(null);
  const nucleotide = alignment.alphabet === 'nucleotide';
  const labels = useMemo(() => uniqueNames(names), [names]);
  const summary = useMemo(() => summariseColumns(alignment.rows), [alignment]);
  const size = msaSize(alignment.columns, alignment.rows.length);
  const consensus = useMemo(() => summary.map((s) => s.consensus).join(''), [summary]);
  const unit = nucleotide ? 'base' : 'residue';
  // The selection (#368): a run of columns on one row, the consensus included, and the press making it (#370).
  const [gesture, setGesture] = useState<MsaGesture>(idleGesture);
  const selection =
    gesture.selection !== null &&
    msaSelectionValid(alignment.rows.length, alignment.columns, gesture.selection)
      ? gesture.selection
      : null;
  const [panelAt, setPanelAt] = useState<{ left: number; top: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const identical = useMemo(() => summary.filter((s) => s.conservation === 1).length, [summary]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  // Esc clears the selection first and closes the window on the next press
  // (#370); the Advanced copy panel takes Esc before this listener sees it.
  const selected = selection !== null;
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (selected) {
        setGesture(idleGesture());
        setPanelAt(null);
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose, selected]);

  // The scroll position and the size of the area, which is what is drawn.
  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const read = (): void => {
      setView({
        left: el.scrollLeft,
        top: el.scrollTop,
        width: el.clientWidth,
        height: el.clientHeight,
      });
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', read);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    const ctx = el.getContext('2d');
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.max(1, Math.floor(view.width * dpr));
    el.height = Math.max(1, Math.floor(view.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const accentInk = getComputedStyle(el).getPropertyValue('--accent-ink').trim() || '#ffffff';
    const cols = selection === null ? null : msaSelectionColumns(alignment.columns, selection);
    drawMsa(ctx, {
      names: labels,
      rows: alignment.rows,
      summary,
      colours: readColours(el),
      shading: nucleotide ? shading : 'conservation',
      onAccent: accentInk,
      selection:
        selection === null || cols === null
          ? null
          : { row: selection.row, start: cols.start, end: cols.end },
      ...view,
    });
  }, [view, labels, alignment, summary, shading, nucleotide, selection]);

  const stem = 'multiple-alignment';
  const save = (format: 'fasta' | 'clustal'): void => {
    const text =
      format === 'fasta'
        ? msaFasta(labels, alignment.rows)
        : msaClustal(names, alignment.rows, alignment.alphabet);
    downloadText(`${stem}.${format === 'fasta' ? 'fasta' : 'aln'}`, text);
    analytics.track('align', 'msa-export', format);
  };
  const copy = (): void => {
    copyText(msaFasta(labels, alignment.rows));
    setNote('Copied as aligned FASTA.');
    analytics.track('align', 'msa-export', 'fasta');
  };

  /** Ctrl+C copies the selection; with Alt, the row as drawn with its gaps. */
  const copySelection = (mode: MsaCopyMode): boolean => {
    if (selection === null) return false;
    const text = msaSelectionText(alignment.rows, consensus, alignment.columns, selection, mode);
    if (text === '') return false;
    copyText(text);
    const name = selection.row < 0 ? 'the consensus' : (labels[selection.row] ?? '');
    setNote(msaCopiedNote(name, unit, text, mode));
    return true;
  };
  const closePanel = (): void => {
    setPanelAt(null);
  };
  // The bar floats beside two columns or more once the button is up (#370).
  const barAt =
    selection === null || !barWanted(gesture, msaSelectionColumns(alignment.columns, selection))
      ? null
      : msaBarAt(selection, alignment.columns, view, view);
  const togglePanel = (bar: HTMLElement): void => {
    if (panelAt !== null) {
      setPanelAt(null);
      return;
    }
    const box = area.current?.getBoundingClientRect();
    const at = bar.getBoundingClientRect();
    if (box === undefined) return;
    setPanelAt({ left: at.left - box.left, top: at.bottom - box.top });
  };
  const copyContext: MsaCopyContext | null =
    selection === null
      ? null
      : {
          rows: alignment.rows,
          consensus,
          names: labels,
          columns: alignment.columns,
          selection,
        };

  return createPortal(
    <div className="dialog-backdrop dialog-backdrop--full">
      <div
        className="dialog dialog--alignment"
        role="dialog"
        aria-modal="true"
        aria-labelledby="msa-title"
      >
        <div className="astack-head">
          <h2 id="msa-title" className="dialog__title">
            Multiple alignment of {alignment.rows.length} {nucleotide ? 'sequences' : 'proteins'}
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
          <span className="astack-tools__counter">
            {alignment.columns.toLocaleString()} columns, {identical.toLocaleString()} identical
          </span>
          {nucleotide && (
            <label className="panel__field panel__field--row">
              <span>Shading</span>
              <select
                className="panel__select"
                aria-label="Shading"
                value={shading}
                onChange={(e) => {
                  setShading(e.target.value === 'bases' ? 'bases' : 'conservation');
                }}
              >
                <option value="conservation">Conservation</option>
                <option value="bases">Base colours</option>
              </select>
            </label>
          )}
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              save('fasta');
            }}
          >
            Save aligned FASTA
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              save('clustal');
            }}
          >
            Save Clustal
          </button>
          <button type="button" className="button button--small" onClick={copy}>
            Copy FASTA
          </button>
        </div>
        <div className="msa-area" ref={area}>
          <div
            className="msa-scroll"
            ref={scroller}
            tabIndex={0}
            aria-label="Alignment, all sequences; drag over letters to select, Ctrl+C copies"
            onKeyDown={(e) => {
              // Ctrl+Shift+C is the browser's inspector, so the aligned row is Ctrl+Alt+C.
              if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyC') {
                if (copySelection(e.altKey ? 'aligned' : 'residues')) e.preventDefault();
              }
            }}
          >
            <div className="msa-sizer" style={{ width: size.width, height: size.height }}>
              <canvas
                ref={canvas}
                className="msa-canvas"
                role="img"
                aria-label={`Multiple alignment: ${alignment.rows.length} sequences, ${alignment.columns} columns; consensus ${summary
                  .map((s) => s.consensus)
                  .join('')
                  .slice(0, 200)}`}
                style={{ width: view.width, height: view.height }}
                onPointerMove={(e) => {
                  if (e.pointerType === 'touch') return;
                  const column = msaColumnAt(
                    e.clientX - e.currentTarget.getBoundingClientRect().left,
                    view.left,
                    alignment.columns,
                  );
                  setGesture((g) => gestureMove(g, column, GESTURE_OPS));
                }}
                onPointerDown={(e) => {
                  // Click a letter, drag over a row's letters, or shift-click
                  // the far end, to select; a press on blank space clears (#368, #370).
                  if (e.button !== 0 || e.pointerType === 'touch') return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  if (x < MSA_NAME_WIDTH) return;
                  setPanelAt(null);
                  setNote(null);
                  const row = msaRowAt(e.clientY - rect.top, view.top, alignment.rows.length);
                  const cell =
                    row === null
                      ? null
                      : {
                          key: row,
                          column: msaColumnAt(x, view.left, alignment.columns),
                          letter: msaCellHasLetter(
                            alignment.rows,
                            consensus,
                            row,
                            msaColumnUnder(x, view.left),
                          ),
                        };
                  const shift = e.shiftKey;
                  setGesture((g) => gesturePress(g, cell, shift, GESTURE_OPS));
                  if (cell !== null) e.currentTarget.setPointerCapture(e.pointerId);
                  // The keys work from the scroller.
                  scroller.current?.focus();
                }}
                onPointerUp={() => {
                  setGesture(gestureRelease);
                }}
                onPointerCancel={() => {
                  setGesture(gestureRelease);
                }}
              />
              {barAt !== null && (
                <AlignmentSelectionBar
                  left={barAt.left}
                  top={barAt.top}
                  columns={barAt.columns}
                  advancedOpen={panelAt !== null}
                  advancedTip="Choose rows, columns, gaps and the format, with a preview"
                  onCopy={() => {
                    copySelection('residues');
                    scroller.current?.focus();
                  }}
                  onAdvanced={togglePanel}
                />
              )}
            </div>
          </div>
          {panelAt !== null && copyContext !== null && (
            <MsaCopyPanel
              context={copyContext}
              left={panelAt.left}
              top={panelAt.top}
              onCopied={(text) => {
                setNote(text);
                scroller.current?.focus();
              }}
              onClose={closePanel}
            />
          )}
        </div>
        <CopyNote note={note} />
        <p className="panel__note">
          Columns are shaded by the share of sequences with the commonest letter; the bar over each
          column is the same share. Gaps are drawn as dashes. A gap in most sequences leaves the
          consensus blank.
        </p>
      </div>
    </div>,
    document.body,
  );
}
