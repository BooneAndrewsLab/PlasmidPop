import { useEffect, useSyncExternalStore } from 'react';

import { type CollectionPrimer, type PrimerDraft, newId, preparePrimers } from '@/core';
import { type DocumentRepository, getRepository } from '@/storage';

import { analytics } from '../analytics';

/**
 * The primer collection (#64, item 56): the user's own oligos, kept in this
 * browser's IndexedDB beside the documents, a row per primer.
 *
 * A store of its own rather than a field of the editor's: it belongs to no
 * document, is read only by the Primers tab and the few buttons that add to
 * it, and every change is a write to IndexedDB, which the editor store is
 * kept free of. It is read the first time something asks for it, so a
 * session that never opens the Primers tab never reads it.
 */
export interface PrimerCollectionState {
  readonly primers: readonly CollectionPrimer[];
  /** `failed` when IndexedDB could not be read; the list then works for the session only. */
  readonly status: 'unloaded' | 'loading' | 'ready' | 'failed';
  /** What went wrong with the last write, for the tab to say; null when nothing did. */
  readonly error: string | null;
}

/** What adding a batch came to, for the tab to say. */
export interface AddReport {
  readonly added: readonly CollectionPrimer[];
  /** Already in the collection under the same name, and not added again. */
  readonly duplicates: number;
  /** Drafts with no bases in them. */
  readonly empty: number;
}

export type PrimerPatch = Partial<Pick<CollectionPrimer, 'name' | 'sequence' | 'notes'>>;

export class PrimerCollectionStore {
  private state: PrimerCollectionState = { primers: [], status: 'unloaded', error: null };
  private readonly listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;

  constructor(private readonly repo: () => DocumentRepository = getRepository) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): PrimerCollectionState => this.state;

  private set(patch: Partial<PrimerCollectionState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Reads the stored collection, once; later calls wait for the same read. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      this.set({ status: 'loading' });
      try {
        const stored = await this.repo().loadPrimers();
        // Anything added while the read was under way goes after what was stored.
        this.set({ primers: [...stored, ...this.state.primers], status: 'ready' });
      } catch {
        this.set({ status: 'failed' });
      }
    })();
    return this.loading;
  }

  /** Writes to IndexedDB, saying so in the state when it fails rather than throwing. */
  private async write(what: string, run: () => Promise<void>): Promise<void> {
    if (this.state.status === 'failed') return;
    try {
      await run();
      if (this.state.error !== null) this.set({ error: null });
    } catch (e) {
      this.set({ error: `Could not save ${what}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /**
   * Adds primers, after the stored ones are in so that a primer already kept
   * is recognised. Names are filled in and duplicates left out
   * (`preparePrimers`).
   */
  async add(drafts: readonly PrimerDraft[]): Promise<AddReport> {
    await this.load();
    const { ready, duplicates, empty } = preparePrimers(this.state.primers, drafts);
    const added = ready.map((d) => ({ ...d, id: newId() }));
    if (added.length > 0) {
      this.set({ primers: [...this.state.primers, ...added] });
      await this.write('the primers', () => this.repo().putPrimers(added));
    }
    return { added, duplicates, empty };
  }

  async update(id: string, patch: PrimerPatch): Promise<void> {
    const current = this.state.primers.find((p) => p.id === id);
    if (current === undefined) return;
    const next = { ...current, ...patch };
    this.set({ primers: this.state.primers.map((p) => (p.id === id ? next : p)) });
    await this.write(next.name, () => this.repo().putPrimers([next]));
  }

  async remove(ids: readonly string[]): Promise<void> {
    const gone = new Set(ids);
    this.set({ primers: this.state.primers.filter((p) => !gone.has(p.id)) });
    await this.write('the collection', () => this.repo().deletePrimers(ids));
  }

  dismissError(): void {
    if (this.state.error !== null) this.set({ error: null });
  }
}

export const primerCollection = new PrimerCollectionStore();

/** Where a primer came into the collection from, for the usage statistics: never what it was. */
export type PrimerSource = 'design' | 'check' | 'feature' | 'paste' | 'file' | 'form' | 'document';

/** Adds primers to the collection from anywhere in the app, and says what came of it. */
export function savePrimers(
  drafts: readonly PrimerDraft[],
  source: PrimerSource,
  store: PrimerCollectionStore = primerCollection,
): Promise<AddReport> {
  analytics.track('primers', 'collection-add', source);
  return store.add(drafts);
}

/** The collection, read from IndexedDB on first use. */
export function usePrimerCollection(
  store: PrimerCollectionStore = primerCollection,
): PrimerCollectionState {
  useEffect(() => {
    void store.load();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
