import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type CrisprGuide,
  type Nuclease,
  type OligoScheme,
  type Range,
  type SeqDocument,
  GC_HIGH,
  GC_LOW,
  HOMOPOLYMER_FLAG,
  MAX_SPACER,
  MIN_SPACER,
  NUCLEASES,
  OLIGO_SCHEMES,
  createFeature,
  formatSpan,
  guideOligos,
  isEmptyRange,
  isValidRange,
  matchPositions,
  nucleaseProblem,
  oligoSchemesFor,
  patternMasks,
  rangeSegment,
  rangesEqual,
  sequenceMasks,
} from '@/core';

import { type OverlaySpan } from '@/view/overlay';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

/** As the ORF list does, past this many the views are left alone (#32). */
const MAX_PREVIEWED = 200;

const guideId = (g: CrisprGuide): string => `${g.strand}:${String(g.range.start)}`;

/** The off-target counts as one short string: exact, then by mismatch. */
function offTargetSummary(g: CrisprGuide): string {
  return g.offTargets.map((n) => n.toLocaleString()).join('·');
}

/** Everything wrong with a guide, worst first; empty when there is nothing to say. */
function flagsOf(g: CrisprGuide): string[] {
  const flags: string[] = [];
  if ((g.offTargets[0] ?? 0) > 0) flags.push('Binds somewhere else exactly');
  if (g.polyT) flags.push('TTTT ends a U6 transcript');
  if (g.gc < GC_LOW) flags.push('Low GC');
  if (g.gc > GC_HIGH) flags.push('High GC');
  if (g.longestRun >= HOMOPOLYMER_FLAG) flags.push(`${String(g.longestRun)} of one base in a row`);
  return flags;
}

type SortBy = 'position' | 'offTargets' | 'gc';

/** Fewest exact hits first, then fewest near ones, then along the molecule. */
function byOffTargets(a: CrisprGuide, b: CrisprGuide): number {
  for (let i = 0; i < Math.max(a.offTargets.length, b.offTargets.length); i++) {
    const d = (a.offTargets[i] ?? 0) - (b.offTargets[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.range.start - b.range.start;
}

/** One scan: the question put to the worker. */
interface Request {
  readonly sequence: string;
  readonly topology: SeqDocument['topology'];
  readonly nuclease: Nuclease;
  readonly maxMismatches: number;
  readonly region: Range | null;
  readonly background: readonly {
    readonly sequence: string;
    readonly topology: SeqDocument['topology'];
  }[];
}

/** Another open document the off-targets are counted in. */
interface Background {
  readonly name: string;
  readonly sequence: string;
  readonly topology: SeqDocument['topology'];
}

const backgroundKey = (d: Background): string => `${d.name}\0${d.topology}\0${d.sequence}`;

function sameBackground(a: readonly Background[], b: readonly Background[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const n = b[i];
      return n !== undefined && backgroundKey(p) === backgroundKey(n);
    })
  );
}

/** What came back, and which question it answers. */
interface Answer {
  readonly request: Request;
  readonly guides?: readonly CrisprGuide[];
  readonly error?: string;
}

export function CrisprPanel({ doc }: Props) {
  const { selection, previewActivated: activated, documents, documentId } = useEditorState();
  const [nucleaseId, setNucleaseId] = useState<string>('spcas9');
  const [pam, setPam] = useState('NGG');
  const [spacerLength, setSpacerLength] = useState('20');
  const [maxMismatches, setMaxMismatches] = useState(3);
  /**
   * The region the scan is narrowed to, taken from the selection when the
   * box is ticked and kept until it is ticked again: a guide clicked in the
   * list selects its protospacer, and narrowing to that would empty the
   * list it was clicked in.
   */
  const [narrowed, setNarrowed] = useState<{ documentId: string; range: Range } | null>(null);
  const [searchOthers, setSearchOthers] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('position');
  // The filters sit on the result, not the scan: changing one is instant.
  const [spacerFilter, setSpacerFilter] = useState('');
  const [pamFilter, setPamFilter] = useState('');
  const [hideFlagged, setHideFlagged] = useState(false);
  const [schemeId, setSchemeId] = useState(OLIGO_SCHEMES[0]?.id ?? 'none');
  const [answer, setAnswer] = useState<Answer | null>(null);
  /**
   * The row last clicked. Which guide the panel shows is the one the
   * selection covers, so a guide clicked on the map or in the sequence
   * opens here too; two guides can share a range on opposite strands, and
   * this says which of the two was meant when the click came from a row.
   */
  const [clicked, setClicked] = useState<string | null>(null);

  const custom = nucleaseId === 'custom';
  const length = Number.parseInt(spacerLength, 10);
  const problem = custom ? nucleaseProblem(pam.trim().toUpperCase(), length) : null;

  const nuclease = useMemo<Nuclease | null>(() => {
    if (!custom) return NUCLEASES.find((n) => n.id === nucleaseId) ?? null;
    if (problem !== null) return null;
    // A custom PAM is taken to be a Cas9-like one: on the 3' side of the
    // spacer, cutting bluntly three bases in from it. That is what the
    // engineered PAM variants (xCas9, SpRY, SaCas9-KKH) do; a nuclease with
    // another geometry needs a preset (item 74).
    return {
      id: 'custom',
      name: `Custom (${pam.trim().toUpperCase()})`,
      pam: pam.trim().toUpperCase(),
      pamSide: '3prime',
      spacerLength: length,
      cut: { pamStrand: length - 3, targetStrand: length - 3 },
    };
  }, [custom, nucleaseId, pam, length, problem]);

  const usableSelection = selection !== null && !isEmptyRange(selection) ? selection : null;
  // Dropped with the document it was taken in, or once an edit leaves it off the end.
  const region =
    narrowed !== null &&
    narrowed.documentId === documentId &&
    isValidRange(narrowed.range, doc.length, doc.topology)
      ? narrowed.range
      : null;
  const narrowTo = (range: Range | null): void => {
    setNarrowed(range === null || documentId === null ? null : { documentId, range });
    if (range !== null) analytics.track('crispr', 'region');
  };
  // `documents` is a new array on every selection change in any of them, so
  // the list is kept as state and replaced only when what is searched has
  // changed: otherwise the request below would be a new one per click, and
  // every click would scan the molecule again.
  const [others, setOthers] = useState<readonly Background[]>([]);
  const nextOthers = useMemo<readonly Background[]>(
    () =>
      searchOthers
        ? documents
            .filter(
              (d) => d.documentId !== documentId && d.history.present.alphabet === 'nucleotide',
            )
            .map((d) => ({
              name: d.history.present.name,
              sequence: d.history.present.sequence.toString(),
              topology: d.history.present.topology,
            }))
        : [],
    [searchOthers, documents, documentId],
  );
  if (!sameBackground(others, nextOthers)) setOthers(nextOthers);

  // Everything one scan is: a change to any of it is a different question,
  // and the answer to the previous one stops being shown the moment it is.
  const sequence = doc.sequence.toString();
  const request = useMemo<Request | null>(
    () =>
      nuclease === null
        ? null
        : {
            sequence,
            topology: doc.topology,
            nuclease,
            maxMismatches,
            region,
            background: others.map(({ sequence: s, topology }) => ({ sequence: s, topology })),
          },
    [sequence, doc.topology, nuclease, maxMismatches, region, others],
  );

  // The scan itself, in the worker, so a big plasmid does not hold up typing.
  useEffect(() => {
    if (request === null) return;
    let live = true;
    analysisClient
      .crisprGuides(request.sequence, request.topology, request.nuclease, {
        maxMismatches: request.maxMismatches,
        ...(request.region === null ? {} : { region: request.region }),
        ...(request.background.length === 0 ? {} : { background: request.background }),
      })
      .then((guides) => {
        if (live) setAnswer({ request, guides });
      })
      .catch((e: unknown) => {
        if (live) setAnswer({ request, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [request]);

  const answered = answer !== null && answer.request === request ? answer : null;
  const guides = answered?.guides ?? null;
  const error = answered?.error ?? null;
  const scanning = request !== null && answered === null;

  // Once per nuclease chosen, not once per keystroke of a custom PAM.
  const nucleaseKind = nuclease?.id ?? null;
  useEffect(() => {
    if (nucleaseKind !== null) analytics.track('crispr', 'scan', nucleaseKind);
  }, [nucleaseKind]);

  // The PAMs actually found: NGG is four of them, NNGRRT up to sixty-four,
  // and which one a guide has is worth filtering on (SpCas9 prefers some).
  const pams = useMemo(() => [...new Set((guides ?? []).map((g) => g.pam))].sort(), [guides]);
  const pamChosen = pams.includes(pamFilter) ? pamFilter : '';

  const sorted = useMemo(() => {
    const pattern = spacerFilter.trim().toUpperCase();
    const masks = pattern === '' ? null : patternMasks(pattern);
    const list = (guides ?? []).filter((g) => {
      if (pamChosen !== '' && g.pam !== pamChosen) return false;
      if (hideFlagged && flagsOf(g).length > 0) return false;
      if (masks === null) return true;
      // IUPAC, so "GRCC" or "N" work as they do in Find; an unknown letter
      // is a mask of nothing and matches no guide.
      const spacer = sequenceMasks(g.spacer);
      return matchPositions(spacer, masks, g.spacer.length - masks.length).length > 0;
    });
    if (sortBy === 'offTargets') list.sort(byOffTargets);
    else if (sortBy === 'gc') list.sort((a, b) => b.gc - a.gc || a.range.start - b.range.start);
    return list;
  }, [guides, sortBy, spacerFilter, pamChosen, hideFlagged]);
  const filtered = guides !== null && sorted.length !== guides.length;

  const covered = sorted.filter(
    (g) => selection !== null && g.range.start === selection.start && g.range.end === selection.end,
  );
  const selected = covered.find((g) => guideId(g) === clicked) ?? covered[0] ?? null;
  const selectedId = selected === null ? null : guideId(selected);

  const previewed = useMemo<OverlaySpan[]>(
    () =>
      sorted.length > MAX_PREVIEWED
        ? []
        : sorted.map((g) => ({
            id: guideId(g),
            label: g.pam,
            range: g.range,
            strand: g.strand,
            shape: 'arrow',
            clickable: true,
          })),
    [sorted],
  );
  useEffect(() => {
    editorStore.setPreview('crispr', previewed);
  }, [previewed]);
  useEffect(
    () => () => {
      editorStore.clearPreview('crispr');
    },
    [],
  );

  const handledClick = useRef(activated?.nonce ?? 0);
  useEffect(() => {
    if (activated?.owner !== 'crispr' || activated.nonce === handledClick.current) return;
    handledClick.current = activated.nonce;
    const g = sorted.find((x) => guideId(x) === activated.id);
    if (g === undefined) return;
    editorStore.setSelection(g.range);
    editorStore.revealPosition(g.range.start);
  }, [activated, sorted]);

  // The selected row opens in place, so a guide clicked on the map is
  // brought into view here rather than left somewhere down the list.
  const selectedRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const row = selectedRow.current;
    // Guarded because jsdom, where the app's tests run, has no scrollIntoView.
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const schemes = nuclease === null ? OLIGO_SCHEMES : oligoSchemesFor(nuclease);
  const scheme = schemes.find((s) => s.id === schemeId) ?? schemes[0];

  return (
    <div className="panel">
      <div className="panel__controls">
        <label className="panel__field panel__field--row">
          <span>Nuclease</span>
          <select
            className="panel__select"
            value={nucleaseId}
            onChange={(e) => {
              setNucleaseId(e.target.value);
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
            <label className="panel__field">
              PAM
              <input
                className="crispr-pam"
                value={pam}
                size={8}
                onChange={(e) => {
                  setPam(e.target.value);
                }}
                aria-label="PAM in IUPAC codes"
              />
            </label>
            <label className="panel__field">
              Spacer
              <input
                className="panel__number"
                type="number"
                min={MIN_SPACER}
                max={MAX_SPACER}
                value={spacerLength}
                onChange={(e) => {
                  setSpacerLength(e.target.value);
                }}
              />
              nt
            </label>
          </>
        )}
        <label className="panel__field">
          Off-targets to
          <select
            value={maxMismatches}
            onChange={(e) => {
              setMaxMismatches(Number.parseInt(e.target.value, 10));
            }}
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          mismatches
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={searchOthers}
            onChange={(e) => {
              setSearchOthers(e.target.checked);
              if (e.target.checked) analytics.track('crispr', 'background');
            }}
          />
          Count off-targets in the other open documents too
        </label>
        <label className="toggle">
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

      {problem !== null && <p className="panel__note panel__note--warn">{problem}</p>}
      {error !== null && <p className="panel__note panel__note--warn">{error}</p>}
      <p className="panel__note">
        Off-targets are counted in the open documents only. PlasmidPop has no genome to search, so
        this says nothing about specificity in a cell — check a guide against the host genome with a
        genome-wide tool before ordering it.
      </p>

      {problem === null &&
        (scanning && guides === null ? (
          <p className="panel__note">Looking for guides…</p>
        ) : guides === null || guides.length === 0 ? (
          <p className="panel__note">
            No guides{region !== null ? ' cutting in the selection' : ''}. Another nuclease or a
            custom PAM may find some.
          </p>
        ) : (
          <>
            <h3 className="panel__heading">
              Guides
              <span className="panel__heading-note">
                {filtered
                  ? `${sorted.length.toLocaleString()} of ${guides.length.toLocaleString()}`
                  : guides.length.toLocaleString()}
              </span>
            </h3>
            <div className="panel__controls crispr-filters">
              <input
                className="panel__search panel__mono-input"
                value={spacerFilter}
                placeholder="Spacer contains… (IUPAC)"
                aria-label="Spacer contains"
                spellCheck={false}
                onChange={(e) => {
                  setSpacerFilter(e.target.value);
                }}
              />
              {pams.length > 1 && (
                <label className="panel__field">
                  PAM
                  <select
                    value={pamChosen}
                    onChange={(e) => {
                      setPamFilter(e.target.value);
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
              <label className="panel__field">
                Sort by
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as SortBy);
                  }}
                >
                  <option value="position">Position</option>
                  <option value="offTargets">Fewest off-targets</option>
                  <option value="gc">GC, high to low</option>
                </select>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={hideFlagged}
                  onChange={(e) => {
                    setHideFlagged(e.target.checked);
                  }}
                />
                Hide flagged guides
              </label>
            </div>
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
                        onClick={() => {
                          setClicked(guideId(g));
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
                        <span className="crispr-row__gc" title="GC content">
                          {Math.round(g.gc * 100)}%
                        </span>
                        <span
                          className="crispr-row__off"
                          title="Off-targets: exact, then by mismatch"
                        >
                          {offTargetSummary(g)}
                        </span>
                        <span className="crispr-row__warning" title={flags.join('; ')}>
                          {flags.length > 0 ? '!' : ''}
                        </span>
                      </button>
                      {active && selected !== null && scheme !== undefined && (
                        <GuideDetail
                          doc={doc}
                          guide={selected}
                          flags={flags}
                          others={others}
                          schemes={schemes}
                          scheme={scheme}
                          onScheme={setSchemeId}
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
        ))}
    </div>
  );
}

interface DetailProps {
  readonly doc: SeqDocument;
  readonly guide: CrisprGuide;
  readonly flags: readonly string[];
  readonly others: readonly { readonly name: string }[];
  readonly schemes: readonly OligoScheme[];
  readonly scheme: OligoScheme;
  readonly onScheme: (id: string) => void;
}

/** The selected guide, opened in place under its row. */
function GuideDetail({ doc, guide, flags, others, schemes, scheme, onScheme }: DetailProps) {
  const [saved, setSaved] = useState<string | null>(null);
  const oligos = guideOligos(guide.spacer, scheme);
  const at = (guide.range.start + 1).toLocaleString();

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
            const feature = createFeature({
              type: 'misc_feature',
              name: `guide ${at}`,
              strand: guide.strand,
              segments: [rangeSegment(guide.range.start, guide.range.end)],
              qualifiers: [{ name: 'note', value: `CRISPR protospacer, ${guide.pam} PAM` }],
            });
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
