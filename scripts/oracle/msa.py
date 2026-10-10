#!/usr/bin/env python3
"""
Writes src/test/oracle/msa.json: seeded sets of related sequences with the
true alignment (known from the simulation) and MAFFT's alignment of each, for
the multiple alignment's acceptance test (#207, docs/design/85-*.md).

Needs MAFFT on PATH (or MAFFT=/path/to/mafft); the test never does. Standard
library only:
    MAFFT=$(command -v mafft) python3 scripts/oracle/msa.py
"""
import json
import os
import random
import subprocess
import sys
import tempfile
from pathlib import Path

DNA = "ACGT"
AA = "ACDEFGHIKLMNPQRSTVWY"
GROUPS = ["AGST", "ILMV", "DE", "KRH", "FWY", "NQ", "C", "P"]


def mutate_char(c, protein, rng):
    if protein:
        if rng.random() < 0.6:
            for g in GROUPS:
                if c in g and len(g) > 1:
                    return rng.choice([x for x in g if x != c])
        return rng.choice([x for x in AA if x != c])
    # Transitions twice as likely as transversions.
    ts = {"A": "G", "G": "A", "C": "T", "T": "C"}
    if rng.random() < 0.6:
        return ts[c]
    return rng.choice([x for x in DNA if x != c and x != ts[c]])


def evolve(seq, rate, indel, protein, rng):
    """seq: list of (key, char). Returns a mutated copy; inserted residues get new keys."""
    out = []
    alphabet = AA if protein else DNA
    for idx, (key, ch) in enumerate(seq):
        if rng.random() < indel:
            if rng.random() < 0.5:
                continue  # deletion of this residue (and sometimes the next ones)
        if rng.random() < rate:
            ch = mutate_char(ch, protein, rng)
        out.append((key, ch))
        if rng.random() < indel:
            # An insertion after this residue: keys between this key and the next.
            nxt = seq[idx + 1][0] if idx + 1 < len(seq) else key + 1.0
            n = rng.choice([1, 1, 2, 3, 4, 6])
            lo = rng.random() * 0.4
            for t in range(n):
                k = key + (nxt - key) * (0.1 + 0.5 * (lo + t / (n + 1) * 0.4) + rng.random() * 0.001)
                out.append((k, rng.choice(alphabet)))
    out.sort(key=lambda x: x[0])
    return out


def simulate(n, length, rate, indel, protein, seed):
    rng = random.Random(seed)
    alphabet = AA if protein else DNA
    root = [(float(i), rng.choice(alphabet)) for i in range(length)]
    leaves = [root]
    while len(leaves) < n:
        # Split a random lineage in two, each child diverging a little.
        parent = leaves.pop(rng.randrange(len(leaves)))
        for _ in range(2):
            leaves.append(evolve(parent, rate, indel, protein, rng))
    leaves = leaves[:n]
    keys = sorted({k for leaf in leaves for k, _ in leaf})
    col = {k: i for i, k in enumerate(keys)}
    truth = []
    seqs = []
    for leaf in leaves:
        row = ["-"] * len(keys)
        for k, ch in leaf:
            row[col[k]] = ch
        truth.append("".join(row))
        seqs.append("".join(ch for _, ch in leaf))
    # Columns that are gaps in every row cannot happen; drop none.
    return seqs, truth


def mafft(seqs, protein):
    exe = os.environ.get("MAFFT", "mafft")
    with tempfile.NamedTemporaryFile("w", suffix=".fa", delete=False) as f:
        for i, s in enumerate(seqs):
            f.write(f">s{i}\n{s}\n")
        path = f.name
    try:
        out = subprocess.run(
            [exe, "--quiet", "--auto", "--amino" if protein else "--nuc", path],
            capture_output=True, text=True, check=True,
        ).stdout
    finally:
        os.unlink(path)
    rows, cur = {}, None
    for line in out.splitlines():
        if line.startswith(">"):
            cur = int(line[2:])
            rows[cur] = []
        elif cur is not None:
            rows[cur].append(line.strip())
    return ["".join(rows[i]).upper() for i in range(len(seqs))]


def version(exe):
    r = subprocess.run([exe, "--version"], capture_output=True, text=True)
    return (r.stderr or r.stdout).strip()


SETS = [
    # name, protein, n, length, substitution rate, indel rate
    ("dna-close-8", False, 8, 300, 0.03, 0.01),
    ("dna-medium-12", False, 12, 400, 0.08, 0.02),
    ("dna-distant-10", False, 10, 400, 0.15, 0.03),
    ("dna-many-30", False, 30, 250, 0.05, 0.015),
    ("protein-close-8", True, 8, 200, 0.05, 0.01),
    ("protein-medium-12", True, 12, 250, 0.12, 0.02),
    ("protein-distant-10", True, 10, 250, 0.22, 0.03),
    ("protein-many-30", True, 30, 180, 0.1, 0.02),
]

def main():
    exe = os.environ.get("MAFFT", "mafft")
    sets = []
    for i, (name, protein, n, length, rate, indel) in enumerate(SETS):
        seqs, truth = simulate(n, length, rate, indel, protein, 207 + i)
        sets.append({
            "name": name,
            "alphabet": "protein" if protein else "nucleotide",
            "sequences": seqs,
            "truth": truth,
            "mafft": mafft(seqs, protein),
        })
        print(name, file=sys.stderr)
    out = Path(__file__).resolve().parents[2] / "src/test/oracle/msa.json"
    out.write_text(json.dumps({"mafftVersion": version(exe), "sets": sets}, indent=1) + "\n")


main()
