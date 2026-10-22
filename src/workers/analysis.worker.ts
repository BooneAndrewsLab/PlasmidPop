import {
  type FeatureLibrary,
  type LibraryPart,
  activeEnzymes,
  alignEitherStrand,
  alignMultiple,
  alignPairwise,
  findCollectionPrimers,
  findCrisprGuides,
  detectFeatures,
  enzymeDigest,
  findCutSites,
  findOrfs,
  gcProfile,
  loadFeatureLibrary,
  moleculeChecksum,
  moleculeChecksumAsync,
  recodeSlots,
  setActiveEnzymeSet,
} from '@/core';

import {
  type AnalysisRequest,
  type AnalysisResponse,
  type DetectedPart,
  packCutSites,
  packEnzymeDigest,
} from './analysisProtocol';

/** The feature library once loaded; Detect features loads it on first use. */
let library: FeatureLibrary | null = null;

/** The last library searched with the user's parts, so an unchanged My parts is indexed once. */
let combined: { readonly key: string; readonly library: FeatureLibrary } | null = null;

/**
 * The bundled library with the user's parts (#210) ahead of it, so that when
 * a hit of theirs and a bundled one tie the user's name is the one kept.
 */
function libraryWith(
  base: FeatureLibrary,
  userParts: readonly LibraryPart[] | undefined,
): FeatureLibrary {
  if (userParts === undefined || userParts.length === 0) return base;
  const key = userParts
    .map((p) =>
      [p.name, p.type, p.sequence, p.protein ?? '', p.origin ?? '', p.note ?? ''].join('\u0000'),
    )
    .join('\u0001');
  if (
    combined?.key !== key ||
    combined.library.parts.length !== userParts.length + base.parts.length
  ) {
    combined = { key, library: { parts: [...userParts, ...base.parts] } };
  }
  return combined.library;
}

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
        const found = findCutSites(req.sequence, req.topology, enzymes);
        const sites = packCutSites(found);
        if (req.digest !== true) return { id: req.id, kind: 'cutSites', sites };
        return {
          id: req.id,
          kind: 'cutSites',
          sites,
          digest: packEnzymeDigest(enzymeDigest(found, req.sequence, req.topology), sites.enzymes),
        };
      }
      case 'orfs':
        return {
          id: req.id,
          kind: 'orfs',
          orfs: findOrfs(req.sequence, req.topology, req.options),
        };
      case 'crispr':
        return {
          id: req.id,
          kind: 'crispr',
          guides: findCrisprGuides(req.sequence, req.topology, req.nuclease, {
            ...req.options,
            ...(onProgress === undefined ? {} : { onProgress }),
          }),
        };
      case 'gcProfile':
        return {
          id: req.id,
          kind: 'gcProfile',
          profile: gcProfile(req.sequence, req.window, req.circular),
        };
      case 'recode':
        return {
          id: req.id,
          kind: 'recode',
          result: recodeSlots(req.slots, req.options),
        };
      case 'msa':
        return {
          id: req.id,
          kind: 'msa',
          alignment: alignMultiple(req.sequences, {
            ...req.options,
            ...(onProgress === undefined ? {} : { onProgress }),
          }),
        };
      case 'checksum':
        return { id: req.id, kind: 'checksum', checksum: moleculeChecksum(req.molecule) };
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
        const searched = libraryWith(lib, req.userParts);
        const hits = detectFeatures(req.sequence, req.topology, searched, {
          ...(req.minIdentity === undefined ? {} : { minIdentity: req.minIdentity }),
          ...(onProgress === undefined ? {} : { onProgress }),
        });
        return {
          id: req.id,
          kind: 'detectFeatures',
          detections: hits.flatMap((hit) => {
            const found = searched.parts[hit.part];
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
 * runs, so no other request waits for it. A checksum is taken here too, by
 * the browser's own SHA-1, which only comes asynchronously.
 */
export async function handleAnalysisRequestAsync(
  req: AnalysisRequest,
  onProgress?: (fraction: number) => void,
): Promise<AnalysisResponse> {
  // The digest by `crypto.subtle`, where the context has one (#276).
  if (req.kind === 'checksum') {
    try {
      return { id: req.id, kind: 'checksum', checksum: await moleculeChecksumAsync(req.molecule) };
    } catch (e) {
      return { id: req.id, kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
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
      // The packed sites and digest are handed over rather than copied.
      if (res.kind === 'cutSites') {
        const d = res.digest;
        scope.postMessage?.(
          res,
          d === undefined
            ? [res.sites.data.buffer]
            : [
                res.sites.data.buffer,
                d.host.buffer,
                d.lengths.buffer,
                d.offsets.buffer,
                d.counts.buffer,
              ],
        );
      } else if (res.kind === 'gcProfile') scope.postMessage?.(res, [res.profile.buffer]);
      else scope.postMessage?.(res);
    });
  };
}
