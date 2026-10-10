import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type CloneInput,
  type CloneResult,
  type Construct,
  VERDICT_LABELS,
  describeResult,
  formatLength,
  verifyCsv,
} from '@/core';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { downloadText } from '../saveFile';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { CLONE_LIMIT, readCloneFiles, verifyPlate } from '../verifyClones';

/**
 * File ▸ Verify clones… (#218, item 80): a plate of whole-plasmid
 * sequencing consensuses checked against the constructs they should be. The
 * expected constructs are open tabs; each clone goes to the construct named
 * for it or else the one it resembles most, is lined up through the origin,
 * and the table says whether it matches, differs inside a feature, differs
 * only outside features, or is not that construct. A row opens the
 * comparison.
 */
export function VerifyClonesDialog() {
  const { verifyDialog } = useEditorState();
  return verifyDialog ? <VerifyClonesForm /> : null;
}

const VERDICT_CLASS: Readonly<Record<CloneResult['verdict'], string>> = {
  match: 'verify__verdict--match',
  'in-feature': 'verify__verdict--feature',
  outside: 'verify__verdict--outside',
  wrong: 'verify__verdict--wrong',
  failed: 'verify__verdict--wrong',
};

function VerifyClonesForm() {
  const { documents, documentId } = useEditorState();
  const dna = documents.filter((d) => !d.history.present.isProtein);
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        dna.some((d) => d.documentId === documentId) && documentId !== null ? [documentId] : [],
      ),
  );
  const [patterns, setPatterns] = useState<Readonly<Record<string, string>>>({});
  const [clones, setClones] = useState<readonly CloneInput[]>([]);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [results, setResults] = useState<readonly CloneResult[]>([]);
  /** The tabs the results were checked against, in the order `CloneResult.construct` counts. */
  const [used, setUsed] = useState<readonly string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = progress !== null;

  const close = useCallback((): void => {
    controller.current?.abort();
    editorStore.dismissVerifyClones();
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      // A comparison opened from a row is on top and has its own Escape.
      if (e.key === 'Escape' && editorStore.getState().comparison === null) close();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      controller.current?.abort();
    };
  }, [close]);

  const toggle = (id: string): void => {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addFiles = (files: FileList | null): void => {
    if (files === null || files.length === 0) return;
    void readCloneFiles([...files]).then((read) => {
      setClones((old) => [...old, ...read.clones]);
      setProblems(read.problems);
      setResults([]);
      setNote(null);
    });
  };

  const constructs: Construct[] = dna
    .filter((d) => picked.has(d.documentId))
    .map((d) => ({
      name: d.history.present.name,
      doc: d.history.present,
      pattern: patterns[d.documentId] ?? '',
    }));

  const run = (): void => {
    if (running || constructs.length === 0 || clones.length === 0) return;
    const mine = new AbortController();
    controller.current = mine;
    setResults([]);
    setNote(null);
    setProgress(0);
    setUsed(dna.filter((d) => picked.has(d.documentId)).map((d) => d.documentId));
    analytics.track('verify', 'run', constructs.length === 1 ? 'one' : 'several');
    verifyPlate(
      clones,
      constructs,
      (a, b, options, long) => analysisClient.alignEitherStrand(a, b, options, long),
      {
        signal: mine.signal,
        onProgress: (f) => {
          if (controller.current === mine) setProgress(f);
        },
        onResult: (r) => {
          if (controller.current === mine) setResults((old) => [...old, r]);
        },
      },
    )
      .then((outcome) => {
        if (controller.current !== mine) return;
        setNote(outcome.cancelled ? 'Cancelled; the clones checked so far are shown.' : null);
      })
      .catch((e: unknown) => {
        if (controller.current === mine) setNote(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (controller.current === mine) {
          controller.current = null;
          setProgress(null);
        }
      });
  };

  const stop = (): void => {
    controller.current?.abort();
  };

  const open = (i: number): void => {
    const result = results[i];
    const clone = clones[i];
    const tab = result?.construct == null ? undefined : used[result.construct];
    if (result === undefined || clone === undefined || tab === undefined) return;
    if (editorStore.getState().documents.every((d) => d.documentId !== tab)) return;
    analytics.track('verify', 'compare', result.verdict);
    editorStore.activateDocument(tab);
    editorStore.showComparison(clone.name, clone.doc, { kind: 'clone' });
  };

  const exportCsv = (): void => {
    analytics.track('verify', 'csv');
    downloadText('clone-verification.csv', verifyCsv(results));
  };

  const counts = new Map<CloneResult['verdict'], number>();
  for (const r of results) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide verify"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-title"
      >
        <h2 id="verify-title" className="dialog__title">
          Verify clones
        </h2>
        <p className="dialog__body">
          Check sequencing consensuses against the constructs they should be. Nothing leaves your
          browser, and no file is changed.
        </p>

        <h3 className="verify__heading">Expected constructs</h3>
        {dna.length === 0 ? (
          <p className="verify__empty">
            Open the construct (or several) each clone should be, then come back here.
          </p>
        ) : (
          <ul className="verify__constructs" aria-label="Expected constructs">
            {dna.map((d) => {
              const doc = d.history.present;
              return (
                <li key={d.documentId}>
                  <label className="verify__construct">
                    <input
                      type="checkbox"
                      checked={picked.has(d.documentId)}
                      disabled={running}
                      onChange={() => {
                        toggle(d.documentId);
                      }}
                    />{' '}
                    <span className="verify__construct-name">{doc.name}</span>
                    <span className="verify__meta">
                      {' '}
                      {formatLength(doc.length, doc.alphabet)}, {doc.topology}
                    </span>
                  </label>
                  {picked.has(d.documentId) && picked.size > 1 && (
                    <input
                      type="text"
                      className="verify__pattern"
                      aria-label={`File-name text that sends a clone to ${doc.name}`}
                      placeholder="file name contains… (optional)"
                      value={patterns[d.documentId] ?? ''}
                      disabled={running}
                      onChange={(e) => {
                        setPatterns((p) => ({ ...p, [d.documentId]: e.target.value }));
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <h3 className="verify__heading">Clones</h3>
        <div className="verify__files">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            aria-label="Clone sequence files"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="button"
            disabled={running}
            onClick={() => {
              fileRef.current?.click();
            }}
          >
            Add consensus files…
          </button>
          {clones.length > 0 && (
            <>
              <span className="verify__meta">
                {clones.length.toLocaleString()} clone{clones.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="button"
                disabled={running}
                onClick={() => {
                  setClones([]);
                  setResults([]);
                  setProblems([]);
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>
        {clones.length > CLONE_LIMIT && (
          <p className="verify__problem" role="alert">
            At most {CLONE_LIMIT} clones are checked at once; this has {clones.length}.
          </p>
        )}
        {problems.length > 0 && (
          <ul className="verify__problems" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        {results.length > 0 && (
          <>
            <p className="verify__summary" aria-live="polite">
              {(['match', 'in-feature', 'outside', 'wrong', 'failed'] as const)
                .filter((v) => counts.has(v))
                .map(
                  (v) =>
                    `${(counts.get(v) ?? 0).toLocaleString()} ${VERDICT_LABELS[v].toLowerCase()}`,
                )
                .join(', ')}
            </p>
            <div className="verify__scroll">
              <table className="verify__table">
                <thead>
                  <tr>
                    <th scope="col">Clone</th>
                    {used.length > 1 && <th scope="col">Construct</th>}
                    <th scope="col">Verdict</th>
                    <th scope="col">Identity</th>
                    <th scope="col">Differences</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={`${i.toString()}-${r.name}`}>
                      <th scope="row">
                        <button
                          type="button"
                          className="read-batch__pick"
                          disabled={r.construct === null}
                          title="Open the comparison with the construct"
                          onClick={() => {
                            open(i);
                          }}
                        >
                          {r.name}
                        </button>
                        <span className="read-batch__sub">
                          {r.length.toLocaleString()} bp
                          {r.strand === 'reverse' ? ', reverse strand' : ''}
                          {r.turned !== null && r.turned.origin > 0 ? ', rotated' : ''}
                        </span>
                      </th>
                      {used.length > 1 && (
                        <td>
                          {r.constructName}
                          {r.byName && (
                            <span className="verify__meta" title="Chosen by the file name">
                              {' '}
                              (by name)
                            </span>
                          )}
                        </td>
                      )}
                      <td className={VERDICT_CLASS[r.verdict]}>{VERDICT_LABELS[r.verdict]}</td>
                      <td>
                        {r.identity === null
                          ? '—'
                          : `${(Math.round(r.identity * 1000) / 10).toString()}%`}
                        {r.unchecked && (
                          <abbr title="Best within a band; not checked against the best possible alignment">
                            {' '}
                            *
                          </abbr>
                        )}
                      </td>
                      <td className="verify__details">
                        {r.verdict === 'match' ? '—' : describeResult(r)}
                        {r.ambiguous > 0 && (
                          <span className="verify__meta">
                            {' '}
                            ({r.ambiguous.toLocaleString()} ambiguous base
                            {r.ambiguous === 1 ? '' : 's'})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {running && (
          <progress className="verify__progress" max={1} value={progress} aria-label="Progress" />
        )}
        {note !== null && <p className="verify__problem">{note}</p>}

        <div className="dialog__actions">
          {results.length > 0 && (
            <button type="button" className="button" onClick={exportCsv}>
              Export CSV
            </button>
          )}
          {running ? (
            <button type="button" className="button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="button button--primary"
              disabled={
                constructs.length === 0 || clones.length === 0 || clones.length > CLONE_LIMIT
              }
              onClick={run}
            >
              Verify
            </button>
          )}
          <button type="button" className="button" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
