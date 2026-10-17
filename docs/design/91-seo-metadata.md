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

## Not done

Structured data and the crawlable text block (#230), robots.txt and
sitemap.xml (#229). When those land they should reuse the same site URL.
