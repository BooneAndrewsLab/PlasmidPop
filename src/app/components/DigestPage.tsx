import { type SeqDocument, describeBands } from '@/core';

import { editorStore } from '../state/editorStore';
import { useGelOptions } from '../state/useGel';
import { useEditorState } from '../state/useEditorStore';
import { DigestFragments } from './DigestFragments';
import { type EnzymeList, gelSentence } from './enzymeList';
import { Gel } from './Gel';

/** Chips drawn before "and N more": every enzyme of a big table can be ticked. */
const MAX_CHIPS = 40;

/** The gel is drawn this much larger than the panel's: the page has the room. */
const GEL_SCALE = 1.5;

/** The ticked enzymes, each with its ×, so a digest is changed where it is read. */
function TickedChips({ list }: { readonly list: EnzymeList }) {
  const { shownEnzymes } = useEditorState();
  const names = [...shownEnzymes].sort((a, b) => a.localeCompare(b));
  const cutting = new Set(list.tickedGroups.map((g) => g.name));
  const untick = (name: string): void => {
    editorStore.setShownEnzymes(names.filter((n) => n !== name));
  };
  return (
    <div className="dig-chips">
      <ul className="dig-chips__list" aria-label="Ticked enzymes">
        {names.slice(0, MAX_CHIPS).map((name) => (
          <li
            key={name}
            className={`dig-chip${list.ready && !cutting.has(name) ? ' dig-chip--idle' : ''}`}
          >
            <span
              className="dig-chip__name"
              data-tip={
                list.ready && !cutting.has(name)
                  ? `${name} does not cut this DNA, or every site is blocked by its methylation`
                  : undefined
              }
            >
              {name}
            </span>
            <button
              type="button"
              className="dig-chip__x"
              aria-label={`Untick ${name}`}
              data-tip={`Untick ${name}`}
              onClick={() => {
                untick(name);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {names.length > MAX_CHIPS && (
        <span className="dnote">and {(names.length - MAX_CHIPS).toLocaleString()} more</span>
      )}
      {names.length > 1 && (
        <button
          type="button"
          className="link"
          data-tip="Untick every enzyme"
          onClick={() => {
            editorStore.setShownEnzymes([]);
          }}
        >
          Untick all
        </button>
      )}
    </div>
  );
}

/**
 * The Digest page (item 133, E5): the enzymes ticked, as chips to untick them;
 * their digest on a gel with room beside the table of its pieces. The lane
 * before the numbers: the question a diagnostic digest is chosen to answer is
 * "will I see two bands", and that is a question for the eye. Clicking a
 * band selects the piece it is.
 */
export function DigestPage({
  doc,
  list,
  onEnzymes,
}: {
  readonly doc: SeqDocument;
  readonly list: EnzymeList;
  /** Goes to the Enzymes page, where the ticking is. */
  readonly onEnzymes: () => void;
}) {
  const gel = useGelOptions();
  const { shownEnzymes } = useEditorState();
  const { ready, fragments, ticked, tickedGroups, lanes } = list;
  // With nothing ticked there is nothing to digest with: the page is shown
  // but off, as Align's Results are while stale, and says what to do.
  if (shownEnzymes.size === 0) {
    return (
      <>
        {!ready && <p className="panel__note">Scanning for restriction sites…</p>}
        {ready && (
          <p className="panel__note">
            Nothing is ticked, so there is no digest.{' '}
            <button type="button" className="link" onClick={onEnzymes}>
              Tick enzymes
            </button>{' '}
            in the list first.
          </p>
        )}
        <fieldset className="dig-ws dig-ws--off" disabled aria-label="Digest">
          <p className="panel__note panel__note--quiet">
            The enzymes ticked, their digest on a gel, and each piece it cuts, with its ends and
            features and a button to put it on the shelf.
          </p>
          <label className="toggle">
            <input type="checkbox" checked={false} readOnly />
            Partial digest
          </label>
        </fieldset>
      </>
    );
  }
  return (
    <div className="dig-ws">
      <TickedChips list={list} />
      <div className="dig-ws__body">
        {fragments.length > 0 && (
          <div className="dig-ws__gel">
            <Gel lanes={lanes} scale={GEL_SCALE} />
            {lanes.length > 1 && (
              <p className="panel__note panel__note--quiet" data-testid="gel-singles">
                Beside it, each alone:{' '}
                {tickedGroups.map((g) => `${g.name} ${describeBands(g.profile)}`).join('; ')}.
              </p>
            )}
            {/* The pieces are one thing, the lane is another: a digest of
                five fragments can still show three bands. */}
            <p
              className={`panel__note${ticked.misleading ? ' panel__note--warn' : ''}`}
              data-testid="gel-reading"
            >
              {gelSentence(ticked, gel)}
            </p>
          </div>
        )}
        <div className="dig-ws__main">
          <DigestFragments doc={doc} />
        </div>
      </div>
    </div>
  );
}
