import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GUIDE } from './guide';
import {
  SITE_URL,
  generateGuideFiles,
  generateSitemap,
  guideSlug,
  matchStaticRequest,
  type SourcePage,
} from './staticGuide';
import {
  SAMPLE_FILE,
  TUTORIAL_ORDER,
  generateTutorialFiles,
  tutorialUrls,
  type SampleFile,
} from './staticTutorials';

// #312: the tutorials as static pages, from docs/tutorials.
const dir = new URL('../../../docs/tutorials/', import.meta.url);
const read = (id: string): SourcePage => ({
  id,
  markdown: readFileSync(new URL(`${id}.md`, dir), 'utf8'),
});
const mdIds = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));
const index = read('README');
const pages = TUTORIAL_ORDER.map(read);
const samples: SampleFile[] = readdirSync(new URL('files/', dir))
  .filter((f) => SAMPLE_FILE.test(f))
  .sort()
  .map((name) => ({ name, content: readFileSync(new URL(`files/${name}`, dir), 'utf8') }));
const files = generateTutorialFiles(index, pages, samples);
const html = files.filter((f) => f.path.endsWith('.html'));
const guideFiles = generateGuideFiles(GUIDE.map((g) => ({ id: g.id, markdown: g.markdown })));
const byPath = new Map([...files, ...guideFiles].map((f) => [f.path, f.content]));

describe('static tutorial pages (#312)', () => {
  it('cover every Markdown page in docs/tutorials, in a stated order', () => {
    expect([...TUTORIAL_ORDER, 'README'].sort()).toEqual([...mdIds].sort());
  });

  it('emit an index, one page per tutorial and every sample file', () => {
    expect(byPath.has('tutorials/index.html')).toBe(true);
    for (const id of TUTORIAL_ORDER) expect(byPath.has(`tutorials/${id}/index.html`)).toBe(true);
    expect(samples.length).toBeGreaterThan(10);
    for (const s of samples) expect(byPath.get(`tutorials/files/${s.name}`)).toBe(s.content);
    expect(files).toHaveLength(1 + pages.length + samples.length);
  });

  it('render the index: a heading and a link to every tutorial', () => {
    const body = byPath.get('tutorials/index.html') ?? '';
    expect(body).toContain('<h1 id="plasmidpop-tutorials">PlasmidPop tutorials</h1>');
    for (const id of TUTORIAL_ORDER) expect(body, id).toContain(`href="./${id}/"`);
    expect(body).toContain('href="../guide/cloning/"');
  });

  it('give every page a title, description and absolute canonical', () => {
    for (const f of html) {
      const title = /<title>([^<]+)<\/title>/.exec(f.content)?.[1] ?? '';
      expect(title.length, f.path).toBeGreaterThan(10);
      const desc = /<meta name="description" content="([^"]+)"/.exec(f.content)?.[1] ?? '';
      expect(desc.length, f.path).toBeGreaterThan(20);
      expect(desc.length, f.path).toBeLessThanOrEqual(160);
      const canonical = /<link rel="canonical" href="([^"]+)"/.exec(f.content)?.[1];
      expect(canonical, f.path).toBe(`${SITE_URL}${f.path.replace(/index\.html$/, '')}`);
    }
    expect(new Set(html.map((f) => /<title>([^<]+)/.exec(f.content)?.[1])).size).toBe(html.length);
  });

  it('use no script and no third-party fetches', () => {
    for (const f of html) {
      expect(f.content, f.path).not.toMatch(/<script/i);
      expect(f.content, f.path).not.toMatch(
        /<(?:link(?![^>]*canonical)|img|iframe)[^>]+(?:href|src)="https?:/i,
      );
    }
  });

  it('resolve every internal link to an emitted page, file and anchor', () => {
    for (const f of html) {
      for (const m of f.content.matchAll(/<a href="([^"]+)"/g)) {
        const href = (m[1] ?? '').replace(/&amp;/g, '&');
        if (/^https?:/.test(href)) continue;
        const [path = '', hash] = href.split('#');
        const resolvedDir = posix.join(posix.dirname(f.path), path).replace(/^\.\/?$/, '');
        const resolved = /\.(?:gb|fasta)$/.test(path)
          ? resolvedDir
          : path === ''
            ? f.path
            : `${resolvedDir === '' ? '' : `${resolvedDir.replace(/\/$/, '')}/`}index.html`;
        if (path !== '' && !/\.(?:gb|fasta)$/.test(path))
          expect(path.endsWith('/'), `${f.path}: ${href}`).toBe(true);
        if (resolved === 'index.html') continue; // the app itself
        const target = byPath.get(resolved);
        expect(target, `${f.path} links to ${href}`).toBeDefined();
        if (hash !== undefined) expect(target, `${f.path} -> ${href}`).toContain(`id="${hash}"`);
      }
    }
  });

  it('link every sample file as a download from sample-files, and every tutorial links its own', () => {
    const table = byPath.get('tutorials/sample-files/index.html') ?? '';
    for (const s of samples) expect(table, s.name).toContain(`href="../files/${s.name}" download`);
    for (const id of ['ligation', 'golden-gate', 'golden-gate-parts', 'modular']) {
      const page = byPath.get(`tutorials/${id}/index.html`) ?? '';
      expect(page, id).toMatch(/href="\.\.\/files\/[\w.-]+\.gb" download/);
    }
  });

  it('use only sample files that exist, in Markdown links and in prose', () => {
    const names = new Set(samples.map((s) => s.name));
    for (const p of [index, ...pages]) {
      for (const m of p.markdown.matchAll(/\]\(files\/([^)#]+)\)/g))
        expect(names.has(m[1] ?? ''), `${p.id}: ${m[1]}`).toBe(true);
      for (const m of p.markdown.matchAll(/`((?:p?GG|pLig|Insert)[\w-]*\.gb)`/g))
        expect(names.has(m[1] ?? ''), `${p.id} names ${m[1]}`).toBe(true);
    }
  });

  it('chain the tutorials with previous, index and next links', () => {
    const second = byPath.get('tutorials/ligation/index.html') ?? '';
    expect(second).toContain('href="../before-you-start/"');
    expect(second).toContain('href="../golden-gate/"');
    expect(second).toContain('href="../"');
    const first = byPath.get('tutorials/before-you-start/index.html') ?? '';
    expect(first).toContain('<span></span>');
  });

  it('ship synthetic files only, never an NCBI record', () => {
    for (const s of samples) {
      expect(s.content, s.name).not.toMatch(/^ACCESSION\s+(?:NM|NR|NC|NG|NP|XM)_/m);
      expect(s.content, s.name).not.toMatch(/NM_000207/);
    }
    for (const f of files) expect(f.path, f.path).not.toMatch(/ncbi/i);
  });

  it('fail loudly: an unresolved sample file is not silently a link to nowhere', () => {
    const out = generateTutorialFiles(
      { id: 'README', markdown: '# I\n\n[x](files/Gone.gb)' },
      [],
      [],
    );
    const body = out[0]?.content ?? '';
    expect(body).toContain('href="./files/Gone.gb"');
    expect(byPath.has('tutorials/files/Gone.gb')).toBe(false);
  });
});

describe('tutorial links in the Markdown, exactly', () => {
  const out = generateTutorialFiles(
    {
      id: 'README',
      markdown:
        '# Index\n\n[a](alpha.md#s) [i](README.md) [g](../guide/12-cloning.md#the-bench) [f](files/X.gb) [w](https://example.org/)',
    },
    [{ id: 'alpha', markdown: '# Alpha\n\n[back](README.md) [file](files/X.gb)' }],
    [{ name: 'X.gb', content: 'LOCUS' }],
  );
  it('map to site pages, guide pages and downloads', () => {
    const body = out[0]?.content ?? '';
    expect(body).toContain('<a href="./alpha/#s">a</a>');
    expect(body).toContain('<a href="./">i</a>');
    expect(body).toContain('<a href="../guide/cloning/#the-bench">g</a>');
    expect(body).toContain('<a href="./files/X.gb" download>f</a>');
    expect(body).toContain('<a href="https://example.org/" rel="noopener">w</a>');
  });
  it('are written relative to the page', () => {
    const page = out[1]?.content ?? '';
    expect(page).toContain('<a href="../">back</a>');
    expect(page).toContain('<a href="../files/X.gb" download>file</a>');
    expect(page).toContain('<strong>PlasmidPop tutorials</strong>');
    expect(page).toContain('<a href="../">All tutorials</a>');
    expect(out[2]).toEqual({ path: 'tutorials/files/X.gb', content: 'LOCUS' });
  });
});

describe('sitemap and dev server, with the tutorials', () => {
  it('list the tutorial index and every page after the guide', () => {
    const map = generateSitemap([{ id: '01-a', markdown: '# A' }], tutorialUrls(pages));
    const locs = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      SITE_URL,
      `${SITE_URL}guide/`,
      `${SITE_URL}guide/${guideSlug('01-a')}/`,
      `${SITE_URL}tutorials/`,
      ...TUTORIAL_ORDER.map((id) => `${SITE_URL}tutorials/${id}/`),
    ]);
  });

  it('serve the pages and the sample files, and redirect a missing slash', () => {
    expect(matchStaticRequest('/tutorials/', '/')).toEqual({
      kind: 'file',
      path: 'tutorials/index.html',
    });
    expect(matchStaticRequest('/x/tutorials/ligation/?a=1', '/x/')).toEqual({
      kind: 'file',
      path: 'tutorials/ligation/index.html',
    });
    expect(matchStaticRequest('/tutorials/files/GG-gene.gb', '/')).toEqual({
      kind: 'file',
      path: 'tutorials/files/GG-gene.gb',
    });
    expect(matchStaticRequest('/tutorials/ligation', '/')).toEqual({
      kind: 'redirect',
      to: '/tutorials/ligation/',
    });
    expect(matchStaticRequest('/tutorials?x=1', '/')).toEqual({
      kind: 'redirect',
      to: '/tutorials/?x=1',
    });
    expect(matchStaticRequest('/tutorials/files/a/b.gb', '/')).toBeNull();
    expect(matchStaticRequest('/mytutorials/', '/')).toBeNull();
  });
});
