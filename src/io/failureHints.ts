/**
 * Short, accurate hints for the commonest ways a GenBank or FASTA file fails
 * to read (#465). Each says what was seen, never guesses beyond it. The text
 * only goes into an error message shown to the user; the `open-failed`
 * analytics event carries the format and the failure reason and nothing else.
 */

/**
 * Set when the text is a record copied out of a JSON string, where every
 * line break is written as the two characters `\` and `n`: the whole text is
 * one line holding them, or at least half of its lines end in them (a real
 * carriage return can survive after each, as in the Teselagen
 * `pj5_00028.gb`). A real file that merely mentions `\n` is not matched.
 */
export function jsonEscapeHint(text: string): string | null {
  const lines = text.split(/\r\n?|\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  if (lines.length === 1 ? !text.includes('\\n') : !isMostlyEscaped(lines)) return null;
  return 'This looks JSON-escaped: it holds the two characters \\ and n (and maybe \\r or \\t) where the line breaks should be. Copy the record from its source as plain text, not as a JSON string.';
}

function isMostlyEscaped(lines: readonly string[]): boolean {
  return lines.filter((l) => /\\n\s*$/.test(l)).length * 2 >= lines.length;
}

/**
 * Why `bad`, the characters of a nucleotide sequence outside the IUPAC
 * alphabet (gaps and digits are removed before this is asked), may be
 * there, or '' when there is nothing sure to say. `text` is the whole input,
 * to tell a JSON-escaped record from a stray backslash.
 */
export function invalidBaseHint(bad: readonly string[], text: string): string {
  const hints: string[] = [];
  if (bad.includes('\\') && text.includes('\\n')) {
    hints.push(
      'The text holds the two characters \\ and n where line breaks should be, so the record may be JSON-escaped. Copy the record from its source as plain text.',
    );
  }
  if (bad.includes('*')) {
    hints.push('"*" is a stop codon, so this may be a protein; a DNA sequence has no "*".');
  }
  if (bad.includes('.')) {
    hints.push('"." marks a gap or a missing base in some programs; remove it or write N.');
  }
  return hints.length === 0 ? '' : ` (${hints.join(' ')})`;
}

/** The first line of `text` that is not blank, at most 20 characters of it, quoted. */
function firstLineStart(text: string): string | null {
  const line = text.split(/\r\n?|\n/).find((l) => l.trim() !== '');
  if (line === undefined) return null;
  const chars = Array.from(line.trim());
  return JSON.stringify(chars.slice(0, 20).join('') + (chars.length > 20 ? '…' : ''));
}

/**
 * What to add to "No LOCUS line found": what a GenBank record starts with,
 * how this file starts, and the cause when the start gives it away.
 */
export function noLocusHint(text: string): string {
  const start = firstLineStart(text);
  const parts = ['A GenBank record starts with a line beginning "LOCUS".'];
  if (start !== null) parts.push(`This file begins with ${start}.`);
  const first = text.trim().slice(0, 1);
  const head = text.trim().slice(0, 12);
  if (first !== '' && !/^[\x20-\x7e]/.test(first)) {
    const code = (first.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    parts.push(
      `Its first character is not printable ASCII (U+${code}); a stray invisible character before LOCUS stops it being read.`,
    );
  } else if (first === '>') {
    parts.push('That is a FASTA header; open it as FASTA, or save it as GenBank.');
  } else if (first === '@') {
    parts.push('That looks like FASTQ, which is read as FASTQ.');
  } else if (/^ID {3}\S/.test(head)) {
    parts.push('That looks like an EMBL record, which is not read; export it as GenBank.');
  } else if (/^[{[]/.test(first)) {
    parts.push('That looks like JSON, not a sequence record.');
  } else if (first === '<') {
    parts.push('That looks like XML or HTML, not a sequence record.');
  } else if (/^(FEATURES|ORIGIN)\b/m.test(text)) {
    parts.push('The file has FEATURES or ORIGIN but no LOCUS line; its start may be cut off.');
  } else if (/\bLOCUS\b/.test(text.slice(0, 4000))) {
    parts.push('LOCUS appears in the text, but not at the start of a line.');
  }
  return parts.join(' ');
}
