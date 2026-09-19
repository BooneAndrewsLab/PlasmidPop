import { type FontSize, FONT_SIZES } from '@/view/linear';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
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
 * whether the complement is numbered too and whether bases are coloured.
 * These are preferences for the app, not the document, and they are
 * remembered between sessions.
 */
export function FormatMenu() {
  const { seqFontSize, seqBasesPerRow, numberComplement, colorBases } = useEditorState();
  // Every item leaves the menu open: the point is to try a size or a row
  // width and see the view change behind it. Escape or a click outside closes.
  const { open, toggle, ref } = useMenu();

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="button"
        aria-label="Format"
        title="Text size, bases per row, numbering and base colours in the sequence view"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        Format <span className="button__caret">▾</span>
      </button>
      {open && (
        <div className="menu__list" role="menu" aria-label="Sequence view format">
          <p className="menu__group-label">Text size</p>
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="menuitemradio"
              aria-checked={seqFontSize === size}
              className="menu__item"
              onClick={() => {
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
              editorStore.setColorBases(!colorBases);
            }}
          >
            <span>Colour the bases</span>
            <Tick on={colorBases} />
          </button>
        </div>
      )}
    </div>
  );
}
