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
  type SourcePage,
} from './src/app/help/staticGuide.ts';
import { handleShareTarget, isShareTargetRequest } from './src/pwa/shareTarget.ts';

/**
 * Deployment base path, e.g. "/PlasmidPop/" for GitHub Pages under a repo.
 * Set BASE_PATH in the environment at build time; defaults to the root.
 */
const base = process.env['BASE_PATH'] ?? '/';

/**
 * The guide as crawlable static pages and the sitemap that lists them
 * (item 91, #231), written into the build from docs/guide/*.md. Page order is
 * the file order, as in the app's guide index.
 */
function staticGuide(): Plugin {
  return {
    name: 'plasmidpop-static-guide',
    apply: 'build',
    generateBundle() {
      const dir = new URL('./docs/guide/', import.meta.url);
      const pages: SourcePage[] = readdirSync(dir)
        .filter((f) => /^\d+-.*\.md$/.test(f))
        .sort()
        .map((f) => ({
          id: f.replace(/\.md$/, ''),
          markdown: readFileSync(new URL(f, dir), 'utf8'),
        }));
      for (const f of generateGuideFiles(pages))
        this.emitFile({ type: 'asset', fileName: f.path, source: f.content });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: generateSitemap(pages) });
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
        // with the shell. The guide pages stay out of the precache too (the
        // app has its own copy of the guide); the network serves them.
        navigateFallbackDenylist: [/\/(robots\.txt|sitemap\.xml)$/, /\/guide\//],
        // The PDF writer (#242) is a chunk of its own that only an export as
        // PDF fetches: half a megabyte that most installs would never use,
        // so it is not precached. Once fetched it is kept (below), so the
        // export works offline from then on.
        globIgnores: ['guide/**', '**/pdfWriter-*.js'],
        runtimeCaching: [
          // The share target's POST: written into sw.js as the functions'
          // source, so they are self-contained (see the module).
          { urlPattern: isShareTargetRequest, handler: handleShareTarget, method: 'POST' },
          {
            urlPattern: /\/assets\/pdfWriter-[^/]+\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'plasmidpop-pdf-writer', expiration: { maxEntries: 2 } },
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
    testTimeout: process.env['PLASMIDPOP_MUTATION'] === '1' ? 60_000 : 5_000,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // svg2pdf.js has no "exports" map and its "main" is the UMD build, which
    // wants jsPDF as a global; Node's resolution picks that, the bundler's
    // picks "module". The tests take the ES build the app takes (#242).
    alias: { 'svg2pdf.js': 'svg2pdf.js/dist/svg2pdf.es.min.js' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/**/*.d.ts'],
    },
  },
});
