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
import { AlignmentPopover } from './AlignmentPopover';
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
    <AlignmentPopover
      title="Export the alignment"
      closeLabel="Close export"
      onClose={onClose}
      className="astack-pop--export"
    >
      <div className="astack-pop__form">
        <span>Columns</span>
        <span className="astack-pop__line">
          <input
            className="astack-pop__input astack-pop__input--number"
            aria-label="From column"
            inputMode="numeric"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
          <span aria-hidden="true">to</span>
          <input
            className="astack-pop__input astack-pop__input--number"
            aria-label="To column"
            inputMode="numeric"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
          <span className="segmented" role="group" aria-label="Set the columns">
            <button
              type="button"
              className="segmented__button astack-pop__step"
              title="The columns in view now"
              onClick={() => {
                set(getVisible());
              }}
            >
              On screen
            </button>
            <button
              type="button"
              className="segmented__button astack-pop__step"
              title="Every column of the alignment"
              onClick={() => {
                set({ start: 0, end: stack.columns });
              }}
            >
              All {stack.columns.toLocaleString()}
            </button>
          </span>
        </span>
        <span>Picture</span>
        <span className="astack-pop__line">
          <button
            type="button"
            className="button astack-pop__button"
            title="Names, ruler, features, differences and amino acids as shown, as a vector file"
            onClick={() => {
              save('svg');
            }}
          >
            Save SVG
          </button>
          <button
            type="button"
            className="button astack-pop__button"
            title="The same as an image file"
            onClick={() => {
              save('png');
            }}
          >
            Save PNG
          </button>
        </span>
        <span>Copy</span>
        <span className="astack-pop__line">
          <button
            type="button"
            className="button astack-pop__button"
            title="Blocks of columns with names, positions and a match line"
            onClick={() => {
              copy('text');
            }}
          >
            As text
          </button>
          <label className="astack-pop__inline">
            in blocks of
            <input
              className="astack-pop__input astack-pop__input--number"
              aria-label="Columns per block"
              inputMode="numeric"
              value={block}
              onChange={(e) => {
                setBlock(e.target.value);
              }}
            />
          </label>
        </span>
        <span aria-hidden="true" />
        <span className="astack-pop__line">
          <button
            type="button"
            className="button astack-pop__button"
            title="Every sequence at the full width of the range, gaps as -"
            onClick={() => {
              copy('fasta');
            }}
          >
            As aligned FASTA
          </button>
        </span>
      </div>
      <div className="astack-pop__foot">
        <span className="astack-pop__status" aria-live="polite">
          {message}
        </span>
      </div>
    </AlignmentPopover>
  );
}
