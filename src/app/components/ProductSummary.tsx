import { type SeqDocument } from '@/core';

/**
 * What a reaction would make, said before it is made (#15): its length,
 * whether it is a circle, and the features it carries. The product is a
 * different molecule from any open document, so it cannot be drawn on the
 * views; **Assemble** opens it for that.
 */
export function ProductSummary({ product }: { readonly product: SeqDocument }) {
  const names = [
    ...new Set(
      product.features
        .all()
        .filter((f) => f.type !== 'primer_bind' && f.type !== 'source')
        .map((f) => (f.name === '' ? f.type : f.name)),
    ),
  ];
  const shown = names.slice(0, 6);
  return (
    <p className="panel__note panel__note--quiet" aria-label="Product">
      Product: {product.length.toLocaleString()} bp, {product.isCircular ? 'circular' : 'linear'}
      {names.length === 0
        ? ', no features'
        : ` · ${shown.join(', ')}${names.length > shown.length ? `, +${names.length - shown.length} more` : ''}`}
    </p>
  );
}
