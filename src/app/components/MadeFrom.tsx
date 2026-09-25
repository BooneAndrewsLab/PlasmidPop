import { useEffect, useMemo, useState } from 'react';

import {
  type LineageNode,
  type LineageStep,
  type SeqDocument,
  describeLineage,
  describeLineageStep,
} from '@/core';

import { analytics } from '../analytics';
import {
  type HeldVersion,
  ancestorChecksums,
  cachedChecksum,
  heldInTabs,
  mergeHeld,
  shortChecksum,
} from '../madeFrom';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';

/** The oligos a step used, to show under it: PCR's two by name, a mutagenesis's two. */
function primersOf(step: LineageStep): readonly { name: string; sequence: string }[] {
  if (step.op === 'pcr') return [step.forward, step.reverse];
  if (step.op === 'mutagenesis') {
    return step.primers.map((sequence, i) => ({ name: i === 0 ? 'Forward' : 'Reverse', sequence }));
  }
  return [];
}

function open(held: HeldVersion): void {
  analytics.track('history', 'made-from-open', held.kind);
  if (held.kind === 'tab') editorStore.activateDocument(held.id);
  else void persistence.openStored(held.id);
}

function NodeRow({
  node,
  held,
  root,
}: {
  readonly node: LineageNode;
  readonly held: ReadonlyMap<string, HeldVersion>;
  /** The document the tree belongs to, and whether it has been edited since it was made. */
  readonly root: { readonly name: string; readonly edited: boolean } | null;
}) {
  const step = node.step;
  const where = node.checksum === null ? undefined : held.get(node.checksum);
  const name = root?.name ?? node.name;
  return (
    <div className="made-from__node">
      <div className="made-from__head">
        <span className="made-from__name" title={name}>
          {name}
        </span>
        {root !== null ? (
          <span className="made-from__where">
            {root.edited ? (
              <span
                className="made-from__edited"
                title="Its bases have changed since it was made; the History list says how"
              >
                edited since
              </span>
            ) : (
              'this document'
            )}
          </span>
        ) : where !== undefined ? (
          <button
            type="button"
            className="button button--quiet button--small made-from__open"
            aria-label={`Open ${node.name}`}
            title={
              where.kind === 'tab'
                ? 'Go to the tab holding this molecule'
                : 'Open this molecule from the files kept in this browser'
            }
            onClick={() => {
              open(where);
            }}
          >
            Open
          </button>
        ) : (
          <span className="made-from__where" title="No open tab or kept file holds this molecule">
            not in this browser
          </span>
        )}
      </div>
      {step !== null && <div className="made-from__step">{describeLineageStep(step)}</div>}
      <div className="made-from__meta">
        {node.length.toLocaleString()} bp, {node.topology}
        {node.checksum !== null && (
          <span className="made-from__checksum" title={node.checksum}>
            {' '}
            · {shortChecksum(node.checksum)}
          </span>
        )}
      </div>
      {step !== null &&
        primersOf(step).map((p, i) => (
          <div key={i} className="made-from__primer">
            {p.name} <code>{p.sequence}</code>
          </div>
        ))}
    </div>
  );
}

function Branch({
  node,
  held,
  root,
}: {
  readonly node: LineageNode;
  readonly held: ReadonlyMap<string, HeldVersion>;
  readonly root: { readonly name: string; readonly edited: boolean } | null;
}) {
  const parents = node.step?.parents ?? [];
  return (
    <li className="made-from__item">
      <NodeRow node={node} held={held} root={root} />
      {parents.length > 0 && (
        <ul className="made-from__parents">
          {parents.map((p, i) => (
            <Branch key={i} node={p} held={held} root={null} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The versions a lineage names that the browser holds, from the open tabs at
 * once and from storage when it answers. Looked up only while the tree is
 * shown, and again when the tabs or the lineage change.
 */
function useHeld(
  lineage: LineageNode,
  documentId: string | null,
  shown: boolean,
): ReadonlyMap<string, HeldVersion> {
  const { documents } = useEditorState();
  const wanted = useMemo(() => ancestorChecksums(lineage), [lineage]);
  const tabs = useMemo(
    () => documents.map((d) => ({ documentId: d.documentId, doc: d.history.present })),
    [documents],
  );
  const inTabs = useMemo(() => heldInTabs(tabs, wanted, documentId), [tabs, wanted, documentId]);
  const [stored, setStored] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!shown || wanted.length === 0) return;
    let live = true;
    void persistence.findStoredByChecksums(wanted).then((found) => {
      if (live) setStored(found);
    });
    return () => {
      live = false;
    };
    // Again when a tab opens or closes: a closed tab's document is in storage.
  }, [wanted, shown, documents.length]);
  return useMemo(() => mergeHeld(inTabs, stored, documentId), [inTabs, stored, documentId]);
}

/**
 * What the document was made from (#67, item 52): the product at the top,
 * each molecule under the one made from it, with how it was made, its size
 * and checksum, and an Open for each the browser still holds. Nothing for a
 * document with no lineage, which was not made here.
 */
export function MadeFrom({ doc }: { readonly doc: SeqDocument }) {
  const lineage = doc.metadata.lineage;
  if (lineage === null) return null;
  return <MadeFromTree doc={doc} lineage={lineage} />;
}

function MadeFromTree({
  doc,
  lineage,
}: {
  readonly doc: SeqDocument;
  readonly lineage: LineageNode;
}) {
  const { documentId } = useEditorState();
  const [shown, setShown] = useRemembered('history.madeFrom', documentId, false);
  const held = useHeld(lineage, documentId, shown);
  const edited = lineage.checksum !== cachedChecksum(doc);
  return (
    <details
      className="made-from"
      open={shown}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === shown) return;
        if (next) analytics.trackOnce('history', 'made-from');
        setShown(next);
      }}
    >
      <summary className="made-from__summary">
        <span className="made-from__title">Made from</span>
        <span className="made-from__summary-note">{describeLineage(lineage)}</span>
      </summary>
      <ul className="made-from__tree" aria-label="Made from">
        <Branch node={lineage} held={held} root={{ name: doc.name, edited }} />
      </ul>
    </details>
  );
}
