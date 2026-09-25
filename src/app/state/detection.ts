import { useSyncExternalStore } from 'react';

import {
  type Feature,
  type SeqDocument,
  duplicatesExisting,
  featureFromHit,
  hasTool,
} from '@/core';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';
import { type Detection } from '@/workers/analysisProtocol';

import { analytics } from '../analytics';
import { editorStore } from './editorStore';

/**
 * Detect features' search and its answer, per open document (item 59). The
 * answer is kept apart from the document and its history: it is an offer,
 * which becomes one undoable edit only when the user takes it.
 */
export type DetectionState =
  | {
      readonly status: 'running';
      readonly progress: number;
      readonly doc: SeqDocument;
    }
  | {
      readonly status: 'done';
      /** The version searched: the offer holds while its bases are the same. */
      readonly doc: SeqDocument;
      /** Every hit, including those already annotated; see `offered`. */
      readonly detections: readonly Detection[];
      /** Started by the setting on opening a file, not by the user. */
      readonly auto: boolean;
    }
  | { readonly status: 'error'; readonly message: string; readonly doc: SeqDocument };

/** A hit and whether the document already has it. */
export interface Offer {
  readonly detection: Detection;
  readonly duplicate: boolean;
}

/**
 * The hits of a search set against `doc` as it stands: the features it now
 * has mark the hits they duplicate. Null when `doc` no longer has the bases
 * that were searched, since the hits' positions then say nothing.
 */
export function offered(state: DetectionState, doc: SeqDocument): readonly Offer[] | null {
  if (state.status !== 'done' || !sameBases(state.doc, doc)) return null;
  const features = doc.features.all();
  return state.detections.map((detection) => ({
    detection,
    duplicate: duplicatesExisting(
      detection.hit,
      detection.part,
      features,
      doc.length,
      doc.topology,
    ),
  }));
}

function sameBases(a: SeqDocument, b: SeqDocument): boolean {
  return (
    a === b ||
    (a.topology === b.topology &&
      a.length === b.length &&
      (a.sequence === b.sequence || a.sequence.toString() === b.sequence.toString()))
  );
}

/** Features that are not a `source`: what "a file with no features" counts. */
export function hasOwnFeatures(doc: SeqDocument): boolean {
  return doc.features.all().some((f) => f.type !== 'source');
}

type Listener = () => void;

class DetectionStore {
  private states = new Map<string, DetectionState>();
  private readonly running = new Map<string, AbortController>();
  private readonly listeners = new Set<Listener>();

  constructor() {
    // A closed tab's search goes with it.
    editorStore.subscribe(() => {
      const open = new Set(editorStore.getState().documents.map((d) => d.documentId));
      for (const id of [...this.states.keys(), ...this.running.keys()]) {
        if (!open.has(id)) this.dismiss(id);
      }
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(documentId: string | null): DetectionState | null {
    return documentId === null ? null : (this.states.get(documentId) ?? null);
  }

  private set(documentId: string, state: DetectionState | null): void {
    const next = new Map(this.states);
    if (state === null) next.delete(documentId);
    else next.set(documentId, state);
    this.states = next;
    for (const l of this.listeners) l();
  }

  /**
   * Searches `doc` for the library's parts, replacing any search of that
   * document still running. `auto` says the setting started it on opening a
   * file: such a search brings the Features tab to the front when it finds
   * something, and says nothing when it does not.
   */
  async run(documentId: string, doc: SeqDocument, auto = false): Promise<void> {
    this.running.get(documentId)?.abort();
    const controller = new AbortController();
    this.running.set(documentId, controller);
    analytics.track('detect', 'run', auto ? 'open' : 'command');
    this.set(documentId, { status: 'running', progress: 0, doc });
    try {
      const detections = await analysisClient.detectFeatures(
        doc.sequence.toString(),
        doc.topology,
        editorStore.getState().detectMinIdentity,
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (this.running.get(documentId) === controller) {
              this.set(documentId, { status: 'running', progress, doc });
            }
          },
        },
      );
      if (this.running.get(documentId) !== controller) return;
      this.running.delete(documentId);
      if (auto && detections.length === 0) {
        this.set(documentId, null);
        return;
      }
      this.set(documentId, { status: 'done', doc, detections, auto });
      if (auto && editorStore.getState().documentId === documentId) {
        editorStore.setSidebarOpen(true);
        editorStore.setSidebarTab('features');
      }
    } catch (e) {
      if (this.running.get(documentId) !== controller) return;
      this.running.delete(documentId);
      if (e instanceof AnalysisCancelledError) this.set(documentId, null);
      else {
        this.set(documentId, {
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
          doc,
        });
      }
    }
  }

  /** Stops a search, or puts an answer away unused. */
  dismiss(documentId: string): void {
    const controller = this.running.get(documentId);
    this.running.delete(documentId);
    controller?.abort();
    this.set(documentId, null);
  }

  /**
   * Adds the chosen hits to the document as features, in one step to undo,
   * and puts the offer away. `all` says every hit offered was chosen, which
   * is all the usage statistics hear of it.
   */
  accept(documentId: string, chosen: readonly Detection[], all: boolean): void {
    const features: Feature[] = chosen.map((d) => featureFromHit(d.hit, d.part));
    if (features.length > 0) {
      editorStore.apply({ type: 'addFeatures', features }, undefined, documentId);
      analytics.track('detect', 'add', all ? 'all' : 'picked');
    }
    this.dismiss(documentId);
  }
}

export const detectionStore = new DetectionStore();

/** Runs Detect features on a file just opened, when the setting asks and it has none. */
export function detectOnOpen(documentId: string | null): void {
  if (documentId === null || !editorStore.getState().detectOnOpen) return;
  const doc = editorStore.documentState(documentId)?.history.present;
  if (doc === undefined || doc.length === 0 || hasOwnFeatures(doc)) return;
  if (!hasTool(doc, 'detectFeatures')) return;
  void detectionStore.run(documentId, doc, true);
}

export function useDetection(documentId: string | null): DetectionState | null {
  const get = (): DetectionState | null => detectionStore.get(documentId);
  return useSyncExternalStore(detectionStore.subscribe, get, get);
}
