// The logic behind the guide's Validation page (item 142, #362), kept apart
// from the build so that it can be unit-tested
// (src/test/scripts/validationTools.test.ts) and shared by `vite.config.ts`
// (which writes the page's tables into the build) and
// `scripts/mutation-summary.mjs` (which turns a Stryker report into the small
// committed summary).
//
// Nothing numeric on the page is typed by hand. A case count is the size of an
// array (or the number of keys of an object) in a committed oracle JSON file; a
// version is read from `scripts/oracle/requirements.txt`, or from the stamp the
// generator wrote into the JSON; the mutation score is read from
// `docs/validation/mutation-summary.json`, and where that file records nothing
// the page says "not yet recorded".
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ name: string; package?: string | null; stampKey?: string }} OracleSpec
 * @typedef {{ file: string; path: string; unit: string }} CountSpec
 * @typedef {{
 *   id: string; title: string; oracles: OracleSpec[]; compares: string;
 *   files: string[]; tests: string[]; counts: CountSpec[];
 * }} AreaSpec
 * @typedef {{
 *   dataDir: string; areas: AreaSpec[];
 *   support?: { files?: string[]; tests?: string[] };
 * }} AreaRegistry
 * @typedef {{
 *   area: string; text: string; kind: string; issue: number | null; where: string;
 * }} Deviation
 * @typedef {{
 *   score: number | null; floor: number | null; date: string | null;
 *   appVersion: string | null; run: string | null; stryker: string | null;
 *   counts: Record<string, number> | null;
 *   files: { file: string; score: number | null; killed: number; timeout: number; survived: number; noCoverage: number }[];
 *   unmeasured: string[];
 *   note?: string;
 * }} MutationSummary
 */

/**
 * The size of what a count path names in a parsed oracle file. Segments are
 * object keys; `*` takes every element of an array (or value of an object) and
 * adds up what is under it. The thing at the end must be an array (its length)
 * or an object (its number of keys); anything else is a mistake in the
 * registry and throws, so a typo cannot become a count of zero.
 * @param {unknown} node
 * @param {string} path
 * @returns {number}
 */
export function countAt(node, path) {
  /** @param {unknown} at @param {string[]} segments @returns {number} */
  const walk = (at, segments) => {
    const [head, ...rest] = segments;
    if (head === undefined) {
      if (Array.isArray(at)) return at.length;
      if (typeof at === 'object' && at !== null) return Object.keys(at).length;
      throw new Error(`count path "${path}" ends at something that is not an array or object`);
    }
    if (head === '*') {
      /** @type {unknown[] | null} */
      const children = Array.isArray(at)
        ? /** @type {unknown[]} */ (at)
        : typeof at === 'object' && at !== null
          ? Object.values(at)
          : null;
      if (children === null) throw new Error(`count path "${path}": "*" on a non-container`);
      return children.reduce((/** @type {number} */ sum, child) => sum + walk(child, rest), 0);
    }
    if (typeof at !== 'object' || at === null || !Object.hasOwn(at, head))
      throw new Error(`count path "${path}": no "${head}"`);
    return walk(/** @type {Record<string, unknown>} */ (at)[head], rest);
  };
  return walk(node, path.split('.'));
}

/**
 * `name==version` lines of a pip requirements file, names lower-cased.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseRequirements(text) {
  /** @type {Map<string, string>} */
  const pins = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z0-9_.-]+)==([^\s;]+)$/.exec(line);
    if (m !== null) pins.set((m[1] ?? '').toLowerCase(), m[2] ?? '');
  }
  return pins;
}

/**
 * @typedef {{
 *   registry: AreaRegistry;
 *   deviations: Deviation[];
 *   mutation: MutationSummary;
 *   requirements: Map<string, string>;
 *   readData: (file: string) => unknown;
 *   dataFiles: string[];
 *   testFiles: string[];
 * }} ValidationInput
 */

/**
 * Everything the page says, as data: per area its oracles with versions, its
 * counts (counted from the files here), the files and tests, and what is left
 * over. `unlisted` holds the files of the oracle folder that no area names and
 * `mismatches` the oracles whose JSON stamp is not the pinned version; the
 * tests require both to be empty.
 * @param {ValidationInput} input
 */
export function buildValidation(input) {
  const { registry, deviations, mutation, requirements, readData } = input;
  /** @type {Map<string, unknown>} */
  const cache = new Map();
  /** @param {string} file */
  const data = (file) => {
    if (!cache.has(file)) cache.set(file, readData(file));
    return cache.get(file);
  };
  /** @type {string[]} */
  const mismatches = [];
  const areas = registry.areas.map((area) => {
    const oracles = area.oracles.map((o) => {
      const pin = o.package == null ? undefined : requirements.get(o.package.toLowerCase());
      /** @type {string | null} */
      let version = pin ?? null;
      /** @type {'pin' | 'stamp' | null} */
      let source = pin === undefined ? null : 'pin';
      for (const file of area.files.filter((f) => f.endsWith('.json'))) {
        const stamp =
          o.stampKey === undefined
            ? undefined
            : /** @type {Record<string, unknown>} */ (data(file))[o.stampKey];
        if (typeof stamp !== 'string') continue;
        if (version === null) {
          version = stamp;
          source = 'stamp';
        } else if (stamp !== version) {
          mismatches.push(`${area.id}: ${file} says ${o.stampKey} ${stamp}, pinned ${version}`);
        }
      }
      return { name: o.name, version, source };
    });
    const counts = area.counts.map((c) => ({
      unit: c.unit,
      file: c.file,
      n: countAt(data(c.file), c.path),
    }));
    return {
      id: area.id,
      title: area.title,
      compares: area.compares,
      oracles,
      counts,
      files: area.files,
      tests: area.tests,
      deviations: deviations.filter((d) => d.area === area.id),
    };
  });
  const knownFiles = new Set([
    ...registry.areas.flatMap((a) => a.files),
    ...(registry.support?.files ?? []),
  ]);
  const knownTests = new Set([
    ...registry.areas.flatMap((a) => a.tests.filter((t) => !t.startsWith('src/'))),
    ...(registry.support?.tests ?? []),
  ]);
  return {
    areas,
    deviations,
    mutation,
    mismatches,
    unlisted: {
      data: input.dataFiles.filter((f) => !knownFiles.has(f)),
      tests: input.testFiles.filter((f) => !knownTests.has(f)),
    },
    unknownDeviationAreas: deviations
      .map((d) => d.area)
      .filter((id) => !registry.areas.some((a) => a.id === id)),
  };
}

/** 12345 as "12,345", the same on every machine. @param {number} n */
export function thousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${thousands(n)} ${n === 1 ? one : many}`;

/**
 * The generated tables of the Validation page, as guide Markdown: a section
 * per area, the known differences, and the mutation score.
 * @param {ReturnType<typeof buildValidation>} v
 * @param {string} [dataDir]
 */
export function renderValidationMarkdown(v, dataDir = 'src/test/oracle') {
  /** @type {string[]} */
  const out = [];
  out.push('## What is checked, and against what', '');
  out.push(
    `${plural(v.areas.length, 'area', 'areas')} of the program are compared with an independent answer. Each section names the oracle and its version, what is compared, how many cases there are (counted from the committed data when this page was built), where the data is, and what is known to differ.`,
    '',
  );
  for (const a of v.areas) {
    out.push(`### ${a.title}`, '');
    out.push(
      `- **Oracle:** ${a.oracles
        .map((o) => (o.version === null ? o.name : `${o.name}, version ${o.version}`))
        .join('; ')}.`,
    );
    out.push(`- **Compared:** ${a.compares}`);
    out.push(
      a.counts.length === 0
        ? '- **Cases:** none counted: no data file for this area is committed.'
        : `- **Cases:** ${a.counts.map((c) => `${thousands(c.n)} ${c.unit}`).join('; ')}.`,
    );
    const where = [
      ...a.files.map((f) => `\`${dataDir}/${f}\``),
      ...a.tests.map((t) => `checked by \`${t.startsWith('src/') ? t : `${dataDir}/${t}`}\``),
    ];
    out.push(`- **Where:** ${where.join('; ')}.`);
    out.push(
      a.deviations.length === 0
        ? '- **Known differences:** none.'
        : `- **Known differences:** ${thousands(a.deviations.length)}, listed under Known differences below.`,
    );
    out.push('');
  }

  out.push('## Known differences from the oracles', '');
  out.push(
    'Each is accepted only in the exact shape described, so anything else in the same place still fails. The last column is the GitHub issue that tracks it; "none" means it is by design, a convention or a limit of the oracle, with no issue open.',
    '',
  );
  out.push('| Area | Difference | Kind | Tracked by |', '| --- | --- | --- | --- |');
  const title = new Map(v.areas.map((a) => [a.id, a.title]));
  for (const d of v.deviations) {
    out.push(
      `| ${cell(title.get(d.area) ?? d.area)} | ${cell(d.text)} | ${cell(d.kind)} | ${d.issue === null ? 'none' : `#${d.issue}`} |`,
    );
  }
  out.push('');

  out.push('## Mutation testing', '');
  out.push(...renderMutation(v.mutation));
  return out.join('\n');
}

/** A table cell: no pipe, no line break. @param {string} s */
function cell(s) {
  return s.replace(/\|/g, '/').replace(/\s+/g, ' ');
}

/** @param {number} x */
const percent = (x) => `${x.toFixed(2)}%`;

/**
 * @param {MutationSummary} m
 * @returns {string[]}
 */
export function renderMutation(m) {
  /** @type {string[]} */
  const out = [];
  if (m.score === null || m.counts === null) {
    out.push(
      '**Not yet recorded.** No mutation score has been committed to `docs/validation/mutation-summary.json`, so none is shown.',
      '',
    );
    return out;
  }
  const detected = (m.counts['Killed'] ?? 0) + (m.counts['Timeout'] ?? 0);
  const undetected = (m.counts['Survived'] ?? 0) + (m.counts['NoCoverage'] ?? 0);
  out.push(
    `- **Latest score:** ${percent(m.score)}${m.floor === null ? '' : `, against a floor of ${m.floor}`}.`,
    `- **Run:** ${m.date ?? 'date not recorded'}${m.appVersion === null ? '' : `, for release ${m.appVersion}`}${m.run === null ? '' : `: ${m.run}`}${m.stryker === null ? '' : `, with Stryker ${m.stryker}`}.`,
    `- **Mutants:** ${thousands(detected + undetected)} counted, of which ${thousands(detected)} were detected by a test (${thousands(m.counts['Killed'] ?? 0)} killed, ${thousands(m.counts['Timeout'] ?? 0)} timed out) and ${thousands(undetected)} were not (${thousands(m.counts['Survived'] ?? 0)} survived, ${thousands(m.counts['NoCoverage'] ?? 0)} no test reached). A further ${thousands(m.counts['Ignored'] ?? 0)} were left out on purpose by a disable comment in the code and ${thousands(m.counts['RuntimeError'] ?? 0)} could not run; neither counts toward the score.`,
    `- **Files:** ${plural(m.files.length, 'file', 'files')} have a result.`,
  );
  if (m.unmeasured.length > 0)
    out.push(
      `- **In scope but without a result in this run:** ${m.unmeasured.map((f) => `\`${f}\``).join(', ')}.`,
    );
  out.push(
    '',
    'The score is detected mutants over detected plus undetected ones. Some survivors are mutants that change nothing a test could see; they are recorded one by one in the mutation-testing design note (item 50). The score describes the code as it was when the run finished. Changes made after it are mutation-tested again before the next release.',
    '',
  );
  if (m.note !== undefined) out.push(m.note, '');
  /** @type {Map<string, { files: number; detected: number; undetected: number }>} */
  const groups = new Map();
  for (const f of m.files) {
    const dir = f.file.slice(0, f.file.lastIndexOf('/'));
    const g = groups.get(dir) ?? { files: 0, detected: 0, undetected: 0 };
    g.files += 1;
    g.detected += f.killed + f.timeout;
    g.undetected += f.survived + f.noCoverage;
    groups.set(dir, g);
  }
  out.push('| Folder | Files | Mutants counted | Score |', '| --- | --- | --- | --- |');
  for (const [dir, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const total = g.detected + g.undetected;
    out.push(
      `| \`${dir}\` | ${g.files} | ${thousands(total)} | ${total === 0 ? 'n/a' : percent((100 * g.detected) / total)} |`,
    );
  }
  out.push('');
  return out;
}

/**
 * The committed summary of a Stryker JSON report: the score as Stryker defines
 * it (detected over detected plus undetected; ignored mutants and runtime
 * errors are not counted), per file and in all. `configured` is the `mutate`
 * list of stryker.config.json, so a file that is in scope but absent from the
 * report is named rather than silently left out.
 * @param {{ files: Record<string, { mutants: { status: string }[] }>; framework?: { version?: string } }} report
 * @param {{ date: string; appVersion: string; run: string; floor: number | null; configured: string[]; note?: string }} meta
 * @returns {MutationSummary}
 */
export function summarizeMutationReport(report, meta) {
  /** @type {Record<string, number>} */
  const counts = {};
  const files = Object.entries(report.files)
    .map(([file, data]) => {
      /** @type {Record<string, number>} */
      const by = {};
      for (const m of data.mutants) by[m.status] = (by[m.status] ?? 0) + 1;
      for (const [k, n] of Object.entries(by)) counts[k] = (counts[k] ?? 0) + n;
      const killed = by['Killed'] ?? 0;
      const timeout = by['Timeout'] ?? 0;
      const survived = by['Survived'] ?? 0;
      const noCoverage = by['NoCoverage'] ?? 0;
      const total = killed + timeout + survived + noCoverage;
      return {
        file,
        score: total === 0 ? null : round2((100 * (killed + timeout)) / total),
        killed,
        timeout,
        survived,
        noCoverage,
      };
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const detected = (counts['Killed'] ?? 0) + (counts['Timeout'] ?? 0);
  const total = detected + (counts['Survived'] ?? 0) + (counts['NoCoverage'] ?? 0);
  const measured = new Set(files.map((f) => f.file));
  /** @type {MutationSummary} */
  const summary = {
    score: total === 0 ? null : round2((100 * detected) / total),
    floor: meta.floor,
    date: meta.date,
    appVersion: meta.appVersion,
    run: meta.run,
    stryker: report.framework?.version ?? null,
    counts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))),
    files,
    unmeasured: meta.configured.filter((f) => !measured.has(f)),
  };
  if (meta.note !== undefined) summary.note = meta.note;
  return summary;
}

/** @param {number} x */
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Reads the committed inputs of the page from a checkout.
 * @param {string} root
 * @returns {ValidationInput}
 */
export function readValidationInput(root) {
  /** @param {string} f @returns {unknown} */
  const json = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
  const registry = /** @type {AreaRegistry} */ (json('docs/validation/oracle-areas.json'));
  const dir = join(root, registry.dataDir);
  return {
    registry,
    deviations: /** @type {{ deviations: Deviation[] }} */ (json('docs/validation/deviations.json'))
      .deviations,
    mutation: /** @type {MutationSummary} */ (json('docs/validation/mutation-summary.json')),
    requirements: parseRequirements(
      readFileSync(join(root, 'scripts/oracle/requirements.txt'), 'utf8'),
    ),
    readData: (file) => /** @type {unknown} */ (JSON.parse(readFileSync(join(dir, file), 'utf8'))),
    dataFiles: readdirSync(dir).filter((f) => /\.(json|gbk)$/.test(f)),
    testFiles: readdirSync(dir).filter((f) => f.endsWith('.ts')),
  };
}

/**
 * The page's generated Markdown, from a checkout. This is what the build puts
 * in place of the marker line of `docs/guide/18-validation.md`.
 * @param {string} root
 */
export function validationMarkdown(root) {
  const input = readValidationInput(root);
  return renderValidationMarkdown(buildValidation(input), input.registry.dataDir);
}

/** The line of the page that the generated Markdown replaces. */
export const VALIDATION_MARKER = '<!-- validation-tables -->';

/**
 * A guide page with the marker replaced; any other page as it is.
 * @param {string} markdown
 * @param {string} tables
 */
export function fillValidationMarker(markdown, tables) {
  return markdown.replace(VALIDATION_MARKER, tables);
}
