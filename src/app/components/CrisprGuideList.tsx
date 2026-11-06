import {
  type CrisprGuide,
  type SeqDocument,
  MAX_SPACER,
  MIN_SPACER,
  NUCLEASES,
  formatSpan,
  rangesEqual,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { type useCrisprScan, flagsOf, guideId } from './crisprScan';

/*
 * The pieces the slim CRISPR tab and the workspace's Guides page share (item
 * 133): the nuclease and region controls, and the tab's compact guide row.
 * The page's own table, detail and filters are `CrisprGuides.tsx`.
 */

/** The off-target counts as one short string: exact, then by mismatch. */
function offTargetSummary(g: CrisprGuide): string {
  return g.offTargets.map((n) => n.toLocaleString()).join('·');
}

/** What `useCrisprScan` hands a host: the panel and the workspace read one of these. */
export type CrisprScan = ReturnType<typeof useCrisprScan>;

/** What the panel and the workspace share: the nuclease, and the PAM and spacer of a custom one. */
export function NucleaseControls({ scan }: { readonly scan: CrisprScan }) {
  const { s, set, custom } = scan;
  const { nucleaseId, pam, spacerLength } = s;
  return (
    <>
      <label className="panel__field panel__field--row">
        <span>Nuclease</span>
        <select
          className="panel__select"
          value={nucleaseId}
          onChange={(e) => {
            set({ nucleaseId: e.target.value });
          }}
        >
          {NUCLEASES.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
          <option value="custom">Custom PAM…</option>
        </select>
      </label>
      {custom && (
        <>
          <label className="panel__field panel__field--row">
            <span>PAM</span>
            <input
              className="panel__number crispr-pam"
              value={pam}
              size={8}
              onChange={(e) => {
                set({ pam: e.target.value });
              }}
              aria-label="PAM in IUPAC codes"
            />
          </label>
          <label className="panel__field panel__field--row">
            <span>Spacer (nt)</span>
            <input
              className="panel__number"
              type="number"
              min={MIN_SPACER}
              max={MAX_SPACER}
              value={spacerLength}
              onChange={(e) => {
                set({ spacerLength: e.target.value });
              }}
            />
          </label>
        </>
      )}
    </>
  );
}

/** "Only cuts in the selection", with the region it holds and the way to take a new one. */
export function RegionControl({
  doc,
  scan,
}: {
  readonly doc: SeqDocument;
  readonly scan: CrisprScan;
}) {
  const { region, usableSelection, narrowTo, covered } = scan;
  return (
    <>
      <label
        className="toggle"
        data-tip={
          region === null && usableSelection === null
            ? 'Select part of the document first'
            : undefined
        }
      >
        <input
          type="checkbox"
          checked={region !== null}
          disabled={region === null && usableSelection === null}
          onChange={(e) => {
            narrowTo(e.target.checked ? usableSelection : null);
          }}
        />
        Only cuts in the selection
      </label>
      {region !== null && (
        <p className="panel__note">
          Cuts in {formatSpan(region, doc.length)}
          {usableSelection !== null &&
            !rangesEqual(usableSelection, region) &&
            covered.length === 0 && (
              <>
                {' '}
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={() => {
                    narrowTo(usableSelection);
                  }}
                >
                  Use the selection now
                </button>
              </>
            )}
        </p>
      )}
    </>
  );
}

/** One guide's compact row: a click selects the protospacer, the open row closes on a second. */
export function GuideRow({
  guide: g,
  active,
  scan,
  edits = false,
}: {
  readonly guide: CrisprGuide;
  readonly active: boolean;
  readonly scan: CrisprScan;
  /** Whether the base editor's count has a column: the panel's rows have none. */
  readonly edits?: boolean;
}) {
  const { set, baseEditor, editableCount } = scan;
  const flags = flagsOf(g);
  return (
    <button
      type="button"
      className={`crispr-row${active ? ' crispr-row--selected' : ''}`}
      aria-expanded={active}
      data-tip={active ? 'Close the guide and clear the selection' : undefined}
      onClick={() => {
        // The open row closes on a second click, and its
        // selection goes with it, so the views are clear again.
        if (active) {
          set({ clicked: null });
          editorStore.setSelection(null);
          return;
        }
        set({ clicked: guideId(g) });
        editorStore.setSelection(g.range);
        editorStore.revealPosition(g.range.start);
      }}
    >
      <span
        className="crispr-row__strand"
        aria-label={g.strand === 'forward' ? 'forward strand' : 'reverse strand'}
      >
        {g.strand === 'forward' ? '→' : '←'}
      </span>
      <span className="crispr-row__spacer">
        {g.spacer}
        <span className="crispr-row__pam">{g.pam}</span>
      </span>
      <span className="crispr-row__gc" data-tip="GC content">
        {Math.round(g.gc * 100)}%
      </span>
      <span className="crispr-row__off" data-tip="Off-targets: exact, then by mismatch">
        {offTargetSummary(g)}
      </span>
      {edits && baseEditor !== undefined && (
        <span
          className="crispr-row__edit"
          data-tip={`${baseEditor.from} to ${baseEditor.to} edits in the window`}
        >
          {editableCount(g)}
        </span>
      )}
      <span className="crispr-row__warning" data-tip={flags.join('; ')}>
        {flags.length > 0 ? '!' : ''}
      </span>
    </button>
  );
}
