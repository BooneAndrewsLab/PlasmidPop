import { type BaseSize, type BaseStyle, type Range, type SeqDocument, rangePieces } from '@/core';

/** The style of every stretch of `selection`, the unstyled ones as null, in order. */
function stylesOver(doc: SeqDocument, selection: Range): (BaseStyle | null)[] {
  const out: (BaseStyle | null)[] = [];
  for (const piece of rangePieces(selection, doc.length)) {
    let at = piece.start;
    for (const run of doc.styles.within(piece.start, piece.end)) {
      if (run.start > at) out.push(null);
      out.push(run.style);
      at = run.end;
    }
    if (at < piece.end) out.push(null);
  }
  return out;
}

/**
 * What every base of the selection has in common (#89): a part of the style
 * is set only when all of them share it, so the Style menu can tick what is
 * true of the whole selection and nothing it is not.
 */
export function sharedStyle(doc: SeqDocument, selection: Range): BaseStyle {
  const [first, ...rest] = stylesOver(doc, selection);
  if (first === undefined) return {};
  const shared: { color?: string; highlight?: string; bold?: boolean; size?: BaseSize } = {
    ...first,
  };
  for (const style of rest) {
    const s = style ?? {};
    if (shared.color !== s.color) delete shared.color;
    if (shared.highlight !== s.highlight) delete shared.highlight;
    if (shared.bold !== s.bold) delete shared.bold;
    if (shared.size !== s.size) delete shared.size;
  }
  return shared;
}

/** Whether no base of the selection is drawn larger. */
export function isUniformSize(doc: SeqDocument, selection: Range | null): boolean {
  if (selection === null) return false;
  return stylesOver(doc, selection).every((style) => style?.size === undefined);
}
