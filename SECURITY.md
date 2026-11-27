# Security policy

## What PlasmidPop is, security-wise

PlasmidPop is a static site: all computation happens in the user's browser,
there is no backend, no account, and no upload of sequence data. The only
third-party host it talks to is NCBI, for the accessions or gene names a user
types. That makes the relevant risks things like:

- a crafted input file (GenBank, FASTA, SnapGene `.dna`, AB1, FASTQ, ZIP) that
  hangs, crashes, or exhausts memory in the parsers or workers;
- cross-site scripting through file content, feature names, share links (the
  document carried in the URL fragment), or imported backups;
- anything that sends sequence content, file names, or other private data off
  the user's machine, including through analytics;
- a vulnerable dependency that is reachable from the shipped bundle.

## Supported versions

Only the latest release, which is what the deployed site serves, receives fixes.
Fixes ship as a new release; the site updates when a GitHub Release is
published.

## Reporting a vulnerability

Please report privately, not in a public issue:

1. Open a
   [private vulnerability report](https://github.com/BooneAndrewsLab/PlasmidPop/security/advisories/new)
   on GitHub.
2. Include the version (shown in the Help guide's header), the browser, and the
   steps or a minimal input file that reproduces it. Do not attach files that
   contain data you cannot share.

You can expect an acknowledgement within a week and a status update after
triage. Reports are credited in the release notes unless you prefer otherwise.
Please give us a reasonable chance to fix the problem before disclosing it
publicly.

Bugs that are not security-sensitive (wrong results, rendering glitches) belong
in the [issue tracker](https://github.com/BooneAndrewsLab/PlasmidPop/issues).
