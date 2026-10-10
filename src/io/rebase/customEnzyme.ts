import { type Enzyme, isPalindromicSite } from '@/core';

import { MIN_SITE_BITS, readSite, siteBits } from './withrefm';

/**
 * A single enzyme typed in by hand (#217): a name and a recognition site in
 * REBASE notation. The notation is read by `readSite`, the function the
 * REBASE file import uses, so the dialog and the import cannot drift apart.
 *
 * Accepted, on top of what REBASE files carry:
 * - `G^AATTC`: the caret is the top-strand cut, the bottom is symmetric;
 * - `G^AATT_C`: the bottom-strand cut written out with `_`;
 * - `GGTCTC(1/5)`, `(10/12)CGANNNNNNTGC(12/10)`: Type IIS offsets;
 * - IUPAC codes, either case.
 */

export type CustomEnzymeResult =
  { readonly ok: true; readonly enzyme: Enzyme } | { readonly ok: false; readonly error: string };

/** Parses a name and notation into an enzyme, or says in a sentence why not. */
export function parseCustomEnzyme(name: string, notation: string): CustomEnzymeResult {
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, error: 'Give the enzyme a name.' };
  if (/[\s,]/.test(trimmed)) {
    return { ok: false, error: 'A name cannot contain spaces or commas.' };
  }
  const text = notation.replace(/\s+/g, '');
  if (text === '') {
    return { ok: false, error: 'Enter the recognition site, e.g. G^AATTC or GGTCTC(1/5).' };
  }
  // The name is left out of the read: a name that happens to be on the
  // import's padded-caret list must not borrow that entry's bottom cut.
  const read = readSite(text);
  if ('skip' in read) {
    if (read.skip === 'noSite') {
      return {
        ok: false,
        error:
          'The recognition site must be bases A, C, G, T or IUPAC codes (R, Y, S, W, K, M, B, D, H, V, N), with the cut marked.',
      };
    }
    if (read.skip === 'tooUnspecific') {
      return { ok: false, error: 'That site is too short or unspecific to cut at.' };
    }
    return {
      ok: false,
      error: text.includes('?')
        ? 'Both cut positions have to be known: no question marks.'
        : 'Mark where it cuts: a caret (G^AATTC), a caret and an underscore for the bottom strand (G^AATT_C), or offsets (GGTCTC(1/5)). A caret after N padding needs the underscore too.',
    };
  }
  if (siteBits(read.site) < MIN_SITE_BITS) {
    return { ok: false, error: 'That site is too short or unspecific to cut at.' };
  }
  return {
    ok: true,
    enzyme: {
      name: trimmed,
      site: read.site,
      cutTop: read.cutTop,
      cutBottom: read.cutBottom,
      ...(read.secondCut !== undefined ? { secondCut: read.secondCut } : {}),
      palindromic: isPalindromicSite(read.site),
      custom: true,
    },
  };
}
