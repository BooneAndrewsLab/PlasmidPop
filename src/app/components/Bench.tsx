import { ShelfPanel } from './ShelfPanel';

/**
 * The Cloning Bench (item 49): a full-width page in the tab strip for what
 * works across documents. Three columns: the parts on the shelf, the
 * reaction that joins them, and what it makes. The sidebar's Cloning tab
 * keeps what works on the document in front (Digest, PCR, Mutate), because
 * those draw on its views.
 */
export function Bench() {
  return (
    <div className="bench" aria-label="Cloning Bench">
      <section className="bench__column bench__parts" aria-label="Parts">
        <ShelfPanel />
      </section>
      <section className="bench__column bench__reaction" aria-label="Reaction">
        <h3 className="panel__heading">Reaction</h3>
      </section>
      <section className="bench__column bench__product" aria-label="Product">
        <h3 className="panel__heading">Product</h3>
      </section>
    </div>
  );
}
