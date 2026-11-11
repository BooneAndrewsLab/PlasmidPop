import type { CollectionPrimer, PrimerDraft } from '@/core';
import type { DocumentRepository } from '@/storage';

import { PrimerCollectionStore } from './primerCollection';

/**
 * The primer collection's store (#437, item 56) against a fake repository:
 * what it does when the read is slow, when it fails, and when a write fails,
 * none of which the component tests through fake-indexeddb reach.
 */

type FakeRepo = Pick<DocumentRepository, 'loadPrimers' | 'putPrimers' | 'deletePrimers'>;

const stored = (id: string, name: string): CollectionPrimer => ({
  id,
  name,
  sequence: 'ACGTACGTACGTACGTACGT',
  notes: '',
});

const draft = (name: string, sequence = 'GGGGCCCCGGGGCCCCGGGG'): PrimerDraft => ({
  name,
  sequence,
  notes: '',
});

/** A repository that keeps what it is given in memory; each method is a spy. */
function fakeRepo(initial: readonly CollectionPrimer[] = []) {
  const repo = {
    loadPrimers: vi.fn(() => Promise.resolve([...initial])),
    putPrimers: vi.fn((_: readonly CollectionPrimer[]) => Promise.resolve()),
    deletePrimers: vi.fn((_: readonly string[]) => Promise.resolve()),
  } satisfies FakeRepo;
  return repo;
}

const storeOver = (repo: FakeRepo) =>
  new PrimerCollectionStore(() => repo as unknown as DocumentRepository);

describe('PrimerCollectionStore load', () => {
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
    expect(repo.loadPrimers).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('ready');
    expect(store.getState().primers.map((p) => p.id)).toEqual(['a']);
  });

  it('puts what was added during the read after what was stored', async () => {
    let finish: (rows: CollectionPrimer[]) => void = () => undefined;
    const repo = fakeRepo();
    repo.loadPrimers.mockReturnValue(
      new Promise<CollectionPrimer[]>((resolve) => {
        finish = resolve;
      }),
    );
    const store = storeOver(repo);
    const loading = store.load();
    // `add` waits for the read, so the primer lands after the stored ones.
    const adding = store.add([draft('mine')]);
    finish([stored('a', 'one'), stored('b', 'two')]);
    await loading;
    const report = await adding;
    expect(store.getState().primers.map((p) => p.name)).toEqual(['one', 'two', 'mine']);
    expect(report.added.map((p) => p.name)).toEqual(['mine']);
  });

  it('keeps a row added before the read ends after the stored ones', async () => {
    // The merge in `load` itself: state already holding a row when the read returns.
    let finish: (rows: CollectionPrimer[]) => void = () => undefined;
    const repo = fakeRepo();
    repo.loadPrimers.mockReturnValue(
      new Promise<CollectionPrimer[]>((resolve) => {
        finish = resolve;
      }),
    );
    const store = storeOver(repo);
    const loading = store.load();
    // Reach in as a write racing the read would: a row in state while loading.
    (store as unknown as { state: { primers: CollectionPrimer[] } }).state = {
      ...store.getState(),
      primers: [stored('early', 'early')],
    };
    finish([stored('a', 'one')]);
    await loading;
    expect(store.getState().primers.map((p) => p.id)).toEqual(['a', 'early']);
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
    repo.loadPrimers.mockRejectedValue(new Error('no storage'));
    const store = storeOver(repo);
    await store.load();
    expect(store.getState().status).toBe('failed');
    expect(store.getState().error).toBeNull();

    const report = await store.add([draft('kept')]);
    expect(report.added).toHaveLength(1);
    const [id] = store.getState().primers.map((p) => p.id);
    await store.update(id ?? '', { notes: 'edited' });
    await store.remove([id ?? '']);
    expect(store.getState().primers).toEqual([]);
    expect(repo.putPrimers).not.toHaveBeenCalled();
    expect(repo.deletePrimers).not.toHaveBeenCalled();
    expect(store.getState().error).toBeNull();
    // Not retried either.
    await store.load();
    expect(repo.loadPrimers).toHaveBeenCalledTimes(1);
  });
});

describe('PrimerCollectionStore writes', () => {
  it('writes an add, an update and a remove through', async () => {
    const repo = fakeRepo();
    const store = storeOver(repo);
    const { added } = await store.add([draft('one')]);
    expect(repo.putPrimers).toHaveBeenLastCalledWith(added);
    const id = added[0]?.id ?? '';
    await store.update(id, { name: 'renamed' });
    expect(repo.putPrimers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id, name: 'renamed' }),
    ]);
    await store.remove([id]);
    expect(repo.deletePrimers).toHaveBeenLastCalledWith([id]);
    expect(store.getState().primers).toEqual([]);
  });

  it('writes nothing when an add leaves every draft out', async () => {
    const repo = fakeRepo([stored('a', 'one')]);
    const store = storeOver(repo);
    const report = await store.add([draft('one', 'ACGTACGTACGTACGTACGT'), draft('blank', '')]);
    expect(report).toEqual({ added: [], duplicates: 1, empty: 1 });
    expect(repo.putPrimers).not.toHaveBeenCalled();
  });

  it('a failed add says Could not save the primers, and keeps the primer in the list', async () => {
    const repo = fakeRepo();
    repo.putPrimers.mockRejectedValue(new Error('quota'));
    const store = storeOver(repo);
    await store.add([draft('one')]);
    expect(store.getState().error).toBe('Could not save the primers: quota');
    expect(store.getState().primers).toHaveLength(1);
  });

  it('a failed update names the primer, and a failed remove the collection', async () => {
    const repo = fakeRepo([stored('a', 'one')]);
    const store = storeOver(repo);
    await store.load();
    repo.putPrimers.mockRejectedValueOnce(new Error('quota'));
    await store.update('a', { name: 'renamed' });
    expect(store.getState().error).toBe('Could not save renamed: quota');
    repo.deletePrimers.mockRejectedValueOnce(new Error('locked'));
    await store.remove(['a']);
    expect(store.getState().error).toBe('Could not save the collection: locked');
  });

  it('says what went wrong when the failure is not an Error', async () => {
    const repo = fakeRepo();
    repo.putPrimers.mockRejectedValue('plain text');
    const store = storeOver(repo);
    await store.add([draft('one')]);
    expect(store.getState().error).toBe('Could not save the primers: plain text');
  });

  it('the next successful write clears the error', async () => {
    const repo = fakeRepo();
    repo.putPrimers.mockRejectedValueOnce(new Error('quota'));
    const store = storeOver(repo);
    await store.add([draft('one')]);
    expect(store.getState().error).not.toBeNull();
    await store.add([draft('two')]);
    expect(store.getState().error).toBeNull();
  });

  it('dismissError clears the error, and is quiet when there is none', async () => {
    const repo = fakeRepo();
    repo.putPrimers.mockRejectedValueOnce(new Error('quota'));
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
    expect(repo.putPrimers).not.toHaveBeenCalled();
    // remove has no unknown-id guard: it passes the ids on and the list is unchanged.
    await store.remove(['missing']);
    expect(store.getState().primers).toEqual(before.primers);
    expect(repo.deletePrimers).toHaveBeenCalledWith(['missing']);
  });
});
