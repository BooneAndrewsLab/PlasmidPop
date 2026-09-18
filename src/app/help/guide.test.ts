import { GUIDE, guidePage } from './guide';
import { guideLinkTarget, parseMarkdown, type Block, type Inline } from './markdown';

function links(inlines: readonly Inline[]): string[] {
  return inlines.flatMap((i) =>
    i.kind === 'link' ? [i.href, ...links(i.children)] : 'children' in i ? links(i.children) : [],
  );
}

function blockLinks(block: Block): string[] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return links(block.children);
    case 'list':
      return block.items.flatMap(links);
    case 'table':
      return [...block.header.flatMap(links), ...block.rows.flat().flatMap(links)];
    case 'code':
      return [];
  }
}

describe('the user guide', () => {
  it('has a titled page per file with unique ids', () => {
    expect(GUIDE.length).toBeGreaterThanOrEqual(10);
    for (const p of GUIDE) {
      expect(p.title).not.toBe(p.id);
      expect(p.markdown.startsWith(`# ${p.title}`)).toBe(true);
    }
    expect(new Set(GUIDE.map((p) => p.id)).size).toBe(GUIDE.length);
  });

  it('only links to pages that exist', () => {
    for (const p of GUIDE) {
      for (const href of parseMarkdown(p.markdown).flatMap(blockLinks)) {
        const target = guideLinkTarget(href);
        if (target === null) continue;
        expect(guidePage(target), `${p.id} links to ${href}`).toBeDefined();
      }
    }
  });

  it('mentions every sidebar tab and the main shortcuts', () => {
    const all = GUIDE.map((p) => p.markdown).join('\n');
    for (const word of ['Features', 'Enzymes', 'ORFs', 'Translate', 'Primers', 'Align', 'Cloning'])
      expect(all).toContain(word);
    for (const keys of ['Ctrl+S', 'Ctrl+F', 'Ctrl+Z', 'Ctrl+C', 'Ctrl+V'])
      expect(all).toContain(keys);
  });
});
