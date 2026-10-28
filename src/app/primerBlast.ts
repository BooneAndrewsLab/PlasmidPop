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

import { accessionKind } from '@/io/ncbi/accession';
import { type SeqDocument } from '@/core/document/seqDocument';
import { qualifierValues } from '@/core/features/feature';
import { type Range } from '@/core/range/range';
import { ORGANISMS } from '@/io/ncbi/gene';

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
  /** A public NCBI accession to search the primers on, as the form's template. */
  readonly template?: string;
  /** The product's length on the template; sets the form's product-size range. */
  readonly productLength?: number;
}

/**
 * The transcript a pair lies in, read off the document's own annotation: an
 * `mRNA` feature with an NCBI `/transcript_id` whose exons hold every site
 * (a pair in an intron, a UTR the record does not annotate or a flank lies
 * in no transcript, and Primer-BLAST would refuse it as a template). The
 * record names each isoform, so the exact one is the template and nothing
 * is looked up. `strand` is the feature's: a reverse one reads the other
 * way round from the document.
 */
export function transcriptAt(
  doc: SeqDocument,
  sites: readonly Range[],
): { readonly accession: string; readonly strand: 'forward' | 'reverse' } | null {
  for (const f of doc.features.all()) {
    if (f.type !== 'mRNA') continue;
    const id = qualifierValues(f, 'transcript_id')[0]?.trim().toUpperCase() ?? '';
    if (accessionKind(id) !== 'nucleotide') continue;
    const inExon = (site: Range): boolean =>
      f.segments.some((s) => s.kind === 'range' && s.start <= site.start && site.end <= s.end);
    if (sites.every(inExon)) return { accession: id, strand: f.strand };
  }
  return null;
}

/**
 * Which way a record's own accession reads against the document: a region
 * NCBI cut from the other strand says `REGION: complement(…)`, and the
 * document is then the chromosome's reverse complement.
 */
export function accessionStrand(accessionLine: string): 'forward' | 'reverse' {
  return /REGION:\s*complement\(/i.test(accessionLine) ? 'reverse' : 'forward';
}

/** What a document says about itself that Primer-BLAST can use. */
export interface PrimerBlastSource {
  readonly accession: string;
  readonly version?: string;
  readonly organism: string;
}

/**
 * The template, organism and database for primers designed on a document.
 * The accession goes only when it is a real NCBI one, so a user's own
 * sequence name never leaves; the organism gets its taxid from the model
 * organisms when the name starts with theirs (strains included), and the
 * database is a genome unless the accession is a transcript.
 */
export function primerBlastSource(
  meta: PrimerBlastSource,
): Pick<PrimerBlastPair, 'template' | 'organism' | 'database'> {
  // A region record's ACCESSION line reads "NC_001142 REGION: 1..99", and VERSION may carry a GI after the id.
  const first = (line: string | undefined): string =>
    (line ?? '').trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  const versioned = first(meta.version);
  const accession = accessionKind(versioned) === 'nucleotide' ? versioned : first(meta.accession);
  const template = accessionKind(accession) === 'nucleotide' ? accession : undefined;
  const name = meta.organism.trim();
  const known = ORGANISMS.find((o) => {
    const latin = /\(([^)]+)\)/.exec(o.label)?.[1] ?? '';
    return latin !== '' && name.toLowerCase().startsWith(latin.toLowerCase());
  });
  const organism =
    known !== undefined
      ? `${/\(([^)]+)\)/.exec(known.label)?.[1] ?? name} (taxid:${known.taxId.toString()})`
      : name;
  const transcript = template !== undefined && /^(NM|NR|XM|XR)_/.test(template);
  return {
    ...(template !== undefined ? { template } : {}),
    ...(organism !== '' ? { organism } : {}),
    ...(template !== undefined || organism !== ''
      ? { database: transcript ? 'refseq_mrna' : 'refseq_representative_genomes' }
      : {}),
  };
}

/** What a user is told leaves the browser, on the control and in the guide. */
export const PRIMER_BLAST_SENDS =
  'Opens NCBI Primer-BLAST in a new tab with the two primer sequences in the address, and the template’s NCBI accession and organism when it has them. Nothing else leaves the browser, and nothing until you click.';

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
  if (pair.template !== undefined && pair.template !== '')
    url.searchParams.set('INPUT_SEQUENCE', pair.template);
  if (pair.productLength !== undefined && pair.productLength > 0) {
    // The default range is 70-1000; a longer product would find no pair at all.
    url.searchParams.set('PRIMER_PRODUCT_MIN', Math.min(70, pair.productLength).toString());
    url.searchParams.set('PRIMER_PRODUCT_MAX', Math.max(1000, pair.productLength).toString());
  }
  if (pair.database !== undefined)
    url.searchParams.set('PRIMER_SPECIFICITY_DATABASE', pair.database);
  if (pair.organism !== undefined && pair.organism.trim() !== '') {
    url.searchParams.set('ORGANISM', pair.organism.trim());
  }
  return url.toString();
}
