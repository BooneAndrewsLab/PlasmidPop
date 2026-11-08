import { type KeyboardEvent, useMemo, useRef, useState } from 'react';

import {
  type BatchTable,
  type CloningBatchRecipe,
  type OverlapKit,
  type SeqDocument,
  BATCH_ROW_LIMIT,
  BatchTableError,
  KIT_NAMES,
  KIT_OVERLAP,
  checkPool,
  formatDg,
  goldenGateEnzymes,
  isCodingFeature,
  parseBatchText,
  parseBatchWorkbook,
  scanRows,
  validateBatch,
  writeBatchCsv,
} from '@/core';
import { readSequenceData, readTableFile } from '@/io';

import {
  type BatchSortKey,
  type ResultLine,
  batchDrafts,
  batchOligos,
  batchOrderOligos,
  resultLines,
  sortLines,
  statusOf,
} from '../batchResults';
import {
  type BatchMethod,
  batchSession,
  batchTemplates,
  cancelBatch,
  startBatch,
  startCloningBatch,
} from '../batchSession';
import { RECIPE_COLUMNS, ignoredColumns } from '../cloningResults';
import { editorStore } from '../state/editorStore';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { pickerAccept } from '../pickerAccept';
import { CloningBatchResults } from './CloningBatchResults';
import { OrderSheetDialog } from './OrderSheetDialog';
import { SortTh } from './SortTh';
import { nextRowIndex, toggleSort } from './tableKeys';

const TABLE_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls,.ods';
const SEQUENCE_FILE_ACCEPT = '.gb,.gbk,.gbff,.genbank,.fasta,.fa,.fas,.fna,.dna,.txt';

const PLACEHOLDER =
  'name,region,change\nK12A,1000..1002,GCT\n\nor paste rows from a spreadsheet; columns are\nname, template, region, sequence, tm, size, change';

/** The method select's words, and the placeholder a cloning method gives the rows box. */
const METHODS: readonly (readonly [BatchMethod, string])[] = [
  ['primers', 'Primer pairs'],
  ['restriction', 'Restriction sites'],
  ['golden-gate', 'Golden Gate part'],
  ['homology', 'Homology ends'],
];
const CLONING_PLACEHOLDER =
  'name,template,region\nACT1,genome,1000-2500\nGFP,,sequence of the insert\n\nor paste rows from a spreadsheet: one insert per row,\na region of a template or the bases themselves';

const RECIPE_HINT = {
  restriction:
    'Each insert gets the two enzymes’ sites on its primers: the enzyme column is a pair (EcoRI/BamHI), and left and right are extra bases between the sites and the insert.',
  'golden-gate':
    'Each insert becomes a part with the destination’s overhangs: the enzyme column is one enzyme (or two that share the tube), and left and right are the overhangs.',
  homology:
    'Each insert’s primers carry the vector’s ends as tails; the kit column gives one row another kit.',
} as const;

const KITS: readonly OverlapKit[] = ['in-fusion', 'nebuilder', 'yeast'];

/** How the table's text reads: its rows, or why it does not. */
function readTable(text: string): { table: BatchTable | null; problem: string | null } {
  if (text.trim() === '') return { table: null, problem: null };
  try {
    return { table: parseBatchText(text), problem: null };
  } catch (e) {
    if (e instanceof BatchTableError) return { table: null, problem: e.message };
    throw e;
  }
}

const bool = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

const tmText = (x: number | null): string => (x === null || Number.isNaN(x) ? '–' : x.toFixed(1));

/** The selected row in full: both oligos, what is to be said about the row, and its actions. */
function RowDetail({
  line,
  product,
  shown,
  onOpen,
}: {
  readonly line: ResultLine;
  /** The mutant plasmid of a mutagenesis row. */
  readonly product: SeqDocument | null;
  /** Whether the map is drawing the row. */
  readonly shown: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <aside className="detail" aria-label={`Row ${line.name}`}>
      <div className="detail__head">
        <strong>{line.name}</strong>
        <span className="dnote">
          line {line.line}
          {line.product === null
            ? ''
            : ` · ${line.kind === 'mutagenesis' ? 'plasmid' : 'product'} ${line.product.toLocaleString()} bp`}
        </span>
      </div>
      {line.status === 'designed' && (
        <table className="dt">
          <tbody>
            {(['forward', 'reverse'] as const).map((strand) => {
              const bases = strand === 'forward' ? line.forward : line.reverse;
              const t = strand === 'forward' ? line.forwardTm : line.reverseTm;
              return (
                <tr key={strand}>
                  <th scope="row">{strand === 'forward' ? '→ Forward' : '← Reverse'}</th>
                  <td className="panel__mono dt__seq">{bases}</td>
                  <td className="wst__n">{bases.length} nt</td>
                  <td className="wst__n">Tm {tmText(t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {line.messages.length > 0 && (
        <ul className="panel__list">
          {line.messages.map((m, i) => (
            <li key={i} className={line.status === 'failed' ? 'dt__warn' : undefined}>
              {m}
            </li>
          ))}
        </ul>
      )}
      {line.status === 'designed' && !shown && (
        <p className="panel__note panel__note--quiet">
          Not drawn on the map: the row was designed on another template, or the document has
          changed since.
        </p>
      )}
      {product !== null && (
        <div className="actions">
          <button
            type="button"
            className="button button--small"
            data-tip="Open the template with this change made, as a new tab"
            onClick={onOpen}
          >
            Open product
          </button>
        </div>
      )}
    </aside>
  );
}

/**
 * The workspace's Batch page (#358, item 141): a table of rows (pasted,
 * uploaded or made by the scan helper), each designed on its own and shown
 * as it is done. A bad row is listed with its line and goes unrun; a failed
 * one is listed and the rest go on; a cancel keeps what was done. What is
 * held lives in `batchSession`, so a page switch loses nothing and a run
 * goes on while the page is away.
 */
export function BatchPage({ doc }: { readonly doc: SeqDocument }) {
  const { documentId, documents, primerCriteria, fidelityTable } = useEditorState();
  const session = batchSession.use(documentId);
  const { text, run, selected, sort, method } = session;
  const cloningMethod = method !== 'primers';
  const cloning = session.cloning;
  const update = (patch: Parameters<typeof batchSession.update>[1]): void => {
    batchSession.update(documentId, patch);
  };

  const others = useMemo(
    () => documents.filter((d) => d.documentId !== documentId).map((d) => d.history.present),
    [documents, documentId],
  );
  const { templates, dropped } = useMemo(
    () => batchTemplates(doc, others, session.loaded),
    [doc, others, session.loaded],
  );
  const picked = templates.find((t) => t.name === session.template) ?? templates[0] ?? undefined;
  const templateName = picked?.name ?? doc.name;

  const { table, problem } = useMemo(() => readTable(text), [text]);
  const validation = useMemo(
    () =>
      table === null ? null : validateBatch(table, { templates, defaultTemplate: templateName }),
    [table, templates, templateName],
  );
  const bad = validation?.results.flatMap((r) => (r.ok ? [] : [r])) ?? [];
  const ready = validation?.rows ?? [];
  const running = run?.running === true || cloning?.running === true;
  const vector = templates.find((t) => t.name === session.vector) ?? templates[0];
  const ignored = useMemo(
    () => (cloningMethod ? ignoredColumns(validation?.rows ?? [], method) : []),
    [cloningMethod, validation, method],
  );
  // The run whose progress and results the page shows: the method's own.
  const active = cloningMethod ? cloning : run;
  const enzymes = useMemo(() => goldenGateEnzymes().map((e) => e.name), []);

  // The scan helper's boxes: transient, so not in the session.
  const cdsFeatures = useMemo(
    () => (picked?.document.features.all() ?? []).filter(isCodingFeature),
    [picked],
  );
  const [scanFeature, setScanFeature] = useState('');
  const [scanTo, setScanTo] = useState('A');
  const [scanFrom, setScanFrom] = useState('');
  const [scanThrough, setScanThrough] = useState('');
  const scanned = cdsFeatures.find((f) => f.id === scanFeature) ?? cdsFeatures[0];

  const tableInput = useRef<HTMLInputElement | null>(null);
  const templateInput = useRef<HTMLInputElement | null>(null);
  const rowsEl = useRef<HTMLElement | null>(null);

  const addTableFile = async (file: File): Promise<void> => {
    try {
      const read = await readTableFile(new Uint8Array(await file.arrayBuffer()));
      if (read.kind === 'text') {
        update({ text: read.text, generated: false, note: `Read ${file.name}.`, error: null });
        return;
      }
      const parsed = parseBatchWorkbook(read.sheets);
      update({
        text: writeBatchCsv(parsed.rows),
        generated: false,
        note: `Read ${file.name}${read.sheets.length > 1 ? `, sheet “${parsed.sheet ?? ''}”` : ''}.`,
        error: null,
      });
    } catch (e) {
      update({ error: `${file.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const addTemplates = async (files: readonly File[]): Promise<void> => {
    const loaded = [...session.loaded];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const read = await readSequenceData(await file.arrayBuffer(), file.name);
        for (const d of read.documents) loaded.push({ name: d.name, document: d });
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    update({
      loaded,
      error: failures.length === 0 ? null : failures.join(' '),
      note: `${bool(loaded.length, 'record', 'records')} loaded as templates.`,
    });
  };

  const generate = (): void => {
    if (picked === undefined || scanned === undefined) return;
    const num = (s: string): number | undefined => {
      const n = Number.parseInt(s, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const from = num(scanFrom);
    const through = num(scanThrough);
    try {
      const made = scanRows(picked.document, scanned, {
        template: picked.name,
        to: scanTo.trim() === '' ? 'A' : scanTo.trim(),
        ...(from === undefined ? {} : { from }),
        ...(through === undefined ? {} : { through }),
      });
      update({
        text: writeBatchCsv(made.rows),
        generated: true,
        error: null,
        note: `${bool(made.rows.length, 'row', 'rows')} for ${scanned.name} replaced the table${
          made.skipped.length === 0
            ? '.'
            : `; ${bool(made.skipped.length, 'codon', 'codons')} left out (already that residue, a stop, or split by an intron).`
        }`,
      });
    } catch (e) {
      update({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const lines = useMemo(() => resultLines(run?.rows ?? []), [run?.rows]);
  const sorted = useMemo(() => sortLines(lines, sort), [lines, sort]);
  const designed = lines.filter((l) => l.status === 'designed');
  const failed = lines.length - designed.length;
  // The pool is read once the run is over: it is a check on the whole order.
  const pool = useMemo(
    () => (run === null || run.running ? null : checkPool(batchOligos(lines))),
    [run, lines],
  );

  const [ordering, setOrdering] = useState(false);
  const orderOligos = useMemo(() => batchOrderOligos(lines), [lines]);

  const selectedLine = lines.find((l) => l.index === selected);
  const selectedRow = run?.rows.find((r) => r.index === selected);
  const product =
    selectedRow?.status === 'designed' && selectedRow.kind === 'mutagenesis'
      ? selectedRow.design.mutant
      : null;
  const shown =
    selectedRow !== undefined &&
    run !== null &&
    selectedRow.status === 'designed' &&
    run.ranOn === doc &&
    run.templates.some(
      (t) =>
        t.document === doc &&
        t.name.toLowerCase() === (run.source[selectedRow.index]?.template ?? '').toLowerCase(),
    );

  const stop = sorted.some((l) => l.index === selected) ? selected : (sorted[0]?.index ?? null);
  const onRowsKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const at = sorted.findIndex((l) => l.index === selected);
    const to = nextRowIndex(e.key, at < 0 ? null : at, sorted.length);
    if (to === null) return;
    e.preventDefault();
    const next = sorted[to];
    if (next === undefined) return;
    update({ selected: next.index });
    rowsEl.current?.querySelector<HTMLElement>(`[data-row="${next.index}"]`)?.focus();
  };
  const onSort = (key: BatchSortKey): void => {
    update((s) => ({ sort: toggleSort(s.sort, key) }));
  };

  const saveAll = (): void => {
    void savePrimers(batchDrafts(lines, run?.templateName ?? templateName), 'design').then((r) => {
      update({
        said:
          r.added.length === 0
            ? 'Already in My primers.'
            : `Saved ${bool(r.added.length, 'primer', 'primers')} to My primers${
                r.duplicates > 0 ? `; ${r.duplicates} already there` : ''
              }.`,
      });
    });
  };

  return (
    <div className="results">
      <div className="panel__group">
        <label className="panel__field panel__field--row">
          <span>Method</span>
          <select
            className="panel__select"
            aria-label="Method"
            value={method}
            onChange={(e) => {
              const next = METHODS.find(([m]) => m === e.target.value)?.[0] ?? 'primers';
              update({ method: next, selected: null, said: null });
            }}
          >
            {METHODS.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {cloningMethod && (
          <>
            <label className="panel__field panel__field--row">
              <span>Vector</span>
              <select
                className="panel__select"
                aria-label="Vector"
                value={vector?.name ?? ''}
                onChange={(e) => {
                  update({ vector: e.target.value });
                }}
              >
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                    {t.document === doc ? ' (this document)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {method === 'restriction' && (
              <>
                <label className="panel__field panel__field--row">
                  <span>5′ enzyme</span>
                  <input
                    className="panel__input"
                    aria-label="5′ enzyme"
                    value={session.forwardEnzyme}
                    onChange={(e) => {
                      update({ forwardEnzyme: e.target.value });
                    }}
                  />
                </label>
                <label className="panel__field panel__field--row">
                  <span>3′ enzyme</span>
                  <input
                    className="panel__input"
                    aria-label="3′ enzyme"
                    value={session.reverseEnzyme}
                    onChange={(e) => {
                      update({ reverseEnzyme: e.target.value });
                    }}
                  />
                </label>
              </>
            )}
            {method === 'golden-gate' && (
              <label className="panel__field panel__field--row">
                <span>Enzyme</span>
                <select
                  className="panel__select"
                  aria-label="Enzyme"
                  value={session.goldenGateEnzyme}
                  onChange={(e) => {
                    update({ goldenGateEnzyme: e.target.value });
                  }}
                >
                  {enzymes.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {method === 'homology' && (
              <>
                <label className="panel__field panel__field--row">
                  <span>Kit</span>
                  <select
                    className="panel__select"
                    aria-label="Kit"
                    value={session.kit}
                    onChange={(e) => {
                      update({ kit: KITS.find((k) => k === e.target.value) ?? 'in-fusion' });
                    }}
                  >
                    {KITS.map((k) => (
                      <option key={k} value={k}>
                        {KIT_NAMES[k]}
                      </option>
                    ))}
                  </select>
                </label>
                {session.kit === 'yeast' && (
                  <label className="panel__field panel__field--row">
                    <span>Homology (bp)</span>
                    <input
                      className="panel__input"
                      aria-label="Homology in bp"
                      inputMode="numeric"
                      value={session.overlap}
                      onChange={(e) => {
                        update({ overlap: Number(e.target.value) });
                      }}
                    />
                  </label>
                )}
                <p className="panel__note panel__note--quiet">
                  The vector must be linear: {KIT_NAMES[session.kit]} takes{' '}
                  {session.kit === 'yeast' ? session.overlap : KIT_OVERLAP[session.kit]} bases of
                  its ends onto each primer.
                </p>
              </>
            )}
            <p className="panel__note panel__note--quiet">
              {RECIPE_HINT[method]} Columns read: name, {RECIPE_COLUMNS[method].join(', ')}.
            </p>
            {ignored.length > 0 && (
              <p className="panel__note dt__warn">
                Not read by this method, and ignored: {ignored.join(', ')}.
              </p>
            )}
          </>
        )}
        <label className="panel__field panel__field--row">
          <span>{cloningMethod ? 'Insert template' : 'Template'}</span>
          <select
            className="panel__select"
            aria-label="Template"
            value={templateName}
            onChange={(e) => {
              update({ template: e.target.value });
            }}
          >
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.document === doc ? ' (this document)' : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="panel__note panel__note--quiet">
          {cloningMethod
            ? 'A row with a region and no template cell takes its insert from this one. '
            : 'A row with no template cell uses this one. '}
          A template cell may name any open tab or loaded record.
          {dropped.length > 0 &&
            ` Not offered, as another already has the name: ${dropped.join(', ')}.`}
        </p>
        <label className="panel__field panel__field--stack">
          <span>Rows</span>
          <textarea
            className="panel__textarea"
            rows={8}
            spellCheck={false}
            aria-label="Rows"
            placeholder={cloningMethod ? CLONING_PLACEHOLDER : PLACEHOLDER}
            value={text}
            onChange={(e) => {
              update({ text: e.target.value, generated: false, note: null, error: null });
            }}
          />
        </label>
        <div className="actions">
          <button
            type="button"
            className="button button--small"
            onClick={() => tableInput.current?.click()}
          >
            Upload a table…
          </button>
          <button
            type="button"
            className="button button--small"
            data-tip="Load GenBank or FASTA records to name in a row's template cell"
            onClick={() => templateInput.current?.click()}
          >
            Load templates…
          </button>
          {text !== '' && (
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => {
                update({ text: '', generated: false, note: null, error: null });
              }}
            >
              Clear
            </button>
          )}
          <input
            ref={tableInput}
            type="file"
            accept={pickerAccept(TABLE_FILE_ACCEPT)}
            aria-label="Table file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file !== undefined) void addTableFile(file);
            }}
          />
          <input
            ref={templateInput}
            type="file"
            multiple
            accept={pickerAccept(SEQUENCE_FILE_ACCEPT)}
            aria-label="Template files"
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length > 0) void addTemplates(files);
            }}
          />
        </div>
        {!cloningMethod && (
          <details className="panel__details panel__options">
            <summary className="panel__details-summary">
              <span className="panel__details-title">Generate scan rows…</span>
              <span className="panel__details-note">every codon of a gene to one residue</span>
            </summary>
            {cdsFeatures.length === 0 ? (
              <p className="panel__note panel__note--quiet">
                {templateName} has no coding feature (CDS) to scan.
              </p>
            ) : (
              <>
                <label className="panel__field panel__field--row">
                  <span>Gene</span>
                  <select
                    className="panel__select"
                    aria-label="Gene to scan"
                    value={scanned?.id ?? ''}
                    onChange={(e) => {
                      setScanFeature(e.target.value);
                    }}
                  >
                    {cdsFeatures.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name === '' ? f.type : f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="panel__field panel__field--row">
                  <span>To residue</span>
                  <input
                    className="panel__input"
                    aria-label="Residue"
                    maxLength={1}
                    value={scanTo}
                    onChange={(e) => {
                      setScanTo(e.target.value);
                    }}
                  />
                </label>
                <label className="panel__field panel__field--row">
                  <span>From residue</span>
                  <input
                    className="panel__input"
                    aria-label="From residue"
                    inputMode="numeric"
                    placeholder="1"
                    value={scanFrom}
                    onChange={(e) => {
                      setScanFrom(e.target.value);
                    }}
                  />
                </label>
                <label className="panel__field panel__field--row">
                  <span>Through</span>
                  <input
                    className="panel__input"
                    aria-label="Through residue"
                    inputMode="numeric"
                    placeholder="end"
                    value={scanThrough}
                    onChange={(e) => {
                      setScanThrough(e.target.value);
                    }}
                  />
                </label>
                <div className="actions">
                  <button type="button" className="button button--small" onClick={generate}>
                    Generate
                  </button>
                </div>
                <p className="panel__note panel__note--quiet">
                  Replaces the table with one row per codon, which you can edit or trim before
                  running. At most {BATCH_ROW_LIMIT} rows run at once: scan a window of the protein
                  for a long gene.
                </p>
              </>
            )}
          </details>
        )}
        {session.note !== null && (
          <p className="panel__note" role="status">
            {session.note}
          </p>
        )}
        {(session.error ?? problem) !== null && (
          <p className="panel__error">{session.error ?? problem}</p>
        )}
      </div>

      {validation !== null && (
        <div className="panel__group">
          <p className="panel__note" role="status">
            {bool(ready.length, 'row', 'rows')} ready
            {bad.length > 0 && `, ${bool(bad.length, 'row', 'rows')} with a problem and not run`}
            {validation.overLimit > 0 &&
              `; ${bool(validation.overLimit, 'row', 'rows')} past the limit of ${BATCH_ROW_LIMIT} not looked at`}
            .
          </p>
          {bad.length > 0 && (
            <ul className="panel__list" aria-label="Rows with a problem">
              {bad.map((b) => (
                <li key={b.line} className="dt__warn">
                  Line {b.line}
                  {b.name === '' ? '' : ` (${b.name})`}: {b.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="panel__note panel__note--quiet">
        Up to {BATCH_ROW_LIMIT} rows are designed at once, one after another; a row that cannot be
        designed is listed and the others go on.
      </p>
      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          disabled={running || ready.length === 0 || validation === null}
          onClick={() => {
            if (cloningMethod) {
              if (vector === undefined) return;
              const recipe: CloningBatchRecipe =
                method === 'restriction'
                  ? {
                      recipe: 'restriction',
                      forward: session.forwardEnzyme.trim(),
                      reverse: session.reverseEnzyme.trim(),
                    }
                  : method === 'golden-gate'
                    ? { recipe: 'golden-gate', enzyme: session.goldenGateEnzyme }
                    : {
                        recipe: 'homology',
                        kit: session.kit,
                        ...(session.kit === 'yeast' ? { overlap: session.overlap } : {}),
                      };
              void startCloningBatch(documentId, {
                rows: ready,
                templates,
                vector: vector.document,
                recipe,
                settings: { criteria: primerCriteria },
                fidelity: fidelityTable,
              });
              return;
            }
            void startBatch(documentId, {
              rows: ready,
              templates,
              front: doc,
              templateName,
              generated: session.generated,
              criteria: primerCriteria,
            });
          }}
        >
          Design {ready.length > 0 ? bool(ready.length, 'row', 'rows') : 'rows'}
        </button>
        {active !== null && active.running && (
          <div className="align-progress">
            <progress
              className="align-progress__bar"
              value={active.progress}
              max={1}
              aria-label="Batch progress"
            />
            <span className="align-progress__label" aria-live="polite">
              {active.rows.length} of {active.source.length}
            </span>
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => {
                cancelBatch(documentId);
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {cloningMethod && cloning !== null && (
        <>
          {cloning.refused !== null && (
            <p className="panel__error" role="alert">
              {cloning.refused}
            </p>
          )}
          <CloningBatchResults
            documentId={documentId}
            run={cloning}
            selected={selected}
            sort={sort}
            said={session.said}
          />
        </>
      )}
      {!cloningMethod && run !== null && (
        <>
          <p className="panel__note" role="status">
            {run.cancelled
              ? `Cancelled: ${run.rows.length} of ${run.source.length} rows were done and are kept.`
              : running
                ? `Designing: ${run.rows.length} of ${run.source.length} rows.`
                : `${bool(designed.length, 'row', 'rows')} designed${
                    failed > 0 ? `, ${failed} failed` : ''
                  }.`}
          </p>
          <div className="tablewrap">
            <table className="wst cands" role="grid" aria-label="Batch results">
              <thead>
                <tr>
                  <SortTh column="row" sort={sort} onSort={onSort} numeric tip="Order in the table">
                    #
                  </SortTh>
                  <SortTh column="status" sort={sort} onSort={onSort}>
                    Status
                  </SortTh>
                  <SortTh column="name" sort={sort} onSort={onSort}>
                    Name
                  </SortTh>
                  <th className="wst__th">Forward 5′→3′</th>
                  <th className="wst__th">Reverse 5′→3′</th>
                  <SortTh
                    column="tm"
                    sort={sort}
                    onSort={onSort}
                    numeric
                    tip="Forward and reverse Tm, °C; sorted by the forward's"
                  >
                    Tm
                  </SortTh>
                  <SortTh
                    column="product"
                    sort={sort}
                    onSort={onSort}
                    numeric
                    tip="Product length, bp (the plasmid's, for a mutagenesis)"
                  >
                    Product
                  </SortTh>
                  <th className="wst__th">Warnings</th>
                </tr>
              </thead>
              <tbody
                ref={(el) => {
                  rowsEl.current = el;
                }}
                onKeyDown={onRowsKeyDown}
              >
                {sorted.map((l) => {
                  const on = l.index === selected;
                  const state = statusOf(l);
                  return (
                    <tr
                      key={l.index}
                      className={`cand${on ? ' is-selected' : ''}`}
                      data-row={l.index}
                      tabIndex={l.index === stop ? 0 : -1}
                      aria-selected={on}
                      onClick={() => {
                        update({ selected: l.index });
                      }}
                    >
                      <td className="wst__n">{l.index + 1}</td>
                      <td>
                        <span className={`spec ${state === 'designed' ? 'dt__ok' : 'dt__warn'}`}>
                          {state}
                        </span>
                      </td>
                      <td>{l.name}</td>
                      <td className="panel__mono wst__seq">{l.forward}</td>
                      <td className="panel__mono wst__seq">{l.reverse}</td>
                      <td className="wst__n">
                        {l.status === 'failed'
                          ? ''
                          : `${tmText(l.forwardTm)} / ${tmText(l.reverseTm)}`}
                      </td>
                      <td className="wst__n">{l.product?.toLocaleString() ?? ''}</td>
                      <td>
                        {l.messages.length === 0
                          ? ''
                          : l.messages.length === 1
                            ? l.messages[0]
                            : `${l.messages[0] ?? ''} (+${l.messages.length - 1})`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selectedLine === undefined ? (
            <p className="panel__note panel__note--quiet results__hint">
              Select a row to see it in full and, for the document in front, on the map. Each row
              shows the best pair; the Design page lists the others for a region.
            </p>
          ) : (
            <RowDetail
              line={selectedLine}
              product={product}
              shown={shown}
              onOpen={() => {
                if (product === null) return;
                editorStore.openDocument(product, null, [], { scratch: true });
              }}
            />
          )}
          <div className="actions">
            <button
              type="button"
              className="button button--small"
              disabled={running || designed.length === 0}
              data-tip="Keep every designed oligo in My primers, in this browser; those already there are skipped"
              onClick={saveAll}
            >
              Save all to My primers
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={running || designed.length === 0}
              data-tip="A plate-format CSV of the designed oligos to copy into a vendor's order form; saved on this computer only"
              onClick={() => {
                setOrdering(true);
              }}
            >
              Order sheet…
            </button>
          </div>
          {session.said !== null && (
            <p className="panel__note panel__note--quiet" role="status">
              {session.said}
            </p>
          )}
          {pool !== null && designed.length > 0 && (
            <section className="detail" aria-label="Pool check">
              <div className="detail__head">
                <strong>Pool check</strong>
                <span className="dnote">{bool(designed.length * 2, 'oligo', 'oligos')}</span>
              </div>
              <ul className="panel__list">
                <li className={pool.duplicateNames.length > 0 ? 'dt__warn' : 'dt__ok'}>
                  {pool.duplicateNames.length === 0
                    ? 'No duplicate names.'
                    : `Duplicate names: ${pool.duplicateNames.map((d) => d.name).join(', ')}.`}
                </li>
                <li className={pool.sameBases.length > 0 ? 'dt__warn' : 'dt__ok'}>
                  {pool.sameBases.length === 0
                    ? 'No two names share bases.'
                    : `Same bases under different names: ${pool.sameBases
                        .map((s) => s.names.join(' = '))
                        .join('; ')}.`}
                </li>
                <li className={pool.dimers.length > 0 ? 'dt__warn' : 'dt__ok'}>
                  {pool.dimers.length === 0
                    ? 'No strong cross-dimers (ΔG ≤ −6 kcal/mol).'
                    : `${bool(pool.dimers.length, 'strong cross-dimer', 'strong cross-dimers')} (ΔG ≤ −6 kcal/mol), most stable first: ${pool.dimers
                        .slice(0, 3)
                        .map((d) => `${d.a} × ${d.b} ${formatDg(d.dg)}`)
                        .join('; ')}${pool.dimers.length > 3 ? '; …' : ''}.`}
                </li>
                {pool.tm !== null && (
                  <li className={pool.tm.exceeds ? 'dt__warn' : 'dt__ok'}>
                    Tm {pool.tm.min.toFixed(1)}–{pool.tm.max.toFixed(1)} °C, a spread of{' '}
                    {pool.tm.spread.toFixed(1)} °C
                    {pool.tm.exceeds ? ' (wider than 5 °C)' : ''}.
                  </li>
                )}
              </ul>
              <p className="panel__note panel__note--quiet">
                A cross-dimer between two oligos only matters if they share a tube, as in a pooled
                reaction; primers of different reactions never meet.
              </p>
            </section>
          )}
        </>
      )}
      {ordering && (
        <OrderSheetDialog
          oligos={orderOligos}
          onClose={() => {
            setOrdering(false);
          }}
        />
      )}
    </div>
  );
}
