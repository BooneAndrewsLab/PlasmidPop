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
- Not yet: a link is GenBank only, so SnapGene-specific material a
  `.dna` import dropped is not in it.
- **Decided 2026-09-24 (#40):** the limit stays at 32,000 characters. It
  sits well above a typical plasmid (pBR322 with its features is 10.8 k)
  and far below what browsers accept, so the question is what the apps a
  link is pasted into do with it; #41 measures that, and if some mangle
  shorter links the share notice gets a warning tier from those numbers,
  not from a guess. A document opened from a link stays the reader's own,
  as above: the sender's file is not the reader's, so there is nothing to
  fork a working copy from or compare the edit marks against, and the
  `derived-from` line already says where it came from.

## Shorter links (#39, 2026-09-25)

- **File ▸ Copy link to selection** shares the selection as a document of
  its own: `extractRange`, the path **Export selection as GenBank** takes,
  so a selection link and an exported selection are the same record —
  linear, features trimmed and marked partial, wrapping the origin if the
  selection does. `extractRange` now keeps the sticky end of a linear
  molecule that the range reaches (only with its single-stranded bases
  inside the range); an end it stops short of is blunt. That changes
  Export selection as GenBank the same way, which is the point of their
  being one path. `Alt+L` stays the whole document.
- **References and comments, as a fallback, not a checkbox.** Leaving out
  the REFERENCE blocks and the COMMENT blocks a record was read with
  (`withoutReferences`, `src/app/share.ts`) is done only when the whole
  link is over the limit and the shorter one is under it; the notice then
  says "Too long with its references and comments (N characters); share
  link copied without them — M characters". A checkbox was the other
  choice. It lost because under the limit there is nothing to gain that
  #40 has not already weighed: 32,000 is the length a link is decided to
  survive at, so a link that fits loses nothing and asks nothing, and one
  that does not fit gets the only thing that would have made it fit
  instead of a refusal. A checkbox would be a setting to find and a choice
  to make on every copy for the rare document that needs it. If #41 finds
  apps that mangle shorter links, the same function makes a default of it.
- **What goes, and what never does.** References and the file's own
  comments describe where the record was published, not the construct;
  in an NCBI record they are most of the header. Everything that is a
  field of the document stays, including what rides in comments of ours
  (sticky ends, host methylation, derived-from, made-from), because those
  are written from their fields, not from `comments`. Never features,
  qualifiers or bases. Other header lines (KEYWORDS, SOURCE, DBLINK,
  unknown keywords) are a line or two each and stay.
- **Too long even so**: the error says it was measured without the
  references and points to a link to a selection or the file.
- **Usage**: `share / copy` is named `document` or `selection`;
  `share / without-references` counts the fallback.
- **Measured** (payload characters, whole → without references and
  comments; the last two columns are a link to the first 1,000 bases,
  whole → without):

  | Fixture         | Length | Refs |  Whole | Without | Saved |  1 kb | 1 kb without |
  | --------------- | -----: | ---: | -----: | ------: | ----: | ----: | -----------: |
  | AJ237582        | 206 bp |    2 |  1,289 |   1,012 |   21% | 1,289 |        1,013 |
  | AF177870        | 3.1 kb |    3 |  3,913 |   3,437 |   12% | 2,447 |        1,973 |
  | L09137          | 2.7 kb |    5 |  4,467 |   2,181 |   51% | 3,349 |        1,091 |
  | U49845          | 5.0 kb |    2 |  5,623 |   5,277 |    6% | 2,644 |        2,313 |
  | pBR322 (J01749) | 4.4 kb |   23 | 10,884 |   5,831 |   46% | 7,256 |        2,220 |
  | NC_001422       | 5.4 kb |   24 | 11,367 |   7,325 |   36% | 7,197 |        3,195 |
  | NM_000581       | 899 bp |   10 |  6,599 |   2,609 |   60% | 6,597 |        2,609 |

  The references are up to 60% of a link, most for a heavily cited
  record; a selection keeps them, as an exported selection does, so a
  selection of an NCBI record is shorter by its bases and features only
  (pBR322's first kilobase: 7.3 k) until the fallback applies. None of the
  fixtures reaches the limit, so the fallback is for the documents that
  would have been refused: a record with a few dozen long references.
