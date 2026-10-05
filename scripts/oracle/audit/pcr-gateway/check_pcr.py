"""Oracle check of PlasmidPop PCR products.

Two independent oracles:
  A. Canonical product assembly: product = fwd_primer + template[f.end:r.start]
     + revcomp(rev_primer), with the template slice taken round the circle.
     This is the textbook definition (and pydna's); it is independent of how
     PlasmidPop splices primer bases over template bases.
  B. pydna.amplify.pcr, for the exact-match cases pydna can do.
"""

import json
import sys
from Bio.Seq import Seq
from pydna.dseqrecord import Dseqrecord
from pydna.amplify import pcr as pydna_pcr

HERE = "/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/pcr-gateway"

cases = json.load(open(f"{HERE}/pcr-results.json"))


def rc(s):
    return str(Seq(s).reverse_complement())


def cyclic(text, start, n):
    """n bases from `start` going right, wrapping."""
    L = len(text)
    out = ""
    i = start
    while len(out) < n:
        out += text[i % L]
        i += 1
    return out


fails = []
checked_a = 0
checked_b = 0
pydna_cases = 0

for c in cases:
    text = c["template"].upper()
    L = len(text)
    byname = {p["name"]: p["sequence"].upper() for p in c["primers"]}
    for pi, p in enumerate(c["products"]):
        f, r = p["forward"], p["reverse"]
        fname = next(s["name"] for s in c["sites"]
                     if s["strand"] == "forward" and s["start"] == f["start"] and s["end"] == f["end"])
        rname = next(s["name"] for s in c["sites"]
                     if s["strand"] == "reverse" and s["start"] == r["start"] and s["end"] == r["end"])
        fp, rp = byname[fname], byname[rname]
        # span: forward 5'-most annealed base round to reverse's
        span = r["end"] - f["start"]
        if c["circular"]:
            span = span % L
            if span == 0:
                span = L
            elif span < f["annealLength"] and span < r["annealLength"]:
                span += L
        mid_len = span - f["annealLength"] - r["annealLength"]
        assert mid_len >= 0, (c["id"], span)
        middle = cyclic(text, f["end"] if not c["circular"] else f["end"] % L, mid_len)
        want = fp + middle + rc(rp)
        got = p["sequence"].upper()
        if c["options"].get("polymerase") == "taq":
            assert got.endswith("A")
            got = got[:-1]
        checked_a += 1
        if got != want:
            fails.append(("assembly", c["id"], pi, want, got))

    # Oracle B: pydna, for cases with no mismatch and no IUPAC code
    if any(ch not in "ACGT" for pr in byname.values() for ch in pr):
        continue
    if any(s["mismatches"] for s in c["sites"]):
        continue
    if c["options"].get("polymerase") == "taq":
        continue
    tmpl = Dseqrecord(text, circular=c["circular"])
    prs = [pr for pr in byname.values()]
    if len(prs) != 2:
        continue
    pydna_cases += 1
    try:
        amp = pydna_pcr(prs[0], prs[1], tmpl, limit=15)
        pyseq = str(amp.seq).upper()
    except Exception as e:
        pyseq = f"ERROR: {e}"
    ours = sorted(p["sequence"].upper() for p in c["products"])
    checked_b += 1
    if pyseq.startswith("ERROR"):
        if ours:
            fails.append(("pydna-none", c["id"], 0, pyseq, ours[0][:60]))
    else:
        if pyseq not in ours:
            fails.append(("pydna", c["id"], 0, pyseq, ours[0] if ours else "<no product>"))

print(f"assembly-oracle comparisons: {checked_a}")
print(f"pydna comparisons: {checked_b}")
print(f"failures: {len(fails)}")
for kind, cid, pi, want, got in fails[:15]:
    print("----", kind, cid, pi)
    print("  want", len(want), want[:120])
    print("  got ", len(got), got[:120])
