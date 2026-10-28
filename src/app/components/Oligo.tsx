import { type CloningPrimer } from '@/core';

/**
 * One oligo 5′→3′ with its parts told apart: padding in the muted ink and
 * lower case, the site in the cut colour, underlined and lower case, the
 * annealing part in upper case. The case carries the distinction on its
 * own; the site has a label for a reader that sees no colour.
 */
export function Oligo({ primer }: { readonly primer: CloningPrimer }) {
  const { padding, site, spacer, annealing } = primer.segments;
  return (
    <span className="oligo panel__mono">
      {padding !== '' && <span className="oligo__pad">{padding.toLowerCase()}</span>}
      <span className="oligo__site" aria-label={`${primer.enzyme} site ${site.toLowerCase()}`}>
        {site.toLowerCase()}
      </span>
      {spacer !== '' && <span className="oligo__pad">{spacer.toLowerCase()}</span>}
      <span className="oligo__ann">{annealing.toUpperCase()}</span>
    </span>
  );
}
