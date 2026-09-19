import { type DocumentState, editorStore, isDirty } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * One tab per open document under the toolbar, with the file list as a
 * fixed first tab, so several constructs can be open at once and a piece
 * cut from one can be carried to another. Nothing is shown until a document
 * is open. Closing a tab keeps the document in local storage, like Show
 * files always has.
 */
export function DocumentTabs() {
  const { documents, documentId } = useEditorState();
  if (documents.length === 0) return null;
  return (
    <nav className="doctabs">
      <div className="doctabs__list" role="tablist" aria-label="Open documents">
        <div className={tabClass(documentId === null)}>
          <button
            type="button"
            role="tab"
            className="doctabs__name"
            aria-selected={documentId === null}
            title="The files stored in this browser"
            onClick={() => {
              editorStore.showFiles();
            }}
          >
            Files
          </button>
        </div>
        {documents.map((d) => (
          <DocumentTab key={d.documentId} state={d} active={d.documentId === documentId} />
        ))}
      </div>
      <button
        type="button"
        className="doctabs__new"
        title="Start an empty sequence in a new tab"
        aria-label="New sequence"
        onClick={() => {
          editorStore.newDocument();
        }}
      >
        +
      </button>
    </nav>
  );
}

function tabClass(active: boolean): string {
  return `doctabs__tab${active ? ' doctabs__tab--active' : ''}`;
}

interface TabProps {
  readonly state: DocumentState;
  readonly active: boolean;
}

function DocumentTab({ state, active }: TabProps) {
  const name = state.history.present.name;
  const dirty = isDirty(state);
  return (
    <div className={tabClass(active)}>
      <button
        type="button"
        role="tab"
        className="doctabs__name"
        aria-selected={active}
        title={state.fileName === null ? name : `${name}\n${state.fileName}`}
        onClick={() => {
          editorStore.activateDocument(state.documentId);
        }}
      >
        {name}
        {dirty && (
          <span className="doctabs__dirty" title="Changes not yet saved to a file">
            {' '}
            •
          </span>
        )}
      </button>
      <button
        type="button"
        className="doctabs__close"
        aria-label={`Close ${name}`}
        title="Close this tab (the document stays stored in this browser)"
        onClick={() => {
          editorStore.closeDocument(state.documentId);
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
