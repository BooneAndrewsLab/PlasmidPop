import { EXAMPLES } from '../examples';
import { openText } from '../openFile';

export function EmptyState() {
  const example = EXAMPLES[0];
  return (
    <div className="empty">
      <div className="empty__card">
        <p className="empty__lead">
          Drop a GenBank or FASTA file anywhere on this page to open it.
        </p>
        <p className="empty__hint">
          Everything stays in your browser. Nothing is uploaded.
          {example !== undefined && (
            <>
              {' '}
              Or{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  openText(example.text, example.fileName);
                }}
              >
                open {example.label}
              </button>{' '}
              to look around.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
