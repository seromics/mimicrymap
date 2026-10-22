"""Recover literal assay source identity from its retained, keyed FASTA header.

This does not establish current taxonomy or alter sequence membership.
"""
import re


def validate_record(record, source=None, library=None, header=None):
    """Reject cross-record metadata before new mappings are written or published."""
    actual = next((record.get(k) for k in ('raw_header', 'header', 'seqid', 'source_header') if record.get(k)), '').lstrip('>').strip()
    key = source or record.get('assay_id') or record.get('protein_id') or ''
    def fail(field):
        raise ValueError('Sequence record identity conflict (' + field + '): ' + str(key))
    if header is not None and actual != header.lstrip('>').strip():
        fail('FASTA header')
    aliases = {'builtin-human':'human_swissprot', 'canonical_human':'human_swissprot', 'builtin-viral120':'atlas_120_viruses', 'builtin-virscan':'virscan_exposome_current', 'builtin-huscan':'human_current', 'builtin-huprot':'huprot4', 'builtin-exposure':'canonical_exposure', 'builtin-nonvertebrate':'canonical_exposure_no_vertebrates'}
    stated = record.get('library_id') or record.get('library_key')
    if library and stated and aliases.get(stated, stated) != aliases.get(library, library):
        fail('library')
    fields = actual.split('|')
    accession_pattern = r'(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?'
    tagged = re.search(r'^(?:sp|tr)\|([^|]+)\||(?:^|\|)UniProt=([^|]+)', actual)
    accession = next((v for v in tagged.groups() if v), '') if tagged else ''
    first = fields[0].strip().split()[0] if fields[0].strip() else ''
    if not accession and re.fullmatch(accession_pattern, first):accession = first
    if re.fullmatch(r'JHU[A-Za-z0-9._-]+', fields[0]):
        for value in (source, record.get('assay_id'), record.get('source_id')):
            if value and str(value).split('|')[0] != fields[0]:fail('source ID')
        if not accession and len(fields)>2 and re.fullmatch(accession_pattern, fields[2]):accession = fields[2]
    if re.fullmatch(accession_pattern, accession):
        for field in ('source_accession','accession'):
            if record.get(field) and record[field] != accession:fail(field)
    if len(fields) != 5 or not re.fullmatch(r'CDI[HVE]\w+', fields[0], re.I) or not re.fullmatch(r'Seq[_ -]?\d+', fields[4], re.I):
        return record
    for value in (source, record.get('assay_id'), record.get('source_id')):
        if value and str(value).split('|')[0] != fields[0]:
            fail('source ID')
    clean = lambda value: ' '.join(str(value).replace('_', ' ').split())
    organism = clean(fields[3 if fields[0].upper().startswith('CDIH') else 1])
    for field in ('source_accession', 'accession'):
        if record.get(field) and record[field] != fields[2]:
            fail(field)
    for field in ('organism', 'species'):
        if record.get(field) and clean(record[field]) != organism:
            fail(field)
    return record


def recorded_source_metadata(record):
    header = next((record.get(k) for k in ('raw_header', 'header', 'seqid', 'source_header') if record.get(k)), '')
    fields = str(header).lstrip('>').split('|')
    if len(fields) != 5 or not re.fullmatch(r'CDI[HVE]\w+', fields[0], re.I) or not re.fullmatch(r'Seq[_ -]?\d+', fields[4], re.I):
        return record
    source = record.get('assay_id') or record.get('source_id')
    if source and str(source).upper().startswith('CDI') and source != fields[0]:
        return record
    human = fields[0].upper().startswith('CDIH')
    clean = lambda value: ' '.join(str(value or '').replace('_', ' ').split())
    organism = clean(fields[3 if human else 1])
    previous = clean(record.get('organism') or record.get('species'))
    tax = '9606' if human else str(record.get('taxid') or record.get('organism_taxid') or '') if not previous or previous == organism else ''
    taxonomy = '' if human else fields[3]
    family, _, genus = taxonomy.partition('_')
    label = organism + ' [TaxID: ' + (tax or 'not supplied') + ']'
    return dict(record, accession=fields[2], source_accession=fields[2], organism=organism, species=organism,
                taxid=tax, organism_taxid=tax, taxonomy_id=tax, family_genus=taxonomy, family=family, genus=genus,
                organism_taxon_label=label, reference_set=label)
