import { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type CutSite,
  type DigestProfile,
  type GelOptions,
  type SeqDocument,
  activeEnzymes,
  compareDiagnostic,
  cuttableSites,
  describeBands,
  enzymeProfile,
  findCutSites,
  getEnzyme,
} from '@/core';

import { useGelOptions } from '../state/useGel';
import { BenchProductSlot } from './benchProductSlot';
import { DiffMap } from './DiffMap';
import { Gel } from './Gel';

/** Past this many cuts an enzyme's lane is a smear, not a check. */
const MAX_CHECK_CUTS = 6;

interface CheckEnzyme {
  readonly name: string;
  readonly profile: DigestProfile;
  /** Where it cuts, for the map to mark. */
  readonly sites: readonly CutSite[];
}

const NO_SITES: readonly CutSite[] = [];

/**
 * The enzymes worth checking the product with, best first: each one that
 * cuts it at least once and at most `MAX_CHECK_CUTS` times, ordered by how
 * well its lane answers "is this the construct", as the Enzymes tab's band
 * separation sort orders them. Sites the product's own methylation would
 * block are left out, as the digest leaves them out.
 */
function checkEnzymes(product: SeqDocument, gel: GelOptions): CheckEnzyme[] {
  const text = product.sequence.toString();
  const sites = cuttableSites(
    text,
    product.topology,
    product.methylation,
    findCutSites(text, product.topology, activeEnzymes()),
    (name) => getEnzyme(name)?.site.length ?? 0,
  );
  const byEnzyme = new Map<string, typeof sites>();
  for (const s of sites) byEnzyme.set(s.enzyme, [...(byEnzyme.get(s.enzyme) ?? []), s]);
  const out: CheckEnzyme[] = [];
  for (const [name, own] of byEnzyme) {
    if (own.length > MAX_CHECK_CUTS) continue;
    out.push({
      name,
      profile: enzymeProfile(own, product.length, product.topology, gel),
      sites: own,
    });
  }
  return out.sort(
    (a, b) => compareDiagnostic(a.profile, b.profile, gel) || a.name.localeCompare(b.name),
  );
}

/** The product's map, drawn as its SVG export draws it, and a digest to check it by. */
function ProductView({ product }: { readonly product: SeqDocument }) {
  const gel = useGelOptions();
  const enzymes = useMemo(() => checkEnzymes(product, gel), [product, gel]);
  const [picked, setPicked] = useState('');
  const check = enzymes.find((e) => e.name === picked) ?? enzymes[0];
  return (
    <>
      <h3 className="panel__heading">
        {product.name}
        <span className="panel__heading-note">
          {product.length.toLocaleString()} bp, {product.isCircular ? 'circular' : 'linear'}
        </span>
      </h3>
      {/* The editor's own map renderer, read-only and in the app's colours,
          with the check digest's cuts marked. */}
      <div className="bench__map">
        <DiffMap
          doc={product}
          cutSites={check?.sites ?? NO_SITES}
          size={360}
          label={`Map of ${product.name}`}
        />
      </div>
      <div className="panel__section">
        <h3 className="panel__heading">
          Check by digest
          <span className="panel__heading-note">before you pick colonies</span>
        </h3>
        {check === undefined ? (
          <p className="panel__note">
            No enzyme in the set in use cuts {product.name} between once and {MAX_CHECK_CUTS} times.
          </p>
        ) : (
          <>
            <label className="panel__field panel__field--row">
              <span>Enzyme</span>
              <select
                className="panel__select"
                aria-label="Check digest enzyme"
                value={check.name}
                onChange={(e) => {
                  setPicked(e.target.value);
                }}
              >
                {enzymes.map((e, i) => (
                  <option key={e.name} value={e.name}>
                    {e.name}: {describeBands(e.profile)}
                    {i === 0 ? ' (clearest)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <Gel lanes={[{ profile: check.profile, label: check.name }]} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * Puts a reaction's product in the Bench's product column, or says there is
 * none yet. Renders nothing outside the Bench.
 */
export function BenchProduct({ product }: { readonly product: SeqDocument | null }) {
  const slot = useContext(BenchProductSlot);
  if (slot === null) return null;
  return createPortal(
    product === null ? (
      <p className="panel__note">
        The product is drawn here once the parts in the tube go together.
      </p>
    ) : (
      <ProductView product={product} />
    ),
    slot,
  );
}
