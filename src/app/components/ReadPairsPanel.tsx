import { useState } from 'react';

import { type ReadPair, describePairRule } from '@/core';

/**
 * The pairs this run uses (#421): the ones the names gave, each with its
 * rule, the ones made by hand, a way to break either, to pair two reads, and
 * to switch pairing off. Nothing here is kept past the run.
 */
export function ReadPairsPanel({
  names,
  pairs,
  enabled,
  edited,
  onEnabled,
  onBreak,
  onMake,
  onReset,
}: {
  /** The reads' names, by index. */
  readonly names: readonly string[];
  /** The pairs in use, with the rule that made each. */
  readonly pairs: readonly ReadPair[];
  readonly enabled: boolean;
  /** Whether anything was changed from the names' pairs. */
  readonly edited: boolean;
  readonly onEnabled: (on: boolean) => void;
  readonly onBreak: (pair: ReadPair) => void;
  readonly onMake: (first: number, second: number) => void;
  readonly onReset: () => void;
}): React.JSX.Element {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const a = first === '' ? null : Number(first);
  const b = second === '' ? null : Number(second);
  const canMake = enabled && a !== null && b !== null && a !== b;
  const nameOf = (i: number): string => names[i] ?? '';
  return (
    <details className="panel__details" open={pairs.length > 0 || edited}>
      <summary>{`Read pairs (${pairs.length})`}</summary>
      <label className="panel__field panel__field--row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            onEnabled(e.target.checked);
          }}
        />
        <span>Use read pairs in this run</span>
      </label>
      {enabled && pairs.length === 0 && <p className="panel__note">No reads are paired.</p>}
      {enabled && pairs.length > 0 && (
        <ul className="panel__list" aria-label="Read pairs">
          {pairs.map((p) => (
            <li key={`${String(p.first)}:${String(p.second)}`}>
              <span>
                {`${nameOf(p.first)} + ${nameOf(p.second)}`}
                <span className="panel__heading-note">{` ${describePairRule(p.rule)}`}</span>
              </span>{' '}
              <button
                type="button"
                className="button button--quiet button--small"
                aria-label={`Break pair ${nameOf(p.first)} + ${nameOf(p.second)}`}
                onClick={() => {
                  onBreak(p);
                }}
              >
                Break
              </button>
            </li>
          ))}
        </ul>
      )}
      {enabled && (
        <div className="panel__controls">
          <label className="panel__field panel__field--row">
            <span>Pair</span>
            <select
              className="panel__input"
              aria-label="First mate"
              value={first}
              onChange={(e) => {
                setFirst(e.target.value);
              }}
            >
              <option value="">first mate (read forward)</option>
              {names.map((n, i) => (
                <option key={i} value={String(i)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="panel__field panel__field--row">
            <span>with</span>
            <select
              className="panel__input"
              aria-label="Second mate"
              value={second}
              onChange={(e) => {
                setSecond(e.target.value);
              }}
            >
              <option value="">second mate (read reverse)</option>
              {names.map((n, i) => (
                <option key={i} value={String(i)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button--small"
            disabled={!canMake}
            onClick={() => {
              if (a === null || b === null) return;
              onMake(a, b);
              setFirst('');
              setSecond('');
            }}
          >
            Pair them
          </button>
        </div>
      )}
      {edited && (
        <button type="button" className="button button--quiet button--small" onClick={onReset}>
          Back to the pairs the names give
        </button>
      )}
    </details>
  );
}
