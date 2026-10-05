"""Compare PlasmidPop gateway() products with pydna's, circle-invariantly."""

import json
from Bio.Seq import Seq

HERE = "/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/pcr-gateway"

cases = json.load(open(f"{HERE}/gateway-cases.json"))
results = json.load(open(f"{HERE}/gateway-results.json"))
byid = {r["id"]: r for r in results}


def rc(s):
    return str(Seq(s).reverse_complement())


def canon_circle(s):
    """Smallest rotation of s or rc(s) — a canonical form for a circular molecule."""
    s = s.upper()
    best = None
    for t in (s, rc(s)):
        d = t + t
        for i in range(len(t)):
            r = d[i:i + len(t)]
            if best is None or r < best:
                best = r
    return best


def canon_linear(s):
    s = s.upper()
    return min(s, rc(s))


fails = 0
for c in cases:
    r = byid[c["id"]]
    print("=" * 70)
    print(c["id"], c["reaction"], "problem:", r["problem"])
    if r["problem"]:
        print("  !! PlasmidPop refused; pydna gave", [len(p) for p in c["pydna"]])
        fails += 1
        continue
    ours = []
    for key in ("product", "byproduct"):
        if r[key]:
            ours.append((key, r[key]["sequence"], r[key]["circular"]))
    print("  pydna  lengths:", sorted(len(p) for p in c["pydna"]))
    print("  ours   lengths:", sorted(len(s) for _, s, _ in ours))
    pyset = {canon_circle(p): len(p) for p in c["pydna"]}
    for key, seq, circ in ours:
        cf = canon_circle(seq) if circ else canon_linear(seq)
        hit = cf in pyset
        print(f"  {key}: {len(seq)} bp circular={circ} matches pydna: {hit}")
        if not hit:
            fails += 1
            # closest by length
            for p in c["pydna"]:
                if len(p) == len(seq):
                    print("    same length as a pydna product but different sequence")
            print("    ours   :", seq[:80])
            print("    pydna's:", [p[:80] for p in c["pydna"]])
    # conservation of mass
    tot_in = len(c["insert"]["sequence"]) + len(c["vector"]["sequence"])
    tot_out = sum(len(s) for _, s, _ in ours)
    print(f"  mass: in {tot_in}, out {tot_out}",
          "(byproduct absent for a linear substrate)" if not c["insert"]["circular"] else
          ("OK" if tot_in == tot_out else "!! MISMATCH"))
    if c["insert"]["circular"] and tot_in != tot_out:
        fails += 1
    print("  warnings:", r["warnings"])
    if r["product"]:
        print("  product features:",
              [(f["name"], f["segments"]) for f in r["product"]["features"]])

print("=" * 70)
print("FAILURES:", fails)
