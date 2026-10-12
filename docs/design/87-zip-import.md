# 87. Open a ZIP of sequence files (#213)

**Asked:** a lab leaving Benchling gets a bulk export, a ZIP of hundreds of
GenBank files, and PlasmidPop opened one file at a time. Open should take a
ZIP (and several files), import every sequence in it, skip and list what it
cannot read, keep folder names, summarise, and keep duplicates apart. The
reader should be shared with the backup archive of #203.

**What was built.**

- `io/zip.ts`: our own interface, `readZip(bytes, limits)` returning
  `{ entries: {path, data}[], skipped }`, and `isZip`. The library is fflate
  (MIT, no dependencies, 8 kB-ish tree-shaken); only this file imports it, so
  the restore of #203 (and a writer, when it needs one) goes through the same
  seam and the library can be swapped. Chosen over JSZip (larger, async-only)
  and the platform, which has no ZIP reader.
- Safety, since an archive is untrusted input: limits are checked from the
  central directory before anything is inflated (5,000 entries, 64 MB per
  file, 512 MB in all; over the count or total is a refusal, one big file is a
  skip); folders, `__MACOSX/`, dot-files and `Thumbs.db` are dropped silently;
  names that are absolute or contain `..` are skipped with a reason (nothing
  is ever written to disk by name, but a name that lies is not worth keeping).
- `io/archive.ts`: `readSequenceArchive` runs `readSequenceData` on each entry
  (so `.gz`, SnapGene and AB1 inside a ZIP work) and returns records
  (`path`, `fileName`, `folder`, document, warnings) and what was skipped and
  why. One bad file never stops the others. Read formats (FASTQ, AB1) keep
  their first record, as opening them alone does.
- App: `openFiles` (File ▸ Open picker with `multiple`, the hidden input's
  `multiple`, and drop all go through it). One non-ZIP file is `openFile`
  exactly as before; several files or a ZIP are a batch, opened as a tab each
  and reported by `ImportSummaryDialog` (opened, already open, skipped,
  per-record warnings). `openFile` also hands a ZIP to the batch, so share
  target and the Compare dialog's file path do not choke on one.

**Decisions.**

- Folder as a tag: the app has no label or tag on a document, and adding one
  to the model for this would be a model change with a migration. GenBank
  `KEYWORDS` is the standard place for a free tag, survives a round trip and
  is searchable with the document metadata, so the folder path goes there.
- Duplicates: documents are keyed by id, not by name, so same-named files are
  separate tabs and nothing is overwritten. A byte-identical file already
  open still goes to its existing tab (the rule `openDocument` has always had)
  and the summary counts it as already open rather than hiding it.
- A tab per record. Hundreds of tabs is clumsy, but the Files tab lists stored
  documents and it is the only way a document is kept today; a bulk import
  into storage without tabs belongs to the Files tab work of #203.
- Detect features on open is not run per file of a batch: hundreds of worker
  runs, and a bulk import is the user's own annotated library.
- Parsing happens on the main thread, file by file (`await` between them so
  the page paints). Measured nothing yet; if a 500-file export proves slow
  it moves to a worker.

**Not done.** Zip export (the backup of #203 will add a writer next to the
reader). Tracked changes or history inside a ZIP are not a thing.
