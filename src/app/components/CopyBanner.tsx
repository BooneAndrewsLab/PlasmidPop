import { useState } from 'react';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { InlineRename } from './InlineRename';

/**
 * Says that the document in front is a working copy, and that the file it
 * was forked from is not the one being edited.
 *
 * A document opened from a file that was itself a working copy gets a
 * quieter version of the same thing: the file says what molecule it came
 * from (`derivedComment.ts`), and that is worth repeating on screen, because
 * the alternative is a plasmid with no history that looks exactly like one
 * that was never copied.
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
  if (doc === null) return null;

  const from = doc.metadata.derivedFrom;
  if (!derived || origin === null || documentId === null) {
    if (from === null) return null;
    return (
      <div className="copy-banner copy-banner--quiet">
        <span className="copy-banner__text">
          Derived from{' '}
          {from.fileName === '' ? 'another document' : <strong>{from.fileName}</strong>}, whose
          molecule was <code>{from.checksum}</code>. Open that file with{' '}
          <strong>Compare with…</strong> to see what has changed since.
        </span>
      </div>
    );
  }

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
