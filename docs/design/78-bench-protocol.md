# 78. Bench protocol for a product (#215)

**Asked:** a Bench product records what it was made from (item 52), but
nothing a person can take to the bench. Proposed: **Protocol…** builds one
page from that record: the oligos to order (marking those already in My
primers), PCR reactions, digests, assembly setup with insert-to-vector
ratios from the lengths and a concentration the user enters, and the
expected diagnostic digest; downloaded as HTML or Markdown, with no new
chemistry modelling.

**Built** (`src/core/cloning/protocol.ts`, `protocolText.ts`,
`src/app/components/ProtocolDialog.tsx`):

- **Source is the lineage alone.** `buildProtocol(doc, options)` walks the
  tree the document carries, parents before what they made, so a PCR comes
  before the ligation that uses its product. It therefore knows names,
  lengths, enzymes, primers and polymerase, and nothing of the parents'
  sequences. A document with no lineage gives `null`; a tree pruned to
  `elided` steps, or a product edited since it was made, gives a caveat
  line rather than a quietly wrong protocol.
- **Oligos** are gathered from PCR and mutagenesis steps, once per sequence
  (the products it is used for are listed), and matched to My primers by
  cleaned sequence, not name: the same oligo under another name is the same
  oligo.
- **PCR numbers reuse the app's thermodynamics:** Q5's Tm and annealing rule
  (`q5AnnealingTemperature`) for a proofreading enzyme, the nearest-neighbour
  Tm minus 5 C for Taq. The lineage keeps the whole oligo, not where it
  anneals, so a primer over 30 bases is taken to be tailed and its last 22
  bases to anneal (`annealingPart`); the page says so. Extension is 30 s/kb
  (proofreading) or 60 s/kb (Taq), at least 10 s.
- **Assembly amounts:** the longest part is the vector, at a ng the user
  enters (default 50); each insert gets `ratio` times its molecules
  (660 g/mol per bp; default 3 for a ligation, 2 for Golden Gate and
  Gibson, overridable). A volume appears only for a part whose concentration
  was typed in. Programs are the textbook ones for each reaction, written
  as such on the page.
- **Diagnostic digests** are the single-enzyme digests of the product itself
  in the set in use (1 to 6 cuts, methylation allowed for), ranked by
  `compareDiagnostic` as the Enzymes tab ranks band separation. The page
  lists the bands; the lane is not drawn.
- **Where:** a **Protocol…** button under the Made from tree in History and
  on a Bench product that carries a record. The dialog previews the exact
  page in a sandboxed frame and downloads it as HTML (one self-contained
  file, styles inline) or Markdown.

**Decided:** no buffer table. The enzyme data holds suppliers and
isoschizomers but no buffer or heat-inactivation data, and inventing it is
worse than saying to take it from the supplier's table, which the digest
step does. No empty-vector lane: the parts' sequences are not in the
lineage, so the Bench's against-empty-vector ranking (item 47) cannot run
from a record. The page's tables sit on a small block model that both
renderers share, so the two formats cannot drift apart.

**Not done:** a drawn gel in the downloaded page (an SVG of the lane would
fit the HTML); a primers TSV beside the page (Primers already exports the
collection as CSV); buffer and heat-inactivation data, which would need a
supplier table we may redistribute.
