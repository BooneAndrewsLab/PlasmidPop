// Profiles the main thread while a FASTA opens (#270): the long tasks from
// the file pick to the autosave, what the status bar's checksum and the
// enzyme list waited for, and which functions each long task was in. A CPU
// profile is taken over the page's main thread through CDP, so the bundle
// has to keep its function names:
//
//   npx vite build --minify false --outDir dist-profile
//   node scripts/bench/open-profile.ts [--sizes 300000,1000000] [--n 3] [--dist dist-profile]
//     [--stretch 20] [--scroll] [--snapshot dir]
//
// `--scroll` wheels the sequence view as `open-scan.ts` does (120 x 300 px)
// as soon as the list is drawn, so what lands in the first scroll is in the
// profile (#278). `--snapshot` writes a heap snapshot of the page at the end
// of each run, taken after a forced collection, into that directory.
//
// Prints, per run, the marks (sequence view painted, checksum shown, enzyme
// list drawn; ms after the file was picked), every `longtask` entry, and for
// each long task the top self times inside it, and
// each busy stretch of the profile past 20 ms (`--stretch`) its length, the time inside
// `documentChecksum`, the garbage collector's share and the top self times.
// The sequences are the bench's (`open-scan.ts`): seeded random DNA.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Browser, chromium } from 'playwright-core';
import { preview } from 'vite';

/** What `Profiler.stop` gives (CDP `Profiler.Profile`), the parts read here. */
interface Profile {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: {
      readonly functionName: string;
      readonly url: string;
      /** 0-based. */
      readonly lineNumber: number;
    };
    readonly children?: readonly number[];
  }[];
  /** Microseconds. */
  readonly startTime: number;
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

interface Probe {
  t0: number | null;
  view: number | null;
  checksum: number | null;
  enzymes: number | null;
  tasks: { start: number; duration: number }[];
}

declare global {
  interface Window {
    __profile?: Probe;
  }
}

const { values } = parseArgs({
  options: {
    sizes: { type: 'string', default: '300000,1000000' },
    n: { type: 'string', default: '3' },
    dist: { type: 'string', default: 'dist-profile' },
    headed: { type: 'boolean', default: false },
    // Shorter stretches too, for work split into pieces under a long frame (#272).
    stretch: { type: 'string', default: '20' },
    scroll: { type: 'boolean', default: false },
    snapshot: { type: 'string' },
  },
});
const sizes = values.sizes.split(',').map((s) => Number(s.trim()));
const runs = Number(values.n);
if (
  sizes.some((s) => !Number.isInteger(s) || s <= 0) ||
  !Number.isInteger(runs) ||
  runs <= 0 ||
  !(Number(values.stretch) > 0)
) {
  console.error(
    '--sizes takes positive integers separated by commas, --n a positive integer, --stretch a positive number of ms',
  );
  process.exit(2);
}

const TIMEOUT_MS = 120_000;
/** How long after the enzyme list to keep recording, so the autosave is in. */
const SETTLE_MS = 2000;
const STRETCH_MS = Number(values.stretch);
/** Samples further apart than this are different stretches. */
const GAP_MS = 2;
const WHEEL_EVENTS = 120;
const WHEEL_DELTA_PX = 300;

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

// Runs in the page before the file is picked.
function installProbe(): void {
  const probe: Probe = { t0: null, view: null, checksum: null, enzymes: null, tasks: [] };
  window.__profile = probe;
  const frameAfter = (key: 'view' | 'checksum' | 'enzymes'): void => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        probe[key] = performance.now() - (probe.t0 ?? 0);
      });
    });
  };
  let viewSeen = false;
  let checksumSeen = false;
  let enzymesSeen = false;
  let asked = false;
  const check = (): void => {
    if (probe.t0 === null) return;
    const canvas = document.querySelector('canvas.seq-view__canvas');
    if (!viewSeen && canvas instanceof HTMLCanvasElement && canvas.width > 0) {
      viewSeen = true;
      frameAfter('view');
    }
    // The button, not the placeholder that holds its place meanwhile (#270).
    if (!checksumSeen && document.querySelector('button.statusbar__checksum')) {
      checksumSeen = true;
      frameAfter('checksum');
    }
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
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (probe.t0 !== null)
        probe.tasks.push({ start: e.startTime - probe.t0, duration: e.duration });
    }
  }).observe({ type: 'longtask', buffered: true });
}

interface Stretch {
  readonly start: number;
  readonly end: number;
  readonly checksum: number;
  readonly gc: number;
  readonly self: Map<string, number>;
}

/** A sample's function as printed: its name, or its line in the bundle, and its file. */
function namer(nodes: ReadonlyMap<number, Profile['nodes'][number]>): (id: number) => string {
  return (id) => {
    const n = nodes.get(id);
    if (n === undefined) return '?';
    // An anonymous frame is named by its line in the bundle, so a memo or
    // an arrow in a render can be found in `dist-profile/assets/index-*.js`.
    const fn =
      n.callFrame.functionName === ''
        ? `(anonymous:${n.callFrame.lineNumber + 1})`
        : n.callFrame.functionName;
    const file = n.callFrame.url.split('/').pop() ?? '';
    return file === '' ? fn : `${fn} ${file.replace(/-[\w-]+\.js$/, '')}`;
  };
}

/** Per `longtask` entry, the top self times of the samples inside it (#278). */
function insideTasks(
  profile: Profile,
  offsetMs: number,
  tasks: readonly { start: number; duration: number }[],
): string[] {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const name = namer(nodes);
  const self = tasks.map(() => new Map<string, number>());
  let t = profile.startTime;
  let prevT = t;
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    t += deltas[i] ?? 0;
    const ms = (t - profile.startTime) / 1000 + offsetMs;
    const dt = (t - prevT) / 1000;
    prevT = t;
    const k = tasks.findIndex((task) => ms >= task.start && ms <= task.start + task.duration);
    const into = self[k];
    if (into === undefined) continue;
    const n = name(samples[i] ?? 0);
    into.set(n, (into.get(n) ?? 0) + dt);
  }
  return tasks.map(
    (task, k) =>
      `  task ${task.duration.toFixed(0)} ms at +${task.start.toFixed(0)}: ${[
        ...(self[k] ?? new Map<string, number>()).entries(),
      ]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([n, ms]) => `${n} ${ms.toFixed(1)}`)
        .join(', ')}`,
  );
}

/** The busy stretches of a profile, each with its time in the functions of interest. */
function stretches(profile: Profile, offsetMs: number): Stretch[] {
  const nodes = new Map<number, Profile['nodes'][number]>();
  const parent = new Map<number, number>();
  for (const n of profile.nodes) {
    nodes.set(n.id, n);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const name = namer(nodes);
  const inChecksum = new Map<number, boolean>();
  const underChecksum = (id: number): boolean => {
    const known = inChecksum.get(id);
    if (known !== undefined) return known;
    const fn = nodes.get(id)?.callFrame.functionName ?? '';
    const yes =
      fn === 'documentChecksum' ||
      fn === 'computeDocumentChecksum' ||
      (parent.has(id) && underChecksum(parent.get(id) ?? 0));
    inChecksum.set(id, yes);
    return yes;
  };
  const isIdle = (id: number): boolean => {
    const fn = nodes.get(id)?.callFrame.functionName;
    return fn === '(idle)';
  };
  const out: Stretch[] = [];
  let current: {
    start: number;
    end: number;
    checksum: number;
    gc: number;
    self: Map<string, number>;
  } | null = null;
  let t = profile.startTime;
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let prevT = t;
  for (let i = 0; i < samples.length; i++) {
    t += deltas[i] ?? 0;
    const id = samples[i] ?? 0;
    const ms = (t - profile.startTime) / 1000 + offsetMs;
    const dt = (t - prevT) / 1000;
    prevT = t;
    if (isIdle(id)) {
      if (current !== null && ms - current.end > GAP_MS) {
        out.push(current);
        current = null;
      }
      continue;
    }
    if (current === null || ms - current.end > GAP_MS) {
      if (current !== null) out.push(current);
      current = { start: ms, end: ms, checksum: 0, gc: 0, self: new Map() };
    }
    current.end = ms;
    if (underChecksum(id)) current.checksum += dt;
    const n = name(id);
    if (n.startsWith('(garbage collector)')) current.gc += dt;
    current.self.set(n, (current.self.get(n) ?? 0) + dt);
  }
  if (current !== null) out.push(current);
  return out.filter((s) => s.end - s.start >= STRETCH_MS);
}

async function runOnce(
  browser: Browser,
  url: string,
  file: string,
  snapshot: string | null,
): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.goto(url);
    const input = page.locator('header input[type=file][multiple]');
    await input.waitFor({ state: 'attached' });
    await page.evaluate(installProbe);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    const nowBefore = await page.evaluate(() => performance.now());
    await cdp.send('Profiler.start');
    const nowAfter = await page.evaluate(() => performance.now());
    await input.setInputFiles(file);
    await page.waitForFunction(
      () => window.__profile?.view != null && window.__profile.enzymes != null,
    );
    let scroll = '';
    if (values.scroll) {
      const box = await page.locator('.seq-view__canvas').boundingBox();
      if (box === null) throw new Error('the sequence view has no box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const from = await page.evaluate(() => performance.now() - (window.__profile?.t0 ?? 0));
      for (let i = 0; i < WHEEL_EVENTS; i++) await page.mouse.wheel(0, WHEEL_DELTA_PX);
      const to = await page.evaluate(() => performance.now() - (window.__profile?.t0 ?? 0));
      scroll = `, scroll +${from.toFixed(0)} to +${to.toFixed(0)}`;
    }
    await page.waitForTimeout(SETTLE_MS);
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: Profile };
    const probe = await page.evaluate(() => window.__profile);
    if (probe?.t0 == null) throw new Error('the probe lost its marks');
    const t0 = probe.t0;
    // The profile's clock is its own; its start is between the two readings.
    const offsetMs = (nowBefore + nowAfter) / 2 - t0;
    const fmt = (x: number | null): string => (x === null ? '–' : `${x.toFixed(0)} ms`);
    const lines = [
      `  view ${fmt(probe.view)}, checksum ${fmt(probe.checksum)}, enzymes ${fmt(probe.enzymes)}${scroll}`,
      `  long tasks: ${probe.tasks
        .map((t) => `${t.duration.toFixed(0)} ms at +${t.start.toFixed(0)}`)
        .join(', ')}`,
    ];
    lines.push(...insideTasks(profile, offsetMs, probe.tasks));
    for (const s of stretches(profile, offsetMs)) {
      const top = [...s.self.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([n, ms]) => `${n} ${ms.toFixed(1)}`)
        .join(', ');
      lines.push(
        `  stretch ${(s.end - s.start).toFixed(0)} ms at +${s.start.toFixed(0)}: ` +
          `checksum ${s.checksum.toFixed(1)} ms, gc ${s.gc.toFixed(1)} ms; ${top}`,
      );
    }
    if (snapshot !== null) {
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      const chunks: string[] = [];
      cdp.on('HeapProfiler.addHeapSnapshotChunk', (e: { chunk: string }) => chunks.push(e.chunk));
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      writeFileSync(snapshot, chunks.join(''));
      lines.push(`  heap snapshot ${snapshot}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  } finally {
    await context.close();
  }
}

const dir = mkdtempSync(join(tmpdir(), 'plasmidpop-profile-'));
const server = await preview({
  build: { outDir: values.dist },
  preview: { port: 0, strictPort: false },
  logLevel: 'silent',
});
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch({ headless: !values.headed });
try {
  if (url === undefined) throw new Error(`vite preview gave no URL; is there a ${values.dist}/?`);
  for (const size of sizes) {
    const file = join(dir, `bench-${size}.fa`);
    writeFileSync(file, fasta(`bench_${size}`, randomDna(size, size)));
    await runOnce(browser, url, file, null); // warm-up, unrecorded
    for (let run = 1; run <= runs; run++) {
      process.stdout.write(`${size} bp run ${run}/${runs}\n`);
      const snap =
        values.snapshot === undefined
          ? null
          : join(values.snapshot, `open-${size}-${run}.heapsnapshot`);
      await runOnce(browser, url, file, snap);
    }
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}
