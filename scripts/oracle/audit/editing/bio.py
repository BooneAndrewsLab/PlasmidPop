import json, collections, warnings
warnings.filterwarnings('ignore')
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord
from Bio.SeqFeature import SeqFeature, SimpleLocation, CompoundLocation
from pydna.dseqrecord import Dseqrecord

def loc(f, L):
    parts = []
    strand = -1 if f['strand'] == 'reverse' else 1
    for s in f['segments']:
        if s['kind'] != 'range': continue
        if s['end'] <= L: parts.append(SimpleLocation(s['start'], s['end'], strand))
        else: parts += [SimpleLocation(s['start'], L, strand), SimpleLocation(0, s['end'] - L, strand)]
    if strand == -1: parts = parts[::-1]  # biopython: reading order for minus strand
    return parts[0] if len(parts) == 1 else CompoundLocation(parts)

def fseq(f, seq):
    return str(SeqFeature(loc(f, len(seq))).extract(Seq(seq)))

st = collections.Counter()
for c in json.load(open('single.json')):
    if c.get('kind') not in ('reverseComplement', 'setOrigin') or 'error' in c: continue
    b, a = c['before'], c['after']
    L = len(b['seq'])
    rec = SeqRecord(Seq(b['seq']), features=[SeqFeature(loc(f, L), type=f['type'], id=f['id']) for f in b['features']])
    if c['kind'] == 'reverseComplement':
        out = rec.reverse_complement(features=True)
        oseq = str(out.seq)
        ofs = {f.id: str(f.extract(out.seq)) for f in out.features}
    else:
        d = Dseqrecord(b['seq'], circular=True)
        d.features = rec.features
        out = d.shifted(c['op']['position'])
        oseq = str(out.seq)
        ofs = {}
        for f in out.features:
            ofs[f.id] = str(f.extract(Seq(oseq)))
    if oseq != a['seq']:
        st['seq_fail_' + c['kind']] += 1; continue
    for f in a['features']:
        mine = fseq(f, a['seq'])
        if f['id'] not in ofs:
            st['missing_' + c['kind']] += 1
        elif ofs[f['id']] != mine:
            st['feat_fail_' + c['kind']] += 1
            if st['feat_fail_' + c['kind']] < 3: print(c['n'], f['id'], f['segments'], ofs[f['id']][:20], mine[:20])
        else:
            st['ok_' + c['kind']] += 1
print(dict(st))
