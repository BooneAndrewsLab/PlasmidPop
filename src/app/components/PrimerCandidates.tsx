import { useState } from 'react';

import { type PrimerPair, type SeqDocument } from '@/core';

import { addFeaturesAsOneStep } from '../state/featureSteps';
import { savePrimers } from '../state/primerCollection';
import { type PrimerDesign, pct, primerFeature, tm } from './primerDesign';

/**
 * One primer of a candidate pair: its strand as the arrow the site lists
 * use, the bases to order, and the Tm and GC content beside them when the
 * row is wide enough, under them when it is not (the row wraps).
 */
function Oligo({
  strand,
  primer,
}: {
  readonly strand: 'forward' | 'reverse';
  readonly primer: PrimerPair['forward'];
}) {
  return (
    <div className="pair__oligo">
      <span
        className="pair__strand"
        data-tip={`${strand === 'forward' ? 'Forward' : 'Reverse'} primer`}
      >
        {strand === 'forward' ? '→' : '←'}
      </span>
      <span className="pair__seq">{primer.sequence}</span>
      <span
        className="pair__meta pair__meta--oligo"
        data-tip={`Tm ${tm(primer.tm)}, GC content ${pct(primer.gc)}`}
      >
        {tm(primer.tm)} · {pct(primer.gc)} GC
      </span>
    </div>
  );
}

interface Props {
  readonly doc: SeqDocument;
  readonly design: PrimerDesign;
}

/**
 * The designed pairs as blocks (item 93), on the workspace's Results page
 * (item 107): rank, product size and ΔTm, the two primers, and Show, Add
 * both and Save both. Nothing here is shown until a design was made.
 */
export function PrimerCandidates({ doc, design }: Props) {
  const { pairs, designedFor, shown, setHovered, showPair } = design;
  /** What the last save to My primers came to, said under the list. */
  const [saved, setSaved] = useState<string | null>(null);
  if (pairs === null) {
    return <p className="panel__note">No design yet. Design primers for a target first.</p>;
  }
  if (pairs.length === 0) {
    return (
      <p className="panel__note">
        No suitable pairs for {designedFor}. Try a different region, look further from it, or loosen
        the settings.
      </p>
    );
  }
  return (
    <div className="panel__section">
      <p className="panel__note panel__note--quiet">
        {pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'} for {designedFor}, best first. Point
        at one to see it in the views.
      </p>
      <ol className="pair-list pair-list--candidates" aria-label="Designed pairs">
        {pairs.map((p, i) => (
          <li
            key={i}
            className={`pair pair--candidate${shown === i ? ' pair--shown' : ''}`}
            onMouseEnter={() => {
              setHovered(i);
            }}
            onMouseLeave={() => {
              setHovered((h) => (h === i ? null : h));
            }}
            onFocus={() => {
              setHovered(i);
            }}
            onBlur={() => {
              setHovered((h) => (h === i ? null : h));
            }}
          >
            <div className="pair__head">
              <span className="pair__rank">{i + 1}</span>
              <span className="pair__length">{p.productLength.toLocaleString()} bp</span>
              <span className="pair__delta">ΔTm {p.tmDifference.toFixed(1)} °C</span>
            </div>
            <Oligo strand="forward" primer={p.forward} />
            <Oligo strand="reverse" primer={p.reverse} />
            <div className="pair__foot pair__foot--actions">
              <span className="pair__buttons">
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-pressed={shown === i}
                  data-tip="Draw the pair and its product in the views, and select the product"
                  onClick={() => {
                    showPair(i, p);
                  }}
                >
                  {shown === i ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-label="Add both as features"
                  data-tip="Annotate both sites as primer_bind features, one undo step"
                  onClick={() => {
                    // One click, so one Undo takes both back (#96).
                    addFeaturesAsOneStep(
                      [
                        primerFeature(
                          `Fwd primer ${i + 1}`,
                          p.forwardSite,
                          'forward',
                          p.forward.sequence,
                        ),
                        primerFeature(
                          `Rev primer ${i + 1}`,
                          p.reverseSite,
                          'reverse',
                          p.reverse.sequence,
                        ),
                      ],
                      p.reverseSite,
                    );
                  }}
                >
                  Add both
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  data-tip="Keep both primers in My primers, in this browser"
                  onClick={() => {
                    const note = (tmValue: number, gc: number): string =>
                      `Designed for ${doc.name} ${designedFor}; Tm ${tm(tmValue)}, GC ${pct(gc)}`;
                    void savePrimers(
                      [
                        {
                          name: `${doc.name} fwd ${i + 1}`,
                          sequence: p.forward.sequence,
                          notes: note(p.forward.tm, p.forward.gc),
                        },
                        {
                          name: `${doc.name} rev ${i + 1}`,
                          sequence: p.reverse.sequence,
                          notes: note(p.reverse.tm, p.reverse.gc),
                        },
                      ],
                      'design',
                    ).then((r) => {
                      setSaved(
                        r.added.length === 0
                          ? 'Already in My primers.'
                          : `Saved ${r.added.map((q) => q.name).join(' and ')} to My primers.`,
                      );
                    });
                  }}
                >
                  Save both
                </button>
              </span>
            </div>
          </li>
        ))}
      </ol>
      {saved !== null && <p className="panel__note panel__note--quiet">{saved}</p>}
    </div>
  );
}
