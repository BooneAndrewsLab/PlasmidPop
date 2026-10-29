import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GUIDE } from './guide';
import { parseMarkdown } from './markdown';
import {
  block,
  describe as describeBlocks,
  generateGuideFiles,
  generateSitemap,
  guideSlug,
  guideUrl,
  matchStaticRequest,
  SITE_URL,
  type SourcePage,
} from './staticGuide';

// Item 91 (#231): the guide as crawlable static pages, from docs/guide.
const dir = new URL('../../../docs/guide/', import.meta.url);
const pages: SourcePage[] = readdirSync(dir)
  .filter((f) => /^\d+-.*\.md$/.test(f))
  .sort()
  .map((f) => ({ id: f.replace(/\.md$/, ''), markdown: readFileSync(new URL(f, dir), 'utf8') }));
const files = generateGuideFiles(pages);
const byPath = new Map(files.map((f) => [f.path, f.content]));

describe('static guide pages', () => {
  it('cover exactly the pages the app shows, in the same order', () => {
    expect(pages.map((p) => p.id)).toEqual(GUIDE.map((p) => p.id));
  });

  it('emit an index and one page per guide page', () => {
    expect(files).toHaveLength(pages.length + 1);
    expect(byPath.has('guide/index.html')).toBe(true);
    for (const p of pages) expect(byPath.has(`guide/${guideSlug(p.id)}/index.html`)).toBe(true);
  });

  it('give every page a title, description and absolute canonical', () => {
    for (const f of files) {
      const title = /<title>([^<]+)<\/title>/.exec(f.content)?.[1] ?? '';
      expect(title.length, f.path).toBeGreaterThan(10);
      const desc = /<meta name="description" content="([^"]+)"/.exec(f.content)?.[1] ?? '';
      expect(desc.length, f.path).toBeGreaterThan(20);
      expect(desc.length, f.path).toBeLessThanOrEqual(160);
      const canonical = /<link rel="canonical" href="([^"]+)"/.exec(f.content)?.[1];
      expect(canonical, f.path).toBe(`${SITE_URL}${f.path.replace(/index\.html$/, '')}`);
    }
    expect(new Set(files.map((f) => /<title>([^<]+)/.exec(f.content)?.[1])).size).toBe(
      files.length,
    );
  });

  it('use no script and no third-party fetches', () => {
    for (const f of files) {
      expect(f.content, f.path).not.toMatch(/<script/i);
      expect(f.content, f.path).not.toMatch(
        /<(?:link(?![^>]*canonical)|img|iframe)[^>]+(?:href|src)="https?:/i,
      );
    }
  });

  it('resolve every internal link to an emitted page and anchor', () => {
    for (const f of files) {
      for (const m of f.content.matchAll(/<a href="([^"]+)"/g)) {
        const href = (m[1] ?? '').replace(/&amp;/g, '&');
        if (/^https?:/.test(href)) continue;
        const [path = '', hash] = href.split('#');
        if (path !== '') expect(path.endsWith('/'), `${f.path}: ${href}`).toBe(true);
        const dirOfTarget =
          path === ''
            ? posix.dirname(f.path)
            : posix.join(posix.dirname(f.path), path).replace(/\/$/, '');
        const resolved =
          path === '' ? f.path : `${dirOfTarget === '.' ? '' : `${dirOfTarget}/`}index.html`;
        if (resolved === 'index.html') continue; // the app itself
        const html = byPath.get(resolved);
        expect(html, `${f.path} links to ${href}`).toBeDefined();
        if (hash !== undefined) expect(html, `${f.path} -> ${href}`).toContain(`id="${hash}"`);
      }
    }
  });

  it('link every page from the index and chain them with previous and next', () => {
    const index = byPath.get('guide/index.html') ?? '';
    for (const p of pages) expect(index).toContain(`href="./${guideSlug(p.id)}/"`);
    const second = byPath.get('guide/files/index.html') ?? '';
    expect(second).toContain('href="../getting-started/"');
    expect(second).toContain('href="../viewing/"');
  });

  it('escape markup from the Markdown', () => {
    const out = generateGuideFiles([{ id: '01-x', markdown: '# A <b> & B\n\nUse `<tag>` here.' }]);
    const html = out[1]?.content ?? '';
    expect(html).toContain('A &lt;b&gt; &amp; B');
    expect(html).toContain('<code>&lt;tag&gt;</code>');
  });
});

describe('sitemap', () => {
  it('lists the app, the guide index and every guide page once', () => {
    const xml = generateSitemap(pages);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([SITE_URL, guideUrl(null), ...pages.map((p) => guideUrl(p.id))]);
    expect(new Set(locs).size).toBe(locs.length);
    for (const f of files)
      expect(locs).toContain(`${SITE_URL}${f.path.replace(/index\.html$/, '')}`);
  });

  it('is no longer a static file, and robots.txt still names it', () => {
    expect(() => readFileSync(new URL('../../../public/sitemap.xml', import.meta.url))).toThrow();
    const robots = readFileSync(new URL('../../../public/robots.txt', import.meta.url), 'utf8');
    expect(robots).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
  });
});

describe('matchStaticRequest (dev server, #244)', () => {
  for (const base of ['/', '/PlasmidPop/']) {
    it(`maps requests under base ${base}`, () => {
      const m = (u: string) => matchStaticRequest(base + u, base);
      expect(m('guide/')).toEqual({ kind: 'file', path: 'guide/index.html' });
      expect(m('guide/index.html')).toEqual({ kind: 'file', path: 'guide/index.html' });
      expect(m('guide/viewing/')).toEqual({ kind: 'file', path: 'guide/viewing/index.html' });
      expect(m('guide/viewing/?x=1')).toEqual({ kind: 'file', path: 'guide/viewing/index.html' });
      expect(m('guide/viewing/index.html')).toEqual({
        kind: 'file',
        path: 'guide/viewing/index.html',
      });
      expect(m('sitemap.xml?v=2')).toEqual({ kind: 'file', path: 'sitemap.xml' });
      expect(m('guide')).toEqual({ kind: 'redirect', to: `${base}guide/` });
      expect(m('guide/viewing?a=b')).toEqual({ kind: 'redirect', to: `${base}guide/viewing/?a=b` });
      expect(m('')).toBeNull();
      expect(m('guides/')).toBeNull();
      expect(m('guide/a/b/')).toBeNull();
      expect(m('src/main.tsx')).toBeNull();
    });
  }

  it('leaves requests outside the base to the app', () => {
    expect(matchStaticRequest('/guide/', '/PlasmidPop/')).toBeNull();
    expect(matchStaticRequest('/sitemap.xml', '/PlasmidPop/')).toBeNull();
  });
});

const INDEX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PlasmidPop user guide: DNA sequence editor and plasmid viewer</title>
<meta name="description" content="The PlasmidPop user guide: opening and saving sequences, features, restriction enzymes, ORFs, primers, alignment, cloning, CRISPR guides and keyboard shortcuts.">
<link rel="canonical" href="https://booneandrewslab.github.io/PlasmidPop/guide/">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:title" content="PlasmidPop user guide: DNA sequence editor and plasmid viewer">
<meta property="og:description" content="The PlasmidPop user guide: opening and saving sequences, features, restriction enzymes, ORFs, primers, alignment, cloning, CRISPR guides and keyboard shortcuts.">
<meta property="og:url" content="https://booneandrewslab.github.io/PlasmidPop/guide/">
<meta property="og:image" content="https://booneandrewslab.github.io/PlasmidPop/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<style/>
</head>
<body>
<header>
<strong>PlasmidPop user guide</strong>
<a href="./">All pages</a>
<a href="../">Open the app</a>
</header>
<main>
<h1>PlasmidPop user guide</h1>
<ol>
<li><a href="./alpha/">Alpha one title</a></li>
<li><a href="./beta/">02-beta</a></li>
<li><a href="./gamma/">Gamma</a></li>
</ol>

</main>
<footer>
<p>This is the same user guide that opens from the <strong>?</strong> button inside <a href="../">PlasmidPop</a>, a free DNA sequence editor and plasmid viewer that runs in your browser.</p>
</footer>
</body>
</html>
`;

const ALPHA = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alpha one title | PlasmidPop user guide</title>
<meta name="description" content="First bold paragraph with code and a guide link and same and ext.">
<link rel="canonical" href="https://booneandrewslab.github.io/PlasmidPop/guide/alpha/">
<link rel="icon" href="../../favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:title" content="Alpha one title | PlasmidPop user guide">
<meta property="og:description" content="First bold paragraph with code and a guide link and same and ext.">
<meta property="og:url" content="https://booneandrewslab.github.io/PlasmidPop/guide/alpha/">
<meta property="og:image" content="https://booneandrewslab.github.io/PlasmidPop/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<style/>
</head>
<body>
<header>
<strong>PlasmidPop user guide</strong>
<a href="../">All pages</a>
<a href="../../">Open the app</a>
</header>
<main>
<h1 id="alpha-one-title">Alpha <em>one</em> title</h1>
<p>First <strong>bold</strong> paragraph with <code>code</code> and a <a href="../beta/#sub-head">guide link</a> and <a href="#local">same</a> and <a href="https://example.com/a?b=1&amp;c=2" rel="noopener">ext</a>.</p>
<h2 id="sub-head">Sub head</h2>
<ul>
<li>one</li>
<li>two</li>
</ul>
<ol>
<li>a</li>
<li>b</li>
</ol>
<pre><code>x &lt; y</code></pre>
<table>
<thead><tr><th>H1</th><th>H2</th></tr></thead>
<tbody>
<tr><td>c1</td><td>c2</td></tr>
</tbody>
</table>
<nav class="pager" aria-label="Guide pages"><span></span><a href="../beta/">02-beta &rarr;</a></nav>
</main>
<footer>
<p>This is the same user guide that opens from the <strong>?</strong> button inside <a href="../../">PlasmidPop</a>, a free DNA sequence editor and plasmid viewer that runs in your browser.</p>
</footer>
</body>
</html>
`;

const BETA = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>02-beta | PlasmidPop user guide</title>
<meta name="description" content="word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word…">
<link rel="canonical" href="https://booneandrewslab.github.io/PlasmidPop/guide/beta/">
<link rel="icon" href="../../favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:title" content="02-beta | PlasmidPop user guide">
<meta property="og:description" content="word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word…">
<meta property="og:url" content="https://booneandrewslab.github.io/PlasmidPop/guide/beta/">
<meta property="og:image" content="https://booneandrewslab.github.io/PlasmidPop/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<style/>
</head>
<body>
<header>
<strong>PlasmidPop user guide</strong>
<a href="../">All pages</a>
<a href="../../">Open the app</a>
</header>
<main>
<h2 id="no-h1">No h1</h2>
<p>word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word</p>
<nav class="pager" aria-label="Guide pages"><a href="../alpha/">&larr; Alpha one title</a><a href="../gamma/">Gamma &rarr;</a></nav>
</main>
<footer>
<p>This is the same user guide that opens from the <strong>?</strong> button inside <a href="../../">PlasmidPop</a>, a free DNA sequence editor and plasmid viewer that runs in your browser.</p>
</footer>
</body>
</html>
`;

const GAMMA = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gamma | PlasmidPop user guide</title>
<meta name="description" content="Short.">
<link rel="canonical" href="https://booneandrewslab.github.io/PlasmidPop/guide/gamma/">
<link rel="icon" href="../../favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:title" content="Gamma | PlasmidPop user guide">
<meta property="og:description" content="Short.">
<meta property="og:url" content="https://booneandrewslab.github.io/PlasmidPop/guide/gamma/">
<meta property="og:image" content="https://booneandrewslab.github.io/PlasmidPop/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<style/>
</head>
<body>
<header>
<strong>PlasmidPop user guide</strong>
<a href="../">All pages</a>
<a href="../../">Open the app</a>
</header>
<main>
<h1 id="gamma">Gamma</h1>
<p>Short.</p>
<nav class="pager" aria-label="Guide pages"><a href="../beta/">&larr; 02-beta</a><span></span></nav>
</main>
<footer>
<p>This is the same user guide that opens from the <strong>?</strong> button inside <a href="../../">PlasmidPop</a>, a free DNA sequence editor and plasmid viewer that runs in your browser.</p>
</footer>
</body>
</html>
`;

describe('static guide pages, exactly (item 91)', () => {
  const md1 =
    '# Alpha *one* title\n\nFirst **bold** paragraph with `code` and a [guide link](02-beta.md#sub-head) and [same](#local) and [ext](https://example.com/a?b=1&c=2).\n\n## Sub head\n\n- one\n- two\n\n1. a\n2. b\n\n```\nx < y\n```\n\n| H1 | H2 |\n| --- | --- |\n| c1 | c2 |\n';
  const md2 = `## No h1\n\n${'word '.repeat(60)}\n`;
  // Made in each test, not while the file loads: work done at load cannot be told apart per test by mutation testing (#77).
  const generate = () =>
    generateGuideFiles([
      { id: '01-alpha', markdown: md1 },
      { id: '02-beta', markdown: md2 },
      { id: '03-gamma', markdown: '# Gamma\n\nShort.' },
    ]);
  /** The pages without the style sheet, which is long and not what is checked here. */
  const get = (out: readonly { path: string; content: string }[], path: string): string =>
    (out.find((f) => f.path === path)?.content ?? '').replace(/<style>.*<\/style>/, '<style/>');

  it('writes the index, then one page per guide page, as exactly this HTML', () => {
    const out = generate();
    expect(out.map((f) => f.path)).toEqual([
      'guide/index.html',
      'guide/alpha/index.html',
      'guide/beta/index.html',
      'guide/gamma/index.html',
    ]);
    expect(get(out, 'guide/index.html')).toBe(INDEX);
    expect(get(out, 'guide/alpha/index.html')).toBe(ALPHA);
    expect(get(out, 'guide/beta/index.html')).toBe(BETA);
    expect(get(out, 'guide/gamma/index.html')).toBe(GAMMA);
  });
});

describe('the page description (#231)', () => {
  const blocks = (md: string) => parseMarkdown(md);

  it('is the "You will end with" line of a tutorial when it has one', () => {
    const text =
      '# T\n\n- **You will end with:** a 3 kb **circle**.\n- **Time:** soon.\n\nIntro paragraph.\n';
    expect(describeBlocks(blocks(text), 'fb')).toBe('a 3 kb circle.');
  });

  it('is the first paragraph, even after other blocks, as plain text', () => {
    expect(describeBlocks(blocks('# Title\n\n- item\n\nSome **plain** text \n'), 'fb')).not.toBe(
      'fb',
    );
    expect(describeBlocks(blocks('# Title\n\nSome **plain** `text` here.\n\nSecond.'), 'fb')).toBe(
      'Some plain text here.',
    );
    expect(describeBlocks(blocks('# Title\n\n## Sub'), 'the fallback')).toBe('the fallback');
  });

  it('leaves 160 characters alone and cuts a longer text at a word, with an ellipsis', () => {
    const words = (n: number): string => Array.from({ length: n }, () => 'abcd').join(' ');
    // 32 words of 4 letters and a space: 159 characters; 160 with one letter more.
    const at159 = words(32);
    expect(at159).toHaveLength(159);
    expect(describeBlocks(blocks(at159), 'fb')).toBe(at159);
    const at160 = `${at159}x`;
    expect(describeBlocks(blocks(at160), 'fb')).toBe(at160);
    const at161 = `${at160}y`;
    expect(at161).toHaveLength(161);
    // The first 157 characters end inside the 32nd word; the cut is at the space before it.
    expect(describeBlocks(blocks(at161), 'fb')).toBe(`${words(31)}…`);
  });

  it('trims the paragraph', () => {
    expect(
      describeBlocks([{ kind: 'paragraph', children: [{ kind: 'text', text: '  hi  ' }] }], 'fb'),
    ).toBe('hi');
  });

  it('is written into the page with its quotes escaped', () => {
    const html =
      generateGuideFiles([{ id: '01-q', markdown: '# T\n\nSay "hi" & <go>.' }])[1]?.content ?? '';
    expect(html).toContain(
      '<meta name="description" content="Say &quot;hi&quot; &amp; &lt;go&gt;.">',
    );
  });
});

describe('static guide titles and slugs', () => {
  it('takes the title from the level-1 heading wherever it is, else the page id', () => {
    const files = generateGuideFiles([
      { id: '01-a', markdown: '## Second level\n\n# Real title\n' },
      { id: '02-b', markdown: '## Only second level\n' },
      { id: '03-c', markdown: '' },
    ]);
    expect(files[1]?.content).toContain('<title>Real title | PlasmidPop user guide</title>');
    expect(files[2]?.content).toContain('<title>02-b | PlasmidPop user guide</title>');
    expect(files[3]?.content).toContain('<title>03-c | PlasmidPop user guide</title>');
  });

  it('drops only the reading-order prefix of a page id', () => {
    expect(guideSlug('05-features')).toBe('features');
    expect(guideSlug('a1-b')).toBe('a1-b');
    expect(guideSlug('12-x-3-y')).toBe('x-3-y');
  });
});

describe('the sitemap, exactly', () => {
  it('is one url element per page, on separate lines', () => {
    expect(generateSitemap([{ id: '01-a', markdown: '' }]))
      .toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}</loc>
  </url>
  <url>
    <loc>${SITE_URL}guide/</loc>
  </url>
  <url>
    <loc>${SITE_URL}guide/a/</loc>
  </url>
</urlset>
`);
  });
});

describe('matchStaticRequest, what is not the guide (#244)', () => {
  it('matches from the start of the path under the base, to its end', () => {
    const base = '/PlasmidPop/';
    const m = (u: string) => matchStaticRequest(base + u, base);
    expect(m('guide/a/guide/index.html')).toBeNull();
    expect(m('x/guide/')).toBeNull();
    expect(m('x/guide/b')).toBeNull();
    expect(m('guide/index.html.bak')).toEqual({
      kind: 'redirect',
      to: `${base}guide/index.html.bak/`,
    });
    expect(m('guide/b/c')).toBeNull();
    expect(m('guide/viewing#top')).toEqual({ kind: 'redirect', to: `${base}guide/viewing/#top` });
    expect(m('guide#top')).toEqual({ kind: 'redirect', to: `${base}guide/#top` });
  });

  it('serves a tutorial file only by its whole path and a GenBank or FASTA name', () => {
    const base = '/PlasmidPop/';
    const m = (u: string) => matchStaticRequest(base + u, base);
    expect(m('tutorials/files/a.gb')).toEqual({ kind: 'file', path: 'tutorials/files/a.gb' });
    expect(m('tutorials/files/a-b.1.fasta')).toEqual({
      kind: 'file',
      path: 'tutorials/files/a-b.1.fasta',
    });
    expect(m('tutorials/files/a.gb.bak')).toBeNull();
    expect(m('tutorials/files/a.fastaX')).toBeNull();
    expect(m('x/tutorials/files/a.gb')).toBeNull();
    expect(m('Xtutorials/files/a.gb')).toBeNull();
  });

  it('redirects a directory without its slash only when it is the guide or the tutorials', () => {
    const base = '/PlasmidPop/';
    const m = (u: string) => matchStaticRequest(base + u, base);
    expect(m('tutorials')).toEqual({ kind: 'redirect', to: `${base}tutorials/` });
    expect(m('tutorials/x')).toEqual({ kind: 'redirect', to: `${base}tutorials/x/` });
    expect(m('xguide')).toBeNull();
    expect(m('xtutorials')).toBeNull();
    expect(m('x/guide')).toBeNull();
  });

  it('does not take a path that only has the base’s length in front of a match', () => {
    expect(matchStaticRequest(`/${'Z'.repeat(11)}sitemap.xml`, '/PlasmidPop/')).toBeNull();
  });
});

describe('static guide, smaller pieces (item 91)', () => {
  const page = (markdown: string, id = '01-a'): string =>
    generateGuideFiles([
      { id, markdown },
      { id: '02-b', markdown: '# B\n\nText.' },
    ])[1]?.content ?? '';

  it('links to a guide page with or without an anchor', () => {
    const html = page('# A\n\n[b](02-b.md) and [b anchor](02-b.md#top).');
    expect(html).toContain('<a href="../b/">b</a>');
    expect(html).toContain('<a href="../b/#top">b anchor</a>');
  });

  it('puts the rows of a table on lines of their own', () => {
    const html = page('# A\n\n| H |\n| --- |\n| r1 |\n| r2 |\n');
    expect(html).toContain('<tbody>\n<tr><td>r1</td></tr>\n<tr><td>r2</td></tr>\n</tbody>');
  });

  it('takes the title from a heading, not from whatever block comes first', () => {
    const html = page('Intro paragraph.\n\n# The title\n');
    expect(html).toContain('<title>The title | PlasmidPop user guide</title>');
  });
});

describe('static guide blocks and links, exactly (mutation triage, 1.19)', () => {
  const ctx = {
    fromDir: 'guide/x/',
    resolve: (href: string): string | null => (href.startsWith('http') ? null : href),
  };
  const html = (markdown: string): string =>
    parseMarkdown(markdown)
      .map((b) => block(b, ctx))
      .join('\n');

  it('writes a task list with checked and unchecked boxes, and an item with nothing in it', () => {
    expect(html('- [ ] one\n- [x] two\n- three\n- ')).toBe(
      [
        '<ul>',
        '<li class="task"><input type="checkbox" aria-label="Done">one</li>',
        '<li class="task"><input type="checkbox" checked aria-label="Done">two</li>',
        '<li>three</li>',
        '<li></li>',
        '</ul>',
      ].join('\n'),
    );
  });

  it('writes the blocks that follow an item inside it, one per line', () => {
    expect(html('- a\n\n  first\n\n  second\n- b')).toBe(
      '<ul>\n<li>a\n<p>first</p>\n<p>second</p>\n</li>\n<li>b</li>\n</ul>',
    );
  });

  it('numbers an ordered list from its first number, when that is not 1', () => {
    expect(html('3. a\n4. b')).toBe('<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
    expect(html('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  });

  it('writes a quote, a note and a tip as what they are', () => {
    expect(html('> plain words')).toBe(
      '<blockquote class="aside plain">\n<p>plain words</p>\n</blockquote>',
    );
    expect(html('> [!WARNING]\n> careful')).toBe(
      '<blockquote class="aside warning">\n<p>careful</p>\n</blockquote>',
    );
    expect(html('> [!TIP]\n> first\n>\n> second')).toBe(
      '<details class="aside tip">\n<summary>Why</summary>\n<p>first</p>\n<p>second</p>\n</details>',
    );
  });

  it('marks a link to a GenBank or FASTA file as a download, and no other', () => {
    expect(html('[a](tutorials/files/a.gb)')).toContain(
      '<a href="../../tutorials/files/a.gb" download>a</a>',
    );
    expect(html('[a](tutorials/files/a.fasta)')).toContain(
      '<a href="../../tutorials/files/a.fasta" download>a</a>',
    );
    // the anchor is not part of the file name
    expect(html('[a](tutorials/files/a.gb#top)')).toContain(
      '<a href="../../tutorials/files/a.gb#top" download>a</a>',
    );
    expect(html('[a](tutorials/files/a.gb.bak)')).toContain(
      '<a href="../../tutorials/files/a.gb.bak">a</a>',
    );
    expect(html('[a](tutorials/files/a.md)')).toContain(
      '<a href="../../tutorials/files/a.md">a</a>',
    );
    expect(html('[a](tutorials/files/gb)')).toContain('<a href="../../tutorials/files/gb">a</a>');
  });

  it('keeps the anchor of a link that resolves to an anchor alone', () => {
    const own = {
      fromDir: 'guide/x/',
      resolve: (href: string): string | null => (href === 'self' ? '#top' : null),
    };
    const out = parseMarkdown('[a](self)')
      .map((b) => block(b, own))
      .join('\n');
    expect(out).toBe('<p><a href="../../#top">a</a></p>');
  });
});
