# 137. One tutorials entry point, with categories

Issue #408, designed 2026-11-06. The tutorials section (item 114) grew past
cloning: Align (#375), Enzymes (#377) and CRISPR (#378) are tutorials of the
same shape, but the site still calls itself "PlasmidPop cloning tutorials", the
index is one flat table of thirteen rows, and the only prominent way in is a
**Cloning tutorials** button on the home panel and in the guide header. The
three analysis tutorials are reachable from their guide pages and from nothing
else. This note decides the categories, the index, where they are declared, the
buttons, and the guide's links. No code is written here.

## Categories

Three sections of the index, in this order:

- **Cloning**: `digest-pcr`, `ligation`, `golden-gate`, `golden-gate-parts`,
  `modular`, `gibson`, `in-fusion`, `overlap-pcr`, `gateway`, `mutagenesis`
  (the suggested-order sentence moves under this heading, since it is about
  these ten and nothing else).
- **Analysis**: `enzymes`, `align`, `crispr`. Enzymes first, since it is the
  shortest and the most used tab.
- **Reference**: `before-you-start` and `sample-files`, the bullet list the
  index has now. Before you start is also still named in the intro, before
  either table, because it is the page a newcomer needs first; it is not a
  tutorial (no exercise, nothing to end with), so it is not a table row.

Rejected: a category per sidebar tab (Enzymes, Align, CRISPR), which would be
three one-row tables; a "Start here" category holding Before you start, which
would make a reference page look like an exercise; a "Primers" category, which
has no page yet. A category needs two pages; the third one is added when the
third kind of tutorial exists.

## The index page

`docs/tutorials/README.md` stays the index, and the static page is still that
file rendered: the structure is `##` headings with one table each and the
reference list, nothing a reader needs JavaScript or CSS for, and GitHub shows
the same thing. Each table keeps the five columns it has (Method, Level,
Minutes, You end with, Page): a tutorial's level and length are what a reader
picks by, and the Page column's long title is the link text that search
engines see. Cards are rejected: the Markdown subset has no card, the README is
read on GitHub as well as on the site, and five fields per row read better in a
grid than in a tile. The headings give the sections anchors for free
(`/tutorials/#analysis`), so no per-category pages and no new sitemap entries;
`tutorialUrls` is unchanged.

Names: the H1, the header `SiteSection.name` and the page titles become
"PlasmidPop tutorials"; the index `<title>` becomes "PlasmidPop tutorials:
cloning and analysis, step by step"; `indexLabel` and the pager's middle link
become "All tutorials"; the footer says "Step-by-step exercises in cloning and
sequence analysis". The intro paragraph loses "for cloning in PlasmidPop, one
for aligning sequences, one for restriction enzymes, and one for CRISPR guides"
and says what the sections are instead. The pager stays one chain through all
fifteen pages in index order (Before you start, the ten cloning pages, the
three analysis pages, Sample files): a chain per category would strand the
reader at the end of Analysis with no next page.

## Where the categories are declared

One source in code, mirrored by the README, with a test tying the two:

- `staticTutorials.ts` replaces `TUTORIAL_ORDER` with
  `TUTORIAL_SECTIONS: readonly { title: string; ids: readonly string[] }[]`
  (Cloning, Analysis, Reference as above) and derives `TUTORIAL_ORDER` from it
  by flattening, with `before-you-start` first and `sample-files` last so the
  pager order above holds. Everything that imports `TUTORIAL_ORDER` today
  (`vite.config.ts`, the tests) keeps working unchanged.
- `staticTutorials.test.ts` gains one test: for each section of
  `TUTORIAL_SECTIONS`, the README has an `##` heading with that title, and the
  links in the block that follows it (the table's Page column, or the
  reference list) are exactly that section's ids, in that order. With the
  existing folder-versus-list test, a new `.md` in the folder that is not in a
  section fails, and a section id with no README row fails; a tutorial cannot
  reach the site without a row in the right table.

Rejected: YAML front matter per page (the parser has no front matter, GitHub
renders it as a table at the top of every page, and the index's order would
then live in fifteen files); deriving the sections by parsing the README alone
(it would make the README's headings load-bearing for the build, and the
Reference section's position in the pager would need a special case either
way). The map is explicit and ten lines long.

## The buttons

- **Home panel** (`EmptyState.tsx`): the primary button is renamed
  **Tutorials**, **User guide** stays beside it as the plain button, and the
  lead line ("New here? Learn by doing, or read how it all works.") stays,
  since its two halves name the two buttons in order. The weight is kept: the
  complaint in #408 is the word, which promises cloning and hides the rest,
  not the prominence of learning by doing on an empty app.
- **Guide header** (`HelpDialog.tsx`): the small primary button is renamed
  **Tutorials**, same place, same `href`. The `help.css` comment follows.

Rejected: a menu with Cloning and Analysis under the button (two clicks of UI
to do what the index's two headings do); "Cloning and analysis tutorials" as
the label (long on a phone, and stale with a third category); moving the guide
header's button into the page list (it is a link out of the dialog, not a page
of it).

## Guide links to tutorials: repo-relative, resolved by both renderers

Yes. The guide pages link tutorials by absolute production URL today, which
item 114 chose because the dialog resolves only `NN-page.md` links. The cost
showed with #375–#378: a link to a tutorial that ships in the same release
404s in dev and on every preview until the release, and `guide.test.ts` skips
`https:` links, so a wrong tutorial id is never caught. The change:

- Guide Markdown links a tutorial as `../tutorials/<id>.md` (the index as
  `../tutorials/README.md`), which GitHub resolves as well.
- `markdown.ts` gains `tutorialLinkTarget(href): string | null` (the id, or
  `'README'`), beside `guideLinkTarget`.
- `Markdown.tsx` renders such a link as `<a href={BASE_URL + 'tutorials/' +
(id === 'README' ? '' : id + '/')} target="_blank" rel="noreferrer">`: a new
  tab, as now, but at the site the app is running on.
- The guide's `LinkContext` in `staticGuide.ts` resolves it to
  `tutorials/<id>/`, written relative like every other link.
- `guide.test.ts` checks every tutorial link's id against `TUTORIAL_ORDER`
  (it already fails on any other relative link).

Six links move: guide README, Getting started (two), Simulated cloning,
Enzymes, Align, CRISPR. The noscript notice in `index.html` and the repo
README keep absolute URLs; they are not rendered by the guide.

## Files to change, in order

1. `src/app/help/staticTutorials.ts`: `TUTORIAL_SECTIONS`, derived
   `TUTORIAL_ORDER`, the renamed `SECTION`, titles and pager label.
   `staticTutorials.test.ts`: the new sections-versus-README test, the renamed
   H1, header and pager expectations.
2. `docs/tutorials/README.md`: new H1 and intro, `## Cloning` with the order
   sentence and its ten rows, `## Analysis` with its three, `## Reference`.
3. `src/app/components/EmptyState.tsx`, `EmptyState.test.tsx`,
   `src/app/help/HelpDialog.tsx`, `HelpButton.test.tsx`, `help.css` comment:
   the **Tutorials** label.
4. `src/app/help/markdown.ts` (`tutorialLinkTarget`), `markdown.test.ts`,
   `Markdown.tsx`, `staticGuide.ts` (guide `LinkContext`), `staticGuide.test.ts`,
   `guide.test.ts`: the repo-relative tutorial links.
5. `docs/guide/README.md`, `01-getting-started.md` (the button name at the
   top, "cloning tutorials" twice, "ligation, Golden Gate, modular cloning,
   Gibson and more" gains "and the Enzymes, Align and CRISPR tabs"),
   `12-cloning.md`, `07-enzymes.md`, `11-align.md`, `17-crispr.md`: the links
   and wording. `index.html` noscript and `README.md` (lines 92 and 196):
   "tutorials", not "cloning tutorials".
6. `docs/design/114-tutorials-site.md`: one line under "Links in" pointing
   here. `npm run format:check`, `npm test`, and the dev server at
   `/tutorials/` and a guide page's tutorial link, by hand.

One Sonnet agent, one branch, one commit per step or two.
