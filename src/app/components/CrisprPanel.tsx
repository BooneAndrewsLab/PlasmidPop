import { useEffect, useRef } from 'react';

import { type SeqDocument, supportsNickPairs, supportsPrimeEditing } from '@/core';

import { type CrisprPage, openCrisprWorkspace, takeCrisprFocusRequest } from '../crisprWorkspace';
import { useEditorState } from '../state/useEditorStore';
import { GuideRow, NucleaseControls, RegionControl } from './CrisprGuideList';
import { SCAN_ADVICE, SCAN_SLOW, addGuideAsFeature, guideId, useCrisprScan } from './crisprScan';
import { RunNotices } from './RunNotices';

interface Props {
  readonly doc: SeqDocument;
}

/** The id the workspace's Escape hands the keyboard back to (item 107, point 1). */
export const MORE_BUTTON_ID = 'crispr-workspace-open';

/** The rows the tab lists; the rest of the guides are the workspace's. */
const MAX_ROWS = 8;

/**
 * The slim CRISPR tab (item 133, C3): the nuclease, the region, a line on
 * what was found, the first few guides, and doors. The full list with its
 * filters and off-target options, the guide's details and oligos, base
 * editing, the paired nickases and prime editing are the CRISPR workspace's,
 * a link away; the two share one `useCrisprScan`, so a scan, a filter or a
 * clicked guide is the same in both.
 */
export function CrisprPanel({ doc }: Props) {
  const scan = useCrisprScan(doc);
  const {
    guides,
    nuclease,
    problem,
    error,
    stopped,
    scanning,
    sorted,
    clean,
    region,
    selected,
    selectedId,
  } = scan;
  const { documentId } = useEditorState();
  const more = useRef<HTMLButtonElement>(null);
  // The workspace shut with Escape: the keyboard comes back here.
  useEffect(() => {
    if (takeCrisprFocusRequest()) more.current?.focus();
  }, []);
  // No page is the one it was left on; the page doors name theirs.
  const open = (page?: CrisprPage): void => {
    openCrisprWorkspace(documentId, page);
  };

  const rows = sorted.slice(0, MAX_ROWS);
  // A guide clicked on the map may lie past the first rows: it is shown too,
  // so its actions are not lost.
  if (selected !== null && !rows.some((g) => guideId(g) === selectedId)) rows.push(selected);

  let status: string;
  if (problem !== null || error !== null || stopped !== null) status = '';
  else if (scanning && guides === null) status = 'Looking for guides…';
  else if (guides === null || guides.length === 0) {
    status = `No guides${region !== null ? ' cutting in the selection' : ''}. Another nuclease or a custom PAM may find some.`;
  } else {
    status = `${guides.length.toLocaleString()} ${guides.length === 1 ? 'guide' : 'guides'}, ${clean.toLocaleString()} without flags.`;
    if (sorted.length === 0) status += ' None match the filters.';
    else if (sorted.length > MAX_ROWS) status += ` The first ${String(MAX_ROWS)} are listed.`;
  }

  return (
    <div className="panel">
      <div className="panel__controls">
        <NucleaseControls scan={scan} />
        <RegionControl doc={doc} scan={scan} />
      </div>
      {problem !== null && <p className="panel__note panel__note--warn">{problem}</p>}
      <RunNotices
        error={error}
        stopped={stopped}
        slow={scan.slow}
        busy={scanning}
        retry={scan.retry}
        advice={SCAN_ADVICE}
        slowText={SCAN_SLOW}
      />
      <p className="panel__note" role="status">
        {status}
      </p>
      {rows.length > 0 && (
        <ul className="crispr-list">
          {rows.map((g) => {
            const active = guideId(g) === selectedId;
            return (
              <li key={guideId(g)}>
                <GuideRow guide={g} active={active} scan={scan} />
                {active && (
                  <div className="crispr-actions">
                    <button
                      type="button"
                      className="button button--small"
                      onClick={() => {
                        addGuideAsFeature(g);
                      }}
                    >
                      Add as feature
                    </button>
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      data-tip="This guide's details and oligos, in the CRISPR workspace"
                      onClick={() => {
                        // A guide clicked on the map is the one open there too.
                        scan.set({ clicked: guideId(g) });
                        open('guides');
                      }}
                    >
                      Details ›
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="panel__links">
        <button
          type="button"
          id={MORE_BUTTON_ID}
          ref={more}
          className="link panel__door"
          data-tip="The guide list on a page of its own, with the paired nickases and prime editing: the CRISPR workspace"
          onClick={() => {
            open();
          }}
        >
          Open CRISPR workspace ›
        </button>
        {nuclease !== null && supportsNickPairs(nuclease) && (
          <button
            type="button"
            className="link panel__door"
            data-tip="Pairs of guides whose nicks make a staggered break"
            onClick={() => {
              open('pairs');
            }}
          >
            Paired nickases ›
          </button>
        )}
        {nuclease !== null && supportsPrimeEditing(nuclease) && (
          <button
            type="button"
            className="link panel__door"
            data-tip="pegRNAs for an edit near a nick"
            onClick={() => {
              open('prime');
            }}
          >
            Prime editing ›
          </button>
        )}
      </div>
    </div>
  );
}
