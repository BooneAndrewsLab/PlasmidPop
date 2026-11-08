import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type CloningInsert,
  type SeqDocument,
  cuttableSites,
  digest,
  documentFromFragment,
  findCutSites,
  getEnzyme,
} from '@/core';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

/**
 * Inputs for the cloning batch's tests: the vectors and inserts the
 * Cloning workspace's own tests use (item 141, packet 5).
 */

function parse(text: string, name: string): SeqDocument {
  const doc = parseGenBank(text).documents[0];
  if (doc === undefined) throw new Error(`${name}: no record`);
  return doc;
}

const tutorial = (name: string): SeqDocument =>
  parse(readFileSync(join(__dirname, '../../docs/tutorials/files', `${name}.gb`), 'utf8'), name);

export const pUC19 = parse(readFixture('L09137.gb'), 'pUC19');
export const U49845 = parse(readFixture('U49845.gb'), 'U49845');
/** pUC19's polylinker, 0-based: EcoRI SacI KpnI SmaI BamHI XbaI SalI PstI SphI HindIII. */
export const MCS = { start: 395, end: 452 };

export function fromU49845(name: string, start: number, end: number): CloningInsert {
  return { document: U49845, range: { start, end }, strand: 'forward', name };
}

/** The Golden Gate tutorial's destination and a coding part of its own. */
export const ggDestination = tutorial('pGG-Destination');
export const ggGene = tutorial('GG-gene');

/** The In-Fusion tutorial's vector cut open with EcoRV, and the gene it takes. */
export const ifGene = tutorial('IF-gene');
export function linearVector(): SeqDocument {
  const vector = tutorial('pIF-Vector');
  const enzyme = getEnzyme('EcoRV');
  if (enzyme === undefined) throw new Error('no EcoRV');
  const text = vector.sequence.toString();
  const cut = cuttableSites(
    text,
    vector.topology,
    vector.methylation,
    findCutSites(text, vector.topology, [enzyme]),
    (x) => getEnzyme(x)?.site.length ?? 0,
  );
  const only = digest(vector, cut)[0];
  if (only === undefined) throw new Error('pIF-Vector: no fragment');
  return documentFromFragment(only);
}
