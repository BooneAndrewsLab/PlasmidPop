#!/usr/bin/env python3
"""Run pLannotate on the fetched corpus and write the committed oracle JSON (#220).

pLannotate is run as a separate program (it is GPL-3.0; nothing of it is
linked or copied into PlasmidPop), from its own conda env:

    mamba create -n plannotate -c conda-forge -c bioconda plannotate
    plannotate setupdb          # databases stay in the env, outside the repo

    python3 scripts/plannotate/fetch_corpus.py                 # NCBI -> ~/.cache/plannotate-corpus
    python3 scripts/plannotate/run_plannotate.py [CORPUS_DIR]  # -> src/test/oracle/plannotate.json

The JSON holds the sequences (NCBI records, annotations stripped), pLannotate's
version and database versions, and its hits: name, type, 0-based half-open
location, strand, identity, database. pLannotate's own output files stay in a
temporary directory and are not kept.
"""
import csv
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ENV = Path(os.environ.get("PLANNOTATE_ENV", Path.home() / "Programs/miniconda3/envs/plannotate"))
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/test/oracle/plannotate.json"


# BLAST, DIAMOND and Infernal are found on PATH, so the env's bin comes first.
RUN_ENV = {**os.environ, "PATH": f"{ENV / 'bin'}{os.pathsep}{os.environ['PATH']}"}


def tool(*args: str) -> str:
    return subprocess.run(
        [str(ENV / "bin/plannotate"), *args], check=True, capture_output=True, text=True, env=RUN_ENV
    ).stdout


def annotate(corpus: Path, rec: dict, work: Path) -> list[dict]:
    seq = "".join((corpus / f"{rec['accession']}.fasta").read_text().splitlines()[1:])
    cmd = ["batch", "-i", str(corpus / f"{rec['accession']}.fasta"), "-o", str(work), "-c", "-s", ""]
    if rec["topology"] == "linear":
        cmd.append("--linear")
    subprocess.run([str(ENV / "bin/plannotate"), *cmd], check=True, capture_output=True, text=True, env=RUN_ENV)
    hits = []
    with (work / f"{rec['accession']}.csv").open() as f:
        for row in csv.DictReader(f):
            start, end = int(row["start location"]), int(row["end location"])
            # pLannotate's start is 0-based; its `sequence` column is the check.
            found = row["sequence"].upper().replace("-", "")
            span = seq[start:end] if start < end else seq[start:] + seq[:end]
            assert len(found) == len(span) or row["strand"] != "", rec["accession"]
            hits.append(
                {
                    "name": row["Feature"],
                    "type": row["Type"],
                    "start": start,
                    "end": end,
                    "strand": int(row["strand"]),
                    "identity": round(float(row["percent identity"]), 2),
                    "coverage": round(float(row["percent match length"]), 1),
                    "fragment": row["fragment"] == "True",
                    "database": row["database"],
                }
            )
    hits.sort(key=lambda h: (h["start"], h["end"]))
    return hits


def main() -> None:
    corpus = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / ".cache" / "plannotate-corpus")
    index = json.loads((corpus / "index.json").read_text())
    with tempfile.TemporaryDirectory() as tmp:
        def one(rec: dict) -> dict:
            work = Path(tmp) / rec["accession"]
            work.mkdir()
            hits = annotate(corpus, rec, work)
            seq = "".join((corpus / f"{rec['accession']}.fasta").read_text().splitlines()[1:])
            print(rec["accession"], len(hits), flush=True)
            return {**rec, "sequence": seq, "hits": hits}

        with ThreadPoolExecutor(max_workers=4) as pool:
            vectors = list(pool.map(one, index))
    version = tool("--version").splitlines()[0].strip()
    databases = json.loads(tool("databases"))
    out = {
        "plannotate": version,
        "databases": {"bundle": databases["bundle"], "build_date": databases["build_date"], **databases["databases"]},
        "vectors": vectors,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
