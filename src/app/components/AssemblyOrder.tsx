import { Fragment } from 'react';

import {
  type DroppedPart,
  type GibsonAssembly,
  type GibsonJoin,
  describeGibsonDropped,
} from '@/core';

import { AssemblyWarnings } from './AssemblyWarnings';
import { ProductSummary } from './ProductSummary';

/** What a panel says of one junction: whether to mark it, and the text after the overlap's length. */
export interface JunctionVerdict {
  readonly weak: boolean;
  readonly detail: string;
}

/**
 * The parts of a Gibson-family assembly in order with the homology each
 * junction is made of, the product's summary and the warnings. Gibson and
 * yeast assembly show the same list and judge a junction by different rules
 * (Tm at 50 °C in a tube, length and GC in a nucleus), so each panel passes
 * its own `judge`.
 */
export function AssemblyOrder({
  assembly,
  circular,
  label,
  vectorIndex = null,
  judge,
}: {
  readonly assembly: GibsonAssembly;
  readonly circular: boolean;
  /** The list's accessible name. */
  readonly label: string;
  /** Which entry is the vector, when the assembly has one. */
  readonly vectorIndex?: number | null;
  readonly judge: (join: GibsonJoin) => JunctionVerdict;
}) {
  const last = assembly.order.length - 1;
  return (
    <>
      <p className="panel__note">
        {assembly.order.length === 1
          ? '1 part closes on itself'
          : `${assembly.order.length} parts join`}{' '}
        into a {assembly.product.length.toLocaleString()} bp {circular ? 'circle' : 'molecule'}, in
        this order:
      </p>
      <ol className="part-list" aria-label={label}>
        {assembly.order.map((p, i) => {
          const join = assembly.joins[i];
          return (
            <Fragment key={`${p.document.name}-${i}`}>
              <li className="part">
                <span className="part__index">{i + 1}</span>
                <span className="part__text">
                  <span className="part__name">
                    {p.document.name}
                    {p.flipped ? ' (flipped)' : ''}
                    {i === vectorIndex ? ' (vector)' : ''}
                  </span>
                  <span className="part__detail">{p.document.length.toLocaleString()} bp</span>
                </span>
              </li>
              {join !== undefined && (
                <JunctionRow join={join} verdict={judge(join)} closing={i === last} />
              )}
            </Fragment>
          );
        })}
      </ol>
      <ProductSummary product={assembly.product} />
      <AssemblyWarnings texts={assembly.warnings.map((w) => w.text)} />
    </>
  );
}

function JunctionRow({
  join,
  verdict,
  closing,
}: {
  readonly join: GibsonJoin;
  readonly verdict: JunctionVerdict;
  readonly closing: boolean;
}) {
  return (
    <li
      className={`junction${verdict.weak ? ' junction--weak' : ' junction--ok'}`}
      data-tip={`Shared: ${join.overlap.toUpperCase()}`}
    >
      <span className="junction__mark" aria-hidden="true">
        {verdict.weak ? '!' : '✓'}
      </span>
      <span className="junction__text">
        {closing ? 'closes: ' : ''}
        {join.length} bp overlap, {verdict.detail}
      </span>
    </li>
  );
}

/** The documents the tube left out, and why, under a disclosure. */
export function DroppedParts({
  dropped,
  minOverlap,
}: {
  readonly dropped: readonly DroppedPart[];
  readonly minOverlap: number;
}) {
  return (
    <details className="gg__left-out">
      <summary>
        {dropped.length === 1 ? '1 document left out' : `${dropped.length} documents left out`}
      </summary>
      <ul>
        {dropped.map((d, i) => (
          <li key={`${d.document.name}-${i}`} className="gg__dropped">
            <span className="gg__dropped-size">{d.document.name}</span>{' '}
            {describeGibsonDropped(d, minOverlap)}.
          </li>
        ))}
      </ul>
    </details>
  );
}
