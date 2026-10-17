import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Item 91: the static head tags that search results and link previews read.
// Crawlers and unfurlers do not run JS, so the tags live in index.html and
// must use absolute URLs (they cannot follow the build's base path).
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SITE = 'https://booneandrewslab.github.io/PlasmidPop/';

function meta(attr: 'name' | 'property', key: string): string | undefined {
  const tag = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(html);
  return tag?.[1];
}

describe('index.html metadata', () => {
  it('has a descriptive title and description', () => {
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    expect(title).toMatch(/DNA sequence editor/);
    const description = meta('name', 'description') ?? '';
    expect(description.length).toBeGreaterThan(80);
    expect(description.length).toBeLessThanOrEqual(300);
  });

  it('declares one canonical URL on the deployed site', () => {
    const links = html.match(/<link rel="canonical" href="([^"]*)"/g) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="${SITE}"`);
  });

  it('has Open Graph and Twitter card tags with absolute URLs', () => {
    expect(meta('property', 'og:title')).toBeTruthy();
    expect(meta('property', 'og:description')).toBeTruthy();
    expect(meta('property', 'og:type')).toBe('website');
    expect(meta('property', 'og:url')).toBe(SITE);
    expect(meta('property', 'og:image')).toBe(`${SITE}og-image.png`);
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });

  it('ships the preview image at 1200x630', () => {
    const file = new URL('../public/og-image.png', import.meta.url);
    expect(existsSync(file)).toBe(true);
    const png = readFileSync(file);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('sends no request to a third party', () => {
    const urls = html.match(/https?:\/\/[^"')\s]+/g) ?? [];
    for (const url of urls) {
      expect(url.startsWith(SITE) || url.startsWith('https://booneandrewslab.github.io')).toBe(
        true,
      );
    }
  });
});
