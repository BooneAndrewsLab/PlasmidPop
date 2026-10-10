import { useMemo, useState } from 'react';

import {
  type CrisprGuide,
  type NickStrand,
  type SeqDocument,
  MAX_PAIR_OFFSET,
  formatSpan,
  pairNickases,
} from '@/core';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';

interface Props {
  readonly doc: SeqDocument;
  readonly guides: readonly CrisprGuide[];
}

/** How many pairs are listed; the closest nicks come first. */
const MAX_LISTED = 20;

/**
 * Paired nickases (item 82): guides on opposite strands whose nicks make a
 * staggered double-strand break, with the offset and overhang of each pair.
 */
export function PairedNickases({ doc, guides }: Props) {
  const [nickStrand, setNickStrand] = useState<NickStrand>('target');
  const [maxText, setMaxText] = useState(String(MAX_PAIR_OFFSET));
  const maxOffset = Number.parseInt(maxText, 10);
  const pairs = useMemo(
    () =>
      pairNickases(guides, doc.length, doc.topology, {
        nickStrand,
        maxOffset: Number.isNaN(maxOffset) ? MAX_PAIR_OFFSET : Math.max(0, maxOffset),
      }),
    [guides, doc.length, doc.topology, nickStrand, maxOffset],
  );

  return (
    <fieldset className="panel__group">
      <legend>Paired nickases</legend>
      <div className="panel__controls">
        <label className="panel__field">
          <span>Nickase</span>
          <select
            value={nickStrand}
            onChange={(e) => {
              analytics.track('crispr', 'nickPairs');
              setNickStrand(e.target.value === 'pam' ? 'pam' : 'target');
            }}
          >
            <option value="target">D10A (nicks the strand the guide pairs with)</option>
            <option value="pam">H840A (nicks the PAM strand)</option>
          </select>
        </label>
        <label className="panel__field panel__field--row">
          <span>Nicks at most (bp) apart</span>
          <input
            className="panel__number"
            type="number"
            min={0}
            value={maxText}
            onChange={(e) => {
              setMaxText(e.target.value);
            }}
          />
        </label>
      </div>
      {pairs.length === 0 && (
        <p className="panel__note">No pair of the guides above nicks within that distance.</p>
      )}
      <ul className="crispr-pairs">
        {pairs.slice(0, MAX_LISTED).map((p) => {
          const id = `${String(p.forwardNick.range.start)}:${String(p.reverseNick.range.start)}`;
          const label =
            p.overhang === 'blunt'
              ? 'blunt'
              : `${String(p.overhangLength)} nt ${p.overhang === '5prime' ? '5′' : '3′'} overhang`;
          return (
            <li key={id} className="crispr-pair">
              <span>
                {formatSpan(p.forwardNick.range, doc.length)} +{' '}
                {formatSpan(p.reverseNick.range, doc.length)}: {label}
              </span>{' '}
              <button
                type="button"
                className="button button--quiet button--small"
                onClick={() => {
                  const start = Math.min(p.forwardNick.range.start, p.reverseNick.range.start);
                  const end = Math.max(p.forwardNick.range.end, p.reverseNick.range.end);
                  editorStore.setSelection({ start, end });
                  editorStore.revealPosition(start);
                }}
              >
                Show
              </button>
            </li>
          );
        })}
      </ul>
      {pairs.length > MAX_LISTED && (
        <p className="panel__note">
          Showing the closest {MAX_LISTED} of {pairs.length.toLocaleString()}.
        </p>
      )}
    </fieldset>
  );
}
