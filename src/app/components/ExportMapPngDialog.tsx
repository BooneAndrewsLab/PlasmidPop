import { useEffect, useMemo, useState } from 'react';

import { type CutSite, type DocumentDiff, type SeqDocument, gcWindowFor, hasTool } from '@/core';
import { drawableFeatures } from '@/view/visibleFeatures';
import { exportMapSvg } from '@/view/svg';

import { analytics } from '../analytics';
import { PNG_SCALES, pngSize, rasterizeSvg } from '../mapPng';
import { downloadBlob } from '../saveFile';
import { useGcProfile } from '../state/useGcProfile';

interface Props {
  readonly doc: SeqDocument;
  /** The cut sites the map shows now; the dialog's "Enzymes" starts on when there are any. */
  readonly cutSites: readonly CutSite[];
  readonly edits: DocumentDiff | null;
  readonly gcWindow: number | null;
  readonly showGc: boolean;
  /** The file name the download starts from, without extension. */
  readonly stem: string;
  readonly onClose: () => void;
  /** Where the PNG goes, and how it is drawn; the browser's unless a test says otherwise. */
  readonly download?: (name: string, blob: Blob) => void;
  readonly rasterize?: (svg: string, scale: number) => Promise<Blob>;
}

const FONT_SCALES: readonly (readonly [number, string])[] = [
  [0.8, 'Smaller'],
  [1, 'Normal'],
  [1.25, 'Larger'],
  [1.6, 'Largest'],
];

/**
 * Export map as PNG (#212, item 89): the map export's SVG, rasterised at a
 * chosen scale, with figure options that belong to the picture and leave the
 * on-screen view alone. The preview is the SVG itself, so what is shown is
 * what is drawn.
 */
export function ExportMapPngDialog({
  doc,
  cutSites,
  edits,
  gcWindow,
  showGc,
  stem,
  onClose,
  download = downloadBlob,
  rasterize = rasterizeSvg,
}: Props) {
  const [scale, setScale] = useState<number>(2);
  const [transparent, setTransparent] = useState(false);
  const [enzymes, setEnzymes] = useState(cutSites.length > 0);
  const gcAvailable = hasTool(doc, 'gc');
  const [gcOn, setGcOn] = useState(showGc && gcAvailable);
  const [centre, setCentre] = useState(true);
  const [fontScale, setFontScale] = useState(1);
  const types = useMemo(
    () => [...new Set(drawableFeatures(doc.features.all()).map((f) => f.type))].sort(),
    [doc],
  );
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const window = gcWindowFor(gcWindow, doc.length, true);
  const profile = useGcProfile(doc, window, gcOn);

  const built = useMemo(() => {
    try {
      return {
        svg: exportMapSvg(doc, {
          cutSites: enzymes ? cutSites : [],
          edits,
          transparent,
          showCentre: centre,
          fontScale,
          featureTypes: new Set(types.filter((t) => !hidden.has(t))),
          gc:
            gcOn && profile !== null && profile.length === doc.length ? { profile, window } : null,
        }),
        error: null,
      };
    } catch (e) {
      return { svg: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [
    doc,
    cutSites,
    edits,
    enzymes,
    transparent,
    centre,
    fontScale,
    types,
    hidden,
    gcOn,
    profile,
    window,
  ]);

  const size = built.svg === null ? null : pngSize(built.svg, scale);
  const problem = built.error ?? (size !== null && !size.ok ? size.message : null);
  const previewUrl =
    built.svg === null ? null : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.svg)}`;

  const submit = (): void => {
    if (built.svg === null || problem !== null || busy) return;
    setBusy(true);
    setFailure(null);
    rasterize(built.svg, scale)
      .then((blob) => {
        analytics.track('file', 'export', 'map-png');
        download(`${stem}_map.png`, blob);
        onClose();
      })
      .catch((e: unknown) => {
        setFailure(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };

  const toggle = (label: string, checked: boolean, on: (v: boolean) => void, disabled = false) => (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          on(e.target.checked);
        }}
      />
      {label}
    </label>
  );

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-map-png-title"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="export-map-png-title" className="dialog__title">
          Export map as PNG
        </h2>
        <div className="dialog__body export-sequence export-map">
          <div className="export-map__preview">
            {previewUrl !== null && <img src={previewUrl} alt="Preview of the exported map" />}
          </div>
          <div className="segmented" role="group" aria-label="Scale">
            {PNG_SCALES.map((s) => (
              <button
                key={s}
                type="button"
                className={`segmented__button${scale === s ? ' segmented__button--active' : ''}`}
                aria-pressed={scale === s}
                onClick={() => {
                  setScale(s);
                }}
              >
                {`${String(s)}×`}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Background">
            {[
              [false, 'White'],
              [true, 'Transparent'],
            ].map(([t, label]) => (
              <button
                key={String(t)}
                type="button"
                className={`segmented__button${transparent === t ? ' segmented__button--active' : ''}`}
                aria-pressed={transparent === t}
                onClick={() => {
                  setTransparent(t === true);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Text size">
            {FONT_SCALES.map(([f, label]) => (
              <button
                key={f}
                type="button"
                className={`segmented__button${fontScale === f ? ' segmented__button--active' : ''}`}
                aria-pressed={fontScale === f}
                onClick={() => {
                  setFontScale(f);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {toggle('Restriction enzymes', enzymes, setEnzymes)}
          {toggle('GC ring', gcOn, setGcOn, !gcAvailable)}
          {toggle('Name and length in the middle', centre, setCentre)}
          {types.length > 0 && (
            <fieldset className="export-map__types">
              <legend>Features</legend>
              {types.map((t) => (
                <span key={t}>
                  {toggle(t, !hidden.has(t), (on) => {
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(t);
                      else next.add(t);
                      return next;
                    });
                  })}
                </span>
              ))}
            </fieldset>
          )}
          <p className="export-sequence__hint" aria-live="polite">
            {problem ??
              failure ??
              (size?.ok === true
                ? `${String(size.width)} × ${String(size.height)} pixels. These options are for the figure only; the map on screen is unchanged.`
                : '')}
          </p>
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={problem !== null || busy}
          >
            Export
          </button>
        </div>
      </form>
    </div>
  );
}
