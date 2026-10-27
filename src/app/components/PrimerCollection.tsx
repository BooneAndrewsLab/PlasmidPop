import { useEffect, useMemo, useRef, useState } from 'react';
import { pickerAccept } from '../pickerAccept';

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
  type ParsedPrimerList,
  parsePrimerList,
  parsePrimerWorkbook,
  primerFromFeature,
  rangeSegment,
  writePrimerCsv,
  writePrimerFasta,
} from '@/core';
import { readTableFile } from '@/io';
import { type OverlaySpan } from '@/view/overlay';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { PRIMER_BLAST_SENDS, primerBlastUrl } from '../primerBlast';
import { type PcrSlot, openPcr, pcrChoice, sendToPcr } from '../primerToPcr';
import { downloadText } from '../saveFile';
import { editorStore } from '../state/editorStore';
import { addFeaturesAsOneStep } from '../state/featureSteps';
import { useRemembered } from '../state/panelMemory';
import {
  type AddReport,
  primerCollection,
  savePrimers,
  usePrimerCollection,
} from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import {
  type CollectionSort,
  type CollectionSortKey,
  DEFAULT_COLLECTION_SORT,
  collectionTm,
  sortCollection,
} from './collectionSort';
import { SortTh } from './SortTh';
import { toggleSort } from './tableKeys';

/**
 * My primers (#64, item 56; a table since item 107): the collection kept
 * in this browser, and "Find in" the document in front.
 *
 * The search is PCR's own annealing search run over the collection, so a
 * primer found here is one PCR would anneal, tail and all; it runs in the
 * analysis worker, since a lab's list is hundreds of oligos. What it finds
 * is a preview, as the designed pairs are: nothing is in the document
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
 * What **Shortest site** offers (#96). Under 10 nt a site is a word that
 * turns up by chance in a plasmid (a 10-mer about once in a million bases,
 * an 8-mer once in 65 kb), and the exact 3′ anchor is 5 of them.
 */
const MIN_ANNEAL_CHOICES = [10, 12, 15, 18, 20] as const;

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

/**
 * The files the import offers (#151): text lists and `.xlsx` workbooks, and
 * `.xls`/`.ods` too, so that picking one says how to convert it rather than
 * the picker greying it out without a word.
 */
const PRIMER_FILE_ACCEPT = '.csv,.tsv,.txt,.fasta,.fa,.fas,.fna,.xlsx,.xls,.ods';

/** What a skipped place is called: a line of text, or a row of a workbook's sheet. */
type SkippedIn = 'line' | 'row';

function sayAdded(
  report: AddReport,
  skippedLines: readonly number[] = [],
  unit: SkippedIn = 'line',
): string {
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
      `${skippedLines.length === 1 ? unit : `${unit}s`} ${shown}${skippedLines.length > 5 ? '…' : ''} held no primer`,
    );
  }
  return `${parts.join('; ')}.`;
}

/** The bases typed into an edit, or what they were when nothing is left of them. */
function cleanOr(typed: string, was: string): string {
  const bases = cleanPrimer(typed);
  return bases === '' ? was : bases;
}

/** One primer as a row of the table: its columns, or the three boxes while it is being edited. */
function PrimerRow({
  primer,
  picked,
  onPick,
  onPcr,
}: {
  readonly primer: CollectionPrimer;
  readonly picked: boolean;
  readonly onPick: (on: boolean) => void;
  readonly onPcr: (slot: PcrSlot, primer: CollectionPrimer) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(primer.name);
  const [sequence, setSequence] = useState(primer.sequence);
  const [notes, setNotes] = useState(primer.notes);
  const pick = (
    <td className="mine__pick">
      <input
        type="checkbox"
        aria-label={`Pick ${primer.name} for a pair`}
        checked={picked}
        onChange={(e) => {
          onPick(e.target.checked);
        }}
      />
    </td>
  );
  if (editing) {
    return (
      <tr className="mine__row mine__row--editing">
        {pick}
        <td>
          <input
            className="panel__search"
            aria-label="Primer name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </td>
        <td colSpan={3}>
          <input
            className="panel__search panel__mono-input"
            aria-label="Primer bases"
            spellCheck={false}
            value={sequence}
            onChange={(e) => {
              setSequence(e.target.value);
            }}
          />
        </td>
        <td>
          <input
            className="panel__search"
            aria-label="Primer notes"
            placeholder="Notes"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </td>
        <td className="mine__acts">
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
        </td>
      </tr>
    );
  }
  // The Tm a scientist checks before ordering, at the Primers tab's
  // conditions; a degenerate primer has none and shows its length alone.
  const tm = collectionTm(primer);
  return (
    <tr className={`mine__row${picked ? ' is-picked' : ''}`}>
      {pick}
      <td className="mine__name">{primer.name}</td>
      <td className="panel__mono wst__seq">{primer.sequence}</td>
      <td className="wst__n">{primer.sequence.length}</td>
      <td className="wst__n">{tm === null ? '–' : tm.toFixed(1)}</td>
      <td className="mine__notes" data-tip={primer.notes === '' ? undefined : primer.notes}>
        {primer.notes}
      </td>
      <td className="mine__acts">
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
          data-tip="Put this primer in PCR's forward slot"
          onClick={() => {
            onPcr('forward', primer);
          }}
        >
          PCR fwd
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          data-tip="Put this primer in PCR's reverse slot"
          onClick={() => {
            onPcr('reverse', primer);
          }}
        >
          PCR rev
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
      </td>
    </tr>
  );
}

export function PrimerCollection({ doc }: { readonly doc: SeqDocument }) {
  const { primers, status, error } = usePrimerCollection();
  const { documentId } = useEditorState();
  const [filter, setFilter] = useState('');
  const [single, setSingle] = useState({ name: '', sequence: '', notes: '' });
  const [pasted, setPasted] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The table's order is the user's, from plasmid to plasmid.
  const [sort, setSort] = useRemembered<CollectionSort>(
    'collection.sort',
    null,
    DEFAULT_COLLECTION_SORT,
  );
  /** The primers ticked for a pair: two make one, forward first (item 107, #298). */
  const [picked, setPicked] = useState<readonly string[]>([]);
  // Whether Find is on for this document, and how strict it is, kept with
  // the rest of the tab's state per document (#32).
  const [finding, setFinding] = useRemembered('collection.finding', documentId, false);
  const [maxMismatches, setMaxMismatches] = useRemembered(
    'collection.mismatches',
    documentId,
    ANNEAL_DEFAULTS.maxMismatches,
  );
  // Shorter primers are listed but not searched unless this is lowered (#96).
  const [minAnneal, setMinAnneal] = useRemembered(
    'collection.minAnneal',
    documentId,
    ANNEAL_DEFAULTS.minAnneal,
  );
  /** The last answer, with what it was asked about, so a stale one is never shown. */
  const [search, setSearch] = useState<{
    readonly doc: SeqDocument;
    readonly primers: readonly CollectionPrimer[];
    readonly maxMismatches: number;
    readonly minAnneal: number;
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
    const asked = { doc, primers, maxMismatches, minAnneal };
    analysisClient
      .findPrimers(doc.sequence.toString(), doc.topology, primers, { maxMismatches, minAnneal })
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
  }, [finding, doc, primers, maxMismatches, minAnneal]);

  const answered =
    finding &&
    search !== null &&
    search.doc === doc &&
    search.primers === primers &&
    search.maxMismatches === maxMismatches &&
    search.minAnneal === minAnneal
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
    const bases = cleanPrimer(q);
    const matching =
      q === ''
        ? primers
        : primers.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.notes.toLowerCase().includes(q) ||
              (bases.length >= 4 && p.sequence.includes(bases)),
          );
    return sortCollection(matching, sort);
  }, [primers, filter, sort]);
  const docPrimers = useMemo(
    () => doc.features.all().filter((f) => f.type === 'primer_bind'),
    [doc],
  );
  // A primer deleted or never there drops out of the pick.
  const pair = picked
    .map((id) => byId.get(id))
    .filter((p): p is CollectionPrimer => p !== undefined);
  const bound = useMemo(() => new Set(hits.map((h) => h.primerId)).size, [hits]);

  const toPcr = (slot: PcrSlot, primer: { name: string; sequence: string }): void => {
    analytics.track('primers', 'to-pcr');
    sendToPcr(documentId, slot, primer);
    setPcrSent((n) => n + 1);
  };

  const addParsed = async (
    parsed: ParsedPrimerList,
    source: 'paste' | 'file',
    unit: SkippedIn = 'line',
    lead = '',
  ): Promise<void> => {
    setFileError(null);
    const report = await savePrimers(parsed.primers, source);
    setSaid(lead + sayAdded(report, parsed.skipped, unit));
    if (report.added.length > 0 && source === 'paste') setPasted('');
  };

  /**
   * A file is read by what its bytes are, not by its name (#151): a
   * workbook's first sheet that holds primers, or text as pasted text is.
   */
  const addFile = async (file: File): Promise<void> => {
    try {
      const read = await readTableFile(new Uint8Array(await file.arrayBuffer()));
      if (read.kind === 'text') {
        await addParsed(parsePrimerList(read.text), 'file');
        return;
      }
      const parsed = parsePrimerWorkbook(read.sheets);
      const lead = read.sheets.length > 1 ? `From sheet “${parsed.sheet}”: ` : '';
      await addParsed(parsed, 'file', 'row', lead);
    } catch (e) {
      setSaid(null);
      setFileError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const download = (format: 'csv' | 'fasta'): void => {
    analytics.track('primers', 'collection-export', format);
    downloadText(
      format === 'csv' ? 'primers.csv' : 'primers.fasta',
      format === 'csv' ? writePrimerCsv(primers) : writePrimerFasta(primers),
    );
  };

  const onSort = (key: CollectionSortKey): void => {
    setSort((s) => toggleSort(s, key));
  };

  return (
    <div className="mine">
      {status === 'failed' && (
        <p className="panel__error">
          This browser&rsquo;s storage could not be read, so the list lasts only until the page is
          closed. Download it to keep it.
        </p>
      )}
      {error !== null && <p className="panel__error">{error}</p>}

      <div className="filters">
        <input
          className="panel__search results__filter"
          type="search"
          placeholder="Filter name, notes, bases"
          aria-label="Filter primers"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
        <label
          className="chk"
          data-tip="Search the document for every primer of the list, both strands, by the 3′ end"
        >
          <input
            type="checkbox"
            checked={finding}
            disabled={primers.length === 0}
            onChange={(e) => {
              if (e.target.checked) analytics.track('primers', 'find-mine');
              setFinding(e.target.checked);
            }}
          />
          Find in {doc.name}
        </label>
        {finding && (
          <>
            <label className="chk">
              Mismatches
              <select
                className="panel__select"
                aria-label="Mismatches allowed"
                data-tip={`Before the last ${ANNEAL_DEFAULTS.exactThreePrime} bases, which must match`}
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
            <label className="chk">
              Shortest site
              <select
                className="panel__select"
                aria-label="Shortest site searched"
                data-tip="The fewest bases a primer must anneal by to be called a site; shorter primers are not searched"
                value={minAnneal}
                onChange={(e) => {
                  setMinAnneal(Number(e.target.value));
                }}
              >
                {MIN_ANNEAL_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n} nt{n === ANNEAL_DEFAULTS.minAnneal ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {current !== null && (
              <span className="dnote" role="status">
                {bound} of {primers.length} bind
              </span>
            )}
          </>
        )}
      </div>

      {primers.length === 0 && status === 'ready' ? (
        <p className="panel__note">
          No primers yet. Add them under <strong>Add primers</strong> below, save a designed pair or
          a checked primer, or take this document&rsquo;s primer_bind features.
        </p>
      ) : (
        <div className="tablewrap mine__wrap">
          <table className="wst mine__table" aria-label="My primers">
            <thead>
              <tr>
                <th className="wst__th mine__pick">
                  <span className="visually-hidden">Pick for a pair</span>
                </th>
                <SortTh column="name" sort={sort} onSort={onSort}>
                  Name
                </SortTh>
                <SortTh column="bases" sort={sort} onSort={onSort}>
                  Bases 5′→3′
                </SortTh>
                <SortTh column="nt" sort={sort} onSort={onSort} numeric tip="Length">
                  nt
                </SortTh>
                <SortTh
                  column="tm"
                  sort={sort}
                  onSort={onSort}
                  numeric
                  tip="Melting temperature, °C"
                >
                  Tm
                </SortTh>
                <SortTh column="notes" sort={sort} onSort={onSort}>
                  Notes
                </SortTh>
                <th className="wst__th mine__acts">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <PrimerRow
                  key={p.id}
                  primer={p}
                  picked={picked.includes(p.id)}
                  onPick={(on) => {
                    setPicked((ids) => (on ? [...ids, p.id] : ids.filter((id) => id !== p.id)));
                  }}
                  onPcr={toPcr}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filter.trim() !== '' && shown.length === 0 && (
        <p className="panel__note panel__note--quiet">No primer matches.</p>
      )}
      {pair.length > 0 && (
        <div className="actions mine__pair" role="group" aria-label="Picked pair">
          {pair.length === 2 ? (
            <>
              <span className="dnote">
                Pair: <strong>{pair[0]?.name}</strong> → · <strong>{pair[1]?.name}</strong> ←
              </span>
              <a
                className="button button--small"
                href={primerBlastUrl({
                  forward: pair[0]?.sequence ?? '',
                  reverse: pair[1]?.sequence ?? '',
                })}
                target="_blank"
                rel="noopener noreferrer"
                data-tip={PRIMER_BLAST_SENDS}
                onClick={() => {
                  analytics.track('primers', 'primer-blast');
                }}
              >
                Check specificity…
              </a>
              <button
                type="button"
                className="button button--quiet button--small"
                data-tip="The other way round: the second as the forward primer"
                onClick={() => {
                  setPicked((ids) => [...ids].reverse());
                }}
              >
                Swap
              </button>
              <button
                type="button"
                className="button button--quiet button--small"
                data-tip="Put the pair in PCR's two slots"
                onClick={() => {
                  const [f, r] = pair;
                  if (f !== undefined) toPcr('forward', f);
                  if (r !== undefined) toPcr('reverse', r);
                }}
              >
                Use in PCR
              </button>
            </>
          ) : (
            <span className="dnote">
              {pair.length === 1
                ? 'Tick one more primer for a pair: forward first, then reverse.'
                : `${pair.length} ticked; a pair is two.`}
            </span>
          )}
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              setPicked([]);
            }}
          >
            Clear
          </button>
        </div>
      )}
      {finding && primers.length > 0 && (
        <FindResults
          doc={doc}
          result={current}
          error={searchError}
          byId={byId}
          maxMismatches={maxMismatches}
          minAnneal={minAnneal}
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

      <details className="panel__details primer-collection__add">
        <summary className="panel__details-summary">
          <span className="panel__details-title">Add primers</span>
          <span className="panel__details-note">one, a pasted list or a file</span>
        </summary>
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
            placeholder={
              'FASTA, CSV (name,sequence,notes),\nor one sequence per line;\nor drop a file here'
            }
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
            }}
            // A file dropped here is imported, rather than opened as a tab (#151);
            // dragged text is still dropped in as text.
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault();
            }}
            onDrop={(e) => {
              const file = e.dataTransfer.files[0];
              if (file === undefined) return;
              e.preventDefault();
              void addFile(file);
            }}
          />
        </label>
        <div className="panel__controls">
          <button
            type="button"
            className="button button--small"
            disabled={pasted.trim() === ''}
            onClick={() => {
              void addParsed(parsePrimerList(pasted), 'paste');
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
            accept={pickerAccept(PRIMER_FILE_ACCEPT)}
            aria-label="Primer list file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file !== undefined) void addFile(file);
            }}
          />
          {docPrimers.length > 0 && (
            <button
              type="button"
              className="button button--quiet button--small"
              data-tip="Add every primer_bind feature of this document to the list"
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
      {fileError !== null && <p className="panel__error">{fileError}</p>}
      {said !== null && (
        <p className="panel__note panel__note--quiet" role="status">
          {said}
        </p>
      )}

      {primers.length > 0 && (
        <div className="actions mine__foot">
          <button
            type="button"
            className="button button--quiet button--small"
            data-tip="name,sequence,notes — reads back exactly"
            onClick={() => {
              download('csv');
            }}
          >
            Download CSV
          </button>
          <button
            type="button"
            className="button button--quiet button--small"
            data-tip="One >name notes record a primer"
            onClick={() => {
              download('fasta');
            }}
          >
            Download FASTA
          </button>
          <span className="actions__gap" />
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
    </div>
  );
}

function FindResults({
  doc,
  result,
  error,
  byId,
  maxMismatches,
  minAnneal,
  onPcr,
}: {
  readonly doc: SeqDocument;
  readonly result: PrimerSearch | null;
  readonly error: string | null;
  readonly byId: ReadonlyMap<string, CollectionPrimer>;
  readonly maxMismatches: number;
  readonly minAnneal: number;
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
    <div className="mine__sites">
      <div className="subhead">
        Sites on {doc.name}
        <span className="dnote">
          {hits.length === 0
            ? `None of them binds ${doc.name} (${rule}).`
            : `${bound.toLocaleString()} ${bound === 1 ? 'primer binds' : 'primers bind'} at ${hits.length.toLocaleString()} ${hits.length === 1 ? 'site' : 'sites'} (${rule}):`}
        </span>
      </div>
      {tooShort.length > 0 && (
        <p className="panel__note panel__note--quiet">
          {tooShort.length === 1 ? 'One primer is' : `${tooShort.length} primers are`} shorter than
          the {minAnneal} bases a site needs and {tooShort.length === 1 ? 'was' : 'were'} not
          searched; lower <strong>Shortest site</strong> to search{' '}
          {tooShort.length === 1 ? 'it' : 'them'}.
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
                data-tip="Select the bases it anneals to"
                onClick={() => {
                  editorStore.setSelection(h.range);
                  editorStore.revealPosition(h.range.start);
                }}
              >
                <span className="orf-row__strand">{h.strand === 'forward' ? '→' : '←'}</span>
                <span className="hit-row__text">
                  <span className="hit-row__name">{h.name}</span>
                  <span className="orf-row__length">
                    {describeRange(h, doc.length)} · {describeFit(h)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="button button--quiet button--small"
                data-tip="Annotate this site as a primer_bind feature"
                onClick={() => {
                  addFeaturesAsOneStep([hitFeature(h, byId.get(h.primerId))]);
                }}
              >
                Add
              </button>
              <button
                type="button"
                className="button button--quiet button--small"
                data-tip={`Use as PCR's ${h.strand} primer`}
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
    </div>
  );
}
