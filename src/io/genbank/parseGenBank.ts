import {
  type DocumentMetadata,
  type Feature,
  type HeaderEntry,
  type Qualifier,
  type Reference,
  type Topology,
  type Alphabet,
  SeqDocument,
  createFeature,
  createMetadata,
  createReference,
  LocationError,
  isValidSequence,
  isValidProtein,
  parseLocation,
} from '@/core';

import { type ParseResult, type ParseWarning, FormatError, warning } from '../types';
import { parseDerivedComment } from './derivedComment';
import { parseEndsComment } from './endsComment';
import { parseMadeFromComment } from './madeFromComment';
import { parseMethylationComment } from './methylationComment';
import { parseBaseStylesComment } from './baseStylesComment';
import { isOwnComment } from './ownComments';

/**
 * Qualifiers whose value names the feature, in priority order, by feature type.
 *
 * `/gene` is only a name on the feature that *is* the gene or its transcript.
 * Anywhere else it is a cross-reference to the gene the feature sits inside,
 * so a `misc_binding` within `tet` carries `/gene="tet"` without being called
 * tet — taking it as a name puts one gene's label on every feature that
 * mentions it. `/product` outranks `/gene` on a CDS for the same reason in
 * reverse: NCBI writes a gene as a `gene` and a `CDS` over the same range,
 * and it is the CDS's own `/product` that tells the two apart.
 *
 * `label` is first everywhere: it is what an editor writes when the user
 * names a feature themselves.
 */
const TAIL_QUALIFIERS: readonly string[] = ['locus_tag', 'standard_name'];

/** Feature types whose `/gene` names them: the gene itself. */
const GENE_TYPES: readonly string[] = ['gene'];

/**
 * Feature types that are a gene's product, named by `/product` first and by
 * the gene they come from second.
 */
const PRODUCT_TYPES: readonly string[] = [
  'CDS',
  'mRNA',
  'tRNA',
  'rRNA',
  'ncRNA',
  'tmRNA',
  'misc_RNA',
  'precursor_RNA',
];

/**
 * The qualifiers that may name a feature of this type, in priority order.
 * Used by the parser to derive a name and by the writer to decide whether a
 * name needs a `/label` of its own, so the two stay in step.
 */
export function nameQualifiersFor(type: string): readonly string[] {
  if (GENE_TYPES.includes(type)) return ['label', 'gene', ...TAIL_QUALIFIERS];
  if (PRODUCT_TYPES.includes(type)) return ['label', 'product', 'gene', ...TAIL_QUALIFIERS];
  return ['label', 'product', ...TAIL_QUALIFIERS];
}

interface Line {
  readonly text: string;
  /** 1-based line number in the original input. */
  readonly number: number;
}

interface HeaderBlock {
  readonly keyword: string;
  readonly lines: string[];
  readonly subs: { readonly keyword: string; readonly lines: string[] }[];
  readonly line: number;
}

interface RawQualifier {
  readonly name: string;
  value: string | null;
  quoted: boolean;
  closed: boolean;
}

interface RawFeature {
  readonly key: string;
  location: string;
  readonly qualifiers: RawQualifier[];
  readonly line: number;
}

interface LocusInfo {
  name: string;
  length: number | null;
  moleculeType: string;
  topology: Topology;
  division: string;
  date: string;
  /** A GenPept record's LOCUS counts `aa` rather than `bp` (#66). */
  alphabet: Alphabet;
}

const HEADER_KEYWORD = /^([A-Z]+)(?:\s+(.*))?$/;
const SUB_KEYWORD = /^ {2,3}([A-Z]+)\s+(.*)$/;
const FEATURE_KEY = /^ {5}(\S+)\s+(\S.*)$/;
const QUALIFIER = /^\/([^=\s]+)(?:=(.*))?$/;
/**
 * A feature key indented with tabs (`<TAB>CDS  1..30`), as some editors write
 * it. Read as a key only when what follows the key starts like a location, so
 * an indented qualifier or a wrapped value is never taken for one (#461).
 */
const TAB_FEATURE_KEY = /^\t+([^\s/]\S*)[ \t]+(\S.*)$/;
const LOCATION_START = /^(?:[<>]?\d|[<>(]|(?:complement|join|order|bond|gap)\(|[A-Za-z][\w.]*:)/;
/** Section keywords at column 0; case-insensitive, as some tools write `features` or `origin` (#461). */
const FEATURES_LINE = /^features(?=\s|$)/i;
const ORIGIN_LINE = /^origin(?=\s|$)/i;
const CONTIG_LINE = /^contig(?=\s|$)/i;
const BASE_COUNT_LINE = /^base count(?=\s|$)/i;
/** Header keywords (upper case, so a feature key `source` is not one), used to find how far an indented record is indented. */
const HEADER_KEYWORD_LINE =
  /^(?:DEFINITION|ACCESSION|VERSION|KEYWORDS|SOURCE|REFERENCE|COMMENT|DBLINK|PRIMARY|SEGMENT|BASE COUNT)(?=\s|$)/;
/** The 0-based column where a feature's location and qualifiers start. */
const QUALIFIER_COLUMN = 21;

function countQuotes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 34) n++;
  return n;
}

/**
 * Whether a quoted value is complete: an even count of quotes that ends in
 * one. `"open "x` has an even count but no closing quote, and was once cut
 * to `open "` (#139).
 */
function isClosedQuote(value: string): boolean {
  return value.length > 1 && value.endsWith('"') && countQuotes(value) % 2 === 0;
}

/**
 * Whether a quoted value still open by its count of quotes nonetheless ends
 * the way a closed one does: in an odd run of quotes after the opening one
 * (`here"`, `escaped"""`), where an even run (`""hi""`) is an escaped quote
 * that wrapped. Biopython closes a quoted value at any line that ends in a
 * quote; this is that rule, made safe for a wrapped escape (#139).
 */
function endsLikeClosed(value: string): boolean {
  let run = 0;
  for (let i = value.length - 1; i > 0 && value.charCodeAt(i) === 34; i--) run++;
  return run % 2 === 1;
}

/**
 * Whether a line is laid out as a feature key: five spaces, the key, and the
 * location at column 22 (or one space after a key too long for that). A
 * continuation line is indented to column 22, so none can look like this.
 */
function isFeatureKeyLayout(key: string, text: string, location: string): boolean {
  const at = text.length - location.length;
  return at === QUALIFIER_COLUMN || (key.length >= QUALIFIER_COLUMN - 6 && at === key.length + 6);
}

function stripIndent(text: string, width: number): string {
  let i = 0;
  while (i < width && i < text.length && text.charAt(i) === ' ') i++;
  return text.slice(i);
}

function dotToEmpty(s: string): string {
  return s === '.' ? '' : s;
}

function indentOf(text: string): number {
  let i = 0;
  while (i < text.length && (text.charAt(i) === ' ' || text.charAt(i) === '\t')) i++;
  return i;
}

/**
 * Splits input into records (`LOCUS` … `//`). Text before the first LOCUS is
 * ignored. A LOCUS line may be indented when it opens a record, and a record
 * whose lines are all indented ends at an indented `//` (#461).
 */
function splitRecords(text: string): Line[][] {
  const records: Line[][] = [];
  let current: Line[] | null = null;
  let hasBody = false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = { text: (lines[idx] ?? '').replace(/\s+$/, ''), number: idx + 1 };
    if (
      /^LOCUS(?=\s|$)/i.test(line.text) ||
      (current === null && /^\s+LOCUS\s+\S/.test(line.text))
    ) {
      if (current !== null) records.push(current);
      current = [line];
      hasBody = false;
      continue;
    }
    if (current === null) continue;
    // An indented `//` ends only a record that has no column-0 lines of its
    // own, so a wrapped value that happens to be `//` does not end one.
    if (line.text === '//' || (!hasBody && line.text.trim() === '//')) {
      records.push(current);
      current = null;
      continue;
    }
    if (line.text.length > 0 && !/^\s/.test(line.text)) hasBody = true;
    current.push(line);
  }
  if (current !== null) records.push(current);
  return records;
}

function parseLocus(line: Line): LocusInfo {
  const rest = line.text.trim().slice(5).trim();
  const tokens = rest.split(/\s+/);
  const info: LocusInfo = {
    name: '',
    length: null,
    moleculeType: '',
    topology: 'linear',
    division: '',
    date: '',
    alphabet: 'nucleotide',
  };
  // `rc` (records/contigs) is what a WGS/TSA/TLS master record counts in
  // (#254); that number is not a sequence length, so it is not kept.
  const unitIdx = tokens.findIndex((t) => t === 'bp' || t === 'aa' || t === 'rc');
  if (unitIdx >= 1) {
    if (tokens[unitIdx] === 'aa') info.alphabet = 'protein';
    info.name = tokens.slice(0, unitIdx - 1).join(' ');
    info.length = tokens[unitIdx] === 'rc' ? null : Number.parseInt(tokens[unitIdx - 1] ?? '', 10);
    if (Number.isNaN(info.length)) info.length = null;
  } else {
    info.name = tokens[0] ?? '';
  }
  // GenPept writes no molecule type, so a protein's first three capitals are its division.
  const protein = info.alphabet === 'protein';
  for (const token of tokens.slice(unitIdx >= 0 ? unitIdx + 1 : 1)) {
    if (/^(linear|circular)$/i.test(token)) info.topology = token.toLowerCase() as Topology;
    else if (/^\d{2}-[A-Z]{3}-\d{4}$/i.test(token)) info.date = token.toUpperCase();
    else if (
      /^[A-Z]{3}$/.test(token) &&
      (info.moleculeType !== '' || protein) &&
      info.division === ''
    )
      info.division = token;
    else if (info.moleculeType === '' && /^[A-Za-z-]+$/.test(token)) info.moleculeType = token;
  }
  if (info.moleculeType === '' && !protein) info.moleculeType = 'DNA';
  // A protein is a chain with two ends, whatever the line says.
  if (protein) info.topology = 'linear';
  return info;
}

function parseHeader(lines: readonly Line[]): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  let block: HeaderBlock | null = null;
  let target: string[] | null = null;
  for (const line of lines) {
    const text = line.text;
    if (text.length === 0) continue;
    if (!text.startsWith(' ')) {
      const m = HEADER_KEYWORD.exec(text);
      if (m === null) continue;
      block = { keyword: m[1] ?? '', lines: [m[2] ?? ''], subs: [], line: line.number };
      target = block.lines;
      blocks.push(block);
      continue;
    }
    if (block === null) continue;
    const sub = SUB_KEYWORD.exec(text);
    if (sub !== null) {
      const entry = { keyword: sub[1] ?? '', lines: [sub[2] ?? ''] };
      block.subs.push(entry);
      target = entry.lines;
      continue;
    }
    target?.push(stripIndent(text, 12));
  }
  return blocks;
}

function buildMetadata(
  blocks: readonly HeaderBlock[],
  locus: LocusInfo,
  warnings: ParseWarning[],
): DocumentMetadata {
  const meta: {
    -readonly [K in keyof DocumentMetadata]: DocumentMetadata[K] extends readonly (infer U)[]
      ? U[]
      : DocumentMetadata[K];
  } = {
    ...createMetadata({
      moleculeType: locus.moleculeType,
      division: locus.division,
      date: locus.date,
    }),
    dbLinks: [],
    references: [],
    comments: [],
    extraHeaders: [],
  };
  const joined = (lines: readonly string[]): string => lines.join(' ').replace(/\s+/g, ' ').trim();

  for (const block of blocks) {
    switch (block.keyword) {
      case 'LOCUS':
        break;
      case 'DEFINITION':
        meta.description = dotToEmpty(joined(block.lines));
        break;
      case 'ACCESSION':
        meta.accession = dotToEmpty(joined(block.lines));
        break;
      case 'VERSION':
        meta.version = dotToEmpty(joined(block.lines));
        break;
      case 'KEYWORDS':
        meta.keywords = dotToEmpty(joined(block.lines).replace(/\.$/, ''));
        break;
      case 'DBLINK':
        for (const l of block.lines) if (l.trim() !== '') meta.dbLinks.push(l.trim());
        break;
      case 'SOURCE': {
        meta.source = dotToEmpty(joined(block.lines));
        const organism = block.subs.find((s) => s.keyword === 'ORGANISM');
        if (organism !== undefined) {
          meta.organism = dotToEmpty((organism.lines[0] ?? '').trim());
          meta.taxonomy = dotToEmpty(joined(organism.lines.slice(1)));
        }
        break;
      }
      case 'REFERENCE': {
        const head = joined(block.lines);
        const m = /^(\d+)\s*(.*)$/.exec(head);
        // The location is "(bases 1 to 20)", "(residues …)" or "(sites)", in
        // parentheses. A malformed line ("REFERENCE   ." in Biopython's
        // bad_origin_wrap_CDS.gb) has none: a "." is a placeholder, and other
        // loose text goes to REMARK, since written after a number it is a line
        // Biopython refuses (item 70).
        const rest = dotToEmpty((m === null ? head : (m[2] ?? '')).trim());
        const parenthesised = rest === '' || /^\(.*\)$/s.test(rest);
        if (!parenthesised) {
          warnings.push(
            warning(`REFERENCE text "${rest}" is not a location; kept in REMARK`, block.line),
          );
        }
        const ref: { -readonly [K in keyof Reference]: Reference[K] } = createReference({
          number: m === null ? meta.references.length + 1 : Number.parseInt(m[1] ?? '1', 10),
          location: parenthesised ? rest : '',
          remark: parenthesised ? '' : rest,
        });
        for (const sub of block.subs) {
          const value = joined(sub.lines);
          switch (sub.keyword) {
            case 'AUTHORS':
              ref.authors = value;
              break;
            case 'CONSRTM':
              ref.consortium = value;
              break;
            case 'TITLE':
              ref.title = value;
              break;
            case 'JOURNAL':
              ref.journal = value;
              break;
            case 'PUBMED':
              ref.pubmed = value;
              break;
            case 'REMARK':
              ref.remark = ref.remark === '' ? value : `${ref.remark} ${value}`;
              break;
            default:
              ref.remark =
                ref.remark === ''
                  ? `${sub.keyword} ${value}`
                  : `${ref.remark}\n${sub.keyword} ${value}`;
              warnings.push(
                warning(`Unknown REFERENCE field "${sub.keyword}" kept in REMARK`, block.line),
              );
          }
        }
        meta.references.push(ref);
        break;
      }
      case 'COMMENT':
        meta.comments.push(block.lines.join('\n').replace(/\s+$/, ''));
        break;
      default: {
        const lines = [...block.lines];
        for (const sub of block.subs) lines.push(`${sub.keyword} ${sub.lines.join(' ')}`);
        const entry: HeaderEntry = { keyword: block.keyword, value: lines.join('\n').trim() };
        meta.extraHeaders.push(entry);
      }
    }
  }
  return meta;
}

function parseFeatureTable(lines: readonly Line[], warnings: ParseWarning[]): RawFeature[] {
  const features: RawFeature[] = [];
  let feature: RawFeature | null = null;
  let qualifier: RawQualifier | null = null;
  const ignored: Line[] = [];

  // A quoted value with an odd count of quotes stays open over the lines
  // after it. Left open, it once swallowed every later feature (#139): a line
  // laid out as a feature key, or a qualifier after a line that ends the way
  // a closed value does, now closes it by force, as Biopython does.
  const finishQualifier = (closedBy?: { line: number; what: string }): void => {
    if (qualifier === null) return;
    if (qualifier.quoted && qualifier.value !== null) {
      if (!qualifier.closed) {
        warnings.push(
          closedBy === undefined
            ? warning(`Unterminated quoted value for /${qualifier.name}`, feature?.line)
            : warning(
                `Quoted value for /${qualifier.name} has an unescaped quote; closed it at the ${closedBy.what}`,
                closedBy.line,
              ),
        );
        const end = qualifier.value.length > 1 && qualifier.value.endsWith('"') ? -1 : undefined;
        qualifier.value = qualifier.value.slice(1, end);
      } else {
        qualifier.value = qualifier.value.slice(1, -1);
      }
      qualifier.value = qualifier.value.replace(/""/g, '"');
    }
    qualifier = null;
  };

  for (const line of lines) {
    const text = line.text;
    if (text.length === 0) continue;
    const openQuote = qualifier?.quoted === true && !qualifier.closed;
    let keyMatch = FEATURE_KEY.exec(text);
    if (keyMatch === null && !openQuote) {
      const tabbed = TAB_FEATURE_KEY.exec(text);
      if (tabbed !== null && LOCATION_START.test(tabbed[2] ?? '')) keyMatch = tabbed;
    }
    if (
      keyMatch !== null &&
      (!openQuote || isFeatureKeyLayout(keyMatch[1] ?? '', text, keyMatch[2] ?? ''))
    ) {
      finishQualifier(
        openQuote ? { line: line.number, what: `next feature (${keyMatch[1] ?? ''})` } : undefined,
      );
      feature = {
        key: keyMatch[1] ?? '',
        location: keyMatch[2] ?? '',
        qualifiers: [],
        line: line.number,
      };
      features.push(feature);
      continue;
    }
    if (feature === null) {
      ignored.push(line);
      continue;
    }
    if (!/^[ \t]/.test(text)) {
      // Only a line laid out like a feature (key, then a location) is a loss;
      // BASE COUNT, WGS, TLS and the like sit at column 0 after a table.
      const m = /^(\S+)\s+(\S.*)$/.exec(text);
      if (m !== null && !BASE_COUNT_LINE.test(text) && LOCATION_START.test(m[2] ?? '')) {
        ignored.push(line);
      }
      continue;
    }
    const body = text.trim();
    const forceClose =
      openQuote &&
      body.startsWith('/') &&
      qualifier?.value != null &&
      endsLikeClosed(qualifier.value) &&
      QUALIFIER.test(body);
    if (body.startsWith('/') && (!openQuote || forceClose)) {
      finishQualifier(
        forceClose
          ? { line: line.number, what: `next qualifier (${body.split('=')[0] ?? ''})` }
          : undefined,
      );
      const m = QUALIFIER.exec(body);
      if (m === null) {
        warnings.push(warning(`Malformed qualifier "${body}"`, line.number));
        continue;
      }
      const value = m[2];
      qualifier = {
        name: m[1] ?? '',
        value: value ?? null,
        quoted: value?.startsWith('"') ?? false,
        closed: value === undefined || !value.startsWith('"') || isClosedQuote(value),
      };
      feature.qualifiers.push(qualifier);
      continue;
    }
    if (qualifier === null) {
      feature.location += body;
      continue;
    }
    if (qualifier.value === null) {
      qualifier.value = body;
    } else {
      const separator = qualifier.name === 'translation' ? '' : ' ';
      qualifier.value += separator + body;
    }
    if (qualifier.quoted) qualifier.closed = isClosedQuote(qualifier.value);
  }
  finishQualifier();
  const firstIgnored = ignored[0];
  if (firstIgnored !== undefined) {
    warnings.push(
      warning(
        `Feature table: ${ignored.length} line${ignored.length === 1 ? ' was' : 's were'} not read: ${ignored.length === 1 ? 'it is' : 'they are'} not laid out as a feature key or a qualifier (a feature key is five spaces, the key, a space and the location; a qualifier is indented): "${firstIgnored.text.trim().slice(0, 40)}"`,
        firstIgnored.number,
      ),
    );
  }
  return features;
}

/**
 * The name a feature of this type takes from its qualifiers, or the empty
 * string when none of them names it. The writer asks the same question to
 * decide whether a name needs a `/label` written for it.
 */
export function deriveFeatureName(type: string, qualifiers: readonly Qualifier[]): string {
  for (const name of nameQualifiersFor(type)) {
    const q = qualifiers.find((x) => x.name === name && x.value !== null && x.value.trim() !== '');
    if (q?.value != null) return q.value.trim();
  }
  return '';
}

function buildFeatures(
  raw: readonly RawFeature[],
  seqLength: number,
  topology: Topology,
  warnings: ParseWarning[],
): Feature[] {
  const out: Feature[] = [];
  for (const rf of raw) {
    let parsed;
    try {
      parsed = parseLocation(rf.location, seqLength, topology);
    } catch (e) {
      if (e instanceof LocationError) {
        warnings.push(warning(`Skipped ${rf.key} feature: ${e.message}`, rf.line));
        continue;
      }
      throw e;
    }
    for (const w of parsed.warnings)
      warnings.push(warning(`${rf.key} at ${rf.location}: ${w}`, rf.line));
    const qualifiers: Qualifier[] = rf.qualifiers.map((q) => ({ name: q.name, value: q.value }));
    out.push(
      createFeature({
        type: rf.key,
        name: deriveFeatureName(rf.key, qualifiers),
        strand: parsed.strand,
        segments: parsed.segments,
        joining: parsed.joining,
        qualifiers,
      }),
    );
  }
  return out;
}

function parseSequence(
  lines: readonly Line[],
  warnings: ParseWarning[],
  startLine: number,
  alphabet: Alphabet,
): string {
  let text = '';
  for (const line of lines) text += line.text.replace(/[\s\d]/g, '');
  if (text.includes('-')) {
    warnings.push(warning('Gap characters ("-") removed from sequence', startLine));
    text = text.replace(/-/g, '');
  }
  if (alphabet === 'protein') {
    if (!isValidProtein(text)) {
      const bad = [...new Set(text.replace(/[A-Za-z*]/g, ''))];
      throw new FormatError(
        `Sequence contains characters outside the amino-acid alphabet: ${bad.map((c) => JSON.stringify(c)).join(', ')}`,
        startLine,
      );
    }
    return text;
  }
  if (!isValidSequence(text)) {
    const bad = [...new Set(text.replace(/[ACGTURYSWKMBDHVNacgturyswkmbdhvn]/g, ''))];
    throw new FormatError(
      `Sequence contains characters outside the IUPAC nucleotide alphabet: ${bad.map((c) => JSON.stringify(c)).join(', ')}`,
      startLine,
    );
  }
  return text;
}

/** Drops BASE COUNT and CONTIG lines, with CONTIG's indented continuation lines, from the lines after ORIGIN. */
function withoutContig(lines: readonly Line[]): Line[] {
  const out: Line[] = [];
  let inContig = false;
  for (const l of lines) {
    if (CONTIG_LINE.test(l.text)) {
      inContig = true;
      continue;
    }
    if (inContig && /^\s/.test(l.text) && !/^\s*\d/.test(l.text)) continue;
    inContig = false;
    if (BASE_COUNT_LINE.test(l.text)) continue;
    out.push(l);
  }
  return out;
}

/** A CON (contig) record: it lists the pieces of a sequence and holds none itself (#460). */
class ContigRecordError extends FormatError {
  constructor(line: number) {
    super(
      'This is a contig (CON) record: it lists the pieces a sequence is built from and has no sequence of its own. ' +
        'Fetch the full record instead: type its accession in the NCBI box, which asks NCBI for the record with its sequence, ' +
        'or download the full GenBank file from NCBI',
      line,
      'unsupported',
    );
  }
}

/**
 * A record whose lines are all indented but for none at column 0 (only LOCUS
 * sits there, or not even that) is read with that indent taken off, so its
 * `FEATURES`, `ORIGIN` and header keywords are found (#461). The indent is
 * that of the least-indented keyword line; a record with any other line at
 * column 0 is left as it is, since its indentation then means something.
 */
function withoutRecordIndent(lines: readonly Line[]): Line[] {
  const [first, ...rest] = lines;
  if (first === undefined) return [];
  const locus = { ...first, text: first.text.trim() };
  if (rest.some((l) => l.text.length > 0 && !/^\s/.test(l.text))) return [locus, ...rest];
  let indent = Infinity;
  for (const l of rest) {
    const t = l.text.trim();
    if (
      FEATURES_LINE.test(t) ||
      ORIGIN_LINE.test(t) ||
      CONTIG_LINE.test(t) ||
      HEADER_KEYWORD_LINE.test(t)
    ) {
      indent = Math.min(indent, indentOf(l.text));
    }
  }
  if (!Number.isFinite(indent) || indent === 0) return [locus, ...rest];
  return [
    locus,
    ...rest.map((l) => ({ ...l, text: l.text.slice(Math.min(indent, indentOf(l.text))) })),
  ];
}

function parseRecord(recordLines: readonly Line[], warnings: ParseWarning[]): SeqDocument {
  const first = recordLines[0];
  if (first === undefined || !/^\s*LOCUS(?=\s|$)/i.test(first.text)) {
    throw new FormatError(
      'GenBank record must start with a LOCUS line',
      first?.number,
      'unrecognised-format',
    );
  }
  const lines = withoutRecordIndent(recordLines);
  const locus = parseLocus(first);

  let featuresStart = -1;
  let originStart = -1;
  let contigStart = -1;
  lines.forEach((line, i) => {
    if (i === 0) return;
    if (featuresStart < 0 && FEATURES_LINE.test(line.text)) featuresStart = i;
    if (originStart < 0 && ORIGIN_LINE.test(line.text)) originStart = i;
    if (contigStart < 0 && featuresStart >= 0 && CONTIG_LINE.test(line.text)) contigStart = i;
  });
  const hasContig = lines.some((l, i) => i > 0 && CONTIG_LINE.test(l.text));
  if (originStart < 0 && hasContig && locus.length !== null) {
    // A CON record counts its length in bp/aa but lists pieces instead of
    // bases; a master record (`rc`) is handled further down. Refused before
    // its features are read, so none of them warns.
    throw new ContigRecordError(first.number);
  }
  // Lines laid out as features (key and location at column 22) with no
  // FEATURES line above them: the table is not read, and the header must not
  // swallow them as continuation lines.
  let strayFeatures = 0;
  let strayStart = -1;
  if (featuresStart < 0) {
    const stop = originStart >= 0 ? originStart : lines.length;
    for (let i = 1; i < stop; i++) {
      const text = lines[i]?.text ?? '';
      const m = FEATURE_KEY.exec(text);
      if (m !== null && isFeatureKeyLayout(m[1] ?? '', text, m[2] ?? '')) {
        strayFeatures++;
        if (strayStart < 0) strayStart = i;
      }
    }
  }
  const headerEnd =
    featuresStart >= 0
      ? featuresStart
      : strayStart >= 0
        ? strayStart
        : originStart >= 0
          ? originStart
          : lines.length;
  // The feature table ends at ORIGIN or at a CONTIG line, whichever comes
  // first; CONTIG's indented continuation lines are not qualifier text (#460).
  const featureEnd = Math.min(
    originStart >= 0 ? originStart : lines.length,
    contigStart >= 0 ? contigStart : lines.length,
  );

  const header = parseHeader(lines.slice(0, headerEnd));
  if (strayFeatures > 0) {
    warnings.push(
      warning(
        `Feature table: no FEATURES line found, so ${strayFeatures} line${strayFeatures === 1 ? '' : 's'} laid out as features (the first at line ${lines[strayStart]?.number ?? '?'}) were not read; a feature table starts with a line "FEATURES             Location/Qualifiers"`,
        lines[strayStart]?.number,
      ),
    );
  }
  const rawFeatures =
    featuresStart >= 0
      ? parseFeatureTable(lines.slice(featuresStart + 1, featureEnd), warnings)
      : [];
  const sequence =
    originStart >= 0
      ? parseSequence(
          withoutContig(lines.slice(originStart + 1)),
          warnings,
          (lines[originStart]?.number ?? 0) + 1,
          locus.alphabet,
        )
      : '';

  if (originStart < 0 && hasContig) {
    warnings.push(
      warning(
        'Master record (CONTIG, no ORIGIN) has no sequence; it opens empty and the CONTIG line is not kept',
        first.number,
      ),
    );
  } else if (originStart < 0 && /\brc\b/.test(first.text)) {
    // A WGS/TSA/TLS master record counts `rc` and holds no sequence (#254).
    warnings.push(
      warning(
        'Sequence: a master record (counted in rc) has no sequence; it opens empty',
        first.number,
      ),
    );
  } else if (originStart < 0) {
    // A record cut short, or a file that is not a full GenBank record: say so
    // rather than open it empty without a word (#461).
    const bare = featuresStart < 0 && strayFeatures === 0;
    warnings.push(
      warning(
        bare
          ? 'Feature table and sequence: no FEATURES line and no ORIGIN line were found after the LOCUS line, so the record opens empty (is the file truncated?)'
          : 'Sequence: no ORIGIN line was found, so the record opens with no sequence (is the file truncated?)',
        first.number,
      ),
    );
  }
  if (locus.length !== null && locus.length !== sequence.length && originStart >= 0) {
    warnings.push(
      warning(
        `LOCUS says ${locus.length} ${locus.alphabet === 'protein' ? 'aa' : 'bp'} but the sequence has ${sequence.length}; using ${sequence.length}`,
        first.number,
      ),
    );
  }

  const parsed = buildMetadata(header, locus, warnings);
  // Sticky ends travel in a comment of ours; it becomes the document's ends
  // rather than staying in the comments, so writing the file back produces
  // the same line instead of a second one.
  const ends = parsed.comments.map(parseEndsComment).find((e) => e !== null) ?? null;
  // Where the document came from travels the same way (`derivedComment.ts`).
  const derivedFrom = parsed.comments.map(parseDerivedComment).find((d) => d !== null) ?? null;
  // And so does the host the DNA was grown in (`methylationComment.ts`).
  const methylation = parsed.comments.map(parseMethylationComment).find((m) => m !== null) ?? null;
  // And what it was made from, a block of lines of its own (`madeFromComment.ts`).
  const lineage = parsed.comments.map(parseMadeFromComment).find((l) => l !== null) ?? null;
  // And how runs of its bases are drawn (`baseStylesComment.ts`), as far as
  // they fit the sequence the record has.
  const styleRuns = parsed.comments.map(parseBaseStylesComment).find((s) => s !== null) ?? [];
  const styles = styleRuns.filter((r) => r.end <= sequence.length);
  if (styles.length < styleRuns.length) {
    warnings.push(
      warning('Some base styles run past the end of the sequence and were left out', first.number),
    );
  }
  // Only a line that was understood comes out of the comments: a damaged one
  // stays where it is rather than being silently swallowed.
  const metadata = {
    ...parsed,
    derivedFrom,
    lineage,
    comments: parsed.comments.filter((c) => !isOwnComment(c)),
  };
  const features = buildFeatures(rawFeatures, sequence.length, locus.topology, warnings);
  return SeqDocument.create({
    alphabet: locus.alphabet,
    name: locus.name === '' ? 'Untitled' : locus.name,
    sequence,
    topology: locus.topology,
    features,
    metadata,
    ends,
    styles,
    ...(methylation === null ? {} : { methylation }),
  });
}

/**
 * Parses one or more GenBank flat-file records. Tolerates CRLF line endings,
 * SnapGene/ApE/Benchling LOCUS variants, and missing header sections.
 * Unparseable features become warnings; an unusable record throws
 * `FormatError`.
 */
export function parseGenBank(text: string): ParseResult {
  const records = splitRecords(text);
  if (records.length === 0)
    throw new FormatError(
      'No LOCUS line found; not a GenBank file',
      undefined,
      'unrecognised-format',
    );
  const warnings: ParseWarning[] = [];
  const documents: SeqDocument[] = [];
  let contigError: ContigRecordError | null = null;
  for (const record of records) {
    try {
      documents.push(parseRecord(record, warnings));
    } catch (e) {
      if (!(e instanceof ContigRecordError)) throw e;
      // A CON record among others is left out with a warning; if nothing
      // else opens, its message is the failure.
      contigError ??= e;
      warnings.push(
        warning(
          `Record at line ${e.line ?? '?'} is a contig (CON) record with no sequence and was left out`,
          e.line,
        ),
      );
    }
  }
  if (documents.length === 0 && contigError !== null) throw contigError;
  return { format: 'genbank', documents, warnings };
}
