"""FASTQ reading, for src/test/oracle/fastq.json.

The files in src/io/fixtures/fastq are Biopython's own Tests/Quality files
(Biopython License Agreement, see the NOTICE there), copied unchanged: the
valid ones, which Biopython reads as Sanger FASTQ (ids, bases and Phred
qualities recorded), and the truncated or ragged ones, which it refuses (the
reason it gives is recorded; the test only requires that we refuse too).

Left out: files Biopython refuses and we read (a space, tab, NUL, escape,
DEL or other control character as a quality, a '+' line whose id differs
from the header) and files with a '-' or '.' in the bases, which Biopython
reads and we refuse (#159). Biopython's misc_rna_* files (U for T, which
we read as T with a warning and Biopython keeps) and its gzipped and BGZF
copies are not included.
"""
import glob
import os
import warnings

from Bio import SeqIO

from common import FIXTURES

DIR = os.path.join(FIXTURES, 'fastq')


def generate():
    valid, refused = [], []
    for path in sorted(glob.glob(os.path.join(DIR, '*.fastq'))):
        name = os.path.basename(path)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                records = [
                    {'id': r.id, 'sequence': str(r.seq), 'qualities': r.letter_annotations['phred_quality']}
                    for r in SeqIO.parse(path, 'fastq')
                ]
            valid.append({'file': name, 'records': records})
        except ValueError as e:
            refused.append({'file': name, 'error': str(e).splitlines()[0]})
    return {'valid': valid, 'refused': refused}
