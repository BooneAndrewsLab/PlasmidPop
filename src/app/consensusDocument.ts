import { type Contig, SeqDocument } from '@/core';

/** The document a contig's consensus is saved as; its qualities stay when any read had them. */
export function consensusDocument(
  contig: Contig,
  name: string,
  hasQualities: boolean,
): SeqDocument {
  return SeqDocument.create({
    name,
    sequence: contig.consensus,
    topology: 'linear',
    metadata: { moleculeType: 'DNA' },
    read: hasQualities ? { qualities: Uint8Array.from(contig.qualities), trace: null } : null,
  });
}
