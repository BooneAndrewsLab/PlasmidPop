import {
  type Feature,
  type Qualifier,
  type SeqDocument,
  type Segment,
  reverseComplement,
} from '@/core';
import { newId } from '@/core/ids';
import { isRnaDocument } from '@/core/document/rna';

/**
 * SnapGene .dna, .rna and .prot writer (#204): the packets `parseSnapGene`
 * reads, in the order SnapGene 8.2 writes them (cookie, sequence, properties,
 * features, primers, notes), shaped after the files it bundles. Packets
 * SnapGene derives itself (enzyme sets, display settings, the history tree)
 * are not written; it rebuilds them on opening.
 *
 * The format is reverse-engineered, and nothing here has been opened in
 * SnapGene itself (docs/design/90-snapgene-writer.md). What is checked is
 * that our own reader and Biopython's read back what was written.
 *
 * What a SnapGene file cannot hold is returned as `losses`, one sentence
 * each, for the download dialog to show before the file is written.
 */

export type SnapGeneExtension = 'dna' | 'rna' | 'prot';

export interface SnapGeneWriteOptions {
  /** A colour (`#rrggbb`) for a feature that carries none of its own; without it such a feature is written uncoloured. */
  readonly colorOf?: (feature: Feature) => string;
  /** The file's UUID, for a test that wants the same bytes twice. */
  readonly uuid?: string;
}

export interface SnapGeneOutput {
  readonly bytes: Uint8Array;
  readonly extension: SnapGeneExtension;
  /** What the file leaves out or changes, for the person downloading it to read. */
  readonly losses: readonly string[];
}

/** The cookie's kind of sequence, and the export and import versions SnapGene 8.2 writes. */
const KIND = { dna: 1, prot: 2, rna: 7 } as const;
const EXPORT_VERSION = 15;
const IMPORT_VERSION = 19;

/** What SnapGene writes for a segment drawn in no colour; 73 of its 2,835 bundled features have it. */
const NO_COLOR = 'noColor';

/** Feature types SnapGene draws without an arrow: written without a direction when forward. */
const UNDIRECTED = new Set(['misc_feature', 'source', 'misc_structure', 'misc_difference']);

const COLOR_NOTE = /^color:\s*(#[0-9a-f]{6})$/i;
const SEQUENCE_NOTE = /^sequence: (\S+)$/;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const encoder = new TextEncoder();

function packet(type: number, payload: Uint8Array | string): Uint8Array {
  const body = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const out = new Uint8Array(5 + body.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, body.length, false);
  out.set(body, 5);
  return out;
}

/** XML cannot carry most control characters at all; drop them rather than write a file nothing reads. */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function attr(text: string): string {
  return clean(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

function body(text: string): string {
  return clean(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** "15-APR-2012" → "2012.4.15", SnapGene's date; null for anything else. */
function snapGeneDate(genBankDate: string): string | null {
  const m = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/i.exec(genBankDate.trim());
  if (m === null) return null;
  const month = MONTHS.indexOf((m[2] ?? '').toUpperCase());
  if (month < 0) return null;
  return `${m[3] ?? ''}.${month + 1}.${Number(m[1])}`;
}

/** A `.rna` is written for a linear RNA only; a circular one goes out as a `.dna`. */
function writesAsRna(doc: SeqDocument): boolean {
  return doc.topology === 'linear' && isRnaDocument(doc);
}

/** 1-based inclusive `a-b` of a feature segment; `b < a` where it crosses the origin. */
function featureRange(start: number, end: number, length: number): string {
  return `${(start % length) + 1}-${((end - 1) % length) + 1}`;
}

/** 0-based inclusive `a-b` of a primer's binding site. */
function primerRange(start: number, end: number, length: number): string {
  return `${start % length}-${(end - 1) % length}`;
}

interface Plan {
  readonly extension: SnapGeneExtension;
  readonly sequence: string;
  /** Bases the sequence gains in front of the document's own (a left 3′ overhang). */
  readonly shift: number;
  /** Bases it gains after the document's own (a right 5′ overhang). */
  readonly back: number;
  readonly upstream: number;
  readonly downstream: number;
}

/**
 * The sequence SnapGene stores and the overhangs it records. SnapGene's
 * sequence spans both strands, so the bases a 3′ overhang leaves on the
 * bottom strand are part of it: the reverse of what `stickyEnds` in the
 * reader takes out of ours.
 */
function plan(doc: SeqDocument, losses: string[]): Plan {
  const text = doc.sequence.toString();
  if (doc.isProtein)
    return { extension: 'prot', sequence: text, shift: 0, back: 0, upstream: 0, downstream: 0 };
  if (writesAsRna(doc)) {
    if (/u/i.test(text))
      losses.push('SnapGene writes an RNA with T where the RNA has U; the Us become Ts.');
    return {
      extension: 'rna',
      sequence: text.replace(/U/g, 'T').replace(/u/g, 't'),
      shift: 0,
      back: 0,
      upstream: 0,
      downstream: 0,
    };
  }
  const ends = doc.topology === 'linear' ? doc.ends : null;
  if (ends === null)
    return { extension: 'dna', sequence: text, shift: 0, back: 0, upstream: 0, downstream: 0 };
  const left = ends.left;
  const right = ends.right;
  const upstream = left.kind === 'blunt' ? 0 : (left.kind === "5'" ? 1 : -1) * left.overhang.length;
  const downstream =
    right.kind === 'blunt' ? 0 : (right.kind === "5'" ? 1 : -1) * right.overhang.length;
  const front = left.kind === "3'" ? left.overhang : '';
  const back = right.kind === "5'" ? right.overhang : '';
  if ([left, right].some((e) => e.enzyme !== null))
    losses.push('The enzymes that made the ends are not recorded; the overhangs are.');
  return {
    extension: 'dna',
    sequence: front + text + back,
    shift: front.length,
    back: back.length,
    upstream,
    downstream,
  };
}

function qualifierXml(qualifiers: readonly Qualifier[]): string {
  let out = '';
  let i = 0;
  while (i < qualifiers.length) {
    const q = qualifiers[i];
    if (q === undefined) break;
    let j = i;
    while (qualifiers[j + 1]?.name === q.name) j++;
    const values = qualifiers.slice(i, j + 1).filter((v) => v.value !== null);
    if (values.length === 0) out += `<Q name="${attr(q.name)}"/>`;
    else {
      out += `<Q name="${attr(q.name)}">`;
      for (const v of values) {
        const value = v.value ?? '';
        const numeric =
          (q.name === 'codon_start' || q.name === 'transl_table') && /^\d+$/.test(value);
        out += numeric ? `<V int="${value}"/>` : `<V text="${attr(value)}"/>`;
      }
      out += '</Q>';
    }
    i = j + 1;
  }
  return out;
}

interface PrimerSite {
  readonly location: string;
  readonly strand: 0 | 1;
  readonly bases: string;
}

interface PrimerGroup {
  readonly name: string;
  readonly sequence: string;
  readonly description: string;
  readonly sites: PrimerSite[];
}

/**
 * The feature as a primer, when SnapGene's primer list can hold all of it:
 * one run of bases, no partial ends, and nothing but the notes the reader
 * makes of a primer's own sequence and description. A primer_bind with a
 * label or other qualifiers (from a GenBank file, say) stays a feature, so
 * nothing about it is lost.
 */
function asPrimer(
  feature: Feature,
  doc: SeqDocument,
  sequence: string,
  shift: number,
): { name: string; sequence: string; description: string; site: PrimerSite } | null {
  if (feature.type !== 'primer_bind' || doc.isProtein) return null;
  const [seg, ...rest] = feature.segments;
  if (seg?.kind !== 'range' || rest.length > 0 || seg.partialStart || seg.partialEnd) return null;
  if (feature.joining !== undefined) return null;
  const notes = feature.qualifiers.filter((q) => q.name === 'note');
  if (notes.length !== feature.qualifiers.length || notes.some((n) => n.value === null))
    return null;
  const given = notes.filter((n) => SEQUENCE_NOTE.test(n.value ?? ''));
  const others = notes.filter((n) => !SEQUENCE_NOTE.test(n.value ?? ''));
  if (given.length > 1 || others.length > 1) return null;
  const length = sequence.length;
  const start = seg.start + shift;
  const end = seg.end + shift;
  const doubled = sequence + sequence;
  const top = doubled.slice(start % length, (start % length) + (end - start));
  const bases = feature.strand === 'reverse' ? reverseComplement(top) : top;
  const own = SEQUENCE_NOTE.exec(given[0]?.value ?? '')?.[1];
  return {
    name: feature.name,
    sequence: own ?? bases,
    description: others[0]?.value ?? '',
    site: {
      location: primerRange(start, end, length),
      strand: feature.strand === 'reverse' ? 1 : 0,
      bases,
    },
  };
}

function primersXml(groups: readonly PrimerGroup[]): string {
  let out = `<?xml version="1.0"?><Primers nextValidID="${groups.length}"><HybridizationParams minContinuousMatchLen="10" allowMismatch="1" minMeltingTemperature="40" showAdditionalFivePrimeMatches="1" minimumFivePrimeAnnealing="15"/>`;
  groups.forEach((g, i) => {
    out += `<Primer recentID="${i}" name="${attr(g.name)}" sequence="${attr(g.sequence)}"`;
    if (g.description !== '') out += ` description="${attr(g.description)}"`;
    out += '>';
    for (const s of g.sites)
      out +=
        `<BindingSite location="${s.location}" boundStrand="${s.strand}" annealedBases="${attr(s.bases)}">` +
        `<Component hybridizedRange="${s.location}" bases="${attr(s.bases)}"/></BindingSite>`;
    out += '</Primer>';
  });
  return out + '</Primers>\n';
}

function notesXml(doc: SeqDocument, uuid: string, losses: string[]): string {
  const m = doc.metadata;
  const protein = doc.isProtein;
  const synthetic = m.division === 'SYN';
  const lines: string[] = [
    `<UUID>${uuid}</UUID>`,
    `<Type>${synthetic ? 'Synthetic' : 'Natural'}</Type>`,
  ];
  if (m.description !== '') lines.push(`<Description>${body(m.description)}</Description>`);
  const date = snapGeneDate(m.date);
  if (date !== null) lines.push(`<LastModified UTC="0:0:0">${date}</LastModified>`);
  if (m.accession !== '') lines.push(`<AccessionNumber>${body(m.accession)}</AccessionNumber>`);
  if (m.organism !== '') lines.push(`<Organism>${body(m.organism)}</Organism>`);
  if (m.division !== '') lines.push(`<SequenceClass>${body(m.division)}</SequenceClass>`);
  if (m.comments.length > 0) lines.push(`<Comments>${body(m.comments.join('\n\n'))}</Comments>`);
  if (m.references.length > 0) {
    lines.push('<References>');
    for (const r of m.references)
      lines.push(
        `<Reference authors="${attr(r.authors)}" title="${attr(r.title)}" journal="${attr(r.journal)}"` +
          (r.pubmed === '' ? '' : ` pubMedID="${attr(r.pubmed)}"`) +
          '/>',
      );
    lines.push('</References>');
  }
  lines.push(`<CustomMapLabel>${body(doc.name)}</CustomMapLabel>`);
  lines.push('<UseCustomMapLabel>1</UseCustomMapLabel>');

  if (m.comments.length > 1)
    losses.push('The comments are joined into the one comment SnapGene has.');
  if (m.references.some((r) => r.remark !== '' || r.consortium !== '' || r.location !== ''))
    losses.push('Reference remarks, consortia and base ranges are not written.');
  if (m.keywords !== '') losses.push('GenBank keywords are not written.');
  if (m.version !== '') losses.push('The sequence version is not written.');
  if (m.taxonomy !== '') losses.push('The taxonomic lineage is not written.');
  if (m.dbLinks.length > 0) losses.push('Database links (DBLINK) are not written.');
  if (m.extraHeaders.length > 0)
    losses.push(`${m.extraHeaders.length} further GenBank header line(s) are not written.`);
  if (m.source !== '' && m.source !== m.organism)
    losses.push('The source name, where it differs from the organism, is not written.');
  if (m.derivedFrom !== null || m.lineage !== null)
    losses.push('PlasmidPop’s record of what this molecule was made from is not written.');
  if (protein && m.moleculeType !== '') losses.push('The molecule type is not written.');
  return `<Notes>\n${lines.join('\n')}\n</Notes>\n`;
}

/**
 * Writes `doc` as a SnapGene file: `.prot` for a protein, `.rna` for a
 * linear RNA, `.dna` for everything else. An empty document is refused: SnapGene
 * has no file for no bases, and Biopython reads none.
 */
export function writeSnapGene(
  doc: SeqDocument,
  options: SnapGeneWriteOptions = {},
): SnapGeneOutput {
  if (doc.length === 0) throw new RangeError('A SnapGene file needs at least one base.');
  const losses: string[] = [];
  const p = plan(doc, losses);
  const length = p.sequence.length;
  const colorOf = options.colorOf ?? (() => NO_COLOR);
  const uuid = options.uuid ?? newId();

  if (doc.read !== null)
    losses.push('The sequencing read (qualities and trace) is not written; only its bases are.');
  if (doc.styles.runs.length > 0)
    losses.push('Base colours, highlights and sizes are not written.');

  const groups: PrimerGroup[] = [];
  const featureXml: string[] = [];
  let partial = 0;
  let ordered = 0;
  const dropped: string[] = [];
  for (const feature of doc.features.all()) {
    const primer = asPrimer(feature, doc, p.sequence, p.shift);
    if (primer !== null) {
      const group = groups.find(
        (g) =>
          g.name === primer.name &&
          g.sequence === primer.sequence &&
          g.description === primer.description,
      );
      if (group === undefined) groups.push({ ...primer, sites: [primer.site] });
      else group.sites.push(primer.site);
      continue;
    }
    const ranges = feature.segments.filter(
      (s): s is Extract<Segment, { kind: 'range' }> => s.kind === 'range',
    );
    if (ranges.length === 0) {
      dropped.push(feature.name === '' ? feature.type : feature.name);
      continue;
    }
    if (ranges.length < feature.segments.length)
      losses.push(
        `Feature “${feature.name}”: a location between two bases cannot be written; the rest of it is.`,
      );
    // A feature the reader cut short at an overhang's bases (`stickyEnds`)
    // goes back to covering them: they are in SnapGene's sequence.
    let regained = 0;
    const spans = ranges.map((s, i) => {
      const first = s.partialStart && s.start === 0 && p.shift > 0;
      const last = s.partialEnd && s.end === doc.length && p.back > 0;
      // The bases come back at the end the reading starts from: the frame
      // the reader moved when it cut them off moves back too.
      if (first && feature.strand === 'forward' && i === 0) regained = p.shift;
      if (last && feature.strand === 'reverse' && i === ranges.length - 1) regained = p.back;
      return {
        start: first ? 0 : s.start + p.shift,
        end: last ? s.end + p.shift + p.back : s.end + p.shift,
      };
    });
    if (
      ranges.some(
        (s) =>
          (s.partialStart && !(s.start === 0 && p.shift > 0)) ||
          (s.partialEnd && !(s.end === doc.length && p.back > 0)),
      )
    )
      partial++;
    if (feature.joining === 'order') ordered++;

    let color: string | undefined;
    const qualifiers = feature.qualifiers
      .filter((q) => {
        const m = q.name === 'note' && q.value !== null ? COLOR_NOTE.exec(q.value) : null;
        if (m?.[1] === undefined) return true;
        color ??= m[1].toLowerCase();
        return false;
      })
      .map((q) =>
        regained > 0 && q.name === 'codon_start' && /^[123]$/.test(q.value ?? '')
          ? { name: q.name, value: String(((Number(q.value) - 1 + regained) % 3) + 1) }
          : q,
      );
    color ??= colorOf(feature);

    const cds = feature.type === 'CDS';
    const start = qualifiers.find((q) => q.name === 'codon_start')?.value;
    const frame = cds && start !== undefined && /^[123]$/.test(start ?? '') ? Number(start) : null;
    const directed = feature.strand === 'reverse' || !UNDIRECTED.has(feature.type);
    let segments = '';
    ranges.forEach((_, i) => {
      const prev = spans[i - 1];
      const s = spans[i] ?? { start: 0, end: 0 };
      // SnapGene draws the stretch between the pieces of a join as a gap
      // segment; the reader skips it, the picture needs it.
      if (prev !== undefined && prev.end < s.start) {
        segments += `<Segment range="${featureRange(prev.end, s.start, length)}" color="noColor" type="gap"/>`;
      }
      segments += `<Segment range="${featureRange(s.start, s.end, length)}" color="${color}" type="standard"${cds ? ' translated="1"' : ''}/>`;
    });
    featureXml.push(
      `<Feature recentID="${featureXml.length}" name="${attr(feature.name)}"` +
        (directed ? ` directionality="${feature.strand === 'reverse' ? 2 : 1}"` : '') +
        ` type="${attr(feature.type)}"` +
        (frame === null ? '' : ` readingFrame="${feature.strand === 'reverse' ? -frame : frame}"`) +
        ` allowSegmentOverlaps="0" consecutiveTranslationNumbering="1">${segments}${qualifierXml(qualifiers)}</Feature>`,
    );
  }
  if (dropped.length > 0)
    losses.push(
      `${dropped.length} feature(s) located between bases only are left out: ${dropped.map((d) => `“${d}”`).join(', ')}.`,
    );
  if (partial > 0) losses.push(`${partial} feature(s) lose their partial-end marks (< and >).`);
  if (ordered > 0)
    losses.push(`${ordered} feature(s) with order(…) locations are written as joined.`);

  const flags =
    (doc.topology === 'circular' ? 0x01 : 0) |
    0x02 |
    (doc.methylation.dam ? 0x04 : 0) |
    (doc.methylation.dcm ? 0x08 : 0);
  const cookie = new Uint8Array(14);
  cookie.set(encoder.encode('SnapGene'), 0);
  const view = new DataView(cookie.buffer);
  view.setUint16(8, KIND[p.extension], false);
  view.setUint16(10, EXPORT_VERSION, false);
  view.setUint16(12, IMPORT_VERSION, false);

  const sequencePayload = new Uint8Array(1 + length);
  sequencePayload[0] = p.extension === 'dna' ? flags : 0;
  sequencePayload.set(encoder.encode(p.sequence), 1);
  const sequenceType = p.extension === 'prot' ? 0x15 : p.extension === 'rna' ? 0x20 : 0x00;

  const properties =
    '<AdditionalSequenceProperties>' +
    `<UpstreamStickiness>${p.upstream}</UpstreamStickiness>` +
    `<DownstreamStickiness>${p.downstream}</DownstreamStickiness>` +
    '<UpstreamModification>Unmodified</UpstreamModification>' +
    '<DownstreamModification>Unmodified</DownstreamModification>' +
    '</AdditionalSequenceProperties>';

  const parts: Uint8Array[] = [
    packet(0x09, cookie),
    packet(sequenceType, sequencePayload),
    packet(0x08, properties),
    packet(
      0x0a,
      `<?xml version="1.0"?><Features nextValidID="${featureXml.length}">${featureXml.join('')}</Features>`,
    ),
  ];
  if (p.extension !== 'prot') parts.push(packet(0x05, primersXml(groups)));
  parts.push(packet(0x06, notesXml(doc, uuid, losses)));

  const bytes = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of parts) {
    bytes.set(x, at);
    at += x.length;
  }
  return { bytes, extension: p.extension, losses: [...new Set(losses)] };
}
