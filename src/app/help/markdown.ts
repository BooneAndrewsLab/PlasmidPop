/**
 * The small Markdown subset the user guide is written in, parsed into a
 * tree the help dialog renders. Kept deliberately narrow (headings,
 * paragraphs, lists, tables, fenced code, and inline code / bold / italic /
 * links) so the same files read well on GitHub and in the app without a
 * Markdown dependency.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly Inline[][] }
  | { readonly kind: 'code'; readonly text: string }
  | {
      readonly kind: 'table';
      readonly header: readonly Inline[][];
      readonly rows: readonly Inline[][][];
    };

const BULLET = /^[-*] (.*)$/;
const NUMBERED = /^\d+\. (.*)$/;
const HEADING = /^(#{1,3}) (.*)$/;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

/** The first `# ` heading as plain text, or null. */
export function markdownTitle(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    const m = HEADING.exec(line);
    if (m !== null && m[1] === '#') return plainText(parseInline(m[2] ?? ''));
  }
  return null;
}

export function plainText(inlines: readonly Inline[]): string {
  return inlines
    .map((i) => (i.kind === 'text' || i.kind === 'code' ? i.text : plainText(i.children)))
    .join('');
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      flushParagraph();
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      flushParagraph();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        code.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph();
      const level = (heading[1] ?? '#').length as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, children: parseInline(heading[2] ?? '') });
      i++;
      continue;
    }
    if (line.trimStart().startsWith('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
      flushParagraph();
      const header = splitTableRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('|')) {
        rows.push(splitTableRow(lines[i] ?? '').map(parseInline));
        i++;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    if (bullet !== null || numbered !== null) {
      flushParagraph();
      const ordered = numbered !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const m = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
        if (m !== null) {
          items.push(m[1] ?? '');
          i++;
        } else if (/^\s+\S/.test(current) && items.length > 0) {
          // Wrapped continuation of the previous item.
          items[items.length - 1] = `${items[items.length - 1] ?? ''} ${current.trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: 'list', ordered, items: items.map(parseInline) });
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return blocks;
}

/** Index of the closing `marker` after `from`, or -1. */
function findClose(text: string, marker: string, from: number): number {
  return text.indexOf(marker, from);
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') out.push({ kind: 'text', text: buffer });
    buffer = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '`') {
      const close = findClose(text, '`', i + 1);
      if (close > i) {
        flush();
        out.push({ kind: 'code', text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    } else if (text.startsWith('**', i)) {
      const close = findClose(text, '**', i + 2);
      if (close > i + 2) {
        flush();
        out.push({ kind: 'strong', children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    } else if (ch === '*' && text.charAt(i + 1) !== ' ') {
      const close = findClose(text, '*', i + 1);
      if (close > i + 1 && text.charAt(close - 1) !== ' ') {
        flush();
        out.push({ kind: 'em', children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    } else if (ch === '[') {
      const closeText = findClose(text, '](', i + 1);
      const closeHref = closeText < 0 ? -1 : findClose(text, ')', closeText + 2);
      if (closeText > i && closeHref > closeText) {
        flush();
        out.push({
          kind: 'link',
          href: text.slice(closeText + 2, closeHref),
          children: parseInline(text.slice(i + 1, closeText)),
        });
        i = closeHref + 1;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

/** Page id a relative guide link points at (`05-features.md` → `05-features`), or null. */
export function guideLinkTarget(href: string): string | null {
  const m = /^(?:\.\/)?([\w-]+)\.md(?:#.*)?$/.exec(href);
  return m === null ? null : (m[1] ?? null);
}
