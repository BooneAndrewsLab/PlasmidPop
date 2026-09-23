import { type KeyboardEvent, useState } from 'react';

import {
  DEFAULT_PRIMER_CRITERIA,
  type PrimerCriteria,
  normalizePrimerCriteria,
  samePrimerCriteria,
} from '@/core';

import { editorStore } from '../state/editorStore';

type NumericKey = {
  [K in keyof PrimerCriteria]: PrimerCriteria[K] extends number ? K : never;
}[keyof PrimerCriteria];

/** Pairs of fields that are the two ends of one range. */
const RANGES: readonly (readonly [NumericKey, NumericKey])[] = [
  ['minLength', 'maxLength'],
  ['minTm', 'maxTm'],
  ['minGc', 'maxGc'],
  ['minProduct', 'maxProduct'],
];

/**
 * Applies one field and keeps its range the right way round by moving the
 * other end, rather than swapping them: raising the minimum past the maximum
 * means "at least this", and the maximum should follow it up.
 */
function withField(c: PrimerCriteria, key: NumericKey, value: number): PrimerCriteria {
  const next: Record<string, unknown> = { ...c, [key]: value };
  for (const [lo, hi] of RANGES) {
    if (key === lo && value > c[hi]) next[hi] = value;
    if (key === hi && value < c[lo]) next[lo] = value;
  }
  return normalizePrimerCriteria(next);
}

function withRegion(
  c: PrimerCriteria,
  which: 'forwardRegion' | 'reverseRegion',
  end: 'near' | 'far',
  value: number,
): PrimerCriteria {
  const r = { ...c[which], [end]: value };
  if (end === 'near' && r.near > r.far) r.far = r.near;
  if (end === 'far' && r.far < r.near) r.near = r.far;
  return normalizePrimerCriteria({ ...c, [which]: r });
}

interface NumberProps {
  readonly value: number;
  readonly label: string;
  readonly step?: number;
  /** Room for five digits, which a product length runs to. */
  readonly wide?: boolean;
  readonly onCommit: (value: number) => void;
}

/**
 * A number box that commits when it is left or Enter is pressed, not per
 * keystroke: typing "20" into a length would otherwise pass through "2",
 * which the criteria hold up to the shortest primer allowed before the
 * second digit arrives.
 */
function NumberBox({ value, label, step = 1, wide = false, onCommit }: NumberProps) {
  // Null while nothing is being typed, so the box shows the stored value
  // and follows it when it changes elsewhere (Reset, a clamped range).
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <input
      className={`panel__number panel__number--short${wide ? ' panel__number--wide' : ''}`}
      type="number"
      inputMode="decimal"
      step={step}
      aria-label={label}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

function pct(x: number): number {
  return Math.round(x * 1000) / 10;
}

interface Props {
  readonly criteria: PrimerCriteria;
}

/**
 * The Primers tab's settings: what a designed primer must be and where it is
 * looked for. They are shared with **Check a primer**, which warns about
 * exactly what the designer would have refused.
 */
export function PrimerSettings({ criteria: c }: Props) {
  const set = (next: PrimerCriteria): void => {
    editorStore.setPrimerCriteria(next);
  };
  const field = (key: NumericKey, label: string, step = 1, wide = false) => (
    <NumberBox
      value={c[key]}
      label={label}
      step={step}
      wide={wide}
      onCommit={(v) => {
        set(withField(c, key, v));
      }}
    />
  );
  const gcField = (key: 'minGc' | 'maxGc', label: string) => (
    <NumberBox
      value={pct(c[key])}
      label={label}
      onCommit={(v) => {
        set(withField(c, key, v / 100));
      }}
    />
  );
  const regionField = (
    which: 'forwardRegion' | 'reverseRegion',
    end: 'near' | 'far',
    label: string,
  ) => (
    <NumberBox
      value={c[which][end]}
      label={label}
      onCommit={(v) => {
        set(withRegion(c, which, end, v));
      }}
    />
  );
  const isDefault = samePrimerCriteria(c, DEFAULT_PRIMER_CRITERIA);

  return (
    <details className="primer-settings">
      <summary>
        Settings{' '}
        <span className="primer-settings__summary">{isDefault ? 'defaults' : 'changed'}</span>
      </summary>
      <div className="panel__form">
        <span className="panel__form-label">Length</span>
        <span className="panel__form-range">
          {field('minLength', 'Shortest primer')}–{field('maxLength', 'Longest primer')} nt
        </span>
        <span className="panel__form-label">Tm</span>
        <span className="panel__form-range">
          {field('minTm', 'Lowest Tm', 0.5)}–{field('maxTm', 'Highest Tm', 0.5)} °C
        </span>
        <span className="panel__form-label">GC</span>
        <span className="panel__form-range">
          {gcField('minGc', 'Lowest GC content, percent')}–
          {gcField('maxGc', 'Highest GC content, percent')} %
        </span>
        <span className="panel__form-label">ΔTm</span>
        <span className="panel__form-range">
          ≤ {field('maxTmDifference', 'Largest Tm difference in a pair', 0.5)} °C
        </span>

        <span className="panel__form-label">Product</span>
        <span className="panel__form-range">
          {field('minProduct', 'Shortest product', 1, true)}–
          {field('maxProduct', 'Longest product', 1, true)} bp
        </span>

        <span className="panel__form-heading">Where to look</span>
        <span className="panel__form-label">Forward</span>
        <span className="panel__form-range">
          {regionField('forwardRegion', 'near', 'Forward primer, nearest to the start')}–
          {regionField('forwardRegion', 'far', 'Forward primer, farthest from the start')} bp before
          start
        </span>
        <span className="panel__form-label">Reverse</span>
        <span className="panel__form-range">
          {regionField('reverseRegion', 'near', 'Reverse primer, nearest to the end')}–
          {regionField('reverseRegion', 'far', 'Reverse primer, farthest from the end')} bp after
          end
        </span>
        <span className="panel__form-hint">
          The whole primer lies in this stretch. A negative number reaches into the selection, so{' '}
          <code>-30</code>–<code>0</code> puts a primer on the selection&apos;s own first bases, as
          when amplifying an ORF from its start codon.
        </span>

        <span className="panel__form-heading">Filters</span>
        <span className="panel__form-label">Base run</span>
        <span className="panel__form-range">
          ≤ {field('maxHomopolymer', 'Longest run of one base')} of one base
        </span>
        <span className="panel__form-label">Hairpin</span>
        <span className="panel__form-range">
          stem ≤ {field('maxHairpin', 'Longest hairpin stem')} bp
        </span>
        <span className="panel__form-label">Self-dimer</span>
        <span className="panel__form-range">
          ≤ {field('maxSelfComplementarity', 'Longest self-complementary stretch')} bp anywhere
        </span>
        <span className="panel__form-label">3′ dimer</span>
        <span className="panel__form-range">
          ≤ {field('maxThreePrime', 'Longest 3′-end complementarity')} bp, self or pair
        </span>
        <span className="panel__form-label">GC clamp</span>
        <span className="panel__form-range">
          <label className="panel__form-check">
            <input
              type="checkbox"
              checked={c.requireGcClamp}
              onChange={(e) => {
                set({ ...c, requireGcClamp: e.target.checked });
              }}
            />
            required
          </label>
        </span>
        <span className="panel__form-label">Elsewhere</span>
        <span className="panel__form-range">
          <label className="panel__form-check">
            <input
              type="checkbox"
              checked={c.requireSpecific}
              onChange={(e) => {
                set({ ...c, requireSpecific: e.target.checked });
              }}
            />
            refuse a primer that also binds elsewhere
          </label>
        </span>
      </div>
      <button
        type="button"
        className="button button--quiet button--small"
        disabled={isDefault}
        onClick={() => {
          set(DEFAULT_PRIMER_CRITERIA);
        }}
      >
        Reset to defaults
      </button>
    </details>
  );
}
