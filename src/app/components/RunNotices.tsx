/** A run the worker's failure ended: what the event said, and whether Try again is still offered. */
export interface RunStopped {
  readonly detail: string;
  readonly canRetry: boolean;
}

interface Props {
  /** An ordinary failure's message, as it was. */
  readonly error: string | null;
  readonly stopped: RunStopped | null;
  /** The run has gone on a long while. */
  readonly slow: boolean;
  readonly busy: boolean;
  readonly retry: () => void;
  /** What to do about a run that stopped, as a clause: "align fewer or shorter sequences". */
  readonly advice: string;
  /** What to say of a slow run when it has no Cancel of its own to point at. */
  readonly slowText?: string;
}

const SLOW_TEXT = 'This is taking a while. Cancel to stop it, or wait for it to finish.';

/**
 * What a run in the analysis worker says besides its progress (#373, item
 * 133): an error, the worker's failure in plain words with the technical
 * text behind a details line and Try again while it is on offer, and a
 * notice that the run is taking a while. The multiple alignment's and the
 * CRISPR scan's are the same sentences; `advice` is what each tells the
 * user to change.
 */
export function RunNotices({ error, stopped, slow, busy, retry, advice, slowText }: Props) {
  const sentence = advice.charAt(0).toUpperCase() + advice.slice(1);
  return (
    <>
      {error !== null && <p className="panel__error">{error}</p>}
      {stopped !== null && (
        <div className="panel__error" role="alert">
          <p>
            The analysis stopped (probably memory or size).{' '}
            {stopped.canRetry ? `Try again, or ${advice}.` : `${sentence}.`}
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
          {slowText ?? SLOW_TEXT}
        </p>
      )}
    </>
  );
}
