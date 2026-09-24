import { type AssemblyPart, describeEnd, flipFragment } from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { shelfIngredients } from './tube';

function ShelfRow({
  part,
  name,
  index,
  count,
}: {
  readonly part: AssemblyPart;
  readonly name: string;
  readonly index: number;
  readonly count: number;
}) {
  const f = part.fragment;
  return (
    <li className="part">
      <span className="part__index">{index + 1}</span>
      <span className="part__text">
        <span className="part__name">
          {name}
          {part.flipped ? ' (flipped)' : ''}
        </span>
        <span className="part__detail">
          {f.sequence.length.toLocaleString()} bp · {describeEnd(f.left)} → {describeEnd(f.right)}
          {f.dephosphorylated === true ? ' · dephosphorylated' : ''}
        </span>
      </span>
      <span className="part__actions">
        <button
          type="button"
          className="button button--quiet button--small"
          aria-pressed={f.dephosphorylated === true}
          title="Dephosphorylate (CIP, rSAP): the part can no longer be ligated to itself or to another dephosphorylated part"
          aria-label={`Dephosphorylate part ${index + 1}`}
          onClick={() => {
            editorStore.setShelfPartDephosphorylated(part.id, f.dephosphorylated !== true);
          }}
        >
          −P
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          title="Turn this fragment around (reverse complement)"
          aria-label={`Flip part ${index + 1}`}
          onClick={() => {
            editorStore.flipShelfPart(part.id, flipFragment(f));
          }}
        >
          ⇄
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={index === 0}
          aria-label={`Move part ${index + 1} up`}
          onClick={() => {
            editorStore.moveShelfPart(part.id, -1);
          }}
        >
          ↑
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={index === count - 1}
          aria-label={`Move part ${index + 1} down`}
          onClick={() => {
            editorStore.moveShelfPart(part.id, 1);
          }}
        >
          ↓
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          aria-label={`Remove part ${index + 1}`}
          onClick={() => {
            editorStore.removeFromShelf(part.id);
          }}
        >
          ✕
        </button>
      </span>
    </li>
  );
}

/**
 * The fragment shelf: pieces collected from digests (and, later, PCR
 * products) for whichever reaction is picked below it. It belongs to the
 * bench rather than to Ligation (#16), because every reaction takes parts
 * from it; so it is drawn above the picker, and a fragment added while
 * Gibson is picked lands where it can be seen without the panel switching.
 *
 * Its order and each part's orientation are Ligation's order of joining;
 * the one-pot reactions work their own order out and ignore both.
 */
export function ShelfPanel() {
  const { shelf } = useEditorState();
  const names = shelfIngredients(shelf);
  const total = shelf.reduce((n, p) => n + p.fragment.sequence.length, 0);
  return (
    <div className="panel__section">
      <h3 className="panel__heading">
        Shelf
        {shelf.length > 0 && (
          <span className="panel__heading-note">
            {shelf.length} {shelf.length === 1 ? 'part' : 'parts'}, {total.toLocaleString()} bp
          </span>
        )}
      </h3>
      {shelf.length === 0 ? (
        <p className="panel__note">
          Nothing collected yet. Add fragments from the digest above, or click one in a view. They
          stay here while you open other files, and across reloads, and every reaction below can use
          them.
        </p>
      ) : (
        <>
          <ol className="part-list shelf-list" aria-label="Shelf">
            {shelf.map((part, i) => (
              <ShelfRow
                key={part.id}
                part={part}
                name={names[i]?.document.name ?? part.fragment.source}
                index={i}
                count={shelf.length}
              />
            ))}
          </ol>
          <div className="panel__controls">
            <div className="panel__buttons">
              <button
                type="button"
                className="button button--quiet button--small"
                onClick={() => {
                  editorStore.clearShelf();
                }}
              >
                Clear shelf
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
