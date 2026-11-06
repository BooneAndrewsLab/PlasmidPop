import { describe, expect, it } from 'vitest';

import { guideSections } from './guideIndex';
import { GUIDE } from './guide';
import {
  createIndex,
  pack,
  search,
  tokenize,
  unpack,
  type GuideIndex,
  type Section,
} from './guideSearch';

// Item 138 (#409): search over the user guide.

const section = (page: string, heading: string, text: string, pageTitle = page): Section => ({
  page,
  pageTitle,
  heading,
  anchor: heading.toLowerCase().replace(/\s+/g, '-'),
  text,
});

describe('tokenize', () => {
  it('lower-cases and splits on everything that is not a letter or a digit', () => {
    expect(tokenize('Ctrl+K, then Esc.')).toEqual(['ctrl', 'k', 'then', 'esc']);
    expect(tokenize('dam/dcm  (methylation)')).toEqual(['dam', 'dcm', 'methylation']);
  });

  it('keeps names such as BsaI and H840A whole', () => {
    expect(tokenize('BsaI-HFv2 H840A')).toEqual(['bsai', 'hfv2', 'h840a']);
  });

  it('removes accents, however they are written', () => {
    expect(tokenize('Café résumé')).toEqual(['cafe', 'resume']);
    expect(tokenize('café')).toEqual(['cafe']);
  });

  it('gives nothing for text without a letter or digit', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(' +-*/()[]\\^$.|?{} ← → ')).toEqual([]);
  });
});

describe('search ranking', () => {
  const index = createIndex([
    section('a', 'Cutting', 'The enzyme list shows each enzyme and its sites.', 'Enzymes'),
    section('a', 'Enzyme list', 'Tick an enzyme to draw its cuts.', 'Enzymes'),
    section('b', 'Methylation', 'Digests respect dam and dcm methylation of the host.', 'Files'),
    section('b', 'Saving', 'Download a GenBank file. Dam is mentioned once.', 'Files'),
    section('c', 'Dam', 'Nothing here.', 'Methylation notes'),
  ]);
  const order = (q: string): string[] => search(index, q).map((r) => `${r.page}:${r.heading}`);

  it('finds nothing for an empty or blank query, or one with no words in it', () => {
    expect(search(index, '')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
    expect(search(index, '+*?(')).toEqual([]);
    expect(search(index, '\\')).toEqual([]);
  });

  it('finds nothing when a word is missing, however many others match', () => {
    expect(search(index, 'enzyme zebra')).toEqual([]);
    expect(order('dam dcm')).toEqual(['b:Methylation']);
  });

  it('puts a heading hit above a title hit above a body hit', () => {
    expect(order('dam')).toEqual(['c:Dam', 'b:Methylation', 'b:Saving']);
  });

  it('puts a section whose page title matches above one that only says it', () => {
    expect(order('methylation')).toEqual(['b:Methylation', 'c:Dam']);
  });

  it('takes the last word as the start of a word, and no other', () => {
    expect(order('enz')).toEqual(['a:Enzyme list', 'a:Cutting']);
    // `enz` is a prefix, not a word: it does not match when it is not last.
    expect(order('enz list')).toEqual([]);
    expect(order('enzyme li')).toEqual(['a:Enzyme list', 'a:Cutting']);
  });

  it('ranks an exact word above a longer one that starts with it', () => {
    const idx = createIndex([
      section('p', 'One', 'damage is not dam'),
      section('p', 'Two', 'damage only'),
    ]);
    expect(search(idx, 'dam').map((r) => r.heading)).toEqual(['One', 'Two']);
  });

  it('counts a repeated body word a little more, up to a limit', () => {
    const idx = createIndex([
      section('p', 'Once', 'x'.repeat(1) + ' ligation'),
      section('p', 'Twice', 'ligation then ligation'),
      section('p', 'Many', 'ligation '.repeat(12)),
      section('p', 'Many2', 'ligation '.repeat(30)),
    ]);
    const hits = search(idx, 'ligation');
    expect(hits.map((r) => r.heading)).toEqual(['Many', 'Many2', 'Twice', 'Once']);
    expect(hits[0]?.score).toBe(hits[1]?.score);
    expect(hits[0]?.score).toBeGreaterThan(hits[2]?.score ?? 0);
    expect(hits[2]?.score).toBeGreaterThan(hits[3]?.score ?? 0);
  });

  it('keeps the guide’s order among equal scores, and is the same every time', () => {
    const idx = createIndex([
      section('p', 'First', 'primer'),
      section('p', 'Second', 'primer'),
      section('q', 'Third', 'primer'),
    ]);
    const first = search(idx, 'primer').map((r) => r.heading);
    expect(first).toEqual(['First', 'Second', 'Third']);
    expect(search(idx, 'primer').map((r) => r.heading)).toEqual(first);
  });

  it('ignores case, accents and punctuation in the query', () => {
    expect(order('DAM!')).toEqual(order('dam'));
    expect(order('Dám')).toEqual(order('dam'));
    expect(order('enzyme, list')).toEqual(order('enzyme list'));
  });

  it('limits the results', () => {
    const idx: GuideIndex = createIndex(
      Array.from({ length: 30 }, (_, i) => section('p', `H${i}`, 'primer')),
    );
    expect(search(idx, 'primer')).toHaveLength(20);
    expect(search(idx, 'primer', 3).map((r) => r.heading)).toEqual(['H0', 'H1', 'H2']);
  });

  it('reports where a hit is', () => {
    const [hit] = search(index, 'draw');
    expect(hit).toMatchObject({
      page: 'a',
      pageTitle: 'Enzymes',
      heading: 'Enzyme list',
      anchor: 'enzyme-list',
    });
  });
});

describe('search snippets', () => {
  const long =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ' +
    'The Methylation setting decides whether dam sites are blocked. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
  const one = (text: string, q: string) => {
    const [hit] = search(createIndex([section('p', 'Head', text)]), q);
    if (hit === undefined) throw new Error('no hit');
    return hit.snippet;
  };

  it('is the text around the first match, with ellipses where it was cut', () => {
    const s = one(long, 'dam');
    expect(s.text.startsWith('…')).toBe(true);
    expect(s.text.endsWith('…')).toBe(true);
    expect(s.text).toContain('dam sites are blocked');
    expect(s.text.length).toBeLessThanOrEqual(165);
    // It starts on a word.
    expect(s.text.slice(1)).toMatch(/^[A-Z]|^[a-z]+ /);
  });

  it('marks the words that matched, as offsets into the snippet text', () => {
    const s = one(long, 'methylation dam');
    const marked = s.marks.map(([a, b]) => s.text.slice(a, b));
    expect(marked).toEqual(['Methylation', 'dam']);
  });

  it('marks the last word where it only starts a word', () => {
    const s = one('Sites are blocked when methylated by dam.', 'dam meth');
    expect(s.marks.map(([a, b]) => s.text.slice(a, b))).toEqual(['methylated', 'dam']);
    // An earlier word is a whole word or nothing, so this finds no section.
    expect(
      search(createIndex([section('p', 'Head', 'Sites are methylated by dam.')]), 'meth dam'),
    ).toEqual([]);
  });

  it('starts at the beginning, unmarked, when only the heading matched', () => {
    const [hit] = search(
      createIndex([section('p', 'Primers', 'Design a pair of primers.')]),
      'prim',
    );
    expect(hit?.snippet.text).toContain('Design');
    const idx = createIndex([section('p', 'Zebra', long)]);
    const s = search(idx, 'zebra')[0]?.snippet;
    expect(s?.text.startsWith('Lorem ipsum')).toBe(true);
    expect(s?.text.endsWith('…')).toBe(true);
    expect(s?.marks).toEqual([]);
  });

  it('does not add an ellipsis to text that fits whole', () => {
    expect(one('A short dam note.', 'dam')).toEqual({
      text: 'A short dam note.',
      marks: [[8, 11]],
    });
  });

  it('is empty for a section with no text', () => {
    const [hit] = search(createIndex([section('p', 'Empty', '')]), 'empty');
    expect(hit?.snippet).toEqual({ text: '', marks: [] });
  });

  it('marks a word wherever accents hide it', () => {
    const s = one('The café menu.', 'cafe');
    expect(s.marks).toEqual([[4, 8]]);
  });
});

describe('pack and unpack', () => {
  const sections = [
    section('a', 'One', 'x', 'Page A'),
    section('a', 'Two', 'y', 'Page A'),
    section('b', 'Three', 'z', 'Page B'),
  ];

  it('write each page once and give the sections back unchanged', () => {
    const packed = pack(sections);
    expect(packed.pages).toEqual([
      ['a', 'Page A'],
      ['b', 'Page B'],
    ]);
    expect(packed.sections.map((r) => r[0])).toEqual([0, 0, 1]);
    expect(unpack(packed)).toEqual(sections);
  });

  it('survive JSON', () => {
    expect(unpack(JSON.parse(JSON.stringify(pack(sections))) as ReturnType<typeof pack>)).toEqual(
      sections,
    );
  });
});

describe('the real guide', () => {
  const index = createIndex(guideSections(GUIDE));

  it('finds the shortcut page for "shortcut" and the dam page for "dam"', () => {
    const [top] = search(index, 'keyboard shortcuts');
    expect(top?.page).toBe('14-shortcuts');
    expect(search(index, 'dam').length).toBeGreaterThan(0);
  });

  it('indexes the text of tables, not only paragraphs', () => {
    const hit = search(index, 'Ctrl+Shift+Z')[0];
    expect(hit?.page).toBe('14-shortcuts');
    expect(hit?.snippet.marks.length).toBeGreaterThan(0);
  });

  it('finds the page heading itself for its own title, first', () => {
    for (const p of GUIDE) {
      const hit = search(index, p.title)[0];
      expect(hit?.page, p.title).toBe(p.id);
    }
  });

  it('finds every heading of every page by its own text', () => {
    for (const s of guideSections(GUIDE)) {
      const hits = search(index, s.heading, 200);
      expect(
        hits.some((h) => h.page === s.page && h.anchor === s.anchor),
        `${s.page}#${s.anchor}`,
      ).toBe(true);
    }
  });
});
