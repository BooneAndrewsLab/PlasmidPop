// `node scripts/with-tmp.mjs <command> [args...]`: runs a command with TMPDIR
// pointed at node_modules/.vitest-tmp/<pid>, and removes that folder when the
// command ends.
//
// Vitest 5.0.1 writes every transformed module to <tmpdir>/<nanoid>/ and never
// deletes its root folder, nor the project folders of a killed run. At 50-370
// runs a day that filled 12 GB of the RAM-backed /tmp. A per-run folder keeps
// concurrent runs (a mutation pass beside `npm test`) from clearing each
// other's; folders left by a run that was killed outright are pruned at the
// next start, once their pid is gone.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  process.stderr.write('usage: with-tmp.mjs <command> [args...]\n');
  process.exit(2);
}

const root = resolve('node_modules', '.vitest-tmp');
mkdirSync(root, { recursive: true });

const alive = (/** @type {number} */ pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
};
for (const name of readdirSync(root)) {
  if (!alive(Number(name))) rmSync(join(root, name), { recursive: true, force: true });
}

const dir = join(root, String(process.pid));
mkdirSync(dir, { recursive: true });
const clean = () => {
  rmSync(dir, { recursive: true, force: true });
};

const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, TMPDIR: dir } });
// Ctrl-C reaches the child through the shared process group; forward a plain
// kill so it can shut down, and clean up once it has.
for (const signal of /** @type {const} */ (['SIGTERM', 'SIGHUP'])) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on('error', (error) => {
  clean();
  process.stderr.write(`${error.message}\n`);
  process.exit(127);
});
child.on('close', (code, signal) => {
  clean();
  process.exit(code ?? (signal === null ? 1 : 128));
});
