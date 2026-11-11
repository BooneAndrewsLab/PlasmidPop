import type { MyPart, PartDraft } from '@/core';
import type { DocumentRepository } from '@/storage';

import { MyPartsStore } from './myParts';

/**
 * My parts' store (#437, item 86) against a fake repository: what it does
 * when the read is slow, when it fails, and when a write fails, none of which
 * the component tests through fake-indexeddb reach.
 */

type FakeRepo = Pick<DocumentRepository, 'loadMyParts' | 'putMyParts' | 'deleteMyParts'>;

const stored = (id: string, name: string): MyPart => ({
  id,
  name,
  type: 'promoter',
  sequence: 'ACGTACGTACGTACGTACGTACGT',
  notes: '',
  origin: 'My parts',
});

const draft = (name: string, sequence = 'GGGGCCCCGGGGCCCCGGGGCCCC'): PartDraft => ({
  name,
  type: 'promoter',
  sequence,
  notes: '',
  origin: 'My parts',
});

/** A repository that returns what it was given; each method is a spy. */
function fakeRepo(initial: readonly MyPart[] = []) {
  const repo = {
    loadMyParts: vi.fn(() => Promise.resolve([...initial])),
    putMyParts: vi.fn((_: readonly MyPart[]) => Promise.resolve()),
    deleteMyParts: vi.fn((_: readonly string[]) => Promise.resolve()),
  } satisfies FakeRepo;
  return repo;
}

const storeOver = (repo: FakeRepo) => new MyPartsStore(() => repo as unknown as DocumentRepository);

describe('MyPartsStore load', () => {
  it('reads once, and later calls wait for the same read', async () => {
    const repo = fakeRepo([stored('a', 'one')]);
    const store = storeOver(repo);
    expect(store.getState().status).toBe('unloaded');
    const first = store.load();
    const second = store.load();
    expect(second).toBe(first);
    expect(store.getState().status).toBe('loading');
    await first;
    await store.load();
    expect(repo.loadMyParts).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('ready');
    expect(store.getState().parts.map((p) => p.id)).toEqual(['a']);
  });

  it('puts what was added during the read after what was stored', async () => {
    let finish: (rows: MyPart[]) => void = () => undefined;
    const repo = fakeRepo();
    repo.loadMyParts.mockReturnValue(
      new Promise<MyPart[]>((resolve) => {
        finish = resolve;
      }),
    );
    const store = storeOver(repo);
    const loading = store.load();
    // `add` waits for the read, so the part lands after the stored ones.
    const adding = store.add([draft('mine')]);
    finish([stored('a', 'one'), stored('b', 'two')]);
    await loading;
    const report = await adding;
    expect(store.getState().parts.map((p) => p.name)).toEqual(['one', 'two', 'mine']);
    expect(report.added.map((p) => p.name)).toEqual(['mine']);
  });

  it('keeps a row added before the read ends after the stored ones', async () => {
    // The merge in `load` itself: state already holding a row when the read returns.
    let finish: (rows: MyPart[]) => void = () => undefined;
    const repo = fakeRepo();
    repo.loadMyParts.mockReturnValue(
      new Promise<MyPart[]>((resolve) => {
        finish = resolve;
      }),
    );
    const store = storeOver(repo);
    const loading = store.load();
    // Reach in as a write racing the read would: a row in state while loading.
    (store as unknown as { state: { parts: MyPart[] } }).state = {
      ...store.getState(),
      parts: [stored('early', 'early')],
    };
    finish([stored('a', 'one')]);
    await loading;
    expect(store.getState().parts.map((p) => p.id)).toEqual(['a', 'early']);
  });

  it('notifies subscribers of each change, and stops after unsubscribe', async () => {
    const store = storeOver(fakeRepo());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    await store.load();
    // loading, then ready
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    await store.add([draft('x')]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a failed read sets status failed, and the list works for the session without writes', async () => {
    const repo = fakeRepo();
    repo.loadMyParts.mockRejectedValue(new Error('no storage'));
    const store = storeOver(repo);
    await store.load();
    expect(store.getState().status).toBe('failed');
    expect(store.getState().error).toBeNull();

    const report = await store.add([draft('kept')]);
    expect(report.added).toHaveLength(1);
    const [id] = store.getState().parts.map((p) => p.id);
    await store.update(id ?? '', { notes: 'edited' });
    expect(store.getState().parts[0]?.notes).toBe('edited');
    await store.remove([id ?? '']);
    expect(store.getState().parts).toEqual([]);
    expect(repo.putMyParts).not.toHaveBeenCalled();
    expect(repo.deleteMyParts).not.toHaveBeenCalled();
    expect(store.getState().error).toBeNull();
    // Not retried either.
    await store.load();
    expect(repo.loadMyParts).toHaveBeenCalledTimes(1);
  });
});

describe('MyPartsStore writes', () => {
  it('writes an add, an update and a remove through', async () => {
    const repo = fakeRepo();
    const store = storeOver(repo);
    const { added } = await store.add([draft('one')]);
    expect(repo.putMyParts).toHaveBeenLastCalledWith(added);
    const id = added[0]?.id ?? '';
    await store.update(id, { name: 'renamed' });
    expect(repo.putMyParts).toHaveBeenLastCalledWith([
      expect.objectContaining({ id, name: 'renamed' }),
    ]);
    await store.remove([id]);
    expect(repo.deleteMyParts).toHaveBeenLastCalledWith([id]);
    expect(store.getState().parts).toEqual([]);
  });

  it('writes nothing when an add leaves every draft out, and counts them', async () => {
    const repo = fakeRepo([stored('a', 'one')]);
    const store = storeOver(repo);
    const report = await store.add([
      draft('one', 'ACGTACGTACGTACGTACGTACGT'),
      draft('short', 'ACGT'),
      draft('odd', 'ACGTNNNNACGTACGTACGTACGT'),
    ]);
    expect(report.added).toEqual([]);
    expect([report.duplicates, report.tooShort, report.ambiguous]).toEqual([1, 1, 1]);
    expect(repo.putMyParts).not.toHaveBeenCalled();
  });

  it('a failed add says Could not save the parts, and keeps the part in the list', async () => {
    const repo = fakeRepo();
    repo.putMyParts.mockRejectedValue(new Error('quota'));
    const store = storeOver(repo);
    await store.add([draft('one')]);
    expect(store.getState().error).toBe('Could not save the parts: quota');
    expect(store.getState().parts).toHaveLength(1);
  });

  it('a failed update names the part, and a failed remove says the parts', async () => {
    const repo = fakeRepo([stored('a', 'one')]);
    const store = storeOver(repo);
    await store.load();
    repo.putMyParts.mockRejectedValueOnce(new Error('quota'));
    await store.update('a', { name: 'renamed' });
    expect(store.getState().error).toBe('Could not save renamed: quota');
    repo.deleteMyParts.mockRejectedValueOnce(new Error('locked'));
    await store.remove(['a']);
    expect(store.getState().error).toBe('Could not save the parts: locked');
  });

  it('says what went wrong when the failure is not an Error', async () => {
    const repo = fakeRepo();
    repo.putMyParts.mockRejectedValue('plain text');
    const store = storeOver(repo);
    await store.add([draft('one')]);
    expect(store.getState().error).toBe('Could not save the parts: plain text');
  });

  it('the next successful write clears the error', async () => {
    const repo = fakeRepo();
    repo.putMyParts.mockRejectedValueOnce(new Error('quota'));
    const store = storeOver(repo);
    await store.add([draft('one')]);
    expect(store.getState().error).not.toBeNull();
    await store.add([draft('two', 'TTTTAAAATTTTAAAATTTTAAAA')]);
    expect(store.getState().error).toBeNull();
  });

  it('dismissError clears the error, and is quiet when there is none', async () => {
    const repo = fakeRepo();
    repo.putMyParts.mockRejectedValueOnce(new Error('quota'));
    const store = storeOver(repo);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dismissError();
    expect(listener).not.toHaveBeenCalled();
    await store.add([draft('one')]);
    listener.mockClear();
    store.dismissError();
    expect(store.getState().error).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('update and remove of an unknown id change and write nothing', async () => {
    const repo = fakeRepo([stored('a', 'one')]);
    const store = storeOver(repo);
    await store.load();
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    await store.update('missing', { name: 'x' });
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(repo.putMyParts).not.toHaveBeenCalled();
    // remove has no unknown-id guard: it passes the ids on and the list is unchanged.
    await store.remove(['missing']);
    expect(store.getState().parts).toEqual(before.parts);
    expect(repo.deleteMyParts).toHaveBeenCalledWith(['missing']);
  });
});
