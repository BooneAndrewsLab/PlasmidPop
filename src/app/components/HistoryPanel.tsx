import { type Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type SeqDocument, formatLength } from '@/core';

import { analytics } from '../analytics';
import {
  type HistoryRow,
  type KeptRow,
  historyRows,
  keptRows,
  stateTitle,
  stepTime,
} from '../historyView';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { HistoryStepDialog } from './HistoryStepDialog';
import { MadeFrom } from './MadeFrom';
import { InlineRename } from './InlineRename';
import { useMenu } from './useMenu';

function rowTitle(row: HistoryRow): string {
  const shape = row.state.isProtein ? 'protein' : row.state.isCircular ? 'circular' : 'linear';
  const state = `${formatLength(row.state.length, row.state.alphabet)}, ${shape}`;
  if (row.current) return `Current state — ${state}`;
  if (row.undone) return `Redo up to this change — ${state}`;
  if (row.position === 0) return `Undo everything — ${state}`;
  return `Undo back to this change — ${state}`;
}

/** What the review of one step is of: the two states and what to call the step. */
interface StepReview {
  readonly before: SeqDocument;
  readonly after: SeqDocument;
  readonly title: string;
  readonly label: string;
}

/** A row's actions, behind a "⋯" button so the list stays one click per row. */
function RowMenu({
  label,
  named,
  canName,
  clearLabel = 'Clear name',
  onName,
  onClear,
  onWhatChanged,
  onMarkSince,
  onBringBack,
}: {
  readonly label: string;
  readonly named: boolean;
  readonly canName: boolean;
  /** What taking the name off is called: a kept state is forgotten with it. */
  readonly clearLabel?: string;
  readonly onName: () => void;
  readonly onClear: () => void;
  readonly onWhatChanged: (() => void) | null;
  readonly onMarkSince: () => void;
  readonly onBringBack?: () => void;
}) {
  const { open, toggle, close, ref } = useMenu();
  const item = (text: string, title: string, run: (() => void) | null) => (
    <button
      type="button"
      role="menuitem"
      className="menu__item"
      title={title}
      disabled={run === null}
      onClick={() => {
        close();
        run?.();
      }}
    >
      {text}
    </button>
  );
  return (
    <div className="menu history-panel__menu" ref={ref}>
      <button
        type="button"
        className="history-panel__more"
        aria-label={`Actions for ${label}`}
        title="Name this state, see what the step changed, or mark changes since it"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        ⋯
      </button>
      {open && (
        <div className="menu__list" role="menu" aria-label={`Actions for ${label}`}>
          {onBringBack !== undefined &&
            item(
              'Bring back',
              'Make this state the document again, as a change of its own',
              onBringBack,
            )}
          {canName &&
            item(
              named ? 'Rename…' : 'Name…',
              'Give this state a name, shown in the list and kept with the history',
              onName,
            )}
          {named && item(clearLabel, 'Take the name off this state', onClear)}
          {onBringBack === undefined &&
            item(
              'What changed',
              'Show what this one step did: the state before it against the state after it',
              onWhatChanged,
            )}
          {item(
            'Mark changes since this',
            'Mark in the views everything that has changed since this state; Alt+N goes through them',
            onMarkSince,
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The list of recorded changes, newest first, with what each one did to the
 * document and where the file on disk sits. Clicking a row undoes or redoes
 * as far as it takes to get back to that state; its "⋯" names the state,
 * shows what the step changed, or marks the changes made since it (#4).
 * Named states the step limit has dropped are listed below the rest. Above
 * it all, for a product of a reaction, what it was made from (#67).
 */
export function HistoryPanel() {
  const { history, savedDoc, fileName } = useEditorState();
  const currentRef = useRef<HTMLButtonElement>(null);
  /** The row being named: a step's position, or `kept:<index>` for one below the list. */
  const [naming, setNaming] = useState<string | null>(null);
  const [namedOnly, setNamedOnly] = useState(false);
  const [review, setReview] = useState<StepReview | null>(null);
  const closeReview = useCallback(() => {
    setReview(null);
  }, []);

  const rows = useMemo(
    () =>
      historyRows(history, {
        savedDoc,
        startLabel: fileName === null ? 'New document' : 'Opened document',
      }),
    [history, savedDoc, fileName],
  );
  const kept = useMemo(() => keptRows(history), [history]);
  const anyNamed = kept.length > 0 || rows.some((r) => r.name !== undefined);
  const filtering = namedOnly && anyNamed;
  const shown = filtering ? rows.filter((r) => r.name !== undefined) : rows;

  const position = history?.position ?? 0;
  useEffect(() => {
    const current = currentRef.current as { scrollIntoView?: Element['scrollIntoView'] } | null;
    current?.scrollIntoView?.({ block: 'nearest' }); // jsdom has no scrollIntoView
  }, [position]);

  const total = history?.size ?? 0;
  const undoneCount = total - position;

  const whatChanged = (row: HistoryRow): (() => void) | null => {
    const before = row.before;
    if (before === null) return null;
    return () => {
      analytics.track('history', 'what-changed');
      const step = `step ${row.position.toLocaleString()}`;
      setReview({
        before,
        after: row.state,
        title: row.name === undefined ? step : `“${row.name}”, ${step},`,
        label: row.label,
      });
    };
  };

  return (
    <div className="panel history-panel">
      {history !== null && <MadeFrom doc={history.present} />}
      <h3 className="panel__heading history-panel__heading">
        Changes
        <span className="panel__heading-note">
          {total === 0
            ? 'none yet'
            : total === 1
              ? '1 change'
              : `${total.toLocaleString()} changes`}
          {undoneCount > 0 && `, ${undoneCount.toLocaleString()} undone`}
        </span>
        {anyNamed && (
          <button
            type="button"
            className="button button--small history-panel__named-only"
            aria-pressed={filtering}
            title="Show only the states you have named"
            onClick={() => {
              setNamedOnly((v) => !v);
            }}
          >
            Named only
          </button>
        )}
        <button
          type="button"
          className="button button--small history-panel__latest"
          disabled={undoneCount === 0}
          title="Redo every undone change"
          onClick={() => {
            editorStore.jumpHistory(total);
          }}
        >
          Latest
        </button>
      </h3>
      {total === 0 && kept.length === 0 && (
        <p className="panel__note">
          Nothing has been changed yet. Every edit is listed here, newest first, and clicking one
          takes the document back to that state.
        </p>
      )}
      {filtering && shown.length === 0 && (
        <p className="panel__note">None of the steps in the list is named.</p>
      )}
      <ol className="history-panel__list" aria-label="Changes">
        {shown.map((row) => (
          <HistoryItem
            key={row.position}
            row={row}
            currentRef={row.current ? currentRef : undefined}
            naming={naming === String(row.position)}
            onNaming={(on) => {
              setNaming(on ? String(row.position) : null);
            }}
            onWhatChanged={whatChanged(row)}
          />
        ))}
      </ol>
      {kept.length > 0 && (
        <>
          <h4 className="history-panel__subheading">Named states from before the oldest kept</h4>
          <p className="panel__note">
            Their steps went past the limit of the list, so Undo cannot reach them; each is kept
            because it has a name. Click one to bring it back as a change of its own.
          </p>
          <ol className="history-panel__list" aria-label="Named states kept">
            {kept.map((k) => (
              <KeptItem
                key={k.index}
                row={k}
                naming={naming === `kept:${k.index}`}
                onNaming={(on) => {
                  setNaming(on ? `kept:${k.index}` : null);
                }}
              />
            ))}
          </ol>
        </>
      )}
      {review !== null && (
        <HistoryStepDialog
          before={review.before}
          after={review.after}
          title={review.title}
          label={review.label}
          onClose={closeReview}
        />
      )}
    </div>
  );
}

function HistoryItem({
  row,
  currentRef,
  naming,
  onNaming,
  onWhatChanged,
}: {
  readonly row: HistoryRow;
  readonly currentRef: Ref<HTMLButtonElement> | undefined;
  readonly naming: boolean;
  readonly onNaming: (on: boolean) => void;
  readonly onWhatChanged: (() => void) | null;
}) {
  const step = row.position === 0 ? row.label : `step ${row.position.toLocaleString()}`;
  return (
    <li className="history-panel__row">
      {naming ? (
        <div className="history-panel__naming">
          <InlineRename
            value={row.name ?? ''}
            label={`Name for ${step}`}
            placeholder="Name this state"
            className="history-panel__name-input"
            allowEmpty
            onCommit={(name) => {
              editorStore.nameHistoryState(row.position, name);
            }}
            onDone={() => {
              onNaming(false);
            }}
          />
        </div>
      ) : (
        <button
          ref={currentRef}
          type="button"
          aria-current={row.current ? 'step' : undefined}
          className={`history-panel__item${row.current ? ' history-panel__item--current' : ''}${
            row.undone ? ' history-panel__item--undone' : ''
          }${row.name === undefined ? '' : ' history-panel__item--named'}`}
          title={rowTitle(row)}
          onClick={() => {
            editorStore.jumpHistory(row.position);
          }}
        >
          <span className="history-panel__step">
            {row.position === 0 ? '·' : row.position.toLocaleString()}
          </span>
          {row.name !== undefined && <span className="history-panel__name">{row.name}</span>}
          <span className="history-panel__label">{row.label}</span>
          <span className="history-panel__time">{stepTime(row.at)}</span>
          <span className="history-panel__effect">
            {row.effect}
            {row.saved && <span className="history-panel__saved">on disk</span>}
          </span>
        </button>
      )}
      <RowMenu
        label={step}
        named={row.name !== undefined}
        // The starting state is not a step; it has its own name already.
        canName={row.position > 0}
        onName={() => {
          onNaming(true);
        }}
        onClear={() => {
          editorStore.nameHistoryState(row.position, '');
        }}
        onWhatChanged={onWhatChanged}
        onMarkSince={() => {
          editorStore.markChangesSince(row.state, stateTitle(row));
        }}
      />
    </li>
  );
}

function KeptItem({
  row,
  naming,
  onNaming,
}: {
  readonly row: KeptRow;
  readonly naming: boolean;
  readonly onNaming: (on: boolean) => void;
}) {
  return (
    <li className="history-panel__row">
      {naming ? (
        <div className="history-panel__naming">
          <InlineRename
            value={row.name}
            label={`Name for “${row.name}”`}
            placeholder="Empty forgets this state"
            className="history-panel__name-input"
            allowEmpty
            onCommit={(name) => {
              editorStore.nameKeptState(row.index, name);
            }}
            onDone={() => {
              onNaming(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          aria-current={row.current ? 'step' : undefined}
          className={`history-panel__item history-panel__item--named${
            row.current ? ' history-panel__item--current' : ''
          }`}
          title="Bring this state back as a change of its own"
          onClick={() => {
            editorStore.bringBackKeptState(row.index);
          }}
        >
          <span className="history-panel__step">★</span>
          <span className="history-panel__name">{row.name}</span>
          <span className="history-panel__label">{row.label}</span>
          <span className="history-panel__time">{stepTime(row.at)}</span>
          <span className="history-panel__effect">{row.effect}</span>
        </button>
      )}
      <RowMenu
        label={`“${row.name}”`}
        named
        canName
        clearLabel="Forget"
        onName={() => {
          onNaming(true);
        }}
        onClear={() => {
          editorStore.nameKeptState(row.index, '');
        }}
        onWhatChanged={null}
        onMarkSince={() => {
          editorStore.markChangesSince(row.state, row.name);
        }}
        onBringBack={() => {
          editorStore.bringBackKeptState(row.index);
        }}
      />
    </li>
  );
}
