import {
  type Feature,
  type Segment,
  type Strand,
  type Topology,
  rangePieces,
  rangeSegment,
  siteSegment,
} from '@/core';

/**
 * GenBank feature location grammar (DDBJ/ENA/GenBank Feature Table §3.4.3):
 *
 *   location   := complement(location) | join(location, ...) | order(location, ...) | simple
 *   simple     := [<]a..[>]b | a | a^b | a.b
 *
 * Coordinates in the text are 1-based inclusive; our segments are 0-based
 * half-open. Remote locations (`ACCESSION:1..10`) are rejected.
 */

export class LocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationError';
  }
}

type LocNode =
  | { readonly kind: 'complement'; readonly inner: LocNode }
  | { readonly kind: 'join' | 'order'; readonly parts: readonly LocNode[] }
  | SimpleNode;

type SimpleNode =
  | {
      readonly kind: 'range';
      readonly a: number;
      readonly b: number;
      readonly partialStart: boolean;
      readonly partialEnd: boolean;
      /** `a.b` form: a single base somewhere between a and b. */
      readonly fuzzy: boolean;
    }
  | {
      readonly kind: 'point';
      readonly a: number;
      readonly partialStart: boolean;
      readonly partialEnd: boolean;
    }
  | { readonly kind: 'site'; readonly a: number; readonly b: number };

class LocationParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): LocNode {
    const node = this.parseNode();
    this.skipWs();
    if (this.pos !== this.text.length) this.fail(`unexpected "${this.text.slice(this.pos)}"`);
    return node;
  }

  private fail(reason: string): never {
    throw new LocationError(`Cannot parse location "${this.text}": ${reason}`);
  }

  private skipWs(): void {
    while (this.pos < this.text.length && /\s/.test(this.text.charAt(this.pos))) this.pos++;
  }

  private tryConsume(token: string): boolean {
    this.skipWs();
    if (this.text.startsWith(token, this.pos)) {
      this.pos += token.length;
      return true;
    }
    return false;
  }

  private expect(token: string): void {
    if (!this.tryConsume(token)) this.fail(`expected "${token}" at offset ${this.pos}`);
  }

  private parseNode(): LocNode {
    if (this.tryConsume('complement(')) {
      const inner = this.parseNode();
      this.expect(')');
      return { kind: 'complement', inner };
    }
    for (const kind of ['join', 'order'] as const) {
      if (this.tryConsume(`${kind}(`)) {
        const parts: LocNode[] = [this.parseNode()];
        while (this.tryConsume(',')) parts.push(this.parseNode());
        this.expect(')');
        return { kind, parts };
      }
    }
    this.skipWs();
    const remote = /^[A-Za-z][\w.]*:/.exec(this.text.slice(this.pos));
    if (remote !== null) this.fail('remote (cross-entry) locations are not supported');
    return this.parseSimple();
  }

  private parseNumber(): number {
    this.skipWs();
    const m = /^\d+/.exec(this.text.slice(this.pos));
    if (m === null) this.fail(`expected a number at offset ${this.pos}`);
    this.pos += m[0].length;
    return Number.parseInt(m[0], 10);
  }

  private parseSimple(): SimpleNode {
    const partialStart = this.tryConsume('<');
    const leadingGreater = !partialStart && this.tryConsume('>');
    const a = this.parseNumber();
    if (this.tryConsume('..')) {
      const partialEnd = this.tryConsume('>');
      const b = this.parseNumber();
      return { kind: 'range', a, b, partialStart, partialEnd, fuzzy: false };
    }
    if (this.tryConsume('^')) {
      return { kind: 'site', a, b: this.parseNumber() };
    }
    if (this.tryConsume('.')) {
      const b = this.parseNumber();
      return { kind: 'range', a, b, partialStart, partialEnd: false, fuzzy: true };
    }
    return { kind: 'point', a, partialStart, partialEnd: leadingGreater };
  }
}

export interface ParsedLocation {
  readonly strand: Strand;
  readonly segments: readonly Segment[];
  readonly warnings: readonly string[];
}

interface FlatPart {
  readonly node: SimpleNode;
  readonly complemented: boolean;
}

function flatten(node: LocNode, complemented: boolean, out: FlatPart[], warnings: string[]): void {
  switch (node.kind) {
    case 'complement':
      flatten(node.inner, !complemented, out, warnings);
      return;
    case 'order':
      warnings.push('order(...) location treated as join(...)');
      for (const part of node.parts) flatten(part, complemented, out, warnings);
      return;
    case 'join':
      for (const part of node.parts) flatten(part, complemented, out, warnings);
      return;
    case 'range':
    case 'point':
    case 'site':
      out.push({ node, complemented });
  }
}

function simpleToSegment(
  node: SimpleNode,
  seqLength: number,
  topology: Topology,
  warnings: string[],
): Segment {
  const check = (n: number): void => {
    if (n < 1 || n > seqLength) {
      throw new LocationError(`position ${n} is outside the sequence (1..${seqLength})`);
    }
  };
  switch (node.kind) {
    case 'point':
      check(node.a);
      return rangeSegment(node.a - 1, node.a, {
        partialStart: node.partialStart,
        partialEnd: node.partialEnd,
      });
    case 'site': {
      check(node.a);
      const wrapsToOne = node.a === seqLength && node.b === 1;
      if (node.b !== node.a + 1 && !wrapsToOne) {
        warnings.push(
          `site ${node.a}^${node.b} is not between adjacent bases; using ${node.a}^${node.a + 1}`,
        );
      }
      if (node.a === seqLength) {
        if (topology === 'circular') return siteSegment(0);
        return siteSegment(seqLength);
      }
      return siteSegment(node.a);
    }
    case 'range': {
      check(node.a);
      check(node.b);
      if (node.fuzzy)
        warnings.push(`fuzzy location ${node.a}.${node.b} treated as ${node.a}..${node.b}`);
      const opts = { partialStart: node.partialStart, partialEnd: node.partialEnd };
      if (node.b >= node.a) return rangeSegment(node.a - 1, node.b, opts);
      if (topology === 'linear') {
        throw new LocationError(
          `location ${node.a}..${node.b} spans the origin of a linear sequence`,
        );
      }
      return rangeSegment(node.a - 1, node.b + seqLength, opts);
    }
  }
}

/**
 * Joins consecutive `x..L, 1..y` pieces of a circular sequence into one
 * origin-spanning segment, which is how NCBI writes such features.
 */
function mergeOriginSpanning(segments: readonly Segment[], seqLength: number): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (
      prev?.kind === 'range' &&
      seg.kind === 'range' &&
      prev.end === seqLength &&
      seg.start === 0 &&
      seg.end <= seqLength &&
      prev.end - prev.start + seg.end <= seqLength
    ) {
      out[out.length - 1] = rangeSegment(prev.start, seqLength + seg.end, {
        partialStart: prev.partialStart,
        partialEnd: seg.partialEnd,
      });
    } else {
      out.push(seg);
    }
  }
  return out;
}

export function parseLocation(text: string, seqLength: number, topology: Topology): ParsedLocation {
  const root = new LocationParser(text).parse();
  const warnings: string[] = [];
  const parts: FlatPart[] = [];
  let strand: Strand = 'forward';
  let reverseOrder = false;

  if (root.kind === 'complement') {
    // complement(join(a..b, c..d)): parts are listed in forward order.
    strand = 'reverse';
    flatten(root.inner, false, parts, warnings);
    if (parts.some((p) => p.complemented)) {
      warnings.push('nested complement() inside complement(); inner strands ignored');
    }
  } else {
    flatten(root, false, parts, warnings);
    const complemented = parts.filter((p) => p.complemented).length;
    if (complemented === parts.length && parts.length > 0) {
      // join(complement(c..d), complement(a..b)): listed in transcript order,
      // so reverse to get forward order.
      strand = 'reverse';
      reverseOrder = true;
    } else if (complemented > 0) {
      warnings.push(
        'mixed-strand location (trans-splicing) is not supported; treated as forward strand',
      );
    }
  }

  const ordered = reverseOrder ? [...parts].reverse() : parts;
  const raw = ordered.map((p) => simpleToSegment(p.node, seqLength, topology, warnings));
  const segments = topology === 'circular' ? mergeOriginSpanning(raw, seqLength) : raw;
  return { strand, segments, warnings };
}

// ------------------------------------------------------------------ writing

function formatRangePiece(
  start: number,
  end: number,
  partialStart: boolean,
  partialEnd: boolean,
): string {
  if (end - start === 1 && !partialStart && !partialEnd) return String(end);
  return `${partialStart ? '<' : ''}${start + 1}..${partialEnd ? '>' : ''}${end}`;
}

function formatSegment(seg: Segment, seqLength: number, topology: Topology): string[] {
  if (seg.kind === 'site') {
    // GenBank cannot express a site before base 1 or after the last base of
    // a linear sequence; clamp to the nearest legal site.
    let a = seg.position;
    if (topology === 'circular' && a === 0) return [`${seqLength}^1`];
    a = Math.min(Math.max(a, 1), Math.max(seqLength - 1, 1));
    return [`${a}^${a + 1}`];
  }
  const pieces = rangePieces(seg, seqLength);
  return pieces.map((piece, i) =>
    formatRangePiece(
      piece.start,
      piece.end,
      i === 0 && seg.partialStart,
      i === pieces.length - 1 && seg.partialEnd,
    ),
  );
}

/** Location string for a feature, using `join(...)` for multi-part and origin-spanning locations. */
export function formatLocation(feature: Feature, seqLength: number, topology: Topology): string {
  const pieces = feature.segments.flatMap((seg) => formatSegment(seg, seqLength, topology));
  const body = pieces.length === 1 ? (pieces[0] ?? '') : `join(${pieces.join(',')})`;
  return feature.strand === 'reverse' ? `complement(${body})` : body;
}
