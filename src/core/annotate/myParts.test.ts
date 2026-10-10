import { describe, expect, it } from 'vitest';

import { SeqDocument } from '../document';
import { createFeature, rangeSegment } from '../features';
import { reverseComplement } from '../sequence';
import { detectFeatures } from './detect';
import { featureFromHit } from './hits';
import {
  MY_PARTS_ORIGIN,
  myPartToLibraryPart,
  partFromFeature,
  partsFromDocument,
  preparePartDrafts,
  readPartBases,
} from './myParts';

const PROMOTER = 'TTGACAATTAATCATCGGCTCGTATAATGTGTGGA';
const draft = (over: Partial<Parameters<typeof preparePartDrafts>[1][number]> = {}) => ({
  name: 'my promoter',
  type: 'promoter',
  sequence: PROMOTER,
  notes: '',
  origin: MY_PARTS_ORIGIN,
  ...over,
});

describe('preparePartDrafts', () => {
  it('cleans bases, fills the type and keeps the rest', () => {
    const r = preparePartDrafts([], [draft({ sequence: ' ttgacaat taatcatcggctcg\n', type: ' ' })]);
    expect(r.ready).toEqual([
      {
        name: 'my promoter',
        type: 'misc_feature',
        sequence: 'TTGACAATTAATCATCGGCTCG',
        notes: '',
        origin: 'My parts',
      },
    ]);
  });

  it('leaves out duplicates, short parts and ambiguous ones, and counts each', () => {
    const r = preparePartDrafts(
      [{ name: 'my promoter', sequence: PROMOTER }],
      [
        draft(),
        draft({ name: 'short', sequence: 'ACGTACGT' }),
        draft({ name: 'fuzzy', sequence: 'ACGTNCGTACGTACGT' }),
        draft({ name: '', sequence: PROMOTER }),
        draft({ name: 'twin', sequence: PROMOTER }),
        draft({ name: 'twin', sequence: PROMOTER }),
      ],
    );
    expect(r.ready.map((p) => p.name)).toEqual(['twin']);
    expect(r).toMatchObject({ duplicates: 2, tooShort: 2, ambiguous: 1 });
  });

  it('keeps a protein part with no bases, and drops a protein too short to match', () => {
    const r = preparePartDrafts(
      [],
      [
        draft({ name: 'tag', sequence: '', protein: 'dykddddk' }),
        draft({ name: 'tiny', sequence: '', protein: 'MK' }),
      ],
    );
    expect(r.ready).toEqual([
      {
        name: 'tag',
        type: 'promoter',
        sequence: '',
        protein: 'DYKDDDDK',
        notes: '',
        origin: 'My parts',
      },
    ]);
    expect(r.tooShort).toBe(1);
  });

  it('reads U as T and refuses other letters', () => {
    expect(readPartBases('acgu')).toBe('ACGT');
    expect(readPartBases('ACGR')).toBeNull();
  });
});

describe('parts from a document', () => {
  const seq = 'AAAAAAAAAA' + PROMOTER + 'CCCCCCCCCC';
  const doc = SeqDocument.create({
    name: 'construct',
    sequence: seq,
    features: [
      createFeature({
        type: 'promoter',
        name: 'p1',
        strand: 'reverse',
        segments: [rangeSegment(10, 10 + PROMOTER.length)],
        qualifiers: [{ name: 'note', value: 'in-house' }],
      }),
    ],
  });

  it('reads a feature on the reverse strand in its own direction', () => {
    const feature = doc.features.all()[0];
    if (feature === undefined) throw new Error('no feature');
    const [p] = partsFromDocument(doc);
    expect(p).toMatchObject({
      name: 'p1',
      type: 'promoter',
      notes: 'in-house',
      origin: 'My parts',
    });
    const rc = reverseComplement(PROMOTER);
    expect(p?.sequence).toBe(rc);
    expect(partFromFeature(doc, feature)).toEqual({ ...p });
  });

  it('takes a record without features whole, and a protein as a protein', () => {
    const bare = SeqDocument.create({ name: 'landing pad', sequence: PROMOTER });
    expect(partsFromDocument(bare)).toMatchObject([
      { name: 'landing pad', type: 'misc_feature', sequence: PROMOTER },
    ]);
    const prot = SeqDocument.create({
      name: 'FLAG-ish',
      sequence: 'DYKDDDDK',
      alphabet: 'protein',
    });
    expect(partsFromDocument(prot)).toMatchObject([
      { name: 'FLAG-ish', sequence: '', protein: 'DYKDDDDK' },
    ]);
  });
});

describe('a kept part in Detect features', () => {
  const part = myPartToLibraryPart({
    id: 'x',
    name: 'my promoter',
    type: 'promoter',
    sequence: PROMOTER,
    notes: 'in-house',
    origin: 'pLannotate: snapgene',
  });

  it('is labelled with where it came from', () => {
    expect(part).toMatchObject({
      source: 'mine',
      origin: 'pLannotate: snapgene',
      note: 'in-house',
    });
  });

  it('is found on either strand and annotated with its origin, never a citation', () => {
    const seq = 'GATTACAGATTACAGATTACA' + PROMOTER + 'CATTAGGACCATTAGGACCA';
    const [hit] = detectFeatures(seq, 'linear', { parts: [part] });
    expect(hit).toMatchObject({
      range: { start: 21, end: 21 + PROMOTER.length },
      strand: 'forward',
    });
    if (hit === undefined) throw new Error('not found');
    const { sequence: _s, ...shown } = part;
    const f = featureFromHit(hit, shown);
    expect(f.name).toBe('my promoter');
    const notes = f.qualifiers.filter((q) => q.name === 'note').map((q) => q.value);
    expect(notes.some((n) => (n ?? '').endsWith('to pLannotate: snapgene'))).toBe(true);
  });
});
