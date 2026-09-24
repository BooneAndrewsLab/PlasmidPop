import { SeqDocument, isValidSequence } from '@/core';

import { formatEndsComment, parseEndsComment } from '../genbank/endsComment';
import {
  formatMethylationComment,
  needsMethylationComment,
  parseMethylationComment,
} from '../genbank/methylationComment';
import { type ParseResult, type ParseWarning, FormatError, warning } from '../types';

const LINE_WIDTH = 70;

/**
 * A linear molecule's sticky ends in a FASTA header: the GenBank comment's
 * text in brackets, `[PlasmidPop-ends: left=5' AATT/EcoRI; right=blunt]`,
 * beside the `[topology=circular]` convention (#9). Other readers keep it as
 * part of the description; ours takes it out of the description and back on
 * write, so it does not pile up.
 */
const ENDS_TAG = /\s*\[(PlasmidPop-ends:[^\]]*)\]/;

/**
 * Where the DNA was grown, the same way (#71): the GenBank comment's text in
 * brackets, `[PlasmidPop-methylation: dam-; dcm-]`, and only when the host
 * is not the ordinary `dam+ dcm+` a header without it is read as.
 */
const METHYLATION_TAG = /\s*\[(PlasmidPop-methylation:[^\]]*)\]/;

/**
 * Parses one or more FASTA records. The first word of the header is the
 * document name and the rest is the description. A description containing
 * the word "circular" (e.g. `[topology=circular]`) marks the sequence
 * circular, and a `[PlasmidPop-ends: …]` tag gives a linear one its sticky
 * ends. Gap characters are stripped with a warning.
 */
export function parseFasta(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const warnings: ParseWarning[] = [];
  const documents: SeqDocument[] = [];

  let header: { text: string; line: number } | null = null;
  let seq = '';

  const flush = (): void => {
    if (header === null) return;
    let cleaned = seq.replace(/[\s\d]/g, '');
    if (/[-.]/.test(cleaned)) {
      warnings.push(warning('Gap characters removed from sequence', header.line));
      cleaned = cleaned.replace(/[-.]/g, '');
    }
    if (!isValidSequence(cleaned)) {
      const bad = [...new Set(cleaned.replace(/[ACGTURYSWKMBDHVNacgturyswkmbdhvn]/g, ''))];
      throw new FormatError(
        `Sequence is not nucleotide IUPAC (found ${bad.map((c) => JSON.stringify(c)).join(', ')})`,
        header.line,
      );
    }
    const body = header.text.slice(1).trim();
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    let description = space < 0 ? '' : body.slice(space).trim();
    const tag = ENDS_TAG.exec(description);
    const ends = tag?.[1] === undefined ? null : parseEndsComment(tag[1]);
    if (tag !== null) description = description.replace(ENDS_TAG, '').trim();
    const host = METHYLATION_TAG.exec(description);
    const methylation = host?.[1] === undefined ? null : parseMethylationComment(host[1]);
    // Only a tag that was understood leaves the description, as for the ends.
    if (methylation !== null) description = description.replace(METHYLATION_TAG, '').trim();
    documents.push(
      SeqDocument.create({
        name: name === '' ? 'Untitled' : name,
        sequence: cleaned,
        topology: /\bcircular\b/i.test(description) ? 'circular' : 'linear',
        ends,
        ...(methylation === null ? {} : { methylation }),
        metadata: { description },
      }),
    );
    header = null;
    seq = '';
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line.startsWith('>')) {
      flush();
      header = { text: line, line: idx + 1 };
    } else if (line.startsWith(';')) {
      // legacy comment line
    } else if (header !== null) {
      seq += line;
    } else if (line !== '') {
      throw new FormatError('FASTA files must start with a ">" header line', idx + 1);
    }
  });
  flush();

  if (documents.length === 0) throw new FormatError('No FASTA records found');
  return { format: 'fasta', documents, warnings };
}

export function writeFasta(doc: SeqDocument): string {
  const description = doc.metadata.description
    .replace(ENDS_TAG, '')
    // Ours is written afresh below; a tag that cannot be read stays, as the
    // user's own text.
    .replace(METHYLATION_TAG, (tag: string, body: string) =>
      parseMethylationComment(body) === null ? tag : '',
    )
    .trim();
  const circular = doc.topology === 'circular' && !/\bcircular\b/i.test(description);
  const headerParts = [doc.name.trim() === '' ? 'Untitled' : doc.name.replace(/\s+/g, '_')];
  if (description !== '') headerParts.push(description);
  if (circular) headerParts.push('[topology=circular]');
  if (doc.ends !== null) headerParts.push(`[${formatEndsComment(doc.ends)}]`);
  if (needsMethylationComment(doc.methylation)) {
    headerParts.push(`[${formatMethylationComment(doc.methylation)}]`);
  }
  return formatFastaRecord(headerParts.join(' '), doc.sequence.toString());
}

/**
 * One FASTA record: `>header` followed by `sequence` wrapped to 70 columns
 * and a trailing newline. Works for protein as well as nucleotide text.
 */
export function formatFastaRecord(header: string, sequence: string): string {
  const lines = [`>${header}`];
  for (let i = 0; i < sequence.length; i += LINE_WIDTH)
    lines.push(sequence.slice(i, i + LINE_WIDTH));
  return `${lines.join('\n')}\n`;
}

export function writeFastaRecords(docs: readonly SeqDocument[]): string {
  return docs.map(writeFasta).join('');
}
