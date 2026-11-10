// `node scripts/dropCallProbe.mjs [--helper name] [--file substring] [--list]`
//
// The drop-the-call probe (#436). For each call of `wrapPosition`,
// `shortWayRound`, `oneBasedEnd` and `formatSpan` in a non-test source file,
// replace the call with its first argument (`formatSpan`: with the unfolded
// text, `start + 1` and the raw end), one site at a time, run the tests
// related to that file (`vitest related`), and put the file back. A site where
// nothing fails is a call whose helper no test reaches with an input that
// makes it matter. Stryker has no mutator that drops a call, so this is the
// check for it. Needs no change to stryker.config.json; heavy, so run it on an
// idle machine (about an hour for the ~100 sites).
//
// The source file is restored after every site, on error and on SIGINT/SIGTERM
// too (`git checkout -- <file>`; the tree must have no uncommitted change in
// the probed files when it starts, and the script refuses otherwise).
//
// Output: one line per site, `KILLED` or `SURVIVED`, and a summary with the
// count per helper. Exit code 1 when any site survived.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HELPERS = ['wrapPosition', 'shortWayRound', 'oneBasedEnd', 'formatSpan'];
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyHelper = opt('--helper');
const onlyFile = opt('--file');
const listOnly = args.includes('--list');

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

/** End index (exclusive) of the first argument of a call whose `(` is at `open`. */
const firstArgEnd = (text, open) => {
  let depth = 0;
  let quote = null;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return { arg: i, close: i };
      depth--;
    } else if (c === ',' && depth === 0) return { arg: i, close: closeOf(text, i) };
  }
  throw new Error('unbalanced call');
};
const closeOf = (text, from) => {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return i;
      depth--;
    }
  }
  throw new Error('unbalanced call');
};

const sites = [];
for (const file of walk('src')) {
  if (file.endsWith(join('core', 'range', 'range.ts'))) continue;
  const text = readFileSync(file, 'utf8');
  for (const helper of HELPERS) {
    const re = new RegExp(`(?<![\\w.])${helper}\\(`, 'g');
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const open = m.index + helper.length;
      const { arg, close } = firstArgEnd(text, open);
      const first = text.slice(open + 1, arg).trim();
      const replacement =
        helper === 'formatSpan'
          ? `((r: { start: number; end: number }) => \`\${(r.start + 1).toLocaleString()}–\${r.end.toLocaleString()}\`)(${first})`
          : `(${first})`;
      const line = text.slice(0, m.index).split('\n').length;
      sites.push({
        file,
        helper,
        line,
        mutated: text.slice(0, m.index) + replacement + text.slice(close + 1),
        original: text,
      });
    }
  }
}

const chosen = sites.filter(
  (s) =>
    (onlyHelper === undefined || s.helper === onlyHelper) &&
    (onlyFile === undefined || s.file.includes(onlyFile)),
);

if (listOnly) {
  for (const s of chosen) console.log(`${s.helper}\t${s.file}:${String(s.line)}`);
  process.exit(0);
}

const files = [...new Set(chosen.map((s) => s.file))];
const dirty = spawnSync('git', ['status', '--porcelain', '--', ...files], { encoding: 'utf8' });
if (dirty.stdout.trim() !== '') {
  console.error(`Refusing to start, uncommitted changes in probed files:\n${dirty.stdout}`);
  process.exit(2);
}

let current = null;
const restore = () => {
  if (current !== null) {
    spawnSync('git', ['checkout', '--', current]);
    current = null;
  }
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restore();
    process.exit(130);
  });
}

const results = [];
try {
  for (const s of chosen) {
    current = s.file;
    writeFileSync(s.file, s.mutated);
    const run = spawnSync(
      'node',
      ['scripts/with-tmp.mjs', 'node_modules/.bin/vitest', 'related', '--run', s.file],
      { encoding: 'utf8' },
    );
    restore();
    const out = `${run.stdout}${run.stderr}`;
    // No related test file at all counts as a survivor; a non-zero exit with no
    // failed test in the output is the harness, not a kill, and is flagged.
    const status =
      run.status === 0 || /No test files found/.test(out)
        ? 'SURVIVED'
        : /\d+ failed/.test(out)
          ? 'KILLED'
          : 'HARNESS-ERROR';
    results.push({ ...s, status });
    console.log(`${status}\t${s.helper}\t${s.file}:${String(s.line)}`);
  }
} finally {
  restore();
}

const survivors = results.filter((r) => r.status === 'SURVIVED');
console.log('\nSummary (sites, survived):');
for (const h of HELPERS) {
  const of = results.filter((r) => r.helper === h);
  console.log(
    `  ${h}: ${String(of.length)} sites, ${String(of.filter((r) => r.status === 'SURVIVED').length)} survived`,
  );
}
console.log(`Total: ${String(results.length)} sites, ${String(survivors.length)} survived`);
process.exit(survivors.length > 0 ? 1 : 0);
