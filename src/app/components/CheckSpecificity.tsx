import { type SeqDocument } from '@/core/document/seqDocument';
import { type Range } from '@/core/range/range';

import { analytics } from '../analytics';
import {
  type PrimerBlastPair,
  accessionStrand,
  primerBlastSource,
  primerBlastUrl,
  transcriptAt,
} from '../primerBlast';

interface Props {
  readonly pair: Pick<PrimerBlastPair, 'forward' | 'reverse' | 'productLength'>;
  readonly doc: SeqDocument;
  /** Where each primer binds on `doc`, to find the transcript that holds both. */
  readonly sites: readonly Range[];
  /** The forward primer binds the document's bottom strand (a cloning insert read along it). */
  readonly forwardOnBottom?: boolean;
  readonly tip: string;
}

/**
 * "Check specificity…" (#298): a plain link to Primer-BLAST, its address
 * made from the document alone. The template is the mRNA the record
 * annotates around the pair when one holds both primers, else the record's
 * own accession (a chromosome, say), so the result says which gene the pair
 * targets. Primer-BLAST wants the left primer on the template's plus
 * strand, so the two swap when the template reads against the document.
 */
export function CheckSpecificity({ pair, doc, sites, forwardOnBottom = false, tip }: Props) {
  const transcript = transcriptAt(doc, sites);
  const reads = transcript !== null ? transcript.strand : accessionStrand(doc.metadata.accession);
  const swap = (reads === 'reverse') !== forwardOnBottom;
  const href = primerBlastUrl({
    ...pair,
    forward: swap ? pair.reverse : pair.forward,
    reverse: swap ? pair.forward : pair.reverse,
    ...primerBlastSource(doc.metadata),
    ...(transcript !== null ? { template: transcript.accession } : {}),
  });
  return (
    <a
      className="button button--small"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-tip={tip}
      onClick={() => {
        analytics.track('primers', 'primer-blast');
      }}
    >
      Check specificity…
    </a>
  );
}
