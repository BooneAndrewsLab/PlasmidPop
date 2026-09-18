import { useMemo, useState } from 'react';

import {
  type BindingSite,
  type PrimerPair,
  type SeqDocument,
  analyzePrimer,
  createFeature,
  designPrimers,
  findPrimerBindingSites,
  isEmptyRange,
  rangeSegment,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function tm(x: number): string {
  return Number.isNaN(x) ? '–' : `${x.toFixed(1)} °C`;
}

function addPrimerFeature(
  name: string,
  site: { start: number; end: number },
  strand: 'forward' | 'reverse',
  sequence: string,
): void {
  const feature = createFeature({
    type: 'primer_bind',
    name,
    strand,
    segments: [rangeSegment(site.start, site.end)],
    qualifiers: [{ name: 'note', value: `sequence: ${sequence}` }],
  });
  editorStore.apply({ type: 'addFeature', feature }, site);
}

export function PrimerPanel({ doc }: Props) {
  const { selection } = useEditorState();
  const [probe, setProbe] = useState('');
  const [pairs, setPairs] = useState<PrimerPair[] | null>(null);
  const [designedFor, setDesignedFor] = useState<string>('');

  const hasTarget = selection !== null && !isEmptyRange(selection);
  const report = useMemo(() => (probe.trim() === '' ? null : analyzePrimer(probe)), [probe]);
  const sites: BindingSite[] = useMemo(
    () =>
      report === null || report.length < 8
        ? []
        : findPrimerBindingSites(doc.sequence.toString(), doc.topology, report.sequence),
    [doc, report],
  );

  const design = (): void => {
    if (selection === null) return;
    const result = designPrimers(doc.sequence.toString(), doc.topology, selection);
    setPairs(result);
    setDesignedFor(`${(selection.start + 1).toLocaleString()}–${selection.end.toLocaleString()}`);
  };

  return (
    <div className="panel">
      <section>
        <h3 className="panel__heading">Design primers for the selection</h3>
        <p className="panel__note">
          {hasTarget
            ? `Target ${(selection.start + 1).toLocaleString()}–${selection.end.toLocaleString()} (${(selection.end - selection.start).toLocaleString()} bp). Primers 18–27 nt, Tm 55–65 °C, within 200 bp of the target.`
            : 'Select the region to amplify, then design.'}
        </p>
        <button
          type="button"
          className="button button--small"
          disabled={!hasTarget}
          onClick={design}
        >
          Design primers
        </button>
        {pairs !== null && (
          <div className="panel__section">
            {pairs.length === 0 ? (
              <p className="panel__note">
                No suitable pairs for {designedFor}. Try a different region or select more flanking
                sequence.
              </p>
            ) : (
              <ol className="pair-list">
                {pairs.map((p, i) => (
                  <li key={i} className="pair">
                    <div className="pair__row">
                      <span className="pair__label">Fwd</span>
                      <span className="pair__seq">{p.forward.sequence}</span>
                      <span className="pair__meta">
                        {tm(p.forward.tm)}, GC {pct(p.forward.gc)}
                      </span>
                    </div>
                    <div className="pair__row">
                      <span className="pair__label">Rev</span>
                      <span className="pair__seq">{p.reverse.sequence}</span>
                      <span className="pair__meta">
                        {tm(p.reverse.tm)}, GC {pct(p.reverse.gc)}
                      </span>
                    </div>
                    <div className="pair__foot">
                      <span>
                        Product {p.productLength.toLocaleString()} bp, ΔTm{' '}
                        {p.tmDifference.toFixed(1)} °C
                      </span>
                      <button
                        type="button"
                        className="button button--quiet button--small"
                        onClick={() => {
                          addPrimerFeature(
                            `Fwd primer ${i + 1}`,
                            p.forwardSite,
                            'forward',
                            p.forward.sequence,
                          );
                          addPrimerFeature(
                            `Rev primer ${i + 1}`,
                            p.reverseSite,
                            'reverse',
                            p.reverse.sequence,
                          );
                        }}
                      >
                        Add both as features
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>

      <section className="panel__section">
        <h3 className="panel__heading">Check a primer</h3>
        <input
          className="panel__search"
          type="text"
          spellCheck={false}
          placeholder="Paste a primer sequence"
          aria-label="Primer sequence"
          value={probe}
          onChange={(e) => {
            setProbe(e.target.value);
          }}
        />
        {report !== null && report.length > 0 && (
          <>
            <p className="panel__mono">
              {report.length} nt, Tm {tm(report.tm)}, GC {pct(report.gc)}
              {report.gcClamp ? ', GC clamp' : ''}
            </p>
            {report.warnings.length > 0 && (
              <ul className="panel__warnings">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <p className="panel__note">
              {report.length < 8
                ? 'Enter at least 8 bases to search for binding sites.'
                : sites.length === 0
                  ? 'No binding site in this sequence (exact 3′ end, up to 2 mismatches elsewhere).'
                  : `${sites.length} binding ${sites.length === 1 ? 'site' : 'sites'}:`}
            </p>
            {sites.length > 0 && (
              <ul className="orf-list">
                {sites.map((s) => (
                  <li key={`${s.strand}-${s.range.start}`}>
                    <button
                      type="button"
                      className="orf-row"
                      onClick={() => {
                        editorStore.setSelection(s.range);
                        editorStore.revealPosition(s.range.start);
                      }}
                    >
                      <span className="orf-row__strand">{s.strand === 'forward' ? '→' : '←'}</span>
                      <span className="orf-row__range">
                        {(s.range.start + 1).toLocaleString()}–
                        {(((s.range.end - 1) % Math.max(1, doc.length)) + 1).toLocaleString()}
                      </span>
                      <span className="orf-row__length">
                        {s.mismatches === 0 ? 'exact' : `${s.mismatches} mm`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {sites.length > 0 && (
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  for (const s of sites)
                    addPrimerFeature('Primer', s.range, s.strand, report.sequence);
                }}
              >
                Add {sites.length === 1 ? 'site' : 'sites'} as primer_bind
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
