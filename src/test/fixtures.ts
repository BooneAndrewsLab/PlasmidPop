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

const SNAPGENE_RESOURCES =
  '/home/matej/Programs/snapgene_8.2.2_linux/data/opt/gslbiotech/snapgene/resources';

/**
 * Real SnapGene .dna files from a local SnapGene installation, when present.
 * Never committed; tests using them pass trivially elsewhere.
 */
export function listLocalSnapGeneFiles(limit = 12): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = [];
  const dirs = [
    join(SNAPGENE_RESOURCES, 'sampleData/Sample project'),
    join(SNAPGENE_RESOURCES, 'Plasmids/Gateway Destination Vectors'),
    join(root, 'fixtures/local'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)
      .filter((x) => x.toLowerCase().endsWith('.dna'))
      .sort()) {
      if (out.length >= limit) return out;
      out.push({ name: f, data: new Uint8Array(readFileSync(join(dir, f))) });
    }
  }
  return out;
}
