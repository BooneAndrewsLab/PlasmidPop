#!/usr/bin/env bash
# Runs the Biopython oracle in a pinned virtualenv (.venv-oracle, gitignored).
#   scripts/oracle/run.sh generate   rewrite src/test/oracle/*.json (Biopython, primer3-py,
#                                    pydna and seguid answers; needs Python 3.10+)
#   scripts/oracle/run.sh primer-pairs
#                                    rewrite src/test/oracle/primerPairs.json: Primer3's design
#                                    for fixed templates and its verdict on the pairs our designer
#                                    selects (exported from the TypeScript designer first)
#   scripts/oracle/run.sh writer     have Biopython read every file our GenBank writer produces
#   scripts/oracle/run.sh snapgene-writer
#                                    have Biopython read every SnapGene file our writer produces
#   scripts/oracle/run.sh snapgene-local [dir]
#                                    compare our SnapGene reader with Biopython's on every .dna
#                                    under dir (default: a local SnapGene installation)
#   scripts/oracle/run.sh abif-local [dir...]
#                                    compare our AB1 reader with Biopython's on every .ab1
#                                    under the directories (default: fixtures/local)
#   scripts/oracle/run.sh ncbi-region
#                                    fetch one real region from NCBI through Biopython's
#                                    Entrez.efetch and rewrite src/test/oracle/ncbi-region.json
#                                    with its fixture (the only oracle that uses the network)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
venv="$root/.venv-oracle"
if [ ! -x "$venv/bin/python" ]; then
  # pydna needs Python 3.10 or later; ORACLE_PYTHON overrides the search.
  py="${ORACLE_PYTHON:-}"
  if [ -z "$py" ]; then
    for c in python3.13 python3.12 python3.11 python3.10 python3.14; do
      if command -v "$c" >/dev/null 2>&1; then py="$c"; break; fi
    done
  fi
  [ -n "$py" ] || { echo "need Python 3.10+ (set ORACLE_PYTHON)" >&2; exit 1; }
  "$py" -m venv "$venv"
  "$venv/bin/pip" install -q -r "$root/scripts/oracle/requirements.txt"
fi
case "${1:-}" in
  generate)
    "$venv/bin/python" "$root/scripts/oracle/generate.py"
    ;;
  primer-pairs)
    # The export reads the templates from the committed primerPairs.json (they
    # are seeded, so unchanged) and only runs the export test: the gate tests
    # in the same file compare against the data about to be replaced.
    (cd "$root" && ORACLE_EXPORT_PAIRS=1 npx vitest run src/test/oracle/primerPairs.test.ts -t 'exports our pairs')
    (cd "$root/scripts/oracle" && "$venv/bin/python" primerpairs.py)
    ;;
  writer)
    out="$(mktemp -d)"
    trap 'rm -rf "$out"' EXIT
    (cd "$root" && ORACLE_EXPORT="$out" npx vitest run src/test/oracle/exportGenBank.test.ts)
    "$venv/bin/python" "$root/scripts/oracle/check_writer.py" "$out"
    ;;
  snapgene-writer)
    out="$(mktemp -d)"
    trap 'rm -rf "$out"' EXIT
    (cd "$root" && ORACLE_EXPORT_SNAPGENE="$out" npx vitest run src/test/oracle/exportSnapGene.test.ts)
    "$venv/bin/python" "$root/scripts/oracle/check_snapgene_writer.py" "$out"
    ;;
  snapgene-local)
    dir="${2:-$HOME/Programs/snapgene_8.2.2_linux/data/opt/gslbiotech/snapgene/resources}"
    out="$(mktemp -d)"
    trap 'rm -rf "$out"' EXIT
    "$venv/bin/python" "$root/scripts/oracle/snapgene_local.py" "$dir" "$out/snapgene.json"
    (cd "$root" && SNAPGENE_ORACLE="$out/snapgene.json" npx vitest run src/test/oracle/snapgene.test.ts)
    ;;
  abif-local)
    shift
    [ "$#" -gt 0 ] || set -- "$root/fixtures/local"
    out="$(mktemp -d)"
    trap 'rm -rf "$out"' EXIT
    "$venv/bin/python" "$root/scripts/oracle/abif_local.py" "$out/abif.json" "$@"
    (cd "$root" && ABIF_ORACLE="$out/abif.json" npx vitest run src/test/oracle/abif.test.ts)
    ;;
  ncbi-region)
    "$venv/bin/python" "$root/scripts/oracle/ncbi_region.py"
    ;;
  *)
    echo "usage: $0 generate|primer-pairs|writer|snapgene-writer|snapgene-local [dir]|abif-local [dir...]|ncbi-region" >&2
    exit 2
    ;;
esac
