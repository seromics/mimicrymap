"""Slice complete paired atlas CSV packages by recorded proteome, without matching.

Build into an external staging directory. --publish binds verified completed
packages to the public manifest; it never changes installed modules or studies.
"""
import argparse, collections, concurrent.futures, csv, hashlib, io, json, os, re, sqlite3, time, zipfile
from pathlib import Path
from build_pan_viral_pairs import split_escaped, unescape

ROOT = Path(__file__).resolve().parents[1]
PREFIX = '/source-downloads/mimicry-summaries/selected/'
HUMAN = 'human_swissprot_vs_atlas_120_viruses'
VIRAL = 'atlas_120_viruses_vs_human_swissprot'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.pending')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def csv_bytes(rows, columns):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader(); writer.writerows(rows)
    return stream.getvalue().encode('utf-8-sig')


def parts(cell):
    return split_escaped(cell, ';') if cell else []


def accession(entry, allowed):
    sides = split_escaped(entry, '@')
    if len(sides) != 2:
        raise ValueError('Invalid paired summary entry')
    found = {unescape(x) for x in split_escaped(sides[0], '|')} & allowed
    if len(found) != 1:
        raise ValueError('Ambiguous source record: ' + sides[0])
    return found.pop()


def build(front, out, atlas_index, workers=4, coverage_database=None):
    csv.field_size_limit(2**31 - 1)
    web = json.loads((front / 'summary-downloads.json').read_text('utf-8'))
    rows = web['comprehensive_summaries']['rows']
    source = rows[HUMAN]['archives']['summary']
    archive = front / source['url'].lstrip('/')
    source_bytes = archive.read_bytes()
    if digest(source_bytes) != source['sha256']:
        raise ValueError('Master summary package differs from its receipt')
    atlas = json.loads(atlas_index.read_text('utf-8'))
    proteomes = sorted(atlas['proteomes'], key=lambda v: v['slug'])
    assert len(proteomes) == 120
    taxa = {str(v['taxon_id']): v for v in proteomes}
    assert len(taxa) == len(proteomes)
    columns = web['comprehensive_summaries']['columns']
    paired = [(f'Mimicry Parents at {floor}/9 with Coverage (%) Parent|Target (>=10% either)',
               f'Mimicry Parent Regions at {floor}/9 Parent|Target (>=10% either)') for floor in (7,8,9)]
    unmatched = [f'Unmatched Target Regions at {floor}/9 (Whole Comparison Library)' for floor in (7,8,9)]
    assert all(c in columns for group in paired for c in group)
    has_unmatched = any(c in columns for c in unmatched)
    if has_unmatched and (not all(c in columns for c in unmatched) or not coverage_database):
        raise ValueError('Selected-virus unmatched regions require complete virus-scoped SQLite unions')
    binding = {'master_sha256': source['sha256'], 'atlas_sha256': digest(atlas_index.read_bytes()),
               'producer_sha256': digest(Path(__file__).read_bytes())}
    out.mkdir(parents=True, exist_ok=True)
    binding_file = out / 'binding.json'
    if binding_file.exists() and json.loads(binding_file.read_text()) != binding:
        raise ValueError('Staging inputs changed; move the previous build aside before rebuilding')
    save(binding_file, binding)
    with zipfile.ZipFile(io.BytesIO(source_bytes)) as z:
        content = {Path(rows[key]['csv']['url']).name: z.read(Path(rows[key]['csv']['url']).name)
                   for key in (HUMAN, VIRAL)}
        content.update({name:z.read(name) for name in ['human_swissprot.fasta','atlas_120_viruses.fasta']})
    for key in (HUMAN, VIRAL):
        name = Path(rows[key]['csv']['url']).name
        if digest(content[name]) != rows[key]['csv']['sha256']:
            raise ValueError('CSV and package source disagree')
    def read_csv(key):
        return list(csv.DictReader(io.StringIO(content[Path(rows[key]['csv']['url']).name].decode('utf-8-sig'))))
    human, viral = read_csv(HUMAN), read_csv(VIRAL)
    human_ids, human_side = {}, None
    if has_unmatched:
        with sqlite3.connect(coverage_database.resolve().as_uri()+'?mode=ro', uri=True) as db:
            for side in (0,1):
                metadata = json.loads(db.execute('SELECT metadata FROM sequence_records WHERE side=? LIMIT 1', (side,)).fetchone()[0])
                if metadata['library_id']=='human_swissprot': human_side=side
            if human_side is None: raise ValueError('No canonical human population in coverage database')
            records = {r[1]:r for r in db.execute('SELECT id,source,sha256,length FROM sequence_records WHERE side=?', (human_side,))}
            if len(records)!=len(human): raise ValueError('Different human population in coverage database')
            for row in human:
                rid, _, key, length = records[row[columns[1]]]
                if length!=len(row[columns[4]]) or digest(row[columns[4]].encode())!=key:
                    raise ValueError('Different human sequence in coverage database')
                human_ids[row[columns[1]]]=rid
    # Retain original source headers and sequences, while selecting the same
    # complete viral record population as the directional table.
    viral_fasta = {}
    for record in re.split(rb'(?m)(?=^>)', content['atlas_120_viruses.fasta']):
        if not record.strip():continue
        accession_id=record.splitlines()[0][1:].split()[0].decode('utf8')
        if accession_id in viral_fasta:raise ValueError('Duplicate viral FASTA accession')
        viral_fasta[accession_id]=record
    assert set(viral_fasta)=={r[columns[1]] for r in viral}
    for row in viral:
        assert ''.join(viral_fasta[row[columns[1]]].decode('utf8').splitlines()[1:])==row[columns[4]]

    assert len(human) == 20431 and len(viral) == 2222
    owners, selected = {}, collections.defaultdict(list)
    for i, row in enumerate(viral):
        tax = re.search(r'\[TaxID: (\d+)\]', row[columns[5]])
        v = taxa[tax[1]]; slug = v['slug']; acc = row[columns[1]]
        assert acc not in owners
        owners[acc] = slug; selected[slug].append(i)
    assert set(selected) == {v['slug'] for v in proteomes}
    # Parse each parent list once. Store the literal coverage and range entries
    # together so filtering cannot detach a percentage from its coordinates.
    partitions = []
    total = collections.Counter()
    for row in human:
        per_virus = {}
        for j, floor in enumerate((7, 8, 9)):
            cov, ranges = parts(row[paired[j][0]]), parts(row[paired[j][1]])
            assert len(cov) == len(ranges)
            for c, r in zip(cov, ranges):
                assert split_escaped(c, '@')[0] == split_escaped(r, '@')[0]
                slug = owners[accession(c, owners.keys())]
                cells = per_virus.setdefault(slug, [[] for _ in range(6)])
                cells[2*j].append(c); cells[2*j+1].append(r); total[str(floor)] += 1
        partitions.append({slug: [';'.join(x) for x in cells] for slug, cells in per_virus.items()})
    assert dict(total) == rows[HUMAN]['listed_pairs']
    old_selected = {v['slug']: v for v in web.get('selected_viruses', {}).get('proteomes', [])}

    def produce(v):
        slug = v['slug']; directory = out / slug; directory.mkdir(exist_ok=True)
        receipt_file = directory / 'receipt.json'
        if receipt_file.exists():
            receipt = json.loads(receipt_file.read_text('utf-8'))
            for entry in [receipt['summary'], receipt['human_to_virus'], receipt['virus_to_human']]:
                p = directory / Path(entry['url']).name
                if not p.exists() or digest(p.read_bytes()) != entry['sha256']:
                    raise ValueError('Incomplete prior output: ' + str(p))
            return receipt
        indices = selected[slug]
        hname = f'selected_{slug}_human_to_virus_comprehensive.csv'
        vname = f'selected_{slug}_virus_to_human_comprehensive.csv'
        scoped = {}
        if has_unmatched:
            scope = 'taxon:'+str(v['taxon_id'])
            with sqlite3.connect(coverage_database.resolve().as_uri()+'?mode=ro', uri=True) as db:
                complete = {r[0] for r in db.execute('SELECT identity FROM library_union_scopes WHERE side=? AND scope=?', (human_side,scope))}
                if not {7,8,9}.issubset(complete): raise ValueError('Incomplete selected-virus coverage: '+slug)
                scoped = {(rid,floor):json.loads(ranges) for rid,floor,ranges in db.execute('SELECT id,identity,ranges FROM library_unions WHERE side=? AND scope=?', (human_side,scope))}
        hr = []
        for row, partition in zip(human, partitions):
            values = dict(row); values[columns[6]] = v['organism'] + ' [TaxID: ' + str(v['taxon_id']) + ']'
            values.update(zip([c for group in paired for c in group], partition.get(slug, [''] * 6)))
            if has_unmatched:
                length = int(row[columns[3]])
                for floor, name in zip((7,8,9),unmatched):
                    start, gaps = 1, []
                    for a,b in scoped.get((human_ids[row[columns[1]]],floor),[]):
                        if start<a: gaps.append(f'{start}..{a-1}')
                        start=b+1
                    if start<=length: gaps.append(f'{start}..{length}')
                    values[name] = 'Not evaluated' if length<9 else '; '.join(gaps) or 'None'
            hr.append(values)
        vr = [viral[i] for i in indices]
        counts = {str(f): sum(len(parts(r[paired[j][0]])) for r in hr) for j, f in enumerate((7, 8, 9))}
        # Compare every pair, percentage and coordinate in both directions.
        forward, reverse = {}, {}
        for j, floor in enumerate((7, 8, 9)):
            for row in hr:
                for c, r in zip(parts(row[paired[j][0]]), parts(row[paired[j][1]])):
                    forward[(row[columns[1]], accession(c, owners.keys()), floor)] = (split_escaped(c, '@')[1].split('|'), split_escaped(r, '@')[1].split('|'))
            for row in vr:
                for c, r in zip(parts(row[paired[j][0]]), parts(row[paired[j][1]])):
                    labels = {unescape(x) for x in split_escaped(split_escaped(c, '@')[0], '|')}
                    matches = labels & human_accessions
                    assert len(matches) == 1
                    reverse[(matches.pop(), row[columns[1]], floor)] = (split_escaped(c, '@')[1].split('|')[::-1], split_escaped(r, '@')[1].split('|')[::-1])
        assert forward == reverse, 'Directional pair mismatch: ' + slug
        # Existing selected exports are an independent check of retained values.
        for name, fresh in [('human_to_virus', hr), ('virus_to_human', vr)]:
            old = old_selected.get(slug, {}).get(name)
            if not old: continue
            with (front / old['url'].lstrip('/')).open(encoding='utf-8-sig', newline='') as f:
                prior = list(csv.DictReader(f))
            assert len(prior) == len(fresh)
            previous_records = {row[columns[1]]: row for row in prior}
            assert len(previous_records) == len(prior)
            for b in fresh:
                a = previous_records[b[columns[1]]]
                assert all(a[k] == b[k] for k in a if k != columns[6]), 'Selected CSV changed existing values: ' + slug
        # Keep the complete population, but make the useful pair/range cells
        # visible immediately when a reader opens either directional CSV.
        has_pairs = lambda row: any(row[c] for c,_ in paired)
        hr.sort(key=lambda row: not has_pairs(row))
        vr.sort(key=lambda row: not has_pairs(row))
        files = {hname: csv_bytes(hr, columns), vname: csv_bytes(vr, columns)}
        descriptors = {name: {'bytes':len(data), 'sha256':digest(data)} for name,data in files.items()}
        files['human_swissprot.fasta']=content['human_swissprot.fasta']
        files[f'selected_{slug}.fasta']=b''.join(viral_fasta[row[columns[1]]] for row in [viral[i] for i in indices])
        files['README.txt'] = (v['label'] + ' ↔ Canonical Human Proteins\n\nBoth directional CSVs retain every target record, including short sequences and records without qualifying pairs. Rows with qualifying pairs come first; records without a listed pair follow. At 7/9, 8/9 and 9/9, Unmatched Target Regions precedes pair coverage and its independent residue ranges. Human-to-virus unmatched regions use only this selected virus, including all matches below the pair-list cutoff. Virus-to-human unmatched regions use the complete human comparison library. None means no unmatched residues; Not evaluated applies below nine residues. Pairs require at least 10% coverage of either sequence. Ranges are one-based inclusive, independent residue unions, not alignment correspondence.\n\nThe FASTAs contain all canonical human proteins and all proteins from the selected viral proteome, respectively. Original source identifiers, annotated headers and sequences are retained. They include records without a listed match.\n\nThese standalone CSVs are sliced from the complete human/120-virus summaries without sequence matching. The separate SeroMap SQLite ZIP provides the mapping database for protein-page tracks and Reactivity Enrichment memberships. The separate atlas figure exports include 5/9–9/9 and use their stated plotted population.\n').encode()
        archive_name = f'selected_{slug}_summary.zip'; temporary = directory / (archive_name + '.pending')
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for name, data in files.items():
                info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, data, compresslevel=6)
        with zipfile.ZipFile(temporary) as z:
            assert z.testzip() is None
            for name, data in files.items(): assert z.read(name) == data
        os.replace(temporary, directory / archive_name)
        receipt = {k:v[k] for k in ('slug','label','organism','taxon_id')}
        for direction, name, data_rows in [('human_to_virus',hname,hr), ('virus_to_human',vname,vr)]:
            (directory / name).write_bytes(files[name])
            receipt[direction] = {'url':PREFIX+name, 'rows':len(data_rows), **descriptors[name], 'columns':len(columns), 'pairFocused':True, 'pairRegions':True, 'listed_pairs':counts}
        receipt['summary'] = {'url':PREFIX+archive_name, 'bytes':(directory/archive_name).stat().st_size,
            'sha256':digest((directory/archive_name).read_bytes()), 'expandedBytes':sum(map(len,files.values())),
            'summary_schema':'mimicryone/native-summary/7', 'bundle':'csv',
            'bidirectional':True, 'pairRegions':True, 'identity':'7/9–9/9', 'layout':'flat', 'sequenceComparisonsRun':False}
        save(receipt_file, receipt)
        return receipt

    human_accessions = {r[columns[1]] for r in human}
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for receipt in pool.map(produce, proteomes):
            results.append(receipt); print(f'{len(results)}/120 {receipt["slug"]} {receipt["summary"]["bytes"]:,} bytes', flush=True)
    result = {'schema':'mimicrymap.selected-virus-summaries/2', 'release_fingerprint':atlas['release_fingerprint'],
              'summary_schema':'mimicryone/native-summary/7', 'columns':columns, 'source':source,
              'sequenceComparisonsRun':False, 'proteomes':results}
    assert {str(f):sum(v['human_to_virus']['listed_pairs'][str(f)] for v in results) for f in (7,8,9)} == dict(total)
    save(out / 'selected-viruses.json', result)
    return result


def publish(front, out, result):
    # The manifest is switched only after all 120 ZIPs and 240 CSVs are complete.
    web_path = front / 'summary-downloads.json'; web = json.loads(web_path.read_text('utf-8'))
    assert web['comprehensive_summaries']['rows'][HUMAN]['archives']['summary']['sha256'] == result['source']['sha256']
    retired = out / 'to delete' / front.parent.parent.name
    for v in result['proteomes']:
        for kind in ('human_to_virus','virus_to_human','summary'):
            item = v[kind]; source = out / v['slug'] / Path(item['url']).name; target = front / item['url'].lstrip('/')
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() and os.path.samefile(source,target): continue
            if target.exists() and digest(target.read_bytes()) != item['sha256']:
                retired.mkdir(parents=True, exist_ok=True); backup = retired / target.name
                if backup.exists(): assert digest(backup.read_bytes()) == digest(target.read_bytes())
                else: os.link(target, backup)
            pending = target.with_name(target.name + '.pending-link')
            if pending.exists(): raise ValueError('Existing publication writer: ' + str(pending))
            os.link(source, pending); os.replace(pending,target)
    web['selected_viruses'] = result; save(web_path,web)


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--atlas-index',type=Path,required=True);p.add_argument('--workers',type=int,default=4)
    p.add_argument('--coverage-database',type=Path,help='Mapping SQLite with complete per-virus library unions')
    p.add_argument('--publish',action='store_true');p.add_argument('--website',type=Path)
    a=p.parse_args();assert 1 <= a.workers <= 4
    a.out=a.out.resolve();a.out.mkdir(parents=True,exist_ok=True);lock=a.out/'build.lock'
    fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY);os.write(fd,str(os.getpid()).encode());os.close(fd)
    try:
        result=build(a.root.resolve()/'frontend',a.out,a.atlas_index,a.workers,a.coverage_database)
        if a.publish:
            publish(a.root.resolve()/'frontend',a.out,result)
            if a.website:publish(a.website.resolve()/'atlas/mimicrymap/frontend',a.out,result)
        print(json.dumps({'complete':len(result['proteomes']),'zipBytes':sum(v['summary']['bytes'] for v in result['proteomes']),'published':a.publish}))
    finally:lock.unlink()
