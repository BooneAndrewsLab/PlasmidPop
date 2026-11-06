/**
 * Search over the user guide (#409, item 138): tokenise, rank, and cut a
 * snippet. Pure and self-contained, with no imports (types excepted), because
 * the static guide ships this file to the browser as it is, types stripped
 * (`staticGuide.ts`), and the page's search box must rank exactly as the
 * dialog's does.
 */

/** The search box's placeholder in the dialog and on the static pages. */
export const SEARCH_PLACEHOLDER = 'Search the guide';

/** One searchable piece of the guide: a heading and the text under it. */
export interface Section {
  /** Page id, the file stem (`05-features`). */
  readonly page: string;
  readonly pageTitle: string;
  readonly heading: string;
  /** The heading's id in the rendered page (`headingSlug`). */
  readonly anchor: string;
  /** Plain text under the heading, up to the next one. */
  readonly text: string;
}

interface Entry extends Section {
  readonly headingTokens: readonly string[];
  readonly titleTokens: readonly string[];
  readonly bodyTokens: readonly string[];
}

export interface GuideIndex {
  readonly entries: readonly Entry[];
}

/** A piece of a section's text, with the runs to highlight as `[start, end)` offsets. */
export interface Snippet {
  readonly text: string;
  readonly marks: readonly (readonly [number, number])[];
}

export interface SearchResult {
  readonly page: string;
  readonly pageTitle: string;
  readonly heading: string;
  readonly anchor: string;
  readonly snippet: Snippet;
  readonly score: number;
}

/** A run of letters or digits; the combining marks stay with their letter. */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/** Lower case, with accents removed: `Éco` and `eco` are one word. */
function fold(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The words of a text, folded. Everything that is not a letter or a digit
 * separates, so `Ctrl+K` is `ctrl` and `k`, and `BsaI`, `H840A` and `dam`
 * stay whole.
 */
export function tokenize(text: string): string[] {
  return (text.match(WORD) ?? []).map(fold).filter((w) => w !== '');
}

export function createIndex(sections: readonly Section[]): GuideIndex {
  return {
    entries: sections.map((s) => ({
      ...s,
      headingTokens: tokenize(s.heading),
      titleTokens: tokenize(s.pageTitle),
      bodyTokens: tokenize(s.text),
    })),
  };
}

// What a query word is worth where it matches. A heading beats the page's
// title, which beats the body, however often the body says it.
const HEADING_EXACT = 10;
const HEADING_PREFIX = 8;
const TITLE_EXACT = 4;
const TITLE_PREFIX = 3;
const BODY_EXACT = 2;
const BODY_PREFIX = 1;
/** A word the body repeats counts a little more, up to this many extra hits. */
const BODY_REPEATS = 3;
const BODY_REPEAT_WEIGHT = 0.25;

function wordMatches(token: string, word: string, prefix: boolean): boolean {
  return prefix ? token.startsWith(word) : token === word;
}

/** The best a token list does for `word`: exact beats prefix; 0 when neither. */
function fieldScore(
  tokens: readonly string[],
  word: string,
  prefix: boolean,
  exact: number,
  partial: number,
): number {
  if (tokens.includes(word)) return exact;
  return prefix && tokens.some((t) => t.startsWith(word)) ? partial : 0;
}

function bodyScore(tokens: readonly string[], word: string, prefix: boolean): number {
  let exact = 0;
  let partial = 0;
  for (const t of tokens) {
    if (t === word) exact++;
    else if (prefix && t.startsWith(word)) partial++;
  }
  if (exact > 0) return BODY_EXACT + Math.min(exact - 1, BODY_REPEATS) * BODY_REPEAT_WEIGHT;
  return partial > 0 ? BODY_PREFIX + Math.min(partial - 1, BODY_REPEATS) * BODY_REPEAT_WEIGHT : 0;
}

const SNIPPET_LENGTH = 160;
/** How much text the snippet keeps before the first match. */
const SNIPPET_LEAD = 40;

/** Whether a word of the text is one the query asked for. */
function isQueryWord(raw: string, words: readonly string[]): boolean {
  const token = fold(raw);
  const last = words.length - 1;
  return words.some((w, i) => wordMatches(token, w, i === last));
}

/** The runs of `text` that are words the query asked for. */
function marksIn(text: string, words: readonly string[]): [number, number][] {
  const marks: [number, number][] = [];
  for (const m of text.matchAll(WORD)) {
    if (isQueryWord(m[0], words)) marks.push([m.index, m.index + m[0].length]);
  }
  return marks;
}

/**
 * A stretch of `text` around its first matching word (or its start, when only
 * the heading matched), cut at spaces and marked with an ellipsis where it
 * does not reach the end.
 */
function snippetOf(text: string, words: readonly string[]): Snippet {
  const first = marksIn(text, words)[0];
  let start = first === undefined ? 0 : Math.max(0, first[0] - SNIPPET_LEAD);
  // Begin on a word, not in the middle of one.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space === -1 || space >= (first?.[0] ?? 0) ? start : space + 1;
  }
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start) end = space;
  }
  const lead = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  const body = text.slice(start, end);
  const shown = `${lead}${body}${tail}`;
  return {
    text: shown,
    marks: marksIn(body, words).map(([a, b]) => [a + lead.length, b + lead.length]),
  };
}

/**
 * The sections that have every word of the query, best first. A section
 * matches a word when a token of its heading, its page's title or its text
 * is that word; the last word is still being typed, so it may be the start of
 * one. Ties keep the guide's order.
 */
export function search(index: GuideIndex, query: string, limit = 20): SearchResult[] {
  const words = tokenize(query);
  if (words.length === 0) return [];
  const lastIndex = words.length - 1;
  const hits: { entry: Entry; score: number; order: number }[] = [];
  index.entries.forEach((entry, order) => {
    let score = 0;
    for (const [i, word] of words.entries()) {
      const prefix = i === lastIndex;
      const wordScore =
        fieldScore(entry.headingTokens, word, prefix, HEADING_EXACT, HEADING_PREFIX) +
        fieldScore(entry.titleTokens, word, prefix, TITLE_EXACT, TITLE_PREFIX) +
        bodyScore(entry.bodyTokens, word, prefix);
      if (wordScore === 0) return;
      score += wordScore;
    }
    hits.push({ entry, score, order });
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, limit).map(({ entry, score }) => ({
    page: entry.page,
    pageTitle: entry.pageTitle,
    heading: entry.heading,
    anchor: entry.anchor,
    snippet: snippetOf(entry.text, words),
    score,
  }));
}

/** The index as the static pages fetch it: each page's id and title once, sections as rows. */
export interface PackedIndex {
  readonly pages: readonly (readonly [string, string])[];
  readonly sections: readonly (readonly [number, string, string, string])[];
}

export function pack(sections: readonly Section[]): PackedIndex {
  const pages: [string, string][] = [];
  const at = new Map<string, number>();
  const rows = sections.map((s): [number, string, string, string] => {
    let n = at.get(s.page);
    if (n === undefined) {
      n = pages.length;
      at.set(s.page, n);
      pages.push([s.page, s.pageTitle]);
    }
    return [n, s.heading, s.anchor, s.text];
  });
  return { pages, sections: rows };
}

export function unpack(packed: PackedIndex): Section[] {
  return packed.sections.map(([n, heading, anchor, text]) => ({
    page: packed.pages[n]?.[0] ?? '',
    pageTitle: packed.pages[n]?.[1] ?? '',
    heading,
    anchor,
    text,
  }));
}
