import { useState } from 'react';

import {
  type CdsRecodePlan,
  type Feature,
  type RecodeResult,
  type SeqDocument,
  cdsName,
  featureExtent,
  finishRecodeCds,
  prepareRecodeCds,
  recodeRefusal,
} from '@/core';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { DEFAULT_RECODE_FORM, resolveRecodeForm } from '../recodeForm';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { RecodeControls } from './RecodeControls';
import { useCodonHosts } from './useCodonHosts';

/** One line per problem the result still has, for a reader who must decide whether it matters. */
export function UnresolvedList({ result }: { readonly result: RecodeResult }) {
  if (result.unresolved.length === 0) return null;
  const label = (p: RecodeResult['unresolved'][number]): string => {
    const at = `bases ${(p.start + 1).toLocaleString()}–${p.end.toLocaleString()}`;
    if (p.kind === 'site') return `${p.detail} site at ${at}`;
    if (p.kind === 'run') return `run of ${p.detail} at ${at}`;
    return `GC ${Math.round(Number(p.detail) * 100)} % at ${at}`;
  };
  return (
    <ul className="recode__unresolved" aria-label="Limits not met">
      {result.unresolved.slice(0, 8).map((p) => (
        <li key={`${p.kind}${p.start}`}>{label(p)}</li>
      ))}
      {result.unresolved.length > 8 && <li>and {result.unresolved.length - 8} more</li>}
    </ul>
  );
}

interface Preview {
  readonly doc: SeqDocument;
  readonly plan: CdsRecodePlan;
  readonly host: string;
}

/**
 * Recode one CDS for a host (#209). The search runs on the worker; what it
 * found is shown as a preview (the Codon Adaptation Index before and after,
 * what could not be met) and changes nothing until Apply, which is one undo
 * step. The protein is read again from the result before it is offered.
 */
export function RecodeCds({
  doc,
  feature,
}: {
  readonly doc: SeqDocument;
  readonly feature: Feature;
}) {
  const hosts = useCodonHosts();
  const { documentId } = useEditorState();
  const [form, setForm] = useRemembered('recode.form', documentId, DEFAULT_RECODE_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = cdsName(doc, feature);
  const refusal = recodeRefusal(doc, feature);
  const resolved = resolveRecodeForm(form, hosts);

  const run = (): void => {
    if (!resolved.ok) return;
    const prep = prepareRecodeCds(doc, feature);
    if (prep.job === undefined) {
      setError(prep.reason);
      return;
    }
    const { job } = prep;
    setBusy(true);
    setError(null);
    setPreview(null);
    analysisClient
      .recode(job.slots, {
        ...resolved.options,
        table: job.table,
        prefix: job.prefix,
        suffix: job.suffix,
      })
      .then((result) => {
        const plan = finishRecodeCds(doc, feature, job, result, resolved.host);
        setPreview({ doc, plan, host: resolved.host.name });
        analytics.track(
          'recode',
          'recode',
          resolved.host.id.startsWith('custom-') ? 'custom' : resolved.host.id,
        );
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const apply = (): void => {
    if (preview?.doc !== doc) return;
    const { plan } = preview;
    const extent = featureExtent(feature);
    const label = `Recode ${name} for ${preview.host}`;
    const key = `recode@${feature.id}`;
    // The bases and the note are one thing to undo.
    editorStore.apply(plan.edit, extent, undefined, {
      follows: 'recode-start',
      key,
      limit: 2,
      withinMs: 10_000,
      relabel: () => label,
    });
    editorStore.apply(
      { type: 'updateFeature', id: feature.id, patch: { qualifiers: plan.qualifiers } },
      extent,
      undefined,
      { follows: key, key: `${key}:done`, limit: 2, withinMs: 10_000, relabel: () => label },
    );
    setPreview(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="button button--small"
        disabled={refusal !== null}
        title={refusal ?? `Choose codons for ${name} that a host uses, keeping the protein`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Recode…
      </button>
    );
  }
  const stale = preview !== null && preview.doc !== doc;
  return (
    <div className="recode" aria-label={`Recode ${name}`}>
      <RecodeControls form={form} onChange={setForm} />
      <div className="panel__buttons">
        <button
          type="button"
          className="button button--small button--primary"
          disabled={busy || !resolved.ok}
          onClick={run}
        >
          {busy ? 'Working…' : 'Recode'}
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          onClick={() => {
            setOpen(false);
            setPreview(null);
          }}
        >
          Close
        </button>
      </div>
      {!resolved.ok && <p className="panel__note panel__note--error">{resolved.error}</p>}
      {error !== null && <p className="panel__note panel__note--error">{error}</p>}
      {preview !== null && (
        <div className="recode__preview" aria-live="polite">
          <p className="panel__note">
            CAI {preview.plan.caiBefore.toFixed(2)} to {preview.plan.result.cai.toFixed(2)} for{' '}
            {preview.host}; {preview.plan.changed.toLocaleString()} of{' '}
            {preview.plan.result.codons.length.toLocaleString()} codons change. The protein reads
            the same ({preview.plan.protein.length.toLocaleString()} residues, checked by
            translating the result).
          </p>
          {preview.plan.result.rareCodons > 0 && (
            <p className="panel__note panel__note--warn">
              {preview.plan.result.rareCodons} codons are ones the host seldom uses, taken to meet a
              limit.
            </p>
          )}
          {preview.plan.result.unresolved.length > 0 && (
            <p className="panel__note panel__note--warn">
              Limits that could not be met without changing the protein:
            </p>
          )}
          <UnresolvedList result={preview.plan.result} />
          <div className="panel__buttons">
            <button
              type="button"
              className="button button--small button--primary"
              disabled={stale || preview.plan.changed === 0}
              onClick={apply}
            >
              Apply
            </button>
            {stale && <span className="panel__hint">The document changed; recode again.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
