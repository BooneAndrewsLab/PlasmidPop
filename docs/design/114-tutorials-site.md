# 114. Tutorials as a standalone site section

Issue #312, built 2026-10-28. The cloning tutorials were one long README and
one Golden Gate page in `docs/tutorials/cloning`, readable on GitHub only. They
are now a section of the site, `/tutorials/`, built the way the guide's static
pages are (item 91, #231, #244), with an index where a reader picks the method.
Issue #313 adds the other methods as pages of the same shape.

## Source layout

`docs/tutorials/` holds one Markdown page per tutorial and the sample files:

- `README.md`, the index: a list of methods, each with a line of what you make,
  the level and time, and its files as downloads;
- `before-you-start.md`, linked from every tutorial: opening the files, what the
  Bench is, enzyme ticks, scratch documents, the NCBI box, and what to do when a
  number does not match;
- `digest-pcr.md`, the Cloning tab's Digest and PCR (item #313's last page),
  which the others build on;
- `ligation.md`, `golden-gate.md`, `golden-gate-parts.md` (Golden Gate
  Tutorials 2 and 3: four parts, and the warnings);
- `sample-files.md`, the table of every file, each a plain download;
- `files/*.gb`, the synthetic samples. They moved out of `cloning/` so one folder
  is what the build publishes. The tests read them from there.

Links in the Markdown are repo-relative so they work on GitHub: `ligation.md`,
`README.md` (the index), `files/GG-gene.gb`, `../guide/12-cloning.md#the-bench`.
The builder maps them to site URLs. No NCBI record is anywhere in the folder or
in the build; the NCBI-gated tests read the gitignored fixture inside
`beforeAll` and skip when it is absent.

## Build

`src/app/help/staticTutorials.ts` is pure, like `staticGuide.ts`, and reuses its
renderer, theme and document shell. What `staticGuide.ts` gained to allow it: a
`LinkContext` (where a page is and how its Markdown links resolve) in place of
the bare directory, and a `SiteSection` (header name, index link, footer) for
`document`. The guide's output is byte for byte what it was; its exact-HTML
tests are unchanged.

`TUTORIAL_ORDER` is the reading order of the pages after the index. The pager
runs along it, with a link back to the index in the middle. A page in the folder
that is not in the list, or the other way round, fails the tests.

Emitted: `tutorials/index.html`, `tutorials/<id>/index.html`, and
`tutorials/files/<name>` for every `.gb` or `.fasta`, linked with `download`.
The sitemap lists the index and the pages. The dev server serves them from the
folder on every request, as it does the guide; `.gb` files as `text/plain`. The
service worker neither precaches nor falls back to the section.

## Links in

The guide README, Getting started and Simulated cloning link to the tutorials by
their absolute URL (a relative link would be wrong inside the app's dialog,
which resolves only guide pages). The Help dialog has a Tutorials link beside
the version that opens `${BASE_URL}tutorials/` in a new tab. The noscript
notice in `index.html` and the repo README link it too.

## The Markdown subset grew with the tutorials

The tutorials put tables and notes inside numbered steps and use `[ ]`
checkboxes and `_italics_`, which the guide's parser did not read: a table
indented under a step ran into the paragraph, the numbering restarted after
it, and the checkboxes showed as text. The parser now keeps indented blocks
(tables, paragraphs, sub-lists) inside their list item, honours the number a
list starts at, reads `[ ]` / `[x]` at the start of an item as a tickable
checkbox (uncontrolled, so a reader ticks steps off) and `_x_` as italics at
a word boundary (`snake_case` is left alone). Both renderers, the app's and
the static one, handle the new nodes.

## Not done

An "Open in PlasmidPop" link per sample file, through the share-link fragment
(item 11), is left as a follow-up: the fragment carries the document at the
app's root, which needs the link built from the file at build time.
