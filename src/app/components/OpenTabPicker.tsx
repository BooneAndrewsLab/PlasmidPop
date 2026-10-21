import { useState } from 'react';

import { useMenu } from './useMenu';

interface Props {
  /** The other open tabs of the same alphabet, in tab order. */
  readonly tabs: readonly { readonly id: string; readonly name: string }[];
  /** At most this many can be picked: the batch limit. */
  readonly limit: number;
  /** Told the ids of the tabs picked, in tab order, when the choice is confirmed. */
  readonly onUse: (ids: readonly string[]) => void;
}

/**
 * The Align panel's "Open tab…" (#262): a button opening a checklist of the
 * other open tabs, to align against one or several at once. Plain checkboxes
 * and buttons, so it is reached by Tab and Space; Escape or a click outside
 * closes it, and `useMenu` keeps it inside the window.
 */
export function OpenTabPicker({ tabs, limit, onUse }: Props) {
  const { open, toggle, close, ref } = useMenu();
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="button button--quiet button--small"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        Open tab…
      </button>
      {/* Mounted only while open, so each opening starts with nothing picked. */}
      {open && (
        <Checklist
          tabs={tabs}
          limit={limit}
          onUse={(ids) => {
            onUse(ids);
            close();
          }}
        />
      )}
    </div>
  );
}

function Checklist({ tabs, limit, onUse }: Props) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const pickable = tabs.slice(0, limit);
  const picked = tabs.filter((t) => checked.has(t.id)).map((t) => t.id);
  const allPicked = picked.length === pickable.length;
  const full = picked.length >= limit;

  const flip = (id: string): void => {
    setChecked((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  return (
    <div className="menu__list menu__list--start" role="group" aria-label="Open tabs to align">
      {tabs.map((t, i) => (
        <label key={t.id} className="toggle">
          <input
            type="checkbox"
            autoFocus={i === 0}
            checked={checked.has(t.id)}
            disabled={full && !checked.has(t.id)}
            onChange={() => {
              flip(t.id);
            }}
          />
          {t.name}
        </label>
      ))}
      {tabs.length > limit && (
        <p className="panel__note">At most {limit} tabs are aligned at once.</p>
      )}
      <div className="menu__separator" />
      <button
        type="button"
        className="button button--quiet button--small"
        onClick={() => {
          setChecked(allPicked ? new Set() : new Set(pickable.map((t) => t.id)));
        }}
      >
        {allPicked ? 'Select none' : 'Select all'}
      </button>
      <button
        type="button"
        className="button button--small"
        disabled={picked.length === 0}
        onClick={() => {
          onUse(picked);
        }}
      >
        {picked.length === 1 ? 'Use 1 tab' : `Use ${picked.length} tabs`}
      </button>
    </div>
  );
}
