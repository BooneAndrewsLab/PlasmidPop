# 157. Ask on open: a linear record with features across its end

Issue #462. SnapGene and Addgene exports can say `linear` on the LOCUS line
and still hold `enhancer 8569..276` on an 8596 bp record (the Addgene export
`addgene-plasmid-11664` of the 2026-11-25 corpus does). The range only means
something on a circle; on a linear sequence it was dropped with "location
8569..276 spans the origin of a linear sequence". Decision (maintainer,
2026-11-26): ask.

## What was built

- Detection is exact. `location.ts` throws `OriginSpanError` (a
  `LocationError`, so every old catch still works) for a `start..end` range
  with start > end on a linear sequence, and for nothing else.
  `countOriginSpanning` (`parseGenBank.ts`) counts those in a record whose
  topology is linear, whether the LOCUS says so or says nothing. A circular
  LOCUS never counts; positions outside the sequence, `0..3`, and a linear
  `join(28..30,1..6)` (which is not a wrapping range) are not wrapping.
- The parser reports it, additively: `ParseResult.originSpanning` (per
  document, only present when some count is above zero) so a result for any
  other input is what it always was. `ParseOptions.wrappingAsCircular`
  (through `parseGenBank`, `parseSequenceFile`, `parseSequenceData`,
  `readSequenceData`) reads a record with such features as circular and keeps
  them; other records in the file are read as the file says. The features
  dropped are not kept aside: the circular choice reads the file again with
  that option, which is cheap and keeps a single code path for the features.
- `openFile(file, { askTopology })` is the explicit option. It is off by
  default, so the launch queue, the share target and every other caller keep
  the old behaviour (linear, dropped, warning) with no prompt. `openFiles`
  with one file (File ▸ Open, a drop) and `openPastedText` turn it on.
  `openText` (share links, examples, restore, scripted opens) and the
  multi-file/ZIP import (`importFiles`) do not.
- The question is `TopologyDialog`, shown from `topologyPrompt` in the store
  (`askTopology` returns a promise, `answerTopology` resolves it), in the
  pattern of the other dialogs: `dialog-backdrop`, focus on the primary
  button, Escape is Cancel. No key binding is touched. It names only the
  count.
- One question per file, not per record: only the first record of a file
  opens (a tab holds one molecule), so only its count is asked about.
  Multi-file and ZIP imports are not asked, to keep one summary dialog and no
  stack of questions; their records keep the warning in that summary.

## Circular and wraparound

A circular document with a wrapping feature is the ordinary case of the
model (the feature is one range with `end > length`), so nothing in the map,
translation or writer needed a change. Tests cover a wrapping CDS translating
across the end (`MA*`), and the writer writing `circular` on the LOCUS line
and the feature as `join(28..30,1..6)`, which reads back to the same segments
with no question. The map draws circular features that wrap the same way it
already draws those of a circular GenBank file.

## Analytics

One event, `file / open-topology`, named `circular`, `linear` or `cancel`.
It carries no count, name or sequence. It is in `analytics.ts`, item 38's
catalogue and the guide's usage statistics section.
