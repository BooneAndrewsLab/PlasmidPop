import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { msaClustal, msaFasta, summariseColumns, uniqueNames } from '@/core';
import type { MultipleAlignment } from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { downloadText } from '../saveFile';
import { readColours } from './alignmentStackDraw';
import { drawMsa, msaSize, type MsaShading } from './msaDraw';

interface Props {
  readonly names: readonly string[];
  readonly alignment: MultipleAlignment;
  readonly onClose: () => void;
}

/**
 * The multiple alignment in a window of its own (#207): every sequence in
 * one column space with the consensus above it and each column shaded by
 * how many of the sequences agree, saved as aligned FASTA or Clustal. The
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
  const identical = useMemo(() => summary.filter((s) => s.conservation === 1).length, [summary]);

  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

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
    drawMsa(ctx, {
      names: labels,
      rows: alignment.rows,
      summary,
      colours: readColours(el),
      shading: nucleotide ? shading : 'conservation',
      onAccent: accentInk,
      ...view,
    });
  }, [view, labels, alignment, summary, shading, nucleotide]);

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
          {note !== null && (
            <span className="panel__note" role="status">
              {note}
            </span>
          )}
        </div>
        <div className="msa-scroll" ref={scroller}>
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
            />
          </div>
        </div>
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
