import {
  anchorTarget,
  guideLinkTarget,
  tutorialLinkTarget,
  headingSlug,
  parseMarkdown,
  plainText,
  type Block,
  type Inline,
} from './markdown.ts';
import { guideSections } from './guideIndex.ts';
import { pack, SEARCH_PLACEHOLDER } from './guideSearch.ts';

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

export function escapeHtml(s: string): string {
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
export function relative(fromDir: string, to: string): string {
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

/**
 * Where a page is written and how its relative Markdown links resolve: to a
 * site path (`guide/files/`, possibly with `#anchor`), or null for a link
 * that is not to another page of the site.
 */
export interface LinkContext {
  readonly fromDir: string;
  readonly resolve: (href: string) => string | null;
}

/** The context of a guide page: a bare `05-features.md` is another guide page. */
function guideContext(fromDir: string): LinkContext {
  return {
    fromDir,
    resolve: (href) => {
      const tutorial = tutorialLinkTarget(href);
      if (tutorial !== null)
        return (
          (tutorial === 'README' ? 'tutorials/' : `tutorials/${tutorial}/`) +
          (href.includes('#') ? href.slice(href.indexOf('#')) : '')
        );
      const page = guideLinkTarget(href);
      if (page === null) return null;
      return pagePath(page) + (href.includes('#') ? href.slice(href.indexOf('#')) : '');
    },
  };
}

function inlines(nodes: readonly Inline[], ctx: LinkContext): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return escapeHtml(n.text);
        case 'code':
          return `<code>${escapeHtml(n.text)}</code>`;
        case 'strong':
          return `<strong>${inlines(n.children, ctx)}</strong>`;
        case 'em':
          return `<em>${inlines(n.children, ctx)}</em>`;
        case 'check':
          return `<input type="checkbox"${n.checked ? ' checked' : ''} aria-label="Done">`;
        case 'link': {
          const inner = inlines(n.children, ctx);
          if (anchorTarget(n.href) !== null) return `<a href="${escapeHtml(n.href)}">${inner}</a>`;
          const target = ctx.resolve(n.href);
          if (target !== null) {
            const at = target.indexOf('#');
            const path = at < 0 ? target : target.slice(0, at);
            const hash = at < 0 ? '' : target.slice(at);
            const download = /\.(?:gb|fasta)$/.test(path) ? ' download' : '';
            return `<a href="${escapeHtml(relative(ctx.fromDir, path) + hash)}"${download}>${inner}</a>`;
          }
          return `<a href="${escapeHtml(n.href)}" rel="noopener">${inner}</a>`;
        }
      }
    })
    .join('');
}

export function block(b: Block, ctx: LinkContext): string {
  switch (b.kind) {
    case 'heading': {
      const id = headingSlug(plainText(b.children));
      return `<h${b.level} id="${escapeHtml(id)}">${inlines(b.children, ctx)}</h${b.level}>`;
    }
    case 'paragraph':
      return `<p>${inlines(b.children, ctx)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items
        .map((item, i) => {
          const task = item[0]?.kind === 'check' ? ' class="task"' : '';
          const more = (b.details?.[i] ?? []).map((d) => block(d, ctx)).join('\n');
          return `<li${task}>${inlines(item, ctx)}${more === '' ? '' : `\n${more}\n`}</li>`;
        })
        .join('\n');
      const start = b.start === undefined ? '' : ` start="${b.start}"`;
      return `<${tag}${start}>\n${items}\n</${tag}>`;
    }
    case 'quote': {
      const inner = b.children.map((c) => block(c, ctx)).join('\n');
      if (b.tone === 'tip')
        return `<details class="aside tip">\n<summary>Why</summary>\n${inner}\n</details>`;
      return `<blockquote class="aside ${b.tone}">\n${inner}\n</blockquote>`;
    }
    case 'code':
      return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
    case 'table': {
      const head = b.header.map((c) => `<th>${inlines(c, ctx)}</th>`).join('');
      const rows = b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inlines(c, ctx)}</td>`).join('')}</tr>`)
        .join('\n');
      return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`;
    }
  }
}

const GOAL_LABEL = 'You will end with:';

/** The first paragraph as plain text, cut at a word to fit a search snippet. */
export function describe(blocks: readonly Block[], fallback: string): string {
  const first = blocks.find((b) => b.kind === 'paragraph');
  // A tutorial opens with "You will end with: ..." in a list: that is its summary.
  const goal = blocks
    .flatMap((b) => (b.kind === 'list' ? b.items : []))
    .map(plainText)
    .find((t) => t.startsWith(GOAL_LABEL));
  const text =
    goal !== undefined
      ? goal.slice(GOAL_LABEL.length).trim()
      : first?.kind === 'paragraph'
        ? plainText(first.children).trim()
        : fallback;
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
blockquote.aside{margin:.6rem 0;padding:.1rem .8rem;border-left:4px solid var(--accent);background:var(--code);border-radius:0 4px 4px 0}
blockquote.warning{border-left-color:#c27c0e}
details.aside{margin:.6rem 0}details.aside summary{cursor:pointer;color:var(--muted)}
li.task{list-style:none;margin-left:-1.4em}li.task input{margin-right:.5em}
th,td{border:1px solid var(--line);padding:.3rem .6rem;text-align:left;vertical-align:top}
nav.pager{display:flex;justify-content:space-between;gap:1rem;margin:2rem 0;padding-top:1rem;border-top:1px solid var(--line)}
nav.pager a{display:flex;flex-direction:column;max-width:40%}nav.pager .pager__dir{color:var(--muted);font-size:.85em}nav.pager .pager__next{text-align:right;margin-left:auto}
footer{color:var(--muted);font-size:.9em;padding-bottom:2rem}
`
  .trim()
  .replace(/\n/g, '');

/** The guide's search box and its results (#409); only the pages that have the box carry it. */
const SEARCH_STYLE = `
header{position:relative}
form.search{flex:1 1 14rem;margin:0}
form.search input{width:100%;box-sizing:border-box;padding:.3rem .6rem;font:inherit;font-size:.9em;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px}
ul.search__results{position:absolute;z-index:5;left:16px;right:16px;top:100%;max-height:70vh;overflow-y:auto;margin:.25rem 0 0;padding:.25rem;list-style:none;background:var(--bg);border:1px solid var(--line);border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.2)}
ul.search__results a{display:block;padding:.4rem .6rem;border-radius:4px;color:var(--fg);text-decoration:none}
ul.search__results a:hover,ul.search__results a:focus{background:var(--code)}
.search__page{color:var(--muted);font-size:.85em}
.search__heading{font-weight:600}
.search__snippet{display:block;color:var(--muted);font-size:.88em}
.search__none{padding:.4rem .6rem;color:var(--muted)}
mark{background:rgba(255,200,0,.35);color:inherit;border-radius:2px}
`
  .trim()
  .replace(/\n/g, '');

/** What differs between the sections of the site: the header and the footer. */
export interface SiteSection {
  /** The name in the header. */
  readonly name: string;
  /** Site path of the section's index, and what its link says. */
  readonly indexPath: string;
  readonly indexLabel: string;
  /** The footer paragraph, as HTML; `home` is the relative URL of the app, `fromDir` the page's directory. */
  readonly footer: (home: string, fromDir: string) => string;
  /** Whether the header has the search box (#409); the guide's pages do, the tutorials' do not. */
  readonly search?: boolean;
}

const GUIDE_SECTION: SiteSection = {
  name: 'PlasmidPop user guide',
  indexPath: 'guide/',
  indexLabel: 'All pages',
  search: true,
  footer: (home) =>
    `This is the same user guide that opens from the <strong>?</strong> button inside <a href="${home}">PlasmidPop</a>, a free DNA sequence editor and plasmid viewer that runs in your browser.`,
};

const SEARCH_SCRIPT = 'guide/search.js';
const SEARCH_INDEX = 'guide/search-index.json';

/**
 * The box is hidden until the script runs: the pages read without JavaScript,
 * and a box that does nothing is worse than none.
 */
function searchBox(): string {
  const label = escapeHtml(SEARCH_PLACEHOLDER);
  return `<form class="search" role="search" hidden>
<input type="search" placeholder="${label}" aria-label="${label}" autocomplete="off" spellcheck="false">
<ul class="search__results" aria-label="Search results" hidden></ul>
</form>
`;
}

export function document(opts: {
  section?: SiteSection;
  title: string;
  description: string;
  canonical: string;
  fromDir: string;
  body: string;
  pager: string;
}): string {
  const { title, description, canonical, fromDir } = opts;
  const home = escapeHtml(relative(fromDir, ''));
  const section = opts.section ?? GUIDE_SECTION;
  const index = escapeHtml(relative(fromDir, section.indexPath));
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
<style>${STYLE}${section.search === true ? SEARCH_STYLE : ''}</style>
</head>
<body>
<header>
<strong>${escapeHtml(section.name)}</strong>
<a href="${index}">${escapeHtml(section.indexLabel)}</a>
<a href="${home}">Open the app</a>
${section.search === true ? searchBox() : ''}</header>
<main>
${opts.body}
${opts.pager}
</main>
<footer>
<p>${section.footer(home, fromDir)}</p>
</footer>
${section.search === true ? `<script type="module" src="${escapeHtml(relative(fromDir, SEARCH_SCRIPT))}"></script>\n` : ''}</body>
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
    const body = p.blocks.map((b) => block(b, guideContext(dir))).join('\n');
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

/**
 * What the search box does in the browser (#409), after the ranking code
 * (`guideSearch.ts`, types stripped) in the same module: fetch the index when
 * the box is first used, rank as the dialog does, list the results as links.
 * Plain JS, no framework; built with the DOM so no text is ever markup.
 */
const SEARCH_UI = `
const form = document.querySelector('form.search');
if (form) {
  const input = form.querySelector('input');
  const list = form.querySelector('ul');
  const here = import.meta.url;
  const slug = (id) => id.replace(/^\\d+-/, '');
  let index = null;
  let loading = null;
  const load = () => {
    loading ??= fetch(new URL('search-index.json', here))
      .then((r) => r.json())
      .then((packed) => { index = createIndex(unpack(packed)); });
    return loading;
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const marked = (target, snippet) => {
    let at = 0;
    for (const [a, b] of snippet.marks) {
      target.append(snippet.text.slice(at, a));
      target.append(Object.assign(document.createElement('mark'), { textContent: snippet.text.slice(a, b) }));
      at = b;
    }
    target.append(snippet.text.slice(at));
  };
  const show = (results, message) => {
    list.replaceChildren();
    if (message) list.append(el('li', 'search__none', message));
    for (const r of results) {
      const a = el('a');
      a.href = new URL(slug(r.page) + '/#' + r.anchor, here).href;
      a.append(el('span', 'search__page', r.heading === r.pageTitle ? r.pageTitle : r.pageTitle + ' \\u203a '));
      if (r.heading !== r.pageTitle) a.append(el('span', 'search__heading', r.heading));
      const snip = el('span', 'search__snippet');
      marked(snip, r.snippet);
      a.append(snip);
      const li = el('li');
      li.append(a);
      list.append(li);
    }
    list.hidden = false;
  };
  const run = () => {
    const query = input.value;
    if (query.trim() === '') { list.hidden = true; return; }
    load().then(() => {
      if (input.value !== query) return;
      const results = search(index, query);
      show(results, results.length === 0 ? 'No matches.' : '');
    }, () => { show([], 'Search is not available.'); });
  };
  const links = () => [...list.querySelectorAll('a')];
  form.hidden = false;
  input.addEventListener('focus', () => { load().catch(() => {}); });
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); links()[0]?.focus(); }
    else if (e.key === 'Escape') {
      if (input.value !== '') { input.value = ''; list.hidden = true; }
      else input.blur();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    links()[0]?.click();
  });
  list.addEventListener('keydown', (e) => {
    const all = links();
    const at = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[at + 1]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (all[at - 1] ?? input).focus(); }
    else if (e.key === 'Escape') { input.focus(); }
  });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) list.hidden = true; });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) { e.preventDefault(); input.focus(); }
  });
}
`.trim();

/**
 * The files that make the guide's search box work: the index of every
 * section, and the script. `core` is the ranking module's JavaScript
 * (`guideSearch.ts` with its types stripped), which the build produces so
 * this file stays pure; the script is that code followed by the box's own.
 */
export function generateSearchFiles(pages: readonly SourcePage[], core: string): StaticFile[] {
  return [
    {
      path: SEARCH_INDEX,
      content: JSON.stringify(pack(guideSections(pages))),
    },
    { path: SEARCH_SCRIPT, content: `${core}\n${SEARCH_UI}\n` },
  ];
}

/** sitemap.xml: the app and every guide page, from the same list, then `moreUrls` (the tutorials). */
export function generateSitemap(
  pages: readonly SourcePage[],
  moreUrls: readonly string[] = [],
): string {
  const urls = [SITE_URL, guideUrl(null), ...pages.map((p) => guideUrl(p.id)), ...moreUrls];
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
 * file it names: `guide/`, `guide/<slug>/`, `guide/search.js`,
 * `guide/search-index.json`, `tutorials/`, `tutorials/<id>/`,
 * `tutorials/files/<name>`, `sitemap.xml`. A directory
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
  if (rel === SEARCH_SCRIPT || rel === SEARCH_INDEX) return { kind: 'file', path: rel };
  if (/^(?:guide|tutorials)\/([^/]+\/)?index\.html$/.test(rel)) return { kind: 'file', path: rel };
  if (/^(?:guide|tutorials)\/([^/]+\/)?$/.test(rel))
    return { kind: 'file', path: `${rel}index.html` };
  if (/^tutorials\/files\/[\w.-]+\.(?:gb|fasta)$/.test(rel)) return { kind: 'file', path: rel };
  if (/^(?:guide|tutorials)$/.test(rel) || /^(?:guide|tutorials)\/[^/]+$/.test(rel))
    // Stryker disable next-line EqualityOperator: `q` is never 0 here, since the path matched the base and `guide` before it
    return { kind: 'redirect', to: `${pathname}/${q < 0 ? '' : url.slice(q)}` };
  return null;
}
