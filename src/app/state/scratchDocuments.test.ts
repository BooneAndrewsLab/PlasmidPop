// @vitest-environment jsdom
import { SeqDocument } from '@/core';
import { DocumentRepository, PlasmidPopDb, SCRATCH_LIFETIME_DAYS } from '@/storage';

import { editorStore } from './editorStore';
import { PersistenceService } from './persistence';

const DAY = 24 * 60 * 60 * 1000;
const product = () =>
  SeqDocument.create({ name: 'pProduct', sequence: 'ACGTACGTACGT', topology: 'circular' });
const scratch = { scratch: true };

function closeAll(): void {
  for (const d of editorStore.getState().documents) editorStore.closeDocument(d.documentId);
}

function open(doc = product(), fileName: string | null = null): string {
  return editorStore.openDocument(doc, fileName, [], scratch);
}

let n = 0;
function service() {
  const repo = new DocumentRepository(new PlasmidPopDb(`scratch-svc-${Date.now()}-${n++}`));
  return { repo, service: new PersistenceService(repo) };
}

beforeEach(() => {
  closeAll();
  localStorage.clear();
});

describe('a scratch tab (item 110)', () => {
  it('is scratch only when the opener says so, not for want of a file name', () => {
    const asked = open();
    const pasted = editorStore.openDocument(
      SeqDocument.create({ name: 'pPaste', sequence: 'GGGGCCCC' }),
    );
    expect(editorStore.documentState(asked)?.scratch).toBe(true);
    expect(editorStore.documentState(pasted)?.scratch).toBe(false);
  });

  it('stays scratch through everything short of an edit: viewing, selecting, switching tabs', () => {
    const id = open();
    editorStore.openDocument(SeqDocument.create({ name: 'other', sequence: 'TTTTAAAA' }));
    editorStore.activateDocument(id);
    editorStore.setSelection({ start: 1, end: 4 });
    editorStore.setSidebarTab('enzymes');
    editorStore.setSidebarTab('features');
    expect(editorStore.documentState(id)?.scratch).toBe(true);
    expect(editorStore.getState().dirty).toBe(true);
  });

  it('is kept by an edit', () => {
    const id = open();
    editorStore.apply({ type: 'insert', position: 2, text: 'GG' }, undefined, id);
    expect(editorStore.documentState(id)?.scratch).toBe(false);
  });

  it('is kept by a rename', () => {
    const id = open();
    editorStore.apply({ type: 'rename', name: 'pMine' }, undefined, id);
    expect(editorStore.documentState(id)?.scratch).toBe(false);
  });

  it('is not kept by an edit that makes the product what it is', () => {
    const id = open();
    editorStore.apply({ type: 'insert', position: 2, text: 'GG' }, undefined, id, undefined, false);
    expect(editorStore.documentState(id)?.scratch).toBe(true);
    expect(editorStore.documentState(id)?.history.present.length).toBe(14);
  });

  it('is kept by a download', () => {
    const id = open();
    editorStore.markDownloaded(id, 'pProduct.gb');
    expect(editorStore.documentState(id)?.scratch).toBe(false);
  });

  it('is kept by Keep, and Keep does nothing to one that is kept', () => {
    const id = open();
    editorStore.keepDocument(id);
    expect(editorStore.documentState(id)?.scratch).toBe(false);
    const before = editorStore.documentState(id);
    editorStore.keepDocument(id);
    expect(editorStore.documentState(id)).toBe(before);
  });

  it('is kept by being opened again as something of the user’s', () => {
    const id = open(product(), 'pProduct.gb');
    expect(editorStore.openDocument(product(), 'pProduct.gb')).toBe(id);
    expect(editorStore.documentState(id)?.scratch).toBe(false);
  });

  it('is not made kept by being opened again as scratch', () => {
    const id = open(product(), 'pProduct.gb');
    expect(open(product(), 'pProduct.gb')).toBe(id);
    expect(editorStore.documentState(id)?.scratch).toBe(true);
  });
});

describe('autosaving scratch (item 110)', () => {
  it('writes a scratch tab as scratch, and as kept once it is kept', async () => {
    const { repo, service: svc } = service();
    const id = open();
    await svc.autosave();
    expect((await repo.list()).find((d) => d.id === id)?.kind).toBe('scratch');
    editorStore.keepDocument(id);
    await svc.autosave();
    expect((await repo.list()).find((d) => d.id === id)?.kind).toBe('file');
  });

  it('writes an edited scratch tab as kept', async () => {
    const { repo, service: svc } = service();
    const id = open();
    editorStore.apply({ type: 'insert', position: 0, text: 'TT' }, undefined, id);
    await svc.autosave();
    expect((await repo.list()).find((d) => d.id === id)?.kind).toBe('file');
  });

  it('does not touch the row when a scratch document is only reopened and looked at', async () => {
    const { repo, service: svc } = service();
    const id = open();
    await svc.autosave();
    const stored = await repo.list();
    const written = stored.find((d) => d.id === id)?.updatedAt ?? 0;
    editorStore.closeDocument(id);
    await svc.openStored(id);
    expect(editorStore.documentState(id)?.scratch).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await svc.autosave();
    editorStore.closeDocument(id);
    const after = (await repo.list()).find((d) => d.id === id);
    expect(after).toMatchObject({ kind: 'scratch', updatedAt: written });
  });

  it('opens a stored kept row as kept and a stored scratch row as scratch', async () => {
    const { service: svc } = service();
    const kept = editorStore.openDocument(
      SeqDocument.create({ name: 'pKept', sequence: 'GGGGCCCC' }),
      'k.gb',
    );
    const unkept = open();
    await svc.autosave();
    closeAll();
    await svc.openStored(kept);
    await svc.openStored(unkept);
    expect(editorStore.documentState(kept)?.scratch).toBe(false);
    expect(editorStore.documentState(unkept)?.scratch).toBe(true);
  });

  it('keeps a scratch row an identical stored kept row, rather than downgrading it', async () => {
    const { repo, service: svc } = service();
    const first = editorStore.openDocument(product(), 'pProduct.gb');
    await svc.autosave();
    closeAll();
    // The same file again, but opened by something that calls it scratch.
    const again = open(product(), 'pProduct.gb');
    expect(again).not.toBe(first);
    await svc.autosave();
    expect(editorStore.getState().documentId).toBe(first);
    expect(editorStore.documentState(first)?.scratch).toBe(false);
    expect((await repo.list()).map((d) => [d.id, d.kind])).toEqual([[first, 'file']]);
  });

  it('keeps an identical stored scratch row when the same document is opened as a file', async () => {
    const { repo, service: svc } = service();
    const first = open(product(), 'pProduct.gb');
    await svc.autosave();
    closeAll();
    const again = editorStore.openDocument(product(), 'pProduct.gb');
    await svc.autosave();
    expect(editorStore.getState().documentId).toBe(first);
    expect(again).not.toBe(first);
    expect((await repo.list()).map((d) => [d.id, d.kind])).toEqual([[first, 'file']]);
  });

  it('writes a closed scratch tab as scratch', async () => {
    const { repo, service: svc } = service();
    svc.saveOnClose();
    const id = open();
    editorStore.closeDocument(id);
    await svc.autosave();
    await new Promise((r) => setTimeout(r, 20));
    expect((await repo.list()).find((d) => d.id === id)?.kind).toBe('scratch');
  });
});

describe('Keep and removal in the service (item 110)', () => {
  it('keeps an open tab through the store and a closed one in storage', async () => {
    const { repo, service: svc } = service();
    const a = open();
    const b = open(SeqDocument.create({ name: 'pTwo', sequence: 'TTTTAAAA' }));
    await svc.autosave();
    editorStore.closeDocument(b);
    await svc.keepStored([a, b]);
    expect(editorStore.documentState(a)?.scratch).toBe(false);
    expect((await repo.list()).map((d) => d.kind)).toEqual(['file', 'file']);
    // The next write of the open tab does not take it back.
    await svc.autosave();
    expect((await repo.list()).map((d) => d.kind)).toEqual(['file', 'file']);
  });

  it('prunes due scratch rows at the clock it is given, sparing open tabs and the tabs to come back to', async () => {
    const { repo, service: svc } = service();
    const open1 = open();
    const gone = open(SeqDocument.create({ name: 'pGone', sequence: 'GGGGCCCC' }));
    const remembered = open(SeqDocument.create({ name: 'pRemembered', sequence: 'GGGGAAAA' }));
    const kept = editorStore.openDocument(
      SeqDocument.create({ name: 'pKept', sequence: 'CCCCAAAA' }),
      'kept.gb',
    );
    await svc.autosave();
    editorStore.closeDocument(gone);
    editorStore.closeDocument(remembered);
    editorStore.closeDocument(kept);
    // The session to come back to still lists `remembered`.
    repo.setOpenDocumentIds([open1, remembered]);
    const later = Date.now() + (SCRATCH_LIFETIME_DAYS + 1) * DAY;
    expect(await svc.pruneScratch(later)).toBe(1);
    expect((await repo.list()).map((d) => d.id).sort()).toEqual([kept, open1, remembered].sort());
  });

  it('removes nothing before the lifetime is up', async () => {
    const { repo, service: svc } = service();
    const id = open();
    await svc.autosave();
    editorStore.closeDocument(id);
    repo.setOpenDocumentIds([]);
    expect(await svc.pruneScratch(Date.now() + (SCRATCH_LIFETIME_DAYS - 1) * DAY)).toBe(0);
  });
});
