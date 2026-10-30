// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  BUNDLED_ENZYME_SET,
  type DigestFragment,
  type Enzyme,
  SeqDocument,
  cuttableSites,
  digest,
  findCutSites,
  getEnzyme,
  ligate,
  setActiveEnzymeSet,
} from '@/core';
import { decodeSharePayload, parseGenBank } from '@/io';
import { PlasmidPopDb, DocumentRepository, createBackup, restoreBackup } from '@/storage';

import {
  type CloneCheckContext,
  cloneCheckFromParts,
  forgetCloneChecks,
  recallCloneCheck,
  registerCloneCheck,
  restoreStoredCloneCheck,
  storedCloneCheck,
} from './cloneCheck';
import { shareLinkFor, sharePayloadIn } from './share';
import { serialize } from './saveFile';
import { editorStore } from './state/editorStore';
import { PersistenceService } from './state/persistence';

/**
 * The clone-check context kept with the stored document (#327, item 120):
 * the sidecar field of the IndexedDB row, keyed by the checksum it was made
 * for. It is read back by the same repository and service the app uses, and
 * it is in no file the user downloads and no link they share.
 */

const DIR = join(__dirname, '../../docs/tutorials/files');

function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(`${name} has no record`);
  return doc;
}

function enz(name: string): Enzyme {
  const e = getEnzyme(name);
  if (e === undefined) throw new Error(`no enzyme ${name}`);
  return e;
}

function longest(doc: SeqDocument): DigestFragment {
  const text = doc.sequence.toString();
  const enzymes = ['EcoRI', 'BamHI'].map(enz);
  const sites = cuttableSites(
    text,
    doc.topology,
    doc.methylation,
    findCutSites(text, doc.topology, enzymes),
    (n) => getEnzyme(n)?.site.length ?? 0,
  );
  const f = [...digest(doc, sites)].sort((a, b) => b.sequence.length - a.sequence.length)[0];
  if (f === undefined) throw new Error('no fragments');
  return f;
}

function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

const vector = tut('pLig-Vector');
const backbone = longest(vector);
const piece = longest(tut('Insert-EcoRI-BamHI'));
const product = ligate([backbone, piece], { name: 'clone', circular: true });

/** A base that is not the one at `at`. */
function other(doc: SeqDocument, at: number): string {
  return doc.sequence.toString()[at] === 'A' ? 'C' : 'A';
}

function contextOf(): CloneCheckContext {
  return def(
    cloneCheckFromParts(
      product,
      { document: vector, fragment: backbone },
      [],
      'Ligation',
      { open: false, note: 'fixed' },
      [{ name: 'ins fwd', sequence: 'ACGTACGTACGTACGTACGT' }],
      true,
    ),
  );
}

let counter = 0;
function fresh(): { db: PlasmidPopDb; repo: DocumentRepository } {
  const db = new PlasmidPopDb(`cc-${Date.now()}-${counter++}`);
  return { db, repo: new DocumentRepository(db) };
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

afterEach(() => {
  forgetCloneChecks();
});

describe('the stored form', () => {
  it('is plain JSON, small beside the document, and gives the same context back', () => {
    const context: CloneCheckContext = { ...contextOf(), empty: vector, emptyNote: null };
    const stored = def(storedCloneCheck(product, context));
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
    // The empty vector is its bases, not a GenBank file: the size of the molecule, no more.
    expect(JSON.stringify(stored).length).toBeLessThan(vector.length + 2000);
    forgetCloneChecks();
    restoreStoredCloneCheck(stored);
    const back = def(recallCloneCheck(product));
    expect(back.geometry).toEqual(context.geometry);
    expect(back.method).toBe('Ligation');
    expect(back.orientation).toBe('fixed');
    expect(back.orientationNote).toBe(context.orientationNote);
    expect(back.emptyNote).toBe(context.emptyNote);
    expect(back.primers).toEqual(context.primers);
    expect(back.vector).toEqual({ name: vector.name, chosen: true });
    expect(back.empty?.sequence.toString()).toBe(context.empty?.sequence.toString());
    expect(back.empty?.isCircular).toBe(true);
    expect(back.empty?.name).toBe(context.empty?.name);
  });

  it('keeps a missing empty vector missing, and has nothing for a document with no checksum', () => {
    const none = { ...contextOf(), empty: null, emptyNote: 'no empty' };
    const stored = def(storedCloneCheck(product, none));
    expect(stored.empty).toBeNull();
    forgetCloneChecks();
    restoreStoredCloneCheck(stored);
    expect(recallCloneCheck(product)?.empty).toBeNull();
    expect(storedCloneCheck(SeqDocument.create({ sequence: '' }), none)).toBeNull();
    expect(storedCloneCheck(product, null)).toBeNull();
  });

  it('is found by the product’s checksum, so an edit inside the insert finds nothing', () => {
    const context = contextOf();
    const stored = def(storedCloneCheck(product, context));
    forgetCloneChecks();
    restoreStoredCloneCheck(stored);
    const { insert } = context.geometry;
    const middle = Math.floor((insert.start + insert.end) / 2);
    const edited = product.replace({ start: middle, end: middle + 1 }, other(product, middle));
    expect(recallCloneCheck(edited)).toBeNull();
    expect(recallCloneCheck(product)).not.toBeNull();
  });
});

describe('the repository', () => {
  it('keeps the context on the row and gives it back on load; an edit has none to give', async () => {
    const { repo, db } = fresh();
    const stored = def(storedCloneCheck(product, contextOf()));
    await repo.save('p', product, null, { origin: null, derived: false, cloneCheck: stored });
    expect((await db.documents.get('p'))?.cloneCheck).toEqual(stored);
    const loaded = def(await repo.load('p'));
    expect(loaded.cloneCheck).toEqual(stored);
    // The same document saved again with the edit: the old context is not carried over.
    const edited = product.replace({ start: 100, end: 101 }, other(product, 100));
    await repo.save('p', edited, null, { origin: null, derived: false, cloneCheck: stored });
    expect((await db.documents.get('p'))?.cloneCheck).toBeUndefined();
    await repo.save('p', edited, null);
    expect((await db.documents.get('p'))?.cloneCheck).toBeUndefined();
  });

  it('loads rows from before the field, with no context', async () => {
    const { repo, db } = fresh();
    await repo.save('old', product, null);
    const row = def(await db.documents.get('old'));
    expect('cloneCheck' in row).toBe(false);
    expect(def(await repo.load('old')).cloneCheck ?? null).toBeNull();
  });

  it('writes nothing of it into the document’s text', async () => {
    const { repo, db } = fresh();
    const stored = def(storedCloneCheck(product, contextOf()));
    await repo.save('p', product, null, { origin: null, derived: false, cloneCheck: stored });
    const plain = fresh();
    await plain.repo.save('p', product, null);
    expect((await db.documents.get('p'))?.text).toBe((await plain.db.documents.get('p'))?.text);
  });
});

describe('what leaves the browser', () => {
  it('a download, a share link and the file written for storage carry no trace of the context', async () => {
    const before = serialize(product, 'genbank');
    registerCloneCheck(product, contextOf());
    const text = serialize(product, 'genbank');
    expect(text).toBe(before);
    expect(text).not.toMatch(/clone.?check|junction/i);
    const link = await shareLinkFor(product);
    const payload = sharePayloadIn(new URL(link.url).hash);
    expect(await decodeSharePayload(def(payload))).toBe(text);
  });

  it('a backup carries it with the row, and a restore puts it back', async () => {
    const a = fresh();
    const stored = def(storedCloneCheck(product, contextOf()));
    await a.repo.save('p', product, null, { origin: null, derived: false, cloneCheck: stored });
    const { bytes } = await createBackup(a.db);
    const b = fresh();
    await restoreBackup(bytes, b.db);
    expect((await b.db.documents.get('p'))?.cloneCheck).toEqual(stored);
  });
});

describe('the autosave and reopen of the app', () => {
  it('a product opened with a context finds it after the tab is closed and reopened from storage', async () => {
    const { repo, db } = fresh();
    const service = new PersistenceService(repo);
    registerCloneCheck(product, contextOf());
    const id = editorStore.openDocument(product, null);
    await service.autosave();
    expect((await db.documents.get(id))?.cloneCheck?.method).toBe('Ligation');
    editorStore.closeDocument();
    forgetCloneChecks();
    expect(recallCloneCheck(product)).toBeNull();
    await service.openStored(id);
    const reopened = def(editorStore.documentState(id)).history.present;
    expect(def(recallCloneCheck(reopened)).geometry).toEqual(contextOf().geometry);
    editorStore.closeDocument();
  });

  it('a product edited inside its insert is saved without the context', async () => {
    const { repo, db } = fresh();
    const service = new PersistenceService(repo);
    registerCloneCheck(product, contextOf());
    const id = editorStore.openDocument(product, null);
    await service.autosave();
    const { insert } = contextOf().geometry;
    const at = Math.floor((insert.start + insert.end) / 2);
    editorStore.apply({
      type: 'replace',
      range: { start: at, end: at + 1 },
      text: other(product, at),
    });
    await service.autosave();
    expect((await db.documents.get(id))?.cloneCheck).toBeUndefined();
    editorStore.closeDocument();
    forgetCloneChecks();
    await service.openStored(id);
    expect(recallCloneCheck(def(editorStore.documentState(id)).history.present)).toBeNull();
    editorStore.closeDocument();
  });

  it('the flush on leaving writes it too, and leaves it out of the localStorage stash', async () => {
    const { repo, db } = fresh();
    const service = new PersistenceService(repo);
    registerCloneCheck(product, contextOf());
    const id = editorStore.openDocument(product, null);
    await service.autosave({ urgent: true });
    expect((await db.documents.get(id))?.cloneCheck?.method).toBe('Ligation');
    const stash = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.getItem(localStorage.key(i) ?? ''),
    ).join('\n');
    expect(stash).not.toMatch(/Ligation|junctions/);
    editorStore.closeDocument();
  });
});
