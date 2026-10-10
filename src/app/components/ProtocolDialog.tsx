import { useEffect, useMemo, useState } from 'react';

import { type SeqDocument, buildProtocol, protocolToHtml, protocolToMarkdown } from '@/core';

import { analytics } from '../analytics';
import { downloadText, fileNameFor } from '../saveFile';
import { usePrimerCollection } from '../state/primerCollection';
import { useGelOptions } from '../state/useGel';

interface Props {
  readonly doc: SeqDocument;
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
 * Protocol for a product (#215, item 78): the oligos to order, each reaction
 * with its amounts and program, and the digest to check the product by, built
 * from the record of how it was made. The amounts are the only thing asked:
 * how much vector, the insert ratio, and each part's concentration.
 */
export function ProtocolDialog({ doc, onClose, download = downloadText }: Props) {
  const gel = useGelOptions();
  const { primers } = usePrimerCollection();
  const [vectorNg, setVectorNg] = useState('50');
  const [ratio, setRatio] = useState('');
  const [conc, setConc] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const concentrations = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [name, text] of Object.entries(conc)) {
      const n = positive(text);
      if (n !== null) out[name] = n;
    }
    return out;
  }, [conc]);
  const ng = positive(vectorNg);
  const ratioValue = positive(ratio);
  const protocol = useMemo(
    () =>
      buildProtocol(doc, {
        ...(ng === null ? {} : { vectorNg: ng }),
        ...(ratioValue === null ? {} : { ratio: ratioValue }),
        concentrations,
        collection: primers,
        gel,
      }),
    [doc, ng, ratioValue, concentrations, primers, gel],
  );
  const html = useMemo(() => (protocol === null ? '' : protocolToHtml(protocol)), [protocol]);
  const partNames = useMemo(() => {
    const names: string[] = [];
    for (const s of protocol?.steps ?? []) {
      if (s.kind !== 'ligation' && s.kind !== 'golden-gate' && s.kind !== 'gibson') continue;
      for (const p of s.parts) if (!names.includes(p.name)) names.push(p.name);
    }
    return names;
  }, [protocol]);

  const save = (format: 'html' | 'md'): void => {
    if (protocol === null) return;
    analytics.track('cloning', 'protocol', format);
    const stem = fileNameFor(doc, 'genbank').replace(/\.gb$/, '');
    download(`${stem}_protocol.${format}`, format === 'html' ? html : protocolToMarkdown(protocol));
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="protocol-title"
      >
        <h2 id="protocol-title" className="dialog__title">
          Protocol for {doc.name}
        </h2>
        <div className="dialog__body">
          {protocol === null ? (
            <p>This document carries no record of how it was made.</p>
          ) : (
            <>
              {partNames.length > 0 && (
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
                  {partNames.map((name) => (
                    <label key={name} className="panel__field">
                      <span>{name}, ng/µL</span>
                      <input
                        className="panel__number"
                        inputMode="decimal"
                        aria-label={`Concentration of ${name}`}
                        value={conc[name] ?? ''}
                        onChange={(e) => {
                          setConc({ ...conc, [name]: e.target.value });
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
              <iframe
                className="protocol__preview"
                title="Protocol preview"
                sandbox=""
                srcDoc={html}
              />
            </>
          )}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="button"
            disabled={protocol === null}
            onClick={() => {
              save('md');
            }}
          >
            Download Markdown
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={protocol === null}
            onClick={() => {
              save('html');
            }}
          >
            Download HTML
          </button>
        </div>
      </div>
    </div>
  );
}
