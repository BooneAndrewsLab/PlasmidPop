/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json' with { type: 'json' };
import { handleShareTarget, isShareTargetRequest } from './src/pwa/shareTarget.ts';

/**
 * Deployment base path, e.g. "/PlasmidPop/" for GitHub Pages under a repo.
 * Set BASE_PATH in the environment at build time; defaults to the root.
 */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig({
  base,
  define: {
    // Shown in the guide's header, so a user or a bug report can say which
    // release they are on. package.json is the one place it is written.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
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
                  '.ape',
                  '.fa',
                  '.fasta',
                  '.fna',
                  '.seq',
                  '.txt',
                  '.dna',
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
              'chemical/seq-na-fasta': ['.fa', '.fasta', '.fna', '.seq'],
              'application/vnd.snapgene': ['.dna'],
            },
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        // The share target's POST: written into sw.js as the functions'
        // source, so they are self-contained (see the module).
        runtimeCaching: [
          { urlPattern: isShareTargetRequest, handler: handleShareTarget, method: 'POST' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/**/*.d.ts'],
    },
  },
});
