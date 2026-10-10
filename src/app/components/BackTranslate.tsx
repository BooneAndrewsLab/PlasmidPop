import { useState } from 'react';

import { type RecodeResult, SeqDocument, createFeature, rangeSegment, translate } from '@/core';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { DEFAULT_RECODE_FORM, resolveRecodeForm } from '../recodeForm';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { RecodeControls } from './RecodeControls';
import { useCodonHosts } from './useCodonHosts';
import { UnresolvedList } from './RecodeCds';

interface Done {
  readonly result: RecodeResult;
  readonly host: string;
  readonly dna: SeqDocument;
}

/**
 * Back-translate a protein document into DNA for a host (#209), opened as a
 * document of its own with the CDS annotated. Residues read as the protein
 * is (stops included); a final stop is added when the protein has none, so
 * the gene ends. The DNA is translated again before it is offered.
 */
export function BackTranslate({ doc }: { readonly doc: SeqDocument }) {
  const hosts = useCodonHosts();
  const { documentId } = useEditorState();
  const [form, setForm] = useRemembered('recode.form', documentId, DEFAULT_RECODE_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const resolved = resolveRecodeForm(form, hosts);

  const run = (): void => {
    if (!resolved.ok) return;
    const residues = doc.sequence.toString().toUpperCase();
    const protein = residues.endsWith('*') ? residues : `${residues}*`;
    setBusy(true);
    setError(null);
    setDone(null);
    analysisClient
      .recode(
        Array.from(protein).map((aminoAcid) => ({ aminoAcid, fixed: null })),
        resolved.options,
      )
      .then((result) => {
        if (translate(result.dna) !== protein) {
          throw new Error('The back-translation does not read as the protein; nothing was made');
        }
        const host = resolved.host;
        const dna = SeqDocument.create({
          name: `${doc.name}_${host.id.startsWith('custom-') ? 'custom' : host.id}`,
          sequence: result.dna,
          features: [
            createFeature({
              type: 'CDS',
              name: doc.name,
              segments: [rangeSegment(0, result.dna.length)],
              qualifiers: [
                {
                  name: 'note',
                  value: `Back-translated from ${doc.name} for ${host.name} codon usage with PlasmidPop (CAI ${result.cai.toFixed(2)})`,
                },
              ],
            }),
          ],
        });
        setDone({ result, host: host.name, dna });
        analytics.track(
          'recode',
          'backTranslate',
          host.id.startsWith('custom-') ? 'custom' : host.id,
        );
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="recode" aria-label="Back-translate">
      <h3 className="panel__heading">
        Back-translate
        <span className="panel__heading-note">to DNA for a host</span>
      </h3>
      <RecodeControls form={form} onChange={setForm} />
      <div className="panel__buttons">
        <button
          type="button"
          className="button button--small button--primary"
          disabled={busy || !resolved.ok}
          onClick={run}
        >
          {busy ? 'Working…' : 'Back-translate'}
        </button>
      </div>
      {!resolved.ok && <p className="panel__note panel__note--error">{resolved.error}</p>}
      {error !== null && <p className="panel__note panel__note--error">{error}</p>}
      {done !== null && (
        <div aria-live="polite">
          <p className="panel__note">
            {done.dna.length.toLocaleString()} bp for {done.host}, CAI {done.result.cai.toFixed(2)}.
            It translates to the protein (checked).
          </p>
          <UnresolvedList result={done.result} />
          <div className="panel__buttons">
            <button
              type="button"
              className="button button--small button--primary"
              onClick={() => {
                editorStore.openDocument(done.dna);
                editorStore.setSidebarTab('features');
              }}
            >
              Open as DNA
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
