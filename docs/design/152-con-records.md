# 152. CON (contig) records are refused, not opened empty

Issue #460. Found by the 2026-11-25 GenBank corpus run: an NCBI record in
division CON (`rettype=gb` for NC_001133, NC_002483, NC_000021.9 and others)
has `CONTIG join(...)` where `ORIGIN` would be, so it carries no sequence.

## What went wrong

The feature table was read up to `ORIGIN` or the end of the record, so the
`CONTIG` line and its 12-space continuation lines were appended to the last
qualifier (`/chromosome="21"` became "Unterminated quoted value"). The
document then opened at 0 bp and every feature was dropped with "position N
is outside the sequence", hundreds of warnings.

## What was built

- The feature table ends at `ORIGIN` or at a `CONTIG` line, whichever comes
  first, so its continuation lines are never qualifier text. After an
  `ORIGIN`, a `CONTIG` line and its indented continuation lines are skipped
  rather than read as bases.
- A record with a `CONTIG` line, no `ORIGIN` and a LOCUS length in `bp` or
  `aa` is a CON record. It throws a `FormatError` with reason `unsupported`
  (existing reason: a valid GenBank record PlasmidPop cannot open), before
  its features are read, so it adds no warnings. The event is
  `genbank:unsupported`; no new reason, so item 38's catalogue is unchanged.
- The message points to the NCBI box, which is accurate: `efetch.ts` asks
  for `gbwithparts` (item 58), which returns the sequence.
- Multi-record files: a CON record is left out with one warning and the
  others open; if no record opens, the CON message is the failure.
- WGS/TSA/TLS master records (LOCUS length in `rc`, so no length) keep the
  behaviour of #254: an empty document with a warning. The `rc` unit is the
  discriminator. A record with `ORIGIN` and `CONTIG` keeps working.

## Tests

`genbank.test.ts` ("CON (contig) records"), `openFailures.test.ts`.
