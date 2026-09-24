// Works around stryker-js#6210 until @stryker-mutator/vitest-runner fixes it.
//
// The runner names a test by joining its describe chain with ' ' and passes
// that as Vitest's testNamePattern, but Vitest 5 matches the pattern against
// fullTestName, which joins the chain with ' > '. No test inside a describe
// matches, so each mutant runs zero tests and is reported as survived. This
// rewrites the join to ' > ' in both copies of the runner's name function (the
// setup file that runs inside the tests inlines its own). It is idempotent and
// runs before every `npm run mutate`; once the runner no longer has the old
// line it does nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require.resolve('@stryker-mutator/vitest-runner/package.json');
const dir = join(dirname(pkg), 'dist', 'src');

const OLD = "return nameParts.join(' ').trim();";
const NEW = "return nameParts.filter((part) => part).join(' > ');";

for (const name of ['test-helpers.js', 'stryker-setup.js']) {
  const file = join(dir, name);
  const source = readFileSync(file, 'utf8');
  if (source.includes(OLD)) {
    writeFileSync(file, source.replace(OLD, NEW));
    process.stdout.write(
      `patched ${name} of @stryker-mutator/vitest-runner for Vitest 5 (stryker-js#6210)\n`,
    );
  } else if (!source.includes(NEW)) {
    console.warn(
      `patch-stryker-vitest: ${name} has changed; check whether stryker-js#6210 is fixed and drop this script`,
    );
  }
}
