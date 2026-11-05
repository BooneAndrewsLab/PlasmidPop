import { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type CutSite,
  DEFAULT_GEL,
  type DigestProfile,
  type GelOptions,
  type SeqDocument,
  type WrongClone,
  activeEnzymes,
  compareCheckAll,
  compareDiagnostic,
  cuttableSites,
  describeBands,
  emptyVectorClone,
  enzymeProfile,
  findCutSites,
  gelProfile,
  getEnzyme,
  laneContrast,
  wrongLanes,
} from '@/core';

import { useGelOptions } from '../state/useGel';
import { BenchProductSlot } from './benchProductSlot';
import { DiffMap } from './DiffMap';
import { Gel } from './Gel';
import { ProtocolDialog } from './ProtocolDialog';
import { type Ingredient } from './tube';

/** Past this many cuts an enzyme's lane is a smear, not a check. */
const MAX_CHECK_CUTS = 6;

/** A wrong clone's lane cut with the check enzyme (item 132). */
interface WrongLaneProfile {
  readonly clone: WrongClone;
  readonly profile: DigestProfile;
  /** Whether a gel tells this lane from the product's. */
  readonly apart: boolean;
}

interface CheckEnzyme {
  readonly name: string;
  readonly profile: DigestProfile;
  /** Where it cuts, for the map to mark. */
  readonly sites: readonly CutSite[];
  /** Each wrong clone cut with it, in the gel's order (#78, item 132). */
  readonly wrong: readonly WrongLaneProfile[];
}

const NO_SITES: readonly CutSite[] = [];
const NO_PARTS: readonly Ingredient[] = [];

/** The empty vector alone: what a one-pot assembly can give besides its product. */
function emptyOnly(vector: Ingredient): readonly WrongClone[] {
  return emptyVectorClone(vector.fragment ?? vector.document);
}

/**
 * Every enzyme in the set in use that cuts `doc`, with its sites, leaving
 * out the ones its own methylation would block, as the digest leaves them.
 */
function sitesByEnzyme(doc: SeqDocument): Map<string, CutSite[]> {
  const text = doc.sequence.toString();
  const sites = cuttableSites(
    text,
    doc.topology,
    doc.methylation,
    findCutSites(text, doc.topology, activeEnzymes()),
    (name) => getEnzyme(name)?.site.length ?? 0,
  );
  const byEnzyme = new Map<string, CutSite[]>();
  for (const s of sites) byEnzyme.set(s.enzyme, [...(byEnzyme.get(s.enzyme) ?? []), s]);
  return byEnzyme;
}

/**
 * The enzymes worth checking the product with, best first: each one that
 * cuts it at least once and at most `MAX_CHECK_CUTS` times. With wrong
 * clones to compare with, they are ordered by how well the product's lane
 * differs from every wrong one (`compareCheckAll`), since what a miniprep
 * screen asks is whether a colony took the insert, and took it once and
 * the right way round; without any, by how well the product's lane reads
 * alone, as the Enzymes tab's band separation sort orders them. An enzyme
 * that does not cut a wrong circle leaves it uncut, which does not run at
 * its size, so its lane is empty and tells nothing apart.
 */
function checkEnzymes(
  product: SeqDocument,
  wrong: readonly WrongClone[],
  gel: GelOptions,
): CheckEnzyme[] {
  const { resolution } = { ...DEFAULT_GEL, ...gel };
  const wrongSites = wrong.map((clone) => ({ clone, sites: sitesByEnzyme(clone.molecule) }));
  const out: CheckEnzyme[] = [];
  for (const [name, own] of sitesByEnzyme(product)) {
    if (own.length > MAX_CHECK_CUTS) continue;
    const profile = enzymeProfile(own, product.length, product.topology, gel);
    out.push({
      name,
      profile,
      sites: own,
      wrong: wrongSites.map(({ clone, sites }) => {
        const theirs = sites.get(name);
        const lane =
          theirs === undefined
            ? gelProfile([], gel)
            : enzymeProfile(theirs, clone.molecule.length, clone.molecule.topology, gel);
        return {
          clone,
          profile: lane,
          apart: laneContrast(profile, lane, gel).contrast >= resolution,
        };
      }),
    });
  }
  const lanes = (e: CheckEnzyme) => ({ product: e.profile, wrong: e.wrong.map((w) => w.profile) });
  return out.sort(
    (a, b) =>
      (wrong.length === 0
        ? compareDiagnostic(a.profile, b.profile, gel)
        : compareCheckAll(lanes(a), lanes(b), gel)) || a.name.localeCompare(b.name),
  );
}

/** "tells all apart", or which wrong lanes the enzyme cannot tell from the product's. */
function describeCheck(e: CheckEnzyme, best: boolean): string {
  if (e.wrong.length === 0) return best ? ' (clearest)' : '';
  const missed = e.wrong.filter((w) => !w.apart).map((w) => w.clone.label.toLowerCase());
  if (missed.length === 0) return best ? ' (tells all apart)' : '';
  return `; same as ${missed.join(', ')}`;
}

/** The wrong lanes of `check`, each with its bands and the lanes it cannot be told from. */
function WrongLegend({ check, gel }: { readonly check: CheckEnzyme; readonly gel: GelOptions }) {
  const { resolution } = { ...DEFAULT_GEL, ...gel };
  return (
    <ul className="bench__wrong" aria-label="What a wrong colony gives">
      {check.wrong.map((w, i) => {
        const alike = check.wrong
          .filter(
            (o, k) =>
              k !== i &&
              o.profile.bands.length > 0 &&
              w.profile.bands.length > 0 &&
              laneContrast(w.profile, o.profile, gel).contrast < resolution,
          )
          .map((o) => o.clone.label);
        return (
          <li key={w.clone.kind + w.clone.name}>
            <b>{w.clone.label}</b> ({w.clone.name.toLowerCase()}): {w.clone.why}{' '}
            {w.profile.bands.length === 0
              ? 'Uncut, so it runs supercoiled and is not drawn.'
              : `${describeBands(w.profile)} bp.`}
            {!w.apart && ' Same as the product.'}
            {w.apart && alike.length > 0 && ` Same as ${alike.join(', ')}.`}
          </li>
        );
      })}
    </ul>
  );
}

/** The part a vector most likely is: the longest one in the tube. */
function longest(parts: readonly Ingredient[]): Ingredient | undefined {
  return parts.reduce<Ingredient | undefined>(
    (best, p) => (best === undefined || p.document.length > best.document.length ? p : best),
    undefined,
  );
}

/** The product's map, drawn as its SVG export draws it, and a digest to check it by. */
function ProductView({
  product,
  parts,
  onCheckPrimers,
  wrongClonesOf = emptyOnly,
}: {
  readonly product: SeqDocument;
  readonly parts: readonly Ingredient[];
  readonly onCheckPrimers?: ((vectorId: string) => void) | undefined;
  readonly wrongClonesOf?: ((vector: Ingredient) => readonly WrongClone[]) | undefined;
}) {
  const gel = useGelOptions();
  const [vectorId, setVectorId] = useState('');
  const vector = parts.find((p) => p.id === vectorId) ?? longest(parts);
  // The reaction's own list of wrong clones for this vector (item 132),
  // capped to what the gel can show; the names past the cap are listed.
  const { shown: wrong, omitted } = useMemo(
    () => wrongLanes(vector === undefined ? [] : wrongClonesOf(vector)),
    [vector, wrongClonesOf],
  );
  const empty = wrong.find((w) => w.kind === 'empty')?.molecule ?? null;
  const enzymes = useMemo(() => checkEnzymes(product, wrong, gel), [product, wrong, gel]);
  const [picked, setPicked] = useState('');
  const [protocol, setProtocol] = useState(false);
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
          explore
        />
      </div>
      {product.metadata.lineage !== null && (
        <div className="panel__section">
          <button
            type="button"
            className="button button--small"
            data-tip="Oligos to order, reactions and the expected gel, as a page to take to the bench"
            onClick={() => {
              setProtocol(true);
            }}
          >
            Protocol…
          </button>
          {protocol && (
            <ProtocolDialog
              doc={product}
              wrongClones={wrong}
              onClose={() => {
                setProtocol(false);
              }}
            />
          )}
        </div>
      )}
      {onCheckPrimers !== undefined && (
        <div className="panel__section">
          <h3 className="panel__heading">
            Check by colony PCR
            <span className="panel__heading-note">primers across the junctions</span>
          </h3>
          <button
            type="button"
            className="button button--small"
            data-tip="Assemble the product and design primers that give a band only with the insert, and a size with and without it"
            onClick={() => {
              onCheckPrimers(vectorId);
            }}
          >
            Design check primers…
          </button>
        </div>
      )}
      <div className="panel__section">
        <h3 className="panel__heading">
          Check by digest
          <span className="panel__heading-note">before you pick colonies</span>
        </h3>
        {parts.length > 1 && vector !== undefined && (
          <label className="panel__field panel__field--row">
            <span>Against</span>
            <select
              className="panel__select"
              aria-label="Vector to check against"
              value={vector.id}
              onChange={(e) => {
                setVectorId(e.target.value);
              }}
            >
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.document.name}, {p.document.length.toLocaleString()} bp
                </option>
              ))}
            </select>
          </label>
        )}
        {vector !== undefined && empty === null && (
          <p className="panel__note">
            {vector.document.name} cannot close on itself (its ends do not join, or were
            dephosphorylated), so a colony without the insert is unlikely
            {wrong.length === 0 ? ' and the product is checked alone' : ''}.
          </p>
        )}
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
                    {describeCheck(e, i === 0)}
                  </option>
                ))}
              </select>
            </label>
            {/* The wrong lanes first, the product last: the last lane is the
                one the gel writes sizes beside. An uncut circle is not a lane. */}
            <Gel
              lanes={[
                ...check.wrong
                  .filter((w) => w.profile.bands.length > 0)
                  .map((w) => ({ profile: w.profile, label: w.clone.label })),
                { profile: check.profile, label: check.name },
              ]}
            />
            {check.wrong.length > 0 && <WrongLegend check={check} gel={gel} />}
            {omitted.length > 0 && (
              <p className="panel__note">
                Also possible, not drawn: {omitted.map((n) => n.toLowerCase()).join('; ')}.
              </p>
            )}
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
export function BenchProduct({
  product,
  parts = NO_PARTS,
  onCheckPrimers,
  wrongClonesOf,
}: {
  readonly product: SeqDocument | null;
  /** What went into the tube, to pick the empty vector from (#78). */
  readonly parts?: readonly Ingredient[];
  /** Assembles the product and opens the clone check on it (item 120); absent, no such button. */
  readonly onCheckPrimers?: ((vectorId: string) => void) | undefined;
  /**
   * The wrong clones the reaction may give with this part as the vector
   * (item 132), most common first; by default the empty vector alone. Keep
   * it stable across renders, since the lanes are digested again when it
   * changes.
   */
  readonly wrongClonesOf?: ((vector: Ingredient) => readonly WrongClone[]) | undefined;
}) {
  const slot = useContext(BenchProductSlot);
  if (slot === null) return null;
  return createPortal(
    product === null ? (
      <p className="panel__note">
        The product is drawn here once the parts in the tube go together.
      </p>
    ) : (
      <ProductView
        product={product}
        parts={parts}
        onCheckPrimers={onCheckPrimers}
        wrongClonesOf={wrongClonesOf}
      />
    ),
    slot,
  );
}
