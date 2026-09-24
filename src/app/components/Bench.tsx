import { useState } from 'react';

import { BENCH_REACTIONS } from '../state/cloningReaction';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { BenchProductSlot } from './benchProductSlot';
import { GatewayPanel } from './GatewayPanel';
import { GibsonPanel } from './GibsonPanel';
import { GoldenGatePanel } from './GoldenGatePanel';
import { LigationPanel } from './LigationPanel';
import { ShelfPanel } from './ShelfPanel';

const HEADINGS = {
  ligation: ['Ligation', "in the shelf's order"],
  'golden-gate': ['Golden Gate', 'one pot, one enzyme'],
  gibson: ['Gibson', 'no enzyme, matching ends'],
  gateway: ['Gateway', 'att sites, no enzyme'],
} as const;

/**
 * The Cloning Bench (item 49): a full-width page in the tab strip for what
 * works across documents. Three columns: the parts on the shelf, the
 * reaction that joins them, and what it makes. The sidebar's Cloning tab
 * keeps what works on the document in front (Digest, PCR, Mutate), because
 * those draw on its views.
 */
export function Bench() {
  const { bench } = useEditorState();
  const reaction = bench.reaction;
  const [title, note] = HEADINGS[reaction];
  // The product column is filled by the reaction panel, through a portal.
  const [productSlot, setProductSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="bench" aria-label="Cloning Bench">
      <section className="bench__column bench__parts" aria-label="Parts">
        <ShelfPanel />
      </section>
      <section className="bench__column bench__reaction" aria-label="Reaction">
        <div className="panel__section">
          <div className="segmented" role="group" aria-label="Reaction">
            {BENCH_REACTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`segmented__button${
                  reaction === r.value ? ' segmented__button--active' : ''
                }`}
                aria-pressed={reaction === r.value}
                title={r.title}
                onClick={() => {
                  editorStore.setCloningReaction(r.value);
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="panel__section">
          <h3 className="panel__heading">
            {title}
            <span className="panel__heading-note">{note}</span>
          </h3>
          <BenchProductSlot.Provider value={productSlot}>
            {reaction === 'ligation' && <LigationPanel />}
            {reaction === 'golden-gate' && <GoldenGatePanel />}
            {reaction === 'gibson' && <GibsonPanel />}
            {reaction === 'gateway' && <GatewayPanel />}
          </BenchProductSlot.Provider>
        </div>
      </section>
      <section
        className="bench__column bench__product"
        aria-label="What it makes"
        ref={setProductSlot}
      />
    </div>
  );
}
