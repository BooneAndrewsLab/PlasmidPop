import { useEffect, useRef } from 'react';

import { type FontSize, FONT_SIZES } from '@/view/linear';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
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

/**
 * How the sequence view draws: text size, how many bases go in a row,
 * whether the complement is numbered too and whether bases are coloured,
 * and — since it is the other thing about the arrangement rather than the
 * document — a way back from wherever the splitters were dragged to. These
 * are preferences for the app, not the document, and they are remembered
 * between sessions.
 */
export function FormatMenu() {
  const { seqFontSize, seqBasesPerRow, numberComplement, colorBases } = useEditorState();
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
