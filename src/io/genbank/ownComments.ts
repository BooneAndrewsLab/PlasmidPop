import { parseDerivedComment } from './derivedComment';
import { parseEndsComment } from './endsComment';
import { parseMethylationComment } from './methylationComment';

/**
 * Whether a COMMENT line is one of ours that says something we understand:
 * the sticky ends, where the document came from, or where its DNA was grown.
 * Such a line is taken out of the comments on read and written afresh from
 * the document on save, so it never piles up.
 *
 * Understood, not just prefixed (#72): a line with our prefix that cannot
 * be read is kept as an ordinary comment both ways, so a damaged one is
 * there for the user to see and fix rather than dropped on the next save.
 */
export function isOwnComment(comment: string): boolean {
  return (
    parseEndsComment(comment) !== null ||
    parseDerivedComment(comment) !== null ||
    parseMethylationComment(comment) !== null
  );
}
