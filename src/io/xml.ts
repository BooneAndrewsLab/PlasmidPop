/**
 * Minimal XML reader for the machine-generated XML inside SnapGene files.
 * Handles elements, attributes, text, CDATA, comments, processing
 * instructions and character entities. It is not a validating parser and
 * does not support namespaces or DTDs; SnapGene never uses them.
 */

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}

export type XmlNode = XmlElement | string;

export class XmlError extends Error {
  constructor(message: string, offset: number) {
    super(`XML error at offset ${offset}: ${message}`);
    this.name = 'XmlError';
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: String.fromCharCode(160),
};

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

class Reader {
  pos = 0;

  constructor(readonly text: string) {}

  peek(s: string): boolean {
    return this.text.startsWith(s, this.pos);
  }

  skipWs(): void {
    while (this.pos < this.text.length && /\s/.test(this.text.charAt(this.pos))) this.pos++;
  }

  readUntil(s: string): string {
    const end = this.text.indexOf(s, this.pos);
    if (end < 0) throw new XmlError(`expected "${s}"`, this.pos);
    const out = this.text.slice(this.pos, end);
    this.pos = end + s.length;
    return out;
  }

  readName(): string {
    const m = /^[A-Za-z_:][\w:.-]*/.exec(this.text.slice(this.pos));
    if (m === null) throw new XmlError('expected a name', this.pos);
    this.pos += m[0].length;
    return m[0];
  }
}

function parseAttributes(r: Reader): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (;;) {
    r.skipWs();
    if (r.peek('/>') || r.peek('>') || r.peek('?>')) return attrs;
    const name = r.readName();
    r.skipWs();
    if (!r.peek('=')) throw new XmlError(`attribute "${name}" has no value`, r.pos);
    r.pos++;
    r.skipWs();
    const quote = r.text.charAt(r.pos);
    if (quote !== '"' && quote !== "'") throw new XmlError('attribute value must be quoted', r.pos);
    r.pos++;
    attrs[name] = decodeEntities(r.readUntil(quote));
  }
}

function parseElement(r: Reader): XmlElement {
  // r.pos is just after '<'
  const name = r.readName();
  const attributes = parseAttributes(r);
  if (r.peek('/>')) {
    r.pos += 2;
    return { name, attributes, children: [] };
  }
  if (!r.peek('>')) throw new XmlError(`malformed start tag <${name}>`, r.pos);
  r.pos++;
  const children: XmlNode[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') children.push(decodeEntities(text));
    text = '';
  };
  for (;;) {
    if (r.pos >= r.text.length) throw new XmlError(`unclosed element <${name}>`, r.pos);
    if (r.peek('</')) {
      flush();
      r.pos += 2;
      const closing = r.readName();
      if (closing !== name)
        throw new XmlError(`expected </${name}> but found </${closing}>`, r.pos);
      r.skipWs();
      if (!r.peek('>')) throw new XmlError(`malformed end tag </${name}>`, r.pos);
      r.pos++;
      return { name, attributes, children };
    }
    if (r.peek('<![CDATA[')) {
      r.pos += 9;
      text += r.readUntil(']]>').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      continue;
    }
    if (r.peek('<!--')) {
      r.pos += 4;
      r.readUntil('-->');
      continue;
    }
    if (r.peek('<?')) {
      r.pos += 2;
      r.readUntil('?>');
      continue;
    }
    if (r.peek('<')) {
      flush();
      r.pos++;
      children.push(parseElement(r));
      continue;
    }
    const next = r.text.indexOf('<', r.pos);
    const end = next < 0 ? r.text.length : next;
    text += r.text.slice(r.pos, end);
    r.pos = end;
  }
}

/** Parses a document and returns its root element. */
export function parseXml(text: string): XmlElement {
  const r = new Reader(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  for (;;) {
    r.skipWs();
    if (r.peek('<?')) {
      r.pos += 2;
      r.readUntil('?>');
    } else if (r.peek('<!--')) {
      r.pos += 4;
      r.readUntil('-->');
    } else if (r.peek('<!')) {
      r.pos += 2;
      r.readUntil('>');
    } else break;
  }
  if (!r.peek('<')) throw new XmlError('expected a root element', r.pos);
  r.pos++;
  const root = parseElement(r);
  r.skipWs();
  if (r.pos !== r.text.length) throw new XmlError('content after the root element', r.pos);
  return root;
}

export function childElements(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const c of el.children)
    if (typeof c !== 'string' && (name === undefined || c.name === name)) out.push(c);
  return out;
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return childElements(el, name)[0];
}

/** Concatenated text of an element's direct and nested text nodes. */
export function textOf(el: XmlElement | undefined): string {
  if (el === undefined) return '';
  let out = '';
  for (const c of el.children) out += typeof c === 'string' ? c : textOf(c);
  return out;
}

/** Strips SnapGene's `<html><body>…</body></html>` wrapping and any other tags from a rich-text string. */
export function stripHtml(text: string): string {
  const decoded = decodeEntities(text);
  if (!/<[a-z!/]/i.test(decoded)) return decoded.trim();
  return decodeEntities(
    decoded
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?p\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t]*\n[ \t\n]*/g, '\n')
    .trim();
}
