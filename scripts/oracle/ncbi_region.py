"""Oracle for a stretch of an NCBI record fetched by range (#299, item 58).

Fetches one real region through Biopython's `Entrez.efetch` with the same
`seq_start`/`seq_stop`/`strand` the app sends, parses it with Biopython, and
writes what it saw to `src/test/oracle/ncbi-region.json`: the sequence, the
LOCUS name and topology, the ACCESSION line, and every feature's type,
strand and location with its partial (`<`/`>`) marks. The GenBank text
itself is saved beside the app's fixtures as the answer the app's parser
reads, so `src/test/oracle/ncbi-region.test.ts` compares the two without
the network.

This hits NCBI, so it is not part of `generate.py`; run it by hand:
    scripts/oracle/run.sh ncbi-region
"""
import json
import os
import sys
import warnings

import Bio
from Bio import Entrez, SeqIO
from Bio.SeqFeature import CompoundLocation, SimpleLocation

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'test', 'oracle', 'ncbi-region.json')
FIXTURE = os.path.join(ROOT, 'src', 'io', 'fixtures', 'NC_001136.10_57065-60605_minus.gb')

# Yeast HBT1 (Gene 851303): esummary places it at NC_001136.10 chrstart
# 60404, chrstop 57264 (0-based, reverse strand), i.e. complement(57265..60405)
# in GenBank's 1-based terms. With 200 bp of flank each side along the gene
# (upstream is the higher coordinates on the reverse strand) the window is
# 57065..60605, fetched as the minus strand so the gene reads 5' to 3'.
REGION = {'accession': 'NC_001136.10', 'start': 57065, 'stop': 60605, 'strand': 'reverse'}

# NCBI's usage policy asks for `tool`; `email` is for the tool's developer,
# and this script runs on the maintainer's machine only.
Entrez.tool = 'PlasmidPop-oracle'


def location(loc):
    """A Biopython location as segments of 1-based inclusive positions with partial marks."""
    parts = loc.parts if isinstance(loc, CompoundLocation) else [loc]
    segments = []
    for p in parts:
        assert isinstance(p, SimpleLocation)
        segments.append(
            {
                'start': int(p.start) + 1,
                'end': int(p.end),
                'strand': p.strand,
                'partialStart': p.start.__class__.__name__ == 'BeforePosition',
                'partialEnd': p.end.__class__.__name__ == 'AfterPosition',
            }
        )
    return {'operator': loc.operator if isinstance(loc, CompoundLocation) else None, 'segments': segments}


def main():
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        handle = Entrez.efetch(
            db='nuccore',
            id=REGION['accession'],
            seq_start=REGION['start'],
            seq_stop=REGION['stop'],
            strand=2 if REGION['strand'] == 'reverse' else 1,
            rettype='gbwithparts',
            retmode='text',
        )
        text = handle.read()
        handle.close()
    with open(FIXTURE, 'w', newline='\n') as f:
        f.write(text)
    record = SeqIO.read(FIXTURE, 'genbank')
    accession_line = next(
        (line for line in text.splitlines() if line.startswith('ACCESSION')), ''
    )
    data = {
        'biopython': Bio.__version__,
        'region': REGION,
        'fixture': os.path.basename(FIXTURE),
        'name': record.name,
        'accession': accession_line[len('ACCESSION'):].strip(),
        'topology': record.annotations.get('topology'),
        'length': len(record.seq),
        'sequence': str(record.seq).upper(),
        'features': [
            {
                'type': f.type,
                'location': location(f.location),
                'gene': f.qualifiers.get('gene', [None])[0],
            }
            for f in record.features
        ],
    }
    with open(OUT, 'w') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    print(f'wrote {OUT} ({len(record.features)} features, {len(record.seq)} bp) and {FIXTURE}')


if __name__ == '__main__':
    sys.exit(main())
