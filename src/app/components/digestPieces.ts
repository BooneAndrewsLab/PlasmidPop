import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type DigestFragment,
  type PartialFragment,
  type SeqDocument,
  cuttableSites,
  digest,
  fragmentWithLineage,
  getEnzyme,
  partialDigest,
  partialDigestSize,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * A listed fragment onto the shelf, without the partial digest's count, which
 * is the list's; the fragment keeps what it was cut from (#67).
 */
export function shelve(fragment: PartialFragment, source: SeqDocument): void {
  const { uncut: _uncut, ...piece } = fragmentWithLineage(fragment, source);
  editorStore.addToShelf(piece);
}

/**
 * The most pieces of a partial digest listed at once. A plasmid with every
 * single cutter ticked gives over a thousand; the ones that miss the fewest
 * sites are what the tube mostly holds, and the ones anyone would pick from.
 */
const MAX_LISTED = 200;

/** A digest fragment's id within one digest: its place on the molecule. */
export function fragmentId(f: DigestFragment): string {
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

/**
 * The digest's pieces for one document: which sites it cuts, the fragments
 * listed, how many there are, and the preview those draw on the views. The
 * Cloning panel's Digest reaction is its one user so far.
 */
export function useDigestPieces(doc: SeqDocument, { partial }: { readonly partial: boolean }) {
  const { analysis, shownEnzymes, sidebarReaction, previewActivated: activated } = useEditorState();
  const [hovered, setHovered] = useState<string | null>(null);
  // Sites carried through an edit are provisional (#138): they lack any site
  // the edit made, so the digest waits for the worker's scan rather than
  // list, or shelve, fragments the tube would not give.
  // Nor is there a digest before the scan has answered (null), which the
  // ORF scan may do first (#274).
  const sites =
    analysis !== null && analysis.doc === doc && !analysis.provisional ? analysis.cutSites : null;
  const ready = sites !== null;

  // The ticked enzymes' sites, less the ones this DNA's own methylation
  // would block (#45): a digest cuts what the tube would cut. The Enzymes
  // tab still lists and marks them, and says where the DNA was grown.
  const tickedSites = useMemo(
    () => (sites === null ? [] : sites.pick(shownEnzymes)),
    [sites, shownEnzymes],
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
    if (fragment !== undefined) shelve(fragment, doc);
  }, [activated, listed, doc]);
  // Leaving the tab takes the fragments off the views with it.
  useEffect(
    () => () => {
      editorStore.clearPreview('cloning');
    },
    [],
  );

  return { ready, listed, total, blocked, enzymesUsed, setHovered };
}
