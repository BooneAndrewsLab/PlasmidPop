"""Biopython's reading of every .dna file under a directory, as JSON.

For checking our SnapGene reader against a local SnapGene installation's
bundled files, which cannot be committed:
    scripts/oracle/run.sh snapgene-local [dir]
"""
import glob
import json
import os
import sys
import warnings

from Bio import SeqIO

warnings.simplefilter('ignore')


def main(root, out_path):
    out = []
    for path in sorted(glob.glob(os.path.join(root, '**', '*.dna'), recursive=True)):
        record = SeqIO.read(path, 'snapgene')
        out.append(
            {
                'file': path,
                'length': len(record.seq),
                'sequence': str(record.seq),
                'topology': record.annotations.get('topology', 'linear'),
                'features': [
                    {
                        'type': f.type,
                        'strand': {1: 'forward', -1: 'reverse'}.get(f.location.strand, 'none'),
                        'parts': [[int(p.start), int(p.end)] for p in f.location.parts],
                        'label': (f.qualifiers.get('label') or [''])[0],
                    }
                    for f in record.features
                ],
            }
        )
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'files': out}, f)
    print(f'{len(out)} files read by Biopython')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
