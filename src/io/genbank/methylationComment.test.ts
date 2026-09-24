import fc from 'fast-check';

import {
  type HostMethylationState,
  METHYLATED_HOST,
  SeqDocument,
  createFeature,
  rangeSegment,
} from '@/core';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';

import {
  formatMethylationComment,
  isMethylationComment,
  needsMethylationComment,
  parseMethylationComment,
} from './methylationComment';
import { parseGenBank } from './parseGenBank';
import { writeGenBank } from './writeGenBank';

/**
 * Host methylation in a GenBank file (#45, item 44).
 *
 * GenBank has nowhere for it, so it rides in one COMMENT line of ours,
 * `PlasmidPop-methylation: dam-; dcm+`, beside the sticky-ends and
 * derived-from lines. What is checked: every host round-trips and the
 * default writes nothing; the parser's tolerance (spacing, case, a line
 * naming only one flag, the same flag twice) and its refusals (anything it
 * cannot read is left in the comments rather than guessed at); that the
 * three lines of ours and the user's own comments can come in any order
 * and each lands where it belongs; and that write → parse → write is a
 * fixed point, also for random documents after random edits.
 */

const HOSTS: readonly HostMethylationState[] = [
  { dam: true, dcm: true },
  { dam: true, dcm: false },
  { dam: false, dcm: true },
  { dam: false, dcm: false },
];

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const readBack = (text: string): SeqDocument => must(parseGenBank(text).documents[0], 'a record');
const commentLines = (text: string): string[] =>
  text.split('\n').filter((l) => l.startsWith('COMMENT'));

describe('the methylation comment line', () => {
  it('formats and reads back every host', () => {
    expect(HOSTS.map(formatMethylationComment)).toEqual([
      'PlasmidPop-methylation: dam+; dcm+',
      'PlasmidPop-methylation: dam+; dcm-',
      'PlasmidPop-methylation: dam-; dcm+',
      'PlasmidPop-methylation: dam-; dcm-',
    ]);
    for (const state of HOSTS) {
      expect(parseMethylationComment(formatMethylationComment(state))).toEqual(state);
      expect(isMethylationComment(formatMethylationComment(state))).toBe(true);
      expect(needsMethylationComment(state)).toBe(!state.dam || !state.dcm);
    }
  });

  it.each([
    ['PlasmidPop-methylation: dam-; dcm-', { dam: false, dcm: false }],
    ['PlasmidPop-methylation:dam-;dcm+', { dam: false, dcm: true }],
    ['   PlasmidPop-methylation:   dam -  ;   dcm +   ', { dam: false, dcm: true }],
    ['PlasmidPop-methylation: DAM+; DCM-', { dam: true, dcm: false }],
    ['PlasmidPop-methylation: Dcm-; Dam-', { dam: false, dcm: false }],
    // A flag it does not mention keeps the default.
    ['PlasmidPop-methylation: dam-', { dam: false, dcm: true }],
    ['PlasmidPop-methylation: dcm-', { dam: true, dcm: false }],
    ['PlasmidPop-methylation: dam+', { dam: true, dcm: true }],
    // A part it cannot read is skipped as long as another is understood.
    ['PlasmidPop-methylation: dam-; ecoKI+', { dam: false, dcm: true }],
    ['PlasmidPop-methylation: nonsense; dcm-', { dam: true, dcm: false }],
    // The same flag twice: the last one says.
    ['PlasmidPop-methylation: dam-; dam+', { dam: true, dcm: true }],
    ['PlasmidPop-methylation: dcm+; dcm-; dam-', { dam: false, dcm: false }],
  ] as const)('reads %j', (line, want) => {
    expect(parseMethylationComment(line)).toEqual(want);
  });

  it.each([
    'PlasmidPop-methylation:',
    'PlasmidPop-methylation: ',
    'PlasmidPop-methylation: garbage',
    'PlasmidPop-methylation: dam',
    'PlasmidPop-methylation: dam?; dcm*',
    'PlasmidPop-methylation: dam-, dcm-',
    'PlasmidPop-methylation: dam+ dcm-',
    'PlasmidPop-methylation: yes',
    // The prefix is ours and exact.
    'plasmidpop-methylation: dam-; dcm-',
    'PlasmidPop-methylation dam-; dcm-',
    'Note: PlasmidPop-methylation: dam-; dcm-',
    'grown in dam- dcm- E. coli',
  ])('refuses %j', (line) => {
    expect(parseMethylationComment(line)).toBeNull();
  });
});

const EMPTY_CHECKSUM = `ldseguid=${'A'.repeat(27)}`;

/** A document using every comment line of ours, plus comments of its own. */
function everything(state: HostMethylationState): SeqDocument {
  return SeqDocument.create({
    name: 'pAll',
    topology: 'linear',
    sequence: 'ACGT'.repeat(20),
    methylation: state,
    ends: {
      left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
      right: { kind: 'blunt', overhang: '', enzyme: null },
    },
    metadata: {
      comments: ['Grown overnight in LB.', 'Mentions PlasmidPop-methylation: dam- in passing'],
      derivedFrom: { checksum: EMPTY_CHECKSUM, fileName: 'p.gb' },
    },
    features: [createFeature({ type: 'gene', name: 'g', segments: [rangeSegment(3, 30)] })],
  });
}

describe('methylation in a GenBank file', () => {
  it('writes no line for an ordinary strain, one for anything else, and reads it back', () => {
    for (const state of HOSTS) {
      const doc = SeqDocument.create({ name: 'p', sequence: 'ACGTACGT', methylation: state });
      const text = writeGenBank(doc);
      const lines = commentLines(text).filter((l) => l.includes('PlasmidPop-methylation'));
      expect(lines).toHaveLength(needsMethylationComment(state) ? 1 : 0);
      const back = readBack(text);
      expect(back.methylation).toEqual(state);
      expect(back.metadata.comments).toEqual([]);
      expect(writeGenBank(back)).toBe(text);
    }
  });

  it('reads a file without the line as an ordinary strain', () => {
    const text = writeGenBank(SeqDocument.create({ name: 'p', sequence: 'ACGT' }));
    expect(readBack(text).methylation).toEqual(METHYLATED_HOST);
  });

  it('sorts its own lines from the user’s, in whatever order the file has them', () => {
    for (const state of HOSTS.filter(needsMethylationComment)) {
      const written = writeGenBank(everything(state));
      const lines = written.split('\n');
      const comments = commentLines(written);
      // Ours come first as written: ends, methylation, derived-from, then the user's.
      expect(comments.map((l) => l.slice(12).split(':')[0])).toEqual([
        'PlasmidPop-ends',
        'PlasmidPop-methylation',
        'PlasmidPop-derived-from',
        'Grown overnight in LB.',
        'Mentions PlasmidPop-methylation',
      ]);
      const first = lines.findIndex((l) => l.startsWith('COMMENT'));
      const rest = lines.filter((l) => !l.startsWith('COMMENT'));
      // Every order of the five lines reads the same.
      for (const order of permutations(comments)) {
        const text = [...rest.slice(0, first), ...order, ...rest.slice(first)].join('\n');
        const back = readBack(text);
        expect(back.methylation).toEqual(state);
        expect(back.ends?.left).toEqual({ kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' });
        expect(back.metadata.derivedFrom).toEqual({ checksum: EMPTY_CHECKSUM, fileName: 'p.gb' });
        // The user's comments stay, in the order the file had them.
        expect(back.metadata.comments).toEqual(
          order.filter((l) => !/COMMENT {5}PlasmidPop-/.test(l)).map((l) => l.slice(12)),
        );
        // And writing it back puts ours in their own order again.
        const again = writeGenBank(back);
        expect(commentLines(again).slice(0, 3)).toEqual(comments.slice(0, 3));
        expect(writeGenBank(readBack(again))).toBe(again);
      }
    }
  });

  it('leaves a line it cannot read in the comments', () => {
    const text = writeGenBank(
      SeqDocument.create({
        name: 'p',
        sequence: 'ACGT',
        metadata: { comments: ['PlasmidPop-methylation: garbage'] },
      }),
    );
    // The writer drops a line of ours it did not make: nothing of it is written.
    expect(text).not.toContain('PlasmidPop-methylation');
    const handWritten = text.replace(
      'FEATURES',
      'COMMENT     PlasmidPop-methylation: garbage\nFEATURES',
    );
    const back = readBack(handWritten);
    expect(back.methylation).toEqual(METHYLATED_HOST);
    expect(back.metadata.comments).toEqual(['PlasmidPop-methylation: garbage']);
  });

  it('takes the first readable line when there are two, and keeps no copy of either', () => {
    const base = writeGenBank(SeqDocument.create({ name: 'p', sequence: 'ACGT' }));
    const withLines = (...lines: string[]) =>
      base.replace('FEATURES', `${lines.map((l) => `COMMENT     ${l}`).join('\n')}\nFEATURES`);
    const two = readBack(
      withLines('PlasmidPop-methylation: dam-; dcm-', 'PlasmidPop-methylation: dam+; dcm-'),
    );
    expect(two.methylation).toEqual({ dam: false, dcm: false });
    expect(two.metadata.comments).toEqual([]);
    // A damaged line before a good one: the good one says, and (as for
    // sticky ends) every line of ours then leaves the comments.
    const damaged = readBack(
      withLines('PlasmidPop-methylation: garbage', 'PlasmidPop-methylation: dcm-'),
    );
    expect(damaged.methylation).toEqual({ dam: true, dcm: false });
    expect(damaged.metadata.comments).toEqual([]);
  });

  it('round-trips random documents after random edits, as a fixed point', () => {
    fc.assert(
      fc.property(
        docShapeArb,
        fc.array(opShapeArb, { maxLength: 10 }),
        fc.constantFrom(...HOSTS),
        fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .,]{0,40}$/), { maxLength: 3 }),
        (shape, ops, state, comments) => {
          let doc = SeqDocument.create({
            name: 'pRandom',
            sequence: shape.sequence,
            topology: shape.topology,
            features: layFeatures(shape),
            metadata: { comments: comments.map((c) => c.trim()).filter((c) => c !== '') },
          });
          for (const opShape of ops) {
            const op = resolveOp(doc, opShape);
            if (op !== null) doc = doc.apply(op);
          }
          // A site left on an empty sequence cannot be written (see
          // genbank.property.test.ts), the one loss that is not ours.
          fc.pre(doc.length > 0);
          doc = doc.apply({ type: 'setMethylation', methylation: state });
          const text = writeGenBank(doc);
          const back = readBack(text);
          expect(back.methylation).toEqual(state);
          expect(back.metadata.comments).toEqual(doc.metadata.comments);
          expect(writeGenBank(back)).toBe(text);
        },
      ),
      { numRuns: 120 },
    );
  }, 15_000);
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}
