import { recallPanel, rememberPanel } from './state/panelMemory';
import { editorStore } from './state/editorStore';

/**
 * Handing a primer of the collection to PCR (#64). The PCR panel keeps what
 * was typed into it per document (`panelMemory`), and is not mounted while
 * the Primers tab is, so the primer is written where the panel will read it
 * the next time it is shown: the bases in the slot, the primer's name beside
 * them, and the template set back to the document in front, which is the
 * one the primer was found on.
 */
export type PcrSlot = 'forward' | 'reverse';

export interface PcrChoice {
  readonly name: string;
  readonly sequence: string;
}

export function sendToPcr(
  documentId: string | null,
  slot: PcrSlot,
  primer: { readonly name: string; readonly sequence: string },
): void {
  rememberPanel(`pcr.${slot}`, documentId, primer.sequence);
  rememberPanel(`pcr.${slot}Name`, documentId, primer.name);
  rememberPanel('pcr.template', documentId, null);
  rememberPanel('pcr.shown', documentId, null);
}

/** What the PCR panel holds in a slot for a document, or null when it is empty. */
export function pcrChoice(documentId: string | null, slot: PcrSlot): PcrChoice | null {
  const sequence = recallPanel(`pcr.${slot}`, documentId, '');
  if (sequence.trim() === '') return null;
  const fallback = slot === 'forward' ? 'Forward' : 'Reverse';
  return { name: recallPanel(`pcr.${slot}Name`, documentId, fallback), sequence };
}

/** Brings the Cloning tab's PCR to the front. */
export function openPcr(): void {
  editorStore.setCloningReaction('pcr');
  editorStore.setSidebarTab('cloning');
}
