# 58. Open a GenBank record from NCBI by accession

Done, 2026-09-25 (#65; `src/io/ncbi/`, `src/app/openFromNcbi.ts`,
`src/app/components/NcbiDialog.tsx`). Asked for: open a record by accession
(`L09137`, `NC_001422`) without downloading it first. The open question on
the issue was that this is the app's first request to a third party besides
Matomo. Decided 2026-09-25: go ahead in 1.7, as an action the user starts
explicitly, with the guide and the privacy text saying that only the
accession is sent, and to whom; no API key. Nothing is sent unless the user
asks.

## Does efetch answer a browser? Yes

Checked with curl on 2026-09-25, with an `Origin` header of another site:

- `GET efetch.fcgi?db=nuccore&id=L09137&rettype=gbwithparts&retmode=text`
  answers `200`, `content-type: text/plain`,
  `access-control-allow-origin: *`, and exposes `X-RateLimit-Limit: 3` and
  `X-RateLimit-Remaining`. A preflight (`OPTIONS`) answers `200` with
  `access-control-allow-origin: *`, `access-control-allow-methods:
GET,HEAD,POST`, and a day's `max-age`; a plain GET with no custom headers
  needs none anyway.
- `db=protein&rettype=gp` answers the same way, with CORS, for
  `NP_000508`.
- **A 429 carries no `access-control-allow-origin`.** Eight requests at once
  got three `200`s and five `429`s (`retry-after: 2`, a JSON body), and the
  `429`s had only `access-control-expose-headers`. A browser therefore sees
  the rate limit as a failed fetch (a `TypeError`), which it cannot tell
  from being offline or blocked.

How NCBI says "no such record" varies, and none of it is a 404:

- A well-formed accession it has no record of (`AB999999`), or a protein
  accession asked of `nuccore`: `400`, with a URL-encoded body
  `+Error%3A+CEFetchPApplication…Failed+to+retrieve+sequence…`.
- Something it cannot read as an id (`ZZ999999`, `L09137xx`): `200`, with a
  body `Error: F a i l e d  t o  u n d e r s t a n d  i d : …` (the letters
  really are spaced).
- Several ids where some are missing (`L09137,AB999999`): `200`, with only
  the records it has, and no word about the others.
- Asked by a secondary accession (`X02514`), it answers that record, whose
  `ACCESSION` line lists it; asked for an old version (`L09137.1`), that
  version.

## What was built

**File ▸ Open from NCBI…**, **From NCBI…** in the toolbar when nothing is
open, and a link on the start screen open a small dialog: an Accession box,
a line saying what is sent and to whom, **Cancel** and **Open**. Nothing is
sent until Open.

- **The format is checked first** (`accessionKind`): INSDC nucleotide
  (1+5, 2+6, 2+8), WGS/TSA (4+8–10, 6+9–11), MGA (5+7) and RefSeq
  nucleotide prefixes, each with an optional version. A typo costs no
  request, and only something shaped like an accession ever leaves. A GI
  number is refused as not an accession: they are retired, and a bare
  number would be ambiguous between the two databases. A pasted NCBI address
  counts as its last path segment.
- **Protein accessions** (`NP_`, `XP_`, `WP_`, `YP_`, `AP_`, and INSDC
  3+5 / 3+7) were refused at first, since protein documents were still
  being built; they open since #92 (below).
- **Several accessions, one request**: separated by spaces, commas or
  semicolons, up to 20, as one comma-joined `id=`. Each record opens in a
  tab of its own, the last in front. Which ones NCBI left out is worked out
  from the records' `ACCESSION` and `VERSION` lines (primary, secondary and
  versioned all count) and named in a warning on the tab in front.
- **The rate limit** (3 requests a second without a key): one request for
  everything typed, at least 400 ms between requests from the page, and one
  retry after NCBI's 2 s when the first fails — whether as a visible `429`
  (honouring its `Retry-After`) or, as it actually arrives, as a failed
  fetch. `navigator.onLine` false is reported as offline, without a retry.
- **Size**: records over 10 Mb (the non-goal) are refused on their LOCUS
  line, read as the answer streams in, and the stream is cancelled — a
  chromosome is turned away in its first kilobyte. The whole answer is also
  bounded (128 MB) whatever the records claim. Bytes received are shown
  while it runs.
- **Cancel** aborts the fetch (an `AbortController`), and closing the dialog
  any other way does too; a cancel is not reported as an error.
- **Opening** goes through `parseGenBank` and `editorStore.openParsed`, as a
  file does, with the file name `<accession>.gb` and no origin: there is no
  file on the user's disk behind it to fork a working copy from (as for the
  bundled example). The file name is what Recent files shows and what
  opening the same accession again finds its tab by. The document keeps the
  name on its LOCUS line (`L09137` is `SYNPUC19CV`), exactly as opening the
  downloaded file would, rather than being renamed to the accession: the
  record stays what NCBI wrote.

## Protein accessions (#92)

Added 2026-09-25, once protein documents (item 57) were in. A protein
accession goes to `db=protein&rettype=gp&retmode=text` and the GenPept that
comes back goes through the same `parseGenBank`, which reads `aa` on the
LOCUS line as a protein; the file name is `<accession>.gp`. Checked with curl
the same day: the protein database answers exactly as nuccore does — `200`
with `access-control-allow-origin: *` for a record, `400` with the URL-encoded
`CEFetchPApplication` body for a well-formed id it lacks (`XP_000001`), the
spaced-out `Error: F a i l e d  t o  u n d e r s t a n d` with `200` for a
nucleotide accession asked of it, and only the found records for a list.
(`NP_999999` is a real rat protein, so it will not do as a missing one in
tests.) Tried in the dev server against NCBI: `NP_000509 L09137 XP_000001`
opened pUC19 and HBB (147 aa, protein) and named `XP_000001` as missing;
`AB999999 XP_000001` kept the dialog open saying neither kind was found.

- **A mixed list is two requests**, one per database, since efetch takes one
  `db`. They go one after the other through the same `send`, so the 400 ms
  gap and the retry after a failure or a `429` apply to each; nucleotide
  first, then protein, and the tabs open in that order (the typed order
  across the two kinds is not kept — not worth a merge for a rare list). The
  20-accession cap is on the whole list.
- **Reconciliation per database**: each answer's `ACCESSION`/`VERSION` lines
  are matched against what was asked of that database, and a database that
  answered "none of these" (`not-found`) counts all its accessions as
  missing. One warning names them by kind: _NCBI has no nucleotide record
  AB999999 and no protein record XP_000001._
- **One request failing does not lose the other's records.** If the other
  kind came back, its records open and the failed accessions are named with
  the reason (`NP_000509 not opened: Could not reach NCBI…`); each failure is
  counted as `open-ncbi-failed` by its kind. Only when nothing came back is
  it an error in the dialog: both not found gives the combined message,
  otherwise the failure that is not "not found". A cancel during either
  request opens nothing.
- **Size**: the LOCUS check reads `aa` as well as `bp`, and a protein past
  the limit is refused in residues. Progress counts bytes across both
  requests.
- **What is sent** is unchanged: the accessions, `db`, `rettype`, `retmode`
  and `tool=PlasmidPop`, now to one database or both.

## What is sent, and what is not

The URL is `db`, `id`, `rettype`, `retmode` and `tool=PlasmidPop`; the
request is sent with `credentials: 'omit'` (NCBI sets an `ncbi_sid` cookie
otherwise) and `referrerPolicy: 'no-referrer'`, with no headers of our own.
NCBI's usage policy asks for `tool` and `email`: `tool` identifies the
program, and `email` is meant for the _developer_ of the tool, so NCBI can
get in touch before blocking it. The user's address must not go there, and
the project has no contact address of its own to give, so none is sent. No
API key either: it would have to ship in the page for anyone to read, and 3
requests a second is ample for a person typing accessions.

The guide (`02-files.md`, _Opening a record from NCBI_ and _Usage
statistics_; `01-getting-started.md`), the start screen and the dialog
itself say that only the accession numbers go, to NCBI, and when. The
usage-statistics text that said "the editor does not use the network at
all" now names this one exception.

## Usage statistics

`file / open-ncbi` when at least one record was fetched, and
`file / open-ncbi-failed` named by the error kind (`not-found`, `offline`,
`network`, `rate-limit`, `too-large`, `server`, `not-genbank`). Never the
accession, nor how many were asked for — an accession is exactly the kind of
scientific data item 38 keeps out. Each record opened is also an ordinary
`file / open genbank`.

## PWA and CSP

No change needed. There is no Content-Security-Policy (no meta tag, and
GitHub Pages sends no header), so `connect-src` does not arise. The service
worker's only runtime route is the share target's POST; workbox does not
intercept a cross-origin GET it has no route for, so the request goes
straight to the network, and offline it fails as `offline` above.

## Follow-ups

- Perhaps name the tab by the accession when the LOCUS name is an opaque
  one (`SYNPUC19CV`), if users find it confusing.
