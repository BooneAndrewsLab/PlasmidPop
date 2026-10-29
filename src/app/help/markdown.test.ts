import {
  anchorTarget,
  guideLinkTarget,
  headingSlug,
  markdownTitle,
  parseInline,
  parseMarkdown,
  plainText,
} from './markdown';

describe('parseMarkdown', () => {
  it('reads headings, joins wrapped paragraph lines and splits on blank lines', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line.\n\n## Section\n\nMore.');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, children: [{ kind: 'text', text: 'Title' }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'First line second line.' }] },
      { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'Section' }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'More.' }] },
    ]);
  });

  it('reads bullet and numbered lists with wrapped items', () => {
    const blocks = parseMarkdown('- one\n- two\n  continued\n\n1. first\n2. second\n   more\n');
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two continued' }]],
      },
      {
        kind: 'list',
        ordered: true,
        items: [[{ kind: 'text', text: 'first' }], [{ kind: 'text', text: 'second more' }]],
      },
    ]);
  });

  it('reads tables and fenced code', () => {
    const blocks = parseMarkdown(
      '| Keys | Action |\n| --- | --- |\n| `A` | Insert |\n\n```\nx\n  y\n```\n',
    );
    expect(blocks[0]).toEqual({
      kind: 'table',
      header: [[{ kind: 'text', text: 'Keys' }], [{ kind: 'text', text: 'Action' }]],
      rows: [[[{ kind: 'code', text: 'A' }], [{ kind: 'text', text: 'Insert' }]]],
    });
    expect(blocks[1]).toEqual({ kind: 'code', text: 'x\n  y' });
  });
});

describe('parseInline', () => {
  it('handles code, bold, italic and links, leaving stray markers as text', () => {
    expect(parseInline('Press `Ctrl+S` to **save** a *file* at [x](y.md); 2 * 3 * 4')).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'code', text: 'Ctrl+S' },
      { kind: 'text', text: ' to ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'save' }] },
      { kind: 'text', text: ' a ' },
      { kind: 'em', children: [{ kind: 'text', text: 'file' }] },
      { kind: 'text', text: ' at ' },
      { kind: 'link', href: 'y.md', children: [{ kind: 'text', text: 'x' }] },
      { kind: 'text', text: '; 2 * 3 * 4' },
    ]);
  });

  it('keeps markdown-looking characters inside code spans', () => {
    expect(parseInline('`a*b` and `[c](d)`')).toEqual([
      { kind: 'code', text: 'a*b' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: '[c](d)' },
    ]);
  });
});

describe('helpers', () => {
  it('extracts the title and plain text', () => {
    expect(markdownTitle('intro\n# The **Title**\n## Not this')).toBe('The Title');
    expect(markdownTitle('no heading')).toBeNull();
    expect(plainText(parseInline('a `b` [c](d)'))).toBe('a b c');
  });

  it('slugs a heading the way GitHub does, and reads a `#…` link', () => {
    expect(headingSlug('Saving in Firefox and Safari')).toBe('saving-in-firefox-and-safari');
    expect(headingSlug('Local storage and recent files')).toBe('local-storage-and-recent-files');
    expect(headingSlug('  ORFs, and what counts  ')).toBe('orfs-and-what-counts');
    expect(anchorTarget('#working-copies')).toBe('working-copies');
    expect(anchorTarget('02-files.md')).toBeNull();
  });

  it('recognises links to other guide pages', () => {
    expect(guideLinkTarget('05-features.md')).toBe('05-features');
    expect(guideLinkTarget('./05-features.md#editing')).toBe('05-features');
    expect(guideLinkTarget('https://example.org/x.md')).toBeNull();
    expect(guideLinkTarget('#anchor')).toBeNull();
  });

  it('keeps indented blocks inside a list item and the written numbering', () => {
    const blocks = parseMarkdown(
      '1. one\n\n   | A | B |\n   | --- | --- |\n   | x | y |\n\n   _Why: because._\n\n2. two\n\n5. five\n',
    );
    expect(blocks).toHaveLength(2);
    const [first, second] = blocks;
    expect(first?.kind === 'list' && first.items).toHaveLength(2);
    expect(first?.kind === 'list' && first.details?.[0]?.map((b) => b.kind)).toEqual([
      'table',
      'paragraph',
    ]);
    expect(first?.kind === 'list' && first.details?.[1]).toEqual([]);
    expect(second?.kind === 'list' && second.start).toBe(5);
    expect(first?.kind === 'list' && first.start).toBeUndefined();
  });

  it('does not swallow the text after a list as a detail', () => {
    const blocks = parseMarkdown('- a\n- b\n\nNot part of it.\n');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'paragraph']);
    expect(blocks[0]).toEqual({
      kind: 'list',
      ordered: false,
      items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
    });
  });

  it('reads checkboxes and underscore italics, but not snake_case', () => {
    expect(parseInline('[ ] open it')).toEqual([
      { kind: 'check', checked: false },
      { kind: 'text', text: 'open it' },
    ]);
    expect(parseInline('[x] done')[0]).toEqual({ kind: 'check', checked: true });
    expect(parseInline('see _this_ now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'em', children: [{ kind: 'text', text: 'this' }] },
      { kind: 'text', text: ' now' },
    ]);
    expect(parseInline('a snake_case_name')).toEqual([{ kind: 'text', text: 'a snake_case_name' }]);
    expect(parseInline('a [ ] mid')).toEqual([{ kind: 'text', text: 'a [ ] mid' }]);
  });

  it('reads quotes and GitHub alert boxes, also inside a list item', () => {
    expect(parseMarkdown('> plain **words**\n> more')[0]).toEqual({
      kind: 'quote',
      tone: 'plain',
      children: [
        {
          kind: 'paragraph',
          children: [
            { kind: 'text', text: 'plain ' },
            { kind: 'strong', children: [{ kind: 'text', text: 'words' }] },
            { kind: 'text', text: ' more' },
          ],
        },
      ],
    });
    const tones = ['NOTE', 'WARNING', 'TIP'].map((t) => {
      const q = parseMarkdown(`> [!${t}]\n> body`)[0];
      return q?.kind === 'quote' ? [q.tone, q.children.length] : null;
    });
    expect(tones).toEqual([
      ['note', 1],
      ['warning', 1],
      ['tip', 1],
    ]);
    const list = parseMarkdown('1. step\n\n   > [!NOTE]\n   > you see it\n\n2. next\n')[0];
    expect(list?.kind === 'list' && list.details?.[0]?.map((b) => b.kind)).toEqual(['quote']);
  });
});
