import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type CollectionPrimer,
  type Feature,
  type PrimerDraft,
  type PrimerHit,
  type PrimerSearch,
  type SeqDocument,
  ANNEAL_DEFAULTS,
  cleanPrimer,
  createFeature,
  mismatchPositions,
  newId,
  parsePrimerList,
  primerFromFeature,
  rangeSegment,
  writePrimerCsv,
  writePrimerFasta,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { type PcrSlot, openPcr, pcrChoice, sendToPcr } from '../primerToPcr';
import { downloadText } from '../saveFile';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import {
  type AddReport,
  primerCollection,
  savePrimers,
  usePrimerCollection,
} from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';

/**
 * My primers (#64, item 56): the collection kept in this browser, and
 * "Find my primers" on the document in front.
 *
 * The search is PCR's own annealing search run over the collection, so a
 * primer found here is one PCR would anneal, tail and all; it runs in the
 * analysis worker, since a lab's list is hundreds of oligos. What it finds
 * is a preview, as the designed pairs above are: nothing is in the document
 * until **Add** makes a `primer_bind` feature of a site, which is an edit
 * and can be undone.
 */

/** Longest list of hits drawn and listed; a primer inside a repeat can bind a great many times. */
const MAX_HITS_SHOWN = 200;

const NO_HITS: readonly PrimerHit[] = [];

/** Where a hit is, 1-based and inclusive, the way the rest of the tab writes a site. */
function describeRange(hit: PrimerHit, seqLength: number): string {
  const from = hit.range.start + 1;
  const to = ((hit.range.end - 1) % Math.max(1, seqLength)) + 1;
  return `${from.toLocaleString()}–${to.toLocaleString()}`;
}

function describeFit(hit: PrimerHit): string {
  const parts = [hit.mismatches === 0 ? 'exact' : `${hit.mismatches} mm`];
  if (hit.tail.length > 0) parts.push(`${hit.tail.length} nt tail`);
  return parts.join(', ');
}

/** A hit as the feature **Add** makes of it: the annealed bases, the whole oligo in a note. */
function hitFeature(hit: PrimerHit, primer: CollectionPrimer | undefined): Feature {
  const notes = [{ name: 'note', value: `sequence: ${hit.primer}` }];
  if (primer !== undefined && primer.notes !== '')
    notes.push({ name: 'note', value: primer.notes });
  return createFeature({
    type: 'primer_bind',
    name: hit.name,
    strand: hit.strand,
    segments: [rangeSegment(hit.range.start, hit.range.end)],
    qualifiers: notes,
  });
}

/**
 * Adds features as one undo step: each after the first merges into the step
 * before it, so **Add all** is taken back by one Undo.
 */
function addFeaturesAsOneStep(features: readonly Feature[]): void {
  const run = `primer-sites:${newId()}`;
  features.forEach((feature, i) => {
    editorStore.apply({ type: 'addFeature', feature }, undefined, undefined, {
      follows: i === 0 ? `${run}:start` : run,
      key: run,
      withinMs: 60_000,
      relabel: (n) => `Add ${n} primer sites`,
    });
  });
}

function hitSpans(hits: readonly PrimerHit[], template: string): OverlaySpan[] {
  return hits.slice(0, MAX_HITS_SHOWN).map((h, i) => ({
    id: `hit-${i}`,
    label: h.mismatches === 0 ? h.name : `${h.name} (${h.mismatches} mm)`,
    range: h.range,
    strand: h.strand,
    shape: 'arrow' as const,
    ...(h.mismatches === 0 ? {} : { marks: mismatchPositions(template, h, h.primer) }),
  }));
}

function sayAdded(report: AddReport, skippedLines: readonly number[] = []): string {
  const parts: string[] = [];
  const n = report.added.length;
  parts.push(n === 0 ? 'No primer added' : `Added ${n} ${n === 1 ? 'primer' : 'primers'}`);
  if (report.duplicates > 0) {
    parts.push(
      `${report.duplicates} already in the list under the same name ${report.duplicates === 1 ? 'was' : 'were'} left out`,
    );
  }
  if (skippedLines.length > 0) {
    const shown = skippedLines.slice(0, 5).join(', ');
    parts.push(
      `${skippedLines.length === 1 ? 'line' : 'lines'} ${shown}${skippedLines.length > 5 ? '…' : ''} held no primer`,
    );
  }
  return `${parts.join('; ')}.`;
}

function PrimerRow({
  primer,
  onPcr,
}: {
  readonly primer: CollectionPrimer;
  readonly onPcr: (slot: PcrSlot, primer: CollectionPrimer) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(primer.name);
  const [sequence, setSequence] = useState(primer.sequence);
  const [notes, setNotes] = useState(primer.notes);
  if (editing) {
    return (
      <li className="primer-item primer-item--editing">
        <input
          className="panel__search"
          aria-label="Primer name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <input
          className="panel__search panel__mono-input"
          aria-label="Primer bases"
          spellCheck={false}
          value={sequence}
          onChange={(e) => {
            setSequence(e.target.value);
          }}
        />
        <input
          className="panel__search"
          aria-label="Primer notes"
          placeholder="Notes"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
        <span className="primer-item__buttons">
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              void primerCollection.update(primer.id, {
                name: name.trim() === '' ? primer.name : name.trim(),
                sequence: cleanOr(sequence, primer.sequence),
                notes: notes.trim(),
              });
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              setName(primer.name);
              setSequence(primer.sequence);
              setNotes(primer.notes);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </span>
      </li>
    );
  }
  return (
    <li className="primer-item">
      <span className="primer-item__name">{primer.name}</span>
      <span className="primer-item__meta">{primer.sequence.length} nt</span>
      <span className="pair__seq primer-item__seq">{primer.sequence}</span>
      {primer.notes !== '' && <span className="primer-item__notes">{primer.notes}</span>}
      <span className="primer-item__buttons">
        <button
          type="button"
          className="button button--quiet button--small"
          title="Put this primer in PCR's forward slot"
          onClick={() => {
            onPcr('forward', primer);
          }}
        >
          PCR fwd
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          title="Put this primer in PCR's reverse slot"
          onClick={() => {
            onPcr('reverse', primer);
          }}
        >
          PCR rev
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          aria-label={`Delete ${primer.name}`}
          onClick={() => {
            void primerCollection.remove([primer.id]);
          }}
        >
          Delete
        </button>
      </span>
    </li>
  );
}

/** The bases typed into an edit, or what they were when nothing is left of them. */
function cleanOr(typed: string, was: string): string {
  const bases = cleanPrimer(typed);
  return bases === '' ? was : bases;
}

export function PrimerCollection({ doc }: { readonly doc: SeqDocument }) {
  const { primers, status, error } = usePrimerCollection();
  const { documentId } = useEditorState();
  const [filter, setFilter] = useState('');
  const [single, setSingle] = useState({ name: '', sequence: '', notes: '' });
  const [pasted, setPasted] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Whether Find is on for this document, and how strict it is, kept with
  // the rest of the tab's state per document (#32).
  const [finding, setFinding] = useRemembered('collection.finding', documentId, false);
  const [maxMismatches, setMaxMismatches] = useRemembered(
    'collection.mismatches',
    documentId,
    ANNEAL_DEFAULTS.maxMismatches,
  );
  /** The last answer, with what it was asked about, so a stale one is never shown. */
  const [search, setSearch] = useState<{
    readonly doc: SeqDocument;
    readonly primers: readonly CollectionPrimer[];
    readonly maxMismatches: number;
    readonly result: PrimerSearch | null;
    readonly error: string | null;
  } | null>(null);
  // Bumped when a primer is put in a PCR slot, so the line saying what PCR
  // holds is read again from the panel's memory.
  const [pcrSent, setPcrSent] = useState(0);
  const pcr = useMemo(
    () => ({
      forward: pcrChoice(documentId, 'forward'),
      reverse: pcrChoice(documentId, 'reverse'),
      sent: pcrSent,
    }),
    [documentId, pcrSent],
  );

  // The search follows the document and the list: an edit, a primer added
  // or a limit changed runs it again, in the worker.
  useEffect(() => {
    if (!finding || primers.length === 0) return;
    let live = true;
    const asked = { doc, primers, maxMismatches };
    analysisClient
      .findPrimers(doc.sequence.toString(), doc.topology, primers, { maxMismatches })
      .then((result) => {
        if (live) setSearch({ ...asked, result, error: null });
      })
      .catch((e: unknown) => {
        if (live) {
          setSearch({ ...asked, result: null, error: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => {
      live = false;
    };
  }, [finding, doc, primers, maxMismatches]);

  const answered =
    finding &&
    search !== null &&
    search.doc === doc &&
    search.primers === primers &&
    search.maxMismatches === maxMismatches
      ? search
      : null;
  const current = answered?.result ?? null;
  const searchError = answered?.error ?? null;
  const hits = useMemo(() => current?.hits ?? NO_HITS, [current]);
  const spans = useMemo(() => hitSpans(hits, doc.sequence.toString()), [hits, doc]);
  useEffect(() => {
    editorStore.setPreview('collection', spans);
  }, [spans]);
  useEffect(
    () => () => {
      editorStore.clearPreview('collection');
    },
    [],
  );

  const byId = useMemo(() => new Map(primers.map((p) => [p.id, p])), [primers]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q === '') return primers;
    const bases = q.toUpperCase().replace(/[^ACGTRYSWKMBDHVN]/g, '');
    return primers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.notes.toLowerCase().includes(q) ||
        (bases.length >= 4 && p.sequence.includes(bases)),
    );
  }, [primers, filter]);
  const docPrimers = useMemo(
    () => doc.features.all().filter((f) => f.type === 'primer_bind'),
    [doc],
  );

  const toPcr = (slot: PcrSlot, primer: { name: string; sequence: string }): void => {
    analytics.track('primers', 'to-pcr');
    sendToPcr(documentId, slot, primer);
    setPcrSent((n) => n + 1);
  };

  const addText = async (text: string, source: 'paste' | 'file'): Promise<void> => {
    const parsed = parsePrimerList(text);
    const report = await savePrimers(parsed.primers, source);
    setSaid(sayAdded(report, parsed.skipped));
    if (report.added.length > 0 && source === 'paste') setPasted('');
  };

  const download = (format: 'csv' | 'fasta'): void => {
    analytics.track('primers', 'collection-export', format);
    downloadText(
      format === 'csv' ? 'primers.csv' : 'primers.fasta',
      format === 'csv' ? writePrimerCsv(primers) : writePrimerFasta(primers),
    );
  };

  return (
    <section className="panel__section primer-collection">
      <h3 className="panel__heading">
        My primers
        <span className="panel__heading-note">
          {status === 'loading' || status === 'unloaded'
            ? 'reading…'
            : `${primers.length.toLocaleString()} in this browser`}
        </span>
      </h3>
      {status === 'failed' && (
        <p className="panel__error">
          This browser&rsquo;s storage could not be read, so the list lasts only until the page is
          closed. Download it to keep it.
        </p>
      )}
      {error !== null && <p className="panel__error">{error}</p>}

      <div className="panel__controls">
        <label className="toggle">
          <input
            type="checkbox"
            checked={finding}
            disabled={primers.length === 0}
            onChange={(e) => {
              if (e.target.checked) analytics.track('primers', 'find-mine');
              setFinding(e.target.checked);
            }}
          />
          Find my primers in {doc.name}
        </label>
        <label className="panel__field panel__field--row">
          <span>Mismatches</span>
          <select
            className="panel__select"
            aria-label="Mismatches allowed"
            value={maxMismatches}
            onChange={(e) => {
              setMaxMismatches(Number(e.target.value));
            }}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'none' : `up to ${n}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {finding && primers.length > 0 && (
        <FindResults
          doc={doc}
          result={current}
          error={searchError}
          byId={byId}
          maxMismatches={maxMismatches}
          onPcr={toPcr}
        />
      )}
      {(pcr.forward !== null || pcr.reverse !== null) && (
        <p className="panel__note panel__note--quiet">
          PCR: forward {pcr.forward?.name ?? '—'}, reverse {pcr.reverse?.name ?? '—'}.{' '}
          <button type="button" className="link" onClick={openPcr}>
            Open PCR
          </button>
        </p>
      )}

      {primers.length > 8 && (
        <input
          className="panel__search"
          type="search"
          placeholder="Filter by name, notes or bases"
          aria-label="Filter primers"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
      )}
      {primers.length === 0 && status === 'ready' ? (
        <p className="panel__note">
          No primers yet. Add them one at a time, paste a list, save a designed pair or a checked
          primer, or take the primer_bind features of this document. The list stays in this browser;
          download it to back it up or to take it to another.
        </p>
      ) : (
        <ul className="primer-list" aria-label="My primers">
          {shown.map((p) => (
            <PrimerRow key={p.id} primer={p} onPcr={toPcr} />
          ))}
        </ul>
      )}
      {filter.trim() !== '' && shown.length === 0 && (
        <p className="panel__note panel__note--quiet">No primer matches.</p>
      )}

      <details className="primer-settings primer-collection__add">
        <summary>Add primers</summary>
        <div className="panel__field panel__field--stack">
          <span>One primer</span>
          <input
            className="panel__search"
            placeholder="Name"
            aria-label="New primer name"
            value={single.name}
            onChange={(e) => {
              setSingle((s) => ({ ...s, name: e.target.value }));
            }}
          />
          <input
            className="panel__search panel__mono-input"
            placeholder="Bases, 5′ to 3′"
            aria-label="New primer bases"
            spellCheck={false}
            value={single.sequence}
            onChange={(e) => {
              setSingle((s) => ({ ...s, sequence: e.target.value }));
            }}
          />
          <input
            className="panel__search"
            placeholder="Notes"
            aria-label="New primer notes"
            value={single.notes}
            onChange={(e) => {
              setSingle((s) => ({ ...s, notes: e.target.value }));
            }}
          />
          <button
            type="button"
            className="button button--small"
            disabled={single.sequence.trim() === ''}
            onClick={() => {
              void savePrimers([single], 'form').then((report) => {
                setSaid(sayAdded(report));
                if (report.added.length > 0) setSingle({ name: '', sequence: '', notes: '' });
              });
            }}
          >
            Add primer
          </button>
        </div>
        <label className="panel__field panel__field--stack">
          <span>Paste many</span>
          <textarea
            className="panel__textarea"
            rows={4}
            spellCheck={false}
            placeholder={'FASTA, CSV (name,sequence,notes),\nor one sequence per line'}
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
            }}
          />
        </label>
        <div className="panel__controls">
          <button
            type="button"
            className="button button--small"
            disabled={pasted.trim() === ''}
            onClick={() => {
              void addText(pasted, 'paste');
            }}
          >
            Add pasted
          </button>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => fileInput.current?.click()}
          >
            From a file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.fasta,.fa,.fas,.fna"
            aria-label="Primer list file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file !== undefined) void file.text().then((text) => addText(text, 'file'));
            }}
          />
          {docPrimers.length > 0 && (
            <button
              type="button"
              className="button button--quiet button--small"
              title="Add every primer_bind feature of this document to the list"
              onClick={() => {
                const drafts = docPrimers
                  .map((f) => primerFromFeature(doc, f))
                  .filter((d): d is PrimerDraft => d !== null);
                void savePrimers(drafts, 'document').then((report) => {
                  setSaid(sayAdded(report));
                });
              }}
            >
              From this document&rsquo;s primer_bind features ({docPrimers.length})
            </button>
          )}
        </div>
      </details>
      {said !== null && <p className="panel__note panel__note--quiet">{said}</p>}

      {primers.length > 0 && (
        <div className="panel__controls">
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              download('csv');
            }}
          >
            Download CSV
          </button>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              download('fasta');
            }}
          >
            Download FASTA
          </button>
          {confirmClear ? (
            <>
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  void primerCollection.remove(primers.map((p) => p.id));
                  setConfirmClear(false);
                }}
              >
                Delete all {primers.length}
              </button>
              <button
                type="button"
                className="button button--quiet button--small"
                onClick={() => {
                  setConfirmClear(false);
                }}
              >
                Keep them
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => {
                setConfirmClear(true);
              }}
            >
              Delete all…
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function FindResults({
  doc,
  result,
  error,
  byId,
  maxMismatches,
  onPcr,
}: {
  readonly doc: SeqDocument;
  readonly result: PrimerSearch | null;
  readonly error: string | null;
  readonly byId: ReadonlyMap<string, CollectionPrimer>;
  readonly maxMismatches: number;
  readonly onPcr: (slot: PcrSlot, primer: { name: string; sequence: string }) => void;
}) {
  if (error !== null) return <p className="panel__error">{error}</p>;
  if (result === null) return <p className="panel__note">Looking…</p>;
  const { hits, tooShort } = result;
  const bound = new Set(hits.map((h) => h.primerId)).size;
  const rule =
    maxMismatches === 0
      ? 'every annealed base matching'
      : `the last ${ANNEAL_DEFAULTS.exactThreePrime} bases exact, up to ${maxMismatches} ${maxMismatches === 1 ? 'mismatch' : 'mismatches'} before them`;
  return (
    <>
      <p className="panel__note">
        {hits.length === 0
          ? `None of them binds ${doc.name} (${rule}).`
          : `${bound.toLocaleString()} ${bound === 1 ? 'primer binds' : 'primers bind'} at ${hits.length.toLocaleString()} ${hits.length === 1 ? 'site' : 'sites'} (${rule}):`}
      </p>
      {tooShort.length > 0 && (
        <p className="panel__note panel__note--quiet">
          {tooShort.length === 1 ? 'One primer is' : `${tooShort.length} primers are`} shorter than
          the {ANNEAL_DEFAULTS.minAnneal} bases a site needs and{' '}
          {tooShort.length === 1 ? 'was' : 'were'} not searched.
        </p>
      )}
      {hits.length > 0 && (
        <ul className="orf-list" aria-label="Primer sites">
          {hits.slice(0, MAX_HITS_SHOWN).map((h) => (
            <li
              key={`${h.primerId}-${h.strand}-${h.range.start}-${h.range.end}`}
              className="hit-row"
            >
              <button
                type="button"
                className="orf-row"
                title="Select the bases it anneals to"
                onClick={() => {
                  editorStore.setSelection(h.range);
                  editorStore.revealPosition(h.range.start);
                }}
              >
                <span className="orf-row__strand">{h.strand === 'forward' ? '→' : '←'}</span>
                <span>
                  {h.name} <span className="orf-row__length">{describeRange(h, doc.length)}</span>
                </span>
                <span className="orf-row__length">{describeFit(h)}</span>
              </button>
              <button
                type="button"
                className="button button--quiet button--small"
                title="Annotate this site as a primer_bind feature"
                onClick={() => {
                  addFeaturesAsOneStep([hitFeature(h, byId.get(h.primerId))]);
                }}
              >
                Add
              </button>
              <button
                type="button"
                className="button button--quiet button--small"
                title={`Use as PCR's ${h.strand} primer`}
                onClick={() => {
                  const primer = byId.get(h.primerId);
                  if (primer !== undefined) onPcr(h.strand, primer);
                }}
              >
                PCR {h.strand === 'forward' ? 'fwd' : 'rev'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hits.length > MAX_HITS_SHOWN && (
        <p className="panel__note panel__note--quiet">
          The first {MAX_HITS_SHOWN} of {hits.length.toLocaleString()} are listed and drawn.
        </p>
      )}
      {hits.length > 0 && (
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            addFeaturesAsOneStep(
              hits.slice(0, MAX_HITS_SHOWN).map((h) => hitFeature(h, byId.get(h.primerId))),
            );
          }}
        >
          Add {Math.min(hits.length, MAX_HITS_SHOWN) === 1 ? 'site' : 'all sites'} as primer_bind
        </button>
      )}
    </>
  );
}
