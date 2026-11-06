# 138. Searching the guide

Issue #409, built 2026-11-06. The guide had a page list and nothing else: to
find where `dam` or `Ctrl+Shift+Z` is explained a reader opened pages one at a
time. This adds a search box to the guide in the app and to the static
`/guide/` pages, over the text of the 17 pages.

## Decisions

- **Hand-rolled, no dependency.** MiniSearch was measured on the same sections
  (perf-notes, "Searching the guide"): 6.6 kB gzip against 1.7 kB for the whole
  of ours, faster to query and slower to build, and neither difference matters
  at 195 sections. What the guide needs is small: every word must match, the
  last may be a prefix, a heading beats the text. That is 150 lines of pure
  TypeScript with tests, which also lets the static pages run it unchanged.
- **One module, `guideSearch.ts`**, with no imports (types excepted): tokenise,
  index, rank, snippet, and `pack`/`unpack` for the static index. The
  Markdown side, `guideIndex.ts`, cuts the parsed pages (`parseMarkdown`, so
  what is searched is what is rendered) into sections, one per heading, with
  the plain text under it. The dialog and the static pages both index
  `guideSections`.
- **Sections, not pages.** A result is a heading: its page, its heading, its
  anchor (`headingSlug`, the id both renderers give the heading) and a snippet.
  A page is 20 to 30 kB of text; "which page" is not an answer to "where is it
  said".

## Matching and ranking

- Tokens are runs of letters and digits, lower-cased, accents removed
  (NFD, marks dropped): `Ctrl+K` is `ctrl` and `k`; `BsaI`, `H840A` and `dam`
  stay whole. Nothing from the query is ever made into a regular expression.
- Every query word must be in the section (heading, page title or text). The
  last word may be the start of a word, since it is still being typed; the
  words before it are whole words. So `enz list` finds nothing and `enzyme li`
  finds the list.
- Score per word, summed: heading 10 (exact) or 8 (prefix); the page's title 4
  or 3; the text 2 or 1, plus a quarter for each further occurrence, up to
  three. A heading hit outranks any text hit however often the text says it.
  Ties keep the guide's order, so a result list does not shuffle.
- A snippet is about 160 characters from 40 before the first matching word, cut
  at spaces, with `…` where it does not reach an end, and the offsets of the
  words to highlight. When only the heading matched, it is the section's
  opening.

## In the dialog

A search box above the page list (its placeholder, `Search the guide`, is
`SEARCH_PLACEHOLDER`, shared with the static pages). With something typed, the
results stand where the page does and the page is hidden, not unmounted, so its
scroll position is there when the box is cleared. Each result is a button:
page, heading and snippet with `<mark>`s. Click or `Enter` (first result) opens
the page at the heading by the dialog's own `anchor` state; a counter makes
opening the heading the page is already at scroll again. `↓` goes from the box
to the results, `↑`/`↓` between them, `↑` from the first back to the box.
`Escape` clears the box (and keeps the dialog) before the next `Escape` closes
it.

`/` and `Ctrl+K` (`Cmd+K`) inside the dialog focus the box. Checked against
`14-shortcuts.md` and `keyBindings.ts`: no `/` or `Ctrl+K` binding exists
(`Alt+K` is bound, and is not touched), `?` opens the guide and ignores text
fields, and the handler is on the dialog, so it fires nowhere else. `/` is
ignored in a field. Both are listed in the Help table of the shortcuts page.

The index is built on the first keystroke and kept (about 90 ms once; each
search 3 to 6 ms), not when the dialog opens. It stays in the main chunk
(+1.7 kB gzip) because the guide's Markdown is already there and a chunk of its
own would be a second request for less than the request costs.

## On the static pages

`guide/search-index.json` (the sections, packed: each page's id and title once;
384 kB, 129 kB gzip) and `guide/search.js`, a module script that is
`guideSearch.ts` compiled by Vite's `transformWithOxc` (types stripped, nothing
else) followed by the box's own code (`SEARCH_UI` in `staticGuide.ts`). One
source for the ranking means the page cannot rank differently from the dialog;
`staticGuideSearch.test.ts` builds the script the way `vite.config.ts` does,
runs the compiled ranking beside the TypeScript on a fixed set of queries and
asserts identical results, then runs the whole script in jsdom against the real
index.

- **Without JavaScript the pages are as they were**: the header's form is
  `hidden` and the script shows it. No `noscript` note: a missing box says
  nothing a reader needs.
- The index is fetched when the box is first focused, not with the page. The
  script is cached, so it is the same file on every page. Neither file is in
  the service worker's precache (`guide/**` is ignored).
- The tutorials' pages have no box: they use the same `document()` and opt out
  (`SiteSection.search`).
- The results are DOM nodes built with `textContent`, so no text is markup.
- Dev server (#244): `matchStaticRequest` serves both files; the plugin builds
  the script on each request, like the pages.

Why a separate script and not one inline in each page: 3.5 kB gzip on each of 18
pages, uncached, for no benefit, and a second place the ranking could drift.

## Not done

- Searching the tutorials (they are a different section with their own
  header); a follow-up, which would add their sections to the same index.
- Synonyms, typo tolerance, stemming (`enzymes` does not find `enzyme`, except
  as the start of a word, `enzym`). The guide is small and a reader who types
  `enzyme` finds `enzymes` by prefix.
- Verified without a browser only: the layout of the box and the result
  list (the dialog's on a phone, the static header's dropdown). The behaviour
  is tested in jsdom.
