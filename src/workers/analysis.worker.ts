import {
  type FeatureLibrary,
  activeEnzymes,
  alignEitherStrand,
  alignPairwise,
  findCollectionPrimers,
  detectFeatures,
  findCutSites,
  findOrfs,
  loadFeatureLibrary,
  setActiveEnzymeSet,
} from '@/core';

import {
  type AnalysisRequest,
  type AnalysisResponse,
  type DetectedPart,
  packCutSites,
} from './analysisProtocol';

/** The feature library once loaded; Detect features loads it on first use. */
let library: FeatureLibrary | null = null;

/**
 * Pure function so the same code runs inline where Workers are unavailable
 * (tests). A long request reports how far it has got to `onProgress`.
 */
export function handleAnalysisRequest(
  req: AnalysisRequest,
  onProgress?: (fraction: number) => void,
): AnalysisResponse {
  try {
    switch (req.kind) {
      case 'setEnzymes':
        setActiveEnzymeSet(req.set);
        return { id: req.id, kind: 'setEnzymes' };
      case 'cutSites': {
        const all = activeEnzymes();
        const enzymes =
          req.enzymes === undefined
            ? all
            : all.filter((e) => req.enzymes?.includes(e.name) === true);
        return {
          id: req.id,
          kind: 'cutSites',
          sites: packCutSites(findCutSites(req.sequence, req.topology, enzymes)),
        };
      }
      case 'orfs':
        return {
          id: req.id,
          kind: 'orfs',
          orfs: findOrfs(req.sequence, req.topology, req.options),
        };
      case 'align':
        return { id: req.id, kind: 'align', alignment: alignPairwise(req.a, req.b, req.options) };
      case 'alignEitherStrand':
        return {
          id: req.id,
          kind: 'alignEitherStrand',
          result: alignEitherStrand(req.a, req.b, req.options, onProgress),
        };
      case 'findPrimers':
        return {
          id: req.id,
          kind: 'findPrimers',
          result: findCollectionPrimers(req.sequence, req.topology, req.primers, req.options),
        };
      case 'detectFeatures': {
        const lib = library;
        if (lib === null) throw new Error('The feature library is not loaded');
        const hits = detectFeatures(req.sequence, req.topology, lib, {
          ...(req.minIdentity === undefined ? {} : { minIdentity: req.minIdentity }),
          ...(onProgress === undefined ? {} : { onProgress }),
        });
        return {
          id: req.id,
          kind: 'detectFeatures',
          detections: hits.flatMap((hit) => {
            const found = lib.parts[hit.part];
            if (found === undefined) return [];
            const { sequence: _bases, protein: _protein, ...part } = found;
            return [{ hit, part: part satisfies DetectedPart }];
          }),
        };
      }
    }
  } catch (e) {
    return { id: req.id, kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * `handleAnalysisRequest`, with what a request needs loaded first: the
 * feature library, a chunk of its own fetched the first time Detect features
 * runs, so no other request waits for it.
 */
export async function handleAnalysisRequestAsync(
  req: AnalysisRequest,
  onProgress?: (fraction: number) => void,
): Promise<AnalysisResponse> {
  if (req.kind === 'detectFeatures' && library === null) {
    try {
      library = await loadFeatureLibrary();
    } catch (e) {
      return { id: req.id, kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
  return handleAnalysisRequest(req, onProgress);
}

const scope = globalThis as {
  onmessage?: ((ev: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage?: (m: AnalysisResponse, transfer?: Transferable[]) => void;
};
if (typeof scope.postMessage === 'function' && typeof document === 'undefined') {
  scope.onmessage = (ev: MessageEvent<AnalysisRequest>) => {
    const { id } = ev.data;
    void handleAnalysisRequestAsync(ev.data, (fraction) => {
      scope.postMessage?.({ id, kind: 'progress', fraction });
    }).then((res) => {
      // The packed sites are handed over rather than copied.
      if (res.kind === 'cutSites') scope.postMessage?.(res, [res.sites.data.buffer]);
      else scope.postMessage?.(res);
    });
  };
}
