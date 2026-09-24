import { useMemo, useState } from 'react';

import { type GatewayReaction, type SeqDocument, attSites, gateway } from '@/core';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { AssemblyWarnings } from './AssemblyWarnings';
import { ProductSummary } from './ProductSummary';

const REACTIONS: readonly { value: GatewayReaction; label: string; title: string }[] = [
  {
    value: 'BP',
    label: 'BP',
    title: 'attB × attP: an attB substrate into a donor vector, giving an entry clone',
  },
  {
    value: 'LR',
    label: 'LR',
    title: 'attL × attR: an entry clone into a destination vector, giving an expression clone',
  },
];

/** What each side of each reaction is called, so the pickers say what to put there. */
const ROLES: Readonly<Record<GatewayReaction, readonly [string, string]>> = {
  BP: ['attB substrate', 'donor vector'],
  LR: ['entry clone', 'destination vector'],
};

/** A document with the att sites it annotates, for the picker's second line. */
function describe(doc: SeqDocument): string {
  const sites = attSites(doc);
  return sites.length === 0
    ? 'no att sites'
    : sites.map((s) => `att${s.kind}${s.number}`).join(', ');
}

/** The two circles and what to say about them, once a reaction has run. */
function renderProduct(
  product: SeqDocument | null,
  byproduct: SeqDocument | null,
  reaction: GatewayReaction,
  warnings: readonly string[],
  open: (doc: SeqDocument) => void,
): React.ReactElement | null {
  if (product === null) return null;
  return (
    <>
      <p className="panel__note">{reaction === 'BP' ? 'Entry' : 'Expression'} clone:</p>
      <ProductSummary product={product} />
      <AssemblyWarnings texts={warnings} />
      <div className="panel__controls">
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => {
              open(product);
            }}
          >
            Open clone
          </button>
          {byproduct !== null && (
            <button
              type="button"
              className="button button--quiet button--small"
              title="The other circle the reaction makes, which carries the ccdB cassette"
              onClick={() => {
                open(byproduct);
              }}
            >
              Open byproduct
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Gateway cloning (#62). Both molecules come from open tabs, since a
 * recombination needs two whole plasmids and neither is "the document in
 * front of you" more than the other.
 */
export function GatewayPanel() {
  const { documents } = useEditorState();
  const [reaction, setReaction] = useState<GatewayReaction>('LR');
  const [insertId, setInsertId] = useState('');
  const [vectorId, setVectorId] = useState('');

  const docs = useMemo(
    () => documents.map((d) => ({ id: d.documentId, doc: d.history.present })),
    [documents],
  );
  const insert = docs.find((d) => d.id === insertId)?.doc;
  const vector = docs.find((d) => d.id === vectorId)?.doc;

  const result = useMemo(
    () =>
      insert === undefined || vector === undefined || insert === vector
        ? null
        : gateway(insert, vector, reaction),
    [insert, vector, reaction],
  );

  const open = (doc: SeqDocument): void => {
    analytics.track('cloning', 'gateway', reaction);
    editorStore.openDocument(doc);
    editorStore.setSidebarTab('features');
  };

  if (docs.length < 2) {
    return (
      <p className="panel__note">
        Open both molecules: the {ROLES[reaction][0]} and the {ROLES[reaction][1]}, each in its own
        tab. Their att sites are read from the annotation the files carry.
      </p>
    );
  }

  const picker = (label: string, value: string, set: (id: string) => void): React.ReactElement => (
    <label className="panel__field panel__field--row">
      <span>{label}</span>
      <select
        className="panel__select"
        aria-label={label}
        value={value}
        onChange={(e) => {
          set(e.target.value);
        }}
      >
        <option value="">choose a tab</option>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.doc.name} — {describe(d.doc)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="panel__controls">
        <div className="segmented" role="group" aria-label="Reaction type">
          {REACTIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`segmented__button${reaction === r.value ? ' segmented__button--active' : ''}`}
              aria-pressed={reaction === r.value}
              title={r.title}
              onClick={() => {
                setReaction(r.value);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel__controls">
        {picker(ROLES[reaction][0], insertId, setInsertId)}
        {picker(ROLES[reaction][1], vectorId, setVectorId)}
      </div>

      {result === null ? (
        <p className="panel__note">
          Choose the {ROLES[reaction][0]} and the {ROLES[reaction][1]}. A {reaction} needs two att
          {reaction === 'BP' ? 'B' : 'L'} sites on the first and two att
          {reaction === 'BP' ? 'P' : 'R'} sites on the second.
        </p>
      ) : result.problem !== null ? (
        <p className="panel__error">{result.problem}</p>
      ) : (
        renderProduct(result.product, result.byproduct, reaction, result.warnings, open)
      )}
    </>
  );
}
