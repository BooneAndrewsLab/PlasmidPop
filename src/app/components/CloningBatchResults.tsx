import { type KeyboardEvent, useMemo, useRef, useState } from 'react';

import { exportClient } from '@/workers/exportClient';

import { analytics } from '../analytics';
import { type BatchSortKey, sortLines, statusOf } from '../batchResults';
import { batchSession, type CloningRun } from '../batchSession';
import {
  type CloningLine,
  type CloningOligo,
  cloningDrafts,
  cloningLines,
  cloningOrderOligos,
  constructEntries,
  constructRows,
} from '../cloningResults';
import { downloadBlob } from '../saveFile';
import { editorStore } from '../state/editorStore';
import { savePrimers } from '../state/primerCollection';
import { BatchProtocolDialog } from './BatchProtocolDialog';
import { OrderSheetDialog } from './OrderSheetDialog';
import { SortTh } from './SortTh';
import { nextRowIndex, toggleSort } from './tableKeys';

/** More tabs than this is a wall of tabs, not a review: Open all stops here, as the zip does not. */
export const OPEN_ALL_LIMIT = 12;

const tmText = (x: number | null): string => (x === null || Number.isNaN(x) ? '–' : x.toFixed(1));

const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

const PART_NAMES = {
  padding: 'padding',
  site: 'recognition site',
  spacer: 'spacer',
  extra: 'extra bases',
  tail: "the vector's end",
  annealing: 'anneals to the insert',
} as const;

/** An oligo with its parts told apart: the tail's parts in the muted ink, the site underlined, the annealing part last. */
function Parts({ oligo }: { readonly oligo: CloningOligo }) {
  return (
    <span className="oligo panel__mono">
      {oligo.parts.map((p, i) => (
        <span
          key={i}
          className={
            p.kind === 'site' ? 'oligo__site' : p.kind === 'annealing' ? 'oligo__ann' : 'oligo__pad'
          }
          data-tip={PART_NAMES[p.kind]}
        >
          {p.text}
        </span>
      ))}
    </span>
  );
}

function OligoRows({ line }: { readonly line: CloningLine }) {
  return (
    <table className="dt">
      <tbody>
        {(['forward', 'reverse'] as const).map((strand) => {
          const oligo = strand === 'forward' ? line.forward : line.reverse;
          if (oligo === null) return null;
          return (
            <tr key={strand}>
              <th scope="row">{strand === 'forward' ? '→ Forward' : '← Reverse'}</th>
              <td className="dt__seq">
                <Parts oligo={oligo} />
              </td>
              <td className="wst__n">{oligo.sequence.length} nt</td>
              <td className="wst__n" data-tip="Melting temperature of the annealing part">
                Tm {tmText(oligo.tm)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The selected row in full: its oligos with their parts, the construct's size, and what is to be said of it. */
function RowDetail({
  line,
  onOpen,
}: {
  readonly line: CloningLine;
  /** Opens the construct as a tab; null when the row made none. */
  readonly onOpen: (() => void) | null;
}) {
  return (
    <aside className="detail" aria-label={`Row ${line.name}`}>
      <div className="detail__head">
        <strong>{line.name}</strong>
        <span className="dnote">
          line {line.line}
          {line.kit === null ? '' : ` · ${line.kit}`}
          {line.product === null ? '' : ` · construct ${line.product.toLocaleString()} bp`}
        </span>
      </div>
      {line.status === 'designed' && <OligoRows line={line} />}
      {line.status === 'designed' && (
        <p className="dnote">
          {line.recipe === 'homology'
            ? 'Upper case is the vector’s end, lower case anneals to the insert.'
            : 'Lower case is the tail (padding, site, spacer and any extra bases), upper case anneals to the insert.'}
        </p>
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
      {line.status === 'designed' && (
        <p className="panel__note panel__note--quiet">
          A cloning row is not drawn on the map: its construct opens as a tab.
        </p>
      )}
      {onOpen !== null && (
        <div className="actions">
          <button
            type="button"
            className="button button--small"
            data-tip="Open the simulated construct as a new tab"
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
 * The results of a cloning run on the Batch page (#360, item 141): a table of
 * rows like the primer table's, the selected row in full, and what can be
 * done with the batch: Save all, the order sheet, the constructs (opened, up
 * to a dozen, or as one zip of GenBank files) and the protocol.
 */
export function CloningBatchResults({
  documentId,
  run,
  selected,
  sort,
  said,
}: {
  readonly documentId: string | null;
  readonly run: CloningRun;
  readonly selected: number | null;
  readonly sort: ReturnType<typeof batchSession.read>['sort'];
  readonly said: string | null;
}) {
  const update = (patch: Parameters<typeof batchSession.update>[1]): void => {
    batchSession.update(documentId, patch);
  };
  const lines = useMemo(() => cloningLines(run.rows), [run.rows]);
  const sorted = useMemo(() => sortLines(lines, sort), [lines, sort]);
  const designed = lines.filter((l) => l.status === 'designed');
  const failed = lines.length - designed.length;
  const made = useMemo(() => constructRows(run.rows), [run.rows]);
  const orderOligos = useMemo(() => cloningOrderOligos(lines), [lines]);
  const running = run.running;
  const rowsEl = useRef<HTMLElement | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [protocol, setProtocol] = useState(false);
  const [zipping, setZipping] = useState(false);

  const selectedLine = lines.find((l) => l.index === selected);
  const selectedRow = run.rows.find((r) => r.index === selected);
  const selectedProduct =
    selectedRow?.status === 'designed' && selectedRow.product !== null ? selectedRow.product : null;

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
    void savePrimers(cloningDrafts(lines, run.vectorName), 'design').then((r) => {
      update({
        said:
          r.added.length === 0
            ? 'Already in My primers.'
            : `Saved ${count(r.added.length, 'primer', 'primers')} to My primers${
                r.duplicates > 0 ? `; ${r.duplicates} already there` : ''
              }.`,
      });
    });
  };

  const openAll = (): void => {
    for (const { product } of made.slice(0, OPEN_ALL_LIMIT)) {
      editorStore.openDocument(product, null, [], { scratch: true });
    }
  };

  const downloadConstructs = (): void => {
    setZipping(true);
    const stem = run.vectorName.replace(/[^\w.+-]+/g, '_') || 'vector';
    exportClient
      .zip(constructEntries(run.rows))
      .then((bytes) => {
        analytics.track('primers', 'batch-constructs');
        downloadBlob(`${stem}_constructs.zip`, new Blob([bytes as BlobPart]));
        update({ said: `Downloaded ${count(made.length, 'construct', 'constructs')} as one ZIP.` });
      })
      .catch((e: unknown) => {
        update({ error: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        setZipping(false);
      });
  };

  const tooMany = made.length > OPEN_ALL_LIMIT;
  const overhangs = run.vectorCheck?.overhangs ?? null;
  const vectorWarnings = run.vectorCheck?.warnings ?? [];

  return (
    <>
      <p className="panel__note" role="status">
        {run.cancelled
          ? `Cancelled: ${run.rows.length} of ${run.source.length} rows were done and are kept.`
          : running
            ? `Designing: ${run.rows.length} of ${run.source.length} rows.`
            : `${count(designed.length, 'row', 'rows')} designed${failed > 0 ? `, ${failed} failed` : ''}.`}
      </p>
      {overhangs !== null && (
        <p className="panel__note panel__note--quiet">
          Every part carries the destination’s overhangs, {overhangs.left} and {overhangs.right}.
        </p>
      )}
      {vectorWarnings.length > 0 && (
        <ul className="panel__list" aria-label="Overhang warnings">
          {vectorWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {run.rows.length > 0 && (
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
                  tip="Forward and reverse Tm of the annealing parts, °C; sorted by the forward's"
                >
                  Tm
                </SortTh>
                <SortTh
                  column="product"
                  sort={sort}
                  onSort={onSort}
                  numeric
                  tip="Size of the simulated construct, bp"
                >
                  Construct
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
                    <td className="panel__mono wst__seq">{l.forward?.sequence ?? ''}</td>
                    <td className="panel__mono wst__seq">{l.reverse?.sequence ?? ''}</td>
                    <td className="wst__n">
                      {l.forward === null || l.reverse === null
                        ? ''
                        : `${tmText(l.forward.tm)} / ${tmText(l.reverse.tm)}`}
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
      )}
      {run.rows.length > 0 &&
        (selectedLine === undefined ? (
          <p className="panel__note panel__note--quiet results__hint">
            Select a row to see its oligos and construct in full.
          </p>
        ) : (
          <RowDetail
            line={selectedLine}
            onOpen={
              selectedProduct === null
                ? null
                : () => {
                    editorStore.openDocument(selectedProduct, null, [], { scratch: true });
                  }
            }
          />
        ))}
      {run.rows.length > 0 && (
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
          <button
            type="button"
            className="button button--small"
            disabled={running || made.length === 0 || tooMany}
            data-tip={
              tooMany
                ? `Open all stops at ${OPEN_ALL_LIMIT} tabs; this has ${made.length}`
                : 'Open every construct as its own tab'
            }
            onClick={openAll}
          >
            Open all constructs
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={running || made.length === 0 || zipping}
            data-tip="One GenBank file per construct in a ZIP, saved on this computer only"
            onClick={downloadConstructs}
          >
            Download constructs
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={running || made.length === 0}
            data-tip="The protocol of every construct with one table of the oligos to order"
            onClick={() => {
              setProtocol(true);
            }}
          >
            Protocol…
          </button>
        </div>
      )}
      {tooMany && !running && (
        <p className="panel__note panel__note--quiet">
          Open all is limited to {OPEN_ALL_LIMIT} constructs, so it never opens a wall of tabs; this
          batch made {made.length}. Open them one at a time from their rows, or download the ZIP.
        </p>
      )}
      {said !== null && (
        <p className="panel__note panel__note--quiet" role="status">
          {said}
        </p>
      )}
      {ordering && (
        <OrderSheetDialog
          oligos={orderOligos}
          onClose={() => {
            setOrdering(false);
          }}
        />
      )}
      {protocol && (
        <BatchProtocolDialog
          rows={run.rows}
          onClose={() => {
            setProtocol(false);
          }}
        />
      )}
    </>
  );
}
