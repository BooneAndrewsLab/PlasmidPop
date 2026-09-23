# 11. Sharing, without a backend

Done, 2026-09-21. The backend was
dropped as a goal the same day: auth, sync and team libraries bought
nothing the app needs, and a static site on GitHub Pages — no origin to
run, nothing to keep up, no account between a scientist and their
plasmid — is worth more than all three. Sharing was the one piece
wanted, and it needs no server, because **the document travels in the
URL fragment**.

- **File ▸ Copy share link** puts `…/#d=<payload>` on the clipboard
  (`copyShareLink` in `src/app/share.ts`). Everything after `#` is never
  sent in the HTTP request and is left out of `Referer`, so the sequence
  reaches whoever the link is sent to without touching Pages, us, or
  anyone's log — the same promise as the rest of the app rather than a
  carefully-worded exception to it.
- **The payload** is `writeGenBank(doc)` through `CompressionStream
('deflate-raw')`, base64url, behind a `1` that says which encoding it
  is (`src/io/share/link.ts`). GenBank rather than a format of our own:
  the writer and parser are already tested against real files, and the
  ends comment rides along, so a linear molecule keeps its overhangs.
  `Blob.stream` is not used — jsdom has no such thing — so the codec
  feeds one buffer through the stream by hand, not awaiting the write
  before reading or a buffer past the queue size would deadlock.
- **Measured**: AJ237582 (206 bp) 1.3 k characters, AF177870 (3.1 kb)
  3.9 k, L09137 (2.7 kb) 4.5 k, U49845 (5 kb) 5.6 k, pBR322 (4.4 kb)
  10.8 k, NC_001422 (5.4 kb) 11.3 k. `MAX_SHARE_PAYLOAD` refuses past
  32,000 with the length in the message and a word about downloading the
  file instead. A cleverer encoding would not raise that ceiling: of
  pBR322's 10.8 k, the ORIGIN block is 2.1 k of the compressed bytes and
  the header, references and 50 features are 5.8 k — it is the
  annotation that fills a link, so two-bit packing the bases would save
  about 1 k of 8 k and cost a format of our own.
- **Matomo would have posted the whole fragment.** The tracker takes
  `window.location.href` unless told otherwise, so a page view from an
  opened share link would have sent the entire compressed sequence to
  the analytics instance — the one thing `analytics.ts` promises never
  to send. It now pushes `discardHashTag` and an explicit
  `setCustomUrl` of `trackableUrl()`, with a test that a page carrying a
  fragment reports a URL without one.
- **A shared document is the reader's own.** It opens with no file name
  and no origin (`openSharedPayload`), so there is nothing to fork a
  working copy off and "dirty" keeps its meaning — not downloaded in
  this browser yet. The fragment comes off the address bar before
  anything else (`takeShareFragment`, `history.replaceState`), so the
  sequence is not left in the URL or in the browser's history; that also
  makes the effect safe to run twice, as React does in development. The
  restore of the last session runs first and the shared document opens
  last, so it is the tab in front and the session's own tabs are behind
  it rather than replaced.
- **`Alt+L`** copies one without opening the File menu (item 32).
- **`ShareNotice`** under the toolbar says what was copied — the length,
  that nothing was uploaded, and that anyone with the link can open it —
  and takes itself away after twelve seconds. A link cannot be withdrawn
  or updated, which the guide says plainly (`docs/guide/02-files.md`,
  "Sharing a link").
- **A shared working copy now says where it came from** (2026-09-22): the
  `PlasmidPop-derived-from:` comment of item 22 is written by
  `writeGenBank`, so it is inside the payload and the reader sees the
  original's checksum and file name under the toolbar.
- Not yet: a link always carries the whole document
  (a selection, or a document without its references, would make a much
  shorter one), and a link is GenBank only, so SnapGene-specific
  material a `.dna` import dropped is not in it either.
