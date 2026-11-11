import { useEffect, useMemo, useState } from 'react';

import {
  type FragmentEnd,
  type PartialFragment,
  type SeqDocument,
  describeEnd,
  describeHost,
  formatSpan,
} from '@/core';

import { copiesOnShelf } from '../shelfPieces';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { fragmentId, shelve, useDigestPieces } from './digestPieces';
import { useRowCursor } from './useRowCursor';
import { useRowWindow } from './useRowWindow';
import { TableSpacer } from './TableSpacer';

/** Height assumed for a row not yet measured, in pixels: one line of text. */
const ROW_ESTIMATE = 32;

/** How long Add reads "Added ✓" after a click. */
const ADDED_MS = 1500;

/** Features named in a row before "+N more"; the tooltip has them all. */
const FEATURES_SHOWN = 3;

/** One end of a piece: the enzyme that cut it, the overhang it left, and what that is. */
function EndCell({ end }: { readonly end: FragmentEnd }) {
  const shape = end.kind === 'blunt' ? 'blunt' : end.kind === "5'" ? '5′' : '3′';
  return (
    <td data-tip={describeEnd(end)}>
      {end.enzyme ?? 'end'} <span className="dnote">{shape}</span>
      {end.overhang !== '' && <span className="panel__mono"> {end.overhang.toUpperCase()}</span>}
    </td>
  );
}

/** **Add**, which says so for a moment, and **Add again** for a piece already on the shelf. */
function AddButton({
  fragment,
  source,
  onShelf,
}: {
  readonly fragment: PartialFragment;
  readonly source: SeqDocument;
  /** Copies of this piece on the shelf now. */
  readonly onShelf: number;
}) {
  // A second copy is allowed (a tandem insert is a real assembly) but should
  // be meant: the row says it is on the shelf, and the button says "again".
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => {
      setAdded(false);
    }, ADDED_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [added]);
  return (
    <>
      <button
        type="button"
        className={`button button--quiet button--small fragment__add${added ? ' fragment__add--done' : ''}`}
        data-tip={
          onShelf > 0
            ? 'Put another copy of this fragment on the shelf'
            : 'Put this fragment on the shelf, for the reactions on the Bench'
        }
        onClick={() => {
          shelve(fragment, source);
          setAdded(true);
        }}
      >
        {added ? 'Added ✓' : onShelf > 0 ? 'Add again' : 'Add'}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {added ? `${fragment.sequence.length.toLocaleString()} bp fragment added to the shelf` : ''}
      </span>
      {onShelf > 0 && (
        <span className="fragment__shelved" data-tip="Copies of this fragment on the shelf">
          {' '}
          On shelf{onShelf > 1 ? ` ×${String(onShelf)}` : ''}
        </span>
      )}
    </>
  );
}

/**
 * The Digest page's table of the pieces the ticked enzymes cut (item 133,
 * E5): one row for each, largest first, with its length, where it is, the
 * enzyme and the overhang at each end, the features it carries, and **Add**
 * to put it on the shelf. The pointer or the keyboard on a row lights the
 * piece on both views; a click selects it. The same pieces as the Cloning
 * tab's rows, from the same `useDigestPieces`, and with the **Partial
 * digest** the tab no longer has room for.
 */
export function DigestFragments({ doc }: { readonly doc: SeqDocument }) {
  const { showCutSites, documentId, shelf } = useEditorState();
  const [partial, setPartial] = useRemembered('enzymes.partial', documentId, false);
  const { ready, listed, total, blocked, enzymesUsed, setHovered } = useDigestPieces(doc, {
    partial,
    alwaysPreview: true,
  });
  const [picked, setPicked] = useState<string | null>(null);

  const keys = useMemo(() => listed.map(fragmentId), [listed]);
  const { first, end, padTop, padBottom, attachScroller, attachRow, scrollToIndex } = useRowWindow(
    keys,
    ROW_ESTIMATE,
  );
  const { body, cursor, setCursor, onKeyDown } = useRowCursor(listed.length, scrollToIndex);
  const columns = partial ? 8 : 7;

  const select = (f: PartialFragment): void => {
    setPicked(fragmentId(f));
    editorStore.setSelection(f.range);
    editorStore.revealPosition(f.range.start);
  };

  return (
    <div className="dig-frag">
      {!ready ? (
        <p className="panel__note">Scanning for restriction sites…</p>
      ) : enzymesUsed.length === 0 && blocked.ticked > 0 ? (
        <p className="panel__note panel__note--warn">
          Every site of {blocked.enzymes.join(', ')} in {doc.name} is blocked by its{' '}
          {describeHost(doc.methylation)} methylation, so nothing is cut. If the DNA came from a
          dam−/dcm− strain or a PCR, say so under Grown in above.
        </p>
      ) : enzymesUsed.length === 0 ? (
        <p className="panel__note">
          None of the ticked enzymes cuts {doc.name}.
          {doc.isCircular
            ? ''
            : ' Uncut, the whole molecule is one fragment, with the ends it has.'}
        </p>
      ) : (
        <p className="panel__note" role="status">
          {total === 1 ? '1 fragment' : `${total.toLocaleString()} fragments`}
          {partial ? ' a partial digest can give' : ''}, largest first
          {total > listed.length
            ? ` (the ${listed.length.toLocaleString()} that miss the fewest sites shown)`
            : ''}
          . Add the ones to join to the shelf, and join them on the Bench.
        </p>
      )}
      {ready && enzymesUsed.length > 0 && (
        <label
          className="toggle"
          data-tip="List every piece a digest that misses some of the sites can give, not only the complete digest's"
        >
          <input
            type="checkbox"
            checked={partial}
            onChange={(e) => {
              setPartial(e.target.checked);
              setHovered(null);
              setPicked(null);
            }}
          />
          Partial digest
        </label>
      )}
      {enzymesUsed.length > 0 && blocked.sites > 0 && (
        <p className="panel__note panel__note--quiet">
          {blocked.sites === 1 ? '1 site' : `${blocked.sites.toLocaleString()} sites`} of{' '}
          {blocked.enzymes.join(', ')} {blocked.sites === 1 ? 'is' : 'are'} left out: {doc.name} is{' '}
          {describeHost(doc.methylation)}, and its methylation blocks{' '}
          {blocked.sites === 1 ? 'it' : 'them'}.
        </p>
      )}
      {!showCutSites && enzymesUsed.length > 0 && (
        <p className="panel__note">
          Cut sites are hidden in the views; this digest follows the ticks, not that toggle.
        </p>
      )}
      {listed.length > 0 && (
        <div className="tablewrap dig-frag__scroll" ref={attachScroller}>
          <table className="wst dt" role="grid" aria-label="Fragments">
            <thead>
              <tr>
                <th className="wst__th wst__n" data-tip="Largest first">
                  #
                </th>
                <th className="wst__th wst__n">Length</th>
                <th className="wst__th" data-tip="Bases of the sequence, first to last">
                  Span
                </th>
                {partial && (
                  <th
                    className="wst__th"
                    data-tip="Sites inside the piece that this partial digest left uncut"
                  >
                    Uncut
                  </th>
                )}
                <th
                  className="wst__th"
                  data-tip="The enzyme that cut the left end, and what it left"
                >
                  Left end
                </th>
                <th
                  className="wst__th"
                  data-tip="The enzyme that cut the right end, and what it left"
                >
                  Right end
                </th>
                <th className="wst__th">Features</th>
                <th className="wst__th" aria-label="Shelf" />
              </tr>
            </thead>
            <tbody ref={body} onKeyDown={onKeyDown}>
              {padTop > 0 && <TableSpacer height={padTop} columns={columns} />}
              {listed.slice(first, end).map((f, k) => {
                const i = first + k;
                const id = keys[i] ?? '';
                const names = [
                  ...new Set(f.features.map((feat) => (feat.name === '' ? feat.type : feat.name))),
                ];
                const on = id === picked;
                return (
                  <tr
                    key={id}
                    ref={attachRow(id)}
                    className={`cand${on ? ' is-selected' : ''}`}
                    data-row={i}
                    tabIndex={i === cursor ? 0 : -1}
                    aria-selected={on}
                    data-tip="Click to select this fragment in the views"
                    onMouseEnter={() => {
                      setHovered(id);
                    }}
                    onMouseLeave={() => {
                      setHovered((h) => (h === id ? null : h));
                    }}
                    onFocus={() => {
                      setCursor(i);
                      setHovered(id);
                    }}
                    onBlur={() => {
                      setHovered((h) => (h === id ? null : h));
                    }}
                    onClick={(e) => {
                      if (e.target instanceof Element && e.target.closest('button') !== null) {
                        return;
                      }
                      select(f);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) {
                        e.preventDefault();
                        select(f);
                      }
                    }}
                  >
                    <td className="wst__n">{(i + 1).toLocaleString()}</td>
                    <td className="wst__n">{f.sequence.length.toLocaleString()} bp</td>
                    <td>{formatSpan(f.range, doc.length)}</td>
                    {partial && (
                      <td className={f.uncut > 0 ? 'dt__warn' : undefined}>
                        {f.uncut > 0
                          ? `${String(f.uncut)} ${f.uncut === 1 ? 'site' : 'sites'} uncut`
                          : ''}
                      </td>
                    )}
                    <EndCell end={f.left} />
                    <EndCell end={f.right} />
                    <td className="dig-frag__features" data-tip={names.join(', ') || undefined}>
                      {names.slice(0, FEATURES_SHOWN).join(', ')}
                      {names.length > FEATURES_SHOWN
                        ? `, +${names.length - FEATURES_SHOWN} more`
                        : ''}
                    </td>
                    <td className="dig-frag__add">
                      <AddButton fragment={f} source={doc} onShelf={copiesOnShelf(shelf, f)} />
                    </td>
                  </tr>
                );
              })}
              {padBottom > 0 && <TableSpacer height={padBottom} columns={columns} />}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel__links">
        <button
          type="button"
          className="link panel__door"
          data-tip="Arrange the shelf's parts and join them: Gibson, Golden Gate, ligation"
          onClick={() => {
            editorStore.showBench('link');
          }}
        >
          Open the Bench ›
        </button>
      </div>
    </div>
  );
}
