import { useMemo, useState } from 'react';

import {
  type SoeDesign,
  type SoeFragment,
  type SoePrimer,
  SOE_DEFAULTS,
  designOverlapExtension,
  recordOverlapExtension,
} from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { SOE_MAX_FRAGMENTS, SOE_OVERLAP_TMS, type SoeSlot } from '../state/benchSettings';
import { cloningDocuments, editorStore } from '../state/editorStore';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { AssemblyWarnings } from './AssemblyWarnings';
import { BenchProduct } from './BenchProduct';
import { insertChoices } from './insertChoices';
import { ProductSummary } from './ProductSummary';

function PrimerRow({ primer }: { readonly primer: SoePrimer }) {
  const label = `${primer.name}, ${primer.strand}`;
  return (
    <li className="pair">
      <div className="pair__row pair__row--wide">
        <span className="pair__length">{primer.name}</span>
        <span className="pair__meta">
          {primer.sequence.length} nt, {primer.strand}
          {primer.role === 'outer'
            ? ', outer'
            : `: ${primer.tail.length} of the neighbour, ${primer.annealLength} annealing`}{' '}
          at {primer.tm.toFixed(0)} °C
        </span>
      </div>
      <div className="pair__foot">
        <code className="mutagenesis__oligo">{primer.sequence}</code>
        <span className="pair__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
            aria-label={`Copy ${label} primer`}
            onClick={() => {
              copyText(primer.sequence);
            }}
          >
            Copy
          </button>
        </span>
      </div>
    </li>
  );
}

/** What the primers of a fusion are called: the name typed, else the fragments'. */
function primerPrefix(typed: string, names: readonly string[]): string {
  const base = typed.trim() === '' ? `SOE ${names.join('-')}` : typed.trim();
  return `${base.length > 40 ? base.slice(0, 40).trimEnd() : base} `;
}

/**
 * Overlap-extension (SOE) PCR on the Bench (#216): fragments in order, each
 * a part of an open tab, and the primers that fuse them. The design runs
 * every step it describes, so what is shown as the product is what the
 * outer primers would amplify off the fused first-round products.
 */
export function SoePanel() {
  const { documents, bench } = useEditorState();
  const { fragments: slots, overlapTm, name } = bench.soe;
  const [saved, setSaved] = useState('');

  const setSlots = (next: readonly SoeSlot[]): void => {
    setSaved('');
    editorStore.updateBench('soe', { fragments: next });
  };
  const setSlot = (i: number, patch: Partial<SoeSlot>): void => {
    setSlots(slots.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  };
  const move = (i: number, by: -1 | 1): void => {
    const to = i + by;
    const a = slots[i];
    const b = slots[to];
    if (a === undefined || b === undefined) return;
    setSlots(slots.map((s, k) => (k === i ? b : k === to ? a : s)));
  };

  const tabs = useMemo(
    () =>
      cloningDocuments(documents).map((d) => ({
        id: d.documentId,
        doc: d.history.present,
        selection: d.selection,
      })),
    [documents],
  );

  // Which part of each tab goes in, resolved as the In-Fusion designer does.
  const resolved = useMemo(
    () =>
      slots.map((slot) => {
        const tab = tabs.find((t) => t.id === slot.templateId);
        const choices = insertChoices(tab);
        const choice = choices.find((c) => c.value === slot.insert) ?? choices[0];
        return { tab, choices, choice };
      }),
    [slots, tabs],
  );
  const fragments = useMemo((): SoeFragment[] | null => {
    const out: SoeFragment[] = [];
    for (const r of resolved) {
      if (r.tab === undefined || r.choice === undefined) return null;
      out.push({ doc: r.tab.doc, range: r.choice.range });
    }
    return out;
  }, [resolved]);

  const trimmed = name.trim();
  const design = useMemo((): SoeDesign | null => {
    if (fragments === null) return null;
    return designOverlapExtension(fragments, {
      overlapTm,
      primerPrefix: primerPrefix(
        trimmed,
        fragments.map((f) => f.doc.name),
      ),
      ...(trimmed === '' ? {} : { name: trimmed }),
    });
  }, [fragments, overlapTm, trimmed]);
  // The lineage is a checksum of every template, so it is made once per design.
  const recorded = useMemo(
    () =>
      design === null || fragments === null ? null : recordOverlapExtension(design, fragments),
    [design, fragments],
  );

  const open = (): void => {
    if (recorded === null) return;
    analytics.track('cloning', 'soe');
    editorStore.openDocument(recorded);
    editorStore.setSidebarTab('features');
  };
  const save = (): void => {
    if (design === null) return;
    analytics.track('cloning', 'soe-oligos');
    const drafts = design.primers.map((p) => ({
      name: p.name,
      sequence: p.sequence,
      notes: `Overlap-extension PCR, ${p.role} ${p.strand} primer for ${fragments?.[p.fragment]?.doc.name ?? 'a fragment'}`,
    }));
    void savePrimers(drafts, 'design').then((r) => {
      setSaved(
        r.added.length === 0
          ? 'Already in My primers.'
          : `Saved ${r.added.length.toLocaleString()} ${r.added.length === 1 ? 'primer' : 'primers'} to My primers.`,
      );
    });
  };

  return (
    <>
      <BenchProduct product={recorded} />
      <p className="panel__note panel__note--quiet">
        Choose the fragments in the order they should end up. Each is amplified with a tail that
        overlaps its neighbour, the products are fused by that overlap, and the two outer primers
        amplify the result.
      </p>
      <ol className="part-list" aria-label="Fragments to fuse">
        {slots.map((slot, i) => {
          const r = resolved[i];
          return (
            <li key={i} className="part">
              <span className="part__index">{i + 1}</span>
              <span className="part__text">
                <label className="panel__field panel__field--row">
                  <span>From</span>
                  <select
                    className="panel__select"
                    aria-label={`Fragment ${i + 1} from`}
                    value={slot.templateId}
                    onChange={(e) => {
                      // Another tab's features are not this one's: start from its selection.
                      setSlot(i, { templateId: e.target.value, insert: '' });
                    }}
                  >
                    <option value="">choose a tab</option>
                    {tabs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.doc.name}
                      </option>
                    ))}
                  </select>
                </label>
                {r?.tab !== undefined && r.choices.length > 0 && (
                  <label className="panel__field panel__field--row">
                    <span>Part</span>
                    <select
                      className="panel__select"
                      aria-label={`Fragment ${i + 1} part`}
                      value={r.choice?.value ?? ''}
                      onChange={(e) => {
                        setSlot(i, { insert: e.target.value });
                      }}
                    >
                      {r.choices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {r?.tab !== undefined && r.choices.length === 0 && (
                  <span className="panel__note">
                    {r.tab.doc.name} has nothing selected and no features. Select the fragment in
                    its tab, or annotate it.
                  </span>
                )}
              </span>
              <span className="pair__buttons">
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-label={`Move fragment ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => {
                    move(i, -1);
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-label={`Move fragment ${i + 1} down`}
                  disabled={i === slots.length - 1}
                  onClick={() => {
                    move(i, 1);
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-label={`Remove fragment ${i + 1}`}
                  disabled={slots.length <= 2}
                  onClick={() => {
                    setSlots(slots.filter((_, k) => k !== i));
                  }}
                >
                  Remove
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="panel__controls">
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--small"
            disabled={slots.length >= SOE_MAX_FRAGMENTS}
            onClick={() => {
              setSlots([...slots, { templateId: '', insert: '' }]);
            }}
          >
            Add fragment
          </button>
        </div>
        <label className="panel__field">
          <span>Overlap Tm</span>
          <select
            className="panel__select"
            value={overlapTm}
            title="The overlap at each junction grows until it melts at about this temperature"
            onChange={(e) => {
              editorStore.updateBench('soe', { overlapTm: Number(e.target.value) });
            }}
          >
            {SOE_OVERLAP_TMS.map((t) => (
              <option key={t} value={t}>
                {t} °C{t === SOE_DEFAULTS.overlapTm ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {design === null ? (
        <p className="panel__note">
          Choose a tab, and the part of it to use, for every fragment. Open the pieces you want to
          fuse first.
        </p>
      ) : design.problem !== null ? (
        <p className="panel__error">{design.problem}</p>
      ) : (
        <>
          <ol className="pair-list" aria-label="Overlap-extension primers">
            {design.primers.map((p) => (
              <PrimerRow key={p.name} primer={p} />
            ))}
          </ol>
          <p className="panel__note panel__note--quiet">
            Upper case is the neighbour&rsquo;s end the tail carries; the rest anneals to the
            fragment&rsquo;s own template.
          </p>
          <ul className="panel__warnings" aria-label="Overlaps">
            {design.junctions.map((j) => (
              <li key={j.index}>
                Junction {j.index + 1}: {j.length} bp overlap, Tm {j.tm.toFixed(0)} °C (
                <code>{j.overlap}</code>)
              </li>
            ))}
          </ul>
          <p className="panel__note panel__note--quiet" aria-label="First-round products">
            First round:{' '}
            {design.firstRound.map((d) => `${d.length.toLocaleString()} bp`).join(', ')}. Fused:{' '}
            {design.fused?.length.toLocaleString() ?? 0} bp.
          </p>
          {design.product !== null && <ProductSummary product={design.product} />}
          <AssemblyWarnings texts={design.warnings} />
          <div className="panel__controls">
            <input
              className="panel__search"
              type="text"
              placeholder={design.product?.name ?? 'Name of the product'}
              aria-label="Name of the fused product"
              value={name}
              onChange={(e) => {
                editorStore.updateBench('soe', { name: e.target.value });
              }}
            />
            <div className="panel__buttons">
              <button
                type="button"
                className="button button--primary button--small"
                title="Open the fused product as a new document"
                onClick={open}
              >
                Open product
              </button>
              <button
                type="button"
                className="button button--small"
                title="Keep these primers in My primers, in this browser"
                onClick={save}
              >
                Save primers
              </button>
            </div>
          </div>
          {saved !== '' && (
            <p className="panel__note panel__note--quiet" role="status">
              {saved}
            </p>
          )}
        </>
      )}
    </>
  );
}
