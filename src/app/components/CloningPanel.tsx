import { analytics } from '../analytics';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type DigestFragment,
  type FragmentEnd,
  type PartialFragment,
  type SeqDocument,
  cuttableSites,
  describeEnd,
  describeHost,
  digest,
  getEnzyme,
  documentFromFragment,
  partialDigest,
  partialDigestSize,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import { copiesOnShelf } from '../shelfPieces';
import { SIDEBAR_REACTIONS } from '../state/cloningReaction';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
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
    <span className={`end end--${side}`} title={describeEnd(end)}>
      <span className="end__enzyme">{endLabel(end)}</span>
      <span className="end__shape">{shape}</span>
      {end.overhang !== '' && <span className="end__overhang">{end.overhang.toUpperCase()}</span>}
    </span>
  );
}

/** A listed fragment onto the shelf, without the partial digest's count, which is the list's. */
function shelve(fragment: PartialFragment): void {
  const { uncut: _uncut, ...piece } = fragment;
  editorStore.addToShelf(piece);
}

/** How long Add reads "Added ✓" after a click. */
const ADDED_MS = 1500;

function FragmentRow({
  fragment,
  seqLength,
  onShelf,
  onSelect,
  onOpen,
  onHover,
}: {
  /** `uncut` is the sites inside it a partial digest left uncut; 0 for a complete one. */
  readonly fragment: PartialFragment;
  readonly seqLength: number;
  /** Copies of this piece on the shelf now (`copiesOnShelf`). */
  readonly onShelf: number;
  readonly onSelect: () => void;
  readonly onOpen: () => void;
  /** Called with this row's id while the pointer is on it, null when it leaves. */
  readonly onHover: (hovered: boolean) => void;
}) {
  const { uncut } = fragment;
  // Cut short with an ellipsis when the sidebar is narrow; the title has it whole.
  const range = `${describeRange(fragment, seqLength)}${uncut > 0 ? ` · ${String(uncut)} ${uncut === 1 ? 'site' : 'sites'} uncut` : ''}`;
  const names = [...new Set(fragment.features.map((f) => (f.name === '' ? f.type : f.name)))];
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
          title="Select this fragment in the views"
          onClick={onSelect}
        >
          {fragment.sequence.length.toLocaleString()} bp
        </button>
        <span className="fragment__range" title={range}>
          {range}
        </span>
        <button
          type="button"
          className={`button button--quiet button--small fragment__add${added ? ' fragment__add--done' : ''}`}
          title={
            onShelf > 0
              ? 'Put another copy of this fragment on the shelf'
              : 'Put this fragment on the shelf, for the reactions on the Bench'
          }
          onClick={() => {
            shelve(fragment);
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
          title="Open this fragment as a document of its own, sticky ends and all"
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
          <span className="fragment__shelved" title="Copies of this fragment on the shelf">
            On shelf{onShelf > 1 ? ` ×${String(onShelf)}` : ''}
          </span>
        )}
      </div>
      {names.length > 0 && (
        <div className="fragment__features" title={names.join(', ')}>
          {names.slice(0, 4).join(', ')}
          {names.length > 4 ? `, +${names.length - 4} more` : ''}
        </div>
      )}
    </li>
  );
}

/**
 * The most pieces of a partial digest listed at once. A plasmid with every
 * single cutter ticked gives over a thousand; the ones that miss the fewest
 * sites are what the tube mostly holds, and the ones anyone would pick from.
 */
const MAX_LISTED = 200;

/** A digest fragment's id within one digest: its place on the molecule. */
function fragmentId(f: DigestFragment): string {
  return `${f.range.start}-${f.range.end}`;
}

/**
 * The pieces a digest would give, drawn on both views beside the document's
 * own annotation (`src/view/overlay.ts`). Each is a bracket with a tick at
 * either end, so a ring of fragments reads as fragments rather than as one
 * unbroken band, and the ticks fall where the enzyme cuts. The one under the
 * pointer becomes a solid arrow instead, which is the answer to "which of
 * these is the backbone" — the question the sizes alone cannot settle.
 */
function digestPreview(
  fragments: readonly DigestFragment[],
  hovered: string | null,
  partial: boolean,
): OverlaySpan[] {
  // A partial digest's pieces overlap one another by design, and there are
  // hundreds of them; drawn together they are one smear. So only the one
  // under the pointer is drawn.
  const drawn = partial ? fragments.filter((f) => fragmentId(f) === hovered) : fragments;
  return drawn.map((f) => {
    const id = fragmentId(f);
    const lit = id === hovered;
    return {
      id,
      label: `${f.sequence.length.toLocaleString()} bp`,
      // Already unrolled by `digest`, so a fragment over the origin draws as
      // the one piece it is.
      range: f.range,
      strand: lit ? ('forward' as const) : ('none' as const),
      shape: lit ? ('arrow' as const) : ('span' as const),
      // Clicking one puts it on the shelf, which is what the Add button in
      // its row does. The views know nothing of fragments; they report the
      // click and this panel decides what it meant.
      clickable: true,
    };
  });
}

export function CloningPanel({ doc }: Props) {
  const {
    analysis,
    shownEnzymes,
    showCutSites,
    sidebarReaction,
    documentId,
    previewActivated: activated,
    shelf,
  } = useEditorState();
  const [hovered, setHovered] = useState<string | null>(null);
  const [partial, setPartial] = useRemembered('cloning.partial', documentId, false);
  const ready = analysis !== null && analysis.doc === doc;

  // The ticked enzymes' sites, less the ones this DNA's own methylation
  // would block (#45): a digest cuts what the tube would cut. The Enzymes
  // tab still lists and marks them, and says where the DNA was grown.
  const tickedSites = useMemo(
    () => (ready ? analysis.cutSites.filter((s) => shownEnzymes.has(s.enzyme)) : []),
    [analysis, ready, shownEnzymes],
  );
  const cutSites = useMemo(
    () =>
      cuttableSites(
        doc.sequence.toString(),
        doc.topology,
        doc.methylation,
        tickedSites,
        (name) => getEnzyme(name)?.site.length ?? 0,
      ),
    [tickedSites, doc],
  );
  // What the host took out, so the panel can say why an enzyme ticked in
  // the Enzymes tab cuts less here, or not at all.
  const blocked = useMemo(() => {
    const open = new Set(cutSites.map((s) => `${s.enzyme}:${s.cut}`));
    const lost = tickedSites.filter((s) => !open.has(`${s.enzyme}:${s.cut}`));
    return {
      sites: lost.length,
      enzymes: [...new Set(lost.map((s) => s.enzyme))].sort((a, b) => a.localeCompare(b)),
      ticked: new Set(tickedSites.map((s) => s.enzyme)).size,
    };
  }, [tickedSites, cutSites]);
  const enzymesUsed = useMemo(
    () => [...new Set(cutSites.map((s) => s.enzyme))].sort((a, b) => a.localeCompare(b)),
    [cutSites],
  );
  // A complete digest's fragments are a partial one's with nothing uncut, so
  // both are listed as partial fragments. A partial digest cuts out only the
  // pieces it lists: all 1,225 of pBR322's single cutters took 180 ms,
  // which is too long for a memo that runs on every edit (docs/perf-notes.md).
  const listed = useMemo(
    () =>
      !ready
        ? []
        : partial
          ? partialDigest(doc, cutSites, MAX_LISTED)
          : digest(doc, cutSites)
              .map((f) => ({ ...f, uncut: 0 }))
              .sort((a, b) => b.sequence.length - a.sequence.length),
    [doc, cutSites, ready, partial],
  );
  const total = useMemo(
    () => (!ready ? 0 : partial ? partialDigestSize(doc, cutSites) : listed.length),
    [doc, cutSites, ready, partial, listed],
  );

  // There is one preview channel, so the digest has it only while it is the
  // one shown: PCR and Mutate have primer sites and products to point at.
  const previewed = useMemo(
    () => (sidebarReaction === 'digest' ? digestPreview(listed, hovered, partial) : []),
    [listed, hovered, sidebarReaction, partial],
  );
  useEffect(() => {
    editorStore.setPreview('cloning', previewed);
  }, [previewed]);
  // A click on a fragment in either view adds it, exactly as its Add button
  // does. The nonce is watched rather than the id, so clicking the same
  // fragment twice adds it twice — two copies of one piece is a real
  // assembly, and the shelf is a list, not a set.
  // Seeded with the nonce present at mount, so a click answered before this
  // panel was last closed is not answered again when it comes back — coming
  // back to the tab would otherwise put a fragment on the shelf by itself.
  const handledClick = useRef(activated?.nonce ?? 0);
  useEffect(() => {
    if (activated?.owner !== 'cloning') return;
    if (activated.nonce === handledClick.current) return;
    handledClick.current = activated.nonce;
    const fragment = listed.find((f) => fragmentId(f) === activated.id);
    if (fragment !== undefined) shelve(fragment);
  }, [activated, listed]);
  // Leaving the tab takes the fragments off the views with it.
  useEffect(
    () => () => {
      editorStore.clearPreview('cloning');
    },
    [],
  );

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
              title={r.title}
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
          <h3 className="panel__heading">
            Digest with ticked enzymes
            {enzymesUsed.length > 0 && (
              <span className="panel__heading-note">{enzymesUsed.join(', ')}</span>
            )}
          </h3>
          {!ready ? (
            <p className="panel__note">Scanning for restriction sites…</p>
          ) : enzymesUsed.length === 0 && blocked.ticked > 0 ? (
            <p className="panel__note panel__note--warn">
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
            <p className="panel__note">
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
            <p className="panel__note">
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
              title="List every piece a digest that misses some of the sites can give, not only the complete digest's"
            >
              <input
                type="checkbox"
                checked={partial}
                onChange={(e) => {
                  setPartial(e.target.checked);
                  setHovered(null);
                }}
              />
              Partial digest
            </label>
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
                  seqLength={doc.length}
                  onShelf={copiesOnShelf(shelf, f)}
                  onSelect={() => {
                    editorStore.setSelection(f.range);
                    editorStore.revealPosition(f.range.start);
                  }}
                  onOpen={() => {
                    analytics.track('cloning', 'open-fragment');
                    editorStore.openDocument(documentFromFragment(f));
                    editorStore.setSidebarTab('features');
                  }}
                  onHover={(on) => {
                    setHovered((h) => (on ? fragmentId(f) : h === fragmentId(f) ? null : h));
                  }}
                />
              ))}
            </ul>
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
    </div>
  );
}
