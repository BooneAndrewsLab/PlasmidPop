import { useEffect, useMemo, useRef } from 'react';

import { type SeqDocument, describeHost } from '@/core';

import { type EnzymePage, openEnzymeWorkspace, takeEnzymeFocusRequest } from '../enzymeWorkspace';
import { useEditorState } from '../state/useEditorStore';
import { useGelOptions } from '../state/useGel';
import { editorStore } from '../state/editorStore';
import { gelSentence, useEnzymeList } from './enzymeList';
import { EnzymeNotes, EnzymeRow, GrownIn } from './EnzymeListView';

interface Props {
  readonly doc: SeqDocument;
}

/** The id the workspace's Escape hands the keyboard back to (item 107, point 1). */
export const MORE_BUTTON_ID = 'enzyme-workspace-open';

/** Matches the tab lists for a search; the rest are "and N more" into the workspace. */
const MAX_MATCHES = 12;

/**
 * The slim Enzymes tab (item 133, E3): a filter, a line on what the
 * enzymes do to this DNA, the ticked rows, **Grown in**, and the gel in a
 * sentence. The full list, the digest with its gel, the double digests and
 * the table in use are the Enzyme workspace's, a link away; the two share
 * one `useEnzymeList`, so the ticks and the filter are the same in both.
 */
export function EnzymePanel({ doc }: Props) {
  const { documentId, shownEnzymes } = useEditorState();
  const gel = useGelOptions();
  const list = useEnzymeList(doc);
  const {
    filter,
    setFilter,
    needle,
    ready,
    groups,
    rows,
    tickedRows,
    fragments,
    ticked,
    pairable,
    cuts,
  } = list;
  const more = useRef<HTMLButtonElement>(null);
  // The workspace shut with Escape: the keyboard comes back here.
  useEffect(() => {
    if (takeEnzymeFocusRequest()) more.current?.focus();
  }, []);
  // No page is the one it was left on; "and N more" and the doors name theirs.
  const open = (page?: EnzymePage): void => {
    openEnzymeWorkspace(documentId, page);
  };

  const counts = useMemo(() => {
    let once = 0;
    let several = 0;
    for (const g of groups) {
      if (g.count === 1) once++;
      else if (g.count > 1) several++;
    }
    return { once, several, none: groups.length - once - several };
  }, [groups]);
  // The ticked sites the host's methylation blocks: drawn, but not cut.
  const blocked = useMemo(() => {
    let n = 0;
    for (const g of groups) {
      if (!shownEnzymes.has(g.enzyme.name)) continue;
      n += g.count - cuts(g).length;
    }
    return n;
  }, [groups, shownEnzymes, cuts]);

  // Ticked enzymes are listed whatever the workspace table is filtered to (#406).
  const shown = needle === '' ? tickedRows : rows;
  const capped = shown.slice(0, MAX_MATCHES);

  return (
    <div className="panel">
      <div className="panel__controls">
        <div className="panel__form">
          <label>
            <span>Filter</span>
            <input
              className="panel__search"
              type="search"
              placeholder="Enzyme or site"
              aria-label="Filter enzymes"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
              }}
            />
          </label>
        </div>
      </div>
      <p className="panel__note" role="status">
        {ready
          ? `${groups.length.toLocaleString()} enzymes: ${counts.once.toLocaleString()} cut once, ${counts.several.toLocaleString()} more than once, ${counts.none.toLocaleString()} not at all. ${shownEnzymes.size.toLocaleString()} ticked.`
          : 'Scanning for restriction sites…'}
        {ready &&
          blocked > 0 &&
          ` ${blocked.toLocaleString()} ticked ${blocked === 1 ? 'site' : 'sites'} blocked by Dam/Dcm (grown in ${describeHost(doc.methylation)}).`}
      </p>
      <EnzymeNotes list={list} />
      {ready && capped.length > 0 && (
        <ul className="enzyme-list">
          {capped.map((row) => (
            <EnzymeRow key={row.enzyme.name} row={row} doc={doc} shownEnzymes={shownEnzymes} />
          ))}
        </ul>
      )}
      {ready && needle !== '' && shown.length === 0 && (
        <p className="panel__note">No enzyme matches that.</p>
      )}
      {ready && shown.length > capped.length && (
        <p className="panel__note">
          <button
            type="button"
            className="link"
            data-tip="The whole list, on a page of its own: the Enzyme workspace"
            onClick={() => {
              open('enzymes');
            }}
          >
            and {(shown.length - capped.length).toLocaleString()} more ›
          </button>
        </p>
      )}
      {ready && shownEnzymes.size > 0 && (
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              editorStore.setShownEnzymes([]);
            }}
          >
            Hide all
          </button>
        </div>
      )}
      <div className="panel__form">
        <GrownIn doc={doc} />
      </div>
      {ready && fragments.length > 0 && (
        <p
          className={`panel__note${ticked.misleading ? ' panel__note--warn' : ''}`}
          data-testid="gel-reading"
        >
          {gelSentence(ticked, gel)}{' '}
          <button
            type="button"
            className="link"
            data-tip="The fragments and the gel, on the Digest page of the Enzyme workspace"
            onClick={() => {
              open('digest');
            }}
          >
            Digest ›
          </button>
        </p>
      )}
      <div className="panel__links">
        <button
          type="button"
          id={MORE_BUTTON_ID}
          ref={more}
          className="link panel__door"
          data-tip="The enzyme list on a page of its own, the digest, the double digests, and the table in use: the Enzyme workspace"
          onClick={() => {
            open();
          }}
        >
          Open Enzyme workspace ›
        </button>
        {pairable.length >= 2 && (
          <button
            type="button"
            className="link panel__door"
            data-tip="The pairs of enzymes whose fragments are furthest apart on a gel"
            onClick={() => {
              open('pairs');
            }}
          >
            Double digests ›
          </button>
        )}
      </div>
    </div>
  );
}
