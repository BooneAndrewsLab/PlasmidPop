# 88. Back up and restore all documents (#203)

**Asked:** every document lives in one browser profile's IndexedDB, and item
24 made download the only way out, one GenBank file at a time. When the
profile goes away (site data cleared, a new machine, Safari's seven-day
eviction) the weeks of edits go with it, and the guide's answer was "it is
not a backup". Make getting everything out and back one action, keep the
download-only model, and say how safe the storage is.

**What was built.**

- `io/zip.ts` gained `writeZip` beside `readZip` (item 87); both go through
  our interface, and the writer refuses paths the reader would not accept.
- `storage/backup.ts`: `createBackup` and `restoreBackup`. A backup is a ZIP:
  `plasmidpop-backup.json` (format, version, time, counts), `documents/NNNN.json`
  (a document row and its undo history, together) and `tables/<name>.json`
  for the shelf, primers, My parts (#210), enzyme sets and custom enzymes,
  the fidelity table, overhang standards and codon tables. Rows go out as
  stored, so there is no second schema, and a read's typed arrays travel as
  base64 (`{ "$typed": "Int16Array", "data": ... }`). One entry per document
  keeps a large library from being one string, and one bad entry skippable.
- **Restore merges by id and never deletes.** A document is added when
  absent, replaced only by a strictly newer `updatedAt`, kept otherwise; a
  document open in a tab is not touched at all, since the editor would
  autosave its stale copy over the restored one. Other tables merge per row
  by `updatedAt`/`importedAt` where they have one and keep the local row
  where they do not. Rows are validated (document text must parse, history
  must pass `isStoredHistory`); a history that fails is dropped, a document
  that fails is skipped and listed. A newer backup version is refused.
- **Storage status** (`StoragePanel` on the Files tab): document count,
  whether `navigator.storage.persisted()` is true, the last backup (kept in
  localStorage, `plasmidpop.lastBackup`, so per browser), how many documents
  changed since, an alert when the oldest unbacked change is more than seven
  days old, and, for WebKit outside an installed app, that documents may be
  dropped after a week. `mayBeDroppedAfterAWeek` is a user-agent test
  (Safari, or anything on iOS) and so a heuristic.
- **File ▸ Back up all documents…** and **Restore from backup…**, and
  matching buttons in the panel; the result is reported in a dismissible
  banner (`BackupNotice`). Events `file/backup` and `file/restore`.

**Decisions.** A ZIP rather than one JSON, so it opens anywhere and shares
the reader. The backup does not include `localStorage` preferences (view
settings, tab list): they are cheap to set again and not work. Restore does
not open anything. **Open file…** on a backup ZIP is not special-cased: it
would be read as a ZIP of sequence files and its JSON entries skipped, so
the guide says which menu item to use.
