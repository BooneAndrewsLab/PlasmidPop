#!/usr/bin/env bash
# Runs the Biopython oracle in a pinned virtualenv (.venv-oracle, gitignored).
#   scripts/oracle/run.sh generate   rewrite src/test/oracle/*.json
#   scripts/oracle/run.sh writer     have Biopython read every file our GenBank writer produces
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
  *)
    echo "usage: $0 generate|writer" >&2
    exit 2
    ;;
esac
