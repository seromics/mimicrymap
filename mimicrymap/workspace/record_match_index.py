"""Indexed, compressed record neighbours and merged residue ranges for protein pages.

Each record/threshold has a separately compressed list, so opening a protein
reads only its own neighbours. Coverage doubles are preserved without rounding.
The two directions swap coverage denominators and retain distinct record IDs.
Individual window-pair positions are not retained here.
"""
import hashlib
import itertools
import json
import sqlite3
import struct
import zlib
from pathlib import Path
import pair_regions

FORMAT = 'record-neighbours/1'
ROW = struct.Struct('<Idd')


def create_tables(db):
    db.executescript('''
      PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
      CREATE TABLE sequence_records(side INTEGER,id INTEGER,source TEXT,metadata TEXT,
        length INTEGER,sha256 TEXT,PRIMARY KEY(side,id)) WITHOUT ROWID;
      CREATE TABLE neighbours(side INTEGER,id INTEGER,identity INTEGER,count INTEGER,
        payload BLOB,PRIMARY KEY(side,id,identity)) WITHOUT ROWID;
      CREATE TABLE region_lists(side INTEGER,id INTEGER,identity INTEGER,reference_ranges TEXT,
        payload BLOB,PRIMARY KEY(side,id,identity)) WITHOUT ROWID;
    ''')


def store(db, side, record, identity, rows, regions=None):
    rows = sorted(rows, key=lambda r: (-r[1], -r[2], r[0]))
    payload = zlib.compress(b''.join(ROW.pack(*r) for r in rows), 6)
    db.execute('INSERT INTO neighbours VALUES(?,?,?,?,?)', (side, record, identity, len(rows), payload))
    if regions is not None:
        if set(regions) != {r[0] for r in rows}:
            raise ValueError('Every qualifying record pair requires ranges')
        data, union = bytearray(), []
        for other, _, _ in rows:
            blob = regions[other]
            target, _ = pair_regions.unpack(blob)
            union.extend(target)
            data.extend(struct.pack('<II', other, len(blob))); data.extend(blob)
        db.execute('INSERT INTO region_lists VALUES(?,?,?,?,?)',
                   (side, record, identity, json.dumps(pair_regions.merge(union), separators=(',', ':')), zlib.compress(data, 6)))


def finish(db, output, manifest, counts):
    range_rows = db.execute('SELECT count(*) FROM region_lists').fetchone()[0]
    if range_rows and range_rows != db.execute('SELECT count(*) FROM neighbours').fetchone()[0]:
        raise ValueError('Incomplete per-pair residue ranges')
    db.executescript('''
      CREATE INDEX sequence_digest ON sequence_records(side,sha256);
      CREATE INDEX sequence_sources ON sequence_records(side,source);
      ANALYZE main;
    ''')
    if counts[0] != counts[1]:
        raise ValueError('Directional membership counts disagree')
    db.commit()
    db.close()
    final = output / 'comparison.sqlite'
    (output / 'comparison.sqlite.partial').replace(final)
    with final.open('rb') as f:
        sha = hashlib.file_digest(f, 'sha256').hexdigest()
    value = {**manifest, 'schema': 'seromap.record-matches/1', 'storage': FORMAT,
             'relationshipsOnly': True, 'featureOnly': True, 'retainsPositions': False,
             'bidirectional': True, 'complete': True, 'coverageFloor': 10,
             'coverageSide': 'either', 'floor': 7, 'pairs': counts[0],
             'output': 'record-matches',
             'retainsPairRegions': bool(range_rows), 'pairRegionStorage': pair_regions.FORMAT if range_rows else None,
             'files': {'comparison.sqlite': {'bytes': final.stat().st_size, 'sha256': sha}}}
    (output / 'comparison.json').write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')
    return value


def from_comparison(source, output):
    manifest = json.loads((source / 'comparison.json').read_text('utf8'))
    if not manifest.get('complete') or manifest.get('coverageFloor', 0) > 10:
        raise ValueError('A completed source retaining all >=10%-either pairs is required')
    revision = manifest['files']['comparison.sqlite']['sha256']
    receipt = output / 'comparison.json'
    if receipt.exists():
        old = json.loads(receipt.read_text('utf8'))
        if old.get('sourceRevision') != revision:
            raise ValueError('Output belongs to another source revision')
        return old
    output.mkdir(parents=True, exist_ok=True)
    pending = output / 'comparison.sqlite.partial'
    if pending.exists():
        raise ValueError('Unfinished output retained: ' + str(pending))
    db = sqlite3.connect(pending, uri=True)
    create_tables(db)
    db.execute('PRAGMA cache_size=-65536')
    db.execute('ATTACH DATABASE ? AS original', ((source / 'comparison.sqlite').as_uri() + '?mode=ro',))
    db.execute('INSERT INTO sequence_records SELECT side,id,source,metadata,length,sha256 FROM original.sequence_records')
    counts = [0, 0]
    has_regions = bool(db.execute("SELECT 1 FROM original.sqlite_master WHERE name='pair_regions'").fetchone())
    for side in (0, 1):
        this, other, tc, pc = ('target', 'parent', 'tc', 'pc') if side == 0 else ('parent', 'target', 'pc', 'tc')
        for identity in (7, 8, 9):
            columns = f'm.{this},m.{other},m.{tc},m.{pc}'
            joined = ' LEFT JOIN original.pair_regions r ON r.target=m.target AND r.parent=m.parent AND r.identity=m.identity' if has_regions else ''
            stream = db.execute(f'SELECT {columns}' + (',r.payload' if has_regions else '') + f' FROM original.matches m{joined} WHERE m.identity=? AND (m.tc>=10 OR m.pc>=10) ORDER BY m.{this},m.{other}', (identity,))
            for record, group in itertools.groupby(stream, key=lambda r: r[0]):
                group = list(group)
                rows = [(r[1], r[2], r[3]) for r in group]
                regions = None
                if has_regions:
                    if any(r[4] is None for r in group):
                        raise ValueError('Missing saved pair ranges')
                    regions = {r[1]: pair_regions.pack(*pair_regions.unpack(r[4], reverse=side == 1)) for r in group}
                store(db, side, record, identity, rows, regions)
                counts[side] += len(rows)
            db.commit()
            print(f'{output.name}: side {side}, {identity}/9 packed', flush=True)
    return finish(db, output, {**manifest, 'sourceRevision': revision}, counts)


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(from_comparison(a.source.resolve(), a.output.resolve())))
