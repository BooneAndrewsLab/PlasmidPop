"""CDS translations, for src/test/oracle/cds.json.

NCBI writes the protein it derived from each coding sequence into the record
as /translation. That is the authority; this file lists, for every CDS with a
/protein_id in the repository's NCBI fixtures (src/io/fixtures/*.gb) and in
src/test/oracle/ncbi-cds.gbk (nineteen small real records picked to cover
/codon_start 2 and 3, /transl_table 2, 4, 5 and 9, complement, multi-exon
join, partial ends and a 3'-partial CDS cut short after two bases of its
last codon), the translation PlasmidPop has to reproduce.

Biopython is the second opinion: it extracts the CDS and translates it with
the record's table, and the generator notes whether it reaches NCBI's
answer. Biopython drops the two bases that end a 3'-partial CDS cut short;
NCBI translates them when every completion codes the same residue (GT is
valine, CC proline), so the second opinion pads them with N and keeps the
residue when it is not X, as NCBI does (issue #142). A trans-spliced CDS
(join over several records or order()), which the location model does not
cover, is left out; none is present.
"""
import glob
import os
import warnings

from Bio import SeqIO
from Bio.Data import CodonTable
from Bio.Seq import Seq
from Bio.SeqFeature import AfterPosition, BeforePosition

from common import FIXTURES, ROOT

NCBI_CDS = os.path.join(ROOT, 'src', 'test', 'oracle', 'ncbi-cds.gbk')

warnings.simplefilter('ignore')


def cds_sequence(record, feature):
    seq = feature.extract(record.seq)
    start = int(feature.qualifiers.get('codon_start', ['1'])[0]) - 1
    return seq[start:]


def three_prime_partial(feature):
    parts = feature.location.parts  # in reading order, the reverse strand's too
    if feature.location.strand == -1:
        return isinstance(parts[-1].start, BeforePosition)
    return isinstance(parts[-1].end, AfterPosition)


def biopython_translation(record, feature):
    table_id = int(feature.qualifiers.get('transl_table', ['1'])[0])
    full = cds_sequence(record, feature)
    seq = full[: len(full) - len(full) % 3]
    protein = str(seq.translate(table=table_id))
    if len(full) % 3 == 2 and three_prime_partial(feature):
        last = str((full[-2:] + 'N').translate(table=table_id))
        if last != 'X':
            protein += last
    if protein.endswith('*'):
        protein = protein[:-1]
    # a complete 5' end starts with Met whatever start codon the table allows
    location_text = str(feature.location)
    if '<' not in location_text and str(seq[:3]) in CodonTable.unambiguous_dna_by_id[table_id].start_codons:
        protein = 'M' + protein[1:]
    return protein


def sources():
    out = []
    for path in sorted(glob.glob(os.path.join(FIXTURES, '*.gb'))):
        out.append((os.path.basename(path), 'fixture', path))
    out.append((os.path.basename(NCBI_CDS), 'oracle', NCBI_CDS))
    return out


def generate():
    cases = []
    disagreements = []
    for name, where, path in sources():
        for index, record in enumerate(SeqIO.parse(path, 'genbank')):
            for feature in record.features:
                if feature.type != 'CDS' or 'translation' not in feature.qualifiers:
                    continue
                protein_id = feature.qualifiers.get('protein_id', [None])[0]
                if protein_id is None:
                    continue
                expected = feature.qualifiers['translation'][0].replace(' ', '')
                ours = biopython_translation(record, feature)
                label = f'{record.id} {protein_id}'
                if ours != expected:
                    # Biopython does not apply /transl_except (selenocysteine, completed stops)
                    if 'transl_except' not in feature.qualifiers:
                        disagreements.append(label)
                cases.append({
                    'file': name, 'where': where, 'record': index, 'recordId': record.id,
                    'proteinId': protein_id, 'location': str(feature.location),
                    'codonStart': int(feature.qualifiers.get('codon_start', ['1'])[0]),
                    'translTable': int(feature.qualifiers.get('transl_table', ['1'])[0]),
                    'translation': expected,
                    'translExcept': 'transl_except' in feature.qualifiers,
                    'biopythonAgrees': ours == expected,
                    'partCodon': len(cds_sequence(record, feature)) % 3 == 2 and three_prime_partial(feature),
                })
    assert not disagreements, f'Biopython and NCBI disagree on {disagreements}'
    return {'cases': cases}
