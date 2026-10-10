import { useEffect, useSyncExternalStore } from 'react';

import { type MyPart, type PartDraft, type PartsReport, newId, preparePartDrafts } from '@/core';
import { type DocumentRepository, getRepository } from '@/storage';

import { analytics } from '../analytics';

/**
 * My parts (#210, item 86): the user's own parts for Detect features, kept in
 * this browser's IndexedDB beside the documents and primers, a row per part.
 * Shaped like the primer collection's store (item 56): read the first time
 * something asks, written through, a failed read leaves a list that lasts
 * the session.
 */
export interface MyPartsState {
  readonly parts: readonly MyPart[];
  readonly status: 'unloaded' | 'loading' | 'ready' | 'failed';
  readonly error: string | null;
}

/** What adding a batch came to, for the panel to say. */
export interface AddPartsReport extends PartsReport {
  readonly added: readonly MyPart[];
}

export type MyPartPatch = Partial<Pick<MyPart, 'name' | 'type' | 'notes'>>;

export class MyPartsStore {
  private state: MyPartsState = { parts: [], status: 'unloaded', error: null };
  private readonly listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;

  constructor(private readonly repo: () => DocumentRepository = getRepository) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): MyPartsState => this.state;

  private set(patch: Partial<MyPartsState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  load(): Promise<void> {
    this.loading ??= (async () => {
      this.set({ status: 'loading' });
      try {
        const stored = await this.repo().loadMyParts();
        this.set({ parts: [...stored, ...this.state.parts], status: 'ready' });
      } catch {
        this.set({ status: 'failed' });
      }
    })();
    return this.loading;
  }

  private async write(what: string, run: () => Promise<void>): Promise<void> {
    if (this.state.status === 'failed') return;
    try {
      await run();
      if (this.state.error !== null) this.set({ error: null });
    } catch (e) {
      this.set({ error: `Could not save ${what}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** Adds parts once the stored ones are in; those too short, ambiguous or already kept are left out and counted. */
  async add(drafts: readonly PartDraft[]): Promise<AddPartsReport> {
    await this.load();
    const report = preparePartDrafts(this.state.parts, drafts);
    const added = report.ready.map((d) => ({ ...d, id: newId() }));
    if (added.length > 0) {
      this.set({ parts: [...this.state.parts, ...added] });
      await this.write('the parts', () => this.repo().putMyParts(added));
    }
    return { ...report, added };
  }

  async update(id: string, patch: MyPartPatch): Promise<void> {
    const current = this.state.parts.find((p) => p.id === id);
    if (current === undefined) return;
    const next: MyPart = { ...current, ...patch };
    this.set({ parts: this.state.parts.map((p) => (p.id === id ? next : p)) });
    await this.write(next.name, () => this.repo().putMyParts([next]));
  }

  async remove(ids: readonly string[]): Promise<void> {
    const gone = new Set(ids);
    this.set({ parts: this.state.parts.filter((p) => !gone.has(p.id)) });
    await this.write('the parts', () => this.repo().deleteMyParts(ids));
  }

  dismissError(): void {
    if (this.state.error !== null) this.set({ error: null });
  }
}

export const myPartsStore = new MyPartsStore();

/** Where parts came from, for the usage statistics: never what they were. */
export type MyPartsSource = 'feature' | 'file' | 'plannotate';

/** Adds parts from anywhere in the app. */
export function saveMyParts(
  drafts: readonly PartDraft[],
  source: MyPartsSource,
  store: MyPartsStore = myPartsStore,
): Promise<AddPartsReport> {
  analytics.track('parts', 'add', source);
  return store.add(drafts);
}

/** My parts, read from IndexedDB on first use. */
export function useMyParts(store: MyPartsStore = myPartsStore): MyPartsState {
  useEffect(() => {
    void store.load();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** What an add came to, as a sentence. */
export function sayAddedParts(report: AddPartsReport, lead = ''): string {
  const left: string[] = [];
  if (report.duplicates > 0) left.push(`${report.duplicates.toLocaleString()} already kept`);
  if (report.tooShort > 0) {
    left.push(`${report.tooShort.toLocaleString()} too short to find (under 12 bases)`);
  }
  if (report.ambiguous > 0) {
    left.push(`${report.ambiguous.toLocaleString()} with bases other than A, C, G, T`);
  }
  const added =
    report.added.length === 0 ? 'Nothing added' : `Added ${plural(report.added.length, 'part')}`;
  return `${lead}${added}${left.length === 0 ? '.' : `; left out: ${left.join(', ')}.`}`;
}
