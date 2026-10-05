#!/usr/bin/env bash
# Downloads the reference data a correctness audit compares against into
# fixtures/local/oracle-cache/ (gitignored: NCBI records are public domain
# but large, REBASE files are NEB's). Safe to re-run; existing files are kept.
#   scripts/oracle/audit/fetch.sh
# See docs/audit.md for what each source is used for.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cache="$root/fixtures/local/oracle-cache"
mkdir -p "$cache/ncbi" "$cache/rebase" "$cache/biopython"

get() { # url dest
  [ -s "$2" ] && return 0
  curl -fsSL --retry 3 "$1" -o "$2" || { echo "failed: $1" >&2; rm -f "$2"; }
}

# NCBI GenBank records (efetch, gbwithparts). Why each is here: docs/audit.md.
accessions=(
  L09137.2 J01749.1 J02459.1 J02482.1 NC_001416.1   # pUC19, pBR322, lambda, phiX174, lambda (RefSeq)
  NC_012920.1 NC_001224.1 NC_000908.2 NC_000911.1   # tables 2, 3, 4, 11 (3.5 Mb)
  NC_000932.1 NC_005816.1 NC_008512.1               # plastid (trans-splicing), Yersinia plasmid, Carsonella (table 4)
  NG_017013.2 NM_000581.4 NC_001133.9 NC_001144.5   # multi-exon join, Sec transl_except, yeast chr I, XII
  AF171097.1                                        # small bacterial gene record
  PQ197128.1 LC217877.1                             # pDONR221 derivative, pDONR Zeo MultiSite (Gateway)
  PZ765744.1 OQ554331.1                             # 3'-partial CDS with a 2-base tail (#142)
)
for acc in "${accessions[@]}"; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$acc&rettype=gbwithparts&retmode=text" \
    "$cache/ncbi/$acc.gb"
  sleep 0.4 # NCBI allows 3 requests/s without an API key
done

# REBASE: enzyme definitions and methylation-overlap tables.
get "https://rebase.neb.com/rebase/link_withrefm" "$cache/rebase/withrefm.txt"
get "https://rebase.neb.com/rebase/link_emboss_e" "$cache/rebase/emboss_e.txt"
for q in mM.EcoKDam+sN mM.EcoKDcm+sN mM.EcoKDam+sV mM.EcoKDcm+sV; do
  get "https://rebase.neb.com/cgi-bin/damlist?$q" "$cache/rebase/damlist_${q//+/_}.html"
done

# Biopython's own awkward test files (GenBank locations, AB1, FASTQ).
if [ ! -d "$cache/biopython/Tests" ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/biopython/biopython "$cache/biopython/repo"
  git -C "$cache/biopython/repo" sparse-checkout set Tests/GenBank Tests/Abi Tests/Quality
  mv "$cache/biopython/repo/Tests" "$cache/biopython/Tests"
  rm -rf "$cache/biopython/repo"
fi

echo "reference data in $cache"
