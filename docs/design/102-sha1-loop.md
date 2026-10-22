# 102. A faster SHA-1

Issue #273. Status: done (1.17.x).

## What was asked

`src/core/checksum/sha1.ts` is our own SHA-1, for the SEGUID checksums
(items 22, 96, 97, 101): synchronous, and there outside a
secure context where `crypto.subtle` is not. #268 measured it at about
20 MB/s and asked for a tighter loop worth two or three times that, with
the known-answer tests kept and the numbers in `docs/perf-notes.md`.

## What was done

Measured first: at 9.28 MB the old code spent about 140 ms in the rounds
and 16 ms in `TextEncoder.encode`. The rounds were slow mostly because V8
compiled the long loop while it ran (on-stack replacement) before the
write-back after it had ever run, then bailed out there for want of type
feedback on nearly every call, so the loop ran at 60-100 MB/s depending on
how it had last been compiled.

- The state is written back to `h` inside the loop, so the optimized code
  has the feedback it needs and stays.
- One message schedule (`W`, an `Int32Array(80)`) for the module; words
  read with `getInt32`; the whole blocks hashed where they lie and only
  the tail copied for padding, where the old code copied the whole message
  into a padded buffer.
- The text is encoded with `encodeInto` 16,384 characters at a time into
  one buffer that stays in cache (7 ms instead of 16 at 9.28 MB). A chunk
  is never cut between the halves of a surrogate pair, which would encode
  as two U+FFFD instead of the one character.

About 150 MB/s once warm, the same at every size (2.5x at 4.64 MB).

## Why not unroll

Writing out the 80 rounds made the warm loop 40% faster again (about
230 MB/s), and four loops of 20 7%. Both cost more to compile: Maglev took
35-40 ms over the written-out rounds, so a single digest got slower at
every size up to several MB, and the four loops made a plasmid's first
digest 6-7 ms against 4-5. The digest of a plasmid on the main thread is
usually the first call in the session, and a genome's goes to the worker
by `crypto.subtle` where there is one, so the single loop that picks its
round function with an `if` was kept. The first call at 1 MB is still a
few ms slower than before (about 30 ms against 25); at a few MB and above
it is 1.5-2x faster.

## How it is checked

`sha1.test.ts`: FIPS 180-1/180-2 vectors (empty, `abc`, the 448- and
896-bit messages, a million `a`), every length around one and two blocks,
UTF-8 lengths at the boundaries, and surrogate pairs either side of the
encoding's chunk boundaries. `sha1.property.test.ts`: random strings of
any code point, and long DNA text with non-ASCII characters inserted,
against `node:crypto`, through the text path and the async fallback's
byte path. `seguid.test.ts`: lsseguid, csseguid and ldseguid against
`node:crypto` over their canonical strings, and cdseguid against
`crypto.subtle` either side of a chunk. `sha1.timing.test.ts` only catches
a return to something many times slower.
