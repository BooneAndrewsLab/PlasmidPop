import { useEffect, useRef } from 'react';

import {
  type BaseSize,
  type BaseStylePatch,
  type Range,
  type SeqDocument,
  BASE_SIZES,
  CLEAR_BASE_STYLE,
  isEmptyRange,
} from '@/core';

import { analytics } from '../analytics';
import { isUniformSize, sharedStyle } from '../baseStyleSelection';
import { editorStore } from '../state/editorStore';
import { useAltKey, useBindingLabel } from './useAltKey';
import { useMenu } from './useMenu';

/** Letter colours offered at a click; any other is a colour picker away. */
const LETTER_COLORS: readonly (readonly [string, string])[] = [
  ['#d62728', 'Red'],
  ['#e8710a', 'Orange'],
  ['#2ca02c', 'Green'],
  ['#1f77b4', 'Blue'],
  ['#9467bd', 'Purple'],
  ['#8c564b', 'Brown'],
];

/** Highlighter colours: light, so the letters on them stay readable. */
const HIGHLIGHTS: readonly (readonly [string, string])[] = [
  ['#ffe066', 'Yellow'],
  ['#b8f0b0', 'Green'],
  ['#b3d9ff', 'Blue'],
  ['#ffc2e0', 'Pink'],
  ['#ffd6a5', 'Orange'],
  ['#dddddd', 'Grey'],
];

const SIZE_LABELS: Readonly<Record<BaseSize, string>> = {
  1.25: 'Larger (1¼×)',
  1.5: 'Large (1½×)',
  2: 'Largest (2×)',
};

/** The tick is decoration: `aria-checked` is what says which item is chosen. */
function Tick({ on }: { readonly on: boolean }) {
  return (
    <span className="menu__shortcut" aria-hidden="true">
      {on ? '✓' : ''}
    </span>
  );
}

/**
 * A colour picker that reports once, when the picker is closed on a colour,
 * rather than on every step of a drag across it: one undo step per colour.
 */
function ColorPicker({
  label,
  value,
  onPick,
}: {
  readonly label: string;
  readonly value: string;
  readonly onPick: (color: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    const input = ref.current;
    if (input === null) return;
    const changed = (): void => {
      pick.current(input.value);
    };
    input.addEventListener('change', changed);
    return () => {
      input.removeEventListener('change', changed);
    };
  }, []);
  return (
    <label className="menu__swatch" title={`${label}: any colour`}>
      <input ref={ref} type="color" aria-label={label} defaultValue={value} />
    </label>
  );
}

function Swatches({
  label,
  colors,
  current,
  kind,
  onPick,
}: {
  readonly label: string;
  readonly colors: readonly (readonly [string, string])[];
  readonly current: string | undefined;
  readonly kind: 'letters' | 'highlight';
  readonly onPick: (color: string | null) => void;
}) {
  return (
    <div
      className="menu__item menu__item--field style-menu__swatches"
      role="group"
      aria-label={label}
    >
      {colors.map(([color, name]) => (
        <button
          key={color}
          type="button"
          role="menuitemradio"
          aria-checked={current === color}
          aria-label={`${label}: ${name}`}
          title={name}
          className={`style-menu__swatch style-menu__swatch--${kind}`}
          style={kind === 'letters' ? { color } : { background: color }}
          onClick={() => {
            onPick(color);
          }}
        >
          {kind === 'letters' ? 'A' : ''}
        </button>
      ))}
      <ColorPicker
        key={current ?? ''}
        label={label}
        value={current ?? colors[0]?.[0] ?? '#000000'}
        onPick={onPick}
      />
      <button
        type="button"
        className="button button--quiet button--small"
        title={`Take the ${kind === 'letters' ? 'colour' : 'highlight'} off the selected bases`}
        onClick={() => {
          onPick(null);
        }}
      >
        None
      </button>
    </div>
  );
}

interface Props {
  readonly doc: SeqDocument;
  readonly selection: Range | null;
  /** Which way the list opens; down, under the button, unless there is no room. */
  readonly opens?: 'up' | 'down';
  /** Whether this copy of the menu answers Alt+Y; only one may. */
  readonly shortcut?: boolean;
}

/**
 * Colour, highlight, bold and size for the selected bases (#89, #91): marks
 * a user puts on bases to point at them, kept in the document and moving
 * with its edits, but no annotation. Each choice is one undoable edit, and
 * the menu stays open so several can be tried in turn.
 */
export function BaseStyleMenu({ doc, selection, opens = 'down', shortcut = true }: Props) {
  const hasRange = selection !== null && !isEmptyRange(selection);
  const { open, toggle, close, ref } = useMenu();
  useEffect(() => {
    if (!hasRange) close();
  }, [hasRange, close]);
  // Alt+Y ("style") opens it with its first item focused (#89).
  const focusFirst = useRef(false);
  const key = useBindingLabel('style-menu');
  useAltKey(
    'style-menu',
    shortcut
      ? () => {
          if (!hasRange) return;
          analytics.shortcut('alt+y');
          focusFirst.current = !open;
          toggle();
        }
      : null,
  );
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    ref.current?.querySelector<HTMLElement>('[role="menu"] button')?.focus();
  }, [open, ref]);

  const shared = hasRange ? sharedStyle(doc, selection) : {};
  const style = (patch: BaseStylePatch): void => {
    if (selection === null || isEmptyRange(selection)) return;
    editorStore.apply({ type: 'styleBases', range: selection, style: patch }, selection);
  };

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="button button--small"
        disabled={!hasRange}
        aria-keyshortcuts={shortcut ? key : undefined}
        title={`Colour, highlight, bold or enlarge the selected bases (${key})`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        Style <span className="button__caret">▾</span>
      </button>
      {open && hasRange && (
        <div
          className={`menu__list menu__list--start${opens === 'up' ? ' menu__list--up' : ''}`}
          role="menu"
          aria-label="Style of the bases"
        >
          <p className="menu__group-label">Letters</p>
          <Swatches
            label="Letter colour"
            kind="letters"
            colors={LETTER_COLORS}
            current={shared.color}
            onPick={(color) => {
              style({ color });
            }}
          />
          <p className="menu__group-label">Highlight</p>
          <Swatches
            label="Highlight"
            kind="highlight"
            colors={HIGHLIGHTS}
            current={shared.highlight}
            onPick={(highlight) => {
              style({ highlight });
            }}
          />
          <div className="menu__separator" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={shared.bold === true}
            className="menu__item"
            onClick={() => {
              style({ bold: shared.bold === true ? null : true });
            }}
          >
            <span>
              <b>Bold</b>
            </span>
            <Tick on={shared.bold === true} />
          </button>
          <div className="menu__separator" />
          <p className="menu__group-label">Size</p>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={shared.size === undefined && isUniformSize(doc, selection)}
            className="menu__item"
            onClick={() => {
              style({ size: null });
            }}
          >
            <span>Ordinary</span>
            <Tick on={shared.size === undefined && isUniformSize(doc, selection)} />
          </button>
          {BASE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="menuitemradio"
              aria-checked={shared.size === size}
              className="menu__item"
              title="Larger letters take more room, so their row holds fewer bases"
              onClick={() => {
                style({ size });
              }}
            >
              <span>{SIZE_LABELS[size]}</span>
              <Tick on={shared.size === size} />
            </button>
          ))}
          <div className="menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            title="Take every colour, highlight, bold and size off the selected bases"
            onClick={() => {
              style(CLEAR_BASE_STYLE);
            }}
          >
            <span>Clear style</span>
          </button>
        </div>
      )}
    </div>
  );
}
