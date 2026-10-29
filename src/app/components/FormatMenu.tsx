import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { type Feature, type TranslationScope, GC_WINDOW_CHOICES } from '@/core';
import { type FontSize, type ResidueNumbering, FONT_SIZES } from '@/view/linear';
import {
  describeTranscript,
  transcriptOptionLabel,
  planTranscripts,
  transcriptKey,
  transcriptPicksNote,
  transcriptVariants,
} from '@/view/transcriptPick';
import { drawableTypes, hiddenTypeCount, hiddenTypesNote } from '@/view/visibleFeatures';

import { analytics } from '../analytics';
import { type TraceSize, editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { type Choice, SegmentedChoices } from './SegmentedChoices';
import { useAltKey, useBindingLabel } from './useAltKey';
import { useMenu } from './useMenu';

const SIZE_LABELS: Readonly<Record<FontSize, string>> = {
  11: 'Small',
  13: 'Medium',
  16: 'Large',
};

/** Row widths offered beside "Fit"; wider than the window scrolls sideways. */
const ROW_WIDTHS: readonly number[] = [30, 60, 90, 120];

/**
 * The tick is decoration: `aria-checked` is what says which item is chosen.
 * A `hint` before it is the item's key, which `aria-keyshortcuts` carries.
 */
function Tick({ on, hint }: { readonly on: boolean; readonly hint?: string }) {
  return (
    <span className="menu__shortcut" aria-hidden="true">
      {hint}
      {on ? (hint === undefined ? '✓' : ' ✓') : ''}
    </span>
  );
}

/** A read's trace: how tall above its bases, or not drawn (#55). */
const TRACE_SIZES: readonly Choice<TraceSize>[] = [
  { value: 'off', label: 'Hidden', title: "Draw the read's bases without its chromatogram" },
  { value: 'short', label: 'Short', title: 'The chromatogram above the bases, low' },
  {
    value: 'tall',
    label: 'Tall',
    title: 'The chromatogram at twice the height, for reading close peaks',
  },
];

/** Which CDS features get a translation line (#304). */
const TRANSLATION_SCOPES: readonly Choice<TranslationScope>[] = [
  { value: 'all', label: 'Every CDS', title: 'A line for every CDS, isoforms stacked' },
  { value: 'selected', label: 'Selected CDS', title: 'A line for the selected CDS only' },
  {
    value: 'gene',
    label: 'One per gene',
    title:
      'The longest CDS of each gene, with the selected CDS too; a CDS with no gene qualifier keeps its own line',
  },
];

/** Which residues of a CDS translation carry their number (#97). */
const RESIDUE_NUMBERINGS: readonly Choice<ResidueNumbering>[] = [
  { value: 'off', label: 'Off', title: 'Draw the amino acids without numbers, in lower rows' },
  {
    value: 'tens',
    label: 'Every 10th',
    title: 'Number the first residue and every tenth over the translations',
  },
  {
    value: 'every',
    label: 'All',
    title:
      'Number every residue; those with no room are left out until the text is larger or the rows shorter',
  },
];

const TEXT_SIZES: readonly Choice<FontSize>[] = FONT_SIZES.map((size) => ({
  value: size,
  label: SIZE_LABELS[size],
  title: `${SIZE_LABELS[size]} text; the rows, lanes and labels scale with it`,
}));

const ROW_CHOICES: readonly Choice<number | null>[] = [
  { value: null, label: 'Fit', title: 'As many as the window holds, in tens' },
  ...ROW_WIDTHS.map((bases) => ({
    value: bases,
    label: String(bases),
    title: `Always ${bases} bases in a row, scrolling sideways if the window is narrower`,
  })),
];

/**
 * A setting's row: its name on the left and its control on the right, as in
 * a settings list. `sub` indents a row that belongs to the one above it.
 */
function Row({
  label,
  note,
  sub = false,
  tip,
  children,
}: {
  readonly label: string;
  readonly note?: string | undefined;
  readonly sub?: boolean;
  readonly tip?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className={`menu__item menu__row${sub ? ' menu__row--sub' : ''}`} data-tip={tip}>
      <span className="menu__row-label">
        {label}
        {note !== undefined && <span className="menu__group-note"> · {note}</span>}
      </span>
      {children}
    </div>
  );
}

/**
 * A setting with a few choices, as a row of buttons (`SegmentedChoices`):
 * every choice in view and one click to try it. Disabled as a whole when
 * the setting has nothing to apply to, with the reason as the row's tooltip.
 */
function Choices<T extends string | number | null>({
  label,
  note,
  choices,
  value,
  disabled = false,
  disabledTip,
  onChange,
}: {
  readonly label: string;
  readonly note?: string | undefined;
  readonly choices: readonly Choice<T>[];
  /** The chosen one; `undefined` when the setting holds a value not offered here. */
  readonly value: T | undefined;
  readonly disabled?: boolean;
  readonly disabledTip?: string | undefined;
  readonly onChange: (value: T) => void;
}) {
  return (
    <Row label={label} note={note} tip={disabled ? disabledTip : undefined}>
      <SegmentedChoices
        label={label}
        choices={choices}
        value={value}
        disabled={disabled}
        small
        onChange={onChange}
      />
    </Row>
  );
}

/**
 * The feature types the document has, each a tick: unticked, the map, the
 * sequence view and the ribbon leave that type out (#305). The Features list
 * still shows them, and nothing is written to the file.
 */
function FeatureTypes({ features }: { readonly features: readonly Feature[] }) {
  const { hiddenFeatureTypes } = useEditorState();
  const types = drawableTypes(features);
  const hidden = hiddenTypeCount(features, hiddenFeatureTypes);
  if (types.length === 0) return null;
  return (
    <>
      <p className="menu__group-label">
        Feature types
        {hidden > 0 && <span className="menu__group-note"> · {hiddenTypesNote(hidden)}</span>}
      </p>
      {types.map((type) => {
        const on = !hiddenFeatureTypes.has(type);
        return (
          <button
            key={type}
            type="button"
            role="menuitemcheckbox"
            aria-checked={on}
            className="menu__item"
            data-tip={`Draw ${type} features in the map and the sequence view; the Features list keeps them`}
            onClick={() => {
              analytics.trackOnce('view', 'format', 'feature-types');
              editorStore.setFeatureTypeHidden(type, on);
            }}
          >
            <span>{type}</span>
            <Tick on={on} />
          </button>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          role="menuitem"
          className="menu__item"
          onClick={() => {
            editorStore.setHiddenFeatureTypes([]);
          }}
        >
          <span>Show all feature types</span>
        </button>
      )}
      <div className="menu__separator" role="separator" />
    </>
  );
}

/**
 * One row per gene with two or more transcript variants (item 119): a select
 * of **All** and each variant's accession. Picking one leaves the gene's
 * other mRNAs, and the CDSs and peptides only they carry, out of the views
 * and the Features list; nothing is removed, and All brings them back.
 * Absent when the document has no gene with variants.
 */
function TranscriptPicker({
  features,
  seqLength,
}: {
  readonly features: readonly Feature[];
  readonly seqLength: number;
}) {
  const { transcriptPicks } = useEditorState();
  const variants = useMemo(() => transcriptVariants(features, seqLength), [features, seqLength]);
  const picked = useMemo(
    () => planTranscripts(features, transcriptPicks, seqLength).picked,
    [features, transcriptPicks, seqLength],
  );
  if (variants.size === 0) return null;
  return (
    <>
      <p className="menu__group-label">
        Transcripts
        {picked.size > 0 && (
          <span className="menu__group-note"> · {transcriptPicksNote(picked.size)}</span>
        )}
      </p>
      {[...variants].map(([gene, mRNAs]) => {
        const chosen = picked.get(gene)?.[0];
        return (
          <Row
            key={gene}
            label={gene}
            tip={`Which of the ${String(mRNAs.length)} ${gene} transcripts the views draw, with the CDSs and peptides it can carry; the others stay in the document`}
          >
            <select
              aria-label={`Transcript of ${gene}`}
              value={chosen === undefined ? 'all' : transcriptKey(chosen)}
              onChange={(e) => {
                analytics.trackOnce('view', 'format', 'transcript');
                editorStore.pickTranscript(gene, e.target.value === 'all' ? null : e.target.value);
              }}
            >
              <option value="all">All {mRNAs.length}</option>
              {mRNAs.map((m) => (
                <option key={m.id} value={transcriptKey(m)} title={describeTranscript(m)}>
                  {transcriptOptionLabel(m)}
                </option>
              ))}
            </select>
          </Row>
        );
      })}
      {picked.size > 0 && (
        <button
          type="button"
          role="menuitem"
          className="menu__item"
          onClick={() => {
            editorStore.setTranscriptPicks(new Map());
          }}
        >
          <span>Show all transcripts</span>
        </button>
      )}
      <div className="menu__separator" role="separator" />
    </>
  );
}

/**
 * How the sequence view draws — text size, how many bases go in a row,
 * whether the complement is numbered too and whether bases are coloured,
 * then the tracks around the strands — and, since it is the other thing
 * about the arrangement rather than the document, a way back from wherever
 * the splitters were dragged to. These are preferences for the app, not the
 * document, and they are remembered between sessions.
 *
 * Laid out as a settings list rather than a menu of one item per choice
 * (item 92): a setting is one row, its choices side by side, so the whole
 * menu is in view on a laptop screen and a choice is one click without
 * reading past the others.
 */
/**
 * The toolbar's three toggles as menu items, for a window where they do not
 * fit beside the other groups (#296): the same store setters and the same
 * analytics as the buttons, and the same keys shown beside them.
 */
function ViewToggles() {
  const { showComplement, showTranslations, showCutSites } = useEditorState();
  const complementKey = useBindingLabel('toggle-complement');
  const translationsKey = useBindingLabel('toggle-translations');
  const cutSitesKey = useBindingLabel('toggle-cut-sites');
  const items: readonly {
    readonly label: string;
    readonly on: boolean;
    readonly hint: string;
    readonly tip: string;
    readonly event: string;
    readonly flip: () => void;
  }[] = [
    {
      label: 'Complement',
      on: showComplement,
      hint: complementKey,
      tip: 'Show the complement strand',
      event: 'complement',
      flip: () => {
        editorStore.setShowComplement(!showComplement);
      },
    },
    {
      label: 'Translations',
      on: showTranslations,
      hint: translationsKey,
      tip: 'Show amino acids under CDS features',
      event: 'translations',
      flip: () => {
        editorStore.setShowTranslations(!showTranslations);
      },
    },
    {
      label: 'Cut sites',
      on: showCutSites,
      hint: cutSitesKey,
      tip: 'Show cut sites of the enzymes ticked in the Enzymes tab; hiding them keeps the ticks',
      event: 'cut-sites',
      flip: () => {
        editorStore.setShowCutSites(!showCutSites);
      },
    },
  ];
  return (
    <>
      <p className="menu__group-label">Show</p>
      {items.map((item) => (
        <button
          key={item.event}
          type="button"
          role="menuitemcheckbox"
          aria-checked={item.on}
          aria-keyshortcuts={item.hint}
          className="menu__item"
          data-tip={`${item.tip} (${item.hint})`}
          onClick={() => {
            analytics.trackOnce('view', 'toggle', item.event);
            item.flip();
          }}
        >
          <span>{item.label}</span>
          <Tick on={item.on} hint={item.hint} />
        </button>
      ))}
      <div className="menu__separator" role="separator" />
    </>
  );
}

export function FormatMenu({
  viewToggles = false,
}: {
  /**
   * Whether the menu starts with the Complement, Translations and Cut sites
   * toggles: true where the toolbar has no room for their own buttons.
   */
  readonly viewToggles?: boolean;
} = {}) {
  const {
    seqFontSize,
    seqBasesPerRow,
    numberComplement,
    translationScope,
    residueNumbering,
    colorBases,
    showGc,
    gcWindow,
    traceSize,
    history,
    baseColors,
    hiddenFeatureTypes,
    transcriptPicks,
  } = useEditorState();
  const features = history?.present.features.all() ?? [];
  const seqLength = history?.present.length ?? 0;
  const hiddenTypes = hiddenTypeCount(features, hiddenFeatureTypes);
  const pickedGenes = planTranscripts(features, transcriptPicks, seqLength).picked.size;
  const notes = [
    ...(hiddenTypes > 0 ? [`${String(hiddenTypes)} hidden`] : []),
    ...(pickedGenes > 0 ? [`${String(pickedGenes)} picked`] : []),
  ];
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
  useAltKey('format-menu', () => {
    analytics.shortcut('alt+o');
    focusFirst.current = !open;
    toggle();
  });
  const key = useBindingLabel('format-menu');
  const gcKey = useBindingLabel('toggle-gc');
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
        aria-keyshortcuts={key}
        data-tip={`How the sequence view draws: text size, bases per row, numbering, colours and tracks; which feature types and transcripts show; and the pane sizes (${key})${hiddenTypes > 0 ? `. ${hiddenTypesNote(hiddenTypes)}` : ''}${pickedGenes > 0 ? `. ${transcriptPicksNote(pickedGenes)}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        Format
        {notes.map((note) => (
          <span key={note} className="menu__group-note">
            {' '}
            · {note}
          </span>
        ))}{' '}
        <span className="button__caret">▾</span>
      </button>
      {open && (
        <div className="menu__list menu__list--settings" role="menu" aria-label="Format and layout">
          {viewToggles && <ViewToggles />}
          <p className="menu__group-label">Sequence view</p>
          <Choices
            label="Text size"
            choices={TEXT_SIZES}
            value={seqFontSize}
            onChange={(size) => {
              analytics.trackOnce('view', 'format', 'font-size');
              editorStore.setSeqFontSize(size);
            }}
          />
          <Choices
            label="Bases per row"
            choices={ROW_CHOICES}
            value={customRow ? undefined : seqBasesPerRow}
            onChange={(bases) => {
              analytics.trackOnce('view', 'format', 'bases-per-row');
              editorStore.setSeqBasesPerRow(bases);
            }}
          />
          <label
            className="menu__item menu__row menu__row--sub"
            data-tip="Any whole number of bases, 10 to 1,000"
          >
            <span className="menu__row-label">Other</span>
            <span className="menu__row-control">
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
            </span>
          </label>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={numberComplement}
            className="menu__item"
            data-tip="Repeat the row's position beside the complement strand"
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
            data-tip="Give A, C, G and T each their own colour"
            onClick={() => {
              analytics.trackOnce('view', 'format', 'color-bases');
              editorStore.setColorBases(!colorBases);
            }}
          >
            <span>Colour the bases</span>
            <Tick on={colorBases} />
          </button>
          {colorBases && (
            <div
              className="menu__item menu__row menu__row--sub menu__row--swatches"
              role="group"
              aria-label="Base colours"
            >
              {(['a', 'c', 'g', 't'] as const).map((base) => (
                <label
                  key={base}
                  className="menu__swatch"
                  data-tip={`The colour of ${base.toUpperCase()}`}
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
                data-tip="Back to the theme's colours, which differ between light and dark"
                onClick={() => {
                  editorStore.setBaseColors(null);
                }}
              >
                Reset
              </button>
            </div>
          )}
          <div className="menu__separator" role="separator" />
          <p className="menu__group-label">Tracks</p>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showGc}
            aria-keyshortcuts={gcKey}
            className="menu__item"
            disabled={isProtein}
            data-tip={
              isProtein
                ? 'GC content is a property of DNA'
                : `A GC content track under the strands and inside the map (${gcKey})`
            }
            onClick={() => {
              analytics.trackOnce('view', 'format', 'gc');
              editorStore.setShowGc(!showGc);
            }}
          >
            <span>GC content track</span>
            <Tick on={showGc} hint={gcKey} />
          </button>
          {showGc && !isProtein && (
            <Row
              label="Window"
              sub
              tip="Bases the GC fraction is averaged over; automatic is 50 on the sequence and about 1 % of its length on the map"
            >
              <select
                aria-label="GC window"
                value={gcWindow === null ? 'auto' : String(gcWindow)}
                onChange={(e) => {
                  analytics.trackOnce('view', 'format', 'gc-window');
                  editorStore.setGcWindow(
                    e.target.value === 'auto' ? null : Number(e.target.value),
                  );
                }}
              >
                <option value="auto">Automatic</option>
                {GC_WINDOW_CHOICES.map((w) => (
                  <option key={w} value={w}>
                    {w} bp
                  </option>
                ))}
              </select>
            </Row>
          )}
          <Choices
            label="Translations"
            note={isProtein ? 'for CDS translations' : undefined}
            choices={TRANSLATION_SCOPES}
            value={translationScope}
            // A protein has no CDS to translate (#66).
            disabled={isProtein}
            disabledTip="A protein has no CDS to translate"
            onChange={(scope) => {
              analytics.trackOnce('view', 'format', 'translation-scope');
              editorStore.setTranslationScope(scope);
            }}
          />
          <Choices
            label="Residue numbers"
            note={isProtein ? 'for CDS translations' : undefined}
            choices={RESIDUE_NUMBERINGS}
            value={residueNumbering}
            // A protein's ruler already counts its residues (#66).
            disabled={isProtein}
            disabledTip="A protein's ruler already counts its residues"
            onChange={(numbering) => {
              analytics.trackOnce('view', 'format', 'residue-numbers');
              editorStore.setResidueNumbering(numbering);
            }}
          />
          <Choices
            label="Trace"
            note={hasTrace ? undefined : 'for AB1 reads'}
            choices={TRACE_SIZES}
            value={traceSize}
            // Always listed, so it can be found; set only with a trace to see.
            disabled={!hasTrace}
            disabledTip="Only a read opened from an AB1 file has a trace"
            onChange={(size) => {
              analytics.trackOnce('view', 'format', 'trace');
              editorStore.setTraceSize(size);
            }}
          />
          <div className="menu__separator" role="separator" />
          <FeatureTypes features={features} />
          <TranscriptPicker features={features} seqLength={seqLength} />
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            data-tip="Put the map, the sequence and the sidebar back to the sizes they started at"
            onClick={() => {
              editorStore.resetLayout();
            }}
          >
            <span>Reset the layout</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            data-tip="See every shortcut, and put an action on another key (#79)"
            onClick={() => {
              toggle();
              editorStore.showKeysDialog(true);
            }}
          >
            <span>Keyboard shortcuts…</span>
          </button>
        </div>
      )}
    </div>
  );
}
