import { useState } from 'react';

import { type PrimerReport, type SeqDocument } from '@/core';

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

/** "Tm 61.0 °C", or the range over a degenerate mix. */
function tmText(report: PrimerReport): string {
  if (report.degenerate === 0) return `Tm ${tm(report.tm)}`;
  if (report.tmRange === null) return 'Tm –';
  return `Tm ${report.tmRange.min.toFixed(1)}–${report.tmRange.max.toFixed(1)} °C`;
}

function gcText(report: PrimerReport): string {
  return report.degenerate === 0
    ? `GC ${pct(report.gc)}`
    : `GC ${pct(report.gcRange.min)}–${pct(report.gcRange.max)}`;
}

interface Props {
  readonly doc: SeqDocument;
  readonly probe: PrimerProbe;
}

/**
 * The workspace's Check page (item 107, stage two): the primer on the left
 * — its numbers as a line of labels, the settings it breaks as a list, the
 * dimer checks, the actions — and where it binds on the right, as a table
 * a row a site. Labels and tooltips rather than prose; the guide has the
 * prose.
 */
export function PrimerCheck({ doc, probe }: Props) {
  const { report, sites } = probe;
  const [saved, setSaved] = useState<string | null>(null);
  const live = report !== null && report.length > 0;
  return (
    <div className="checkgrid">
      <div className="checkgrid__primer">
        <ProbeBox probe={probe} />
        {live && (
          <>
            <p className="statline" aria-label="Primer summary">
              <span>{report.length} nt</span>
              <span data-tip="Melting temperature, nearest-neighbour">{tmText(report)}</span>
              <span data-tip="GC content">{gcText(report)}</span>
              {report.gcClamp && (
                <span className="dt__ok" data-tip="Ends in G or C">
                  clamp
                </span>
              )}
              {report.degenerate > 0 && (
                <span
                  data-tip={`${report.degenerate} degenerate ${report.degenerate === 1 ? 'position' : 'positions'}; Tm and GC are ranges over the mix, hairpins and dimers are counted on the plain bases`}
                >
                  mix of {report.molecules.toLocaleString()}
                </span>
              )}
            </p>
            <ul className="warns" aria-label="Warnings">
              {report.warnings.map((w) => (
                <li key={w} className="warns__warn">
                  {w}
                </li>
              ))}
              <li
                className="warns__ok"
                data-tip="Longest hairpin stem, self-complementary stretch and 3′-end self-pairing, bp"
              >
                {report.hairpin === 0 ? 'No hairpin' : `Hairpin ${report.hairpin} bp`}, self-dimer{' '}
                {report.selfComplementarity} bp, 3′ dimer {report.threePrimeSelf} bp
              </li>
            </ul>
            <div className="actions">
              {sites.length > 0 && (
                <button
                  type="button"
                  className="button button--small"
                  data-tip="Annotate every site as a primer_bind feature, one undo step"
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
            {saved !== null && (
              <p className="panel__note panel__note--quiet" role="status">
                {saved}
              </p>
            )}
          </>
        )}
      </div>
      {live && (
        <div className="checkgrid__sites">
          <div className="subhead">
            Binding sites
            <span className="dnote" data-tip="Both strands, through the origin of a circle">
              3′ end exact, ≤ 2 mismatches
            </span>
          </div>
          {report.length < 8 ? (
            <p className="dnote">At least 8 bases are needed to search.</p>
          ) : sites.length === 0 ? (
            <p className="dnote">None on {doc.name}.</p>
          ) : (
            <table className="sites" aria-label="Binding sites">
              <thead>
                <tr>
                  <th>
                    <span className="visually-hidden">Strand</span>
                  </th>
                  <th>Position</th>
                  <th>Mismatches</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={`${s.strand}-${s.range.start}`}>
                    <td className="sites__strand">{s.strand === 'forward' ? '→' : '←'}</td>
                    <td>
                      <button
                        type="button"
                        className="link link--mono"
                        data-tip="Select the bases it anneals to"
                        onClick={() => {
                          goToSite(s);
                        }}
                      >
                        {siteSpan(s, doc.length)}
                      </button>
                    </td>
                    <td>{s.mismatches === 0 ? 'exact' : s.mismatches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="dnote checkgrid__note">
            The whole oligo must match; for a tailed cloning primer use Cloning ▸ PCR.
          </p>
        </div>
      )}
    </div>
  );
}
