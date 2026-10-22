import { createHash } from 'node:crypto';

import { describe, expect } from 'vitest';

import { randomDna, seededRandom } from '@/test/random';
import { expectWithin, itTimed, medianMs } from '@/test/timing';

import { sha1Base64Url } from './sha1';

/**
 * The synchronous SHA-1 over the canonical string of an E. coli-sized
 * genome (#273). `docs/perf-notes.md` has the measurement this budget is
 * far above: about 30 ms warm on the machine it was taken on, against 78 ms
 * before the loop was tightened. The budget only catches a return to
 * something many times slower; CI runners are slower and share the machine.
 */
describe('SHA-1 speed', () => {
  itTimed(
    'hashes 4.64 MB of sequence in well under a second',
    () => {
      const text = randomDna(seededRandom(273), 4_640_000);
      expect(sha1Base64Url(text)).toBe(createHash('sha1').update(text).digest('base64url'));
      const ms = medianMs(3, () => sha1Base64Url(text));
      process.stderr.write(`[perf] SHA-1 of 4.64 MB: ${ms.toFixed(1)} ms\n`);
      expectWithin(ms, 1500);
    },
    30_000,
  );
});
