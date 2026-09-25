import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';

import { SeqDocument } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';
import { readFixture } from '@/test/fixtures';

import oracle from './genbank.json';

/**
 * Not a check on its own: with ORACLE_EXPORT set (scripts/oracle/run.sh
 * writer) it writes GenBank files with our writer, plus what each one is
 * meant to hold, for scripts/oracle/check_writer.py to read back with
 * Biopython. That is how a plasmid saved here would look to other tools.
 */
const out = process.env['ORACLE_EXPORT'];

function intended(doc: SeqDocument) {
  return {
    sequence: doc.sequence.toString().toUpperCase(),
    topology: doc.topology,
    features: doc.features.all().map((f) => ({
      type: f.type,
      strand: f.strand,
      sequence: doc.featureSequence(f).toUpperCase(),
      qualifiers: Object.fromEntries(
        [...new Set(f.qualifiers.map((q) => q.name))].map((name) => [
          name,
          f.qualifiers.filter((q) => q.name === name).map((q) => q.value ?? ''),
        ]),
      ),
    })),
  };
}

describe.runIf(out !== undefined)('export for the Biopython writer check', () => {
  it('writes our GenBank files and what they should hold', () => {
    if (out === undefined) return;
    mkdirSync(out, { recursive: true });
    const docs: [string, SeqDocument][] = [];
    for (const c of [...oracle.static, ...oracle.random, ...oracle.fixtures]) {
      const text = 'genbank' in c ? c.genbank : readFixture(c.fixture);
      const doc = parseGenBank(text).documents[0];
      if (doc !== undefined) docs.push([c.label, doc]);
    }
    // And what random editing sessions leave behind.
    const sessions = fc.sample(fc.tuple(docShapeArb, fc.array(opShapeArb, { maxLength: 25 })), {
      numRuns: 300,
      seed: 20260923,
    });
    sessions.forEach(([shape, ops], i) => {
      let doc = SeqDocument.create({
        sequence: shape.sequence,
        topology: shape.topology,
        features: layFeatures(shape),
      });
      for (const opShape of ops) {
        const op = resolveOp(doc, opShape);
        if (op !== null) doc = doc.apply(op);
      }
      docs.push([`edited ${i}`, doc]);
    });
    // A document carrying a "made from" tree (item 52): its COMMENT block has
    // lines longer than GenBank's 79 columns when a primer is long, and
    // another reader must still take the file.
    const primer = { name: 'a long primer, with a 5′ tail', sequence: 'ACGT'.repeat(30) };
    docs.push([
      'made from',
      SeqDocument.create({
        name: 'pMADE',
        sequence: 'ACGTTGCAAG'.repeat(40),
        topology: 'circular',
        metadata: {
          lineage: {
            name: 'pMADE',
            checksum: null,
            topology: 'circular',
            length: 400,
            step: {
              op: 'pcr',
              forward: primer,
              reverse: primer,
              polymerase: 'taq',
              parents: [
                {
                  name: 'template with spaces',
                  checksum: null,
                  topology: 'circular',
                  length: 5000,
                  step: null,
                },
              ],
            },
          },
        },
      }),
    ]);
    const manifest = docs.map(([label, doc], i) => {
      const file = `${i}.gb`;
      writeFileSync(join(out, file), writeGenBank(doc));
      return { label, file, ...intended(doc) };
    });
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
  });
});
