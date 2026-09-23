import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type SeqDocument, TRACE_BASES, type TraceBase } from '@/core';
import { FormatError, parseAbif } from '@/io';

import oracle from './abif.json';

/**
 * Our AB1 reader against Biopython's, on the fixtures
 * scripts/oracle/abif_fixtures.py writes (#49): the same base calls and
 * qualities, and the trace channels and peaks from the tags Biopython read.
 * A file without base calls, which Biopython reads as an empty record, is
 * one we refuse with a reason.
 */

const dir = join(fileURLToPath(new URL('../../io/fixtures/abif', import.meta.url)));

interface Expected {
  readonly file: string;
  readonly error?: string;
  readonly sequence?: string;
  readonly qualities?: readonly number[];
  readonly sample?: string | null;
  readonly order?: string | null;
  readonly raw?: Readonly<Record<string, readonly number[]>>;
}

/** Every way `doc` differs from what Biopython read. */
function differences(doc: SeqDocument, expected: Expected): string[] {
  const out: string[] = [];
  const sequence = expected.sequence ?? '';
  if (doc.sequence.toString() !== sequence.toUpperCase()) out.push('sequence');
  const read = doc.read;
  if (read === null) return [...out, 'no read'];
  const qualities = expected.qualities ?? [];
  if (qualities.length > 0 && [...read.qualities].join() !== qualities.join()) {
    out.push('qualities');
  }
  if ((expected.sample ?? '') !== doc.metadata.description) out.push('sample');

  const raw = expected.raw ?? {};
  const order = expected.order ?? '';
  const channels = [raw['DATA9'], raw['DATA10'], raw['DATA11'], raw['DATA12']];
  // Copy 2 of the peaks when it fits the calls, as the reader chooses.
  const peaks = raw['PLOC2']?.length === sequence.length ? raw['PLOC2'] : raw['PLOC1'];
  const traceExpected =
    order.length === 4 &&
    channels.every((c) => c !== undefined) &&
    peaks?.length === sequence.length;
  if (!traceExpected) {
    if (read.trace !== null) out.push('trace where Biopython has none');
    return out;
  }
  if (read.trace === null) return [...out, 'no trace'];
  for (let k = 0; k < 4; k++) {
    const base = order.charAt(k) as TraceBase;
    if (!TRACE_BASES.includes(base)) continue;
    if ([...read.trace.channels[base]].join() !== (channels[k] ?? []).join()) {
      out.push(`channel ${base}`);
    }
  }
  if ([...read.trace.peaks].join() !== peaks.join()) out.push('peaks');
  return out;
}

function check(bytes: Uint8Array, expected: Expected): string[] {
  if (expected.error !== undefined) {
    return (() => {
      try {
        parseAbif(bytes);
        return ['read a file Biopython refuses'];
      } catch {
        return [];
      }
    })();
  }
  if ((expected.sequence ?? '') === '') {
    try {
      parseAbif(bytes);
      return ['no base calls, yet read'];
    } catch (e) {
      return e instanceof FormatError ? [] : [`threw ${String(e)}`];
    }
  }
  const doc = parseAbif(bytes).documents[0];
  return doc === undefined ? ['no document'] : differences(doc, expected);
}

describe('AB1 reader against Biopython', () => {
  it('has fixtures to compare', () => {
    expect(oracle.files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(oracle.files.map((f) => [f.file, f as Expected] as const))('%s', (file, expected) => {
    expect(check(new Uint8Array(readFileSync(join(dir, file))), expected)).toEqual([]);
  });

  it('says why a file without base calls is refused', () => {
    expect(() => parseAbif(new Uint8Array(readFileSync(join(dir, 'traces-only.ab1'))))).toThrow(
      /no base calls/,
    );
  });
});

/**
 * The same comparison over real files, run by `scripts/oracle/run.sh
 * abif-local`, which sets ABIF_ORACLE to Biopython's reading of them.
 * Skipped everywhere else.
 */
const local = process.env['ABIF_ORACLE'];
describe.skipIf(local === undefined || !existsSync(local))(
  'AB1 reader against Biopython, local files',
  () => {
    it('agrees on every file', () => {
      const { files } = JSON.parse(readFileSync(local ?? '', 'utf8')) as { files: Expected[] };
      const problems = files.flatMap((expected) =>
        check(new Uint8Array(readFileSync(expected.file)), expected).map(
          (d) => `${expected.file}: ${d}`,
        ),
      );
      expect(files.length).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });
  },
);
