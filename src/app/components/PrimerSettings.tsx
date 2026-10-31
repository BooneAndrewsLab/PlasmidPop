import { type KeyboardEvent, useState } from 'react';

import {
  DEFAULT_PRIMER_CRITERIA,
  type PrimerCriteria,
  describePrimerCriteria,
  normalizePrimerCriteria,
  samePrimerCriteria,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';

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
  readonly disabled?: boolean;
  readonly onCommit: (value: number) => void;
}

/**
 * A number box that commits when it is left or Enter is pressed, not per
 * keystroke: typing "20" into a length would otherwise pass through "2",
 * which the criteria hold up to the shortest primer allowed before the
 * second digit arrives.
 */
function NumberBox({
  value,
  label,
  step = 1,
  wide = false,
  disabled = false,
  onCommit,
}: NumberProps) {
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
      disabled={disabled}
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

/** The cloning mode's two settings of its own (#303), shown above the shared ones. */
export interface CloningSettingsProps {
  readonly padding: number;
  readonly avoidJunctionSites: boolean;
  readonly onChange: (next: { padding: number; avoidJunctionSites: boolean }) => void;
}

interface Props {
  readonly criteria: PrimerCriteria;
  /** In the Design page's cloning mode: padding and the junction rule, cloning-only. */
  readonly cloning?: CloningSettingsProps;
}

/**
 * The Primers tab's settings: what a designed primer must be and where it is
 * looked for. They are shared with **Check a primer**, which warns about
 * exactly what the designer would have refused.
 */
export function PrimerSettings({ criteria: c, cloning }: Props) {
  const set = (next: PrimerCriteria): void => {
    editorStore.setPrimerCriteria(next);
  };
  // Cloning pins the primers to the insert's two ends: no windows to look in,
  // and the product is the insert plus its tails, so neither is a choice.
  const off = cloning !== undefined;
  const dim = off ? ' panel__form-dim' : '';
  const field = (key: NumericKey, label: string, step = 1, wide = false, disabled = false) => (
    <NumberBox
      value={c[key]}
      label={label}
      step={step}
      wide={wide}
      disabled={disabled}
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
      disabled={off}
      onCommit={(v) => {
        set(withRegion(c, which, end, v));
      }}
    />
  );
  const cloningDefault =
    cloning === undefined || (cloning.padding === 6 && cloning.avoidJunctionSites);
  const isDefault = samePrimerCriteria(c, DEFAULT_PRIMER_CRITERIA) && cloningDefault;
  const { documentId } = useEditorState();
  // Whether it was left open, kept with the workspace's other state (item 107).
  const [open, setOpen] = useRemembered('primers.settingsOpen', documentId, false);

  return (
    <details
      className="panel__details primer-settings"
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDetailsElement>) => {
        // Escape folds an open disclosure before anything outer (the
        // workspace) takes it as its own cue to shut (item 107, point 1).
        if (e.key !== 'Escape' || !e.currentTarget.open) return;
        e.preventDefault();
        // The element as well as the state: a click toggles the element
        // itself and tells React afterwards (`toggle`), so the two can
        // differ for a moment, and this must shut it whichever one has it open.
        e.currentTarget.open = false;
        setOpen(false);
        e.currentTarget.querySelector<HTMLElement>('summary')?.focus();
      }}
    >
      {/* The summary says whether the rules are still the defaults, and
          what they come to only once they are not (item 107): the defaults
          are a click away and need no line of their own. */}
      <summary className="panel__details-summary">
        <span className="panel__details-title">
          Settings
          {!isDefault && <span className="panel__details-flag">changed</span>}
        </span>
        {!isDefault && (
          <span className="panel__details-note">
            {cloning !== undefined && !cloningDefault
              ? `padding ${cloning.padding.toString()} nt${cloning.avoidJunctionSites ? '' : ', junction sites allowed'}; `
              : ''}
            {describePrimerCriteria(c)}
          </span>
        )}
      </summary>
      <div className="panel__form panel__details-body">
        {cloning !== undefined && (
          <>
            <span className="panel__form-heading">Cloning ends</span>
            <span className="panel__form-label">Padding</span>
            <span className="panel__form-range">
              <NumberBox
                value={cloning.padding}
                label="Padding bases 5′ of each site"
                onCommit={(v) => {
                  cloning.onChange({
                    padding: Math.max(0, Math.min(20, Math.round(v))),
                    avoidJunctionSites: cloning.avoidJunctionSites,
                  });
                }}
              />{' '}
              nt 5′ of each site, raised for an enzyme that cuts poorly near an end
            </span>
            <span className="panel__form-label">Junction</span>
            <span className="panel__form-range">
              <label className="panel__form-check">
                <input
                  type="checkbox"
                  checked={cloning.avoidJunctionSites}
                  onChange={(e) => {
                    cloning.onChange({
                      padding: cloning.padding,
                      avoidJunctionSites: e.target.checked,
                    });
                  }}
                />
                pick padding that makes no new site where padding, site and insert meet
              </label>
            </span>
            <span className="panel__form-hint">
              Padding and the junction rule are cloning-only; the rest below is shared with the
              plain mode and judges the annealing part of each primer.
            </span>
          </>
        )}
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

        <span className={`panel__form-label${dim}`}>Product</span>
        <span className={`panel__form-range${dim}`}>
          {field('minProduct', 'Shortest product', 1, true, off)}–
          {field('maxProduct', 'Longest product', 1, true, off)} bp
        </span>

        <span className={`panel__form-heading${dim}`}>Where to look</span>
        <span className={`panel__form-label${dim}`}>Forward</span>
        <span className={`panel__form-range${dim}`}>
          {regionField('forwardRegion', 'near', 'Forward primer, nearest to the start')}–
          {regionField('forwardRegion', 'far', 'Forward primer, farthest from the start')} bp before
          start
        </span>
        <span className={`panel__form-label${dim}`}>Reverse</span>
        <span className={`panel__form-range${dim}`}>
          {regionField('reverseRegion', 'near', 'Reverse primer, nearest to the end')}–
          {regionField('reverseRegion', 'far', 'Reverse primer, farthest from the end')} bp after
          end
        </span>
        {off && (
          <span className="panel__form-hint">
            Product and Where to look do not apply when cloning: the primers sit at the two ends of
            the insert, and the product is the insert plus the enzyme-site tails.
          </span>
        )}
        <span className={`panel__form-hint${dim}`}>
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
          ΔG &gt; {field('hairpinDg', 'Weakest hairpin free energy refused, kcal/mol', 0.5)}{' '}
          kcal/mol
        </span>
        <span className="panel__form-label">Hairpin Tm</span>
        <span className="panel__form-range">
          ≤ {field('hairpinTm', 'Highest hairpin melting temperature allowed, °C')} °C (Primer3
          refuses above 47)
        </span>
        <span className="panel__form-label">Dimer</span>
        <span className="panel__form-range">
          ΔG &gt; {field('dimerDg', 'Weakest dimer free energy refused, kcal/mol', 0.5)} kcal/mol,
          self or pair
        </span>
        <span className="panel__form-label">3′ dimer</span>
        <span className="panel__form-range">
          ≤ {field('maxThreePrime', 'Longest 3′-end complementarity')} bp, or ΔG &gt;{' '}
          {field('threePrimeDg', 'Weakest 3′ duplex free energy refused, kcal/mol', 0.5)} kcal/mol,
          self or pair
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
          cloning?.onChange({ padding: 6, avoidJunctionSites: true });
        }}
      >
        Reset to defaults
      </button>
    </details>
  );
}
