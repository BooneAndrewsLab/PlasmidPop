import { activeEnzymes, alignPairwise, findCutSites, findOrfs, setActiveEnzymeSet } from '@/core';

import { type AnalysisRequest, type AnalysisResponse, packCutSites } from './analysisProtocol';

/** Pure function so the same code runs inline where Workers are unavailable (tests). */
export function handleAnalysisRequest(req: AnalysisRequest): AnalysisResponse {
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
    }
  } catch (e) {
    return { id: req.id, kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

const scope = globalThis as {
  onmessage?: ((ev: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage?: (m: AnalysisResponse, transfer?: Transferable[]) => void;
};
if (typeof scope.postMessage === 'function' && typeof document === 'undefined') {
  scope.onmessage = (ev: MessageEvent<AnalysisRequest>) => {
    const res = handleAnalysisRequest(ev.data);
    // The packed sites are handed over rather than copied.
    if (res.kind === 'cutSites') scope.postMessage?.(res, [res.sites.data.buffer]);
    else scope.postMessage?.(res);
  };
}
