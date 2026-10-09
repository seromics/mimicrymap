"""Persist unchanged, complete human-to-human viewer and export responses.

This optional serving derivative is outside scientific releases. A missing, stale,
incomplete or damaged entry falls through to the existing request path.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zlib

from player_view_response import compact_view
from prepared_human_records import _binding, _file_identity
from public_result_cache import PublicResultCache

SCHEMA = "mimicryone/prepared-human-player/1"
LIBRARY = "canonical_human"
# Bump only when successful full/view responses change meaning or structure:
# calculations, membership semantics, coordinate interpretation, annotations,
# crosswalks, or serialization. UI, transport headers and error copy do not count.
# Source data and the exact request remain independently bound below.
RESPONSE_CONTRACT = "mimicryone/canonical-human-player-response/1"


def compatibility_binding(binding):
    """Bind data and result semantics, not unrelated source-file edits.

    This projects metadata only; it does not authorize reuse of legacy entries.
    Legacy namespaces require a separate reviewed migration and parity evidence.
    """
    result = {key: value for key, value in binding.items() if key not in {"code", "resolvers"}}
    result["response_contract"] = RESPONSE_CONTRACT
    return result

MAX_ENTRY_BYTES = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 65536


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def atomic_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".pending-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(value)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def binding_for(api, component_key):
    owner = api.components[component_key]
    comparison = owner.comparisons.get("canonical_human__self")
    if comparison is None:
        raise ValueError("No mounted human self-comparison")
    binding = _binding(owner)
    binding["schema"] = SCHEMA
    binding["component"] = component_key
    binding["sources"]["comparison"] = _file_identity(owner._shard_path(comparison))
    membership = getattr(owner, "membership", None)
    binding["sources"]["membership"] = _file_identity(membership.database) if membership else None
    crosswalk = getattr(api, "record_identity_crosswalks", {}).get(component_key)
    binding["sources"]["explorer"] = _file_identity(crosswalk.explorer_database) if crosswalk else None
    return compatibility_binding(binding)


class HumanPlayerStore:
    def __init__(self, root, binding, max_entry_bytes=MAX_ENTRY_BYTES):
        self.binding = binding
        self.namespace = digest(encode(binding))
        self.root = Path(root) / self.namespace
        self.component = binding["component"]
        self.release = binding["release_fingerprint"]
        self.max_entry_bytes = max_entry_bytes

    def key(self, request):
        if not isinstance(request, dict):
            return None
        query, target = request.get("query"), request.get("target")
        if not isinstance(query, dict) or not isinstance(target, dict):
            return None
        ids = query.get("antigen_ids")
        if (query.get("kind") != "library" or query.get("library") != LIBRARY
                or target.get("kind") != "library" or target.get("library") != LIBRARY
                or not isinstance(ids, list) or len(ids) != 1
                or type(ids[0]) is not int or ids[0] < 1):
            return None
        return PublicResultCache.key(self.component, self.release, request)

    def manifest_path(self, key):
        return self.root / key[:2] / (key + ".json")

    def _manifest(self, key):
        path = self.manifest_path(key)
        if path.stat().st_size > MAX_MANIFEST_BYTES:
            raise ValueError("Oversized prepared-result manifest")
        value = json.loads(path.read_bytes())
        if not isinstance(value, dict):
            raise ValueError("Invalid prepared-result manifest")
        if (value.get("schema") != SCHEMA or value.get("namespace") != self.namespace
                or value.get("key") != key or value.get("complete") is not True
                or set(value.get("files", {})) != {"full", "view"}):
            raise ValueError("Incompatible prepared-result manifest")
        for kind, item in value["files"].items():
            if (not re.fullmatch(key + r"\." + kind + r"\.[a-f0-9]{64}\.json\.gz", item["name"])
                    or type(item["bytes"]) is not int or not 0 < item["bytes"] <= self.max_entry_bytes
                    or type(item["raw_bytes"]) is not int or not 0 < item["raw_bytes"] <= self.max_entry_bytes):
                raise ValueError("Invalid prepared-result file")
            if (path.parent / item["name"]).stat().st_size != item["bytes"]:
                raise ValueError("Incomplete prepared-result pair")
        return value

    def get_wire(self, request, *, view, accepts_gzip):
        key = self.key(request)
        if key is None:
            return None
        try:
            manifest = self._manifest(key)
            item = manifest["files"]["view" if view else "full"]
            value = (self.manifest_path(key).parent / item["name"]).read_bytes()
            if len(value) != item["bytes"] or digest(value) != item["sha256"]:
                return None
            if accepts_gzip:
                return value, True
            # Bounded inflation also protects identity-encoding clients from a
            # damaged local derivative; the full calculation remains available.
            import io
            with gzip.GzipFile(fileobj=io.BytesIO(value)) as zipped:
                plain = zipped.read(self.max_entry_bytes + 1)
            if len(plain) != item["raw_bytes"] or digest(plain) != item["raw_sha256"]:
                return None
            return plain, False
        except (OSError, ValueError, TypeError, KeyError, EOFError, zlib.error):
            return None

    def put(self, request, response):
        key = self.key(request)
        execution = response.get("execution", {})
        if (key is None or execution.get("mode") != "precomputed_player"
                or execution.get("complete") is not True
                or execution.get("positional_hits_included") is not True
                or response.get("result_count") != len(response.get("results", []))):
            raise ValueError("Only complete human-to-human results may be prepared")
        files = {}
        full_bytes = None
        for kind, result in (("full", response), ("view", compact_view(response, request))):
            raw = encode(result)
            if len(raw) > self.max_entry_bytes:
                raise ValueError("Result exceeds the storage budget; no partial entry saved")
            zipped = gzip.compress(raw, compresslevel=3, mtime=0)
            sha = digest(zipped)
            name = f"{key}.{kind}.{sha}.json.gz"
            atomic_write(self.manifest_path(key).parent / name, zipped)
            files[kind] = {"name": name, "bytes": len(zipped), "sha256": sha,
                           "raw_bytes": len(raw), "raw_sha256": digest(raw)}
            if kind == "full":
                full_bytes = len(raw)
        manifest = {"schema": SCHEMA, "namespace": self.namespace, "key": key,
                    "complete": True, "request": request, "files": files}
        # Publish only after both full and viewer files are safely closed.
        atomic_write(self.manifest_path(key), encode(manifest))
        return {"bytes": sum(row["bytes"] for row in files.values()), "full_bytes": full_bytes}


def install(api, directory):
    if api is None or not hasattr(api, "components"):
        return
    stores = {}
    for key, owner in api.components.items():
        if "canonical_human__self" not in owner.comparisons:
            continue
        try:
            stores[key] = HumanPlayerStore(directory, binding_for(api, key))
            print(f"Prepared human results [{key}]: {stores[key].root}")
        except (OSError, ValueError):
            print(f"Prepared human results [{key}] unavailable; existing calculation retained.")
    api.human_player_stores = stores
