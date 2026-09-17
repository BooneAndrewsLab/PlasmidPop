import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** A GenBank fixture committed under src/io/fixtures (public NCBI records). */
export function readFixture(name: string): string {
  return readFileSync(join(root, 'src/io/fixtures', name), 'utf8');
}

export function listFixtures(): string[] {
  return readdirSync(join(root, 'src/io/fixtures'))
    .filter((f) => f.endsWith('.gb'))
    .sort();
}

/**
 * Private fixtures under fixtures/local (gitignored). Tests that use them
 * pass trivially when the directory is absent, e.g. in CI.
 */
export function listLocalFixtures(): { name: string; text: string }[] {
  const dir = join(root, 'fixtures/local');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(gb|gbk|genbank|ape)$/i.test(f))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}
