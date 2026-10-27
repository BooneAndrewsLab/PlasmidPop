import { useState } from 'react';

import { type SeqDocument } from '@/core';

import { addFeaturesAsOneStep } from '../state/featureSteps';
import { savePrimers } from '../state/primerCollection';
import { type PrimerProbe, goToSite, pct, primerFeature, siteSpan, tm } from './primerDesign';

/** The box the primer is pasted into, shared by the quick check and the Check page. */
export function ProbeBox({
  probe,
  className,
}: {
  readonly probe: PrimerProbe;
  readonly className?: string;
}) {
  return (
    <textarea
      className={`panel__search panel__mono-input primers__paste${className === undefined ? '' : ` ${className}`}`}
      rows={2}
      spellCheck={false}
      placeholder="Paste a primer, 5′ to 3′"
      aria-label="Primer sequence"
      value={probe.probe}
      onChange={(e) => {
        probe.setProbe(e.target.value);
      }}
    />
  );
}

interface Props {
  readonly doc: SeqDocument;
  readonly probe: PrimerProbe;
}

/**
 * Check a primer in full (item 93), on the workspace's Check page (item
 * 107): length, Tm, GC and clamp, the warnings against the settings, where
 * it binds, and Add sites and Save.
 */
export function PrimerCheck({ doc, probe }: Props) {
  const { report, sites } = probe;
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <ProbeBox probe={probe} />
      {report !== null && report.length > 0 && (
        <>
          <p className="panel__mono primers__stats">
            {report.length} nt, Tm{' '}
            {report.degenerate === 0
              ? tm(report.tm)
              : report.tmRange === null
                ? '–'
                : `${report.tmRange.min.toFixed(1)}–${report.tmRange.max.toFixed(1)} °C`}
            , GC{' '}
            {report.degenerate === 0
              ? pct(report.gc)
              : `${pct(report.gcRange.min)}–${pct(report.gcRange.max)}`}
            {report.gcClamp ? ', GC clamp' : ''}
          </p>
          {report.degenerate > 0 && (
            <p className="panel__note panel__note--quiet">
              Degenerate: {report.degenerate} {report.degenerate === 1 ? 'position' : 'positions'},
              a mix of {report.molecules.toLocaleString()} molecules. Tm and GC are ranges over the
              mix; hairpins and dimers are counted on the plain bases. A code binds wherever it
              stands for the template&rsquo;s base.
            </p>
          )}
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
            <ul className="orf-list" aria-label="Binding sites">
              {sites.map((s) => (
                <li key={`${s.strand}-${s.range.start}`}>
                  <button
                    type="button"
                    className="orf-row"
                    onClick={() => {
                      goToSite(s);
                    }}
                  >
                    <span className="orf-row__strand">{s.strand === 'forward' ? '→' : '←'}</span>
                    <span className="orf-row__range">{siteSpan(s, doc.length)}</span>
                    <span className="orf-row__length">
                      {s.mismatches === 0 ? 'exact' : `${s.mismatches} mm`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="panel__controls">
            {sites.length > 0 && (
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  // One click, so one Undo takes every site back (#96).
                  addFeaturesAsOneStep(
                    sites.map((s) => primerFeature('Primer', s.range, s.strand, report.sequence)),
                    sites[sites.length - 1]?.range,
                  );
                }}
              >
                Add {sites.length === 1 ? 'site' : 'sites'} as primer_bind
              </button>
            )}
            <button
              type="button"
              className="button button--quiet button--small"
              data-tip="Keep this primer in My primers, in this browser"
              onClick={() => {
                void savePrimers(
                  [{ name: '', sequence: report.sequence, notes: '' }],
                  'check',
                ).then((r) => {
                  setSaved(
                    r.added.length === 0
                      ? 'Already in My primers.'
                      : `Saved ${r.added.map((p) => p.name).join(' and ')} to My primers.`,
                  );
                });
              }}
            >
              Save to My primers
            </button>
          </div>
          {saved !== null && <p className="panel__note panel__note--quiet">{saved}</p>}
        </>
      )}
    </>
  );
}
