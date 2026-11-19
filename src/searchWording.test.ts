import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, plainText } from './app/help/markdown';
import { FAQ_PAGE_ID, faqJsonLd, generateGuideFiles } from './app/help/staticGuide';

// #446: the phrases people search for, the FAQ's structured data, and the
// comparison page. The wording must stay true of the app, so the tests pin the
// structure (valid JSON-LD, answers equal to the visible text) and what the
// comparison page may not contain (prices, superiority claims).
const root = new URL('../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const html = read('index.html');
const faqMd = read('docs/guide/19-faq.md');
const comparisonMd = read('docs/guide/20-comparison.md');

function ldBlocks(source: string): unknown[] {
  return [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1] ?? '') as unknown,
  );
}

function textOf(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('index.html search wording (#446)', () => {
  it('has JSON-LD that parses, with the searched phrases in the description', () => {
    const blocks = ldBlocks(html) as { '@type': string; disambiguatingDescription: string }[];
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0]?.['@type']).toBe('SoftwareApplication');
    const meta = /name="description"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    for (const text of [meta, blocks[0]?.disambiguatingDescription ?? '']) {
      expect(text).toMatch(/SnapGene/);
      expect(text).toMatch(/GenBank/);
      expect(text).toMatch(/no account/i);
      expect(text).toMatch(/open source/i);
    }
  });

  it('opens the README with the same phrases', () => {
    const head = read('README.md').split('\n').slice(0, 20).join(' ').replace(/\s+/g, ' ');
    expect(head).toMatch(/free, open source/);
    expect(head).toMatch(/alternative to desktop plasmid editors such as\s+SnapGene/);
    expect(head).toMatch(/view and edit GenBank files/);
    expect(head).toMatch(/no account/);
  });
});

describe('the FAQ page (#446)', () => {
  const pages = [{ id: FAQ_PAGE_ID, markdown: faqMd }];
  const page =
    generateGuideFiles(pages).find((f) => f.path === 'guide/faq/index.html')?.content ?? '';

  it('has FAQPage JSON-LD that parses and covers every question', () => {
    const [ld] = ldBlocks(page) as {
      '@type': string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    }[];
    expect(ld?.['@type']).toBe('FAQPage');
    const questions = parseMarkdown(faqMd).filter((b) => b.kind === 'heading' && b.level === 2);
    expect(questions.length).toBeGreaterThanOrEqual(5);
    expect(ld?.mainEntity).toHaveLength(questions.length);
  });

  it('has answers equal to the visible text of the page', () => {
    const [ld] = ldBlocks(page) as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    }[];
    const visible = textOf(page.slice(page.indexOf('<main>')));
    for (const q of ld?.mainEntity ?? []) {
      expect(visible, q.name).toContain(textOf(q.name));
      expect(visible, q.name).toContain(textOf(q.acceptedAnswer.text));
    }
    expect(page).toContain(`<h2 id=`);
  });

  it('builds the structure from the markdown, answer text included', () => {
    const ld = faqJsonLd(parseMarkdown('# T\n\nIntro.\n\n## Q one?\n\nA **one**.\n\nMore.\n')) as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(ld.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'Q one?',
        acceptedAnswer: { '@type': 'Answer', text: 'A one. More.' },
      },
    ]);
    expect(plainText([])).toBe('');
  });

  it('writes no JSON-LD on a page that is not the FAQ', () => {
    const out = generateGuideFiles([{ id: '01-a', markdown: '# A\n\nText.' }]);
    expect(out.every((f) => !f.content.includes('ld+json'))).toBe(true);
  });
});

describe('the comparison page (#446)', () => {
  it('names the three programs and says where they do more', () => {
    for (const name of ['SnapGene', 'Benchling', 'Serial Cloner'])
      expect(comparisonMd).toContain(name);
    expect(comparisonMd).toContain('Where the others do more');
  });

  it('has no price and no superiority claim', () => {
    expect(comparisonMd).not.toMatch(/[$€£]|\bUSD\b|\d+\s*(?:dollars|per (?:month|year))/i);
    expect(comparisonMd).not.toMatch(/\b(?:better than|best|faster than|superior|outperform)/i);
  });
});
