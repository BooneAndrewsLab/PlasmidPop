import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type CutSite,
  type DocumentDiff,
  type Range,
  type SeqDocument,
  gcWindowFor,
  hasTool,
  isEmptyRange,
} from '@/core';
import {
  pageOf,
  type LinearExportOptions,
  MAX_EXPORT_BASES_PER_ROW,
  MIN_EXPORT_BASES_PER_ROW,
  exportLinearSvg,
  exportLinearSvgPages,
  exportMapSvg,
  measureLinearSvg,
  type PaperSize,
} from '@/view/svg';
import { drawableFeatures } from '@/view/visibleFeatures';

import { analytics } from '../analytics';
import {
  FIGURE_FILE_TYPES,
  FIGURE_FONT_SCALES,
  PAPER_SIZES,
  defaultPaper,
  type FigureFileType,
  type FigureSize,
  type FigureView,
  pagesMegapixels,
  pagesProblem,
  pngProblem,
  rasterPdfTime,
  workingText,
} from '../exportFigure';
import {
  type ExportJobOptions,
  type ExportProgress,
  eachPage,
  isCancelled,
  throwIfCancelled,
} from '../exportJob';
import { PNG_SCALES, pngSizeOf, rasterizeSvg, svgPixelSize } from '../mapPng';
import { PDF_MODES, type PdfMode, type PdfOptions, exportPdf } from '../pdfExport';
import { downloadBlob, downloadText } from '../saveFile';
import {
  type ExportRangeKind,
  pagesZip,
  rangeBoxes,
  readBasesPerRow,
  readExportRange,
} from '../sequenceExport';
import { editorStore } from '../state/editorStore';
import { useGcProfile } from '../state/useGcProfile';
import { type Choice, SegmentedChoices } from './SegmentedChoices';

interface Props {
  readonly doc: SeqDocument;
  readonly selection: Range | null;
  /** The view's own bases per row, or null when it fits the window. */
  readonly basesPerRow: number | null;
  /** Everything else the sequence view's export follows from the view: format, edit marks. */
  readonly format: Omit<LinearExportOptions, 'range' | 'basesPerRow' | 'selection' | 'cutSites'>;
  /** The cut sites the views show now; the figure's "Restriction enzymes" starts on when there are any. */
  readonly cutSites: readonly CutSite[];
  readonly edits: DocumentDiff | null;
  readonly gcWindow: number | null;
  readonly showGc: boolean;
  /** The file name the downloads start from, without extension. */
  readonly stem: string;
  readonly onClose: () => void;
  /** Where a file goes; the browser's download unless a test says otherwise. */
  readonly download?: (name: string, text: string) => void;
  /** The same for a PNG, ZIP or PDF; how a picture is drawn; and how a PDF is written. */
  readonly downloadFile?: (name: string, blob: Blob) => void;
  readonly rasterize?: (svg: string, scale: number) => Promise<Blob>;
  readonly pdf?: (pages: readonly string[], options: PdfOptions) => Promise<Blob>;
}

/** The rows the sequence view's preview draws: enough to see the format, cheap for any length. */
const PREVIEW_ROWS = 4;

const VIEWS: readonly Choice<FigureView>[] = [
  { value: 'map', label: 'Map', title: 'The circular map with its labels' },
  { value: 'sequence', label: 'Sequence view', title: 'The sequence rows, laid out as on screen' },
];

const SCALES: readonly Choice<number>[] = PNG_SCALES.map((s) => ({
  value: s,
  label: `${String(s)}×`,
  title: s === 1 ? "The SVG's own pixel size" : `${String(s)} times the SVG's pixel size`,
}));

const BACKGROUNDS: readonly Choice<boolean>[] = [
  { value: false, label: 'White' },
  { value: true, label: 'Transparent', title: 'No background, for placing over a colour' },
];

const px = (n: number): string => Math.round(n).toLocaleString();

/**
 * A setting's row: its name on the left, its control on the right and, when
 * it has one, a hint under the control that is always there, so the row is
 * the same height whatever is chosen (#241).
 */
function Row({
  label,
  hint,
  disabled = false,
  columns = false,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly disabled?: boolean;
  /** Many toggles, lined up in columns. */
  readonly columns?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={`export-figure__row${disabled ? ' export-figure__row--off' : ''}`}>
      <span className="export-figure__label">{label}</span>
      <div className={`export-figure__control${columns ? ' export-figure__control--columns' : ''}`}>
        {children}
      </div>
      {hint !== undefined && <p className="export-figure__hint">{hint}</p>}
    </div>
  );
}

/**
 * Export figure (#240, item 94): one dialog for the map (#212, item 89) and
 * the sequence view (#30, #236, item 8), as SVG, PNG or PDF (#242). Every
 * row is always rendered and disabled when it does not apply, so nothing
 * moves as the choices change (#241), and the size is checked from the
 * layout on every change, before anything is drawn (#243). A4 pages leave
 * as one file: a ZIP of SVGs or PNGs, or a PDF of as many pages.
 */
export function ExportFigureDialog({
  doc,
  selection,
  basesPerRow,
  format,
  cutSites,
  edits,
  gcWindow,
  showGc,
  stem,
  onClose,
  download = downloadText,
  downloadFile = downloadBlob,
  rasterize = rasterizeSvg,
  pdf: makePdf = exportPdf,
}: Props) {
  // A protein has no map (#66): the dialog then offers the sequence view alone.
  const hasMap = hasTool(doc, 'circular');
  const [view, setView] = useState<FigureView>(hasMap ? 'map' : 'sequence');
  const [fileType, setFileType] = useState<FigureFileType>('svg');
  const [scale, setScale] = useState<number>(2);
  const [pdfMode, setPdfMode] = useState<PdfMode>('vector');
  const [transparent, setTransparent] = useState(false);

  // The map's figure.
  const [enzymes, setEnzymes] = useState(cutSites.length > 0);
  const gcAvailable = hasTool(doc, 'gc');
  const [gcOn, setGcOn] = useState(showGc && gcAvailable);
  const [centre, setCentre] = useState(true);
  const [fontScale, setFontScale] = useState(1);
  const types = useMemo(
    () => [...new Set(drawableFeatures(doc.features.all()).map((f) => f.type))].sort(),
    [doc],
  );
  // Starts from the types hidden on screen (#305); the figure's own ticks are its own after that.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(editorStore.getState().hiddenFeatureTypes),
  );

  // The sequence view's.
  const selected = selection !== null && !isEmptyRange(selection) ? selection : null;
  const hasSelection = selected !== null;
  const [kind, setKind] = useState<ExportRangeKind>(hasSelection ? 'selection' : 'whole');
  const initial =
    selected !== null ? rangeBoxes(doc, selected) : { from: '1', to: String(doc.length) };
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [perRow, setPerRow] = useState(String(basesPerRow ?? 60));
  const [pages, setPages] = useState(false);
  // Suggested by the browser's language each time the dialog opens; never stored.
  const [paper, setPaper] = useState<PaperSize>(() =>
    defaultPaper(typeof navigator === 'undefined' ? [] : navigator.languages),
  );

  // The export under way (#247, #248): its stop, and what it is doing. The
  // controller is a ref so that Escape and an unmount can stop it without
  // re-subscribing; `busy` is what the render reads.
  const jobRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  /** Why the last export did not happen, kept until a setting changes. */
  const [failure, setFailure] = useState<{ settings: string; message: string } | null>(null);

  /** Stops the export under way, if there is one, and leaves the dialog as it was. */
  const cancel = useCallback((): void => {
    const job = jobRef.current;
    if (job === null) return;
    jobRef.current = null;
    job.abort();
    setBusy(false);
    setProgress(null);
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // Keyboard users land on the first choice, as in the other dialogs.
    formRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    // Escape stops an export under way; pressed again, it closes.
    const esc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (jobRef.current === null) onClose();
      else cancel();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose, cancel]);
  // Closed some other way while exporting: the work stops and no file appears later.
  useEffect(
    () => () => {
      jobRef.current?.abort();
      jobRef.current = null;
    },
    [],
  );

  const pdf = fileType === 'pdf';
  // What has pixels, so the scale applies and the size is checked against a canvas.
  const raster = fileType === 'png' || (pdf && pdfMode === 'raster');
  const typeName = fileType.toUpperCase();

  const window = gcWindowFor(gcWindow, doc.length, true);
  const profile = useGcProfile(doc, window, view === 'map' && gcOn);
  const map = useMemo(() => {
    if (view !== 'map') return null;
    try {
      return {
        svg: exportMapSvg(doc, {
          cutSites: enzymes ? cutSites : [],
          edits,
          transparent,
          showCentre: centre,
          fontScale,
          featureTypes: new Set(types.filter((t) => !hidden.has(t))),
          // The transcript rows open on screen are open in the figure (item 115).
          ...(format.expandedGroups === undefined ? {} : { expandedGroups: format.expandedGroups }),
          gc:
            gcOn && profile !== null && profile.length === doc.length ? { profile, window } : null,
        }),
        error: null,
      };
    } catch (e) {
      return { svg: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [
    view,
    doc,
    cutSites,
    edits,
    enzymes,
    transparent,
    centre,
    fontScale,
    types,
    hidden,
    format.expandedGroups,
    gcOn,
    profile,
    window,
  ]);

  const range = useMemo(
    () => readExportRange(doc, kind, selection, from, to),
    [doc, kind, selection, from, to],
  );
  const rowWidth = readBasesPerRow(perRow);
  const exportRange = range.ok ? range.range : undefined;
  const options = useMemo(
    (): LinearExportOptions | null =>
      exportRange !== undefined && rowWidth !== null
        ? {
            ...format,
            cutSites,
            range: exportRange,
            basesPerRow: rowWidth,
            // The selection is shown highlighted when it is what is exported, as before.
            selection: kind === 'selection' ? selection : null,
            transparent,
            paper,
          }
        : null,
    [format, cutSites, exportRange, rowWidth, kind, selection, transparent, paper],
  );
  // Measuring lays the rows out without drawing them: cheap enough for every keystroke.
  const measure = useMemo(() => {
    if (view !== 'sequence' || options === null) return null;
    try {
      return { ...measureLinearSvg(doc, options), error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [view, doc, options]);
  // The preview is the first rows, drawn as the file would draw them.
  const sequencePreview = useMemo(() => {
    if (view !== 'sequence' || options === null || measure?.error !== null) {
      return null;
    }
    const start = options.range?.start ?? 0;
    const end = options.range?.end ?? doc.length;
    try {
      return exportLinearSvg(doc, {
        ...options,
        range: { start, end: Math.min(end, start + PREVIEW_ROWS * (options.basesPerRow ?? 60)) },
      });
    } catch {
      return null;
    }
  }, [view, doc, options, measure]);

  const size: FigureSize | null =
    view === 'map'
      ? map?.svg == null
        ? null
        : svgPixelSize(map.svg)
      : measure?.error !== null
        ? null
        : pages
          ? { width: pageOf(paper).width, height: pageOf(paper).height }
          : { width: measure.width, height: measure.height };

  const problem: string | null = (() => {
    if (view === 'map') {
      if (map?.error != null) return map.error;
    } else {
      if (!range.ok) return range.message;
      if (rowWidth === null)
        return `Bases per row is a number from ${String(MIN_EXPORT_BASES_PER_ROW)} to ${String(MAX_EXPORT_BASES_PER_ROW)}.`;
      if (measure?.error != null) return measure.error;
      if (pages && measure !== null) {
        const tooMany = pagesProblem(
          measure.pages,
          pageOf(paper),
          scale,
          pdf
            ? pdfMode === 'raster'
              ? 'pdf-raster'
              : 'pdf-vector'
            : fileType === 'png'
              ? 'png'
              : 'svg',
        );
        if (tooMany !== null) return tooMany;
      }
    }
    if (raster && size !== null)
      return pngProblem(size, scale, view, { basesPerRow: rowWidth ?? 60, pages });
    return null;
  })();
  // A failure belongs to the export that was tried; the next change clears it.
  const settings = JSON.stringify([
    view,
    fileType,
    scale,
    pdfMode,
    transparent,
    kind,
    from,
    to,
    perRow,
    pages,
    paper,
    enzymes,
    gcOn,
    centre,
    fontScale,
    [...hidden],
  ]);
  const shown = problem ?? (failure?.settings === settings ? failure.message : null);
  // What the export is doing, in the room the problem takes (#246, #247):
  // the pages are drawn with the browser given its turns and the file is
  // written in a worker, so the message and its spinner keep moving.
  const working = busy && shown === null ? workingText(progress) : null;

  const previewSvg = view === 'map' ? (map?.svg ?? null) : sequencePreview;
  const previewUrl =
    previewSvg === null
      ? null
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSvg)}`;
  const paperLabel = paper === 'letter' ? 'US Letter' : 'A4';
  const caption = ((): string => {
    if (size === null) return '';
    const pixels = raster ? pngSizeOf(size, scale) : null;
    const at =
      pixels === null
        ? `${typeName}, ${px(size.width)} × ${px(size.height)} px`
        : `${typeName}, ${px(size.width * scale)} × ${px(size.height * scale)} pixels at ${String(scale)}×`;
    if (view === 'map') return at;
    if (measure?.error !== null) return '';
    const first =
      measure.rows > PREVIEW_ROWS ? `; the first ${String(PREVIEW_ROWS)} rows shown` : '';
    return pages
      ? `${String(measure.pages)} ${paperLabel} ${measure.pages === 1 ? 'page' : 'pages'} of ${at}${first}`
      : `${String(measure.rows)} ${measure.rows === 1 ? 'row' : 'rows'}, ${at}${first}`;
  })();

  const pagesHint = ((): string => {
    if (view === 'map') return 'The map is one picture; pages are for the sequence view.';
    if (!pages) return 'One file, as tall as its rows.';
    if (measure?.error !== null) return '';
    const n = String(measure.pages);
    if (measure.pages === 1) return `One page, downloaded as one ${typeName} file.`;
    if (!pdf) return `${n} pages, downloaded as one ZIP of ${n} ${typeName}s.`;
    // A raster PDF of many pages is minutes of background work (#248): say so.
    const time =
      pdfMode === 'raster'
        ? rasterPdfTime(pagesMegapixels(measure.pages, pageOf(paper), scale))
        : null;
    return `${n} pages, downloaded as one PDF of ${n} pages${time === null ? '' : `, ${time} to make`}.`;
  })();

  /** The PDF asked for: vector, or each page a picture at the scale. */
  const pdfOptions = (title: string, job: ExportJobOptions): PdfOptions =>
    pdfMode === 'vector'
      ? { mode: 'vector', title, ...job }
      : { mode: 'raster', title, scale, rasterize, ...job };

  /**
   * Runs an export that may take a while as the one job the dialog has:
   * closing when the file is downloaded, saying why when it failed, and
   * doing neither when Cancel or Escape stopped it. A job stopped is a job
   * forgotten: its promise, settling later, changes nothing.
   */
  const start = (made: (job: ExportJobOptions) => Promise<void>): void => {
    const controller = new AbortController();
    jobRef.current = controller;
    setBusy(true);
    setProgress(null);
    const mine = (): boolean => jobRef.current === controller;
    made({
      signal: controller.signal,
      onProgress: (p) => {
        if (mine()) setProgress(p);
      },
    })
      .then(() => {
        if (mine()) onClose();
      })
      .catch((e: unknown) => {
        if (!mine() || isCancelled(e)) return;
        setFailure({ settings, message: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        if (!mine()) return;
        jobRef.current = null;
        setBusy(false);
        setProgress(null);
      });
  };

  /** Hands the file to the browser, unless the job was stopped while it was being made. */
  const deliver = (job: ExportJobOptions, name: string, blob: Blob, event: string): void => {
    throwIfCancelled(job.signal);
    analytics.track('file', 'export', event);
    downloadFile(name, blob);
  };

  const submitMap = (svg: string): void => {
    if (fileType === 'svg') {
      analytics.track('file', 'export', 'map-svg');
      download(`${stem}_map.svg`, svg);
      onClose();
      return;
    }
    start(async (job) => {
      if (pdf) {
        const blob = await makePdf([svg], pdfOptions(`${doc.name} map`, job));
        deliver(job, `${stem}_map.pdf`, blob, `map-pdf-${pdfMode}`);
      } else {
        const blob = await rasterize(svg, scale);
        deliver(job, `${stem}_map.png`, blob, 'map-png');
      }
    });
  };

  const submitSequence = (opts: LinearExportOptions, suffix: string): void => {
    const name = `${stem}_${suffix}`;
    const drawn = ((): string[] | string => {
      try {
        return pages ? exportLinearSvgPages(doc, opts) : [exportLinearSvg(doc, opts)];
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    })();
    if (typeof drawn === 'string') {
      setFailure({ settings, message: drawn });
      return;
    }
    if (fileType === 'svg' && !pages) {
      analytics.track('file', 'export', kind === 'selection' ? 'selection-svg' : 'sequence-svg');
      download(`${name}.svg`, drawn[0] ?? '');
      onClose();
      return;
    }
    if (fileType === 'svg') {
      start(async (job) => {
        const encoder = new TextEncoder();
        job.onProgress?.({ stage: 'writing', done: 0, total: 1 });
        const zip = await pagesZip(
          name,
          'svg',
          drawn.map((svg) => encoder.encode(svg)),
          job,
        );
        deliver(job, `${name}.zip`, zip, 'sequence-svg-zip');
      });
      return;
    }
    if (pdf) {
      start(async (job) => {
        const blob = await makePdf(drawn, pdfOptions(`${doc.name} sequence`, job));
        deliver(job, `${name}.pdf`, blob, `sequence-pdf-${pdfMode}`);
      });
      return;
    }
    start(async (job) => {
      // One picture at a time: a canvas of a page's size is the memory a browser lends.
      const blobs = await eachPage(drawn, 'drawing', job, (svg) => rasterize(svg, scale));
      if (pages) {
        const bytes = await Promise.all(
          blobs.map(async (blob) => new Uint8Array(await blob.arrayBuffer())),
        );
        job.onProgress?.({ stage: 'writing', done: 0, total: 1 });
        const zip = await pagesZip(name, 'png', bytes, job);
        deliver(job, `${name}.zip`, zip, 'sequence-png-zip');
      } else if (blobs[0] !== undefined) {
        deliver(job, `${name}.png`, blobs[0], 'sequence-png');
      }
    });
  };

  const submit = (): void => {
    if (problem !== null || busy) return;
    setFailure(null);
    if (view === 'map') {
      if (map?.svg != null) submitMap(map.svg);
    } else if (options !== null && range.ok) {
      submitSequence(options, range.suffix);
    }
  };

  const kinds: readonly Choice<ExportRangeKind>[] = [
    { value: 'whole', label: 'Whole sequence' },
    {
      value: 'selection',
      label: 'Selection',
      title: 'The rows holding the selection, with it highlighted',
      disabled: !hasSelection,
      disabledTitle: 'Nothing is selected',
    },
    { value: 'custom', label: 'From–to', title: 'The rows holding a range of bases' },
  ];

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

  const sequence = view === 'sequence';
  const pagesOn = sequence && pages;

  return (
    <div className="dialog-backdrop">
      <form
        ref={formRef}
        className="dialog dialog--wide export-figure"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-figure-title"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="export-figure-title" className="dialog__title">
          Export figure
        </h2>
        <div className="dialog__body export-figure__body">
          <figure className="export-figure__preview">
            <div className="export-figure__picture">
              {previewUrl !== null && (
                <img
                  src={previewUrl}
                  alt={sequence ? 'Preview of the first rows' : 'Preview of the exported map'}
                />
              )}
            </div>
            <figcaption className="export-figure__caption">{caption}</figcaption>
          </figure>
          <div className="export-figure__options">
            <h3 className="export-figure__heading">What</h3>
            <Row label="View">
              <SegmentedChoices
                label="View"
                choices={VIEWS.map((v) =>
                  v.value === 'map' && !hasMap
                    ? { ...v, disabled: true, disabledTitle: 'A protein has no map' }
                    : v,
                )}
                value={view}
                onChange={setView}
              />
            </Row>
            {sequence ? (
              <>
                <Row label="Bases">
                  <SegmentedChoices
                    label="Bases to export"
                    choices={kinds}
                    value={kind}
                    onChange={setKind}
                  />
                </Row>
                <Row
                  label="Range"
                  disabled={kind !== 'custom'}
                  hint={
                    doc.isCircular
                      ? 'Bases 1-based, both included; a “to” before “from” runs through the origin.'
                      : 'Bases 1-based, both included.'
                  }
                >
                  <input
                    className="panel__number"
                    inputMode="numeric"
                    aria-label="From base"
                    disabled={kind !== 'custom'}
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                    }}
                  />
                  <span>to</span>
                  <input
                    className="panel__number"
                    inputMode="numeric"
                    aria-label="To base"
                    disabled={kind !== 'custom'}
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                    }}
                  />
                </Row>
              </>
            ) : (
              <>
                <Row
                  label="Show"
                  hint="These options are for the figure only; the map on screen is unchanged."
                >
                  {toggle('Restriction enzymes', enzymes, setEnzymes)}
                  {toggle('GC ring', gcOn, setGcOn, !gcAvailable)}
                  {toggle('Name and length in the middle', centre, setCentre)}
                </Row>
                <Row label="Features" disabled={types.length === 0} columns={types.length > 0}>
                  {types.length === 0 ? (
                    <span className="export-figure__none">None in this document</span>
                  ) : (
                    types.map((t) => (
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
                    ))
                  )}
                </Row>
              </>
            )}
            <h3 className="export-figure__heading">How big</h3>
            {sequence ? (
              <Row
                label="Bases per row"
                hint="Whole rows, numbered as in the document: the first and last may hold a few bases either side of the range."
              >
                <input
                  className="panel__number"
                  inputMode="numeric"
                  aria-label="Bases per row"
                  value={perRow}
                  onChange={(e) => {
                    setPerRow(e.target.value);
                  }}
                />
                <span className="export-figure__unit">
                  {String(MIN_EXPORT_BASES_PER_ROW)}–{String(MAX_EXPORT_BASES_PER_ROW)}
                </span>
              </Row>
            ) : (
              <Row label="Text size">
                <SegmentedChoices
                  label="Text size"
                  choices={FIGURE_FONT_SCALES}
                  value={fontScale}
                  onChange={setFontScale}
                />
              </Row>
            )}
            <Row label="File type">
              <SegmentedChoices
                label="File type"
                choices={FIGURE_FILE_TYPES}
                value={fileType}
                onChange={setFileType}
              />
            </Row>
            <Row label="Scale" disabled={!raster}>
              <SegmentedChoices
                label="Scale"
                choices={SCALES}
                value={scale}
                disabled={!raster}
                disabledTitle={
                  pdf
                    ? 'A vector PDF has no pixels; the scale is for a raster one'
                    : 'An SVG has no pixels; the scale is for a PNG or a raster PDF'
                }
                onChange={setScale}
              />
            </Row>
            <Row label="PDF" disabled={!pdf}>
              <SegmentedChoices
                label="PDF drawing"
                choices={PDF_MODES}
                value={pdfMode}
                disabled={!pdf}
                disabledTitle="Vector or raster is a choice for a PDF"
                onChange={setPdfMode}
              />
            </Row>
            <Row label="Background">
              <SegmentedChoices
                label="Background"
                choices={BACKGROUNDS}
                value={transparent}
                onChange={setTransparent}
              />
            </Row>
            <h3 className="export-figure__heading">Pages</h3>
            <Row label="Split" disabled={!sequence} hint={pagesHint}>
              {toggle('Split into pages', sequence && pages, setPages, !sequence)}
            </Row>
            <Row label="Paper size" disabled={!pagesOn}>
              <SegmentedChoices
                label="Paper size"
                choices={PAPER_SIZES}
                value={paper}
                disabled={!pagesOn}
                disabledTitle="The paper size is for the sequence view split into pages"
                onChange={setPaper}
              />
            </Row>
          </div>
        </div>
        <div className="dialog__actions export-figure__actions">
          <div className="export-figure__message">
            <p className="export-figure__problem panel__note panel__note--error" role="alert">
              {shown}
            </p>
            <p className="export-figure__working panel__note" role="status">
              {working !== null && (
                <>
                  <span className="spinner" aria-hidden="true" />
                  {working}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="button"
            onClick={busy ? cancel : onClose}
            data-tip={busy ? 'Stop the export; the dialog stays open' : undefined}
          >
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
