import {
  type DocumentMetadata,
  type Feature,
  type HeaderEntry,
  type Qualifier,
  type Reference,
  type Topology,
  SeqDocument,
  createFeature,
  createMetadata,
  createReference,
  LocationError,
  isValidSequence,
  parseLocation,
} from '@/core';

import { type ParseResult, type ParseWarning, FormatError, warning } from '../types';
import { isDerivedComment, parseDerivedComment } from './derivedComment';
import { isEndsComment, parseEndsComment } from './endsComment';

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
}

const HEADER_KEYWORD = /^([A-Z]+)(?:\s+(.*))?$/;
const SUB_KEYWORD = /^ {2,3}([A-Z]+)\s+(.*)$/;
const FEATURE_KEY = /^ {5}(\S+)\s+(\S.*)$/;
const QUALIFIER = /^\/([^=\s]+)(?:=(.*))?$/;

function countQuotes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 34) n++;
  return n;
}

function stripIndent(text: string, width: number): string {
  let i = 0;
  while (i < width && i < text.length && text.charAt(i) === ' ') i++;
  return text.slice(i);
}

function dotToEmpty(s: string): string {
  return s === '.' ? '' : s;
}

/** Splits input into records (`LOCUS` … `//`). Text before the first LOCUS is ignored. */
function splitRecords(text: string): Line[][] {
  const records: Line[][] = [];
  let current: Line[] | null = null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = { text: (lines[idx] ?? '').replace(/\s+$/, ''), number: idx + 1 };
    if (line.text.startsWith('LOCUS')) {
      if (current !== null) records.push(current);
      current = [line];
      continue;
    }
    if (current === null) continue;
    if (line.text === '//') {
      records.push(current);
      current = null;
      continue;
    }
    current.push(line);
  }
  if (current !== null) records.push(current);
  return records;
}

function parseLocus(line: Line): LocusInfo {
  const rest = line.text.slice(5).trim();
  const tokens = rest.split(/\s+/);
  const info: LocusInfo = {
    name: '',
    length: null,
    moleculeType: '',
    topology: 'linear',
    division: '',
    date: '',
  };
  const unitIdx = tokens.findIndex((t) => t === 'bp' || t === 'aa');
  if (unitIdx >= 1) {
    if (tokens[unitIdx] === 'aa')
      throw new FormatError('Protein records are not supported', line.number);
    info.name = tokens.slice(0, unitIdx - 1).join(' ');
    info.length = Number.parseInt(tokens[unitIdx - 1] ?? '', 10);
    if (Number.isNaN(info.length)) info.length = null;
  } else {
    info.name = tokens[0] ?? '';
  }
  for (const token of tokens.slice(unitIdx >= 0 ? unitIdx + 1 : 1)) {
    if (/^(linear|circular)$/i.test(token)) info.topology = token.toLowerCase() as Topology;
    else if (/^\d{2}-[A-Z]{3}-\d{4}$/i.test(token)) info.date = token.toUpperCase();
    else if (/^[A-Z]{3}$/.test(token) && info.moleculeType !== '' && info.division === '')
      info.division = token;
    else if (info.moleculeType === '' && /^[A-Za-z-]+$/.test(token)) info.moleculeType = token;
  }
  if (info.moleculeType === '') info.moleculeType = 'DNA';
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
        const ref: { -readonly [K in keyof Reference]: Reference[K] } = createReference({
          number: m === null ? meta.references.length + 1 : Number.parseInt(m[1] ?? '1', 10),
          location: m === null ? head : (m[2] ?? ''),
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
              ref.remark = value;
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

  const finishQualifier = (): void => {
    if (qualifier === null) return;
    if (qualifier.quoted && qualifier.value !== null) {
      if (!qualifier.closed) {
        warnings.push(warning(`Unterminated quoted value for /${qualifier.name}`, feature?.line));
        qualifier.value = qualifier.value.slice(1);
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
    const keyMatch = FEATURE_KEY.exec(text);
    if (keyMatch !== null && !(qualifier?.quoted === true && !qualifier.closed)) {
      finishQualifier();
      feature = {
        key: keyMatch[1] ?? '',
        location: keyMatch[2] ?? '',
        qualifiers: [],
        line: line.number,
      };
      features.push(feature);
      continue;
    }
    if (feature === null || !text.startsWith(' ')) continue;
    const body = text.trim();
    const inOpenQuote = qualifier?.quoted === true && !qualifier.closed;
    if (body.startsWith('/') && !inOpenQuote) {
      finishQualifier();
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
        closed: value === undefined || !value.startsWith('"') || countQuotes(value) % 2 === 0,
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
    if (qualifier.quoted) qualifier.closed = countQuotes(qualifier.value) % 2 === 0;
  }
  finishQualifier();
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
): string {
  let text = '';
  for (const line of lines) text += line.text.replace(/[\s\d]/g, '');
  if (text.includes('-')) {
    warnings.push(warning('Gap characters ("-") removed from sequence', startLine));
    text = text.replace(/-/g, '');
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

function parseRecord(lines: readonly Line[], warnings: ParseWarning[]): SeqDocument {
  const first = lines[0];
  if (!first?.text.startsWith('LOCUS')) {
    throw new FormatError('GenBank record must start with a LOCUS line', first?.number);
  }
  const locus = parseLocus(first);

  let featuresStart = -1;
  let originStart = -1;
  lines.forEach((line, i) => {
    if (featuresStart < 0 && line.text.startsWith('FEATURES')) featuresStart = i;
    if (originStart < 0 && line.text.startsWith('ORIGIN')) originStart = i;
  });
  const headerEnd =
    featuresStart >= 0 ? featuresStart : originStart >= 0 ? originStart : lines.length;
  const featureEnd = originStart >= 0 ? originStart : lines.length;

  const header = parseHeader(lines.slice(0, headerEnd));
  const rawFeatures =
    featuresStart >= 0
      ? parseFeatureTable(lines.slice(featuresStart + 1, featureEnd), warnings)
      : [];
  const sequence =
    originStart >= 0
      ? parseSequence(
          lines.slice(originStart + 1).filter((l) => !/^(BASE COUNT|CONTIG)/.test(l.text)),
          warnings,
          (lines[originStart]?.number ?? 0) + 1,
        )
      : '';

  if (locus.length !== null && locus.length !== sequence.length) {
    warnings.push(
      warning(
        `LOCUS says ${locus.length} bp but the sequence has ${sequence.length}; using ${sequence.length}`,
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
  // Only a line that was understood comes out of the comments: a damaged one
  // stays where it is rather than being silently swallowed.
  const metadata = {
    ...parsed,
    derivedFrom,
    comments: parsed.comments.filter(
      (c) => (ends === null || !isEndsComment(c)) && (derivedFrom === null || !isDerivedComment(c)),
    ),
  };
  const features = buildFeatures(rawFeatures, sequence.length, locus.topology, warnings);
  return SeqDocument.create({
    name: locus.name === '' ? 'Untitled' : locus.name,
    sequence,
    topology: locus.topology,
    features,
    metadata,
    ends,
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
  if (records.length === 0) throw new FormatError('No LOCUS line found; not a GenBank file');
  const warnings: ParseWarning[] = [];
  const documents = records.map((record) => parseRecord(record, warnings));
  return { format: 'genbank', documents, warnings };
}
