/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Deployment base path, e.g. "/PlasmidPop/" for GitHub Pages under a repo.
 * Set BASE_PATH in the environment at build time; defaults to the root.
 */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig({
  base,
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
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/**/*.d.ts'],
    },
  },
});
