import { useEffect, useState } from 'react';

import { batchProtocolToHtml, batchProtocolToMarkdown, mergeOligos } from '@/core';

import { analytics } from '../analytics';
import { type CloningBatchRow } from '../cloningBatch';
import { batchProtocols } from '../cloningResults';
import { downloadText } from '../saveFile';
import { usePrimerCollection } from '../state/primerCollection';
import { useGelOptions } from '../state/useGel';

interface Props {
  readonly rows: readonly CloningBatchRow[];
  readonly onClose: () => void;
  /** Where a file goes; the browser's download unless a test says otherwise. */
  readonly download?: (name: string, text: string) => void;
}

/** A positive number typed in a box, or null for blank or anything else. */
function positive(text: string): number | null {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The Batch page's protocol (#360, item 141): the protocol of each construct
 * as the Bench writes one for a product, in one document with a single table
 * of the oligos to order, each sequence once. The amounts asked are the
 * Bench's. Built when a format is chosen, one construct at a time with the
 * page left free between them, and downloaded; nothing leaves the machine.
 */
export function BatchProtocolDialog({ rows, onClose, download = downloadText }: Props) {
  const gel = useGelOptions();
  const { primers } = usePrimerCollection();
  const [vectorNg, setVectorNg] = useState('50');
  const [ratio, setRatio] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const constructs = rows.filter((r) => r.status === 'designed' && r.product !== null).length;

  const save = async (format: 'html' | 'md'): Promise<void> => {
    setBusy(true);
    setSaid(null);
    try {
      const ng = positive(vectorNg);
      const ratioValue = positive(ratio);
      const { protocols, without } = await batchProtocols(rows, {
        collection: primers,
        gel,
        ...(ng === null ? {} : { vectorNg: ng }),
        ...(ratioValue === null ? {} : { ratio: ratioValue }),
      });
      if (protocols.length === 0) {
        setSaid('None of the constructs records how it was made, so there is no protocol.');
        return;
      }
      analytics.track('primers', 'batch-protocol', format);
      download(
        `batch_protocol.${format}`,
        format === 'html'
          ? batchProtocolToHtml(protocols, without)
          : batchProtocolToMarkdown(protocols, without),
      );
      setSaid(
        `${protocols.length.toLocaleString()} ${protocols.length === 1 ? 'protocol' : 'protocols'}, ${mergeOligos(protocols).length.toLocaleString()} oligos to order, downloaded.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-protocol-title"
      >
        <h2 id="batch-protocol-title" className="dialog__title">
          Batch protocol
        </h2>
        <div className="dialog__body">
          <p className="panel__note">
            One protocol for {constructs.toLocaleString()}{' '}
            {constructs === 1 ? 'construct' : 'constructs'}: each one's reactions, with a single
            table of the oligos to order, each sequence once. It is saved on this computer and sent
            nowhere.
          </p>
          <div className="protocol__inputs">
            <label className="panel__field">
              <span>Vector, ng</span>
              <input
                className="panel__number"
                inputMode="decimal"
                aria-label="Vector ng"
                value={vectorNg}
                onChange={(e) => {
                  setVectorNg(e.target.value);
                }}
              />
            </label>
            <label className="panel__field">
              <span>Insert : vector</span>
              <input
                className="panel__number"
                inputMode="decimal"
                aria-label="Insert to vector ratio"
                placeholder="default"
                value={ratio}
                onChange={(e) => {
                  setRatio(e.target.value);
                }}
              />
            </label>
          </div>
          {said !== null && (
            <p className="panel__note" role="status">
              {said}
            </p>
          )}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || constructs === 0}
            onClick={() => {
              void save('md');
            }}
          >
            Download Markdown
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || constructs === 0}
            onClick={() => {
              void save('html');
            }}
          >
            Download HTML
          </button>
        </div>
      </div>
    </div>
  );
}
