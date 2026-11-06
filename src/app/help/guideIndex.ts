import { headingSlug, parseMarkdown, plainText, type Block } from './markdown.ts';
import { createIndex, type GuideIndex, type Section } from './guideSearch.ts';

/**
 * The guide's pages cut into searchable sections (#409, item 138): one per
 * heading, holding the plain text under it. The dialog and the static pages
 * both build their index from this, so they search the same text.
 */

export interface IndexedPage {
  /** File stem, e.g. `05-features`. */
  readonly id: string;
  readonly markdown: string;
}

function blockText(b: Block): string {
  switch (b.kind) {
    case 'heading':
    case 'paragraph':
      return plainText(b.children);
    case 'list':
      return b.items
        .map((item, i) => [plainText(item), ...(b.details?.[i] ?? []).map(blockText)].join(' '))
        .join(' ');
    case 'quote':
      return b.children.map(blockText).join(' ');
    case 'code':
      return b.text;
    case 'table':
      return [...b.header, ...b.rows.flat()].map(plainText).join(' ');
  }
}

/** Runs of whitespace (and the line breaks of a code block) become one space. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The sections of every page, in reading order. */
export function guideSections(pages: readonly IndexedPage[]): Section[] {
  const sections: Section[] = [];
  for (const p of pages) {
    const blocks = parseMarkdown(p.markdown);
    const h1 = blocks.find((b) => b.kind === 'heading' && b.level === 1);
    const pageTitle = h1?.kind === 'heading' ? plainText(h1.children) : p.id;
    // The page's title heading opens its first section; text before any
    // heading (none, in the guide) would belong to the title as well.
    let open: { heading: string; anchor: string; text: string[] } | null = null;
    const flush = (): void => {
      if (open !== null)
        sections.push({
          page: p.id,
          pageTitle,
          heading: open.heading,
          anchor: open.anchor,
          text: squash(open.text.join(' ')),
        });
    };
    for (const b of blocks) {
      if (b.kind === 'heading') {
        flush();
        const heading = plainText(b.children);
        open = { heading, anchor: headingSlug(heading), text: [] };
      } else {
        open ??= { heading: pageTitle, anchor: headingSlug(pageTitle), text: [] };
        open.text.push(blockText(b));
      }
    }
    flush();
  }
  return sections;
}

/** The index the dialog searches. */
export function buildGuideIndex(pages: readonly IndexedPage[]): GuideIndex {
  return createIndex(guideSections(pages));
}
