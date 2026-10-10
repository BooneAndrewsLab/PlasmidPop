#!/usr/bin/env python3
"""Fetch the pLannotate corpus (#220) from NCBI by accession.

Reads accessions.txt, fetches each record with efetch (GenBank flat file), and
writes one stripped FASTA per record plus an index into the output directory:
the sequence and the topology only, no features. Nothing is committed from
here; `run_plannotate.py` reads the directory and writes the committed JSON.

    python3 scripts/plannotate/fetch_corpus.py [OUT_DIR]   # default ~/.cache/plannotate-corpus
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&rettype=gb&retmode=text&id="


def read_accessions(path: Path) -> list[tuple[str, str]]:
    out = []
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        acc, label = line.split("\t", 1)
        out.append((acc.strip(), label.strip()))
    return out


def parse_genbank(text: str) -> dict:
    locus = re.match(r"LOCUS\s+(\S+)\s+(\d+) bp\s+\S+\s+(circular|linear)", text)
    if locus is None:
        raise ValueError("no LOCUS line")
    definition = re.search(r"^DEFINITION\s+(.*?)\n(?=\S)", text, re.M | re.S)
    origin = text.split("\nORIGIN", 1)[1].split("//", 1)[0]
    seq = re.sub(r"[^a-zA-Z]", "", origin).upper()
    if len(seq) != int(locus.group(2)):
        raise ValueError("length mismatch")
    return {
        "length": len(seq),
        "topology": locus.group(3),
        "title": " ".join((definition.group(1) if definition else "").split()),
        "sequence": seq,
    }


def fetch(acc: str) -> str:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(EFETCH + acc, timeout=60) as r:
                return r.read().decode()
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"could not fetch {acc}")


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / ".cache" / "plannotate-corpus")
    out.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).parent
    index = []
    for acc, label in read_accessions(here / "accessions.txt"):
        rec = parse_genbank(fetch(acc))
        (out / f"{acc}.fasta").write_text(f">{acc}\n{rec['sequence']}\n")
        index.append({"accession": acc, "label": label, **{k: rec[k] for k in ("title", "length", "topology")}})
        print(acc, rec["length"], rec["topology"], label)
        time.sleep(0.4)
    (out / "index.json").write_text(json.dumps(index, indent=1))


if __name__ == "__main__":
    main()
