import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guideSlug } from './app/help/staticGuide';

// #444: public/llms.txt summarises the app for AI assistants. Its links must
// name guide pages that exist, so a renamed page cannot leave a dead link.
const SITE = 'https://booneandrewslab.github.io/PlasmidPop/';
const text = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
const slugs = new Set(
  readdirSync(new URL('../docs/guide/', import.meta.url))
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .map((f) => guideSlug(f.replace(/\.md$/, ''))),
);

describe('public/llms.txt', () => {
  it('starts with the llms.txt title and summary', () => {
    expect(text.startsWith('# PlasmidPop\n\n> ')).toBe(true);
  });

  it('links only to the site, the repository, and guide pages that exist', () => {
    const urls = [...text.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1] ?? '');
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) {
      if (url.startsWith(`${SITE}guide/`)) {
        const slug = url.slice(`${SITE}guide/`.length).replace(/\/$/, '');
        if (slug !== '') expect(slugs.has(slug), url).toBe(true);
      } else {
        expect(
          [SITE, `${SITE}tutorials/`, 'https://github.com/BooneAndrewsLab/PlasmidPop'],
          url,
        ).toContain(url);
      }
    }
  });
});
