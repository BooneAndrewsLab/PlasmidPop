import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** What a backup or a restore did (#203), under the toolbar until dismissed. */
export function BackupNotice() {
  const { backupNotice } = useEditorState();
  if (backupNotice === null) return null;
  return (
    <div className="copy-banner copy-banner--notice" role="status">
      <span className="copy-banner__text">{backupNotice}</span>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          editorStore.dismissBackupNotice();
        }}
      >
        Got it
      </button>
    </div>
  );
}
