import { type SeqDocument, BASE_EDITORS } from '@/core';

import { analytics } from '../analytics';
import { type CrisprScan, NucleaseControls, RegionControl } from './CrisprGuideList';
import { CrisprGuideTable } from './CrisprGuideTable';
import { OFF_TARGET_NOTE } from './crisprOffTargetNote';
import { SCAN_ADVICE, SCAN_SLOW } from './crisprScan';
import { RunNotices } from './RunNotices';

/** The page's head, until it is acknowledged: what the counts do not say. */
export function OffTargetNote({ onSeen }: { readonly onSeen: () => void }) {
  return (
    <p className="panel__note">
      {OFF_TARGET_NOTE}{' '}
      <button
        type="button"
        className="button button--quiet button--small"
        data-tip="Hide this; the Off-targets label keeps it as a tooltip"
        onClick={onSeen}
      >
        Got it
      </button>
    </p>
  );
}

/**
 * What a scan that has no guides yet says, on every page that lists them: a
 * custom PAM that is not one, a scan that failed or is slow, and the wait.
 */
export function CrisprScanNotices({ scan }: { readonly scan: CrisprScan }) {
  const { problem, error, stopped, slow, retry, scanning, guides } = scan;
  return (
    <>
      {problem !== null && <p className="panel__note panel__note--warn">{problem}</p>}
      <RunNotices
        error={error}
        stopped={stopped}
        slow={slow}
        busy={scanning}
        retry={retry}
        advice={SCAN_ADVICE}
        slowText={SCAN_SLOW}
      />
      {problem === null && scanning && guides === null && (
        <p className="panel__note">Looking for guides…</p>
      )}
    </>
  );
}

interface Props {
  readonly doc: SeqDocument;
  readonly scan: CrisprScan;
  /** The note in the head has been dismissed, so its label carries it as a tooltip. */
  readonly noteSeen: boolean;
}

/**
 * The CRISPR workspace's Guides page (item 133, C4): the settings that
 * change what is scanned for, the filters that thin out what was found, and
 * the table of it. The slim tab's two settings are in the settings row too,
 * the same controls over the same session.
 */
export function CrisprGuides({ doc, scan, noteSeen }: Props) {
  const { s, set, baseEditing, baseEditor, guides, scanning } = scan;
  const { problem, region, pams, pamChosen } = scan;
  const { maxMismatches, searchOthers, spacerFilter, showFlagged, onlyEditable } = s;

  return (
    <>
      <div className="panel__controls crispr-ws__settings" role="group" aria-label="Settings">
        <NucleaseControls scan={scan} />
        <label className="panel__field panel__field--row">
          {noteSeen ? (
            <span className="panel__hint" data-tip={OFF_TARGET_NOTE}>
              Off-targets up to
            </span>
          ) : (
            <span>Off-targets up to</span>
          )}
          <select
            className="panel__select"
            value={maxMismatches}
            onChange={(e) => {
              set({ maxMismatches: Number.parseInt(e.target.value, 10) });
            }}
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'mismatch' : 'mismatches'}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={searchOthers}
            onChange={(e) => {
              set({ searchOthers: e.target.checked });
              if (e.target.checked) analytics.track('crispr', 'background');
            }}
          />
          Count off-targets in the other open documents too
        </label>
        <RegionControl doc={doc} scan={scan} />
      </div>

      <CrisprScanNotices scan={scan} />
      {problem === null && !scanning && guides !== null && guides.length === 0 && (
        <p className="panel__note">
          No guides{region !== null ? ' cutting in the selection' : ''}. Another nuclease or a
          custom PAM may find some.
        </p>
      )}
      {problem === null && guides !== null && guides.length > 0 && (
        <>
          <div className="panel__controls crispr-filters" role="group" aria-label="Filters">
            <input
              className="panel__search panel__mono-input"
              value={spacerFilter}
              placeholder="Spacer contains… (IUPAC)"
              aria-label="Spacer contains"
              spellCheck={false}
              onChange={(e) => {
                set({ spacerFilter: e.target.value });
              }}
            />
            {pams.length > 1 && (
              <label className="panel__field panel__field--row">
                <span>PAM</span>
                <select
                  className="panel__select"
                  value={pamChosen}
                  onChange={(e) => {
                    set({ pamFilter: e.target.value });
                  }}
                >
                  <option value="">any</option>
                  {pams.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="button button--small button--toggle"
              aria-pressed={showFlagged}
              data-tip={
                showFlagged
                  ? 'Press to hide the guides marked with a ! again'
                  : 'Guides marked with a ! are hidden; press to list them too'
              }
              onClick={() => {
                set({ showFlagged: !showFlagged });
              }}
            >
              Show flagged
            </button>
            {baseEditing && (
              <label className="panel__field panel__field--row">
                <span>Base editor</span>
                <select
                  className="panel__select"
                  value={baseEditor?.id ?? ''}
                  onChange={(e) => {
                    set({ baseEditorId: e.target.value });
                    if (e.target.value !== '') {
                      analytics.track('crispr', 'baseEditor', e.target.value);
                    }
                  }}
                >
                  <option value="">none</option>
                  {BASE_EDITORS.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {baseEditor !== undefined && (
              <button
                type="button"
                className="button button--small button--toggle"
                aria-pressed={onlyEditable}
                data-tip={`Only list guides with a ${baseEditor.from} in the editing window`}
                onClick={() => {
                  set({ onlyEditable: !onlyEditable });
                }}
              >
                Only with a {baseEditor.from} to edit
              </button>
            )}
          </div>
          {scan.sorted.length === 0 ? (
            <p className="panel__note">No guides match the filters.</p>
          ) : (
            <CrisprGuideTable doc={doc} scan={scan} />
          )}
        </>
      )}
    </>
  );
}
