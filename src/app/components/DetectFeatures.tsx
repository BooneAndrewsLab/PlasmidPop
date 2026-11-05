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
import { type Offer, detectionStore, offeredWithHidden, useDetection } from '../state/detection';
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
      data-tip="Look for common parts (origins, resistance genes, promoters, terminators, tags, primer sites, fluorescent proteins) in this sequence"
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
  const everything = offeredWithHidden(state, doc);
  if (everything === null) {
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
  return <OfferList documentId={documentId} doc={doc} offers={everything} />;
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
  // What the rules hid (#289) is counted, and listed on request; it is
  // never ticked until the user ticks it, and never part of "all".
  const hiddenOffers = offers.filter((o) => o.hidden !== null && !o.duplicate);
  const [showHidden, setShowHidden] = useState(false);
  const [tickedHidden, setTickedHidden] = useState<ReadonlySet<Offer['detection']>>(new Set());
  const ordinary = offers.filter((o) => o.hidden === null);
  const fresh = ordinary.filter((o) => !o.duplicate);
  const known = ordinary.length - fresh.length;
  // Unticked rather than ticked, so a hit that turns into a duplicate (the
  // user annotated it meanwhile) simply drops out of the count.
  const [unticked, setUnticked] = useState<ReadonlySet<Offer['detection']>>(new Set());
  const chosenOrdinary = fresh.filter((o) => !unticked.has(o.detection));
  const chosenHidden = showHidden ? hiddenOffers.filter((o) => tickedHidden.has(o.detection)) : [];
  const chosen = [...chosenOrdinary, ...chosenHidden];
  const rows = showHidden
    ? [...fresh, ...hiddenOffers].sort(
        (x, y) => x.detection.hit.range.start - y.detection.hit.range.start,
      )
    : fresh;
  const isTicked = (o: Offer): boolean =>
    o.hidden === null ? !unticked.has(o.detection) : tickedHidden.has(o.detection);
  const toggle = (o: Offer, on: boolean): void => {
    if (o.hidden === null) {
      const next = new Set(unticked);
      if (on) next.delete(o.detection);
      else next.add(o.detection);
      setUnticked(next);
    } else {
      const next = new Set(tickedHidden);
      if (on) next.add(o.detection);
      else next.delete(o.detection);
      setTickedHidden(next);
    }
  };

  const summary =
    ordinary.length === 0
      ? 'No common features found.'
      : fresh.length === 0
        ? `Found ${plural(ordinary.length, 'common feature')}, all of them already annotated.`
        : `Found ${plural(fresh.length, 'common feature')}` +
          (known === 0 ? '.' : `, and ${known} already annotated.`);

  return (
    <section className="detect" aria-label="Detect features">
      <p className="detect__message">{summary}</p>
      {rows.length > 0 && (
        <ul className="detect__list">
          {rows.map((o, i) => {
            const { hit, part } = o.detection;
            const feature = featureFromHit(hit, part);
            const source = hitSource(part);
            return (
              <li key={i} className="detect__item">
                <label className="detect__check">
                  <input
                    type="checkbox"
                    checked={isTicked(o)}
                    aria-label={`Add ${feature.name}`}
                    onChange={(e) => {
                      toggle(o, e.target.checked);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="feature-row"
                  data-tip={
                    hit.family === true
                      ? // Named for the element, not the part it was found
                        // through, so the part's own note is not about it (#284).
                        `${feature.name}: the match does not show what tells ${part.name} apart\nMatched against ${source}`
                      : `${part.note ?? part.name}\nMatched against ${source}`
                  }
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
                    <span className="feature-row__name">{feature.name}</span>
                    {o.hidden !== null && (
                      <span className="feature-row__detail detect__hidden">Hidden: {o.hidden}</span>
                    )}
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
                    {part.source === 'mine' && (
                      <span className="feature-row__detail detect__origin">
                        from {part.origin ?? 'My parts'}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hiddenOffers.length > 0 && (
        <label className="panel__form-check detect__hidden-toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => {
              setShowHidden(e.target.checked);
            }}
          />
          {hiddenOffers.length} hidden. Show them
        </label>
      )}
      <div className="detect__actions">
        {rows.length > 0 && (
          <button
            type="button"
            className="button button--primary button--small"
            disabled={chosen.length === 0}
            onClick={() => {
              detectionStore.accept(
                documentId,
                chosen.map((o) => o.detection),
                chosenHidden.length === 0 && chosenOrdinary.length === fresh.length,
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
              setUnticked(
                chosenOrdinary.length === 0 ? new Set() : new Set(fresh.map((o) => o.detection)),
              );
            }}
          >
            {chosenOrdinary.length === 0 ? 'Tick all' : 'Untick all'}
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

/** Where a hit's part comes from, for its tooltip: the record cited, or the user's own list. */
function hitSource(part: Offer['detection']['part']): string {
  if (part.source === 'mine')
    return `your list "${part.origin ?? 'My parts'}", not the bundled list`;
  return part.source === 'fpbase'
    ? `${part.accession} ${part.location}, via FPbase`
    : `${part.accession} ${part.location}`;
}

function plural(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}
