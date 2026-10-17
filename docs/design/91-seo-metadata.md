# 91. Search and link-preview metadata

Issue #228, the first of the discoverability series (#229 robots/sitemap,
#230 JSON-LD and a crawlable summary; #231 asks whether to publish the guide
as static pages and is undecided).

## What was asked

The page had a bare `<title>PlasmidPop</title>`. Give it a descriptive title
and description, a canonical URL and Open Graph / Twitter card tags with a
preview image, so shared links (share-by-URL makes them likely) unfurl well
in Slack, email and papers.

## What was built

- `index.html` carries the tags statically: title, description, canonical,
  `og:*` and `twitter:card=summary_large_image`. Unfurlers and most crawlers
  do not run JS, so nothing is set from React.
- Canonical, `og:url` and `og:image` are absolute
  (`https://booneandrewslab.github.io/PlasmidPop/`): the spec requires it for
  previews and Vite's base path would only give a relative one. The cost is
  that a fork deployed elsewhere must edit those three lines; the canonical
  is meant to name the one real site, so this is deliberate.
- `public/og-image.png`, 1200x630, the logo and tagline on the logo's own
  colours, rendered once from an SVG with rsvg-convert and palette-reduced
  (~22 kB). It is a plain static asset; the build copies it to `dist/`.
- The shared link's `#` fragment is never sent to a server and the canonical
  names the bare site, so a document in a fragment is not leaked into
  metadata. No third-party request is added: the tags only name our own host.
- `src/seoMetadata.test.ts` checks the tags, absolute URLs, the image's
  dimensions and that index.html names no third-party host.

## robots.txt and sitemap.xml (#229)

- Plain static files in `public/`, copied to the site root by the build.
  Not generated: with one page there is nothing to derive, and a build step
  would be code to maintain for a single `<loc>`. If #231 ever publishes
  guide pages, generate the sitemap then, from the same page list.
- `robots.txt` allows everything and points at the absolute sitemap URL
  (the protocol needs absolute URLs, same site constant as the canonical).
  The share-link fragment never reaches a server, so nothing needs hiding.
- The PWA precache globs exclude `.txt`/`.xml`, so neither file is cached.
  `navigateFallbackDenylist` in `vite.config.ts` stops an installed app's
  navigation to them from being answered with `index.html`.
- Tests in `src/seoMetadata.test.ts`.

## Structured data and crawlable summary (#230)

- A `SoftwareApplication` JSON-LD block in `index.html`'s head: name, url,
  `ScientificApplication`, free (`isAccessibleForFree` plus a 0 Offer), MIT
  licence, repository, author with ORCID, and the concept DOI as citation.
  Description, DOI, repository, licence and author are copied from
  `CITATION.cff`, and the test fails if they drift. No version (it would go
  stale each release), no ratings or reviews.
- The summary is a `<noscript>` block after `#root`, not inside it. A
  crawler that does not run JS reads it; with JS on it is never rendered, so
  there is no flash and React's mount does not touch it or the layout.
- The JSON-LD and the summary link to schema.org, doi.org, ORCID, GitHub and
  the licence as identifiers; nothing is fetched. The third-party test now
  checks fetching tags (script/link/img/iframe, `<meta>` URLs) rather than
  every URL in the file.
- No user-visible change in the app, so the guide is untouched.

## Guide as static pages (#231)

Decided: yes, publish the guide as crawlable pages; the app is a canvas
editor behind JS, so without them a search engine sees one page.

- `src/app/help/staticGuide.ts` is a pure generator over `{id, markdown}`
  pages, reusing the app's `parseMarkdown`, `headingSlug` and
  `guideLinkTarget`, so there is no second parser and heading anchors match
  the in-app ones. A small Vite plugin in `vite.config.ts` (`generateBundle`)
  reads `docs/guide/NN-*.md` in file order and emits the files; nothing is
  written to the source tree.
- URLs are `guide/` (an index) and `guide/<slug>/` with the numeric prefix
  dropped (`guide/features/`), as `index.html` in a directory, which GitHub
  Pages serves without a backend or rewrites. Every page has a title
  (`<page> | PlasmidPop user guide`), a description (the first paragraph cut
  to 160 characters), an absolute canonical, Open Graph tags, no script and a
  link to the index, the app and the previous and next page. Links between
  pages and the header are relative, so they work under any base path; only
  the canonical, `og:url` and the sitemap use the absolute `SITE_URL`.
- The guide has no images, so none are emitted; the test fails if a page
  fetches from a third-party host or contains a script.
- `sitemap.xml` is now generated from the same page list (the app, the guide
  index, every page); `public/sitemap.xml` is gone, so there is no second
  list to forget. `robots.txt` is unchanged and still names it.
- Service worker: `navigateFallbackDenylist` gains `/guide/` so an installed
  app's navigation to a guide page is not answered with the shell, and
  `globIgnores: ['guide/**']` keeps the pages out of the precache (the app
  carries its own copy of the guide). In-app navigation is untouched: the app
  has no `/guide/` route.
- The `<noscript>` summary in `index.html` links to `guide/`.
- Found on the way: `03-viewing.md` linked `04-editing#...` without `.md`, so
  the link opened a dead tab in the app and on GitHub. Fixed, and
  `guide.test.ts` now rejects relative links that are not page links.
- Dev server (#244): the same plugin has a `configureServer` middleware that
  serves `guide/`, `guide/<slug>/` and `sitemap.xml` from the same generator
  (no second page list), re-reading `docs/guide` on every request so an edit
  shows on reload. It is registered directly, not as a post hook, so it runs
  before Vite's SPA fallback; at that point the base is still on the URL, so
  the request-to-file mapping (`matchStaticRequest`, pure and unit tested)
  takes it. A directory without its slash redirects to it. Everything else
  still reaches the app.
- Tests: `src/app/help/staticGuide.test.ts` (all pages emitted and in step
  with `GUIDE`, titles, canonicals, links and anchors resolve, sitemap lists
  every page).
