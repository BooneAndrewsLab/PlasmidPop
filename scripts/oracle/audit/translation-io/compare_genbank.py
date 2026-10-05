"""Compare PlasmidPop's GenBank parse/translate dump (out/*.json) with
Biopython's parse of the same files, the stored /translation qualifiers, and
Biopython's parse of PlasmidPop's re-written files (out/*.pp.gb)."""
import json, os, sys, hashlib, warnings
from Bio import SeqIO
from Bio.SeqFeature import BeforePosition, AfterPosition, CompoundLocation
from Bio.Seq import Seq
from Bio import BiopythonParserWarning
warnings.simplefilter('ignore')

S = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/translation-io'
DIRS = [S + '/gb', S + '/biopy/GenBank']
OUT = S + '/out'

stats = dict(records=0, seq_ok=0, seq_bad=0, feat_ok=0, feat_bad=0, feat_count_bad=0,
             cds_total=0, cds_compared=0, cds_ok=0, cds_bad=0, cds_skipped=0,
             rt_records=0, rt_seq_ok=0, rt_seq_bad=0, rt_feat_ok=0, rt_feat_bad=0, rt_fail=0,
             bio_vs_stored_bad=0)
cds_bad = []
feat_bad = []
rt_bad = []
seq_bad = []


def pieces_of(loc):
    parts = loc.parts if isinstance(loc, CompoundLocation) else [loc]
    out = []
    for p in parts:
        out.append([int(p.start), int(p.end)])
    return out


def strand_of(loc):
    s = loc.strand
    return 'reverse' if s == -1 else 'forward'


def bio_feats(rec):
    res = []
    for f in rec.features:
        loc = f.location
        if loc is None:
            res.append(None)
            continue
        parts = loc.parts if isinstance(loc, CompoundLocation) else [loc]
        ps = isinstance(parts[0].start, BeforePosition) if loc.strand != -1 else isinstance(parts[-1].start, BeforePosition)
        pe = isinstance(parts[-1].end, AfterPosition) if loc.strand != -1 else isinstance(parts[0].end, AfterPosition)
        # For reverse compound locations biopython lists parts in reading (descending) order
        pieces = sorted(pieces_of(loc)) if len(parts) > 1 else pieces_of(loc)
        res.append(dict(type=f.type, strand=strand_of(loc), pieces=pieces,
                        partialStart=any(isinstance(p.start, BeforePosition) for p in parts),
                        partialEnd=any(isinstance(p.end, AfterPosition) for p in parts),
                        operator=loc.operator if isinstance(loc, CompoundLocation) else None,
                        locstr=str(loc), feature=f))
    return res


def norm_pieces(pieces):
    return sorted(tuple(p) for p in pieces)


for dir_ in DIRS:
    for name in sorted(os.listdir(dir_)):
        if not name.split('.')[-1] in ('gb', 'gbk', 'gp', 'gbwithparts'):
            continue
        jpath = f'{OUT}/{name}.json'
        if not os.path.exists(jpath):
            print('no dump for', name)
            continue
        pp = json.load(open(jpath))
        try:
            recs = list(SeqIO.parse(f'{dir_}/{name}', 'genbank'))
        except Exception as e:
            print('Biopython failed on', name, e)
            continue
        if len(recs) != len(pp):
            print(f'{name}: record count biopython {len(recs)} vs pp {len(pp)}')
        for rec, doc in zip(recs, pp):
            stats['records'] += 1
            try:
                bseq = str(rec.seq).upper()
            except Exception:
                bseq = None
            if bseq is None:
                if doc['length'] != 0:
                    seq_bad.append((name, rec.id, 'bio undefined seq, pp length', doc['length']))
            else:
                h = hashlib.sha1(bseq.encode()).hexdigest()
                if h == doc['sha1'] and len(bseq) == doc['length']:
                    stats['seq_ok'] += 1
                else:
                    stats['seq_bad'] += 1
                    seq_bad.append((name, rec.id, len(bseq), doc['length']))
            # features: match by (type, pieces) multiset
            bf = [f for f in bio_feats(rec) if f is not None]
            pf = doc['features']
            if len(bf) != len(pf):
                stats['feat_count_bad'] += 1
                feat_bad.append((name, rec.id, 'count', len(bf), len(pf)))
            # index-wise comparison where counts match, else by key
            bkeys = {}
            for f in bf:
                bkeys.setdefault((f['type'], tuple(norm_pieces(f['pieces']))), []).append(f)
            for f in pf:
                key = (f['type'], tuple(norm_pieces(f['pieces'])))
                cands = bkeys.get(key)
                if not cands:
                    # site features: biopython represents a^b as location between? check
                    if f['sites']:
                        # Biopython: 'a^b' -> SimpleLocation(a, a) zero length? it is a..a? skip to inspect
                        cand2 = [b for b in bf if b['type'] == f['type'] and b['pieces'] and b['pieces'][0][1] - b['pieces'][0][0] <= 1 and (b['pieces'][0][0] == f['sites'][0] or b['pieces'][0][1] == f['sites'][0])]
                        if cand2:
                            stats['feat_ok'] += 1
                            continue
                    stats['feat_bad'] += 1
                    feat_bad.append((name, rec.id, f['type'], f['location'], f['pieces'][:4], [ (b['locstr'][:80]) for b in bf if b['type'] == f['type'] and b['pieces'] and abs(b['pieces'][0][0] - (f['pieces'][0][0] if f['pieces'] else -99)) < 5][:2]))
                    continue
                b = cands.pop(0)
                ok = True
                if b['strand'] != f['strand']:
                    ok = False
                if bool(b['partialStart']) != bool(f['partialStart'] or False) or bool(b['partialEnd']) != bool(f['partialEnd'] or False):
                    # partial on a reverse strand: compare any-partial
                    ok = False
                if (b['operator'] == 'order') != (f['joining'] == 'order'):
                    ok = False
                if ok:
                    stats['feat_ok'] += 1
                else:
                    stats['feat_bad'] += 1
                    feat_bad.append((name, rec.id, f['type'], f['location'], 'strand/partial/op', b['strand'], f['strand'], b['partialStart'], f['partialStart'], b['partialEnd'], f['partialEnd'], b['operator'], f['joining']))
            # CDS translations
            bcds = [f for f in bf if f['type'] == 'CDS']
            for c in doc['cds']:
                stats['cds_total'] += 1
                if c['stored'] is None:
                    stats['cds_skipped'] += 1
                    continue
                if c['exception'] or c['ribosomal_slippage'] or c['pseudo']:
                    stats['cds_skipped'] += 1
                    continue
                stored = c['stored'].replace(' ', '')
                ours = c['protein']
                if ours.endswith('*'):
                    ours = ours[:-1]
                stats['cds_compared'] += 1
                # excuse X on either side
                same = len(ours) == len(stored) and all(a == b or a == 'X' or b == 'X' for a, b in zip(ours, stored))
                if same:
                    stats['cds_ok'] += 1
                else:
                    stats['cds_bad'] += 1
                    # biopython's own translation for reference
                    bio_tr = None
                    for b in bcds:
                        if b['feature'].qualifiers.get('translation', [None])[0] == c['stored']:
                            try:
                                bio_tr = str(b['feature'].translate(rec.seq, cds=False))
                            except Exception as e:
                                bio_tr = 'ERR ' + str(e)[:60]
                            break
                    diff_at = next((i for i, (a, b) in enumerate(zip(ours, stored)) if a != b and a != 'X' and b != 'X'), min(len(ours), len(stored)))
                    cds_bad.append(dict(file=name, rec=rec.id, loc=c['location'][:120], codon_start=c['codon_start'], table=c['transl_table'], transl_except=c['transl_except'], unused=c['unusedExceptions'],
                                        diff_at=diff_at, ours=ours[max(0, diff_at - 5):diff_at + 10], stored=stored[max(0, diff_at - 5):diff_at + 10], len_ours=len(ours), len_stored=len(stored), bio=(bio_tr or '')[max(0, diff_at - 5):diff_at + 10], bio_len=len(bio_tr or '')))
        # ---- round trip
        rt = f'{OUT}/{name}.pp.gb'
        if os.path.exists(rt):
            try:
                rrecs = list(SeqIO.parse(rt, 'genbank'))
            except Exception as e:
                stats['rt_fail'] += 1
                rt_bad.append((name, 'biopython cannot read rewritten file', str(e)[:200]))
                rrecs = []
            for rec, rrec, doc in zip(recs, rrecs, pp):
                stats['rt_records'] += 1
                try:
                    a = str(rec.seq).upper()
                except Exception:
                    a = ''
                b = str(rrec.seq).upper()
                if a == b:
                    stats['rt_seq_ok'] += 1
                else:
                    stats['rt_seq_bad'] += 1
                    rt_bad.append((name, rec.id, 'sequence differs', len(a), len(b)))
                if rrec.annotations.get('topology') != rec.annotations.get('topology'):
                    rt_bad.append((name, rec.id, 'topology', rec.annotations.get('topology'), rrec.annotations.get('topology')))
                rf = [f for f in bio_feats(rrec) if f is not None]
                # compare rewritten features with PlasmidPop's own dump (what it meant to write)
                rkeys = {}
                for f in rf:
                    rkeys.setdefault((f['type'], tuple(norm_pieces(f['pieces'])), f['strand']), []).append(f)
                for f in doc['features']:
                    if f['sites']:
                        continue
                    key = (f['type'], tuple(norm_pieces(f['pieces'])), f['strand'])
                    cands = rkeys.get(key)
                    if not cands:
                        stats['rt_feat_bad'] += 1
                        rt_bad.append((name, rec.id, 'feature lost/changed after rewrite', f['type'], f['location'][:100], [x['locstr'][:100] for x in rf if x['type'] == f['type'] and x['pieces'] and f['pieces'] and abs(x['pieces'][0][0] - f['pieces'][0][0]) < 5][:2]))
                        continue
                    r = cands.pop(0)
                    if bool(r['partialStart']) != bool(f['partialStart'] or False) or bool(r['partialEnd']) != bool(f['partialEnd'] or False) or (r['operator'] == 'order') != (f['joining'] == 'order'):
                        stats['rt_feat_bad'] += 1
                        rt_bad.append((name, rec.id, 'partial/op changed after rewrite', f['type'], f['location'][:100], r['locstr'][:100]))
                    else:
                        stats['rt_feat_ok'] += 1

print(json.dumps(stats, indent=1))
print('\n=== sequence mismatches ===')
for x in seq_bad:
    print(x)
print('\n=== feature mismatches (first 60) ===')
for x in feat_bad[:60]:
    print(x)
print('\n=== CDS translation mismatches ===')
for x in cds_bad:
    print(json.dumps(x))
print('\n=== round-trip problems (first 60) ===')
for x in rt_bad[:60]:
    print(x)
json.dump(dict(stats=stats, cds_bad=cds_bad, feat_bad=feat_bad, rt_bad=rt_bad, seq_bad=seq_bad), open(OUT + '/compare_genbank_result.json', 'w'), indent=1, default=str)
