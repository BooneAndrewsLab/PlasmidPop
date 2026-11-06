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
} from './staticGuide.ts';
import { guideLinkTarget, parseMarkdown, plainText } from './markdown.ts';

/**
 * The tutorials as plain static HTML (#312): `/tutorials/` with an index
 * where a reader picks the method, one page per tutorial, and the sample
 * files as downloads. Generated from `docs/tutorials` with the guide's
 * parser, renderer and theme. Pure, like `staticGuide.ts`: the Vite plugin
 * reads the files, the tests call this directly.
 */

/**
 * The index's sections (item 137), in order: the `##` headings of
 * `docs/tutorials/README.md` and the pages under each. A test ties the two,
 * so a tutorial cannot reach the site without a row in the right table.
 */
export const TUTORIAL_SECTIONS: readonly { title: string; ids: readonly string[] }[] = [
  {
    title: 'Cloning',
    ids: [
      'digest-pcr',
      'ligation',
      'golden-gate',
      'golden-gate-parts',
      'modular',
      'gibson',
      'in-fusion',
      'overlap-pcr',
      'gateway',
      'mutagenesis',
    ],
  },
  { title: 'Analysis', ids: ['enzymes', 'align', 'crispr'] },
  { title: 'Reference', ids: ['before-you-start', 'sample-files'] },
];

/**
 * The pages after the index, in reading order (the pager's chain): Before you
 * start, every tutorial in section order, then Sample files. The folder holds
 * the pages (`README.md` is the index, which is not in this list); a page
 * missing from here or from the folder fails the tests rather than vanishing
 * from the site.
 */
export const TUTORIAL_ORDER: readonly string[] = [
  'before-you-start',
  ...TUTORIAL_SECTIONS.filter((s) => s.title !== 'Reference').flatMap((s) => s.ids),
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
    `Step-by-step exercises for <a href="${home}">PlasmidPop</a>, a free DNA sequence editor and plasmid viewer that runs in your browser. The sample files are synthetic. Reference: the <a href="${escapeHtml(relative(fromDir, 'guide/'))}">user guide</a>.`,
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
        title: `${indexTitle}: cloning and analysis, step by step`,
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
    // The name before the first colon: the full title is a sentence, too long for a pager.
    const short = (title: string): string => escapeHtml(title.split(':')[0] ?? title);
    const link = (t: typeof prev, dir_: 'Previous' | 'Next'): string =>
      t === undefined
        ? '<span></span>'
        : `<a class="pager__${dir_ === 'Next' ? 'next' : 'prev'}" href="${escapeHtml(relative(dir, pagePath(t.id)))}"><span class="pager__dir">${dir_ === 'Next' ? 'Next &rarr;' : '&larr; Previous'}</span>${short(t.title)}</a>`;
    const up = `<a href="${escapeHtml(relative(dir, pagePath(null)))}">All tutorials</a>`;
    const pager = `<nav class="pager" aria-label="Tutorials">${link(prev, 'Previous')}${up}${link(next, 'Next')}</nav>`;
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
