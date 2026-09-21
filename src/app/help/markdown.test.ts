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
});
