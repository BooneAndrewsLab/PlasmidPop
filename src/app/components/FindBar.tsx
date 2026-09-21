import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  type Range,
  type SeqDocument,
  type Strand,
  findSequenceMatches,
  looksLikeSequence,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import { editorStore } from '../state/editorStore';

interface Props {
  readonly doc: SeqDocument;
}

interface Hit {
  readonly range: Range;
  readonly label: string;
  /** Which strand a sequence match is on; a feature-name match is on neither. */
  readonly strand: Strand | 'none';
}

/**
 * Past this many matches the views are shown none of them: the count in the
 * bar is the useful answer to "how common is this", and several hundred
 * dashed boxes are not.
 */
const MAX_PREVIEWED_HITS = 200;

function featureExtent(
  f: SeqDocument['features'] extends Iterable<infer F> ? F : never,
): Range | null {
  const ranges = f.segments.filter((s) => s.kind === 'range');
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (first?.kind !== 'range' || last?.kind !== 'range') return null;
  return { start: first.start, end: Math.max(first.end, last.end) };
}

/**
 * Find bar (Ctrl+F). A query made of IUPAC letters searches the sequence on
 * both strands; anything else searches feature names and types.
 */
export function FindBar({ doc }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = query.trim();
  const sequenceMode = trimmed.length >= 3 && looksLikeSequence(trimmed);
  const hits = useMemo<Hit[]>(() => {
    if (trimmed === '') return [];
    if (sequenceMode) {
      return findSequenceMatches(doc.sequence.toString(), doc.topology, trimmed).map((m) => ({
        range: m.range,
        label: m.strand === 'forward' ? 'forward strand' : 'reverse strand',
        strand: m.strand,
      }));
    }
    const needle = trimmed.toLowerCase();
    const out: Hit[] = [];
    for (const f of doc.features) {
      if (!f.name.toLowerCase().includes(needle) && !f.type.toLowerCase().includes(needle))
        continue;
      const extent = featureExtent(f);
      if (extent !== null)
        out.push({ range: extent, label: f.name === '' ? f.type : f.name, strand: 'none' });
    }
    return out;
  }, [doc, trimmed, sequenceMode]);

  const current =
    hits.length === 0 ? null : (hits[((index % hits.length) + hits.length) % hits.length] ?? null);

  useEffect(() => {
    if (current === null) return;
    editorStore.setSelection(current.range);
    editorStore.revealPosition(current.range.start);
  }, [current]);

  // Every match at once in both views, so a search says where a site is
  // *distributed* and not only where the next one is. The current match is
  // the selection on top of it.
  const previewed = useMemo<OverlaySpan[]>(
    () =>
      hits.length > MAX_PREVIEWED_HITS
        ? []
        : hits.map((h, i) => ({
            id: `hit-${i}`,
            label: '',
            range: h.range,
            strand: h.strand,
            shape: 'arrow' as const,
          })),
    [hits],
  );

  useEffect(() => {
    editorStore.setPreview('find', previewed);
  }, [previewed]);
  // Closing the bar takes the matches off the views.
  useEffect(
    () => () => {
      editorStore.clearPreview('find');
    },
    [],
  );

  const step = (delta: number): void => {
    if (hits.length === 0) return;
    setIndex((i) => (((i + delta) % hits.length) + hits.length) % hits.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editorStore.setFindOpen(false);
    }
  };

  const shown = hits.length === 0 ? 0 : (((index % hits.length) + hits.length) % hits.length) + 1;

  return (
    <div className="findbar" role="search">
      <input
        ref={inputRef}
        className="findbar__input"
        type="search"
        spellCheck={false}
        placeholder="Find bases (IUPAC) or a feature name"
        aria-label="Find"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="findbar__count" aria-live="polite">
        {trimmed === ''
          ? ''
          : hits.length === 0
            ? 'No matches'
            : `${shown} of ${hits.length}${current === null ? '' : `, ${current.label}`}`}
      </span>
      <button
        type="button"
        className="button button--small"
        disabled={hits.length === 0}
        aria-label="Previous match"
        onClick={() => {
          step(-1);
        }}
      >
        ↑
      </button>
      <button
        type="button"
        className="button button--small"
        disabled={hits.length === 0}
        aria-label="Next match"
        onClick={() => {
          step(1);
        }}
      >
        ↓
      </button>
      <button
        type="button"
        className="button button--quiet button--small"
        aria-label="Close find"
        onClick={() => {
          editorStore.setFindOpen(false);
        }}
      >
        Close
      </button>
    </div>
  );
}
