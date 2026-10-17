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
    // Fetching tags only; plain links and JSON-LD identifiers name other
    // sites (schema.org, DOI, ORCID, GitHub, licence) but load nothing.
    const fetched = html.match(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)="[^"]*"/g) ?? [];
    for (const tag of fetched) {
      const url = /(?:src|href)="([^"]*)"/.exec(tag)?.[1] ?? '';
      expect(/^https?:\/\//.test(url) ? url.startsWith(SITE) : true, tag).toBe(true);
    }
    const meta = html.match(/<meta\b[^>]*content="https?:\/\/[^"]*"/g) ?? [];
    for (const tag of meta) expect(tag).toContain(`content="${SITE}`);
  });
});

// Item 91 (#230): SoftwareApplication structured data and the crawlable
// summary, both static in index.html.
interface SoftwareLd {
  '@context'?: string;
  '@type'?: string;
  name?: string;
  url?: string;
  description?: string;
  applicationCategory?: string;
  operatingSystem?: string;
  isAccessibleForFree?: boolean;
  license?: string;
  codeRepository?: string;
  image?: string;
  citation?: string;
  author?: { name?: string; url?: string };
}

function jsonLd(): SoftwareLd {
  const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(raw).toBeTruthy();
  return JSON.parse(raw ?? '{}') as SoftwareLd;
}

describe('structured data and crawlable summary', () => {
  const cff = readFileSync(new URL('../CITATION.cff', import.meta.url), 'utf8');
  const cffField = (key: string): string =>
    new RegExp(`^\\s*(?:- )?${key}: '?([^'\\n]+)'?$`, 'm').exec(cff)?.[1] ?? '';

  it('declares a SoftwareApplication with the required fields', () => {
    const ld = jsonLd();
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.name).toBe('PlasmidPop');
    expect(ld.url).toBe(SITE);
    expect(ld.applicationCategory).toBe('ScientificApplication');
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.operatingSystem).toBeTruthy();
    expect(String(ld.description).length).toBeGreaterThan(80);
    expect(ld.image).toBe(`${SITE}og-image.png`);
  });

  it('matches CITATION.cff and the licence', () => {
    const ld = jsonLd();
    expect(ld.description).toBe(cffField('abstract'));
    expect(ld.citation).toBe(`https://doi.org/${cffField('doi')}`);
    expect(ld.codeRepository).toBe(cffField('repository-code'));
    expect(cffField('license')).toBe('MIT');
    expect(String(ld.license)).toMatch(/\/mit$/i);
    expect(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')).toMatch(/^MIT License/);
    const author = ld.author ?? {};
    expect(author.name).toBe(`${cffField('given-names')} ${cffField('family-names')}`);
    expect(author.url).toBe(cffField('orcid'));
  });

  it('makes no claim of ratings or reviews', () => {
    const ld = jsonLd();
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(ld).not.toHaveProperty('review');
  });

  it('has a static summary outside #root that React never touches', () => {
    const body = html.slice(html.indexOf('<body>'));
    const root = body.indexOf('<div id="root"></div>');
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(body);
    expect(root).toBeGreaterThan(-1);
    expect(noscript).toBeTruthy();
    expect(body.indexOf('<noscript>')).toBeGreaterThan(root);
    expect(noscript?.[1]).toMatch(/GenBank, FASTA and SnapGene/);
    expect(noscript?.[1]).toMatch(/restriction sites/);
  });
});
