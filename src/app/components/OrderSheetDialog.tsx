import { useEffect, useMemo, useState } from 'react';

import {
  type OrderOligo,
  type WellOrder,
  DEFAULT_ORDER_PURIFICATION,
  DEFAULT_ORDER_SCALE,
  PLATE_WELLS,
  buildOrderSheet,
  sameBases,
} from '@/core';

import { analytics } from '../analytics';
import { downloadText } from '../saveFile';

const PREVIEW_ROWS = 6;

interface Props {
  readonly oligos: readonly OrderOligo[];
  readonly onClose: () => void;
  /** Where a file goes; the browser's download unless a test says otherwise. */
  readonly download?: (name: string, text: string) => void;
}

/**
 * The Batch page's order sheet (#358, item 141): scale, purification and the
 * order the wells fill in, a look at the first lines, and what would make a
 * vendor refuse it. A download only; nothing leaves the machine.
 */
export function OrderSheetDialog({ oligos, onClose, download = downloadText }: Props) {
  const [scale, setScale] = useState(DEFAULT_ORDER_SCALE);
  const [purification, setPurification] = useState(DEFAULT_ORDER_PURIFICATION);
  const [wellOrder, setWellOrder] = useState<WellOrder>('row');

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const sheet = useMemo(
    () => buildOrderSheet(oligos, { scale, purification, wellOrder }),
    [oligos, scale, purification, wellOrder],
  );
  const same = useMemo(() => sameBases(oligos), [oligos]);
  const plates = Math.ceil(oligos.length / PLATE_WELLS);

  const save = (): void => {
    analytics.track('primers', 'order-sheet');
    download('order-sheet.csv', sheet.csv);
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-title"
      >
        <h2 id="order-title" className="dialog__title">
          Order sheet
        </h2>
        <div className="dialog__body">
          <p className="panel__note">
            {oligos.length.toLocaleString()} {oligos.length === 1 ? 'oligo' : 'oligos'} on {plates}{' '}
            {plates === 1 ? 'plate' : 'plates'}. A plain CSV to copy into a vendor's template; it is
            saved on this computer and sent nowhere.
          </p>
          <div className="protocol__inputs">
            <label className="panel__field">
              <span>Scale</span>
              <input
                className="panel__input"
                aria-label="Scale"
                value={scale}
                onChange={(e) => {
                  setScale(e.target.value);
                }}
              />
            </label>
            <label className="panel__field">
              <span>Purification</span>
              <input
                className="panel__input"
                aria-label="Purification"
                value={purification}
                onChange={(e) => {
                  setPurification(e.target.value);
                }}
              />
            </label>
            <label className="panel__field">
              <span>Wells fill</span>
              <select
                className="panel__select"
                aria-label="Wells fill"
                value={wellOrder}
                onChange={(e) => {
                  setWellOrder(e.target.value === 'column' ? 'column' : 'row');
                }}
              >
                <option value="row">along rows (A1, A2, …)</option>
                <option value="column">down columns (A1, B1, …)</option>
              </select>
            </label>
          </div>
          {sheet.problems.length > 0 && (
            <ul className="panel__list" aria-label="Problems with the order">
              {sheet.problems.map((p) => (
                <li key={p} className="dt__warn">
                  {p}
                </li>
              ))}
            </ul>
          )}
          {same.length > 0 && (
            <p className="dt__warn">
              Same bases under different names, paid for twice:{' '}
              {same.map((s) => s.names.join(' = ')).join('; ')}.
            </p>
          )}
          <table className="dt" aria-label="Order sheet preview">
            <thead>
              <tr>
                <th>Plate</th>
                <th>Well</th>
                <th>Name</th>
                <th>Sequence</th>
                <th>Length</th>
              </tr>
            </thead>
            <tbody>
              {sheet.lines.slice(0, PREVIEW_ROWS).map((l, i) => (
                <tr key={i}>
                  <td>{l.plate}</td>
                  <td>{l.well}</td>
                  <td>{l.name}</td>
                  <td className="panel__mono dt__seq">{l.sequence}</td>
                  <td>{l.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.lines.length > PREVIEW_ROWS && (
            <p className="panel__note panel__note--quiet">
              … and {(sheet.lines.length - PREVIEW_ROWS).toLocaleString()} more.
            </p>
          )}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={sheet.problems.length > 0 || sheet.lines.length === 0}
            data-tip={
              sheet.problems.length > 0
                ? 'Fix the problems listed first: a vendor rejects them'
                : 'Download the order sheet as CSV'
            }
            onClick={save}
          >
            Download CSV
          </button>
        </div>
      </div>
    </div>
  );
}
