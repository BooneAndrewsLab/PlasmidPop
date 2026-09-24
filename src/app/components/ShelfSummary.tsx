import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * The shelf as the sidebar's Cloning tab shows it since the Bench (item 49):
 * a line saying what is on it and a way over to the Bench, where it is
 * arranged and joined. A fragment added here is seen landing in the count.
 */
export function ShelfSummary() {
  const { shelf } = useEditorState();
  const total = shelf.reduce((n, p) => n + p.fragment.sequence.length, 0);
  return (
    <div className="panel__section shelf-summary">
      <p className="panel__note">
        {shelf.length === 0
          ? 'The shelf is empty. Fragments and PCR products put on it are joined on the Bench.'
          : `The shelf holds ${shelf.length === 1 ? '1 part' : `${String(shelf.length)} parts`}, ${total.toLocaleString()} bp.`}{' '}
        <button
          type="button"
          className="link"
          onClick={() => {
            editorStore.showBench();
          }}
        >
          Open the Bench
        </button>
      </p>
    </div>
  );
}
