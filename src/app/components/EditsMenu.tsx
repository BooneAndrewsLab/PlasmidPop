import { useMemo } from 'react';

import { analytics } from '../analytics';
import { type EditsBaseline, editorStore, effectiveEditsBaseline } from '../state/editorStore';
import {
  changeStops,
  describeEditDiff,
  describeIdentityChange,
  editsBaselineLabel,
} from '../editsView';
import { goToChange, useEditDiff, useIdentityChange } from '../state/editDiff';
import { useEditorState } from '../state/useEditorStore';
import { useBindingLabel } from './useAltKey';
import { useMenu } from './useMenu';

/**
 * The baselines that can be picked directly; "marked" is set by the action
 * below them, and "compared" by Compare with…'s Mark in the views.
 */
const CHOICES: readonly { baseline: EditsBaseline; title: string }[] = [
  { baseline: 'off', title: 'Leave the sequence view unmarked' },
  { baseline: 'opened', title: 'Mark everything changed since this document was opened' },
  { baseline: 'saved', title: 'Mark everything changed since the last download' },
];

/**
 * Picks what the sequence view marks changes against, like tracked changes.
 * The button says whether marks are on and how much is marked; the menu
 * chooses the baseline, can move it to the present state, and steps from
 * one marked change to the next.
 */
export function EditsMenu() {
  const state = useEditorState();
  const { savedDoc, origin, compared, history } = state;
  const editsBaseline = effectiveEditsBaseline(state);
  const diff = useEditDiff();
  const identity = useIdentityChange();
  const { open, toggle, close, ref } = useMenu();
  const editsKey = useBindingLabel('toggle-edits');
  const nextKey = useBindingLabel('next-change');
  const previousKey = useBindingLabel('next-change', true);
  const doc = history?.present ?? null;
  const stops = useMemo(
    () => (doc === null ? [] : changeStops(diff, doc.length, doc.topology === 'circular')),
    [diff, doc],
  );

  const on = editsBaseline !== 'off';
  // A rename or a change of shape marks no base but is a change all the same (#31).
  const summary = [describeEditDiff(diff), describeIdentityChange(identity)]
    .filter((part) => part !== '')
    .join(' · ');
  const label = editsBaselineLabel(editsBaseline, compared?.name ?? null);
  const status = !on
    ? 'Changes are not marked'
    : summary === ''
      ? `No changes ${editsBaseline === 'compared' ? `from ${compared?.name ?? ''}` : label.toLowerCase()}`
      : `${label}: ${summary}`;

  const choices: readonly { baseline: EditsBaseline; title: string }[] =
    compared === null
      ? CHOICES
      : [
          ...CHOICES,
          {
            baseline: 'compared',
            title: `Mark what this document has that ${compared.name} does not`,
          },
        ];

  return (
    <div className="menu edits" ref={ref}>
      <button
        type="button"
        className="button"
        title={`${status}. Click to choose what changes are measured from; ${editsKey} turns the marks off and on.`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        Edits
        {on && summary !== '' && (
          <span className="edits__dot" title={summary}>
            {' '}
            •
          </span>
        )}{' '}
        <span className="button__caret">▾</span>
      </button>
      {open && (
        <div className="menu__list" role="menu" aria-label="Mark changes">
          {choices.map((choice) => (
            <button
              key={choice.baseline}
              type="button"
              role="menuitemradio"
              aria-checked={editsBaseline === choice.baseline}
              className="menu__item"
              title={choice.title}
              onClick={() => {
                close();
                analytics.track('edits', 'baseline', choice.baseline);
                editorStore.setEditsBaseline(choice.baseline);
              }}
            >
              <span>{editsBaselineLabel(choice.baseline, compared?.name ?? null)}</span>
              <span className="menu__shortcut">
                {editsBaseline === choice.baseline ? '✓' : ''}
                {/* A copy falls back to the file it came from, so only a
                    document that came from nowhere has nothing to compare to. */}
                {choice.baseline === 'saved' && savedDoc === null && origin === null
                  ? ' never downloaded'
                  : ''}
              </span>
            </button>
          ))}
          <div className="menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            title="Measure from the document as it is now; everything up to here counts as unchanged"
            onClick={() => {
              close();
              editorStore.markEditsFromHere();
            }}
          >
            <span>Mark from here</span>
            <span className="menu__shortcut">{editsBaseline === 'marked' ? '✓' : ''}</span>
          </button>
          <div className="menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            disabled={stops.length === 0}
            title="Select the next marked change after the cursor, going round at the end"
            onClick={() => {
              close();
              goToChange(1);
            }}
          >
            <span>Next change</span>
            <span className="menu__shortcut">{nextKey}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            disabled={stops.length === 0}
            title="Select the marked change before the cursor, going round at the start"
            onClick={() => {
              close();
              goToChange(-1);
            }}
          >
            <span>Previous change</span>
            <span className="menu__shortcut">{previousKey}</span>
          </button>
          <div className="menu__separator" />
          <p className="edits__summary">{summary === '' ? 'Nothing marked' : summary}</p>
        </div>
      )}
    </div>
  );
}
