import { useEffect, useRef, useState } from 'react';

import {
  type BaseEditor,
  type CrisprGuide,
  type OligoScheme,
  type SeqDocument,
  BASE_EDITORS,
  MAX_SPACER,
  MIN_SPACER,
  NUCLEASES,
  OLIGO_SCHEMES,
  baseEditWindow,
  formatSpan,
  guideFeature,
  guideOligos,
  oligoSchemesFor,
  rangesEqual,
  supportsNickPairs,
  supportsPrimeEditing,
} from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { openCrisprWorkspace, takeCrisprFocusRequest } from '../crisprWorkspace';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { rememberSeen, wasSeen } from '../state/seenOnce';
import { savePrimers } from '../state/primerCollection';
import { type SortBy } from '../crisprSession';
import { MAX_PREVIEWED, flagsOf, guideId, useCrisprScan } from './crisprScan';
import { PairedNickases } from './CrisprPairedNickases';
import { PrimeEditing } from './CrisprPrimeEditing';

interface Props {
  readonly doc: SeqDocument;
}

/** The off-target disclaimer is said once; afterwards the label keeps it as a tooltip. */
const NOTE_SEEN_KEY = 'plasmidpop.crisprOffTargetNoteSeen';
const OFF_TARGET_NOTE =
  'Off-targets are counted in the open documents only. PlasmidPop has no genome to search, so this says nothing about specificity in a cell: check a guide against the host genome with a genome-wide tool before ordering it.';

/** The off-target counts as one short string: exact, then by mismatch. */
function offTargetSummary(g: CrisprGuide): string {
  return g.offTargets.map((n) => n.toLocaleString()).join('·');
}

/** What `useCrisprScan` hands a host: the panel and the workspace read one of these. */
export type CrisprScan = ReturnType<typeof useCrisprScan>;

/**
 * The guide list with its options, over a scan its host owns (item 133,
 * C2): the panel mounts it under its own links, the workspace's Guides page
 * as it is. Whichever is mounted, the state is the session's.
 */
export function CrisprGuideList({
  doc,
  scan,
}: {
  readonly doc: SeqDocument;
  readonly scan: CrisprScan;
}) {
  const {
    s,
    set,
    custom,
    nuclease,
    baseEditing,
    baseEditor,
    editableCount,
    region,
    usableSelection,
    narrowTo,
    guides,
    error,
    scanning,
    pams,
    pamChosen,
    sorted,
    filtered,
    covered,
    problem,
    others,
    selected,
    selectedId,
  } = scan;
  const { nucleaseId, pam, spacerLength, maxMismatches, searchOthers, sortBy } = s;
  const { spacerFilter, showFlagged, onlyEditable, schemeId } = s;
  const [noteSeen, setNoteSeen] = useState(() => wasSeen(NOTE_SEEN_KEY));

  // The selected row opens in place, so a guide clicked on the map is
  // brought into view here rather than left somewhere down the list.
  const selectedRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const row = selectedRow.current;
    // Guarded because jsdom, where the app's tests run, has no scrollIntoView.
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const schemes = nuclease === null ? OLIGO_SCHEMES : oligoSchemesFor(nuclease);
  const scheme = schemes.find((o) => o.id === schemeId) ?? schemes[0];

  return (
    <>
      <fieldset className="panel__group">
        <legend>Options</legend>
        <div className="panel__controls">
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
          {baseEditing && (
            <label className="panel__field panel__field--row">
              <span>Base editor</span>
              <select
                className="panel__select"
                value={baseEditor?.id ?? ''}
                onChange={(e) => {
                  set({ baseEditorId: e.target.value });
                  if (e.target.value !== '')
                    analytics.track('crispr', 'baseEditor', e.target.value);
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
        </div>
        {!noteSeen && (
          <p className="panel__note">
            {OFF_TARGET_NOTE}{' '}
            <button
              type="button"
              className="button button--quiet button--small"
              data-tip="Hide this; the Off-targets label keeps it as a tooltip"
              onClick={() => {
                rememberSeen(NOTE_SEEN_KEY);
                setNoteSeen(true);
              }}
            >
              Got it
            </button>
          </p>
        )}
      </fieldset>

      {problem !== null && <p className="panel__note panel__note--warn">{problem}</p>}
      {error !== null && <p className="panel__note panel__note--warn">{error}</p>}
      {problem === null && (
        <fieldset className="panel__group">
          <legend>
            Guides
            {guides !== null && guides.length > 0 && (
              <span className="panel__heading-note">
                {filtered
                  ? `${sorted.length.toLocaleString()} of ${guides.length.toLocaleString()}`
                  : guides.length.toLocaleString()}
              </span>
            )}
          </legend>
          {scanning && guides === null ? (
            <p className="panel__note">Looking for guides…</p>
          ) : guides === null || guides.length === 0 ? (
            <p className="panel__note">
              No guides{region !== null ? ' cutting in the selection' : ''}. Another nuclease or a
              custom PAM may find some.
            </p>
          ) : (
            <>
              <div className="panel__controls crispr-filters">
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
                <label className="panel__field panel__field--row">
                  <span>Sort by</span>
                  <select
                    className="panel__select"
                    value={sortBy}
                    onChange={(e) => {
                      set({ sortBy: e.target.value as SortBy });
                    }}
                  >
                    <option value="position">Position</option>
                    <option value="offTargets">Fewest off-targets</option>
                    <option value="gc">GC, high to low</option>
                    <option value="specificity">Specificity, high to low</option>
                  </select>
                </label>
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
              {sorted.length > 0 && (
                <div className="crispr-actions">
                  <button
                    type="button"
                    className="button button--small"
                    data-tip="Annotate every guide in the list as a feature, in one step to undo"
                    onClick={() => {
                      analytics.track('crispr', 'addAll');
                      editorStore.apply({
                        type: 'addFeatures',
                        features: sorted.map(guideFeature),
                      });
                      editorStore.setSidebarTab('features');
                    }}
                  >
                    Add {filtered ? 'the ' : 'all '}
                    {sorted.length.toLocaleString()} listed as features
                  </button>
                </div>
              )}
              {sorted.length === 0 ? (
                <p className="panel__note">No guides match the filters.</p>
              ) : (
                <ul className="crispr-list">
                  {sorted.slice(0, MAX_PREVIEWED).map((g) => {
                    const flags = flagsOf(g);
                    const active = guideId(g) === selectedId;
                    return (
                      <li key={guideId(g)} ref={active ? selectedRow : null}>
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
                            aria-label={
                              g.strand === 'forward' ? 'forward strand' : 'reverse strand'
                            }
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
                          <span
                            className="crispr-row__off"
                            data-tip="Off-targets: exact, then by mismatch"
                          >
                            {offTargetSummary(g)}
                          </span>
                          {baseEditor !== undefined && (
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
                        {active && selected !== null && scheme !== undefined && (
                          <GuideDetail
                            doc={doc}
                            guide={selected}
                            flags={flags}
                            others={others}
                            baseEditor={baseEditor}
                            schemes={schemes}
                            scheme={scheme}
                            onScheme={(id) => {
                              set({ schemeId: id });
                            }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {sorted.length > MAX_PREVIEWED && (
                <p className="panel__note">
                  Showing the first {MAX_PREVIEWED} of {sorted.length.toLocaleString()}. Filter the
                  list or narrow the scan to a selection to see the rest.
                </p>
              )}
            </>
          )}
        </fieldset>
      )}
    </>
  );
}

/** The id the workspace's Escape hands the keyboard back to (item 107, point 1). */
export const MORE_BUTTON_ID = 'crispr-workspace-open';

export function CrisprPanel({ doc }: Props) {
  const scan = useCrisprScan(doc);
  const { guides, nuclease, problem } = scan;
  const { documentId } = useEditorState();
  const more = useRef<HTMLButtonElement>(null);
  // The workspace shut with Escape: the keyboard comes back here.
  useEffect(() => {
    if (takeCrisprFocusRequest()) more.current?.focus();
  }, []);

  return (
    <div className="panel">
      <CrisprGuideList doc={doc} scan={scan} />
      {problem === null &&
        nuclease !== null &&
        guides !== null &&
        supportsPrimeEditing(nuclease) && (
          <PrimeEditing doc={doc} guides={guides} nuclease={nuclease} />
        )}
      {problem === null && nuclease !== null && guides !== null && supportsNickPairs(nuclease) && (
        <PairedNickases doc={doc} guides={guides} />
      )}
      <div className="panel__links">
        <button
          type="button"
          id={MORE_BUTTON_ID}
          ref={more}
          className="link panel__door"
          data-tip="The guide list on a page of its own, with the paired nickases and prime editing: the CRISPR workspace"
          onClick={() => {
            openCrisprWorkspace(documentId);
          }}
        >
          Open CRISPR workspace ›
        </button>
      </div>
    </div>
  );
}

interface DetailProps {
  readonly doc: SeqDocument;
  readonly guide: CrisprGuide;
  readonly flags: readonly string[];
  readonly others: readonly { readonly name: string }[];
  readonly baseEditor: BaseEditor | undefined;
  readonly schemes: readonly OligoScheme[];
  readonly scheme: OligoScheme;
  readonly onScheme: (id: string) => void;
}

/** The selected guide, opened in place under its row. */
function GuideDetail({
  doc,
  guide,
  flags,
  others,
  baseEditor,
  schemes,
  scheme,
  onScheme,
}: DetailProps) {
  const [saved, setSaved] = useState<string | null>(null);
  const oligos = guideOligos(guide.spacer, scheme);
  const at = (guide.range.start + 1).toLocaleString();
  const window = baseEditor === undefined ? null : baseEditWindow(guide, baseEditor);

  return (
    <div className="crispr-guide">
      <dl className="crispr-detail">
        <dt>Protospacer</dt>
        <dd>
          {formatSpan(guide.range, doc.length)} ({guide.strand})
        </dd>
        <dt>Spacer</dt>
        <dd className="crispr-detail__mono">{guide.spacer}</dd>
        <dt>PAM</dt>
        <dd className="crispr-detail__mono">{guide.pam}</dd>
        <dt>Cut</dt>
        <dd>
          {guide.cut.forward === guide.cut.reverse
            ? `blunt, after base ${guide.cut.forward.toLocaleString()}`
            : `after base ${guide.cut.forward.toLocaleString()} on the top strand and ${guide.cut.reverse.toLocaleString()} on the bottom`}
        </dd>
        <dt>GC</dt>
        <dd>{Math.round(guide.gc * 100)}%</dd>
        {guide.specificity !== null && (
          <>
            <dt>Specificity</dt>
            <dd data-tip="MIT score (Hsu 2013) over the off-target sites counted here; 100 is no other site">
              {guide.specificity.toFixed(0)} / 100
            </dd>
          </>
        )}
        {window !== null && (
          <>
            <dt>
              {window.editor.from} to {window.editor.to}
            </dt>
            <dd>
              {window.editable.length === 0
                ? `no ${window.editor.from} in positions ${String(window.editor.window[0])}-${String(window.editor.window[1])}`
                : `${window.editable.map((b) => `${b.base}${String(b.position)}`).join(', ')} (${formatSpan(window.range, doc.length)})`}
            </dd>
            {window.editable.length > 0 && (
              <>
                <dt>Edited</dt>
                <dd className="crispr-detail__mono">{window.edited}</dd>
              </>
            )}
          </>
        )}
        <dt>Flags</dt>
        <dd className={flags.length > 0 ? 'crispr-detail__flags' : undefined}>
          {flags.length > 0 ? flags.join('; ') : 'none'}
        </dd>
      </dl>
      <div className="crispr-actions">
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            analytics.track('crispr', 'add');
            const feature = guideFeature(guide);
            editorStore.apply({ type: 'addFeature', feature }, guide.range);
            editorStore.requestRename(feature.id);
            editorStore.setSidebarTab('features');
          }}
        >
          Add as feature
        </button>
      </div>

      {guide.sites.length > 0 && (
        <>
          <h4 className="crispr-guide__heading">
            Other sites
            <span className="panel__heading-note">
              {guide.offTargets.reduce((a, b) => a + b, 0).toLocaleString()}
            </span>
          </h4>
          <ul className="crispr-sites">
            {guide.sites.map((s) => {
              const where =
                s.doc === 0 ? doc.name : (others[s.doc - 1]?.name ?? 'another document');
              return (
                <li key={`${String(s.doc)}:${s.strand}:${String(s.range.start)}`}>
                  <span className="crispr-sites__mm">
                    {s.mismatches === 0 ? 'exact' : `${String(s.mismatches)} mm`}
                  </span>
                  <span className="crispr-sites__where">{where}</span>
                  <span className="crispr-sites__at">
                    {s.strand === 'forward' ? '→' : '←'}{' '}
                    {s.doc === 0
                      ? formatSpan(s.range, doc.length)
                      : (s.range.start + 1).toLocaleString()}
                  </span>
                  {s.doc === 0 && (
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      onClick={() => {
                        editorStore.setSelection(s.range);
                        editorStore.revealPosition(s.range.start);
                      }}
                    >
                      Show
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h4 className="crispr-guide__heading">Oligos to order</h4>
      <div className="panel__controls">
        <label className="panel__field panel__field--stack">
          <span>Overhangs</span>
          <select
            className="panel__select"
            value={scheme.id}
            onChange={(e) => {
              onScheme(e.target.value);
            }}
          >
            {schemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="panel__protein">
        <span className="crispr-oligo">{oligos.top}</span>
        <span className="crispr-oligo">{oligos.bottom}</span>
      </p>
      <div className="crispr-actions">
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            copyText(`${oligos.top}\n${oligos.bottom}`);
          }}
        >
          Copy oligos
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            analytics.track('crispr', 'oligos', scheme.id);
            const notes = `CRISPR guide oligo, ${guide.pam} PAM`;
            void savePrimers(
              [
                { name: `guide ${at} top`, sequence: oligos.top, notes },
                { name: `guide ${at} bottom`, sequence: oligos.bottom, notes },
              ],
              'design',
            ).then((r) => {
              setSaved(
                r.added.length === 0
                  ? 'Already in My primers.'
                  : `Saved ${r.added.length.toLocaleString()} oligos to My primers.`,
              );
            });
          }}
        >
          Save to My primers
        </button>
      </div>
      {saved !== null && <p className="panel__note">{saved}</p>}
    </div>
  );
}
