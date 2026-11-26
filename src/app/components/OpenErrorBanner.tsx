import { useState } from 'react';

import { copyText } from '../clipboard';
import { openGuide } from '../help/openGuide';
import {
  REPORT_ADDRESS,
  bareFacts,
  canMailReport,
  currentEnvironment,
  failureReport,
  mailtoUrl,
} from '../reportProblem';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  /** Where the report is mailed; a `.invalid` placeholder hides the mail link. For tests. */
  readonly address?: string;
}

/**
 * Why a file would not open (#457), across the top of the workspace: the
 * whole message, wrapped, staying until it is dismissed or something opens.
 * The status bar's line was small, cut off with an ellipsis and faded on a
 * countdown, and people retried the same file because they never read it.
 *
 * Beside it, a problem report (#459): a mailto link for the user's mail
 * client and a Copy report button. The report is built from the structured
 * facts of the failure, never from the message above (it can quote the
 * file). The mail link is not rendered while the recipient is the
 * placeholder (`canMailReport`); Copy report always is.
 */
export function OpenErrorBanner({ address = REPORT_ADDRESS }: Props) {
  const { openError, openFailure } = useEditorState();
  // The report last copied: a later failure has another report, so reads "Copy" again.
  const [copiedBody, setCopiedBody] = useState<string | null>(null);
  if (openError === null) return null;

  const report = failureReport(openFailure ?? bareFacts('other'), currentEnvironment());

  return (
    <div className="open-error" role="alert">
      <span className="open-error__text">{openError}</span>
      <button
        type="button"
        className="open-error__link"
        onClick={() => {
          openGuide('02-files#formats');
        }}
      >
        Supported formats
      </button>
      {canMailReport(address) && (
        <a className="open-error__link" href={mailtoUrl(address, report)}>
          Report this problem
        </a>
      )}
      <button
        type="button"
        className="open-error__link"
        data-tip="Copies a short report with no file name or file content, to paste into an email"
        onClick={() => {
          copyText(report.body);
          setCopiedBody(report.body);
        }}
      >
        {copiedBody === report.body ? 'Copied' : 'Copy report'}
      </button>
      <button
        type="button"
        className="open-error__dismiss"
        aria-label="Dismiss"
        onClick={() => {
          editorStore.dismissOpenError();
        }}
      >
        ×
      </button>
    </div>
  );
}
