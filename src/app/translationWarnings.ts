import { type Feature, type SeqDocument, type TranslationProblem, checkTranslations } from '@/core';
import { type ParseWarning, formatLocation } from '@/io';

/**
 * How many features may be named before the rest are counted. A file whose
 * every CDS disagrees has one cause, not fifty, and a status bar is not the
 * place to read them all.
 */
const MAX_LISTED = 8;

/** `CDS bla at complement(3293..4153)`, the way the file writes the location. */
function label(doc: SeqDocument, feature: Feature): string {
  const named = feature.name === '' ? feature.type : `${feature.type} ${feature.name}`;
  return `${named} at ${formatLocation(feature, doc.length, doc.topology)}`;
}

function sentence(problem: TranslationProblem): string {
  switch (problem.kind) {
    case 'unknown-table':
      return `/transl_table=${problem.value} is not a genetic code NCBI uses, so the standard code was used.`;
    case 'length':
      return `the file's /translation is ${problem.stored.toLocaleString()} aa, the sequence gives ${problem.computed.toLocaleString()}.`;
    case 'residue':
      return problem.differences === 1
        ? `the file's /translation differs from the sequence at residue ${problem.position.toLocaleString()}: the file says ${problem.stored}, the sequence gives ${problem.computed}.`
        : `the file's /translation differs from the sequence at ${problem.differences.toLocaleString()} residues, the first at ${problem.position.toLocaleString()}: the file says ${problem.stored}, the sequence gives ${problem.computed}.`;
  }
}

/**
 * What a file's coding features claim that its own sequence does not bear
 * out: a `/transl_table` naming no genetic code, and a stored `/translation`
 * that is not the protein the bases give. Both are worth hearing when the
 * file is opened — the first says the translation on screen is a guess, and
 * the second says either the file or our reading of it is wrong, which is
 * exactly what a scientist would want to know before trusting either.
 */
export function translationWarnings(doc: SeqDocument): ParseWarning[] {
  const problems = checkTranslations(doc);
  const warnings: ParseWarning[] = [];
  for (const problem of problems.slice(0, MAX_LISTED)) {
    const feature = doc.features.get(problem.featureId);
    if (feature === undefined) continue;
    warnings.push({ message: `${label(doc, feature)} — ${sentence(problem)}` });
  }
  const rest = problems.length - MAX_LISTED;
  if (rest > 0) {
    warnings.push({
      message: `${rest.toLocaleString()} more coding ${rest === 1 ? 'feature disagrees' : 'features disagree'} with the sequence in the same way.`,
    });
  }
  return warnings;
}
