import { useState } from 'react';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { InlineRename } from './InlineRename';

/**
 * Says that the document in front is a working copy, and that the file it
 * was forked from is not the one being edited.
 *
 * It stays up for the life of the tab rather than fading: which file is
 * being changed is exactly the thing a reader of this screen should not have
 * to remember. The copy's own name is offered for renaming here as well as
 * in the toolbar, because the moment the banner appears is the moment the
 * name matters — it is what the download will be called.
 */
export function CopyBanner() {
  const { derived, origin, documentId, history } = useEditorState();
  const [renaming, setRenaming] = useState(false);
  const doc = history?.present ?? null;
  if (!derived || origin === null || documentId === null || doc === null) return null;

  return (
    <div className="copy-banner">
      <span className="copy-banner__text">
        Working copy of <strong>{origin.fileName}</strong>, called{' '}
        {renaming ? (
          <InlineRename
            value={doc.name}
            label="Document name"
            className="copy-banner__rename"
            onCommit={(name) => {
              editorStore.apply({ type: 'rename', name });
            }}
            onDone={() => {
              setRenaming(false);
            }}
          />
        ) : (
          <strong>{doc.name}</strong>
        )}
        . The original file has not been changed.
      </span>
      {!renaming && (
        <button
          type="button"
          className="copy-banner__link"
          onClick={() => {
            setRenaming(true);
          }}
        >
          Rename
        </button>
      )}
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          editorStore.requestSaveReview(documentId, origin.fileName);
        }}
      >
        See what changed
      </button>
    </div>
  );
}
