import { describe, expect, it } from 'vitest';

import { GUIDE } from './guide';
import { buildGuideIndex, guideSections } from './guideIndex';
import { search } from './guideSearch';
import { headingSlug } from './markdown';

// Item 138 (#409): the guide cut into searchable sections.

describe('guideSections', () => {
  const md = [
    '# Alpha *one*',
    '',
    'Intro with `code` and a [link](02-b.md).',
    '',
    '## Sub head',
    '',
    '- item one',
    '- item two',
    '',
    '  more under two',
    '',
    '> [!NOTE]',
    '> A note.',
    '',
    '### Deeper',
    '',
    '| H1 | H2 |',
    '| --- | --- |',
    '| c1 | c2 |',
    '',
    '```',
    'x < y',
    'z',
    '```',
  ].join('\n');

  it('has a section per heading, with the plain text under it', () => {
    const sections = guideSections([{ id: '01-a', markdown: md }]);
    expect(sections.map((s) => [s.heading, s.anchor])).toEqual([
      ['Alpha one', 'alpha-one'],
      ['Sub head', 'sub-head'],
      ['Deeper', 'deeper'],
    ]);
    expect(sections.map((s) => s.pageTitle)).toEqual(['Alpha one', 'Alpha one', 'Alpha one']);
    expect(sections[0]?.text).toBe('Intro with code and a link.');
    expect(sections[1]?.text).toBe('item one item two more under two A note.');
    expect(sections[2]?.text).toBe('H1 H2 c1 c2 x < y z');
  });

  it('puts text before the first heading under the page title, and titles a page with none by its id', () => {
    const sections = guideSections([{ id: '05-x', markdown: 'Lead text.\n\n## Part\n\nBody.' }]);
    expect(sections).toEqual([
      { page: '05-x', pageTitle: '05-x', heading: '05-x', anchor: '05-x', text: 'Lead text.' },
      { page: '05-x', pageTitle: '05-x', heading: 'Part', anchor: 'part', text: 'Body.' },
    ]);
  });

  it('keeps a heading with nothing under it, and has no section for an empty page', () => {
    expect(
      guideSections([{ id: '01-a', markdown: '# Only\n\n## Empty\n' }]).map((s) => s.text),
    ).toEqual(['', '']);
    expect(guideSections([{ id: '01-a', markdown: '' }])).toEqual([]);
  });

  it('lists pages in the order given', () => {
    const sections = guideSections([
      { id: '02-b', markdown: '# B' },
      { id: '01-a', markdown: '# A' },
    ]);
    expect(sections.map((s) => s.page)).toEqual(['02-b', '01-a']);
  });
});

describe('the guide’s sections', () => {
  const sections = guideSections(GUIDE);

  it('cover every page, with anchors the rendered page has', () => {
    for (const p of GUIDE) expect(sections.some((s) => s.page === p.id)).toBe(true);
    for (const s of sections) expect(s.anchor).toBe(headingSlug(s.heading));
  });

  it('hold the text of a table, so a shortcut is found', () => {
    const hit = search(buildGuideIndex(GUIDE), 'Ctrl+Shift+Z')[0];
    expect(hit?.page).toBe('14-shortcuts');
  });
});
