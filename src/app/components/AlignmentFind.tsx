import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import type { Stack } from '../alignmentStack';
import {
  columnOfPosition,
  findMotif,
  firstMatchFrom,
  MIN_MOTIF,
  positionMessage,
  stepMatch,
} from '../alignmentSearch';

export type SearchMode = 'goto' | 'find';

interface Props {
  readonly stack: Stack;
  readonly mode: SearchMode;
  /** The picked sample, an index into the stack's rows, or null for the reference. */
  readonly row: number | null;
  /** The column the view last went to, where a search starts from. */
  readonly getFrom: () => number;
  readonly onRow: (row: number | null) => void;
  /** Scroll to and mark columns `[start, end)`. */
  readonly onJump: (start: number, end: number) => void;
  readonly onClose: () => void;
}

/**
 * The small popover under the toolbar's Go to and Find buttons (#125). Go to
 * takes a 1-based position along the reference's numbering; Find an IUPAC
 * motif, looked for in the reference or the picked sample, whose matches
 * step like the differences do. Enter goes (or steps on), Shift+Enter steps
 * back, Esc closes the popover and not the window.
 */
export function AlignmentFind({ stack, mode, row, getFrom, onRow, onJump, onClose }: Props) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [mode]);

  const search = useMemo(
    () => (mode === 'find' ? findMotif(stack, row, text) : null),
    [mode, stack, row, text],
  );
  const matches = search?.kind === 'matches' ? search.matches : [];

  // A new query or row lands on the first match from where the view was when
  // the form opened; stepping then goes from the match shown.
  const anchor = useState(() => getFrom())[0];
  const [stepped, setStepped] = useState<{ search: unknown; index: number } | null>(null);
  const first = firstMatchFrom(matches, anchor);
  const index = stepped !== null && stepped.search === search ? stepped.index : first;
  useEffect(() => {
    const m = first === null ? undefined : matches[first];
    if (m !== undefined) onJump(m.start, m.end);
    // Only a new search moves the view; stepping does it through `step`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const step = (backwards: boolean): void => {
    const at = index === null ? getFrom() : (matches[index]?.start ?? getFrom());
    const i = stepMatch(matches, at, backwards);
    const m = i === null ? undefined : matches[i];
    if (m === undefined || i === null) return;
    setStepped({ search, index: i });
    onJump(m.start, m.end);
  };

  const go = (): void => {
    const result = columnOfPosition(stack, Number(text.replace(/[,\s]/g, '')));
    setMessage(positionMessage(result));
    if (result.kind === 'column') onJump(result.column, result.column + 1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'goto') go();
      else step(e.shiftKey);
    }
  };

  let status = '';
  if (search !== null) {
    if (search.kind === 'invalid') status = 'Use IUPAC letters: A C G T U R Y S W K M B D H V N.';
    else if (search.kind === 'short') status = `At least ${MIN_MOTIF} bases.`;
    else if (search.kind === 'matches')
      status =
        matches.length === 0
          ? 'No match'
          : `${((index ?? 0) + 1).toLocaleString()} of ${matches.length.toLocaleString()}`;
  }
  const match = index === null ? undefined : matches[index];
  const strand = match === undefined ? '' : match.strand === 'reverse' ? ' · reverse strand' : '';

  return (
    <div
      className="astack-find"
      role="group"
      aria-label={mode === 'goto' ? 'Go to a position' : 'Find a motif'}
    >
      {mode === 'goto' ? (
        <>
          <label className="astack-find__label">
            Position
            <input
              ref={input}
              className="input astack-find__input"
              inputMode="numeric"
              value={text}
              placeholder="1-based"
              onChange={(e) => {
                setText(e.target.value);
                setMessage('');
              }}
              onKeyDown={onKeyDown}
            />
          </label>
          <button type="button" className="button button--small" onClick={go}>
            Go
          </button>
        </>
      ) : (
        <>
          <label className="astack-find__label">
            Motif
            <input
              ref={input}
              className="input astack-find__input"
              value={text}
              placeholder="GAATTC, RGATCY"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setText(e.target.value);
              }}
              onKeyDown={onKeyDown}
            />
          </label>
          <label className="astack-find__label">
            In
            <select
              className="input astack-find__select"
              value={row === null ? 'ref' : String(row)}
              onChange={(e) => {
                onRow(e.target.value === 'ref' ? null : Number(e.target.value));
              }}
            >
              <option value="ref">Reference</option>
              {stack.rows.map((r, i) => (
                <option key={i} value={i}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button--small"
            disabled={matches.length === 0}
            aria-label="Previous match"
            onClick={() => {
              step(true);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={matches.length === 0}
            aria-label="Next match"
            onClick={() => {
              step(false);
            }}
          >
            ›
          </button>
        </>
      )}
      <span className="astack-tools__note" aria-live="polite">
        {mode === 'goto' ? message : `${status}${strand}`}
      </span>
      <button
        type="button"
        className="button button--quiet button--small"
        aria-label="Close search"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
