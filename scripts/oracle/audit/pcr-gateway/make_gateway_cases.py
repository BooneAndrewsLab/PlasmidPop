"""Build Gateway BP/LR cases from authentic att sequences and compute pydna's products.

att sequences are the ones pydna's own gateway doctests use (Invitrogen /
Hartley et al. 2000 Genome Res. 10:1788 derived), plus the standard 25-bp
attB1/attB2 from the Invitrogen Gateway Technology manual.
"""

import json
import random
from Bio.Seq import Seq
from pydna.dseqrecord import Dseqrecord
from pydna.assembly2 import gateway_assembly

HERE = "/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/pcr-gateway"

ATT = {
    "attB1": "ACAACTTTGTACAAAAAAGCAGAAG",
    "attB2": "ACAACTTTGTACAAGAAAGCAGAAG",
    "attP1": "AAAATAATGATTTTATTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCTGAACGAGAAGCGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATGAATCAACTACTTAGATGGTATTAGTGACCTGTA",
    "attP2": "AAAATAATGATTTTATTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAGAAAGCTGAACGAGAAGCGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATGAATCAACTACTTAGATGGTATTAGTGACCTGTA",
    "attL1": "CAAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATAAGCAATGCTTTCTTATAATGCCAACTTTGTACAAAAAAGCAGGCT",
    "attL2": "AAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATAAGCAATGCTTTCTTATAATGCCAACTTTGTACAAGAAAGCTG",
    "attR1": "ACAACTTTGTACAAAAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATGCAGTCACTATG",
    "attR2": "ACCACTTTGTACAAGAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATG",
}


def rc(s):
    return str(Seq(s).reverse_complement())


rnd = random.Random(2026)


def dna(n):
    return "".join(rnd.choice("ACGT") for _ in range(n))


def build(parts):
    """parts: list of (name, seq, kind) where kind in {'att','gene','filler'}.
    Returns (sequence, features) with features as dicts."""
    seq = ""
    feats = []
    for name, s, kind, strand in parts:
        feats.append(
            {"name": name, "start": len(seq), "end": len(seq) + len(s),
             "strand": strand, "kind": kind}
        )
        seq += s
    return seq, feats


cases = []


def add_case(cid, reaction, insert, vector, insert_circular=True):
    iseq, ifeat = insert
    vseq, vfeat = vector
    # pydna products
    frags = [Dseqrecord(iseq, circular=insert_circular), Dseqrecord(vseq, circular=True)]
    try:
        prods = gateway_assembly(frags, reaction, multi_site_only=True)
        py = sorted(str(p.seq).upper() for p in prods)
        pycirc = [bool(p.circular) for p in prods]
    except Exception as e:
        py = []
        pycirc = []
        print(f"  !! pydna failed on {cid}: {e}")
    cases.append(
        {
            "id": cid,
            "reaction": reaction,
            "insert": {"sequence": iseq, "features": ifeat, "circular": insert_circular, "name": "insert"},
            "vector": {"sequence": vseq, "features": vfeat, "circular": True, "name": "vector"},
            "pydna": py,
            "pydna_circular": pycirc,
        }
    )


GENE = "ATG" + dna(297) + "TAA"
CCDB = "ATG" + dna(297) + "TGA"

# --- Case 1: BP, both sites on the forward strand (pydna docstring layout)
sub = build([
    ("attB1", ATT["attB1"], "att", "forward"),
    ("gene", GENE, "gene", "forward"),
    ("attB2", ATT["attB2"], "att", "forward"),
    ("ampR", dna(600), "filler", "forward"),
])
don = build([
    ("attP1", ATT["attP1"], "att", "forward"),
    ("ccdB", CCDB, "gene", "forward"),
    ("attP2", ATT["attP2"], "att", "forward"),
    ("kanR", dna(700), "filler", "forward"),
])
add_case("BP-forward", "BP", sub, don)

# --- Case 2: LR, both sites forward
entry = build([
    ("attL1", ATT["attL1"], "att", "forward"),
    ("gene", GENE, "gene", "forward"),
    ("attL2", ATT["attL2"], "att", "forward"),
    ("kanR", dna(650), "filler", "forward"),
])
dest = build([
    ("attR1", ATT["attR1"], "att", "forward"),
    ("ccdB", CCDB, "gene", "forward"),
    ("attR2", ATT["attR2"], "att", "forward"),
    ("ampR", dna(800), "filler", "forward"),
])
add_case("LR-forward", "LR", entry, dest)

# --- Case 3: LR with the real arrangement: site 2 inverted in both molecules
entry2 = build([
    ("attL1", ATT["attL1"], "att", "forward"),
    ("gene", GENE, "gene", "forward"),
    ("attL2", rc(ATT["attL2"]), "att", "reverse"),
    ("kanR", dna(650), "filler", "forward"),
])
dest2 = build([
    ("attR1", ATT["attR1"], "att", "forward"),
    ("ccdB", CCDB, "gene", "forward"),
    ("attR2", rc(ATT["attR2"]), "att", "reverse"),
    ("ampR", dna(800), "filler", "forward"),
])
add_case("LR-site2-inverted", "LR", entry2, dest2)

# --- Case 4: BP with a linear attB PCR product as the substrate
linear_sub = build([
    ("spacer5", dna(12), "filler", "forward"),
    ("attB1", ATT["attB1"], "att", "forward"),
    ("gene", GENE, "gene", "forward"),
    ("attB2", ATT["attB2"], "att", "forward"),
    ("spacer3", dna(12), "filler", "forward"),
])
add_case("BP-linear-substrate", "BP", linear_sub, don, insert_circular=False)

# --- Case 5: LR where the entry clone's attL1 wraps the origin
gene5 = GENE
entry5seq_parts = [
    ("attL1", ATT["attL1"], "att", "forward"),
    ("gene", gene5, "gene", "forward"),
    ("attL2", ATT["attL2"], "att", "forward"),
    ("kanR", dna(650), "filler", "forward"),
]
s5, f5 = build(entry5seq_parts)
# rotate so that attL1 straddles the origin
shift = 40
s5r = s5[-shift:] + s5[:-shift]
f5r = []
for f in f5:
    f5r.append({**f, "start": (f["start"] + shift) % len(s5), "end": f["start"] + shift + (f["end"] - f["start"])})
# fix wrap: keep start/end possibly beyond length (PlasmidPop takes a wrapped range)
f5r = [{**f, "end": f["start"] + (orig["end"] - orig["start"])} for f, orig in zip(f5r, f5)]
add_case("LR-attL1-wraps-origin", "LR", (s5r, f5r), dest)

# --- Case 6: destination vector written the other way round (sites on the reverse strand)
dest6seq = rc(dest[0])
L6 = len(dest6seq)
dest6feat = [
    {"name": f["name"], "start": L6 - f["end"], "end": L6 - f["start"],
     "strand": "reverse" if f["strand"] == "forward" else "forward", "kind": f["kind"]}
    for f in dest[1]
]
add_case("LR-vector-reversed", "LR", entry, (dest6seq, dest6feat))

json.dump(cases, open(f"{HERE}/gateway-cases.json", "w"), indent=1)
for c in cases:
    print(c["id"], c["reaction"], "pydna products:", [len(p) for p in c["pydna"]],
          "insert", len(c["insert"]["sequence"]), "vector", len(c["vector"]["sequence"]))
