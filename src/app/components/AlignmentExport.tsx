import { useState } from 'react';

import type { Stack } from '../alignmentStack';
import {
  alignmentPng,
  alignmentSvg,
  exportFileName,
  pictureLimit,
  type PictureKind,
} from '../alignmentExport';
import {
  alignedFasta,
  alignmentText,
  clampRange,
  DEFAULT_BLOCK,
  type ColumnRange,
} from '../alignmentText';
import { copyText } from '../clipboard';
import { downloadBlob } from '../saveFile';
import type { StackDrawing } from './alignmentStackDraw';

interface Props {
  readonly stack: Stack;
  readonly referenceName: string;
  /** The columns in view now, which the form starts from. */
  readonly getVisible: () => ColumnRange;
  /** What the picture is drawn from; null while the window has not read its theme. */
  readonly getDrawing: () => StackDrawing | null;
  readonly onClose: () => void;
}

function wholeNumber(text: string): number | null {
  const n = Number(text.replace(/[,\s]/g, ''));
  return Number.isInteger(n) ? n : null;
}

/**
 * The popover under the toolbar's Export button (#126): the columns to take
 * (on screen to begin with), then a picture as SVG or PNG, or the alignment
 * copied as text in blocks or as aligned FASTA. The text forms are cheap and
 * take any range; the pictures are drawn whole, so a range too large for
 * one is refused with the reason.
 */
export function AlignmentExport({ stack, referenceName, getVisible, getDrawing, onClose }: Props) {
  const [initial] = useState(() => getVisible());
  const [from, setFrom] = useState(String(initial.start + 1));
  const [to, setTo] = useState(String(Math.max(initial.end, initial.start + 1)));
  const [block, setBlock] = useState(String(DEFAULT_BLOCK));
  const [message, setMessage] = useState('');

  const set = (range: ColumnRange): void => {
    setFrom(String(range.start + 1));
    setTo(String(range.end));
    setMessage('');
  };

  /** The range typed, 0-based half-open, or a reason it is not one. */
  const range = (): ColumnRange | string => {
    const a = wholeNumber(from);
    const b = wholeNumber(to);
    if (a === null || b === null) return 'Columns are whole numbers.';
    const r = clampRange(stack, { start: a - 1, end: b });
    if (r === null) return `Choose columns from 1 to ${stack.columns.toLocaleString()}.`;
    return r;
  };

  const copy = (kind: 'text' | 'fasta'): void => {
    const r = range();
    if (typeof r === 'string') {
      setMessage(r);
      return;
    }
    const size = wholeNumber(block);
    if (kind === 'text' && (size === null || size < 10)) {
      setMessage('Blocks are 10 columns or more.');
      return;
    }
    copyText(
      kind === 'text'
        ? alignmentText(stack, referenceName, r, size ?? DEFAULT_BLOCK)
        : alignedFasta(stack, referenceName, r),
    );
    setMessage(
      `Copied ${kind === 'text' ? 'the alignment' : 'aligned FASTA'}, columns ${(r.start + 1).toLocaleString()} to ${r.end.toLocaleString()}.`,
    );
  };

  const save = (kind: PictureKind): void => {
    const r = range();
    if (typeof r === 'string') {
      setMessage(r);
      return;
    }
    const d = getDrawing();
    if (d === null) {
      setMessage('The window is still starting; try again.');
      return;
    }
    const limit = pictureLimit(d, r, kind);
    if (limit !== null) {
      setMessage(limit);
      return;
    }
    const name = exportFileName(referenceName, r, kind);
    if (kind === 'svg') {
      downloadBlob(
        name,
        new Blob([alignmentSvg(d, r, `Alignment to ${referenceName}`)], {
          type: 'image/svg+xml;charset=utf-8',
        }),
      );
      setMessage(`Saved ${name}.`);
    } else {
      alignmentPng(d, r).then(
        (blob) => {
          downloadBlob(name, blob);
          setMessage(`Saved ${name}.`);
        },
        (e: unknown) => {
          setMessage(e instanceof Error ? e.message : 'The picture could not be made.');
        },
      );
    }
  };

  return (
    <div className="astack-find astack-export" role="group" aria-label="Export the alignment">
      <label className="astack-find__label">
        Columns
        <input
          className="input astack-export__input"
          aria-label="From column"
          inputMode="numeric"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
          }}
        />
        to
        <input
          className="input astack-export__input"
          aria-label="To column"
          inputMode="numeric"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="button button--quiet button--small"
        onClick={() => {
          set(getVisible());
        }}
      >
        On screen
      </button>
      <button
        type="button"
        className="button button--quiet button--small"
        onClick={() => {
          set({ start: 0, end: stack.columns });
        }}
      >
        All {stack.columns.toLocaleString()}
      </button>
      <div className="astack-export__row">
        <span className="astack-tools__note">Picture</span>
        <button
          type="button"
          className="button button--small"
          title="Names, ruler, features, differences and amino acids as shown, as a vector file"
          onClick={() => {
            save('svg');
          }}
        >
          Save SVG
        </button>
        <button
          type="button"
          className="button button--small"
          title="The same as an image file"
          onClick={() => {
            save('png');
          }}
        >
          Save PNG
        </button>
      </div>
      <div className="astack-export__row">
        <span className="astack-tools__note">Copy</span>
        <button
          type="button"
          className="button button--small"
          title="Blocks of columns with names, positions and a match line"
          onClick={() => {
            copy('text');
          }}
        >
          As text
        </button>
        <label className="astack-find__label">
          in blocks of
          <input
            className="input astack-export__input"
            aria-label="Columns per block"
            inputMode="numeric"
            value={block}
            onChange={(e) => {
              setBlock(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="button button--small"
          title="Every sequence at the full width of the range, gaps as -"
          onClick={() => {
            copy('fasta');
          }}
        >
          As aligned FASTA
        </button>
      </div>
      <span className="astack-tools__note astack-export__message" aria-live="polite">
        {message}
      </span>
      <button
        type="button"
        className="button button--quiet button--small"
        aria-label="Close export"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
