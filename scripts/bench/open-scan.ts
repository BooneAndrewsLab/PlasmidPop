// Times opening a FASTA in the production build (#253): from picking the
// file to the painted sequence view, to the drawn enzyme list, and the frame
// gaps while scrolling the sequence view. One fresh browser context per run,
// so no run sees another's IndexedDB or HTTP cache.
//
//   npm run bench -- --sizes 3000,50000,300000 --n 10 [--out file.csv] [--headed]
//
// `npm run bench` builds first; `node scripts/bench/open-scan.ts` reuses
// dist/. The sequences are seeded random DNA, so every run of a size opens the
// same one. Needs Playwright's Chromium (`npx playwright-core install chromium`).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Browser, chromium } from 'playwright-core';
import { preview } from 'vite';

interface Probe {
  t0: number | null;
  view: number | null;
  enzymes: number | null;
}

declare global {
  interface Window {
    __bench?: Probe;
    __stopFrames?: () => number[];
  }
}

interface Run {
  readonly size: number;
  readonly run: number;
  readonly view: number;
  readonly enzymes: number;
  readonly scrolled: number;
  readonly frames: number;
  readonly maxGap: number;
  readonly longFrames: number;
}

const { values } = parseArgs({
  options: {
    sizes: { type: 'string', default: '3000,50000,300000' },
    n: { type: 'string', default: '10' },
    out: { type: 'string' },
    headed: { type: 'boolean', default: false },
  },
});
const sizes = values.sizes.split(',').map((s) => Number(s.trim()));
const runs = Number(values.n);
if (sizes.some((s) => !Number.isInteger(s) || s <= 0) || !Number.isInteger(runs) || runs <= 0) {
  console.error('--sizes takes positive integers separated by commas, --n a positive integer');
  process.exit(2);
}
const out = values.out ?? `bench-open-scan-${new Date().toISOString().slice(0, 10)}.csv`;

const TIMEOUT_MS = 120_000;
const WHEEL_EVENTS = 120;
const WHEEL_DELTA_PX = 300;
const LONG_FRAME_MS = 50;

// mulberry32: small, seeded, good enough to give realistic cut-site counts.
function randomDna(length: number, seed: number): string {
  let a = seed >>> 0;
  const bases = ['A', 'C', 'G', 'T'] as const;
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out.push(bases[(t ^ (t >>> 14)) & 3] ?? 'N');
  }
  return out.join('');
}

function fasta(name: string, seq: string): string {
  const lines = [`>${name}`];
  for (let i = 0; i < seq.length; i += 70) lines.push(seq.slice(i, i + 70));
  return `${lines.join('\n')}\n`;
}

// Runs in the page before the file is picked. t0 is the file input's change
// event; a mark is the frame after its condition first holds, which is when
// the browser has painted what the condition saw.
function installProbe(): void {
  const probe: Probe = { t0: null, view: null, enzymes: null };
  window.__bench = probe;
  const frameAfter = (key: 'view' | 'enzymes'): void => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        probe[key] = performance.now() - (probe.t0 ?? 0);
      });
    });
  };
  let viewSeen = false;
  let enzymesSeen = false;
  let asked = false;
  const check = (): void => {
    if (probe.t0 === null) return;
    const canvas = document.querySelector('canvas.seq-view__canvas');
    if (!viewSeen && canvas instanceof HTMLCanvasElement && canvas.width > 0) {
      viewSeen = true;
      frameAfter('view');
    }
    // The scan starts on open whatever panel is showing; open the Enzymes
    // panel as soon as its tab exists so the list is drawn when it is ready.
    if (!asked) {
      const tab = [...document.querySelectorAll<HTMLElement>('[role=tab]')].find(
        (t) => t.textContent.trim() === 'Enzymes',
      );
      if (tab) {
        asked = true;
        tab.click();
      }
    }
    if (!enzymesSeen && document.querySelector('.enzyme-row')) {
      enzymesSeen = true;
      frameAfter('enzymes');
    }
  };
  document.addEventListener(
    'change',
    (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'file') {
        probe.t0 = performance.now();
      }
    },
    true,
  );
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
  });
}

function startFrameLog(): void {
  const gaps: number[] = [];
  let last = 0;
  let on = true;
  const tick = (now: number): void => {
    gaps.push(now - last);
    last = now;
    if (on) requestAnimationFrame(tick);
  };
  requestAnimationFrame((now) => {
    last = now;
    requestAnimationFrame(tick);
  });
  window.__stopFrames = () => {
    on = false;
    return gaps;
  };
}

// The scrolled distance, so a run whose wheel events moved nothing shows.
function sequenceScrollTop(): number {
  let el = document.querySelector('.seq-view__canvas');
  while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
  return el?.scrollTop ?? 0;
}

async function runOnce(
  browser: Browser,
  url: string,
  file: string,
): Promise<Omit<Run, 'size' | 'run'>> {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.goto(url);
    const input = page.locator('header input[type=file][multiple]');
    await input.waitFor({ state: 'attached' });
    await page.evaluate(installProbe);
    await input.setInputFiles(file);
    await page.waitForFunction(
      () => window.__bench?.view != null && window.__bench.enzymes != null,
    );
    const probe = await page.evaluate(() => window.__bench);
    if (probe?.view == null || probe.enzymes == null) throw new Error('the probe lost its marks');

    const box = await page.locator('.seq-view__canvas').boundingBox();
    if (box === null) throw new Error('the sequence view has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const top = await page.evaluate(sequenceScrollTop);
    await page.evaluate(startFrameLog);
    for (let i = 0; i < WHEEL_EVENTS; i++) await page.mouse.wheel(0, WHEEL_DELTA_PX);
    await page.evaluate(
      () =>
        new Promise<void>((r) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              r();
            });
          });
        }),
    );
    const gaps = await page.evaluate(() => window.__stopFrames?.() ?? []);
    const scrolled = (await page.evaluate(sequenceScrollTop)) - top;
    return {
      view: probe.view,
      enzymes: probe.enzymes,
      scrolled,
      frames: gaps.length,
      maxGap: Math.max(...gaps),
      longFrames: gaps.filter((g) => g > LONG_FRAME_MS).length,
    };
  } finally {
    await context.close();
  }
}

function meanSe(xs: readonly number[]): { mean: number; se: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (xs.length < 2) return { mean, se: NaN };
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { mean, se: Math.sqrt(variance / xs.length) };
}

const dir = mkdtempSync(join(tmpdir(), 'plasmidpop-bench-'));
const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch({ headless: !values.headed });
const rows: Run[] = [];
try {
  if (url === undefined) throw new Error('vite preview gave no URL; is there a dist/?');
  for (const size of sizes) {
    const file = join(dir, `bench-${size}.fa`);
    writeFileSync(file, fasta(`bench_${size}`, randomDna(size, size)));
    // One unrecorded run, so the first recorded one is not also the first
    // compile of the app's scripts.
    await runOnce(browser, url, file);
    for (let run = 1; run <= runs; run++) {
      const r = await runOnce(browser, url, file);
      rows.push({ size, run, ...r });
      process.stderr.write(
        `${size} bp run ${run}/${runs}: view ${r.view.toFixed(0)} ms, enzymes ${r.enzymes.toFixed(0)} ms, ` +
          `max frame gap ${r.maxGap.toFixed(0)} ms\n`,
      );
    }
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

const header =
  'size_bp,run,view_ms,enzymes_ms,scroll_px,scroll_frames,scroll_max_gap_ms,scroll_long_frames';
const csv = rows.map((r) =>
  [
    r.size,
    r.run,
    r.view.toFixed(1),
    r.enzymes.toFixed(1),
    Math.round(r.scrolled),
    r.frames,
    r.maxGap.toFixed(1),
    r.longFrames,
  ].join(','),
);
writeFileSync(out, `${[header, ...csv].join('\n')}\n`);

const fmt = (xs: readonly number[]): string => {
  const { mean, se } = meanSe(xs);
  return `${mean.toFixed(1)} ± ${Number.isNaN(se) ? '–' : se.toFixed(1)}`;
};
const summary = [
  `\nmean ± SE over ${runs} runs (${out})`,
  'size_bp\tview_ms\tenzymes_ms\tscroll_max_gap_ms\tscroll_long_frames',
  ...sizes.map((size) => {
    const of = rows.filter((r) => r.size === size);
    return [
      size,
      fmt(of.map((r) => r.view)),
      fmt(of.map((r) => r.enzymes)),
      fmt(of.map((r) => r.maxGap)),
      fmt(of.map((r) => r.longFrames)),
    ].join('\t');
  }),
];
process.stdout.write(`${summary.join('\n')}\n`);
