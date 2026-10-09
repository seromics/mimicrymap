"""Prepare immutable human catalog display records before serving requests.

This caches record serialization, not comparisons. Matching, membership filters,
coordinates and export assembly remain in their existing paths. Each read creates
fresh mutable annotations; the resident cache contains only serialized bytes.
"""
from __future__ import annotations

from contextlib import closing
from dataclasses import fields
import gzip
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
from types import MappingProxyType

from analysis_api import _read_only_connection
from analysis_scan import ScanRecord
from canonical_aliases import metadata_read_session


LIBRARY = "canonical_human"
SCHEMA = "mimicryone/prepared-human-records/1"
MAX_BYTES = 128 * 1024 * 1024
MAX_RECORDS = 50_000
MAX_RECORD_BYTES = 1024 * 1024
COLUMNS = "antigen_id,library_key,ordinal,seqid,short_id,raw_header,sequence,source_row,sequence_status"
RECORD_FIELDS = frozenset(field.name for field in fields(ScanRecord))


def _encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _file_identity(path):
    path = Path(path).resolve()
    before = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("A human record source changed during preparation")
    return {"path": str(path), "sha256": digest.hexdigest()}


def _binding(owner):
    hydrator = getattr(owner, "annotation_hydrator", None)
    sources = {"catalog": _file_identity(owner.catalog_path)}
    for name in ("alias_resolver", "annotation_sidecar"):
        source = getattr(hydrator, name, None)
        sources[name] = _file_identity(source.database) if source is not None else None
    code = Path(__file__).resolve().parent
    return {
        "schema": SCHEMA, "library": LIBRARY,
        "release_fingerprint": owner.manifest["release_fingerprint"],
        "sources": sources,
        "resolvers": {name: _file_identity(code / name)["sha256"] for name in (
            "analysis_scan.py", "annotation_hydration.py", "canonical_aliases.py",
            "prepared_human_records.py",
        )},
    }


def _validate_record(raw):
    value = json.loads(raw)
    if not isinstance(value, dict) or set(value) != RECORD_FIELDS:
        raise ValueError("Prepared human record fields differ")
    record = ScanRecord(**value)
    if (type(record.antigen_id) is not int or record.antigen_id < 1
            or record.key != record.antigen_id or record.library != LIBRARY
            or not isinstance(record.sequence, str)):
        raise ValueError("Prepared human record identity differs")
    return record


class PreparedHumanRecords:
    def __init__(self, records, report):
        self._records = MappingProxyType(dict(records))
        self.report = dict(report)

    def get_many(self, identifiers):
        # Parsing replaces both deep-copy passes and recursive cache accounting.
        return {identifier: ScanRecord(**json.loads(self._records[identifier]))
                for identifier in identifiers if identifier in self._records}


def _load(path, binding, identifiers):
    records, size = {}, 0
    with gzip.open(path, "rb") as handle:
        if json.loads(handle.readline(MAX_RECORD_BYTES + 1)) != binding:
            raise ValueError("Prepared human record sources differ")
        while raw := handle.readline(MAX_RECORD_BYTES + 1):
            size += len(raw)
            if (len(raw) > MAX_RECORD_BYTES or size > MAX_BYTES
                    or len(records) >= MAX_RECORDS):
                raise ValueError("Prepared human record cache exceeds its budget")
            record = _validate_record(raw)
            if record.antigen_id in records:
                raise ValueError("Duplicate prepared human record")
            records[record.antigen_id] = raw.rstrip(b"\n")
    if records.keys() != identifiers:
        raise ValueError("Prepared human record membership differs from the catalog")
    return records


def _save(path, binding, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    # A unique sibling and atomic replacement allow concurrent server starts.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + ".", delete=False) as handle:
            temporary = Path(handle.name)
            with gzip.GzipFile(fileobj=handle, mode="wb", compresslevel=3, mtime=0) as zipped:
                zipped.write(_encode(binding) + b"\n")
                for raw in records.values():
                    zipped.write(raw + b"\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def prepare(owner, cache_directory):
    """Load or build all human records, without touching an installed release."""
    started = time.perf_counter()
    binding = _binding(owner)
    key = hashlib.sha256(_encode(binding)).hexdigest()
    path = Path(cache_directory) / (key + ".jsonl.gz")
    with closing(_read_only_connection(owner.catalog_path)) as catalog:
        identifiers = {int(row[0]) for row in catalog.execute(
            "SELECT antigen_id FROM antigen WHERE library_key=?", (LIBRARY,))}
    if not identifiers or len(identifiers) > MAX_RECORDS:
        raise ValueError("Human catalog is empty or exceeds the preparation budget")
    records = None
    try:
        records = _load(path, binding, identifiers)
    except (OSError, EOFError, ValueError, TypeError, KeyError):
        pass  # A missing, stale or damaged derivative is rebuilt from its sources.
    state, persisted = "loaded", True
    if records is None:
        state, records, size = "built", {}, 0
        with metadata_read_session(), closing(_read_only_connection(owner.catalog_path)) as catalog:
            for row in catalog.execute(
                    f"SELECT {COLUMNS} FROM antigen WHERE library_key=? ORDER BY antigen_id", (LIBRARY,)):
                record = owner.scan_service._record_from_row(row)
                raw = _encode(vars(record))
                size += len(raw)
                if len(raw) > MAX_RECORD_BYTES or size > MAX_BYTES:
                    raise ValueError("Human record preparation exceeds its memory budget")
                if _validate_record(raw).public() != record.public():
                    raise ValueError("Human record serialization changed its public fields")
                records[record.antigen_id] = raw
        if records.keys() != identifiers or _binding(owner) != binding:
            raise ValueError("Human record sources changed during preparation")
        try:
            _save(path, binding, records)
        except OSError:
            persisted = False  # Read-only deployments can still use the resident copy.
    return PreparedHumanRecords(records, {
        "state": state, "records": len(records),
        "serialized_bytes": sum(map(len, records.values())),
        "persisted": persisted, "cache_key": key,
        "seconds": round(time.perf_counter() - started, 3),
    })


def install(analysis_api, cache_directory):
    """Prepare only mounted canonical human libraries before the server listens."""
    if analysis_api is None:
        return
    components = getattr(analysis_api, "components", None) or {"primary": analysis_api}
    for key, component in components.items():
        if LIBRARY not in component.library_keys:
            continue
        try:
            prepared = prepare(component, cache_directory)
            component.player_service._prepared_human_records = prepared
            report = prepared.report
            print(f"Prepared human records [{key}]: {report['records']:,}; "
                  f"{report['serialized_bytes'] / 1048576:.1f} MiB serialized; "
                  f"{report['state']} in {report['seconds']:.2f}s; "
                  f"persistent cache: {'yes' if report['persisted'] else 'no'}")
        except (OSError, EOFError, ValueError, TypeError, KeyError, sqlite3.Error) as error:
            # Availability is unchanged if preparation cannot be completed.
            print(f"Prepared human records [{key}] unavailable ({type(error).__name__}); "
                  "using request-time metadata preparation.")
