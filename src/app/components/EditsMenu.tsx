import { type EditsBaseline, editorStore } from '../state/editorStore';
import { EDITS_BASELINE_LABELS, describeEditDiff } from '../editsView';
import { useEditDiff } from '../state/editDiff';
import { useEditorState } from '../state/useEditorStore';
import { useMenu } from './useMenu';

/** The baselines that can be picked directly; "marked" is set by the action below them. */
const CHOICES: readonly { baseline: EditsBaseline; title: string }[] = [
  { baseline: 'off', title: 'Leave the sequence view unmarked' },
  { baseline: 'opened', title: 'Mark everything changed since this document was opened' },
  { baseline: 'saved', title: 'Mark everything changed since the last download' },
];

/**
 * Picks what the sequence view marks changes against, like tracked changes.
 * The button says whether marks are on and how much is marked; the menu
 * chooses the baseline and can move it to the present state.
 */
export function EditsMenu() {
  const { editsBaseline, savedDoc, origin } = useEditorState();
  const diff = useEditDiff();
  const { open, toggle, close, ref } = useMenu();

  const on = editsBaseline !== 'off';
  const summary = describeEditDiff(diff);
  const state = !on
    ? 'Changes are not marked'
    : summary === ''
      ? `No changes ${EDITS_BASELINE_LABELS[editsBaseline].toLowerCase()}`
      : `${EDITS_BASELINE_LABELS[editsBaseline]}: ${summary}`;

  return (
    <div className="menu edits" ref={ref}>
      <button
        type="button"
        className="button"
        title={`${state}. Click to choose what changes are measured from.`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        Edits
        {on && diff !== null && (
          <span className="edits__dot" title={summary}>
            {' '}
            •
          </span>
        )}{' '}
        <span className="button__caret">▾</span>
      </button>
      {open && (
        <div className="menu__list" role="menu" aria-label="Mark changes">
          {CHOICES.map((choice) => (
            <button
              key={choice.baseline}
              type="button"
              role="menuitemradio"
              aria-checked={editsBaseline === choice.baseline}
              className="menu__item"
              title={choice.title}
              onClick={() => {
                close();
                editorStore.setEditsBaseline(choice.baseline);
              }}
            >
              <span>{EDITS_BASELINE_LABELS[choice.baseline]}</span>
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
          <p className="edits__summary">{summary === '' ? 'Nothing marked' : summary}</p>
        </div>
      )}
    </div>
  );
}
