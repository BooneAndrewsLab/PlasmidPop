import { analytics } from '../analytics';
import { useEffect, useState } from 'react';

import {
  type DigestFragment,
  type FragmentEnd,
  type PartialFragment,
  type SeqDocument,
  describeEnd,
  describeHost,
  documentFromFragment,
  fragmentWithLineage,
} from '@/core';

import { batchSession } from '../batchSession';
import { openEnzymeWorkspace } from '../enzymeWorkspace';
import { openPrimerWorkspace } from '../primerWorkspace';
import { copiesOnShelf } from '../shelfPieces';
import { SIDEBAR_REACTIONS } from '../state/cloningReaction';
import { editorStore, hasSidebarTab } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { fragmentId, namedEnzymes, shelve, useDigestPieces } from './digestPieces';
import { MutagenesisPanel } from './MutagenesisPanel';
import { PcrPanel } from './PcrPanel';
import { ShelfSummary } from './ShelfSummary';

interface Props {
  readonly doc: SeqDocument;
}

function describeRange(f: DigestFragment, seqLength: number): string {
  const from = f.range.start + 1;
  const to = ((f.range.end - 1) % Math.max(1, seqLength)) + 1;
  return `${from.toLocaleString()}–${to.toLocaleString()}`;
}

function endLabel(end: FragmentEnd): string {
  if (end.enzyme === null) return 'end';
  return end.enzyme;
}

function EndTag({ end, side }: { readonly end: FragmentEnd; readonly side: 'left' | 'right' }) {
  const shape = end.kind === 'blunt' ? 'blunt' : end.kind === "5'" ? '5′' : '3′';
  return (
    <span className={`end end--${side}`} data-tip={describeEnd(end)}>
      <span className="end__enzyme">{endLabel(end)}</span>
      <span className="end__shape">{shape}</span>
      {end.overhang !== '' && <span className="end__overhang">{end.overhang.toUpperCase()}</span>}
    </span>
  );
}

/** How long Add reads "Added ✓" after a click. */
const ADDED_MS = 1500;

function FragmentRow({
  fragment,
  source,
  seqLength,
  onShelf,
  onSelect,
  onOpen,
  onHover,
}: {
  /** `uncut` is the sites inside it a partial digest left uncut; 0 for a complete one. */
  readonly fragment: PartialFragment;
  /** The document it is cut from. */
  readonly source: SeqDocument;
  readonly seqLength: number;
  /** Copies of this piece on the shelf now (`copiesOnShelf`). */
  readonly onShelf: number;
  readonly onSelect: () => void;
  readonly onOpen: () => void;
  /** Called with this row's id while the pointer is on it, null when it leaves. */
  readonly onHover: (hovered: boolean) => void;
}) {
  const { uncut } = fragment;
  const names = [...new Set(fragment.features.map((f) => (f.name === '' ? f.type : f.name)))];
  // The row is two lines, the length and its buttons over the ends; where the
  // piece sits and what it carries are in its tooltip, as the Digest page's
  // table gives them in columns.
  const detail = `${describeRange(fragment, seqLength)}${names.length > 0 ? ` · ${names.join(', ')}` : ''}`;
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
    <li
      className="fragment"
      data-tip={detail}
      onMouseEnter={() => {
        onHover(true);
      }}
      onMouseLeave={() => {
        onHover(false);
      }}
      onFocus={() => {
        onHover(true);
      }}
      onBlur={() => {
        onHover(false);
      }}
    >
      <div className="fragment__head">
        <button
          type="button"
          className="fragment__length"
          data-tip={`${detail}. Click to select this fragment in the views`}
          onClick={onSelect}
        >
          {fragment.sequence.length.toLocaleString()} bp
        </button>
        {uncut > 0 && (
          <span className="fragment__uncut">
            {uncut} {uncut === 1 ? 'site' : 'sites'} uncut
          </span>
        )}
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
          {added
            ? `${fragment.sequence.length.toLocaleString()} bp fragment added to the shelf`
            : ''}
        </span>
        <button
          type="button"
          className="button button--quiet button--small"
          data-tip="Open this fragment as a document of its own, sticky ends and all"
          onClick={onOpen}
        >
          Open
        </button>
      </div>
      <div className="fragment__ends">
        <EndTag end={fragment.left} side="left" />
        <span className="fragment__bar" aria-hidden="true" />
        <EndTag end={fragment.right} side="right" />
        {onShelf > 0 && (
          <span className="fragment__shelved" data-tip="Copies of this fragment on the shelf">
            On shelf{onShelf > 1 ? ` ×${String(onShelf)}` : ''}
          </span>
        )}
      </div>
    </li>
  );
}

export function CloningPanel({ doc }: Props) {
  const { showCutSites, sidebarReaction, documentId, shelf } = useEditorState();
  // The partial digest is on the Enzyme workspace's Digest page; this is the complete one.
  const { ready, listed, total, blocked, enzymesUsed, setHovered } = useDigestPieces(doc, {
    partial: false,
  });

  return (
    <div className="panel">
      <div className="panel__section">
        {/* The digest, PCR and Mutate are alternatives, not steps, and they
            share the views' one preview channel, so the tab asks which one
            rather than stacking them. The reactions that join what they make
            are on the Bench (item 49). */}
        <div className="segmented" role="group" aria-label="Reaction">
          {SIDEBAR_REACTIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`segmented__button${
                sidebarReaction === r.value ? ' segmented__button--active' : ''
              }`}
              aria-pressed={sidebarReaction === r.value}
              data-tip={r.title}
              onClick={() => {
                editorStore.setCloningReaction(r.value);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {sidebarReaction === 'digest' && (
        <>
          <h3 className="panel__heading">Digest with ticked enzymes</h3>
          {/* One status line whichever state the digest is in: scanning, every
              site blocked, nothing ticked, or the pieces. */}
          {!ready ? (
            <p className="panel__note" role="status">
              Scanning for restriction sites…
            </p>
          ) : enzymesUsed.length === 0 && blocked.ticked > 0 ? (
            <p className="panel__note panel__note--warn" role="status">
              Every site of {blocked.enzymes.join(', ')} in {doc.name} is blocked by its{' '}
              {describeHost(doc.methylation)} methylation, so nothing is cut. If the DNA came from a
              dam−/dcm− strain or a PCR, say so under{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  editorStore.setSidebarTab('enzymes');
                }}
              >
                Grown in
              </button>{' '}
              in the Enzymes tab.
            </p>
          ) : enzymesUsed.length === 0 ? (
            <p className="panel__note" role="status">
              No enzyme is ticked.{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  editorStore.setSidebarTab('enzymes');
                }}
              >
                Tick enzymes
              </button>{' '}
              in the Enzymes tab to cut {doc.name} with them.
              {doc.isCircular
                ? ''
                : ' Uncut, the whole molecule is one fragment, with the ends it has.'}
            </p>
          ) : (
            <p className="panel__note" role="status">
              {namedEnzymes(enzymesUsed)}:{' '}
              {total === 1 ? '1 fragment' : `${total.toLocaleString()} fragments`}, largest first
              {total > listed.length
                ? ` (the ${listed.length.toLocaleString()} that miss the fewest sites shown)`
                : ''}
              .
            </p>
          )}
          {enzymesUsed.length > 0 && blocked.sites > 0 && (
            <p className="panel__note panel__note--quiet">
              {blocked.sites === 1 ? '1 site' : `${blocked.sites.toLocaleString()} sites`} of{' '}
              {blocked.enzymes.join(', ')} {blocked.sites === 1 ? 'is' : 'are'} left out: {doc.name}{' '}
              is {describeHost(doc.methylation)}, and its methylation blocks{' '}
              {blocked.sites === 1 ? 'it' : 'them'}.
            </p>
          )}
          {!showCutSites && enzymesUsed.length > 0 && (
            <p className="panel__note">
              Cut sites are hidden in the views; this digest follows the ticks, not that toggle.
            </p>
          )}
          {listed.length > 0 && (
            <ul className="fragment-list">
              {listed.map((f) => (
                <FragmentRow
                  key={fragmentId(f)}
                  fragment={f}
                  source={doc}
                  seqLength={doc.length}
                  onShelf={copiesOnShelf(shelf, f)}
                  onSelect={() => {
                    editorStore.setSelection(f.range);
                    editorStore.revealPosition(f.range.start);
                  }}
                  onOpen={() => {
                    analytics.track('cloning', 'open-fragment');
                    editorStore.openDocument(
                      documentFromFragment(fragmentWithLineage(f, doc)),
                      null,
                      [],
                      { scratch: true },
                    );
                    editorStore.setSidebarTab('features');
                  }}
                  onHover={(on) => {
                    setHovered((h) => (on ? fragmentId(f) : h === fragmentId(f) ? null : h));
                  }}
                />
              ))}
            </ul>
          )}
          {ready && enzymesUsed.length > 0 && (
            <div className="panel__links">
              <button
                type="button"
                className="link panel__door"
                data-tip="Every fragment, and the partial digest that misses some sites, on the Enzyme workspace's Digest page"
                onClick={() => {
                  openEnzymeWorkspace(documentId, 'digest');
                }}
              >
                All fragments and partial digest ›
              </button>
            </div>
          )}
        </>
      )}

      {sidebarReaction === 'pcr' && (
        <div className="panel__section">
          <h3 className="panel__heading">
            PCR
            <span className="panel__heading-note">two primers, one template</span>
          </h3>
          <PcrPanel doc={doc} />
        </div>
      )}

      {sidebarReaction === 'mutagenesis' && (
        <div className="panel__section">
          <h3 className="panel__heading">
            Site-directed mutagenesis
            <span className="panel__heading-note">primers that carry a change</span>
          </h3>
          <MutagenesisPanel doc={doc} />
        </div>
      )}

      <ShelfSummary />
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
        {hasSidebarTab(doc, 'primers') && (
          <button
            type="button"
            className="link panel__door"
            data-tip="Design primers for an insert from another tab, with restriction or Golden Gate ends, in the primer workspace"
            onClick={() => {
              openPrimerWorkspace(documentId, 'design', 'cloning');
            }}
          >
            Clone an insert into this plasmid ›
          </button>
        )}
        {hasSidebarTab(doc, 'primers') && (
          <button
            type="button"
            className="link panel__door"
            data-tip="Design primers for many inserts at once into this plasmid, with restriction, Golden Gate or homology ends, from a table"
            onClick={() => {
              // The Batch page on a cloning method (the one it was last on, else restriction sites).
              batchSession.update(documentId, (b) => ({
                method: b.method === 'primers' ? 'restriction' : b.method,
                vector: null,
                selected: null,
              }));
              openPrimerWorkspace(documentId, 'batch');
            }}
          >
            Design many inserts ›
          </button>
        )}
      </div>
    </div>
  );
}
