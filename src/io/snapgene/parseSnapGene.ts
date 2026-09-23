import {
  type DocumentMetadata,
  type Feature,
  type Qualifier,
  type Reference,
  type Segment,
  type Strand,
  type StrandEnd,
  type Topology,
  BLUNT_END,
  SeqDocument,
  createFeature,
  createMetadata,
  createReference,
  isValidSequence,
  rangeSegment,
  unrollRange,
} from '@/core';

import { type ParseResult, type ParseWarning, FormatError, warning } from '../types';
import { type XmlElement, childElements, firstChild, parseXml, stripHtml, textOf } from '../xml';

/**
 * SnapGene .dna reader.
 *
 * A file is a sequence of packets: one type byte, a 4-byte big-endian
 * length, then the payload. The packets we use:
 *
 *   0x09  cookie      "SnapGene" + version numbers (must come first)
 *   0x00  sequence    flags byte (bit 0 = circular) followed by ASCII bases
 *   0x0A  features    XML <Features><Feature><Segment/><Q><V/></Q></Feature>…
 *   0x05  primers     XML <Primers><Primer><BindingSite/></Primer>…
 *   0x06  notes       XML <Notes> with description, organism, references…
 *   0x08  properties  XML <AdditionalSequenceProperties>, whose
 *                     <UpstreamStickiness>/<DownstreamStickiness> give a
 *                     linear molecule's overhangs (see `stickyEnds`)
 *
 * Everything else (enzyme sets, history, alignments, appearance) is skipped.
 */

const COOKIE = 'SnapGene';

const Packet = {
  Sequence: 0x00,
  Primers: 0x05,
  Notes: 0x06,
  Properties: 0x08,
  Cookie: 0x09,
  Features: 0x0a,
} as const;

export function isSnapGene(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 5 + COOKIE.length || bytes[0] !== Packet.Cookie) return false;
  for (let i = 0; i < COOKIE.length; i++) if (bytes[5 + i] !== COOKIE.charCodeAt(i)) return false;
  return true;
}

interface RawPacket {
  readonly type: number;
  readonly payload: Uint8Array;
}

function readPackets(bytes: Uint8Array): RawPacket[] {
  const out: RawPacket[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (i + 5 > bytes.length) throw new FormatError('Truncated SnapGene packet header');
    const type = bytes[i] ?? 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset + i + 1, 4);
    const length = view.getUint32(0, false);
    if (i + 5 + length > bytes.length) throw new FormatError('Truncated SnapGene packet payload');
    out.push({ type, payload: bytes.subarray(i + 5, i + 5 + length) });
    i += 5 + length;
  }
  return out;
}

const utf8 = new TextDecoder('utf-8');

function parseRange(
  text: string,
  seqLength: number,
  topology: Topology,
): { start: number; end: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(text.trim());
  if (m === null) return null;
  const a = Number.parseInt(m[1] ?? '0', 10);
  const b = Number.parseInt(m[2] ?? '0', 10);
  if (a < 1 || b < 1 || a > seqLength || b > seqLength) return null;
  if (b < a && topology === 'linear') return null;
  return unrollRange(a - 1, b, seqLength);
}

function strandOf(directionality: string | undefined): Strand {
  return directionality === '2' ? 'reverse' : 'forward';
}

function qualifiersOf(feature: XmlElement): Qualifier[] {
  const out: Qualifier[] = [];
  for (const q of childElements(feature, 'Q')) {
    const name = q.attributes['name'];
    if (name === undefined) continue;
    const values = childElements(q, 'V');
    if (values.length === 0) {
      out.push({ name, value: null });
      continue;
    }
    for (const v of values) {
      const text = v.attributes['text'];
      const int = v.attributes['int'];
      const predef = v.attributes['predef'];
      let value: string | null;
      if (text !== undefined)
        value =
          predef !== undefined && name === 'db_xref'
            ? `${predef}:${stripHtml(text)}`
            : stripHtml(text);
      else if (int !== undefined) value = int;
      else if (predef !== undefined) value = predef;
      else value = null;
      if (name === 'translation' && value !== null) value = value.replace(/[,*]/g, '');
      out.push({ name, value });
    }
  }
  return out;
}

function parseFeatures(
  xml: string,
  seqLength: number,
  topology: Topology,
  warnings: ParseWarning[],
): Feature[] {
  const root = parseXml(xml);
  const out: Feature[] = [];
  for (const el of childElements(root, 'Feature')) {
    const name = el.attributes['name'] ?? '';
    const type = el.attributes['type'] ?? 'misc_feature';
    const segments: Segment[] = [];
    let color: string | undefined;
    for (const seg of childElements(el, 'Segment')) {
      if (seg.attributes['type'] === 'gap') continue;
      const r = parseRange(seg.attributes['range'] ?? '', seqLength, topology);
      if (r === null) {
        warnings.push(
          warning(
            `Feature "${name}": segment range "${seg.attributes['range'] ?? ''}" is invalid; skipped`,
          ),
        );
        continue;
      }
      segments.push(rangeSegment(r.start, r.end));
      const c = seg.attributes['color'];
      if (color === undefined && c !== undefined && /^#[0-9a-f]{6}$/i.test(c))
        color = c.toLowerCase();
    }
    if (segments.length === 0) {
      warnings.push(warning(`Feature "${name}" has no usable segments; skipped`));
      continue;
    }
    const qualifiers = qualifiersOf(el);
    if (
      color !== undefined &&
      !qualifiers.some((q) => q.name === 'note' && q.value?.includes('color:') === true)
    ) {
      qualifiers.push({ name: 'note', value: `color: ${color}` });
    }
    out.push(
      createFeature({
        name,
        type,
        strand: strandOf(el.attributes['directionality']),
        segments,
        qualifiers,
      }),
    );
  }
  return out;
}

function parsePrimers(
  xml: string,
  seqLength: number,
  topology: Topology,
  warnings: ParseWarning[],
): Feature[] {
  const root = parseXml(xml);
  const out: Feature[] = [];
  for (const primer of childElements(root, 'Primer')) {
    const name = primer.attributes['name'] ?? 'primer';
    const sequence = primer.attributes['sequence'] ?? '';
    const description = stripHtml(primer.attributes['description'] ?? '');
    const sites = childElements(primer, 'BindingSite');
    if (sites.length === 0) {
      warnings.push(warning(`Primer "${name}" has no binding site in this sequence; skipped`));
      continue;
    }
    for (const site of sites) {
      const r = parseRange(site.attributes['location'] ?? '', seqLength, topology);
      if (r === null) continue;
      const qualifiers: Qualifier[] = [];
      if (sequence !== '') qualifiers.push({ name: 'note', value: `sequence: ${sequence}` });
      if (description !== '') qualifiers.push({ name: 'note', value: description });
      out.push(
        createFeature({
          name,
          type: 'primer_bind',
          strand: site.attributes['boundStrand'] === '1' ? 'reverse' : 'forward',
          segments: [rangeSegment(r.start, r.end)],
          qualifiers,
        }),
      );
    }
  }
  return out;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2012.4.15" → "15-APR-2012" */
function genBankDateFrom(snapgeneDate: string): string {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(snapgeneDate.trim());
  if (m === null) return '';
  const month = MONTHS[Number.parseInt(m[2] ?? '1', 10) - 1];
  if (month === undefined) return '';
  return `${(m[3] ?? '1').padStart(2, '0')}-${month}-${m[1] ?? ''}`;
}

function parseNotes(xml: string): { metadata: Partial<DocumentMetadata>; name: string | null } {
  const root = parseXml(xml);
  const text = (tag: string): string => stripHtml(textOf(firstChild(root, tag)));
  const references: Reference[] = childElements(
    firstChild(root, 'References') ?? root,
    'Reference',
  ).map((ref, i) =>
    createReference({
      number: i + 1,
      authors: stripHtml(ref.attributes['authors'] ?? ''),
      title: stripHtml(ref.attributes['title'] ?? ''),
      journal: stripHtml(ref.attributes['journal'] ?? ref.attributes['journalName'] ?? ''),
      pubmed: ref.attributes['pubMedID'] ?? '',
    }),
  );
  const comments: string[] = [];
  const comment = text('Comments');
  if (comment !== '') comments.push(comment);
  const type = text('Type');
  const created = firstChild(root, 'LastModified') ?? firstChild(root, 'Created');
  const metadata: Partial<DocumentMetadata> = {
    description: text('Description'),
    accession: text('AccessionNumber'),
    organism: text('Organism'),
    source: text('Organism'),
    division: text('SequenceClass') || (type === 'Synthetic' ? 'SYN' : ''),
    date: created === undefined ? '' : genBankDateFrom(textOf(created)),
    references,
    comments,
    moleculeType: 'DNA',
  };
  const label = text('CustomMapLabel');
  return { metadata, name: label === '' ? null : label };
}

/**
 * Parses a SnapGene .dna file. `fileName` (without extension) becomes the
 * document name unless the file carries a custom map label.
 */
export function parseSnapGene(data: ArrayBuffer | Uint8Array, fileName?: string): ParseResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isSnapGene(bytes))
    throw new FormatError('Not a SnapGene .dna file (missing SnapGene cookie)');
  const warnings: ParseWarning[] = [];
  const packets = readPackets(bytes);

  const seqPacket = packets.find((p) => p.type === Packet.Sequence);
  if (seqPacket === undefined) throw new FormatError('SnapGene file has no DNA sequence packet');
  const flags = seqPacket.payload[0] ?? 0;
  const topology: Topology = (flags & 0x01) !== 0 ? 'circular' : 'linear';
  let sequence = utf8.decode(seqPacket.payload.subarray(1));
  if (!isValidSequence(sequence)) {
    const cleaned = sequence.replace(/[^ACGTURYSWKMBDHVNacgturyswkmbdhvn]/g, '');
    warnings.push(
      warning(
        `${sequence.length - cleaned.length} non-nucleotide characters removed from the sequence`,
      ),
    );
    sequence = cleaned;
  }
  const seqLength = sequence.length;

  const features: Feature[] = [];
  for (const p of packets) {
    try {
      if (p.type === Packet.Features)
        features.push(...parseFeatures(utf8.decode(p.payload), seqLength, topology, warnings));
      else if (p.type === Packet.Primers)
        features.push(...parsePrimers(utf8.decode(p.payload), seqLength, topology, warnings));
    } catch (e) {
      warnings.push(
        warning(
          `Could not read ${p.type === Packet.Features ? 'features' : 'primers'}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  let metadata: Partial<DocumentMetadata> = { moleculeType: 'DNA' };
  let name: string | null = null;
  const notes = packets.find((p) => p.type === Packet.Notes);
  if (notes !== undefined) {
    try {
      ({ metadata, name } = parseNotes(utf8.decode(notes.payload)));
    } catch (e) {
      warnings.push(warning(`Could not read notes: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  const stem =
    fileName === undefined ? null : fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  let doc = SeqDocument.create({
    name: name ?? (stem === null || stem === '' ? 'Untitled' : stem),
    sequence,
    topology,
    features,
    metadata: createMetadata(metadata),
  });
  const properties = packets.find((p) => p.type === Packet.Properties);
  if (properties !== undefined && topology === 'linear') {
    doc = stickyEnds(doc, utf8.decode(properties.payload), warnings);
  }
  return { format: 'snapgene', documents: [doc], warnings };
}

function stickiness(xml: string, tag: string): number {
  const m = new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`).exec(xml);
  return m?.[1] === undefined ? 0 : Number(m[1]);
}

/**
 * A linear molecule's overhangs, as SnapGene writes them (#9): a count of
 * single-stranded bases at each end, positive for a 5′ overhang and negative
 * for a 3′ one (every linearised TA vector it ships is -1/-1, pET151 D-TOPO
 * is 0/4). SnapGene's sequence spans both strands, so those bases are always
 * in it. Ours is the top strand alone (`core/document/ends.ts`): where the
 * top strand is the longer one — a 5′ overhang upstream, a 3′ one downstream
 * — the bases stay; where the bottom strand is, they come out of the
 * sequence, by the same delete an edit makes, and the end records them.
 */
function stickyEnds(doc: SeqDocument, xml: string, warnings: ParseWarning[]): SeqDocument {
  const up = stickiness(xml, 'UpstreamStickiness');
  const down = stickiness(xml, 'DownstreamStickiness');
  if (up === 0 && down === 0) return doc;
  const L = doc.length;
  if (Math.abs(up) + Math.abs(down) >= L) {
    warnings.push(warning('The overhangs the file gives are longer than the molecule; left out'));
    return doc;
  }
  const seq = doc.sequence.toString();
  const left: StrandEnd =
    up === 0
      ? BLUNT_END
      : { kind: up > 0 ? "5'" : "3'", overhang: seq.slice(0, Math.abs(up)), enzyme: null };
  const right: StrandEnd =
    down === 0
      ? BLUNT_END
      : { kind: down > 0 ? "5'" : "3'", overhang: seq.slice(L - Math.abs(down)), enzyme: null };
  let out = doc;
  // The end goes first so the start of the sequence is still where it was.
  if (down > 0) out = out.apply({ type: 'delete', range: { start: L - down, end: L } });
  if (up < 0) out = out.apply({ type: 'delete', range: { start: 0, end: -up } });
  return out.apply({ type: 'setEnds', ends: { left, right } });
}
