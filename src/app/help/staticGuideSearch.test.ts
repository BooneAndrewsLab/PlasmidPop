// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformWithOxc } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import { guideSections } from './guideIndex';
import { createIndex, search, unpack, type PackedIndex, type SearchResult } from './guideSearch';
import { generateGuideFiles, generateSearchFiles, type SourcePage } from './staticGuide';

// Item 138 (#409): the static guide's search box. The script is the ranking
// module with its types stripped, plus the box's own code; here it is built
// the way vite.config.ts builds it, and run.
// jsdom replaces `URL`, which `fs` does not take, so the paths are strings.
const dir = join(import.meta.dirname, '../../../docs/guide');
const pages: SourcePage[] = readdirSync(dir)
  .filter((f) => /^\d+-.*\.md$/.test(f))
  .sort()
  .map((f) => ({ id: f.replace(/\.md$/, ''), markdown: readFileSync(join(dir, f), 'utf8') }));

const core = (
  await transformWithOxc(
    readFileSync(join(import.meta.dirname, 'guideSearch.ts'), 'utf8'),
    'guideSearch.ts',
  )
).code;
const searchFiles = generateSearchFiles(pages, core);
const script = searchFiles.find((f) => f.path === 'guide/search.js')?.content ?? '';
const packed = JSON.parse(
  searchFiles.find((f) => f.path === 'guide/search-index.json')?.content ?? 'null',
) as PackedIndex;

/** Runs script text as a function body, as a page would run a script. */
function run(code: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return (new Function(code) as () => unknown)();
}

/** The ranking code as the page runs it, without the box, for comparing. */
function browserSearch(): (query: string) => SearchResult[] {
  const body = `${core.replace(/^export /gm, '')}\nreturn { createIndex, unpack, search };`;
  const m = run(body) as {
    createIndex: typeof createIndex;
    unpack: typeof unpack;
    search: typeof search;
  };
  const index = m.createIndex(m.unpack(packed));
  return (q) => m.search(index, q);
}

describe('the search files of the static guide', () => {
  it('are an index of every section and a script', () => {
    expect(searchFiles.map((f) => f.path)).toEqual(['guide/search-index.json', 'guide/search.js']);
    expect(unpack(packed)).toEqual(guideSections(pages));
  });

  it('keep the index small enough to fetch on first use', () => {
    const bytes = searchFiles[0]?.content.length ?? 0;
    expect(bytes).toBeGreaterThan(10_000);
    expect(bytes).toBeLessThan(400_000);
  });

  it('script has no import, no third party and no markup written from text', () => {
    expect(script).not.toMatch(/^import /m);
    expect(script).not.toMatch(/https?:\/\//);
    expect(script).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(script).not.toMatch(/:\s*(?:string|number|readonly)\b/);
  });

  it('are written into pages whose box is hidden until the script shows it', () => {
    const files = generateGuideFiles(pages);
    expect(files.length).toBe(pages.length + 1);
    for (const f of files)
      expect(f.content, f.path).toMatch(/<form class="search" role="search" hidden>/);
  });
});

describe('the page’s ranking and the dialog’s', () => {
  // Both are one source file, so the same queries must give the same results,
  // in the same order, with the same snippets.
  const queries = [
    'dam',
    'dam methylation',
    'keyboard shortcuts',
    'Ctrl+Shift+Z',
    'H840A',
    'BsaI',
    'enz',
    'restriction enzyme dig',
    'export',
    'zzzzzz',
    '',
    '+*(',
    'Café',
  ];

  it('give the same results for a fixed set of queries', () => {
    const page = browserSearch();
    const dialog = createIndex(guideSections(pages));
    for (const q of queries) expect(page(q), q).toEqual(search(dialog, q));
  });
});

describe('the box, run in a page', () => {
  function setup() {
    document.body.innerHTML = `<header><form class="search" role="search" hidden>
<input type="search" placeholder="Search the guide">
<ul class="search__results" hidden></ul></form></header><main><p id="outside">x</p></main>`;
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(packed) }));
    vi.stubGlobal('fetch', fetchMock);
    const url = 'http://localhost/PlasmidPop/guide/search.js';
    // A module's `import.meta` and `export`s do not run in a function.
    const code = script
      .replace(/^export /gm, '')
      .replaceAll('import.meta.url', JSON.stringify(url));
    run(code);
    const form = document.querySelector<HTMLFormElement>('form.search');
    const input = document.querySelector<HTMLInputElement>('input');
    const list = document.querySelector<HTMLUListElement>('ul');
    if (form === null || input === null || list === null) throw new Error('no box');
    const type = async (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.waitFor(() => {
        expect(list.hidden).toBe(false);
      });
    };
    return { form, input, list, fetchMock, type };
  }

  it('shows the box, and fetches the index only when it is used', () => {
    const { form, fetchMock, input } = setup();
    expect(form.hidden).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('focus'));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String((fetchMock.mock.calls as unknown[][])[0]?.[0])).toBe(
      'http://localhost/PlasmidPop/guide/search-index.json',
    );
  });

  it('lists results as links to the page and heading, with the matches marked', async () => {
    const { list, type } = setup();
    await type('dam methylation');
    const links = [...list.querySelectorAll('a')];
    expect(links.length).toBeGreaterThan(0);
    const expected = browserSearch()('dam methylation');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      expected.map(
        (r) => `http://localhost/PlasmidPop/guide/${r.page.replace(/^\d+-/, '')}/#${r.anchor}`,
      ),
    );
    expect(list.querySelector('mark')).not.toBeNull();
    expect(links[0]?.textContent).toContain(expected[0]?.heading ?? '?');
  });

  it('says so when nothing matches, and lists nothing when the box is empty', async () => {
    const { list, type, input } = setup();
    await type('zzzzzz');
    expect(list.textContent).toContain('No matches');
    expect(list.querySelectorAll('a')).toHaveLength(0);
    input.value = '  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(list.hidden).toBe(true);
  });

  it('puts a typed < in the page as text, never as markup', async () => {
    const { list, type } = setup();
    await type('x < y');
    expect(list.querySelector('script')).toBeNull();
  });

  it('moves between results with the arrow keys, and Escape clears, then leaves', async () => {
    const { list, input, type } = setup();
    await type('dam');
    const key = (target: Element, k: string) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
    input.focus();
    key(input, 'ArrowDown');
    const links = [...list.querySelectorAll('a')];
    expect(document.activeElement).toBe(links[0]);
    key(links[0] as Element, 'ArrowDown');
    expect(document.activeElement).toBe(links[1]);
    key(links[1] as Element, 'ArrowUp');
    key(links[0] as Element, 'ArrowUp');
    expect(document.activeElement).toBe(input);
    key(input, 'Escape');
    expect(input.value).toBe('');
    expect(list.hidden).toBe(true);
  });

  it('opens the first result on Enter', async () => {
    const { form, list, type } = setup();
    await type('keyboard shortcuts');
    const first = list.querySelector('a');
    const click = vi.fn((e: Event) => {
      e.preventDefault();
    });
    first?.addEventListener('click', click);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(click).toHaveBeenCalledOnce();
  });

  it('closes the results on a click elsewhere, and "/" focuses the box', async () => {
    const { list, input, type } = setup();
    await type('dam');
    document.getElementById('outside')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(list.hidden).toBe(true);
    const slash = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    document.body.dispatchEvent(slash);
    expect(slash.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    // Typing a slash into the box is typing.
    const typed = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    input.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
  });

  it('says the search is not available when the index cannot be fetched', async () => {
    document.body.innerHTML = `<form class="search" hidden><input><ul hidden></ul></form>`;
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    run(
      script.replace(/^export /gm, '').replaceAll('import.meta.url', '"http://x/guide/search.js"'),
    );
    const input = document.querySelector('input');
    const list = document.querySelector('ul');
    if (input === null || list === null) throw new Error('no box');
    input.value = 'dam';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(list.textContent).toContain('not available');
    });
  });
});
