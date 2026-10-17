import {
  anchorTarget,
  guideLinkTarget,
  headingSlug,
  parseMarkdown,
  plainText,
  type Block,
  type Inline,
} from './markdown';

/**
 * The user guide as plain static HTML (item 91, #231), generated at build
 * time from the same Markdown and the same parser the app's help dialog uses.
 * Pure: the Vite plugin in `vite.config.ts` reads the files and writes what
 * this returns, and the tests call it directly.
 */

/** The one real site. Canonicals and the sitemap need absolute URLs. */
export const SITE_URL = 'https://booneandrewslab.github.io/PlasmidPop/';

export interface SourcePage {
  /** File stem, e.g. `05-features`. */
  readonly id: string;
  readonly markdown: string;
}

export interface StaticFile {
  /** Path under the site root, e.g. `guide/features/index.html`. */
  readonly path: string;
  readonly content: string;
}

/** `05-features` becomes `features`: a URL has no use for the reading-order prefix. */
export function guideSlug(id: string): string {
  return id.replace(/^\d+-/, '');
}

/** Path of a guide page under the site root, with a trailing slash. */
function pagePath(id: string | null): string {
  return id === null ? 'guide/' : `guide/${guideSlug(id)}/`;
}

export function guideUrl(id: string | null): string {
  return `${SITE_URL}${pagePath(id)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Relative URL from a page's directory to another site path. Relative, so
 * the pages work under any base path and from a local `vite preview`.
 */
function relative(fromDir: string, to: string): string {
  const from = fromDir.split('/').filter((x) => x !== '');
  const dest = to.split('/');
  // Stryker disable next-line StringLiteral: `split` always gives one piece, so the fallback is for the type
  const file = dest.pop() ?? '';
  // Stryker disable next-line ConditionalExpression,MethodExpression,StringLiteral: the page paths have no empty segment but the trailing one, which `pop` took off, so the filter removes nothing
  const target = dest.filter((x) => x !== '');
  let common = 0;
  // Stryker disable next-line ConditionalExpression,LogicalOperator,EqualityOperator: the bounds are redundant with the comparison, which fails where either list has ended (undefined against a string)
  while (common < from.length && common < target.length && from[common] === target[common])
    common++;
  const ups = from.length - common;
  const parts = [...target.slice(common)];
  const prefix = ups === 0 ? './' : '../'.repeat(ups);
  // Stryker disable next-line StringLiteral: the links go to pages one directory deep, so there is never a second part to join
  return prefix + parts.map((x) => `${x}/`).join('') + file;
}

function inlines(nodes: readonly Inline[], fromDir: string): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return escapeHtml(n.text);
        case 'code':
          return `<code>${escapeHtml(n.text)}</code>`;
        case 'strong':
          return `<strong>${inlines(n.children, fromDir)}</strong>`;
        case 'em':
          return `<em>${inlines(n.children, fromDir)}</em>`;
        case 'link': {
          const inner = inlines(n.children, fromDir);
          if (anchorTarget(n.href) !== null) return `<a href="${escapeHtml(n.href)}">${inner}</a>`;
          const page = guideLinkTarget(n.href);
          if (page !== null) {
            const hash = n.href.includes('#') ? n.href.slice(n.href.indexOf('#')) : '';
            return `<a href="${escapeHtml(relative(fromDir, pagePath(page)) + hash)}">${inner}</a>`;
          }
          return `<a href="${escapeHtml(n.href)}" rel="noopener">${inner}</a>`;
        }
      }
    })
    .join('');
}

function block(b: Block, fromDir: string): string {
  switch (b.kind) {
    case 'heading': {
      const id = headingSlug(plainText(b.children));
      return `<h${b.level} id="${escapeHtml(id)}">${inlines(b.children, fromDir)}</h${b.level}>`;
    }
    case 'paragraph':
      return `<p>${inlines(b.children, fromDir)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map((i) => `<li>${inlines(i, fromDir)}</li>`).join('\n');
      return `<${tag}>\n${items}\n</${tag}>`;
    }
    case 'code':
      return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
    case 'table': {
      const head = b.header.map((c) => `<th>${inlines(c, fromDir)}</th>`).join('');
      const rows = b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inlines(c, fromDir)}</td>`).join('')}</tr>`)
        .join('\n');
      return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`;
    }
  }
}

/** The first paragraph as plain text, cut at a word to fit a search snippet. */
export function describe(blocks: readonly Block[], fallback: string): string {
  const first = blocks.find((b) => b.kind === 'paragraph');
  const text = first?.kind === 'paragraph' ? plainText(first.children).trim() : fallback;
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1c2128;--muted:#59636e;--accent:#1b6e8c;--line:#d1d9e0;--code:#f2f5f8}
@media (prefers-color-scheme:dark){:root{--bg:#14181f;--fg:#e6edf3;--muted:#9aa5b1;--accent:#5bb5d5;--line:#30363d;--code:#1d232c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
header,main,footer{max-width:46rem;margin:0 auto;padding:0 16px}
header{padding-top:1rem;padding-bottom:.5rem;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;align-items:baseline}
header strong{margin-right:auto}
a{color:var(--accent)}
code,pre{background:var(--code);border-radius:4px;font-size:.9em}
code{padding:.1em .3em}
pre{padding:.75rem;overflow-x:auto}pre code{padding:0}
table{border-collapse:collapse;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:.3rem .6rem;text-align:left;vertical-align:top}
nav.pager{display:flex;justify-content:space-between;gap:1rem;margin:2rem 0;padding-top:1rem;border-top:1px solid var(--line)}
footer{color:var(--muted);font-size:.9em;padding-bottom:2rem}
`
  .trim()
  .replace(/\n/g, '');

function document(opts: {
  title: string;
  description: string;
  canonical: string;
  fromDir: string;
  body: string;
  pager: string;
}): string {
  const { title, description, canonical, fromDir } = opts;
  const home = escapeHtml(relative(fromDir, ''));
  const index = escapeHtml(relative(fromDir, 'guide/'));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="icon" href="${escapeHtml(relative(fromDir, 'favicon.svg'))}" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${SITE_URL}og-image.png">
<meta name="twitter:card" content="summary_large_image">
<style>${STYLE}</style>
</head>
<body>
<header>
<strong>PlasmidPop user guide</strong>
<a href="${index}">All pages</a>
<a href="${home}">Open the app</a>
</header>
<main>
${opts.body}
${opts.pager}
</main>
<footer>
<p>This is the same user guide that opens from the <strong>?</strong> button inside <a href="${home}">PlasmidPop</a>, a free DNA sequence editor and plasmid viewer that runs in your browser.</p>
</footer>
</body>
</html>
`;
}

/** Every file the static guide adds to the site: one per page, plus the index. */
export function generateGuideFiles(pages: readonly SourcePage[]): StaticFile[] {
  const parsed = pages.map((p) => {
    const blocks = parseMarkdown(p.markdown);
    // Stryker disable next-line ConditionalExpression: only a heading has a `level`, so `kind === 'heading'` adds nothing to `level === 1` (the `level` half is tested)
    const h1 = blocks.find((b) => b.kind === 'heading' && b.level === 1);
    const title = h1?.kind === 'heading' ? plainText(h1.children) : p.id;
    return { ...p, blocks, title };
  });

  const files: StaticFile[] = parsed.map((p, i) => {
    const dir = pagePath(p.id);
    const prev = parsed[i - 1];
    const next = parsed[i + 1];
    const link = (t: typeof prev, label: string): string =>
      t === undefined
        ? '<span></span>'
        : `<a href="${escapeHtml(relative(dir, pagePath(t.id)))}">${label}</a>`;
    // Stryker disable next-line StringLiteral: the label of a missing neighbour is not used (`link` writes an empty span instead)
    const pager = `<nav class="pager" aria-label="Guide pages">${link(prev, `&larr; ${escapeHtml(prev?.title ?? '')}`)}${link(next, `${escapeHtml(next?.title ?? '')} &rarr;`)}</nav>`;
    const body = p.blocks.map((b) => block(b, dir)).join('\n');
    return {
      path: `${dir}index.html`,
      content: document({
        title: `${p.title} | PlasmidPop user guide`,
        description: describe(p.blocks, p.title),
        canonical: guideUrl(p.id),
        fromDir: dir,
        body,
        pager,
      }),
    };
  });

  const list = parsed
    .map(
      (p) =>
        `<li><a href="${escapeHtml(relative('guide/', pagePath(p.id)))}">${escapeHtml(p.title)}</a></li>`,
    )
    .join('\n');
  files.unshift({
    path: 'guide/index.html',
    content: document({
      title: 'PlasmidPop user guide: DNA sequence editor and plasmid viewer',
      description:
        'The PlasmidPop user guide: opening and saving sequences, features, restriction enzymes, ORFs, primers, alignment, cloning, CRISPR guides and keyboard shortcuts.',
      canonical: guideUrl(null),
      fromDir: 'guide/',
      body: `<h1>PlasmidPop user guide</h1>\n<ol>\n${list}\n</ol>`,
      pager: '',
    }),
  });
  return files;
}

/** sitemap.xml: the app and every guide page, from the same list. */
export function generateSitemap(pages: readonly SourcePage[]): string {
  const urls = [SITE_URL, guideUrl(null), ...pages.map((p) => guideUrl(p.id))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${u}</loc>\n  </url>`).join('\n')}
</urlset>
`;
}

/** What a dev-server request for a static page resolves to (#244). */
export type StaticRequest =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'redirect'; readonly to: string };

/**
 * Maps a request URL (query allowed, `base` still on it) to the generated
 * file it names: `guide/`, `guide/<slug>/`, `sitemap.xml`. A directory
 * without its trailing slash redirects to it, as GitHub Pages does, because
 * the pages link relatively. Anything else is null: the app's.
 */
export function matchStaticRequest(url: string, base: string): StaticRequest | null {
  const q = url.search(/[?#]/);
  // Stryker disable next-line EqualityOperator: `q` is 0 only for a url that starts with `?` or `#`, which has no path to match either way
  const pathname = q < 0 ? url : url.slice(0, q);
  if (!pathname.startsWith(base)) return null;
  const rel = pathname.slice(base.length);
  if (rel === 'sitemap.xml') return { kind: 'file', path: 'sitemap.xml' };
  if (/^guide\/([^/]+\/)?index\.html$/.test(rel)) return { kind: 'file', path: rel };
  if (/^guide\/([^/]+\/)?$/.test(rel)) return { kind: 'file', path: `${rel}index.html` };
  if (rel === 'guide' || /^guide\/[^/]+$/.test(rel))
    // Stryker disable next-line EqualityOperator: `q` is never 0 here, since the path matched the base and `guide` before it
    return { kind: 'redirect', to: `${pathname}/${q < 0 ? '' : url.slice(q)}` };
  return null;
}
