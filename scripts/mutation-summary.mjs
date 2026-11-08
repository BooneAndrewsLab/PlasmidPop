// `npm run mutate:summary [-- --date YYYY-MM-DD --run "<what the run was>"]`:
// turns the last Stryker report (reports/mutation/mutation.json, which is not
// committed) into docs/validation/mutation-summary.json, the small file the
// guide's Validation page is built from (item 142, #362). Run it after a
// pre-release `npm run mutate:changed` and commit the result with the release.
// It only reads the report; it never starts Stryker.
//
//   --date     the day the run finished (default: the report file's own date)
//   --run      a few words for what the run was, e.g. "the pre-release run on
//              the changes since v1.22.0" (default: "release run"). The page
//              reads "<date>, for release <package.json version>: <run>", so
//              run this on the checkout of the release the run was for.
//   --note     one sentence shown under the numbers
//   --report   another report file
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { summarizeMutationReport } from './validationTools.mjs';

const { values } = parseArgs({
  options: {
    date: { type: 'string' },
    run: { type: 'string' },
    note: { type: 'string' },
    report: { type: 'string', default: 'reports/mutation/mutation.json' },
  },
});

const reportPath = values.report;
/** @typedef {Parameters<typeof summarizeMutationReport>[0]} Report */
/** @param {string} f @returns {unknown} */
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const report = /** @type {Report} */ (read(reportPath));
const config = /** @type {{ mutate: string[]; thresholds?: { break?: number } }} */ (
  read('stryker.config.json')
);
const pkg = /** @type {{ version: string }} */ (read('package.json'));
const mtime = statSync(reportPath).mtime;
const localDay = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}-${String(mtime.getDate()).padStart(2, '0')}`;

const summary = summarizeMutationReport(report, {
  date: values.date ?? localDay,
  appVersion: pkg.version,
  run: values.run ?? 'release run',
  floor: config.thresholds?.break ?? null,
  configured: config.mutate,
  ...(values.note === undefined ? {} : { note: values.note }),
});
writeFileSync('docs/validation/mutation-summary.json', `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(
  `score ${summary.score} over ${summary.files.length} files; unmeasured: ${summary.unmeasured.length}\n`,
);
