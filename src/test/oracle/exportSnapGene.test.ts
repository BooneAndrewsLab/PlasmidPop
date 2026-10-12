import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';

import { SeqDocument } from '@/core';
import { parseGenBank, parseSnapGene, writeSnapGene } from '@/io';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';
import { listLocalSnapGeneFiles, readFixture } from '@/test/fixtures';

import oracle from './genbank.json';

/**
 * Not a check on its own: with ORACLE_EXPORT_SNAPGENE set
 * (scripts/oracle/run.sh snapgene-writer) it writes SnapGene files with our
 * writer, plus what each one is meant to hold, for
 * scripts/oracle/check_snapgene_writer.py to read back with Biopython's
 * SnapGene reader (#204). The only independent reader of the format there is.
 */
const out = process.env['ORACLE_EXPORT_SNAPGENE'];

function only(docs: readonly SeqDocument[]): SeqDocument {
  const doc = docs[0];
  if (doc === undefined) throw new Error('the file holds no document');
  return doc;
}

/** The bases of packet 0x00, both strands' worth, as SnapGene stores them. */
function storedSequence(bytes: Uint8Array): string {
  let i = 0;
  while (i < bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + i + 1, 4).getUint32(0, false);
    if (bytes[i] === 0x00)
      return new TextDecoder().decode(bytes.subarray(i + 6, i + 5 + length)).toUpperCase();
    i += 5 + length;
  }
  return '';
}

describe.runIf(out !== undefined)('export for the Biopython SnapGene check', () => {
  it('writes our .dna files and what they should hold', () => {
    if (out === undefined) return;
    mkdirSync(out, { recursive: true });
    const docs: [string, SeqDocument][] = [];
    for (const c of [...oracle.static, ...oracle.random, ...oracle.fixtures]) {
      const text = 'genbank' in c ? c.genbank : readFixture(c.fixture);
      const doc = parseGenBank(text).documents[0];
      if (doc !== undefined) docs.push([c.label, doc]);
    }
    const fixtures = new URL('../../io/fixtures/snapgene/', import.meta.url);
    for (const f of readdirSync(fixtures).filter((x) => x.endsWith('.dna'))) {
      docs.push([
        `fixture ${f}`,
        only(parseSnapGene(new Uint8Array(readFileSync(new URL(f, fixtures)))).documents),
      ]);
    }
    // And real files, where SnapGene is installed: what it wrote, written again.
    for (const { name, data } of listLocalSnapGeneFiles(400))
      docs.push([`local ${name}`, only(parseSnapGene(data, name).documents)]);
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
    const manifest = docs
      .filter(
        ([, doc]) =>
          !doc.isProtein &&
          doc.length > 0 &&
          // Biopython does not read .rna (it has no 0x00 packet).
          !(
            doc.topology === 'linear' &&
            /rna/i.test(doc.metadata.moleculeType) &&
            !/dna/i.test(doc.metadata.moleculeType)
          ) &&
          // A feature the reader cut short at an overhang is written whole
          // again, so Biopython's bases for it are not the document's.
          !(
            doc.ends !== null &&
            doc.features
              .all()
              .some((f) =>
                f.segments.some((s) => s.kind === 'range' && (s.partialStart || s.partialEnd)),
              )
          ) &&
          // Biopython reads a whole circle that starts after its first base
          // ("14-13") as an empty location and refuses the whole file.
          !doc.features
            .all()
            .some((f) =>
              f.segments.some(
                (s) => s.kind === 'range' && s.end - s.start === doc.length && s.start !== 0,
              ),
            ),
      )
      .map(([label, doc], i) => {
        const written = writeSnapGene(doc, { colorOf: () => '#6f9bd1' });
        const file = `${i}.${written.extension}`;
        writeFileSync(join(out, file), written.bytes);
        return {
          label,
          file,
          sequence: storedSequence(written.bytes),
          topology: doc.topology,
          features: doc.features
            .all()
            // A location between two bases has no place in the file.
            .filter((f) => f.segments.some((s) => s.kind === 'range'))
            .map((f) => ({
              type: f.type,
              strand: f.strand,
              name: f.name,
              // The bases the feature reads, whichever of the file's sequence they come from.
              sequence: doc.featureSequence(f).toUpperCase(),
            })),
        };
      });
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
  });
});
