#!/usr/bin/env bash
# Runs the Biopython oracle in a pinned virtualenv (.venv-oracle, gitignored).
#   scripts/oracle/run.sh generate   rewrite src/test/oracle/*.json
#   scripts/oracle/run.sh writer     have Biopython read every file our GenBank writer produces
#   scripts/oracle/run.sh snapgene-local [dir]
#                                    compare our SnapGene reader with Biopython's on every .dna
#                                    under dir (default: a local SnapGene installation)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
venv="$root/.venv-oracle"
if [ ! -x "$venv/bin/python" ]; then
  python3 -m venv "$venv"
  "$venv/bin/pip" install -q -r "$root/scripts/oracle/requirements.txt"
fi
case "${1:-}" in
  generate)
    "$venv/bin/python" "$root/scripts/oracle/generate.py"
    ;;
  writer)
    out="$(mktemp -d)"
    trap 'rm -rf "$out"' EXIT
    (cd "$root" && ORACLE_EXPORT="$out" npx vitest run src/test/oracle/exportGenBank.test.ts)
    "$venv/bin/python" "$root/scripts/oracle/check_writer.py" "$out"
    ;;
  snapgene-local)
    dir="${2:-$HOME/Programs/snapgene_8.2.2_linux/data/opt/gslbiotech/snapgene/resources}"
    out="$(mktemp -d)"
    trap 'rm -rf "$out"' EXIT
    "$venv/bin/python" "$root/scripts/oracle/snapgene_local.py" "$dir" "$out/snapgene.json"
    (cd "$root" && SNAPGENE_ORACLE="$out/snapgene.json" npx vitest run src/test/oracle/snapgene.test.ts)
    ;;
  *)
    echo "usage: $0 generate|writer|snapgene-local [dir]" >&2
    exit 2
    ;;
esac
