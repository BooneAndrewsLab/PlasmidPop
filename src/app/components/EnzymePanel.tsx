import { useEffect, useRef } from 'react';

import type { SeqDocument } from '@/core';

import { openEnzymeWorkspace, takeEnzymeFocusRequest } from '../enzymeWorkspace';
import { useEditorState } from '../state/useEditorStore';
import { DoubleDigests } from './DoubleDigestsPage';
import { useEnzymeList } from './enzymeList';
import { EnzymeControls, EnzymeFragments, EnzymeRows, EnzymeSource } from './EnzymeListView';

interface Props {
  readonly doc: SeqDocument;
}

/** The id the workspace's Escape hands the keyboard back to (item 107, point 1). */
export const MORE_BUTTON_ID = 'enzyme-workspace-open';

/**
 * The Enzymes tab (item 133): the list with its filters, the double digests
 * under an order by bands, the table in use and the ticked enzymes'
 * fragments. The Enzyme workspace mounts the same pieces, a page each, over
 * the same list, so the two agree on every filter and tick.
 */
export function EnzymePanel({ doc }: Props) {
  const { documentId, enzymeSort, shownEnzymes } = useEditorState();
  const list = useEnzymeList(doc);
  const { ready, rows, pairable, cuts } = list;
  const more = useRef<HTMLButtonElement>(null);
  // The workspace shut with Escape: the keyboard comes back here.
  useEffect(() => {
    if (takeEnzymeFocusRequest()) more.current?.focus();
  }, []);

  return (
    <div className="panel">
      <EnzymeControls doc={doc} list={list} />
      <EnzymeRows doc={doc} list={list} />
      {ready && (
        <>
          {enzymeSort === 'bands' && (
            <DoubleDigests
              listed={rows}
              pairable={pairable}
              cuts={cuts}
              doc={doc}
              shownEnzymes={shownEnzymes}
            />
          )}
          <EnzymeSource />
          <EnzymeFragments list={list} />
        </>
      )}
      <div className="panel__links">
        <button
          type="button"
          id={MORE_BUTTON_ID}
          ref={more}
          className="link panel__door"
          data-tip="The enzyme list on a page of its own, the digest, the double digests, and the table in use: the Enzyme workspace"
          onClick={() => {
            openEnzymeWorkspace(documentId);
          }}
        >
          Open Enzyme workspace ›
        </button>
      </div>
    </div>
  );
}
