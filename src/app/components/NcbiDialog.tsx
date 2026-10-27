import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { NcbiSearch } from './NcbiSearch';

/**
 * File ▸ Open from NCBI… (#65, #92, item 58): the dialog chrome around the
 * shared NcbiSearch (item 107), which says what is sent and to whom before
 * anything is.
 */
export function NcbiDialog() {
  const { ncbiDialog } = useEditorState();
  if (!ncbiDialog) return null;
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ncbi-title"
        aria-describedby="ncbi-privacy"
      >
        <h2 id="ncbi-title" className="dialog__title">
          Open from NCBI
        </h2>
        <NcbiSearch
          globalEscape
          onOpened={() => {
            editorStore.dismissNcbi();
          }}
          onCancel={() => {
            editorStore.dismissNcbi();
          }}
        />
      </div>
    </div>
  );
}
