import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type CrisprGuide,
  type Nuclease,
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
  nucleaseProblem,
  rangeSegment,
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
  return g.offTargets.map((n) => n.toLocaleString()).join(' · ');
}

/** The worst thing about a guide, or null when there is nothing to say. */
function warningOf(g: CrisprGuide): string | null {
  if ((g.offTargets[0] ?? 0) > 0) return 'Binds somewhere else exactly';
  if (g.polyT) return 'TTTT ends a U6 transcript';
  if (g.gc < GC_LOW) return 'Low GC';
  if (g.gc > GC_HIGH) return 'High GC';
  if (g.longestRun >= HOMOPOLYMER_FLAG) return `${String(g.longestRun)} of one base in a row`;
  return null;
}

type SortBy = 'position' | 'offTargets';

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
  const [inSelection, setInSelection] = useState(false);
  const [searchOthers, setSearchOthers] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('position');
  const [schemeId, setSchemeId] = useState(OLIGO_SCHEMES[0]?.id ?? 'none');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
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

  const region = useMemo(
    () => (inSelection && selection !== null && !isEmptyRange(selection) ? selection : null),
    [inSelection, selection],
  );
  const others = useMemo(
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

  useEffect(() => {
    if (nuclease !== null) analytics.track('crispr', 'scan', nuclease.id);
  }, [nuclease]);
  useEffect(() => {
    if (region !== null) analytics.track('crispr', 'region');
  }, [region]);
  useEffect(() => {
    if (others.length > 0) analytics.track('crispr', 'background');
  }, [others.length]);

  const sorted = useMemo(() => {
    const list = [...(guides ?? [])];
    if (sortBy === 'offTargets') {
      // Fewest exact hits first, then fewest near ones, then along the molecule.
      list.sort((a, b) => {
        for (let i = 0; i < Math.max(a.offTargets.length, b.offTargets.length); i++) {
          const d = (a.offTargets[i] ?? 0) - (b.offTargets[i] ?? 0);
          if (d !== 0) return d;
        }
        return a.range.start - b.range.start;
      });
    }
    return list;
  }, [guides, sortBy]);

  const covered = sorted.filter(
    (g) => selection !== null && g.range.start === selection.start && g.range.end === selection.end,
  );
  const selected = covered.find((g) => guideId(g) === clicked) ?? covered[0] ?? null;

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

  const scheme = OLIGO_SCHEMES.find((s) => s.id === schemeId) ?? OLIGO_SCHEMES[0];
  const oligos =
    selected !== null && scheme !== undefined ? guideOligos(selected.spacer, scheme) : null;

  return (
    <div className="panel">
      <div className="panel__controls">
        <label className="panel__field">
          Nuclease
          <select
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
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={inSelection}
            disabled={selection === null || isEmptyRange(selection)}
            onChange={(e) => {
              setInSelection(e.target.checked);
            }}
          />
          Only cuts in the selection
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={searchOthers}
            onChange={(e) => {
              setSearchOthers(e.target.checked);
            }}
          />
          Count off-targets in the other open documents too
        </label>
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
        ) : sorted.length === 0 ? (
          <p className="panel__note">
            No guides{region !== null ? ' cutting in the selection' : ''}. Another nuclease or a
            custom PAM may find some.
          </p>
        ) : (
          <>
            <h3 className="panel__heading">
              Guides
              <span className="panel__heading-note">{sorted.length.toLocaleString()}</span>
            </h3>
            <ul className="crispr-list">
              {sorted.slice(0, MAX_PREVIEWED).map((g) => {
                const warning = warningOf(g);
                const active = selected !== null && guideId(g) === guideId(selected);
                return (
                  <li key={guideId(g)}>
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
                      <span className="crispr-row__gc">{Math.round(g.gc * 100)}% GC</span>
                      <span className="crispr-row__off" title="Exact, then by mismatch">
                        {offTargetSummary(g)}
                      </span>
                      {warning !== null && (
                        <span className="crispr-row__warning" title={warning}>
                          !
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {sorted.length > MAX_PREVIEWED && (
              <p className="panel__note">
                Showing the first {MAX_PREVIEWED} of {sorted.length.toLocaleString()}. Narrow the
                scan to a selection to see the rest.
              </p>
            )}
          </>
        ))}

      {selected !== null && (
        <div className="panel__section">
          <h3 className="panel__heading">Guide</h3>
          <dl className="crispr-detail">
            <dt>Protospacer</dt>
            <dd>
              {formatSpan(selected.range, doc.length)} ({selected.strand})
            </dd>
            <dt>Spacer</dt>
            <dd className="crispr-detail__mono">{selected.spacer}</dd>
            <dt>PAM</dt>
            <dd className="crispr-detail__mono">{selected.pam}</dd>
            <dt>Cut</dt>
            <dd>
              {selected.cut.forward === selected.cut.reverse
                ? `blunt, after base ${selected.cut.forward.toLocaleString()}`
                : `after base ${selected.cut.forward.toLocaleString()} on the top strand and ${selected.cut.reverse.toLocaleString()} on the bottom`}
            </dd>
            <dt>GC</dt>
            <dd>{Math.round(selected.gc * 100)}%</dd>
            <dt>Flags</dt>
            <dd>
              {[
                selected.polyT ? 'TTTT (U6 terminator)' : null,
                selected.longestRun >= HOMOPOLYMER_FLAG
                  ? `${String(selected.longestRun)} of one base in a row`
                  : null,
                selected.gc < GC_LOW ? 'low GC' : selected.gc > GC_HIGH ? 'high GC' : null,
              ]
                .filter((x) => x !== null)
                .join('; ') || 'none'}
            </dd>
          </dl>

          {selected.sites.length > 0 && (
            <>
              <h3 className="panel__heading">
                Other sites
                <span className="panel__heading-note">
                  {selected.offTargets.reduce((a, b) => a + b, 0).toLocaleString()}
                </span>
              </h3>
              <ul className="crispr-sites">
                {selected.sites.map((s) => {
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

          <h3 className="panel__heading">Oligos to order</h3>
          <label className="panel__field">
            Overhangs
            <select
              value={schemeId}
              onChange={(e) => {
                setSchemeId(e.target.value);
              }}
            >
              {OLIGO_SCHEMES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {oligos !== null && (
            <>
              <p className="panel__protein">
                <span className="crispr-oligo">{oligos.top}</span>
                <span className="crispr-oligo">{oligos.bottom}</span>
              </p>
              <div className="panel__buttons">
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
                    analytics.track('crispr', 'oligos', schemeId);
                    const at = (selected.range.start + 1).toLocaleString();
                    void savePrimers(
                      [
                        {
                          name: `guide ${at} top`,
                          sequence: oligos.top,
                          notes: `CRISPR guide oligo, ${selected.pam} PAM`,
                        },
                        {
                          name: `guide ${at} bottom`,
                          sequence: oligos.bottom,
                          notes: `CRISPR guide oligo, ${selected.pam} PAM`,
                        },
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
                  Save oligos to My primers
                </button>
                <button
                  type="button"
                  className="button button--small"
                  onClick={() => {
                    analytics.track('crispr', 'add');
                    const feature = createFeature({
                      type: 'misc_feature',
                      name: `guide ${(selected.range.start + 1).toLocaleString()}`,
                      strand: selected.strand,
                      segments: [rangeSegment(selected.range.start, selected.range.end)],
                      qualifiers: [
                        { name: 'note', value: `CRISPR protospacer, ${selected.pam} PAM` },
                      ],
                    });
                    editorStore.apply({ type: 'addFeature', feature }, selected.range);
                    editorStore.requestRename(feature.id);
                    editorStore.setSidebarTab('features');
                  }}
                >
                  Add as feature
                </button>
              </div>
              {saved !== null && <p className="panel__note">{saved}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
