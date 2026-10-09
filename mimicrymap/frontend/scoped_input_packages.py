"""Lossless, bounded delivery slices of immutable prepared input packages."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading

CONTRACT = 'exact-mask/1'


class _Reader:
    """Incremental JSON values; row arrays are never accumulated."""
    def __init__(self, stream):
        self.stream, self.buffer, self.pos = stream, '', 0
        self.decoder = json.JSONDecoder()

    def _fill(self):
        self.buffer = self.buffer[self.pos:] + self.stream.read(65536)
        self.pos = 0

    def peek(self):
        while True:
            while self.pos < len(self.buffer) and self.buffer[self.pos].isspace():
                self.pos += 1
            if self.pos < len(self.buffer):
                return self.buffer[self.pos]
            self._fill()
            if not self.buffer:
                return ''

    def expect(self, character):
        if self.peek() != character:
            raise ValueError('Invalid input package JSON structure')
        self.pos += 1

    def value(self):
        self.peek()
        while True:
            try:
                value, end = self.decoder.raw_decode(self.buffer, self.pos)
                self.pos = end
                return value
            except json.JSONDecodeError:
                before = len(self.buffer) - self.pos
                self._fill()
                if len(self.buffer) == before:
                    raise ValueError('Truncated input package JSON') from None


def _mask(scope):
    m, manifest = scope['membership_mask'], scope['manifest']
    low, high, count = m['start_id'], m['end_id'], m['count']
    if any(type(v) is not int for v in (low, high, count)) or low < 0 or high < low - 1 or count < 0:
        raise ValueError('Invalid scope bounds')
    width = high - low + 1
    if width > 128 * 1024 * 1024 or m.get('schema') != 'mimicryone/input-scope-mask/1':
        raise ValueError('Invalid scope mask')
    bits = base64.b64decode(m['bits'], validate=True)
    if (len(bits) != (width + 7) // 8 or sum(b.bit_count() for b in bits) != count
            or (width % 8 and bits and bits[-1] >> (width % 8))
            or count != manifest['population_records'] or count != manifest['download_records']):
        raise ValueError('Scope mask count disagrees')
    return low, high, count, bits


class ScopedInputPackages:
    def __init__(self, cache_root=None, max_bytes=512 * 1024 * 1024, max_entries=64):
        self.cache_root = Path(cache_root) if cache_root is not None else None
        self.root = self.cache_root
        # One serving process per data root; separate main/Lite roots never share eviction.
        self.max_bytes, self.max_entries = max_bytes, max_entries
        self.lock = threading.Lock()
        self.verified = {}
        self.complete = {}

    def _verify(self, path, digest):
        stat = path.stat()
        key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, digest)
        if key not in self.verified:
            h = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(chunk)
            if h.hexdigest() != digest:
                raise ValueError('Input package checksum mismatch')
            if len(self.verified) >= 128:
                self.verified.clear()
            self.verified[key] = True
        return stat.st_size

    def _trim(self, keep):
        files = sorted(self.root.glob('*.json.gz'), key=lambda p: p.stat().st_mtime_ns)
        total = sum(p.stat().st_size for p in files)
        remaining = len(files)
        for path in files:
            if total <= self.max_bytes and remaining <= self.max_entries:
                break
            if path == keep:
                continue
            total -= path.stat().st_size
            remaining -= 1
            path.unlink(missing_ok=True)
            path.with_suffix('').with_suffix('.meta.json').unlink(missing_ok=True)

    def get_package(self, data_root, scope):
        with self.lock:
            data_root = Path(data_root).resolve()
            root_hash = hashlib.sha256(str(data_root).encode()).hexdigest()[:24]
            self.root = self.cache_root or Path(tempfile.gettempdir()) / 'mimicrymap-scoped-inputs-v1' / root_hash
            return self._get_package(data_root, scope)

    def _get_package(self, data_root, scope):
        low, high, count, bits = _mask(scope)
        manifest = scope['manifest']
        release, library = scope['release_fingerprint'], manifest['library']
        import re
        if not re.fullmatch('[0-9a-f]{64}', release) or not re.fullmatch('[A-Za-z0-9_]+', library):
            raise ValueError('Invalid package identity')
        if manifest['release_fingerprint'] != release:
            raise ValueError('Scope release disagrees')
        source = data_root / 'local-inputs' / release / (library + '.json.gz')
        before = source.stat()
        source_state = (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        meta = json.loads(source.with_name(library + '.meta.json').read_text(encoding='utf-8'))
        if (meta.get('schema') != 'mimicryone/local-input-metadata/1'
                or meta.get('release_fingerprint') != release or meta.get('library') != library
                or not re.fullmatch('[0-9a-f]{64}', meta.get('sha256', ''))
                or self._verify(source, meta['sha256']) != meta['compressed_bytes']):
            raise ValueError('Source package metadata disagrees')
        mask_hash = hashlib.sha256(f'{low}:{high}:'.encode() + bits).hexdigest()
        key = hashlib.sha256((CONTRACT + meta['sha256'] + mask_hash).encode()).hexdigest()
        def validate_cached(cached):
            if (cached.get('schema') != meta['schema'] or cached.get('library') != library
                    or cached.get('release_fingerprint') != release or cached.get('row_columns') != meta['row_columns']
                    or cached.get('membership_fields', []) != meta.get('membership_fields', [])
                    or any(cached['manifest'].get(field) != manifest.get(field) for field in
                           ('population_records', 'download_records', 'population_windows', 'eligible_records'))):
                raise ValueError('Cached package scope disagrees')
        if key in self.complete:
            validate_cached(self.complete[key])
            return {'metadata': self.complete[key], 'path': source}
        self.root.mkdir(parents=True, exist_ok=True)
        output = self.root / (key + '.json.gz')
        descriptor = self.root / (key + '.meta.json')
        if output.exists() and descriptor.exists():
            try:
                cached = json.loads(descriptor.read_text(encoding='utf-8'))
                validate_cached(cached)
                if (cached['source_sha256'] == meta['sha256'] and cached['membership_sha256'] == mask_hash
                        and self._verify(output, cached['sha256']) == cached['compressed_bytes']):
                    os.utime(output, None)
                    return {'metadata': cached, 'path': output}
            except (ValueError, KeyError, OSError):
                pass
        with tempfile.TemporaryDirectory(prefix='build-', dir=self.root) as temporary:
            spool = Path(temporary) / 'rows.json'
            header, annotations, selected_annotations, references = {}, [], [], {}
            selected = selected_windows = selected_eligible = seen = windows = eligible = 0
            previous = -1
            with gzip.open(source, 'rt', encoding='utf-8') as stream, spool.open('w', encoding='utf-8', newline='') as sink:
                reader = _Reader(stream)
                reader.expect('{')
                while True:
                    name = reader.value()
                    reader.expect(':')
                    if name == 'annotations':
                        items = []
                        reader.expect('[')
                        while reader.peek() != ']':
                            items.append(reader.value())
                            if reader.peek() == ']':
                                break
                            reader.expect(',')
                        reader.expect(']')
                        header[name] = items
                    elif name != 'rows':
                        header[name] = reader.value()
                    else:
                        if (header.get('schema') != 'mimicryone/local-input-package/1'
                                or header.get('release_fingerprint') != release or header.get('library') != library
                                or header.get('row_columns') != meta['row_columns']
                                or header.get('membership_fields', []) != meta.get('membership_fields', [])
                                or header.get('manifest') != meta['manifest']):
                            raise ValueError('Source header disagrees')
                        annotations = header.pop('annotations')
                        columns = header['row_columns']
                        id_at, ann_at, window_at = [columns.index(n) for n in ('antigen_id', 'annotation', 'window_count')]
                        reader.expect('[')
                        while reader.peek() != ']':
                            row = reader.value()
                            if not isinstance(row, list) or len(row) != len(columns):
                                raise ValueError('Invalid source row')
                            record, annotation, nwin = row[id_at], row[ann_at], row[window_at]
                            if (type(record) is not int or record <= previous or type(annotation) is not int
                                    or not 0 <= annotation < len(annotations) or type(nwin) is not int or nwin < 0):
                                raise ValueError('Invalid source identity, order, annotation or windows')
                            previous = record
                            seen += 1
                            windows += nwin
                            eligible += nwin > 0
                            offset = record - low
                            if 0 <= offset <= high - low and bits[offset >> 3] & (1 << (offset & 7)):
                                if annotation not in references:
                                    references[annotation] = len(selected_annotations)
                                    selected_annotations.append(annotations[annotation])
                                row[ann_at] = references[annotation]
                                if selected:
                                    sink.write(',')
                                sink.write(json.dumps(row, separators=(',', ':')))
                                selected += 1
                                selected_windows += nwin
                                selected_eligible += nwin > 0
                            if reader.peek() == ']':
                                break
                            reader.expect(',')
                        reader.expect(']')
                    if reader.peek() == '}':
                        break
                    reader.expect(',')
                reader.expect('}')
                if reader.peek():
                    raise ValueError('Trailing source data')
            if (seen != meta['manifest']['download_records'] or windows != meta['manifest']['population_windows']
                    or eligible != meta['manifest']['eligible_records'] or selected != count
                    or selected_windows != manifest['population_windows'] or selected_eligible != manifest['eligible_records']):
                raise ValueError('Package population disagrees')
            after = source.stat()
            if source_state != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ValueError('Source package changed during slicing')
            result_meta = dict(meta, source_sha256=meta['sha256'], membership_sha256=mask_hash)
            if selected == seen:
                if len(self.complete) >= 128:
                    self.complete.clear()
                self.complete[key] = result_meta
                return {'metadata': result_meta, 'path': source}
            selected_manifest = dict(meta['manifest'], filters=None, population_records=selected,
                                     download_records=selected, population_windows=selected_windows, eligible_records=selected_eligible)
            header['manifest'] = selected_manifest
            header['annotations'] = selected_annotations
            staged = Path(temporary) / 'package.json.gz'
            with staged.open('wb') as binary, gzip.GzipFile(fileobj=binary, mode='wb', filename='', mtime=0, compresslevel=6) as zipped:
                prefix = json.dumps(header, separators=(',', ':'))[:-1] + ',"rows":['
                zipped.write(prefix.encode())
                with spool.open('rb') as rows:
                    for chunk in iter(lambda: rows.read(1024 * 1024), b''):
                        zipped.write(chunk)
                zipped.write(b']}')
            digest = hashlib.sha256()
            with staged.open('rb') as built:
                for chunk in iter(lambda: built.read(1024 * 1024), b''):
                    digest.update(chunk)
            result_meta.update(manifest=selected_manifest, compressed_bytes=staged.stat().st_size, sha256=digest.hexdigest())
            if staged.stat().st_size > self.max_bytes or self.max_entries < 1:
                raise ValueError('Selected package exceeds scoped cache budget')
            staged_descriptor = Path(temporary) / 'package.meta.json'
            staged_descriptor.write_text(json.dumps(result_meta, separators=(',', ':')), encoding='utf-8')
            staged.replace(output)
            staged_descriptor.replace(descriptor)
            self._trim(output)
            return {'metadata': result_meta, 'path': output}


_SERVICE = ScopedInputPackages()


def get_package(data_root, scope_payload):
    return _SERVICE.get_package(data_root, scope_payload)
