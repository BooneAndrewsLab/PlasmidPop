import { describe, expect, it } from 'vitest';

import { HISTORY_FORMAT, isStoredFeature, isStoredHistory } from './historyFormat';

/**
 * `isStoredHistory` field by field (item 51): a row may come from another
 * build or have gone bad, and every field that is not what it should be
 * drops the row. Each case below starts from one well-formed row and breaks
 * a single thing in it.
 */

type Fields = Record<string, unknown>;

function feature(over: Fields = {}): Fields {
  return {
    id: 'f1',
    type: 'CDS',
    name: 'bla',
    strand: 'reverse',
    segments: [
      { kind: 'range', start: 0, end: 4, partialStart: false, partialEnd: true },
      { kind: 'site', position: 6 },
    ],
    qualifiers: [
      { name: 'gene', value: 'bla' },
      { name: 'pseudo', value: null },
    ],
    ...over,
  };
}

function reference(over: Fields = {}): Fields {
  return {
    number: 1,
    location: 'bases 1 to 8',
    authors: 'A.',
    consortium: '',
    title: 'T',
    journal: 'J',
    pubmed: '',
    remark: '',
    ...over,
  };
}

function metadata(over: Fields = {}): Fields {
  return {
    description: 'd',
    accession: '',
    version: '',
    keywords: '',
    source: '',
    organism: '',
    taxonomy: '',
    moleculeType: 'DNA',
    division: '',
    date: '',
    dbLinks: ['BioProject:1'],
    references: [reference()],
    comments: ['c'],
    extraHeaders: [{ keyword: 'PROJECT', value: 'p' }],
    derivedFrom: null,
    lineage: null,
    ...over,
  };
}

function strandEnd(over: Fields = {}): Fields {
  return { kind: 'blunt', overhang: '', enzyme: null, ...over };
}

function ends(over: Fields = {}): Fields {
  return {
    left: strandEnd(),
    right: strandEnd({ kind: "3'", overhang: 'AT', enzyme: 'PstI' }),
    ...over,
  };
}

function trace(over: Fields = {}): Fields {
  return {
    peaks: new Int32Array(8),
    channels: {
      A: new Int16Array(8),
      C: new Int16Array(8),
      G: new Int16Array(8),
      T: new Int16Array(8),
    },
    ...over,
  };
}

function read(over: Fields = {}): Fields {
  return { qualities: new Uint8Array(8), trace: trace(), ...over };
}

function state(over: Fields = {}): Fields {
  return {
    name: 'p',
    sequence: 'ACGTACGT',
    topology: 'circular',
    features: [feature()],
    metadata: metadata(),
    ends: ends(),
    methylation: { dam: true, dcm: false },
    read: read(),
    ...over,
  };
}

function step(over: Fields = {}): Fields {
  return {
    label: 'Insert',
    at: 1,
    merged: 1,
    name: 'Named',
    delta: {
      sequence: { kind: 'splice', start: 2, deleted: 0, text: 'A' },
      features: { kind: 'patch', replay: true, removed: ['old'], upserted: [feature()] },
      name: 'q',
      topology: 'linear',
      metadata: metadata(),
      ends: null,
      methylation: { dam: false, dcm: true },
      read: null,
    },
    ...over,
  };
}

function row(over: Fields = {}): Fields {
  return {
    id: 'doc',
    format: HISTORY_FORMAT,
    limit: 100,
    startedAt: 0,
    truncated: false,
    position: 3,
    base: state(),
    steps: [
      step(),
      step({
        delta: {
          sequence: { kind: 'rotate', origin: 3 },
          features: { kind: 'list', features: [feature()] },
        },
      }),
      step({
        merged: undefined,
        name: undefined,
        delta: { sequence: { kind: 'reverseComplement' } },
      }),
    ],
    opened: { kind: 'step', position: 0 },
    saved: { kind: 'state', state: state({ read: read({ trace: null }) }) },
    named: [
      { name: 'First', label: 'Insert', at: 1, state: { kind: 'step', position: 0 } },
      { name: 'Gone', label: 'Cut', at: 2, state: { kind: 'state', state: state() } },
    ],
    updatedAt: 5,
    ...over,
  };
}

const withFeature = (over: Fields): Fields => row({ base: state({ features: [feature(over)] }) });
const withSegment = (segment: unknown): Fields =>
  withFeature({ segments: [{ kind: 'site', position: 0 }, segment] });
const withMetadata = (over: Fields): Fields => row({ base: state({ metadata: metadata(over) }) });
const withEnds = (e: unknown): Fields => row({ base: state({ ends: e }) });
const withRead = (r: unknown): Fields => row({ base: state({ read: r }) });
const withDelta = (delta: unknown): Fields => row({ position: 1, steps: [step({ delta })] });
const withNamed = (entry: Fields): Fields =>
  row({
    named: [{ name: 'N', label: 'L', at: 0, state: { kind: 'step', position: 0 }, ...entry }],
  });
const range = (over: Fields): Fields => ({
  kind: 'range',
  start: 0,
  end: 4,
  partialStart: false,
  partialEnd: false,
  ...over,
});
const channels = (over: Fields): Fields => ({
  A: new Int16Array(8),
  C: new Int16Array(8),
  G: new Int16Array(8),
  T: new Int16Array(8),
  ...over,
});

describe('isStoredHistory', () => {
  it('accepts a well-formed row that uses every field', () => {
    expect(isStoredHistory(row())).toBe(true);
    expect(isStoredFeature(feature())).toBe(true);
  });

  it.each<[string, () => unknown]>([
    ['no ends and no read', () => row({ base: state({ ends: null, read: null }) })],
    ['a read without a trace', () => withRead(read({ trace: null }))],
    ["a 5' end", () => withEnds(ends({ left: strandEnd({ kind: "5'", overhang: 'AATT' }) }))],
    ['a metadata row from before lineages', () => withMetadata({ lineage: undefined })],
    [
      'metadata derived from a file',
      () => withMetadata({ derivedFrom: { checksum: 'x', fileName: 'a.gb' } }),
    ],
    ['an empty delta', () => withDelta({})],
    [
      'a step merged once, unnamed',
      () => row({ position: 1, steps: [step({ merged: undefined })] }),
    ],
    ['a landmark of none', () => row({ opened: { kind: 'none' }, saved: { kind: 'origin' } })],
    ['no named states', () => row({ named: undefined })],
    ['a range beside a site', () => withSegment(range({}))],
    ['a named state of its own', () => withNamed({})],
  ])('accepts %s', (_, make) => {
    expect(isStoredHistory(make())).toBe(true);
  });

  it.each<[string, () => unknown]>([
    // Segments
    ['a segment that is not an object', () => withSegment('0..4')],
    ['a segment that is null', () => withSegment(null)],
    ['a segment of another kind', () => withSegment(range({ kind: 'span' }))],
    ['a range whose start is not a count', () => withSegment(range({ start: -1 }))],
    ['a range whose end is not a count', () => withSegment(range({ end: 1.5 }))],
    ['a range whose partialStart is not a boolean', () => withSegment(range({ partialStart: 0 }))],
    ['a range whose partialEnd is not a boolean', () => withSegment(range({ partialEnd: 'no' }))],
    ['a site whose position is not a count', () => withSegment({ kind: 'site', position: -2 })],
    // Qualifiers
    ['a qualifier that is not an object', () => withFeature({ qualifiers: ['gene=bla'] })],
    ['a qualifier without a name', () => withFeature({ qualifiers: [{ value: 'bla' }] })],
    [
      'a qualifier whose value is a number',
      () => withFeature({ qualifiers: [{ name: 'n', value: 3 }] }),
    ],
    // Features
    ['a feature that is not an object', () => row({ base: state({ features: [null] }) })],
    ['a feature without an id', () => withFeature({ id: 1 })],
    ['a feature without a type', () => withFeature({ type: undefined })],
    ['a feature without a name', () => withFeature({ name: null })],
    ['a feature on no strand', () => withFeature({ strand: 'both' })],
    ['a feature whose segments are not a list', () => withFeature({ segments: { kind: 'site' } })],
    ['a feature with no segments', () => withFeature({ segments: [] })],
    ['a feature whose qualifiers are not a list', () => withFeature({ qualifiers: {} })],
    // Metadata
    ['metadata that is not an object', () => row({ base: state({ metadata: 'none' }) })],
    ['metadata without a description', () => withMetadata({ description: 1 })],
    ['db links that are not strings', () => withMetadata({ dbLinks: [1] })],
    ['references that are not a list', () => withMetadata({ references: {} })],
    ['a reference that is not an object', () => withMetadata({ references: ['ref'] })],
    [
      'a reference without a number',
      () => withMetadata({ references: [reference({ number: '1' })] }),
    ],
    [
      'a reference without a title',
      () => withMetadata({ references: [reference({ title: null })] }),
    ],
    [
      'a reference missing only its remark',
      () => withMetadata({ references: [reference({ remark: undefined })] }),
    ],
    ['comments that are not strings', () => withMetadata({ comments: [null] })],
    ['extra headers that are not a list', () => withMetadata({ extraHeaders: 'x' })],
    ['a header entry that is not an object', () => withMetadata({ extraHeaders: ['PROJECT'] })],
    ['a header entry without a keyword', () => withMetadata({ extraHeaders: [{ value: 'p' }] })],
    ['a header entry without a value', () => withMetadata({ extraHeaders: [{ keyword: 'K' }] })],
    ['derivedFrom that is not an object', () => withMetadata({ derivedFrom: 'a.gb' })],
    ['derivedFrom without a file name', () => withMetadata({ derivedFrom: { checksum: 'x' } })],
    ['a lineage that is not one', () => withMetadata({ lineage: { name: 1 } })],
    // Ends
    ['ends that are not an object', () => withEnds('blunt')],
    ['a left end that is not an object', () => withEnds(ends({ left: null }))],
    ['a right end that is not an object', () => withEnds(ends({ right: 'blunt' }))],
    ['an end of another kind', () => withEnds(ends({ left: strandEnd({ kind: 'sticky' }) }))],
    [
      'an end whose overhang is not a string',
      () => withEnds(ends({ left: strandEnd({ overhang: 4 }) })),
    ],
    ['an end whose enzyme is a number', () => withEnds(ends({ right: strandEnd({ enzyme: 7 }) }))],
    // Methylation
    ['methylation that is not an object', () => row({ base: state({ methylation: 'dam' }) })],
    ['methylation without dcm', () => row({ base: state({ methylation: { dam: true } }) })],
    // Reads
    ['a read that is not an object', () => withRead('ACGT')],
    ['qualities that are a plain list', () => withRead(read({ qualities: [30, 30], trace: null }))],
    ['a trace that is not an object', () => withRead(read({ trace: 'trace' }))],
    [
      'a trace whose peaks are a plain list',
      () => withRead(read({ trace: trace({ peaks: [1, 2] }) })),
    ],
    [
      'a trace whose channels are not an object',
      () => withRead(read({ trace: trace({ channels: null }) })),
    ],
    [
      'a trace with one channel of the wrong type',
      () => withRead(read({ trace: trace({ channels: channels({ T: new Int8Array(8) }) }) })),
    ],
    [
      'a trace missing a channel',
      () => withRead(read({ trace: trace({ channels: channels({ G: undefined }) }) })),
    ],
    // Sequence deltas
    ['a delta that is not an object', () => withDelta('splice')],
    ['a sequence delta that is null', () => withDelta({ sequence: null })],
    ['a sequence delta that is a string', () => withDelta({ sequence: 'reverseComplement' })],
    ['a sequence delta of another kind', () => withDelta({ sequence: { kind: 'invert' } })],
    [
      'a splice without a start',
      () => withDelta({ sequence: { kind: 'splice', deleted: 0, text: '' } }),
    ],
    [
      'a splice whose deleted is negative',
      () => withDelta({ sequence: { kind: 'splice', start: 0, deleted: -1, text: '' } }),
    ],
    [
      'a splice without text',
      () => withDelta({ sequence: { kind: 'splice', start: 0, deleted: 1, text: null } }),
    ],
    ['a rotation without an origin', () => withDelta({ sequence: { kind: 'rotate' } })],
    // Feature deltas
    ['a features delta that is null', () => withDelta({ features: null })],
    ['a features delta that is a list', () => withDelta({ features: [feature()] })],
    [
      'a features delta of another kind',
      () => withDelta({ features: { kind: 'merge', replay: true, removed: [], upserted: [] } }),
    ],
    [
      'a feature list with a bad feature',
      () => withDelta({ features: { kind: 'list', features: [{}] } }),
    ],
    [
      'a patch whose replay is not a boolean',
      () => withDelta({ features: { kind: 'patch', replay: 1, removed: [], upserted: [] } }),
    ],
    [
      'a patch whose removed ids are not strings',
      () => withDelta({ features: { kind: 'patch', replay: false, removed: [1], upserted: [] } }),
    ],
    [
      'a patch with a bad upserted feature',
      () =>
        withDelta({
          features: {
            kind: 'patch',
            replay: false,
            removed: [],
            upserted: [feature({ strand: 1 })],
          },
        }),
    ],
    // Other delta fields
    ['a delta name that is not a string', () => withDelta({ name: 3 })],
    ['a delta topology that is not one', () => withDelta({ topology: 'round' })],
    ['delta metadata that is not metadata', () => withDelta({ metadata: {} })],
    ['delta ends that are not ends', () => withDelta({ ends: {} })],
    ['delta methylation that is not methylation', () => withDelta({ methylation: null })],
    ['a delta read that is not a read', () => withDelta({ read: {} })],
    // Steps
    ['a step merged zero times', () => row({ position: 1, steps: [step({ merged: 0 })] })],
    [
      'a step merged a fraction of a time',
      () => row({ position: 1, steps: [step({ merged: 1.5 })] }),
    ],
    ['a step at no time', () => row({ position: 1, steps: [step({ at: Infinity })] })],
    ['a step with a blank name', () => row({ position: 1, steps: [step({ name: '' })] })],
    // Landmarks
    ['a landmark that is not an object', () => row({ opened: 'step' })],
    ['a landmark of another kind', () => row({ saved: { kind: 'file' } })],
    ['a step landmark without a position', () => row({ opened: { kind: 'step' } })],
    ['a state landmark with a bad state', () => row({ saved: { kind: 'state', state: {} } })],
    // Named states
    ['a named state that is not an object', () => row({ named: ['First'] })],
    ['a named state with a blank name', () => withNamed({ name: ' ' })],
    ['a named state without a label', () => withNamed({ label: 2 })],
    ['a named state at no time', () => withNamed({ at: NaN })],
    ['a named state that is no state', () => withNamed({ state: { kind: 'none' } })],
    ['a named state at the origin', () => withNamed({ state: { kind: 'origin' } })],
    ['a named state at a bad step', () => withNamed({ state: { kind: 'step', position: -1 } })],
    // The row itself
    ['a row without an id', () => row({ id: undefined })],
    ['a row of another format', () => row({ format: HISTORY_FORMAT + 1 })],
    ['a row with a negative limit', () => row({ limit: -1 })],
    ['a row whose truncated is not a boolean', () => row({ truncated: 'no' })],
    ['a row with no base', () => row({ base: null })],
    ['a row whose steps are not a list', () => row({ steps: {} })],
    ['a row updated at no time', () => row({ updatedAt: '5' })],
  ])('refuses %s', (_, make) => {
    expect(isStoredHistory(make())).toBe(false);
  });
});
