/**
 * "Check specificity…" (#298, stage a): NCBI Primer-BLAST opened in a new
 * tab with a pair's two primers already in its form, so the user runs the
 * search there. Nothing leaves the browser until the link is clicked, and
 * what leaves then is in the address: the two oligos, and nothing of the
 * template. Primer-BLAST has no documented API (NCBI documents a URL API for
 * plain BLAST alone), so the link is the one robust way in; an in-app result
 * is stage b.
 *
 * The parameter names are the form's own (`index.cgi`, checked 2026-10-27):
 * a GET with them fills the fields, which is how NCBI's own "Primer-BLAST
 * this pair" links on other pages work.
 */

const PRIMER_BLAST = 'https://www.ncbi.nlm.nih.gov/tools/primer-blast/index.cgi';

/**
 * The specificity databases the form offers, by their option values. The
 * form's default is RefSeq mRNA with Homo sapiens; a plasmid is usually
 * checked against a genome, so the caller may say which.
 */
export type PrimerBlastDatabase =
  'refseq_mrna' | 'refseq_representative_genomes' | 'refseq_rna' | 'core_nt' | 'nt';

export interface PrimerBlastPair {
  /** The forward primer, 5′ to 3′, as ordered. */
  readonly forward: string;
  /** The reverse primer, 5′ to 3′, as ordered (Primer-BLAST's "reverse primer"). */
  readonly reverse: string;
  /** An organism as NCBI's box takes it, `Escherichia coli (taxid:562)` or just a name. */
  readonly organism?: string;
  readonly database?: PrimerBlastDatabase;
}

/** What a user is told leaves the browser, on the control and in the guide. */
export const PRIMER_BLAST_SENDS =
  'Opens NCBI Primer-BLAST in a new tab with the two primer sequences in the address. Nothing else leaves the browser, and nothing until you click.';

/**
 * The link for a pair. The oligos go in upper case with everything but
 * letters dropped, as the form itself cleans them; an empty primer is left
 * out rather than sent as an empty field.
 */
export function primerBlastUrl(pair: PrimerBlastPair): string {
  const url = new URL(PRIMER_BLAST);
  const clean = (s: string): string => s.replace(/[^A-Za-z]/g, '').toUpperCase();
  const forward = clean(pair.forward);
  const reverse = clean(pair.reverse);
  if (forward !== '') url.searchParams.set('PRIMER_LEFT_INPUT', forward);
  if (reverse !== '') url.searchParams.set('PRIMER_RIGHT_INPUT', reverse);
  if (pair.database !== undefined)
    url.searchParams.set('PRIMER_SPECIFICITY_DATABASE', pair.database);
  if (pair.organism !== undefined && pair.organism.trim() !== '') {
    url.searchParams.set('ORGANISM', pair.organism.trim());
  }
  return url.toString();
}
