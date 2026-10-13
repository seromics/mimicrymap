"""Derive a bidirectional record-match index from a completed comparison.

Coverage values and window-pair counts are copied exactly. Positions, sequence
strings and duplicated per-match descriptions are not needed by this index.
The original complete lookup is read-only and remains independently usable.
"""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def write_json(file, value):
    file.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf8')


def compact(source, output, coverage_floor=0):
    manifest_file = source / 'comparison.json'
    checkpoint_file = source / 'forward-complete.json'
    if manifest_file.exists():
        manifest = json.loads(manifest_file.read_text('utf8'))
        revision = manifest['files']['comparison.sqlite']['sha256']
    elif checkpoint_file.exists():
        # Forward coverage is committed before this checkpoint. Reverse coverage
        # swaps the two denominators; it does not require positional finalization.
        manifest = json.loads(checkpoint_file.read_text('utf8'))['manifest']
        revision = 'forward:' + hashlib.sha256(checkpoint_file.read_bytes()).hexdigest()
    else:
        raise ValueError('No completed comparison or committed forward checkpoint')
    if not manifest.get('complete') or not manifest.get('bidirectional'):
        raise ValueError('Only a completed bidirectional comparison can be compacted')
    if coverage_floor < manifest.get('coverageFloor', 0):
        raise ValueError('The source does not retain matches below its coverage floor')
    original = source / 'comparison.sqlite'
    receipt = output / 'comparison.json'
    if receipt.exists():
        saved = json.loads(receipt.read_text('utf8'))
        if saved.get('sourceRevision') != revision or saved.get('coverageFloor', 0) != coverage_floor:
            raise ValueError('The destination belongs to a different comparison revision')
        return saved
    output.mkdir(parents=True, exist_ok=True)
    pending = output / 'comparison.sqlite.partial'
    if pending.exists():
        raise ValueError('An unfinished compact index is retained at ' + str(pending))
    db = sqlite3.connect(pending, uri=True)
    try:
        db.execute('PRAGMA journal_mode=OFF')
        db.execute('PRAGMA synchronous=OFF')
        db.execute('PRAGMA temp_store=FILE')
        db.execute('ATTACH DATABASE ? AS original', (original.as_uri() + '?mode=ro',))
        input_compact = bool(manifest.get('relationshipsOnly'))
        input_table = 'matches' if input_compact else 'pairs'
        population = 'sequence_records WHERE side=0' if input_compact else 'results'
        if db.execute('SELECT count(*) FROM original.' + population).fetchone()[0] != manifest['targets']:
            raise ValueError('The committed target population does not match its checkpoint')
        db.executescript('''
          CREATE TABLE sequence_records (
            side INTEGER, id INTEGER, token TEXT, source TEXT, metadata TEXT,
            length INTEGER, sha256 TEXT, PRIMARY KEY(side,id)
          ) WITHOUT ROWID;
          CREATE TABLE matches (
            identity INTEGER, parent INTEGER, target INTEGER, tc REAL, pc REAL,
            pairs INTEGER, PRIMARY KEY(identity,parent,target)
          ) WITHOUT ROWID;
          CREATE TABLE aliases (alias TEXT,target INTEGER,PRIMARY KEY(alias,target)) WITHOUT ROWID;
        ''')
        # Identity display objects repeat fields already in the record metadata.
        # Keep the original header once, along with all non-derived annotations.
        db.execute('''INSERT INTO sequence_records
          SELECT side,id,token,source,
            json_remove(metadata,'$.identity','$.seqid','$.raw_header'),''' + ('length' if input_compact else 'length(sequence)') + ''',sha256
          FROM original.sequence_records''')
        db.execute('INSERT INTO aliases SELECT alias,target FROM original.aliases')
        db.commit()
        for identity in (7, 8, 9):
            db.execute('''INSERT INTO matches
              SELECT identity,parent,target,tc,pc,pairs FROM original.''' + input_table + '''
              WHERE identity=? AND (tc>=? OR pc>=?) ORDER BY parent,target''', (identity,coverage_floor,coverage_floor))
            db.commit()
        if manifest.get('retainsPairRegions'):
            db.execute('CREATE TABLE pair_regions(target INTEGER,parent INTEGER,identity INTEGER,payload BLOB,PRIMARY KEY(target,parent,identity)) WITHOUT ROWID')
            db.execute('''INSERT INTO pair_regions SELECT r.target,r.parent,r.identity,r.payload
              FROM original.pair_regions r JOIN matches m USING(target,parent,identity)
              WHERE m.tc>=10 OR m.pc>=10''')
            if db.execute('SELECT count(*) FROM pair_regions').fetchone()[0] != db.execute('SELECT count(*) FROM matches WHERE tc>=10 OR pc>=10').fetchone()[0]:
                raise ValueError('Incomplete qualifying-pair ranges in compact source')
            db.commit()
        db.executescript('''
          CREATE INDEX target_memberships ON matches(identity,target,parent);
          CREATE INDEX sequence_digest ON sequence_records(side,sha256);
          CREATE INDEX sequence_sources ON sequence_records(side,source);
          CREATE VIEW pairs AS
            SELECT p.target,t.source,p.parent,
              coalesce(json_extract(r.metadata,'$.protein_id'),r.source) protein,
              coalesce(nullif(json_extract(r.metadata,'$.reference_set'),''),
                       nullif(json_extract(r.metadata,'$.organism'),'')) organism,
              p.identity,p.tc,p.pc,p.pairs
            FROM matches p JOIN sequence_records t ON t.side=0 AND t.id=p.target
            JOIN sequence_records r ON r.side=1 AND r.id=p.parent;
          CREATE VIEW reverse_pairs AS
            SELECT p.parent target,r.source,p.target parent,
              coalesce(json_extract(t.metadata,'$.protein_id'),t.source) protein,
              coalesce(nullif(json_extract(t.metadata,'$.reference_set'),''),
                       nullif(json_extract(t.metadata,'$.organism'),'')) organism,
              p.identity,p.pc tc,p.tc pc,p.pairs
            FROM matches p JOIN sequence_records t ON t.side=0 AND t.id=p.target
            JOIN sequence_records r ON r.side=1 AND r.id=p.parent;
          ANALYZE main;
        ''')
        rows = db.execute('SELECT count(*) FROM matches').fetchone()[0]
        expected = db.execute('SELECT count(*) FROM original.' + input_table + ' WHERE tc>=? OR pc>=?', (coverage_floor, coverage_floor)).fetchone()[0]
        if rows != expected:
            raise ValueError('Coverage row count changed while compacting')
    finally:
        db.close()
    final = output / 'comparison.sqlite'
    pending.replace(final)
    with final.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    result = {**manifest, 'relationshipsOnly': True, 'retainsPositions': False,
              'coverageFloor': coverage_floor, 'coverageSide': 'either', 'featureOnly': coverage_floor > 0, 'pairs': rows,
              'output': 'candidate-index', 'sourceRevision': revision,
              'files': {'comparison.sqlite': {'bytes': final.stat().st_size, 'sha256': checksum}}}
    result.pop('coordinateStorage', None)
    result.pop('positions', None)
    write_json(receipt, result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--coverage-floor', type=float, default=0)
    args = parser.parse_args()
    if not 0 <= args.coverage_floor <= 100:
        parser.error('Coverage floor must be between 0 and 100')
    result = compact(args.source.resolve(), args.output.resolve(), args.coverage_floor)
    print(json.dumps({'output': str(args.output), 'rows': result['pairs'],
                      'bytes': result['files']['comparison.sqlite']['bytes']}))
