# 24. One way out: download, never write

Done, 2026-09-21, replacing
the write-back half of item 22. The File System Access API was doing two
jobs — picking a file to read, and holding a handle to write back to —
and the second one made the app behave differently per browser: Chromium
users' `Ctrl+S` wrote silently to a file, Firefox and Safari users got a
new numbered download every time (`pBR322_copy(1).gb`, reported by the
user and not fixable from the page, since those browsers will not let one
ask where a download goes). One model everywhere is worth more than
write-back for one browser family:

- **File ▸ Download GenBank… (`Ctrl+S`, `Ctrl+Shift+S`)** is the only way
  sequence leaves the app (`PersistenceService.download`). A working copy
  is reviewed first — `SaveReviewDialog`, now shown before _every_
  download rather than once — and the dialog's own button is the user
  gesture the save dialog needs. Where the File System Access API exists
  the write still goes through `showSaveFilePicker`, so the user can
  replace their own file; the handle is used for that one write and
  dropped. `downloadNameFor` offers the name the document was last
  written under (never the origin's), so replacing is one click.
- **No handles are kept anywhere.** `fileHandle`, `written`,
  `overwritePrompt`/`OverwriteDialog`, `writeBackTarget`,
  `ensureWritePermission`, the repository's handle methods and Dexie's
  `handles` table are gone (version 4 drops the table, which also drops
  handles an older build stored — none may survive a reload). `pickOpenFile`
  returns a `File`, not a handle.
- **The fork resets the history.** The first edit of a document with an
  origin starts a new `History` at the file's contents _under the copy's
  name_ (the user's name when that edit is their rename, and then there
  is no step to record). So undo reaches what the file holds and stops
  there, `savedDoc` becomes null, and the per-edit re-naming that item 22
  needed — the name travelled with undo, so every edit had to check it —
  is deleted. `CopyBanner` names the copy and renames it in place
  (`InlineRename`), because that name is what the download will be called.
- **"Dirty" means "changed since the last download."** The unload warning
  is gone (nothing is bound to a file and the session comes back); in its
  place `useFlushOnLeave` writes the open documents on `pagehide` and on
  `visibilitychange`, which is what that dialog was really protecting.
  The first autosave asks for persistent storage
  (`requestPersistentStorage`: Chromium decides, Firefox asks the user),
  so the browser does not evict documents when space runs low. The Edits
  menu's second baseline is **Since last download**, and for a copy that
  has never been downloaded it falls back to the file it came from.
- **Coming up from an older build is covered by a test**
  (`src/storage/migration.test.ts`): anyone who used the deployed site has
  a Dexie version 1 database with a `handles` table, so version 4 drops
  that table under them in one open. The documents survive it, they read
  back as neither `derived` nor having an `origin`, and the tab that build
  remembered reopens — it wrote only `plasmidpop.lastDocument`, never the
  `openDocuments` that `restoreLastSession` prefers.
- **The persistent-storage request is explained before it is made**
  (2026-09-22). A user reported Firefox's "store data in persistent
  storage" dialog appearing, unexplained, after their first file was
  opened. `requestPersistentStorage` now asks the Permissions API first:
  where the state is `prompt`, `StorageNotice` (a banner under the
  toolbar, the same shelf as `DownloadNotice`) says where the documents
  are and why the browser will ask, and **Keep my documents** makes the
  request from the click, so the dialog follows the user's own action.
  The answer is reported rather than assumed: Chromium also answers
  `prompt` and then refuses in silence unless the app is installed,
  bookmarked or used often (checked in Chrome 147), so a refusal gets a
  second sentence and the guide says what helps. The choice is
  `plasmidpop.storageChoice` in localStorage (`state/storageChoice.ts`):
  `keep` asks silently every session until granted, `no` never asks. The
  start screen carries one priming sentence about it, and the guide's
  Usage statistics section explains Chrome's _local network_ prompt,
  which is the Matomo host resolving to a private address on the lab
  network and nothing the app can change.
- Not yet: nothing tells the user which stored documents have never been
  downloaded (every document lives in the browser now, so a per-row
  marker would be noise — the Files screen says it once instead).
  **File ▸ Compare with…**, the obvious companion to this, is item 33.
