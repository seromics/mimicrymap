"""Optional canonical-exposure models and annotations, addressed by records.

The index contains exact canonical sequences. Callers must retain that sequence
identity; an accession shared by an assay fragment does not grant its tracks.
"""
import json
import re
import sqlite3
import threading
from collections import OrderedDict
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from asset_packs import AssetPack

LIBRARIES = frozenset(('canonical_exposure', 'canonical_exposure_no_vertebrates', 'atlas_120_viruses'))
PREFIX = 'mimicrymap/reference/exposure-assets/'
MODEL = re.compile(r'^AF-[A-Za-z0-9_-]{1,100}$')


class ExposureAssets:
    def __init__(self, root):
        self.root = Path(root)
        self.file = self.root / PREFIX / 'records.sqlite'
        self.pack = AssetPack(self.root/'asset-packs/exposure-annotations', 'exposure-annotations')
        self.db = None
        self.signature = None
        self.lock = threading.RLock()
        self.cache = OrderedDict()

    @property
    def installed(self):
        with self.lock:
            files = (self.file, self.pack.directory/'index.sqlite')
            if not all(path.is_file() for path in files):
                self.close()
                return False
            signature = tuple((s.st_size, s.st_mtime_ns, s.st_ino) for s in (path.stat() for path in files))
            if signature != self.signature:
                self.close()
                self.signature = signature
            return True

    def record(self, source):
        if not self.installed: return None
        with self.lock:
            if source in self.cache:
                self.cache.move_to_end(source)
                return self.cache[source]
            if self.db is None:
                self.db = sqlite3.connect(self.file.resolve().as_uri()+'?mode=ro', uri=True, check_same_thread=False)
                self.db.execute('PRAGMA query_only=ON')
                self.db.execute('PRAGMA cache_size=-2048')
            # Exact record IDs preserve variant/source distinctions. No fuzzy
            # accession fallback and no whole-roster load at startup.
            row = self.db.execute('SELECT sequence,annotation_path FROM records WHERE record_id=?', (source,)).fetchone()
            result = None
            if row:
                asset = self.pack.get(PREFIX+row[1])
                if asset is None: raise ValueError('Exposure annotation payload is missing')
                result = json.loads(asset['data'])
                if result['record_id'] != source or result['sequence'] != row[0]:
                    raise ValueError('Exposure record and annotation sequences differ')
                for model in result.get('models', []):
                    if not MODEL.fullmatch(model['model_id']): raise ValueError('Invalid model record')
                    model['url'] = '/data/exposure-models/'+model['model_id']+'.pdb'
            self.cache[source] = result
            while len(self.cache) > 32: self.cache.popitem(last=False)
            return result

    def model(self, model_id):
        if not self.installed or not MODEL.fullmatch(model_id): return None
        return self.pack.get(PREFIX+'models/'+model_id+'.pdb')

    def dispatch(self, handler, head_only=False):
        parsed = urlparse(handler.path)
        if parsed.path != '/api/explorer/reference-assets': return False
        from analysis_api import _send_json
        query = parse_qs(parsed.query)
        library, source = query.get('library', [''])[0], query.get('source', [''])[0]
        if library not in LIBRARIES or not source or len(source) > 200:
            _send_json(handler, 400, {'error':'Invalid reference record.'}, head_only=head_only)
            return True
        try:
            result = self.record(source)
            _send_json(handler, 200, {'installed':self.installed, 'record':result}, head_only=head_only)
        except (OSError, ValueError, sqlite3.Error, KeyError) as error:
            _send_json(handler, 503, {'error':str(error)}, head_only=head_only)
        return True

    def close(self):
        with self.lock:
            if self.db: self.db.close(); self.db = None
            self.cache.clear()
            self.pack.close()
            self.signature = None
