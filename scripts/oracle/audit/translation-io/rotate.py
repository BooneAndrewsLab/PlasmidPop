"""Rotate circular NCBI records so CDS features span the origin, writing
join(x..L,1..y) / complement(join(...)) locations with Biopython. Stored
/translation qualifiers are untouched, so they remain NCBI's oracle."""
import warnings; warnings.simplefilter('ignore')
from Bio import SeqIO
from Bio.SeqFeature import SeqFeature, SimpleLocation, CompoundLocation, ExactPosition, BeforePosition, AfterPosition
from Bio.SeqRecord import SeqRecord

S = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/translation-io'


def shift_loc(loc, k, L):
    """Shift a location left by k (new = old - k mod L); parts crossing the origin split."""
    parts = loc.parts
    new_parts = []
    for p in parts:
        s = (int(p.start) - k) % L
        e = s + (int(p.end) - int(p.start))
        if e <= L:
            sp = BeforePosition(s) if isinstance(p.start, BeforePosition) else ExactPosition(s)
            ep = AfterPosition(e) if isinstance(p.end, AfterPosition) else ExactPosition(e)
            new_parts.append(SimpleLocation(sp, ep, strand=p.strand))
        else:
            # wraps: [s, L) + [0, e-L)
            sp = BeforePosition(s) if isinstance(p.start, BeforePosition) else ExactPosition(s)
            ep = AfterPosition(e - L) if isinstance(p.end, AfterPosition) else ExactPosition(e - L)
            a = SimpleLocation(sp, L, strand=p.strand)
            b = SimpleLocation(0, ep, strand=p.strand)
            if p.strand == -1:
                new_parts.extend([b, a])  # biopython lists reverse compound parts in reading order
            else:
                new_parts.extend([a, b])
    if len(new_parts) == 1:
        return new_parts[0]
    return CompoundLocation(new_parts, operator=loc.operator if isinstance(loc, CompoundLocation) else 'join')


def rotate(rec, k):
    L = len(rec.seq)
    seq = rec.seq[k:] + rec.seq[:k]
    out = SeqRecord(seq, id=rec.id, name=rec.name + 'R', description=rec.description + f' rotated by {k}')
    out.annotations = dict(rec.annotations)
    out.annotations['topology'] = 'circular'
    for f in rec.features:
        if f.type == 'source':
            continue
        nf = SeqFeature(shift_loc(f.location, k, L), type=f.type, qualifiers=dict(f.qualifiers))
        out.features.append(nf)
    return out


for acc, offsets in [('NC_005816.1', None), ('NC_012920.1', None), ('J01749.1', None), ('NC_001224.1', [3, 70, 200])]:
    rec = next(SeqIO.parse(f'{S}/gb/{acc}.gb', 'genbank'))
    L = len(rec.seq)
    cds = [f for f in rec.features if f.type == 'CDS']
    recs = []
    if offsets is None:
        # one rotation per CDS: put origin inside the CDS (at 1/3 of its span, plus 1 to misalign frames)
        for i, f in enumerate(cds):
            span = sorted(int(p.start) for p in f.location.parts)[0]
            k = (span + (int(f.location.end) - int(f.location.start)) // 3 + (i % 3)) % L
            recs.append(rotate(rec, k))
    else:
        for k in offsets:
            # choose a CDS and put the origin k bases into it
            for i, f in enumerate(cds[:6]):
                recs.append(rotate(rec, (int(f.location.start) + k + 1) % L))
    SeqIO.write(recs, f'{S}/gb/rotated_{acc}.gb', 'genbank')
    n_wrap = sum(1 for r in recs for f in r.features if f.type == 'CDS' and len(f.location.parts) > 1 and any(int(p.end) == len(r.seq) for p in f.location.parts))
    print(acc, 'records', len(recs), 'origin-spanning CDS', n_wrap)
