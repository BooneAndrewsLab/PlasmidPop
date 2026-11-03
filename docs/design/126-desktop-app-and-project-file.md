# 126. A desktop app, and a project file that keeps the history

Proposed, 2026-11-03. Nothing here is built. It reverses part of item 24 and
the "No Electron/Tauri for v1" line in `CLAUDE.md`, on purpose: v1 is long
shipped, and users asked for a download that can reach the hard drive.

## Asked for

A standalone PlasmidPop that people download and install, with access to the
file system. Then: could the app tell whether it runs in a browser or in the
installed app and use different file code in each, would a silent write-back
lose undo history, and could our own format keep the history the way a
SnapGene `.dna` keeps its history tree.

## Decisions

- **Tauri, wrapping the existing static build.** Not Electron: the installer
  is a few MB, and there is no Rust to write beyond configuration. The same
  bundle ships to the site and to the app; nothing forks.
- **One `Platform` interface behind `PersistenceService`.** Item 24 already
  sends every open and save through it (`pickOpenFile`, `download`). It
  becomes two implementations, chosen once at startup by
  `window.__TAURI_INTERNALS__`. The Tauri one is a dynamic import, so the
  browser bundle never contains the Tauri API.

  |            | Browser                                                        | Desktop                                                            |
  | ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
  | Open       | picker, returns a `File`                                       | native dialog, bytes read through `plugin-fs`, wrapped as a `File` |
  | Save       | review dialog, then download or one `showSaveFilePicker` write | review dialog, then write to the path                              |
  | Write-back | none (item 24 stands)                                          | `Ctrl+S` overwrites the opened path                                |
  | Extras     | none                                                           | recent files, open-with, file associations                         |

- **Item 24 is reversed for the desktop app only.** It removed write-back
  because browsers disagreed (Chromium wrote silently, Firefox and Safari
  downloaded numbered copies). In the desktop app one platform is involved,
  so silent write-back is consistent there. The browser stays download-only.
- **Write-back keeps undo; reopening a file does not.** A save writes the
  file and leaves the in-memory `History` alone, so undo works after it. The
  history lives in IndexedDB, not in the `.gb`, so opening the file fresh
  starts a new `History` at its contents (item 24). The desktop app links
  the stored document to its path and, when the file still matches the
  checksum of the last write, offers to restore the stored history; when it
  changed outside the app, it starts fresh and says so.
- **An overwrite cannot be undone from outside the app**, unlike a download.
  So each overwrite first keeps the previous contents, the last N versions
  per file, in the app data directory.

## The project file

A zip, since everything in it is text: it compresses well, and `fflate`
is already behind `src/io/zip.ts` (#213), so no new dependency.

| entry           | content                                                    |
| --------------- | ---------------------------------------------------------- |
| `manifest.json` | format version, app version, the checksum of `sequence.gb` |
| `sequence.gb`   | the document as GenBank, written by our own writer         |
| `history.json`  | the edit history (item 5, 51) as diffs, not full copies    |
| `lineage.json`  | the "Made from" tree (item 52), optional                   |

- **GenBank stays the interchange format.** Saving a project always offers
  the plain `.gb` too; the project file is for continuing work, not for
  sending to a collaborator.
- **History is opt-in on export.** It can hold what the user deleted or an
  earlier design they would not hand over. "Include edit history" defaults
  to off for anything that leaves the machine; share links never carry it.
- **Stale history is dropped, not applied.** `manifest.json` carries the
  schema version and the checksum. A history whose checksum does not match
  the sequence, or whose version is newer than the app, is ignored with a
  message.
- **Capped like lineage is.** The size of real sessions is measured first;
  the cap goes in the note once it is.
- **Read defensively.** A project file comes from outside: the entry count
  and sizes are checked before inflating, as `zip.ts` already does.

## Settled in discussion (2026-11-03)

- **No Matomo in the desktop build.** The pitch is no account and no
  server round-trip, desktop users are the ones with unpublished
  constructs, and page views from a webview say little. `VITE_MATOMO_URL`
  stays unset there, which already makes the tracker a no-op. The only
  traffic besides NCBI is a visible update check, which Help can switch
  off. Adoption is read from Release download counts. The service worker is
  skipped under Tauri.
- **Engines.** Windows' WebView2 is Chromium; macOS (WKWebView) and Linux
  (WebKitGTK) are WebKit, which the site already supports in Safari. The
  weak spot is WebKitGTK, whose version depends on the distro and whose
  Canvas and worker performance has lagged: test it first. Fall back to
  Electron (one bundled Chromium, ~100 MB, our own security releases) only
  if Canvas there proves unusable; Tauri's bundled-Chromium (CEF) runtime
  is experimental, check its state before relying on it.
- **Signing, in stages** (prices and programs from memory, verify first).
  Linux needs none (AppImage, deb, rpm). macOS needs an Apple Developer
  account and notarization, which Tauri's CI action does from secrets.
  Windows is hardest: certificates must sit on hardware or in a cloud
  signing service, and SmartScreen warns until reputation builds. Tauri's
  updater has its own free key, separate from OS signing. Ask the
  university whether it holds an Apple account or a Windows certificate.
  First releases: Linux plus unsigned Windows and macOS builds for the lab,
  with a guide page on opening them anyway; sign when others use it.

## To settle before building

- Canvas, Web Worker and SVG-based canvas checks on each webview.
- Releases: installers built by a CI matrix and attached to the same GitHub
  Release that deploys the site.
- `CLAUDE.md` loses its "No Electron/Tauri" and "native desktop packaging"
  lines when this is accepted.
