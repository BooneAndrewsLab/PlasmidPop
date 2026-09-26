import { useEffect, useRef, useState } from 'react';

import { type FontSize, type ResidueNumbering, FONT_SIZES } from '@/view/linear';

import { analytics } from '../analytics';
import { type TraceSize, editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { useAltKey } from './useAltKey';
import { useMenu } from './useMenu';

const SIZE_LABELS: Readonly<Record<FontSize, string>> = {
  11: 'Small',
  13: 'Medium',
  16: 'Large',
};

/** Row widths offered beside "Fit the window"; wider than the window scrolls sideways. */
const ROW_WIDTHS: readonly number[] = [30, 60, 90, 120];

/** The tick is decoration: `aria-checked` is what says which item is chosen. */
function Tick({ on }: { readonly on: boolean }) {
  return (
    <span className="menu__shortcut" aria-hidden="true">
      {on ? '✓' : ''}
    </span>
  );
}

/** A read's trace: how tall above its bases, or not drawn (#55). */
const TRACE_SIZES: readonly (readonly [TraceSize, string, string])[] = [
  ['off', 'Hidden', "Draw the read's bases without its chromatogram"],
  ['short', 'Short', 'The chromatogram above the bases, low'],
  ['tall', 'Tall', 'The chromatogram at twice the height, for reading close peaks'],
];

/** Which residues of a CDS translation carry their number (#97). */
const RESIDUE_NUMBERINGS: readonly (readonly [ResidueNumbering, string, string])[] = [
  ['off', 'Off', 'Draw the amino acids without numbers, in lower rows'],
  ['tens', 'Every 10th', 'Number the first residue and every tenth over the translations'],
  [
    'every',
    'Every residue',
    'Number every residue; those with no room are left out until the text is larger or the rows shorter',
  ],
];

/**
 * How the sequence view draws: text size, how many bases go in a row,
 * whether the complement is numbered too and whether bases are coloured,
 * and — since it is the other thing about the arrangement rather than the
 * document — a way back from wherever the splitters were dragged to. These
 * are preferences for the app, not the document, and they are remembered
 * between sessions.
 */
export function FormatMenu() {
  const {
    seqFontSize,
    seqBasesPerRow,
    numberComplement,
    residueNumbering,
    colorBases,
    traceSize,
    history,
    baseColors,
  } = useEditorState();
  // Typed values are committed on Enter or on leaving the box, not per key.
  const [rowDraft, setRowDraft] = useState<string | null>(null);
  const customRow = seqBasesPerRow !== null && !ROW_WIDTHS.includes(seqBasesPerRow);
  const commitRow = (): void => {
    if (rowDraft === null) return;
    const n = Number.parseInt(rowDraft, 10);
    if (Number.isFinite(n)) {
      analytics.trackOnce('view', 'format', 'bases-per-row');
      editorStore.setSeqBasesPerRow(n);
    }
    setRowDraft(null);
  };

  // The colour pickers start from what is drawn: the user's own, or the theme's.
  const shownColors = (): Record<'a' | 'c' | 'g' | 't', string> => {
    if (baseColors !== null) return { ...baseColors };
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string): string => {
      const raw = css.getPropertyValue(name).trim();
      return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
    };
    return {
      a: v('--seq-base-a', '#2f7d32'),
      c: v('--seq-base-c', '#1b6ec8'),
      g: v('--seq-base-g', '#8a5a00'),
      t: v('--seq-base-t', '#c0392b'),
    };
  };
  // The trace sizes can be set only while a read with a trace is in front.
  const hasTrace = history?.present.read?.trace != null;
  const isProtein = history?.present.isProtein === true;
  // Every item leaves the menu open: the point is to try a size or a row
  // width and see the view change behind it. Escape or a click outside closes.
  const { open, toggle, ref } = useMenu();
  // Alt+O opens it with its first item focused, so Tab walks the items (#34).
  const focusFirst = useRef(false);
  useAltKey('KeyO', () => {
    analytics.shortcut('alt+o');
    focusFirst.current = !open;
    toggle();
  });
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    ref.current?.querySelector<HTMLElement>('[role="menu"] button')?.focus();
  }, [open, ref]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="button"
        aria-label="Format"
        aria-keyshortcuts="Alt+O"
        title="Text size, bases per row, numbering and base colours in the sequence view, and the pane sizes (Alt+O)"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        Format <span className="button__caret">▾</span>
      </button>
      {open && (
        <div className="menu__list" role="menu" aria-label="Format and layout">
          <p className="menu__group-label">Text size</p>
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="menuitemradio"
              aria-checked={seqFontSize === size}
              className="menu__item"
              onClick={() => {
                analytics.trackOnce('view', 'format', 'font-size');
                editorStore.setSeqFontSize(size);
              }}
            >
              <span>{SIZE_LABELS[size]}</span>
              <Tick on={seqFontSize === size} />
            </button>
          ))}
          <div className="menu__separator" />
          <p className="menu__group-label">Bases per row</p>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={seqBasesPerRow === null}
            className="menu__item"
            title="As many as the window holds, in tens"
            onClick={() => {
              analytics.trackOnce('view', 'format', 'bases-per-row');
              editorStore.setSeqBasesPerRow(null);
            }}
          >
            <span>Fit the window</span>
            <Tick on={seqBasesPerRow === null} />
          </button>
          {ROW_WIDTHS.map((bases) => (
            <button
              key={bases}
              type="button"
              role="menuitemradio"
              aria-checked={seqBasesPerRow === bases}
              className="menu__item"
              title={`Always ${bases} bases in a row, scrolling sideways if the window is narrower`}
              onClick={() => {
                analytics.trackOnce('view', 'format', 'bases-per-row');
                editorStore.setSeqBasesPerRow(bases);
              }}
            >
              <span>{bases}</span>
              <Tick on={seqBasesPerRow === bases} />
            </button>
          ))}
          <label
            className="menu__item menu__item--field"
            title="Any whole number of bases, 10 to 1,000"
          >
            <span>Other</span>
            <input
              className="panel__number"
              type="number"
              min={10}
              max={1000}
              aria-label="Bases per row"
              value={rowDraft ?? (customRow ? String(seqBasesPerRow) : '')}
              placeholder="bases"
              onChange={(e) => {
                setRowDraft(e.target.value);
              }}
              onBlur={commitRow}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRow();
              }}
            />
            <Tick on={customRow} />
          </label>
          <div className="menu__separator" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={numberComplement}
            className="menu__item"
            title="Repeat the row's position beside the complement strand"
            onClick={() => {
              analytics.trackOnce('view', 'format', 'number-complement');
              editorStore.setNumberComplement(!numberComplement);
            }}
          >
            <span>Number the complement</span>
            <Tick on={numberComplement} />
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={colorBases}
            className="menu__item"
            title="Give A, C, G and T each their own colour"
            onClick={() => {
              analytics.trackOnce('view', 'format', 'color-bases');
              editorStore.setColorBases(!colorBases);
            }}
          >
            <span>Colour the bases</span>
            <Tick on={colorBases} />
          </button>
          {colorBases && (
            <div className="menu__item menu__item--field" role="group" aria-label="Base colours">
              {(['a', 'c', 'g', 't'] as const).map((base) => (
                <label
                  key={base}
                  className="menu__swatch"
                  title={`The colour of ${base.toUpperCase()}`}
                >
                  {base.toUpperCase()}
                  <input
                    type="color"
                    aria-label={`Colour of ${base.toUpperCase()}`}
                    value={shownColors()[base]}
                    onChange={(e) => {
                      analytics.trackOnce('view', 'format', 'base-colours');
                      editorStore.setBaseColors({ ...shownColors(), [base]: e.target.value });
                    }}
                  />
                </label>
              ))}
              <button
                type="button"
                className="button button--quiet button--small"
                disabled={baseColors === null}
                title="Back to the theme's colours, which differ between light and dark"
                onClick={() => {
                  editorStore.setBaseColors(null);
                }}
              >
                Reset
              </button>
            </div>
          )}
          <div className="menu__separator" />
          <p className="menu__group-label">
            Residue numbers
            {isProtein && <span className="menu__group-note"> · for CDS translations</span>}
          </p>
          {RESIDUE_NUMBERINGS.map(([numbering, label, title]) => (
            <button
              key={numbering}
              type="button"
              role="menuitemradio"
              aria-checked={residueNumbering === numbering}
              className="menu__item"
              // A protein's ruler already counts its residues (#66).
              disabled={isProtein}
              title={isProtein ? "A protein's ruler already counts its residues" : title}
              onClick={() => {
                analytics.trackOnce('view', 'format', 'residue-numbers');
                editorStore.setResidueNumbering(numbering);
              }}
            >
              <span>{label}</span>
              <Tick on={residueNumbering === numbering} />
            </button>
          ))}
          <div className="menu__separator" />
          <p className="menu__group-label">
            Trace
            {!hasTrace && <span className="menu__group-note"> · for AB1 reads</span>}
          </p>
          {TRACE_SIZES.map(([size, label, title]) => (
            <button
              key={size}
              type="button"
              role="menuitemradio"
              aria-checked={traceSize === size}
              className="menu__item"
              // Always listed, so it can be found; set only with a trace to see.
              disabled={!hasTrace}
              title={hasTrace ? title : 'Only a read opened from an AB1 file has a trace'}
              onClick={() => {
                analytics.trackOnce('view', 'format', 'trace');
                editorStore.setTraceSize(size);
              }}
            >
              <span>{label}</span>
              <Tick on={traceSize === size} />
            </button>
          ))}
          <div className="menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            title="Put the map, the sequence and the sidebar back to the sizes they started at"
            onClick={() => {
              editorStore.resetLayout();
            }}
          >
            <span>Reset the layout</span>
          </button>
        </div>
      )}
    </div>
  );
}
