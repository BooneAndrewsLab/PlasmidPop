// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import fc from 'fast-check';

import { type AssemblyPart, createFeature, rangeSegment } from '@/core';

import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';

/**
 * The stored shelf's check on the way back in (`isAssemblyPart` behind
 * `loadShelf`), for the phosphatase flag added in #10: a part is kept when
 * `dephosphorylated` is true, false or absent, and dropped for any other
 * value — a string, a number, null, an object — without taking its
 * neighbours with it. Every such value is tried by hand, and fast-check
 * throws arbitrary JSON at the field to confirm nothing else slips through.
 */

let counter = 0;
function freshRepo(): DocumentRepository {
  return new DocumentRepository(new PlasmidPopDb(`shelf-${Date.now()}-${counter++}`));
}

/** A part with no flag at all, or with `flag.value` stored as the flag. */
function part(id: string, flag?: { readonly value: unknown }): AssemblyPart {
  const fragment = {
    sequence: 'AATTCGGG',
    features: [createFeature({ id: 'g', type: 'gene', name: 'g', segments: [rangeSegment(0, 4)] })],
    range: { start: 0, end: 8 },
    left: { kind: "5'" as const, overhang: 'AATT', enzyme: 'EcoRI' },
    right: { kind: 'blunt' as const, overhang: '', enzyme: null },
    source: 'vector',
  };
  // Written the way an older or foreign build might have: any value at all.
  const stored: unknown =
    flag === undefined
      ? { id, flipped: false, fragment }
      : { id, flipped: true, fragment: { ...fragment, dephosphorylated: flag.value } };
  return stored as AssemblyPart;
}

const keeps = (v: unknown): boolean => v === undefined || typeof v === 'boolean';

describe('the stored shelf and the phosphatase flag', () => {
  it('keeps true, false and absent, and drops every other value', async () => {
    const values: unknown[] = [
      true,
      false,
      undefined,
      null,
      'true',
      'false',
      0,
      1,
      {},
      [],
      [true],
      { on: true },
    ];
    const repo = freshRepo();
    const parts = [part('plain'), ...values.map((v, i) => part(`p${i}`, { value: v }))];
    await repo.saveShelf(parts);
    const back = await repo.loadShelf();
    const kept = ['plain', ...values.flatMap((v, i) => (keeps(v) ? [`p${i}`] : []))];
    expect(back.map((p) => p.id)).toEqual(kept);
    // What comes back is what went in, flag and all.
    expect(back).toEqual(parts.filter((p) => kept.includes(p.id)));
    expect(back.map((p) => p.fragment.dephosphorylated)).toEqual([
      undefined,
      true,
      false,
      undefined,
    ]);
  });

  it('keeps a part exactly when the flag is a boolean or absent, for any JSON value', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(fc.constant(undefined), fc.boolean(), fc.jsonValue({ maxDepth: 2 })), {
          minLength: 1,
          maxLength: 6,
        }),
        async (flags) => {
          const repo = freshRepo();
          const parts = flags.map((v, i) => part(`p${i}`, { value: v }));
          await repo.saveShelf(parts);
          const back = await repo.loadShelf();
          expect(back.map((p) => p.id)).toEqual(
            flags.flatMap((v, i) => (keeps(v) ? [`p${i}`] : [])),
          );
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('the stored shelf and the methylation of a part', () => {
  it('keeps a well-formed host or none, and drops a malformed one', async () => {
    const values: unknown[] = [
      undefined,
      { dam: true, dcm: true },
      { dam: false, dcm: false },
      { dam: true, dcm: false },
      null,
      'dam+/dcm+',
      { dam: true },
      { dam: 'yes', dcm: true },
      [true, true],
    ];
    const withHost = (id: string, value: unknown): AssemblyPart => {
      const base = part(id);
      const stored: unknown =
        value === undefined
          ? base
          : { ...base, fragment: { ...base.fragment, methylation: value } };
      return stored as AssemblyPart;
    };
    const repo = freshRepo();
    const parts = values.map((v, i) => withHost(`m${i}`, v));
    await repo.saveShelf(parts);
    const back = await repo.loadShelf();
    expect(back.map((p) => p.id)).toEqual(['m0', 'm1', 'm2', 'm3']);
    // An unmethylated piece of a PCR product comes back unmethylated.
    expect(back[2]?.fragment.methylation).toEqual({ dam: false, dcm: false });
  });
});
