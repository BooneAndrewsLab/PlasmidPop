import { ENZYMES, alignPairwise, findCutSites, findOrfs } from '@/core';

import { type AnalysisRequest, type AnalysisResponse } from './analysisProtocol';

/** Pure function so the same code runs inline where Workers are unavailable (tests). */
export function handleAnalysisRequest(req: AnalysisRequest): AnalysisResponse {
  try {
    switch (req.kind) {
      case 'cutSites': {
        const enzymes =
          req.enzymes === undefined
            ? ENZYMES
            : ENZYMES.filter((e) => req.enzymes?.includes(e.name) === true);
        return {
          id: req.id,
          kind: 'cutSites',
          sites: findCutSites(req.sequence, req.topology, enzymes),
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
    }
  } catch (e) {
    return { id: req.id, kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

const scope = globalThis as {
  onmessage?: ((ev: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage?: (m: AnalysisResponse) => void;
};
if (typeof scope.postMessage === 'function' && typeof document === 'undefined') {
  scope.onmessage = (ev: MessageEvent<AnalysisRequest>) => {
    scope.postMessage?.(handleAnalysisRequest(ev.data));
  };
}
