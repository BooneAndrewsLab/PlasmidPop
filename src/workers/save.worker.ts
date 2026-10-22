import { writeGenBank } from '@/io';

import { type SaveRequest, type SaveResponse, documentOf } from './saveProtocol';

/**
 * The save worker (#272): writes the GenBank text of the documents an
 * autosave stores. It is a worker of its own rather than a request to the
 * analysis worker so a save never waits behind a genome's restriction scan
 * or an alignment. `handleSaveRequest` is also what runs on the calling
 * thread where `Worker` does not exist (tests), so the text is the same
 * either way.
 */
export function handleSaveRequest(req: SaveRequest): SaveResponse {
  try {
    return { id: req.id, kind: 'genbank', texts: req.docs.map((d) => writeGenBank(documentOf(d))) };
  } catch (e) {
    return { id: req.id, kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

const scope = globalThis as {
  onmessage?: ((ev: MessageEvent<SaveRequest>) => void) | null;
  postMessage?: (m: SaveResponse) => void;
};
if (typeof scope.postMessage === 'function' && typeof document === 'undefined') {
  scope.onmessage = (ev: MessageEvent<SaveRequest>) => {
    scope.postMessage?.(handleSaveRequest(ev.data));
  };
}
