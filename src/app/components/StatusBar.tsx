import { useMemo, useState } from 'react';

import { type SeqDocument, documentChecksum, fractionAtLeast } from '@/core';

import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument | null;
}

function describeSelection(doc: SeqDocument, selection: { start: number; end: number }): string {
  if (selection.start === selection.end) {
    return `Cursor after base ${selection.start.toLocaleString()}`;
  }
  const length = selection.end - selection.start;
  const from = selection.start + 1;
  const to = ((selection.end - 1) % doc.length) + 1;
  return `${length.toLocaleString()} bp selected, ${from.toLocaleString()} to ${to.toLocaleString()}`;
}

export function StatusBar({ doc }: Props) {
  const { selection, warnings, error, errorCountdown, fileName } = useEditorState();
  const [showWarnings, setShowWarnings] = useState(false);
  const [copied, setCopied] = useState(false);
  // A SHA-1 over the sequence, which is microseconds even for a plasmid, but
  // it is taken on every render of the status bar without this.
  const checksum = useMemo(() => (doc === null ? null : documentChecksum(doc)), [doc]);
  const read = doc?.read ?? null;

  return (
    <footer className="statusbar">
      {showWarnings && warnings.length > 0 && (
        <ul className="statusbar__warnings">
          {warnings.map((w, i) => (
            <li key={i}>
              {w.line === undefined ? '' : `Line ${w.line}: `}
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <div className="statusbar__row">
        <span className="statusbar__selection">
          {doc === null
            ? 'No sequence open'
            : selection === null
              ? 'Nothing selected'
              : describeSelection(doc, selection)}
        </span>
        {error === null ? (
          <span />
        ) : (
          // Keyed by nonce so a repeated rejection restarts the fade and the ring.
          <div
            key={errorCountdown?.nonce}
            className={
              errorCountdown === null
                ? 'statusbar__error'
                : 'statusbar__error statusbar__error--fading'
            }
            style={
              errorCountdown === null
                ? undefined
                : {
                    animationDelay: `${errorCountdown.durationMs}ms`,
                    animationDuration: `${errorCountdown.fadeMs}ms`,
                  }
            }
            role="alert"
          >
            <span title={error}>{error}</span>
            <button
              type="button"
              className="statusbar__dismiss"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => {
                editorStore.dismissError();
              }}
            >
              {errorCountdown === null ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle className="statusbar__countdown-track" cx="8" cy="8" r="6" />
                  <circle
                    className="statusbar__countdown-arc"
                    cx="8"
                    cy="8"
                    r="6"
                    style={{ animationDuration: `${errorCountdown.durationMs}ms` }}
                  />
                </svg>
              )}
            </button>
          </div>
        )}
        <span className="statusbar__right">
          {warnings.length > 0 && (
            <button
              type="button"
              className="button button--quiet"
              aria-expanded={showWarnings}
              onClick={() => {
                setShowWarnings((v) => !v);
              }}
            >
              {warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`} while opening
            </button>
          )}
          {read !== null && (
            <span
              className="statusbar__read"
              title={`This document is a sequencing read: its base qualities${read.trace === null ? '' : ' and trace'} are kept with it. Q20 is one error in a hundred bases or fewer.`}
            >
              Read, {Math.round(fractionAtLeast(read, 20) * 100)}% Q20+
            </span>
          )}
          {checksum !== null && (
            <button
              type="button"
              className="button button--quiet statusbar__checksum"
              title={`${checksum.text}\nThe molecule's SEGUID v2 name: the same for this sequence whatever origin it is written from and whichever strand is on top. Click to copy it in full.`}
              onClick={() => {
                copyText(checksum.text);
                setCopied(true);
                window.setTimeout(() => {
                  setCopied(false);
                }, 2000);
              }}
            >
              {copied ? 'Checksum copied' : `${checksum.kind}=${checksum.short}…`}
            </button>
          )}
          {fileName !== null && <span className="statusbar__file">{fileName}</span>}
        </span>
      </div>
    </footer>
  );
}
