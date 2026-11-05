import type { MultipleAlignmentRun } from './useMultipleAlignment';

/**
 * What a multiple alignment run says besides its progress (#373): an error,
 * the worker's failure in plain words with the technical text behind a
 * details line and Try again while it is on offer, and a notice that the run
 * is taking a while (its Cancel button is the run's own).
 */
export function MsaRunNotices({ msa }: { readonly msa: MultipleAlignmentRun }) {
  const { error, stopped, slow, busy, retry } = msa;
  return (
    <>
      {error !== null && <p className="panel__error">{error}</p>}
      {stopped !== null && (
        <div className="panel__error" role="alert">
          <p>
            The analysis stopped (probably memory or size).{' '}
            {stopped.canRetry
              ? 'Try again, or align fewer or shorter sequences.'
              : 'Align fewer or shorter sequences.'}
          </p>
          <details>
            <summary>Technical details</summary>
            <p>{stopped.detail}</p>
          </details>
          {stopped.canRetry && (
            <button type="button" className="button button--small" onClick={retry}>
              Try again
            </button>
          )}
        </div>
      )}
      {busy && slow && (
        <p className="panel__note" role="status">
          This is taking a while. Cancel to stop it, or wait for it to finish.
        </p>
      )}
    </>
  );
}
