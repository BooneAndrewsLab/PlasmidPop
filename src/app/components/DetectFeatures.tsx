import { useState } from 'react';

import {
  type SeqDocument,
  MIN_IDENTITY_CHOICES,
  describeMatch,
  featureFromHit,
  formatIdentity,
  formatLocation,
} from '@/core';
import { featureColor } from '@/view/featureColors';

import { analytics } from '../analytics';
import { type Offer, detectionStore, offered, useDetection } from '../state/detection';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly documentId: string;
  readonly doc: SeqDocument;
}

/** The button in the Features tab's header that starts a search. */
export function DetectFeaturesButton({ documentId, doc }: Props) {
  const state = useDetection(documentId);
  return (
    <button
      type="button"
      className="button button--quiet button--small features__detect"
      disabled={doc.length === 0 || state?.status === 'running'}
      title="Look for common parts (origins, resistance genes, promoters, terminators, tags, primer sites, fluorescent proteins) in this sequence"
      onClick={() => {
        void detectionStore.run(documentId, doc);
      }}
    >
      Detect features
    </button>
  );
}

/**
 * What a search found, offered as a list to tick (item 59): every new hit
 * ticked, the ones the document already has listed apart. Adding them is
 * one edit, so one undo takes them all away again.
 */
export function DetectFeaturesPanel({ documentId, doc }: Props) {
  const state = useDetection(documentId);
  if (state === null) return null;
  if (state.status === 'running') {
    return (
      <section className="detect" aria-label="Detect features">
        <div className="align-progress">
          <progress
            className="align-progress__bar"
            value={state.progress}
            max={1}
            aria-label="Detect features progress"
          />
          <span className="align-progress__label" aria-live="polite">
            {Math.floor(state.progress * 100)}%
          </span>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              detectionStore.dismiss(documentId);
            }}
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className="detect" aria-label="Detect features">
        <p className="detect__message detect__message--error">
          Detect features failed: {state.message}
        </p>
        <DismissButton documentId={documentId} />
      </section>
    );
  }
  const offers = offered(state, doc);
  if (offers === null) {
    return (
      <section className="detect" aria-label="Detect features">
        <p className="detect__message">The sequence has changed since it was searched.</p>
        <div className="detect__actions">
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              void detectionStore.run(documentId, doc);
            }}
          >
            Search again
          </button>
          <DismissButton documentId={documentId} />
        </div>
      </section>
    );
  }
  return <OfferList documentId={documentId} doc={doc} offers={offers} />;
}

function DismissButton({ documentId }: { readonly documentId: string }) {
  return (
    <button
      type="button"
      className="button button--quiet button--small"
      onClick={() => {
        detectionStore.dismiss(documentId);
      }}
    >
      Dismiss
    </button>
  );
}

function OfferList({
  documentId,
  doc,
  offers,
}: Props & {
  readonly offers: readonly Offer[];
}) {
  const { detectOnOpen, detectMinIdentity } = useEditorState();
  const fresh = offers.filter((o) => !o.duplicate);
  const known = offers.length - fresh.length;
  // Unticked rather than ticked, so a hit that turns into a duplicate (the
  // user annotated it meanwhile) simply drops out of the count.
  const [unticked, setUnticked] = useState<ReadonlySet<Offer['detection']>>(new Set());
  const chosen = fresh.filter((o) => !unticked.has(o.detection));
  const toggle = (o: Offer, on: boolean): void => {
    const next = new Set(unticked);
    if (on) next.delete(o.detection);
    else next.add(o.detection);
    setUnticked(next);
  };

  const summary =
    offers.length === 0
      ? 'No common features found.'
      : fresh.length === 0
        ? `Found ${plural(offers.length, 'common feature')}, all of them already annotated.`
        : `Found ${plural(fresh.length, 'common feature')}` +
          (known === 0 ? '.' : `, and ${known} already annotated.`);

  return (
    <section className="detect" aria-label="Detect features">
      <p className="detect__message">{summary}</p>
      {fresh.length > 0 && (
        <ul className="detect__list">
          {fresh.map((o, i) => {
            const { hit, part } = o.detection;
            const feature = featureFromHit(hit, part);
            const source =
              part.source === 'fpbase'
                ? `${part.accession} ${part.location}, via FPbase`
                : `${part.accession} ${part.location}`;
            return (
              <li key={i} className="detect__item">
                <label className="detect__check">
                  <input
                    type="checkbox"
                    checked={!unticked.has(o.detection)}
                    aria-label={`Add ${part.name}`}
                    onChange={(e) => {
                      toggle(o, e.target.checked);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="feature-row"
                  title={`${part.note ?? part.name}\nMatched against ${source}`}
                  onClick={() => {
                    editorStore.setSelection(hit.range);
                    editorStore.revealPosition(hit.range.start);
                  }}
                >
                  <span
                    className="feature-row__swatch"
                    style={{ background: featureColor(feature) }}
                    aria-hidden="true"
                  />
                  <span className="feature-row__text">
                    <span className="feature-row__name">{part.name}</span>
                    <span className="feature-row__detail">
                      <span>{part.type} </span>
                      <span className="feature-row__location">
                        {formatLocation(feature, doc.length, doc.topology)}
                      </span>
                    </span>
                    <span
                      className={`feature-row__detail${hit.identity < 1 ? ' detect__near' : ''}`}
                    >
                      {describeMatch(hit)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="detect__actions">
        {fresh.length > 0 && (
          <button
            type="button"
            className="button button--primary button--small"
            disabled={chosen.length === 0}
            onClick={() => {
              detectionStore.accept(
                documentId,
                chosen.map((o) => o.detection),
                chosen.length === fresh.length,
              );
            }}
          >
            {chosen.length === 1 ? 'Add 1 feature' : `Add ${chosen.length} features`}
          </button>
        )}
        {fresh.length > 1 && (
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              setUnticked(chosen.length === 0 ? new Set() : new Set(fresh.map((o) => o.detection)));
            }}
          >
            {chosen.length === 0 ? 'Tick all' : 'Untick all'}
          </button>
        )}
        <DismissButton documentId={documentId} />
      </div>
      <div className="detect__settings">
        <label className="panel__form-check">
          Match at least{' '}
          <select
            value={detectMinIdentity}
            onChange={(e) => {
              editorStore.setDetectMinIdentity(Number(e.target.value));
              void detectionStore.run(documentId, doc);
            }}
          >
            {MIN_IDENTITY_CHOICES.map((v) => (
              <option key={v} value={v}>
                {v === 1 ? 'exactly' : formatIdentity(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="panel__form-check">
          <input
            type="checkbox"
            checked={detectOnOpen}
            onChange={(e) => {
              editorStore.setDetectOnOpen(e.target.checked);
              analytics.track('detect', 'setting', e.target.checked ? 'on' : 'off');
            }}
          />
          Detect in every file opened without features
        </label>
      </div>
    </section>
  );
}

function plural(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}
