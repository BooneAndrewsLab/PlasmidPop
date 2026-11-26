# 156. Report this problem: a prefilled email the user sends (#459)

## What was asked

The corpus run showed failures the app could describe but the author never
heard about. A banner link should let a user tell us, without an account,
without a backend (there is none, and stays none) and without the app sending
anything: it opens the user's mail client on a prefilled message, or copies the
same text for people with no mail client.

## What was built

- `src/app/reportProblem.ts` builds the report. **Structured facts only**:
  there is no parameter through which the failure's message, the file name or
  any text of the file could arrive (the message can quote the first 20
  characters of the file, item 154). The body holds version and build date
  (`__APP_VERSION__`, new `__BUILD_DATE__` from `vite.config.ts`), browser and
  OS family by name, the reason (`OPEN_FAILURE_REASONS`) with one fixed sentence
  each (`REASON_EXPLANATIONS`), the format guessed from the extension
  (`formatOfFileName`, as the `open-failed` event does), line, section, records
  read before the failure, size in bytes, the extension only if on a fixed list
  (else `other`), and a content class (text, binary, UTF-16, gzipped). It ends
  "If you are willing to share the file, attach it to this email; nothing was
  sent automatically." Subject: `PlasmidPop problem report: genbank:parse-error
(1.27.0)`. The whole mailto URL stays under 1500 characters (tested with the
  largest values).
- `FormatError` gained `section` (`header`, `feature table`, `sequence`) and
  `recordsParsed`, set where #461/#465 already name sections: the GenBank
  LOCUS, JSON-escape and invalid-base failures, and the FASTA header, escape
  and invalid-base failures (FASTA also counts records read). Any other failure
  reports the section as `unknown`; nothing is guessed.
- `SharedState.openFailure` holds the facts beside `openError` and is cleared
  with it; `editorStore.failOpen(message, facts?)`. `openFile`, `openText` and
  `openPastedText` pass facts (the file's bytes give size and content class);
  other `failOpen` callers report the reason only.
- `OpenErrorBanner`: **Report this problem** (an `<a href="mailto:...">`) and
  **Copy report** (`copyText`, the text identical to the mail body; the button
  reads "Copied" afterwards).
- Warnings: the status bar's "N warnings while opening" list shows the same two
  choices (content may have been left out). The report lists the warning count
  and, per fixed category (`Feature table`, `Sequence`, `Feature table and
sequence`, `Skipped feature`, `Record left out`, `Extra records`, `other`,
  chosen by how the text begins), the count and up to 8 line numbers; never
  warning text. The import summary dialog (a batch of files) was not given it:
  it holds many files, so one report would need a per-file choice; left for a
  follow-up if wanted.

## The recipient is a placeholder, and the mail link hides while it is

`REPORT_ADDRESS` is `problem-reports@plasmidpop.invalid`: the real mailbox does
not exist yet, and `.invalid` is a reserved TLD that can never resolve.
**While the constant ends in `.invalid`, the "Report this problem" link is not
rendered** (`canMailReport`); Copy report always is. So a release cannot ship a
dead mailto; to switch the link on, set the real address and nothing else.
Tests cover both states (the banner and the status bar take the address as a
default, the banner as a prop). No real person's address is used anywhere.

## Decisions

- **No analytics event.** The click happens in the user's mail client or the
  clipboard, which the app cannot see for the mailto, and a count of clicks
  tells us less than the reports do. Nothing was added to item 38's catalogue.
- The copy text is the body only (the subject is in the mail draft; a pasted
  report starts with the version line).
- Format comes from the extension, not from the content, as in the analytics
  event; a file with a wrong extension reports `other` or the wrong format, and
  the content class and reason say what happened.
- Privacy: the guide's "Reporting a problem" section lists exactly what the
  report holds and says it is sent only by the user.

## Tests

`src/app/reportProblem.test.ts` (a report per reason, section and line from real
parser failures, the marker string `SECRETMARKER-xyz` in file name, text and
message never reaching subject, body or URL, length cap, fixed lists, warning
report), `OpenErrorBanner.test.tsx` (placeholder gating, mailto without the
marker, copy text equal to the decoded mail body) and `StatusBar.test.tsx`.
