# 151. A failed open is a banner, not a status bar line (#457)

## What was asked

Matomo showed the same failed open fired four times from one visit: the
reason was shown only as small red text at the bottom, cut off with an
ellipsis and faded on a countdown, so people retried the file instead of
reading why it failed.

## What was built

- `SharedState.openError` is a second, separate error slot.
  `editorStore.failOpen(message)` sets it (and clears the status bar's
  `error`, so the words are not said twice); `dismissOpenError()` clears it;
  `openDocument` clears it, so the next successful open of anything ends it.
  It has no timer.
- `OpenErrorBanner` (`role="alert"`) renders it in `App.tsx` under the
  toolbar and tab strip, in every layout including the empty state, which is
  where a first failed drop happens. The grid gained a row for it (absent
  when there is no failure, so it takes no space). The text wraps in full; the
  buttons are **Supported formats** (the guide's table, `02-files#formats`,
  through `openGuide` like the other notices) and **×**.
- Routed to the banner: `openFile` (unsupported, unreadable, parse failure),
  `openText`, `openPastedText`, `openParsed`'s "no sequences", the share
  target's received files, and the installed-app launch handler. Everything
  else (`fail`: save, storage, rejected keystrokes, NCBI search, comparison,
  assemblies) stays a status bar line.
- No dismiss key: nothing in the app binds one to a notice, so the shortcuts
  page is unchanged.
- Colours are the `--danger` tokens, which have a dark variant; the banner
  wraps at phone width.
- Tests: `src/app/components/OpenErrorBanner.test.tsx`.
