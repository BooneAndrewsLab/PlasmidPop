/// <reference types="vitest/config" />
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json' with { type: 'json' };
import {
  generateGuideFiles,
  generateSitemap,
  matchStaticRequest,
  type SourcePage,
  type StaticFile,
} from './src/app/help/staticGuide.ts';
import {
  SAMPLE_FILE,
  TUTORIAL_ORDER,
  generateTutorialFiles,
  tutorialUrls,
  type SampleFile,
} from './src/app/help/staticTutorials.ts';
import { handleShareTarget, isShareTargetRequest } from './src/pwa/shareTarget.ts';

/**
 * Deployment base path, e.g. "/PlasmidPop/" for GitHub Pages under a repo.
 * Set BASE_PATH in the environment at build time; defaults to the root.
 */
const base = process.env['BASE_PATH'] ?? '/';

/**
 * Test files that need a module registry of their own: those that replace a
 * module with vi.mock, and those in the DOM, whose late async work fails in
 * the next file when the two share one (`window is not defined`).
 */
const TESTS = ['src/**/*.{test,spec}.{ts,tsx}'];

const ALL_TESTS = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(test|spec)\.tsx?$/.test(f))
  .map((f) => `src/${f.replaceAll('\\', '/')}`);

const DOM_TESTS = ALL_TESTS.filter((f) =>
  readFileSync(f, 'utf8').includes('@vitest-environment jsdom'),
);

// `npm run mutate:changed -- --unit-only` (#320) leaves the DOM tests out of
// the run: in the dry run they are a large share of the time, and the
// mutated files are mostly not UI.
const UNIT_ONLY = process.env['PLASMIDPOP_MUTATION_UNIT'] === '1';

// The Sanger assembly oracle (#335) runs about 20 s here and 5-11 minutes in
// an instrumented sandbox, per file; perTest coverage would run it for every
// mutant of the assembler. A mutation run leaves it out; the assembler's unit
// tests (assemble.test.ts and the rest) are what kills its mutants.
// The alignment suites that take minutes per test instrumented (the Biopython
// oracle, banded, strands, the origin and read-alignment batches, the MSA
// oracle) go the same way: the dry run runs every test once on one worker and
// their sum alone passes the 45-minute limit. Their cheaper unit tests stay.
const MUTATION_SKIP = [
  'src/test/oracle/sangerAssembly[0-9]*.test.ts',
  'src/test/oracle/alignment.test.ts',
  'src/test/oracle/msa.test.ts',
  'src/core/alignment/banded.test.ts',
  'src/core/alignment/strands.test.ts',
  'src/app/readAlignment.mapping.test.ts',
  'src/app/readBatch.timing.test.ts',
  'src/app/alignmentOriginIndel.test.ts',
  'src/core/cloning/mutagenesis.property.test.ts',
  'src/core/cloning/overlapPrimers.property.test.ts',
];

const ISOLATED_TESTS = ALL_TESTS.filter((f) => {
  const text = readFileSync(f, 'utf8');
  return text.includes('vi.mock(') || text.includes('@vitest-environment jsdom');
});

/**
 * The guide as crawlable static pages and the sitemap that lists them
 * (item 91, #231), written into the build from docs/guide/*.md and served by
 * the dev server (#244). Page order is the file order, as in the app's guide
 * index. The tutorials (#312) ride along: docs/tutorials/*.md as pages, and
 * its files/ folder as downloads, under /tutorials/.
 */
function staticGuide(): Plugin {
  const dir = new URL('./docs/guide/', import.meta.url);
  const readPages = (): SourcePage[] =>
    readdirSync(dir)
      .filter((f) => /^\d+-.*\.md$/.test(f))
      .sort()
      .map((f) => ({
        id: f.replace(/\.md$/, ''),
        markdown: readFileSync(new URL(f, dir), 'utf8'),
      }));
  const tdir = new URL('./docs/tutorials/', import.meta.url);
  const readTutorial = (id: string): SourcePage => ({
    id,
    markdown: readFileSync(new URL(`${id}.md`, tdir), 'utf8'),
  });
  const readTutorials = (): StaticFile[] => {
    const pages = TUTORIAL_ORDER.map(readTutorial);
    const samples: SampleFile[] = readdirSync(new URL('files/', tdir))
      .filter((f) => SAMPLE_FILE.test(f))
      .sort()
      .map((name) => ({ name, content: readFileSync(new URL(`files/${name}`, tdir), 'utf8') }));
    return generateTutorialFiles(readTutorial('README'), pages, samples);
  };
  const sitemap = (): string =>
    generateSitemap(readPages(), tutorialUrls(TUTORIAL_ORDER.map(readTutorial)));
  return {
    name: 'plasmidpop-static-guide',
    generateBundle() {
      for (const f of [...generateGuideFiles(readPages()), ...readTutorials()])
        this.emitFile({ type: 'asset', fileName: f.path, source: f.content });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap() });
    },
    // Dev (#244): the same pages and sitemap, regenerated from docs/guide on
    // every request so edits show up. Registered directly (not as a post
    // hook), so it runs before Vite's SPA fallback; the base is still on the
    // URL at this point.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = req.url === undefined ? null : matchStaticRequest(req.url, server.config.base);
        if (hit === null || (req.method !== 'GET' && req.method !== 'HEAD')) {
          next();
          return;
        }
        if (hit.kind === 'redirect') {
          res.statusCode = 301;
          res.setHeader('Location', hit.to);
          res.end();
          return;
        }
        const content =
          hit.path === 'sitemap.xml'
            ? sitemap()
            : [...generateGuideFiles(readPages()), ...readTutorials()].find(
                (f) => f.path === hit.path,
              )?.content;
        if (content === undefined) {
          next();
          return;
        }
        res.setHeader(
          'Content-Type',
          hit.path.endsWith('.xml')
            ? 'application/xml; charset=utf-8'
            : hit.path.endsWith('.html')
              ? 'text/html; charset=utf-8'
              : 'text/plain; charset=utf-8',
        );
        res.setHeader('Cache-Control', 'no-cache');
        res.end(req.method === 'HEAD' ? undefined : content);
      });
    },
  };
}

export default defineConfig({
  base,
  define: {
    // Shown in the guide's header, so a user or a bug report can say which
    // release they are on. package.json is the one place it is written.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    staticGuide(),
    VitePWA({
      // The service worker is registered by hand in main.tsx (production only).
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'PlasmidPop',
        short_name: 'PlasmidPop',
        description:
          'Browser-based DNA sequence editor and plasmid viewer. Works offline; files stay on your device.',
        theme_color: '#1b6e8c',
        background_color: '#14181f',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Files shared to the installed app from another one — a GenBank
        // attachment in a mail app — arrive as a POST that the service worker
        // answers (`src/pwa/shareTarget.ts`, #43). Android Chrome only; iOS
        // Safari has no Web Share Target. Mail apps label a .gb as
        // text/plain or application/octet-stream as often as anything, so
        // those are accepted too and the app decides by name and content.
        share_target: {
          action: `${base}share-target`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'files',
                accept: [
                  'chemical/seq-na-genbank',
                  'chemical/seq-na-fasta',
                  'application/vnd.snapgene',
                  'text/plain',
                  'application/octet-stream',
                  'application/gzip',
                  'application/x-gzip',
                  '.gb',
                  '.gbk',
                  '.genbank',
                  '.gbff',
                  '.gp',
                  '.gpff',
                  '.ape',
                  '.fa',
                  '.fasta',
                  '.fna',
                  '.faa',
                  '.seq',
                  '.txt',
                  '.dna',
                  '.prot',
                  '.rna',
                  '.ab1',
                  '.abi',
                  '.fastq',
                  '.fq',
                  '.gz',
                ],
              },
            ],
          },
        },
        file_handlers: [
          {
            action: base,
            accept: {
              'chemical/seq-na-genbank': ['.gb', '.gbk', '.genbank', '.gbff', '.ape'],
              'chemical/seq-aa-genpept': ['.gp', '.gpff'],
              'chemical/seq-na-fasta': ['.fa', '.fasta', '.fna', '.seq'],
              'chemical/seq-aa-fasta': ['.faa'],
              'application/vnd.snapgene': ['.dna', '.prot', '.rna'],
            },
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        // robots.txt, sitemap.xml and the static guide pages are plain files
        // (item 91), not app routes: a navigation to them must not be answered
        // with the shell. The guide and tutorial pages stay out of the precache too (the
        // app has its own copy of the guide); the network serves them.
        navigateFallbackDenylist: [/\/(robots\.txt|sitemap\.xml)$/, /\/guide\//, /\/tutorials\//],
        // The PDF writer (#242) is a chunk of its own that only an export as
        // PDF fetches: half a megabyte that most installs would never use,
        // so it is not precached. Once fetched it is kept (below), so the
        // export works offline from then on. It comes as two chunks since
        // #248: the writer (one copy for the main thread, one the export
        // worker loads) and svg2pdf, which only the vector writer fetches.
        globIgnores: ['guide/**', 'tutorials/**', '**/pdfWriter-*.js', '**/svg2pdf*.js'],
        runtimeCaching: [
          // The share target's POST: written into sw.js as the functions'
          // source, so they are self-contained (see the module).
          { urlPattern: isShareTargetRequest, handler: handleShareTarget, method: 'POST' },
          {
            urlPattern: /\/assets\/(?:pdfWriter|svg2pdf)[^/]*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'plasmidpop-pdf-writer', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      // jsPDF (#242) names its optional dependencies in dynamic imports that
      // only its html() and SVG-as-image paths reach, which the PDF export
      // never calls; left external they are not bundled, and the lazy
      // import() lines that name them are never run.
      external: ['canvg', 'html2canvas', 'dompurify'],
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    // Core model / algorithm tests run in plain Node. Component tests opt
    // into the DOM with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // A mutation run (`npm run mutate`) instruments the code, which runs
    // many times slower; the ordinary limit would fail tests that are not
    // slow at all.
    testTimeout: process.env['PLASMIDPOP_MUTATION'] === '1' ? 180_000 : 5_000,
    // A mutation run's dry run goes through every file on one worker, and
    // a fresh module registry per file is about half its time. There the
    // files share one, apart from those that need their own.
    ...(process.env['PLASMIDPOP_MUTATION'] === '1'
      ? {
          projects: [
            {
              extends: true,
              test: {
                name: 'shared',
                include: TESTS,
                exclude: [...ISOLATED_TESTS, ...MUTATION_SKIP, ...(UNIT_ONLY ? DOM_TESTS : [])],
                isolate: false,
              },
            },
            {
              extends: true,
              test: {
                name: 'isolated',
                include: UNIT_ONLY
                  ? ISOLATED_TESTS.filter((f) => !DOM_TESTS.includes(f))
                  : ISOLATED_TESTS,
              },
            },
          ],
        }
      : { include: TESTS }),
    // svg2pdf.js has no "exports" map and its "main" is the UMD build, which
    // wants jsPDF as a global; Node's resolution picks that, the bundler's
    // picks "module". The tests take the ES build the app takes (#242).
    alias: { 'svg2pdf.js': 'svg2pdf.js/dist/svg2pdf.es.min.js' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/**/*.d.ts'],
      // Floors, about 2 points under the figures measured 2026-10-30
      // (statements 92.8, branches 84.99, functions 91.86, lines 94.66). They
      // only fail when coverage is on: CI and `npm run check`, not `npm test`.
      thresholds: { statements: 90, branches: 82, functions: 89, lines: 92 },
    },
  },
});
