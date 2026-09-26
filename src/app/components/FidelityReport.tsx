import { useRef, useState } from 'react';

import { type FidelityTable, formatFidelity, setFidelity } from '@/core';

import { type FidelityImportSummary, persistence } from '../state/persistence';

/** Mis-joins under this share of a junction's ligations are not worth naming. */
const WORTH_NAMING = 0.001;
/** How many of them to name. */
const NAMED = 3;

/**
 * Importing a ligation-fidelity table (#68). The published tables are not
 * ours to redistribute — the paper's supporting information is the
 * publisher's, and the makers' own tool says all rights reserved — so the
 * app ships the arithmetic and reads a copy the user has got for
 * themselves, as it does for REBASE enzymes (item 7). It is kept in this
 * browser and never uploaded.
 */
function FidelityImport({ onClose }: { readonly onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<FidelityImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined): void => {
    if (file === undefined) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    persistence
      .importFidelityFile(file)
      .then((s) => {
        setSummary(s);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="panel__section enzyme-import">
      <h3 className="panel__heading">Import a fidelity table</h3>
      <p className="panel__note">
        A ligase end-joining table says how often each pair of overhangs is joined, measured rather
        than assumed. PlasmidPop does not ship one: the published tables are not ours to pass on.
        Get the one for your ligase and conditions — the supporting information of a ligase-fidelity
        paper, or your ligase supplier&rsquo;s own tool — and open it here.
      </p>
      <p className="panel__note panel__note--quiet">
        It should be a square matrix: a first row of overhangs, then one row per overhang, each cell
        a count. It is read in your browser and never uploaded.
      </p>
      <div
        className={`enzyme-import__drop${dragging ? ' enzyme-import__drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files[0]);
        }}
      >
        <input
          ref={input}
          type="file"
          className="visually-hidden"
          accept="text/csv,text/plain,.csv,.tsv,.txt"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="button button--small"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Reading…' : 'Choose file…'}
        </button>
        <span className="enzyme-import__hint">or drop the table here</span>
      </div>
      {error !== null && <p className="panel__note panel__note--error">{error}</p>}
      {summary !== null && (
        <p className="panel__note">
          {summary.label}: {summary.overhangs.toLocaleString()} overhangs of{' '}
          {summary.overhangLength} bases, {summary.events.toLocaleString()} ligations counted.
        </p>
      )}
      <div className="panel__buttons">
        <button type="button" className="button button--small" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * What a measured table says about an assembly's junction overhangs (#68):
 * the share of assemblies that come out right, and the pairs that cost the
 * most. Without a table it offers to import one, and the design-rule
 * warnings above it stand on their own.
 *
 * The rules and the measurement answer different questions, so both are
 * shown: a palindromic overhang, for instance, joins a copy of itself as
 * readily as its partner, and no end-joining table can tell those two
 * apart — they are the same pairing.
 */
export function FidelityReport({
  overhangs,
  table,
}: {
  readonly overhangs: readonly string[];
  readonly table: FidelityTable | null;
}) {
  const [importing, setImporting] = useState(false);

  if (importing) {
    return (
      <FidelityImport
        onClose={() => {
          setImporting(false);
        }}
      />
    );
  }

  if (table === null) {
    return (
      <p className="panel__note panel__note--quiet">
        <button
          type="button"
          className="link"
          onClick={() => {
            setImporting(true);
          }}
        >
          Import a ligase fidelity table
        </button>{' '}
        to score these overhangs by measured end-joining rather than by the design rules alone.
      </p>
    );
  }

  const scored = setFidelity(overhangs, table);
  const named = scored.worst.filter((w) => w.rate >= WORTH_NAMING).slice(0, NAMED);
  return (
    <div className="fidelity">
      <p className="panel__note">
        <strong>Fidelity {formatFidelity(scored.fidelity)}</strong>{' '}
        <span className="panel__heading-note">
          by {table.label}, over {scored.junctions.length}{' '}
          {scored.junctions.length === 1 ? 'junction' : 'junctions'}
        </span>
      </p>
      {named.length > 0 && (
        <ul className="fidelity__worst" aria-label="Worst overhang pairs">
          {named.map((w) => (
            <li key={`${w.a}-${w.b}`}>
              <code>{w.a}</code> + <code>{w.b}</code>{' '}
              <span className="panel__heading-note">
                {w.a === w.b
                  ? `joins a copy of itself in ${formatFidelity(w.rate)} of its ligations`
                  : `mis-joins in ${formatFidelity(w.rate)} of its ligations`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {named.length === 0 && (
        <p className="panel__note panel__note--quiet">
          No pair mis-joins in as much as {formatFidelity(WORTH_NAMING)} of its ligations.
        </p>
      )}
      {scored.unknown.length > 0 && (
        <p className="panel__note panel__note--quiet">
          Not scored: {scored.unknown.join(', ')} — the table covers overhangs of{' '}
          {table.overhangLength} bases.
        </p>
      )}
      <p className="panel__note panel__note--quiet">
        Measured end-joining, not a prediction of your reaction: it is the table&rsquo;s ligase,
        temperature and time.{' '}
        <button
          type="button"
          className="link"
          onClick={() => {
            setImporting(true);
          }}
        >
          Import another
        </button>{' '}
        or{' '}
        <button
          type="button"
          className="link"
          onClick={() => {
            void persistence.forgetFidelityTable();
          }}
        >
          forget this one
        </button>
        .
      </p>
    </div>
  );
}
