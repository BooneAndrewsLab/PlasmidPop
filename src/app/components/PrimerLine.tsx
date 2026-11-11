import { type ReactNode } from 'react';

import { copyText } from '../clipboard';

/**
 * One designed primer in a list of them: its label, the meta line each design
 * words for itself (`children`), the sequence, and a Copy button. The overlap,
 * mutagenesis and overlap-extension panels all show their primers this way.
 */
export function PrimerLine({
  label,
  sequence,
  copyLabel,
  children,
}: {
  readonly label: string;
  readonly sequence: string;
  /** The Copy button's accessible name; by default `Copy the ${label.toLowerCase()} primer`. */
  readonly copyLabel?: string;
  /** The meta line: length, tail, Tm, as each design puts it. */
  readonly children: ReactNode;
}) {
  return (
    <li className="pair">
      <div className="pair__row pair__row--wide">
        <span className="pair__length">{label}</span>
        <span className="pair__meta">{children}</span>
      </div>
      <div className="pair__foot">
        <code className="mutagenesis__oligo">{sequence}</code>
        <span className="pair__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
            aria-label={copyLabel ?? `Copy the ${label.toLowerCase()} primer`}
            onClick={() => {
              copyText(sequence);
            }}
          >
            Copy
          </button>
        </span>
      </div>
    </li>
  );
}
