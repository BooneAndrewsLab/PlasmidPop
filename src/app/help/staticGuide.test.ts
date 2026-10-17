import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GUIDE } from './guide';
import {
  generateGuideFiles,
  generateSitemap,
  guideSlug,
  guideUrl,
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
