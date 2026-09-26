import { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type CutSite,
  type DigestProfile,
  type GelOptions,
  type SeqDocument,
  activeEnzymes,
  compareCheck,
  compareDiagnostic,
  cuttableSites,
  describeBands,
  emptyVector,
  enzymeProfile,
  findCutSites,
  gelProfile,
  getEnzyme,
  laneContrast,
} from '@/core';

import { useGelOptions } from '../state/useGel';
import { BenchProductSlot } from './benchProductSlot';
import { DiffMap } from './DiffMap';
import { Gel } from './Gel';
import { type Ingredient } from './tube';

/** Past this many cuts an enzyme's lane is a smear, not a check. */
const MAX_CHECK_CUTS = 6;

interface CheckEnzyme {
  readonly name: string;
  readonly profile: DigestProfile;
  /** Where it cuts, for the map to mark. */
  readonly sites: readonly CutSite[];
  /** The empty vector cut with it, when there is one to compare with (#78). */
  readonly empty: DigestProfile | null;
}

const NO_SITES: readonly CutSite[] = [];
const NO_PARTS: readonly Ingredient[] = [];

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
 * cuts it at least once and at most `MAX_CHECK_CUTS` times. With an empty
 * vector to compare with, they are ordered by how well the two lanes
 * differ (`compareCheck`), since what a miniprep screen asks is whether a
 * colony took the insert; without one, by how well the product's lane
 * reads alone, as the Enzymes tab's band separation sort orders them. An
 * enzyme that does not cut the empty circle leaves it uncut, which does not
 * run at its size, so its lane is empty and tells nothing apart.
 */
function checkEnzymes(
  product: SeqDocument,
  empty: SeqDocument | null,
  gel: GelOptions,
): CheckEnzyme[] {
  const emptySites = empty === null ? null : sitesByEnzyme(empty);
  const out: CheckEnzyme[] = [];
  for (const [name, own] of sitesByEnzyme(product)) {
    if (own.length > MAX_CHECK_CUTS) continue;
    const theirs = emptySites?.get(name);
    out.push({
      name,
      profile: enzymeProfile(own, product.length, product.topology, gel),
      sites: own,
      empty:
        empty === null
          ? null
          : theirs === undefined
            ? gelProfile([], gel)
            : enzymeProfile(theirs, empty.length, empty.topology, gel),
    });
  }
  const pair = (e: CheckEnzyme) => ({ product: e.profile, empty: e.empty ?? e.profile });
  return out.sort(
    (a, b) =>
      (empty === null
        ? compareDiagnostic(a.profile, b.profile, gel)
        : compareCheck(pair(a), pair(b), gel)) || a.name.localeCompare(b.name),
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
}: {
  readonly product: SeqDocument;
  readonly parts: readonly Ingredient[];
}) {
  const gel = useGelOptions();
  const [vectorId, setVectorId] = useState('');
  const vector = parts.find((p) => p.id === vectorId) ?? longest(parts);
  // A shelf part's fragment is kept by the shelf and a tab's document by
  // its history, so either is stable across renders where the ingredient
  // wrapped round it (and a shelf part's document) is not.
  const molecule = vector === undefined ? undefined : (vector.fragment ?? vector.document);
  const empty = useMemo(() => (molecule === undefined ? null : emptyVector(molecule)), [molecule]);
  const enzymes = useMemo(() => checkEnzymes(product, empty, gel), [product, empty, gel]);
  const [picked, setPicked] = useState('');
  const check = enzymes.find((e) => e.name === picked) ?? enzymes[0];
  const apart = (e: CheckEnzyme): boolean =>
    e.empty !== null && laneContrast(e.profile, e.empty, gel).contrast >= gel.resolution;
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
            dephosphorylated), so a colony without the insert is unlikely and the product is checked
            alone.
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
                    {e.empty === null
                      ? i === 0
                        ? ' (clearest)'
                        : ''
                      : `; empty ${e.empty.bands.length === 0 ? 'uncut' : describeBands(e.empty)}${
                          !apart(e) ? ' (same)' : i === 0 ? ' (tells apart best)' : ''
                        }`}
                  </option>
                ))}
              </select>
            </label>
            <Gel
              lanes={
                check.empty === null || check.empty.bands.length === 0
                  ? [{ profile: check.profile, label: check.name }]
                  : [
                      { profile: check.empty, label: 'Empty' },
                      { profile: check.profile, label: check.name },
                    ]
              }
            />
            {check.empty !== null && check.empty.bands.length === 0 && (
              <p className="panel__note">
                {check.name} does not cut {empty?.name}: left uncut, a circle runs as supercoiled
                DNA, not at its size, so this lane cannot tell a colony without the insert.
              </p>
            )}
            {check.empty !== null && check.empty.bands.length > 0 && !apart(check) && (
              <p className="panel__note">
                {check.name} gives {empty?.name} the same bands as the product.
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
}: {
  readonly product: SeqDocument | null;
  /** What went into the tube, to pick the empty vector from (#78). */
  readonly parts?: readonly Ingredient[];
}) {
  const slot = useContext(BenchProductSlot);
  if (slot === null) return null;
  return createPortal(
    product === null ? (
      <p className="panel__note">
        The product is drawn here once the parts in the tube go together.
      </p>
    ) : (
      <ProductView product={product} parts={parts} />
    ),
    slot,
  );
}
