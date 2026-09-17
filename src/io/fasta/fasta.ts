import { SeqDocument, isValidSequence } from '@/core';

import { type ParseResult, type ParseWarning, FormatError, warning } from '../types';

const LINE_WIDTH = 70;

/**
 * Parses one or more FASTA records. The first word of the header is the
 * document name and the rest is the description. A description containing
 * the word "circular" (e.g. `[topology=circular]`) marks the sequence
 * circular. Gap characters are stripped with a warning.
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
    const description = space < 0 ? '' : body.slice(space).trim();
    documents.push(
      SeqDocument.create({
        name: name === '' ? 'Untitled' : name,
        sequence: cleaned,
        topology: /\bcircular\b/i.test(description) ? 'circular' : 'linear',
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
  const description = doc.metadata.description.trim();
  const circular = doc.topology === 'circular' && !/\bcircular\b/i.test(description);
  const headerParts = [doc.name.trim() === '' ? 'Untitled' : doc.name.replace(/\s+/g, '_')];
  if (description !== '') headerParts.push(description);
  if (circular) headerParts.push('[topology=circular]');
  const lines = [`>${headerParts.join(' ')}`];
  const text = doc.sequence.toString();
  for (let i = 0; i < text.length; i += LINE_WIDTH) lines.push(text.slice(i, i + LINE_WIDTH));
  return `${lines.join('\n')}\n`;
}

export function writeFastaRecords(docs: readonly SeqDocument[]): string {
  return docs.map(writeFasta).join('');
}
