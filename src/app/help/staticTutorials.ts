import {
  SITE_URL,
  block,
  describe,
  document,
  escapeHtml,
  guideSlug,
  relative,
  type LinkContext,
  type SiteSection,
  type SourcePage,
  type StaticFile,
} from './staticGuide';
import { guideLinkTarget, parseMarkdown, plainText } from './markdown';

/**
 * The tutorials as plain static HTML (#312): `/tutorials/` with an index
 * where a reader picks the method, one page per tutorial, and the sample
 * files as downloads. Generated from `docs/tutorials` with the guide's
 * parser, renderer and theme. Pure, like `staticGuide.ts`: the Vite plugin
 * reads the files, the tests call this directly.
 */

/**
 * The pages after the index, in reading order. The folder holds the pages
 * (`README.md` is the index, which is not in this list); a page missing from
 * here or from the folder fails the tests rather than vanishing from the site.
 */
export const TUTORIAL_ORDER: readonly string[] = [
  'before-you-start',
  'ligation',
  'golden-gate',
  'golden-gate-parts',
  'modular',
  'sample-files',
];

/** Sample files are published as `tutorials/files/<name>`. */
export const SAMPLE_FILE = /^[\w.-]+\.(?:gb|fasta)$/;

export interface SampleFile {
  /** File name, e.g. `GG-gene.gb`. */
  readonly name: string;
  readonly content: string;
}

function pagePath(id: string | null): string {
  return id === null ? 'tutorials/' : `tutorials/${id}/`;
}

export function tutorialUrl(id: string | null): string {
  return `${SITE_URL}${pagePath(id)}`;
}

const SECTION: SiteSection = {
  name: 'PlasmidPop tutorials',
  indexPath: 'tutorials/',
  indexLabel: 'All tutorials',
  footer: (home, fromDir) =>
    `Step-by-step cloning exercises for <a href="${home}">PlasmidPop</a>, a free DNA sequence editor and plasmid viewer that runs in your browser. The sample files are synthetic. Reference: the <a href="${escapeHtml(relative(fromDir, 'guide/'))}">user guide</a>.`,
};

/**
 * Links in a tutorial's Markdown, relative to `docs/tutorials`: another
 * tutorial (`ligation.md`, `README.md` for the index), a sample file
 * (`files/GG-gene.gb`) or a guide page (`../guide/12-cloning.md#the-bench`).
 */
function tutorialContext(fromDir: string): LinkContext {
  return {
    fromDir,
    resolve: (href) => {
      const at = href.indexOf('#');
      const path = at < 0 ? href : href.slice(0, at);
      const hash = at < 0 ? '' : href.slice(at);
      const guide = /^\.\.\/guide\/([\w-]+\.md)$/.exec(path);
      if (guide !== null) {
        const id = guideLinkTarget(guide[1] ?? '');
        if (id === null) return null;
        return id === 'README' ? `guide/${hash}` : `guide/${guideSlug(id)}/${hash}`;
      }
      const file = /^files\/([\w.-]+)$/.exec(path);
      if (file !== null) return `tutorials/files/${file[1] ?? ''}`;
      const page = guideLinkTarget(path);
      if (page === null) return null;
      return (page === 'README' ? pagePath(null) : pagePath(page)) + hash;
    },
  };
}

function titleOf(p: SourcePage, blocks: ReturnType<typeof parseMarkdown>): string {
  const h1 = blocks.find((b) => b.kind === 'heading' && b.level === 1);
  return h1?.kind === 'heading' ? plainText(h1.children) : p.id;
}

/**
 * Every file the static tutorials add to the site: the index, one page per
 * tutorial in `TUTORIAL_ORDER`, and the sample files, copied as they are.
 */
export function generateTutorialFiles(
  index: SourcePage,
  pages: readonly SourcePage[],
  samples: readonly SampleFile[],
): StaticFile[] {
  const parsed = pages.map((p) => {
    const blocks = parseMarkdown(p.markdown);
    return { ...p, blocks, title: titleOf(p, blocks) };
  });
  const indexBlocks = parseMarkdown(index.markdown);
  const indexTitle = titleOf(index, indexBlocks);

  const files: StaticFile[] = [
    {
      path: 'tutorials/index.html',
      content: document({
        section: SECTION,
        title: `${indexTitle}: cloning step by step`,
        description: describe(indexBlocks, indexTitle),
        canonical: tutorialUrl(null),
        fromDir: 'tutorials/',
        body: indexBlocks.map((b) => block(b, tutorialContext('tutorials/'))).join('\n'),
        pager: '',
      }),
    },
  ];
  parsed.forEach((p, i) => {
    const dir = pagePath(p.id);
    const prev = parsed[i - 1];
    const next = parsed[i + 1];
    const link = (t: typeof prev, label: string): string =>
      t === undefined
        ? '<span></span>'
        : `<a href="${escapeHtml(relative(dir, pagePath(t.id)))}">${label}</a>`;
    const up = `<a href="${escapeHtml(relative(dir, pagePath(null)))}">All tutorials</a>`;
    const pager = `<nav class="pager" aria-label="Tutorials">${link(prev, `&larr; ${escapeHtml(prev?.title ?? '')}`)}${up}${link(next, `${escapeHtml(next?.title ?? '')} &rarr;`)}</nav>`;
    files.push({
      path: `${dir}index.html`,
      content: document({
        section: SECTION,
        title: `${p.title} | PlasmidPop tutorials`,
        description: describe(p.blocks, p.title),
        canonical: tutorialUrl(p.id),
        fromDir: dir,
        body: p.blocks.map((b) => block(b, tutorialContext(dir))).join('\n'),
        pager,
      }),
    });
  });
  for (const s of samples) files.push({ path: `tutorials/files/${s.name}`, content: s.content });
  return files;
}

/** The sitemap's tutorial urls: the index, then every page. */
export function tutorialUrls(pages: readonly SourcePage[]): string[] {
  return [tutorialUrl(null), ...pages.map((p) => tutorialUrl(p.id))];
}
