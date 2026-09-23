import { useRef, useState } from 'react';

import { type RebaseImportSummary, persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';

/**
 * The file to send people to. `withrefm` is the monthly format that carries
 * the two things the bundled table lacks — commercial suppliers and the
 * methylation site — along with isoschizomers.
 */
const REBASE_URL = 'https://rebase.neb.com/rebase/link_withrefm';

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** What was left out of an import, as a sentence, or null when nothing was. */
function describeSkipped(s: RebaseImportSummary['skipped']): string | null {
  const parts: string[] = [];
  if (s.cutUnknown > 0) parts.push(`${s.cutUnknown.toLocaleString()} with no known cut position`);
  if (s.tooUnspecific > 0) {
    parts.push(
      `${s.tooUnspecific} that cut at modified bases rather than a sequence (AbaSI, MspJI and kin)`,
    );
  }
  if (s.noSite > 0) parts.push(`${s.noSite.toLocaleString()} with no usable recognition sequence`);
  if (parts.length === 0) return null;
  return `Left out: ${parts.join(', ')}.`;
}

/**
 * Importing an enzyme table from the user's own REBASE download.
 *
 * REBASE is free to use but its files say "all rights reserved", and
 * `rebase.neb.com` sends no CORS header, so the app can neither ship the
 * data nor fetch it. What it can do is make the round trip short: a link
 * straight to the file, then a file picker. See docs/design/07-rebase-enzymes.md.
 */
export function EnzymeImport({ onClose }: { readonly onClose: () => void }) {
  const { enzymeSetInfo } = useEditorState();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<RebaseImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined): void => {
    if (file === undefined) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    persistence
      .importEnzymeFile(file)
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
      <h3 className="panel__heading">Import an enzyme table</h3>
      <ol className="enzyme-import__steps">
        <li>
          <a className="link" href={REBASE_URL} target="_blank" rel="noreferrer noopener">
            Download withrefm from REBASE
          </a>{' '}
          — it opens as plain text, so save the page (Ctrl+S), or right-click the link and choose
          Save link as. About 4 MB.
        </li>
        <li>Open it below. It is read here in your browser and never uploaded.</li>
      </ol>
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
          /*
           * A hint, not a gate: browsers keep an "All files" entry in the
           * picker's filter list, which is the way out when the download
           * arrived without an extension (saving the page gives
           * link_withrefm.txt, but "Save link as" need not).
           */
          accept="text/plain,.txt,.dat"
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
        <span className="enzyme-import__hint">or drop link_withrefm.txt here</span>
      </div>
      {error !== null && <p className="panel__note panel__note--error">{error}</p>}
      {summary !== null && (
        <p className="panel__note">
          Imported {plural(summary.count, 'enzyme')} from {summary.label}
          {summary.released === null ? '' : ` (${summary.released})`}.{' '}
          {describeSkipped(summary.skipped)}
        </p>
      )}
      {!enzymeSetInfo.bundled && (
        <p className="panel__note">
          <button
            type="button"
            className="link"
            onClick={() => {
              persistence.useBundledEnzymes().catch(() => {
                setError('Could not clear the imported table.');
              });
            }}
          >
            Go back to the bundled table
          </button>
        </p>
      )}
      <p className="panel__note panel__note--quiet">
        REBASE is © Dr. Richard J. Roberts, all rights reserved. PlasmidPop does not redistribute
        it: your copy stays in this browser. Please cite REBASE if you publish work that used it.
      </p>
      <p className="panel__buttons">
        <button type="button" className="button button--quiet button--small" onClick={onClose}>
          Close
        </button>
      </p>
    </div>
  );
}
