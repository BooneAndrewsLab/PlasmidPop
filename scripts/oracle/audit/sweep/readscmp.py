import json, sys
from Bio import SeqIO
D = sys.argv[1]
pp = json.load(open(D + '/fastq-pp.json'))
for f, r in sorted(pp.items()):
    fmt = 'fastq-solexa' if 'solexa' in f and ('as_solexa' in f or 'original_solexa' in f or 'solexa_example' in f or 'solexa_faked' in f) else 'fastq-illumina' if ('as_illumina' in f or 'original_illumina' in f or 'illumina_faked' in f) else 'fastq'
    try:
        bio = [(x.id, str(x.seq), x.letter_annotations['phred_quality']) for x in SeqIO.parse(f'{D}/bio/repo/Tests/Quality/{f}', 'fastq')]
        berr = None
    except Exception as e:
        bio, berr = None, str(e)[:80]
    if 'error' in r:
        status = 'both refuse' if berr else 'PP REFUSES, bio reads'
        print(f'{f:45} {status}: pp={r["error"][:70]!r} bio={berr!r}')
        continue
    if berr:
        print(f'{f:45} PP READS, bio refuses ({berr!r}); pp warnings={r["warnings"][:3]}')
        continue
    recs = r['records']
    bad = []
    if len(recs) != len(bio): bad.append(f'count {len(recs)} vs {len(bio)}')
    for a, (bid, bseq, bq) in zip(recs, bio):
        exp = bseq.upper().replace('U', 'T').replace('-', 'N').replace('.', 'N')
        if a['seq'] != exp: bad.append(f'seq {bid}: {a["seq"][:30]} vs {exp[:30]}')
        if a['q'] != bq: bad.append(f'qual {bid}: {a["q"][:8]} vs {bq[:8]}')
        if a['id'] != bid: bad.append(f'id {a["id"]} vs {bid}')
    print(f'{f:45} {"OK" if not bad else "DIFF"} n={len(recs)} {bad[:3]} warn={r["warnings"][:2]}')

pa = json.load(open(D + '/abif-pp.json'))
for f, r in sorted(pa.items()):
    try:
        x = SeqIO.read(f'{D}/bio/repo/Tests/Abi/{f}', 'abi')
        bseq, bq = str(x.seq), x.letter_annotations.get('phred_quality', [])
        raw = x.annotations['abif_raw']
        info = {k: (raw[k] if isinstance(raw[k], (bytes,str)) and len(raw[k]) < 10 else len(raw[k]) if hasattr(raw[k], '__len__') else raw[k]) for k in ('PBAS1','PBAS2','PCON1','PCON2') if k in raw}
        same12 = raw.get('PBAS1') == raw.get('PBAS2')
    except Exception as e:
        print(f'{f:20} bio error {e!s:.60} pp={r.get("error","read")[:60]}'); continue
    if 'error' in r: print(f'{f:20} PP refuses: {r["error"][:70]}; bio len {len(bseq)}'); continue
    a = r['records'][0]
    print(f'{f:20} seq {"OK" if a["seq"]==bseq.upper() else "DIFF"} qual {"OK" if a["q"]==list(bq) else "DIFF pp%d bio%d"%(len(a["q"]),len(bq))} PBAS1==PBAS2 {same12} tags {info} warn {r["warnings"]}')
