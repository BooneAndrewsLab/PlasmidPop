import { type Feature, type Reference, type SeqDocument } from '@/core';

import { formatDerivedComment, isDerivedComment } from './derivedComment';
import { formatEndsComment, isEndsComment } from './endsComment';
import { formatLocation } from './location';
import { deriveFeatureName } from './parseGenBank';

const LINE_WIDTH = 79;
const HEADER_INDENT = 12;
const QUALIFIER_INDENT = 21;

/** Qualifiers whose values GenBank writes without quotes. */
const UNQUOTED_QUALIFIERS = new Set([
  'anticodon',
  'codon_start',
  'compare',
  'direction',
  'estimated_length',
  'mod_base',
  'number',
  'rpt_type',
  'rpt_unit_range',
  'transl_except',
  'transl_table',
]);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function genBankDate(date: Date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  return `${day}-${MONTHS[date.getMonth()] ?? 'JAN'}-${date.getFullYear()}`;
}

/**
 * Word-wraps `text` into lines of at most `width` characters, breaking only
 * at spaces. A word longer than `width` is kept whole (the line overflows)
 * so that re-parsing, which joins lines with a space, restores the text.
 */
function wrapWords(text: string, width: number): string[] {
  const words = text.split(' ').filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '' || lines.length === 0) lines.push(current);
  return lines;
}

/**
 * A header entry. Free-text fields are re-wrapped at spaces (the parser
 * collapses whitespace when it joins them back). `verbatim` fields (COMMENT,
 * DBLINK, unknown keywords) keep their lines and internal spacing exactly,
 * because the parser preserves those too.
 */
function headerBlock(keyword: string, value: string, indent = '', verbatim = false): string[] {
  const label = (indent + keyword).padEnd(HEADER_INDENT);
  const out: string[] = [];
  const paragraphs = value.split('\n');
  paragraphs.forEach((paragraph) => {
    const chunks = verbatim ? [paragraph] : wrapWords(paragraph, LINE_WIDTH - HEADER_INDENT);
    for (const chunk of chunks) {
      out.push(out.length === 0 ? label + chunk : ' '.repeat(HEADER_INDENT) + chunk);
    }
  });
  if (out.length === 0) out.push(label.trimEnd());
  return out;
}

function locusLine(doc: SeqDocument): string {
  const name = (doc.name.trim() === '' ? 'Untitled' : doc.name).replace(/\s+/g, '_');
  const mol = doc.metadata.moleculeType === '' ? 'DNA' : doc.metadata.moleculeType;
  const date = doc.metadata.date === '' ? genBankDate() : doc.metadata.date;
  // The division code is optional in practice (SnapGene and ApE omit it);
  // leaving it out when unknown keeps re-parsed metadata identical.
  const tail = [doc.topology.padEnd(8), doc.metadata.division, date].filter((t) => t !== '');
  return (
    'LOCUS       ' +
    name.padEnd(16) +
    String(doc.length).padStart(12) +
    ' bp    ' +
    mol.padEnd(7) +
    ' ' +
    tail.join(' ')
  );
}

function referenceBlock(ref: Reference): string[] {
  const head = ref.location === '' ? String(ref.number) : `${ref.number}  ${ref.location}`;
  const out = headerBlock('REFERENCE', head);
  const sub = (keyword: string, value: string, indent: string): void => {
    if (value !== '') out.push(...headerBlock(keyword, value, indent));
  };
  sub('AUTHORS', ref.authors, '  ');
  sub('CONSRTM', ref.consortium, '  ');
  sub('TITLE', ref.title, '  ');
  sub('JOURNAL', ref.journal, '  ');
  sub('PUBMED', ref.pubmed, '   ');
  sub('REMARK', ref.remark, '  ');
  return out;
}

function headerLines(doc: SeqDocument): string[] {
  const m = doc.metadata;
  const dot = (s: string): string => (s === '' ? '.' : s);
  const out: string[] = [locusLine(doc)];
  out.push(...headerBlock('DEFINITION', dot(m.description)));
  out.push(...headerBlock('ACCESSION', dot(m.accession)));
  if (m.version !== '') out.push(...headerBlock('VERSION', m.version));
  if (m.dbLinks.length > 0) out.push(...headerBlock('DBLINK', m.dbLinks.join('\n'), '', true));
  out.push(...headerBlock('KEYWORDS', dot(m.keywords)));
  out.push(...headerBlock('SOURCE', dot(m.source)));
  out.push(...headerBlock('ORGANISM', dot(m.organism), '  '));
  if (m.taxonomy !== '') {
    for (const chunk of wrapWords(m.taxonomy, LINE_WIDTH - HEADER_INDENT))
      out.push(' '.repeat(HEADER_INDENT) + chunk);
  }
  for (const ref of m.references) out.push(...referenceBlock(ref));
  // The ends are not a GenBank field; they ride in a comment of our own
  // (`endsComment.ts`). Any copy that came from somewhere else is dropped, so
  // the file says what the document says and only once.
  if (doc.ends !== null) {
    out.push(...headerBlock('COMMENT', formatEndsComment(doc.ends), '', true));
  }
  // Where the document came from rides in another (`derivedComment.ts`), and
  // is treated the same way.
  if (m.derivedFrom !== null) {
    out.push(...headerBlock('COMMENT', formatDerivedComment(m.derivedFrom), '', true));
  }
  for (const comment of m.comments) {
    if (isEndsComment(comment) || isDerivedComment(comment)) continue;
    out.push(...headerBlock('COMMENT', comment, '', true));
  }
  for (const extra of m.extraHeaders)
    out.push(...headerBlock(extra.keyword, extra.value, '', true));
  return out;
}

function isUnquoted(name: string, value: string): boolean {
  return UNQUOTED_QUALIFIERS.has(name) || /^\d+$/.test(value) || /^\[\d+\]$/.test(value);
}

function qualifierLines(name: string, value: string | null): string[] {
  const indent = ' '.repeat(QUALIFIER_INDENT);
  if (value === null) return [`${indent}/${name}`];
  if (isUnquoted(name, value)) return [`${indent}/${name}=${value}`];

  const escaped = `"${value.replace(/"/g, '""')}"`;
  const width = LINE_WIDTH - QUALIFIER_INDENT;
  if (name === 'translation') {
    // Amino-acid strings have no spaces; they are hard-wrapped and re-joined
    // without a separator on parse.
    const out: string[] = [];
    const first = width - (name.length + 2);
    out.push(`${indent}/${name}=${escaped.slice(0, first)}`);
    for (let i = first; i < escaped.length; i += width)
      out.push(indent + escaped.slice(i, i + width));
    return out;
  }
  const prefix = `/${name}=`;
  const words = escaped.split(' ');
  const out: string[] = [];
  let current = prefix + (words[0] ?? '');
  for (const word of words.slice(1)) {
    if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      out.push(indent + current);
      current = word;
    }
  }
  out.push(indent + current);
  return out;
}

function locationLines(key: string, location: string): string[] {
  const label = `     ${key}`;
  const head = label.length >= QUALIFIER_INDENT ? `${label} ` : label.padEnd(QUALIFIER_INDENT);
  const width = LINE_WIDTH - QUALIFIER_INDENT;
  if (location.length <= width) return [head + location];
  // Break long join(...) locations after commas.
  const out: string[] = [];
  let current = '';
  for (const piece of location.split(/(?<=,)/)) {
    if (current !== '' && current.length + piece.length > width) {
      out.push(current);
      current = '';
    }
    current += piece;
  }
  if (current !== '') out.push(current);
  return out.map((line, i) => (i === 0 ? head + line : ' '.repeat(QUALIFIER_INDENT) + line));
}

function featureLines(feature: Feature, doc: SeqDocument): string[] {
  const out = locationLines(feature.type, formatLocation(feature, doc.length, doc.topology));
  const name = feature.name.trim();
  // A /label is needed unless reading this record back would derive the same
  // name: a misc_feature named after its /gene would not, and neither would a
  // CDS renamed to its /product while it still carries a /label of its own.
  const named = deriveFeatureName(feature.type, feature.qualifiers) === name;
  if (name !== '' && !named) out.push(...qualifierLines('label', name));
  for (const q of feature.qualifiers) out.push(...qualifierLines(q.name, q.value));
  return out;
}

function sequenceLines(doc: SeqDocument): string[] {
  const out: string[] = [];
  const text = doc.sequence.toString();
  for (let i = 0; i < text.length; i += 60) {
    const groups: string[] = [];
    for (let j = i; j < Math.min(i + 60, text.length); j += 10) groups.push(text.slice(j, j + 10));
    out.push(`${String(i + 1).padStart(9)} ${groups.join(' ')}`);
  }
  return out;
}

/** Serializes a document as a GenBank flat-file record (LF line endings, trailing newline). */
export function writeGenBank(doc: SeqDocument): string {
  const lines = headerLines(doc);
  lines.push('FEATURES             Location/Qualifiers');
  for (const feature of doc.features) lines.push(...featureLines(feature, doc));
  lines.push('ORIGIN');
  lines.push(...sequenceLines(doc));
  lines.push('//');
  return `${lines.join('\n')}\n`;
}

/** Serializes several documents into one multi-record file. */
export function writeGenBankRecords(docs: readonly SeqDocument[]): string {
  return docs.map(writeGenBank).join('');
}
