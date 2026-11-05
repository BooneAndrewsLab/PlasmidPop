// The logic behind `npm run mutate:changed` and `npm run mutate:triage` (item
// 50, #320, #355), kept apart from the scripts so that it can be unit-tested
// (src/test/scripts/mutationTools.test.ts) and so that `vite.config.ts` and
// the scripts share one list of skipped suites.
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Test files a mutation run leaves out (item 50). Each takes minutes per test
 * once instrumented, and the dry run runs every test once on one worker, so
 * their sum alone passed the 45-minute limit (#355: banded.test.ts 9 s plain,
 * ~2,400 s instrumented; the Biopython alignment oracle ~5,000 s). They run
 * as ordinary tests in `npm test` and CI, so a mutant that only they would
 * kill survives a mutation run and is checked by hand (`npm run
 * mutate:triage` names the skipped suites that reach each file with a
 * survivor).
 */
export const MUTATION_SKIP = [
  'src/test/oracle/sangerAssembly[0-9]*.test.ts',
  'src/test/oracle/alignment.test.ts',
  'src/test/oracle/msa.test.ts',
  'src/core/alignment/banded.test.ts',
  'src/core/alignment/strands.test.ts',
  'src/app/readAlignment.mapping.test.ts',
  'src/app/readBatch.timing.test.ts',
  'src/app/alignmentOriginIndel.test.ts',
  'src/app/alignmentOrigin.test.ts',
  'src/app/readAlignment.test.ts',
  'src/core/cloning/mutagenesis.property.test.ts',
  'src/core/cloning/overlapPrimers.property.test.ts',
];

/** The file that every test runs first (`setupFiles` in `vite.config.ts`). */
export const SETUP_FILE = 'src/test/setup.ts';

/**
 * A glob as the skip list writes them (`*`, `[0-9]`) as a regular expression.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*') source += '[^/]*';
    else if (c === '[') {
      const close = glob.indexOf(']', i);
      source += glob.slice(i, close + 1);
      i = close;
    } else source += c.replace(/[.+?^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/**
 * The files among `files` that a glob list names.
 * @param {readonly string[]} globs
 * @param {readonly string[]} files
 */
export function matchGlobs(globs, files) {
  const patterns = globs.map(globToRegExp);
  return files.filter((f) => patterns.some((p) => p.test(f)));
}

// ---------------------------------------------------------------------------
// Changed lines

/**
 * The lines each file has in `git diff -U0` output, on the new side, as
 * inclusive 1-based `[start, end]` ranges. A hunk that only deletes lines
 * names the two lines around the gap, since the code beside a deletion is
 * what it changed.
 * @param {string} diff
 * @returns {Map<string, [number, number][]>}
 */
export function changedRanges(diff) {
  /** @type {Map<string, [number, number][]>} */
  const byFile = new Map();
  /** @type {[number, number][] | undefined} */
  let current;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const name = line.slice(4);
      if (name === '/dev/null') {
        current = undefined;
      } else {
        current = [];
        byFile.set(name.replace(/^b\//, ''), current);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk === null || current === undefined) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    current.push(count === 0 ? [Math.max(1, start), start + 1] : [start, start + count - 1]);
  }
  for (const [name, ranges] of byFile) {
    const merged = mergeRanges(ranges);
    if (merged.length === 0) byFile.delete(name);
    else byFile.set(name, merged);
  }
  return byFile;
}

/** @param {[number, number][]} ranges */
function mergeRanges(ranges) {
  /** @type {[number, number][]} */
  const out = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last !== undefined && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * The `--mutate` patterns for the mutate-list files that changed: a file
 * with its line ranges (`src/a.ts:10-20`) when `ranges` is given, else the
 * whole file. With ranges, a file that has none (a rename or a mode change)
 * is left out. A file in `whole` is always mutated whole, changed or not: the
 * ones the incremental report has no result for.
 * @param {readonly string[]} mutateList
 * @param {ReadonlySet<string>} changedFiles
 * @param {Map<string, [number, number][]> | null} ranges
 * @param {ReadonlySet<string>} [whole]
 */
export function mutatePatterns(mutateList, changedFiles, ranges, whole = new Set()) {
  return mutateList.flatMap((f) => {
    if (whole.has(f)) return [f];
    if (!changedFiles.has(f)) return [];
    if (ranges === null) return [f];
    return (ranges.get(f) ?? []).map(([a, b]) => `${f}:${a}-${b}`);
  });
}

// ---------------------------------------------------------------------------
// Which tests reach a file

/**
 * The module specifiers a source names, apart from packages: statically
 * (`import`, `export … from`, `vi.mock`) and dynamically (`import()`,
 * `new URL('./x', import.meta.url)`).
 * @param {string} source
 * @returns {{ static: string[]; dynamic: string[] }}
 */
export function specifiers(source) {
  const dynamic = [
    ...[...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => String(m[1])),
    ...[...source.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g)].map((m) =>
      String(m[1]),
    ),
  ];
  const statics = [
    ...[...source.matchAll(/\b(?:from|import)\s*['"]([^'"]+)['"]/g)].map((m) => String(m[1])),
    ...[
      ...source.matchAll(
        /\bvi\.(?:do)?(?:mock|unmock)\(\s*['"]([^'"]+)['"]|\b(?:importActual|importMock)\(\s*['"]([^'"]+)['"]/g,
      ),
    ].map((m) => String(m[1] ?? m[2])),
  ];
  const local = (/** @type {string} */ s) => s.startsWith('.') || s.startsWith('@/');
  return { static: statics.filter(local), dynamic: dynamic.filter(local) };
}

/**
 * The file in `known` that a specifier names from `from`, or undefined.
 * @param {string} spec
 * @param {string} from
 * @param {ReadonlySet<string>} known
 */
export function resolveSpecifier(spec, from, known) {
  const bare = spec.replace(/[?#].*$/, '');
  /** @type {string} */
  let base;
  if (bare.startsWith('@/')) base = `src/${bare.slice(2)}`;
  else {
    /** @type {string[]} */
    const parts = from.split('/').slice(0, -1);
    for (const part of bare.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    base = parts.join('/');
  }
  const stem = base.replace(/\.(?:js|mjs)$/, '');
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return undefined;
}

/** @param {string} file */
export const isTestFile = (file) => /\.(?:test|spec)\.tsx?$/.test(file);

/**
 * The test files that can reach any of `seeds` through imports: the tests a
 * mutant in a seed can be killed by, and then some. A superset is what a test
 * allowlist needs; an import this misses (a computed one) costs only a
 * mutant that survives for lack of its killer.
 *
 * Every test also runs `setupFile` first: its static imports count for all
 * tests and its dynamic ones for the DOM tests (`domTests`).
 * @param {Readonly<Record<string, string>>} sources file name to text, for
 *   every `.ts`/`.tsx` file that can be imported
 * @param {Iterable<string>} seeds
 * @param {{ setupFile?: string; domTests?: ReadonlySet<string>; maxDepth?: number }} [options]
 *   `maxDepth` stops the search that many imports away from a seed (1: only
 *   the files that import it), for a narrower question than the allowlist's
 * @returns {string[]}
 */
export function relatedTests(sources, seeds, options = {}) {
  const known = new Set(Object.keys(sources));
  const { setupFile = SETUP_FILE, domTests = new Set(), maxDepth = Infinity } = options;
  /** @type {Map<string, Set<string>>} */
  const importedBy = new Map();
  const edge = (/** @type {string} */ from, /** @type {string} */ to) => {
    let set = importedBy.get(to);
    if (set === undefined) importedBy.set(to, (set = new Set()));
    set.add(from);
  };
  /** @type {{ static: string[]; dynamic: string[] }} */
  let setup = { static: [], dynamic: [] };
  /** @type {Map<string, { static: string[]; dynamic: string[] }>} */
  const found = new Map();
  for (const [file, source] of Object.entries(sources)) {
    const names = specifiers(source);
    const resolve = (/** @type {string[]} */ list) =>
      list.flatMap((s) => resolveSpecifier(s, file, known) ?? []);
    const resolved = { static: resolve(names.static), dynamic: resolve(names.dynamic) };
    found.set(file, resolved);
    if (file === setupFile) setup = resolved;
    for (const to of [...resolved.static, ...resolved.dynamic]) edge(file, to);
  }
  for (const file of known) {
    if (!isTestFile(file)) continue;
    for (const to of setup.static) edge(file, to);
    if (domTests.has(file)) for (const to of setup.dynamic) edge(file, to);
  }
  const reached = new Set(seeds);
  let level = [...reached];
  for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
    /** @type {string[]} */
    const next = [];
    for (const file of level) {
      for (const from of importedBy.get(file) ?? []) {
        if (!reached.has(from)) {
          reached.add(from);
          next.push(from);
        }
      }
    }
    level = next;
  }
  return [...reached].filter(isTestFile).sort();
}

/**
 * Every `.ts`/`.tsx` file under `dir` (default `src`), by repository path.
 * @param {string} [dir]
 * @returns {Record<string, string>}
 */
export function readSources(dir = 'src') {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (/\.tsx?$/.test(f)) {
      const name = `${dir}/${f.replaceAll('\\', '/')}`;
      out[name] = readFileSync(name, 'utf8');
    }
  }
  return out;
}

/** @param {Readonly<Record<string, string>>} sources */
export const domTestsOf = (sources) =>
  new Set(
    Object.entries(sources)
      .filter(([f, text]) => isTestFile(f) && text.includes('@vitest-environment jsdom'))
      .map(([f]) => f),
  );

// ---------------------------------------------------------------------------
// Machine

/**
 * Workers for a run: the configured number, but never more than the cores
 * minus two. Contention is what turns slow mutants into timeouts, and each
 * timeout costs its whole budget (#320: 6 in 333 mutants on an idle machine,
 * 82 in 402 with other work running).
 * @param {number | undefined} configured
 * @param {number} cores
 */
export function workerCount(configured, cores) {
  const cap = Math.max(1, cores - 2);
  return configured === undefined ? cap : Math.max(1, Math.min(configured, cap));
}

/**
 * A warning when the machine is busy, else undefined.
 * @param {number} load one-minute load average
 * @param {number} cores
 */
export function busyWarning(load, cores) {
  if (load <= Math.max(1, cores / 4)) return undefined;
  return (
    `Load average is ${load.toFixed(1)} on ${cores} threads. Run a mutation pass on an idle ` +
    'machine: other work (a test suite, another agent) slows the mutants until they time out, ' +
    'and each timeout costs its whole budget. Stop it with Ctrl-C and start again when the ' +
    'load has dropped, or go on and expect more timeouts.'
  );
}

// ---------------------------------------------------------------------------
// Triage of a finished run

/**
 * @typedef {{ id: string; mutatorName: string; replacement?: string; status: string;
 *   location: { start: { line: number }; end: { line: number } } }} ReportMutant
 * @typedef {{ source: string; mutants: ReportMutant[] }} ReportFile
 * @typedef {{ files: Record<string, ReportFile> }} MutationReport
 */

/**
 * The mutants with a status that start on a line in `ranges`, per file.
 * @param {MutationReport} report
 * @param {Map<string, [number, number][]>} ranges
 * @param {readonly string[]} statuses
 * @returns {{ file: string; mutant: ReportMutant; text: string }[]}
 */
export function mutantsOnChangedLines(report, ranges, statuses) {
  /** @type {{ file: string; mutant: ReportMutant; text: string }[]} */
  const out = [];
  for (const [file, data] of Object.entries(report.files)) {
    const inFile = ranges.get(file);
    if (inFile === undefined) continue;
    const lines = data.source.split('\n');
    for (const mutant of data.mutants) {
      const line = mutant.location.start.line;
      if (!statuses.includes(mutant.status)) continue;
      if (!inFile.some(([a, b]) => line >= a && line <= b)) continue;
      out.push({ file, mutant, text: (lines[line - 1] ?? '').trim() });
    }
  }
  return out;
}

/**
 * A timeout that is a loop that cannot end: a flipped loop counter
 * (`UpdateOperator`), or any mutant on the line that opens a loop. Those are
 * sound kills. Every other timeout (a cache, shortcut, prefilter or predicate
 * changed) may only have made the code slower, and is applied by hand
 * (item 50, "At 1.21: mutants that timed out").
 * @param {{ mutant: ReportMutant; text: string }} entry
 */
export function isLoopTimeout({ mutant, text }) {
  return mutant.mutatorName === 'UpdateOperator' || /^(?:\}\s*)?(?:for|while|do)\b/.test(text);
}

/**
 * The triage listing: survivors and mutants no test reached on the changed
 * lines, per file, with the skipped suites that reach the file; then the
 * timeouts on those lines, grouped by file and mutator, loops apart from the
 * rest.
 * @param {MutationReport} report
 * @param {Map<string, [number, number][]>} ranges
 * @param {(file: string) => string[]} skippedSuitesFor
 */
export function triageText(report, ranges, skippedSuitesFor) {
  const out = [];
  const survivors = mutantsOnChangedLines(report, ranges, ['Survived', 'NoCoverage']);
  out.push(`Survivors and uncovered mutants on lines changed: ${survivors.length}`);
  /** @type {Map<string, number>} */
  const perFile = new Map();
  for (const { file } of survivors) perFile.set(file, (perFile.get(file) ?? 0) + 1);
  for (const [file, count] of [...perFile].sort()) {
    const skipped = skippedSuitesFor(file);
    out.push(`  ${file}: ${count}`);
    if (skipped.length > 0) {
      out.push(
        `    nearest skipped suites (a survivor may only be killed there; apply it by hand and run them): ${skipped.join(', ')}`,
      );
    }
  }
  const timeouts = mutantsOnChangedLines(report, ranges, ['Timeout']);
  const loops = timeouts.filter(isLoopTimeout);
  const others = timeouts.filter((t) => !isLoopTimeout(t));
  out.push(
    '',
    `Timeouts on lines changed: ${timeouts.length} (${loops.length} loops, sound kills)`,
  );
  if (others.length > 0)
    out.push('Not loops, to apply by hand (killed only by running out of time):');
  for (const [file, group] of groupBy(others, (t) => t.file)) {
    out.push(`  ${file}`);
    for (const [mutator, items] of groupBy(group, (t) => t.mutant.mutatorName)) {
      out.push(`    ${mutator} (${items.length})`);
      for (const { mutant, text } of items) {
        out.push(
          `      ${mutant.location.start.line}: ${text}  ->  ${(mutant.replacement ?? '').replaceAll('\n', ' ').slice(0, 80)}`,
        );
      }
    }
  }
  return out.join('\n');
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} key
 * @returns {[string, T[]][]}
 */
function groupBy(items, key) {
  /** @type {Map<string, T[]>} */
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map].sort((a, b) => a[0].localeCompare(b[0]));
}
