"""Bounded static-edge candidate expansion for the native MimicryMap player.

The 7/9 release stores complete unordered antigen-pair aggregates but not positions.
This route uses a finalized shard only to identify candidate antigen pairs, then runs
the existing exact per-pair matcher for those candidates.  It never scans a whole live
window index.  PanScan9 Human/Exposure sources are projected to byte-validated P9P
parents when possible; unsafe/unmapped children remain explicit assay entities.
"""

from __future__ import annotations

import json
import re
import select
import socket
import sqlite3
import threading
import time
import uuid
from collections import defaultdict
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import urlsplit

from analysis_api import (
    APIError,
    EDGE_COLUMNS,
    M7_SEEDS,
    _pair_matches_indexed,
    _pair_seed_index,
    _read_only_connection,
    _send_json,
)
from pinned_subset_membership import membership_for

from analysis_scan import (
    CANDIDATE_BATCH,
    ERROR_SCHEMA,
    LIVE_INDEX_SCHEMA,
    LIVE_SEED_SCHEMA,
    MAX_RESULT_PAIRS,
    MAX_RETURNED_HITS,
    SCAN_SCHEMA,
    ScanError,
    ScanRecord,
    WINDOW_CACHE_SCHEMA,
    _bounded_int,
    _error_payload,
    _flatten_candidates,
    _loci_count,
    _matching_buckets,
    _pack_seed_keys,
    _reject_unknown,
    _sequence_windows,
    np,
)
from catalog_record_cache import CatalogRecordCache
from request_timing import timed
from analysis_membership import MembershipFilterError
from canonical_parent_overlay import (
    CanonicalParentOverlay,
    CanonicalParentOverlayError,
    canonical_protein_idx,
)


PLAYER_ROUTE = "/api/analysis/player"
PLAYER_FLOOR = 7
PLAYER_MAX_FLOOR = 9
PLAYER_SCHEMA = SCAN_SCHEMA
P9P_ID = re.compile(r"^P9P(\d{9})$")
CDI_ID = re.compile(r"^CDI9[A-Z]\d{7}$")

P9P_LIBRARY_CLASS = {
    "panscan9_human": "Human",
    "panscan9_exposure": "Exposure",
}
CANONICAL_DEFAULT_COUNTS = {
    "panscan9_human": 20_563,
    "panscan9_exposure": 8_827,
}

# Catalog antigen IDs currently occupy 1..3,482,687.  Portable parents use a
# documented, disjoint, deterministic numeric namespace that remains exactly
# representable by JavaScript Number and cannot collide with assay antigen IDs.
P9P_PROTEIN_IDX_OFFSET = 10_000_000_000
MAX_SAFE_JS_INTEGER = 9_007_199_254_740_991

EDGE_BATCH = 250
CATALOG_BATCH = 400
MAX_STATIC_EDGE_CANDIDATES = 100_000
MAX_RECONSTRUCTED_CHILD_HITS = 250_000
MAX_PROVENANCE_CONTRIBUTIONS = 250_000
MAX_PLAYER_SECONDS = 30.0
MAX_STATIC_M7_RAW_SEED_HITS = 2_000_000
MAX_STATIC_M7_FILTERED_SEED_HITS = 2_000_000
MAX_STATIC_M7_UNIQUE_CANDIDATES = 1_000_000


@dataclass(frozen=True)
class ProjectionMap:
    child_antigen_id: int
    cdi_accession: str
    child_seqid: str
    child_raw_header: str
    portable_id: str
    target_start0: int
    target_end0: int
    relationship_class: str
    mapping_status: str
    coordinate_system: str
    home_partition: str
    source_partition: str

    def public(self) -> dict[str, Any]:
        return {
            "child_antigen_id": self.child_antigen_id,
            "cdi_accession": self.cdi_accession,
            "child_seqid": self.child_seqid,
            "child_raw_header": self.child_raw_header,
            "portable_id": self.portable_id,
            "target_start0": self.target_start0,
            "target_end0": self.target_end0,
            "relationship_class": self.relationship_class,
            "mapping_status": self.mapping_status,
            "coordinate_system": self.coordinate_system,
            "home_partition": self.home_partition,
            "source_partition": self.source_partition,
        }


def _chunks(values: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ScanError(400, "invalid_request", f"{label} must be a JSON object")
    return value


def _without_sequence(record: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if key != "sequence"}


def _cdi_accession(seqid: str) -> str | None:
    accession = str(seqid).split("|", 1)[0]
    return accession if CDI_ID.fullmatch(accession) else None


def _missing_ranges(covered: Sequence[bool]) -> list[list[int]]:
    ranges: list[list[int]] = []
    start: int | None = None
    for index, value in enumerate(covered):
        if not value and start is None:
            start = index + 1
        elif value and start is not None:
            ranges.append([start, index])
            start = None
    if start is not None:
        ranges.append([start, len(covered)])
    return ranges


class AnalysisPlayerService:
    """Serve one exact, complete static 7/9 player payload at a time."""

    def __init__(self, owner: Any, explorer_db: str | Path | None) -> None:
        self.owner = owner
        self._slot = threading.BoundedSemaphore(value=1)
        self._catalog_cache = CatalogRecordCache()
        self._prepared_human_records = None
        self._prepared_human_index = None
        self.explorer_root: Path | None = None
        self.explorer_database: Path | None = None
        self.explorer_manifest: dict[str, Any] | None = None
        self._static_m7_roots: dict[str, Path | None] = {}
        parent_catalog = getattr(owner, "parent_catalog", None)
        self.canonical_overlay = (
            CanonicalParentOverlay(parent_catalog.default_no_projection_rows())
            if parent_catalog is not None
            else None
        )
        if explorer_db is not None:
            supplied = Path(explorer_db).resolve()
            self.explorer_root = supplied if supplied.is_dir() else supplied.parent
            self.explorer_database = supplied / "explorer.sqlite" if supplied.is_dir() else supplied
            manifest_path = self.explorer_root / "MANIFEST.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise ValueError("Cannot read the frozen Explorer manifest") from error
            if (
                manifest.get("schema") != "mimicryone/panscan9-protein-explorer/1"
                or manifest.get("status") != "PASS"
                or not self.explorer_database.is_file()
            ):
                raise ValueError("The Explorer release is not a finalized PASS release")
            self.explorer_manifest = manifest
            self._validate_explorer_schema()

        with closing(_read_only_connection(self.owner.catalog_path)) as catalog:
            maximum = int(catalog.execute("SELECT COALESCE(MAX(antigen_id),0) FROM antigen").fetchone()[0])
        if maximum >= P9P_PROTEIN_IDX_OFFSET:
            raise ValueError("Catalog antigen IDs collide with the portable-parent numeric namespace")
        self.catalog_antigen_id_max = maximum

    def _explorer_connection(self) -> sqlite3.Connection:
        if self.explorer_database is None:
            raise ScanError(
                409,
                "explorer_unavailable",
                "Portable projection requires the frozen PanScan9 Protein Explorer release",
            )
        connection = sqlite3.connect(
            f"file:{self.explorer_database.as_posix()}?mode=ro&immutable=1",
            uri=True,
            timeout=10.0,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def _validate_explorer_schema(self) -> None:
        assert self.explorer_database is not None
        with closing(self._explorer_connection()) as connection:
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_schema WHERE type='table'"
                )
            }
            missing = {"protein", "projection", "tile"} - tables
            if missing:
                raise ValueError(
                    "Explorer database lacks required table(s): " + ", ".join(sorted(missing))
                )

    @staticmethod
    def _portable_protein_idx(portable_id: str) -> int:
        match = P9P_ID.fullmatch(portable_id)
        if match is None:
            raise ScanError(422, "invalid_portable_id", "portable_id must match P9P plus nine digits")
        value = P9P_PROTEIN_IDX_OFFSET + int(match.group(1))
        if value > MAX_SAFE_JS_INTEGER:
            raise ScanError(503, "portable_namespace_overflow", "Portable protein index is not browser-safe")
        return value

    def dispatch(self, handler: Any, *, head_only: bool = False) -> bool:
        path = urlsplit(handler.path).path.rstrip("/") or "/"
        if path != PLAYER_ROUTE:
            return False

        def reply(status: int, payload: Mapping[str, Any]) -> None:
            try:
                _send_json(handler, status, payload, head_only=head_only)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def client_cancelled() -> bool:
            try:
                readable, _writable, _exceptional = select.select(
                    [handler.connection], [], [], 0
                )
                if not readable:
                    return False
                return handler.connection.recv(1, socket.MSG_PEEK) == b""
            except (BlockingIOError, InterruptedError):
                return False
            except OSError:
                return True

        try:
            if head_only or getattr(handler, "command", "GET") != "POST":
                raise ScanError(405, "method_not_allowed", "This endpoint requires POST")
            payload = self.owner.scan_service._read_json(handler)
            response = self.run(payload, cancelled=client_cancelled)
            reply(200, response)
        except ScanError as error:
            reply(error.status, _error_payload(error))
        except APIError as error:
            reply(
                error.status,
                _error_payload(
                    ScanError(
                        error.status,
                        "static_player_unavailable",
                        error.message,
                    )
                ),
            )
        except (FileNotFoundError, OSError, sqlite3.Error, json.JSONDecodeError, ValueError) as error:
            handler.log_error("Static player data unavailable: %s", error)
            reply(
                503,
                _error_payload(
                    ScanError(503, "temporarily_unavailable", "Static player data are temporarily unavailable")
                ),
            )
        except Exception as error:  # never leak local paths, SQL, or sequences
            handler.log_error("Static player internal error: %s", error)
            reply(
                500,
                _error_payload(ScanError(500, "internal_error", "Internal static player error")),
            )
        return True

    def run(self, payload: dict[str, Any], *, cancelled=None) -> dict[str, Any]:
        if not self._slot.acquire(blocking=False):
            raise ScanError(429, "static_player_busy", "Another static player expansion is running; retry shortly")
        try:
            return self._run(payload, cancelled=cancelled)
        finally:
            self._slot.release()

    def _parse_request(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any], dict[str, Any], int]:
        _reject_unknown(payload, {"floor", "query", "target", "include_hits", "max_results"}, "request")
        floor = _bounded_int(
            payload.get("floor", PLAYER_FLOOR),
            "floor",
            PLAYER_FLOOR,
            PLAYER_MAX_FLOOR,
        )
        if payload.get("include_hits") is not True:
            raise ScanError(400, "include_hits_required", "include_hits must be true for the player route")
        maximum = _bounded_int(payload.get("max_results", MAX_RESULT_PAIRS), "max_results", 1, MAX_RESULT_PAIRS)

        query = _object(payload.get("query"), "query")
        kind = query.get("kind")
        if kind == "library":
            _reject_unknown(query, {"kind", "library", "antigen_ids"}, "query")
            library = query.get("library")
            identifiers = query.get("antigen_ids")
            if not isinstance(library, str) or library not in self.owner.library_keys:
                raise ScanError(400, "unknown_library", "query.library is not an analysis catalog library")
            if (
                not isinstance(identifiers, list)
                or len(identifiers) != 1
                or isinstance(identifiers[0], bool)
            ):
                raise ScanError(400, "one_query_required", "library query.antigen_ids must contain exactly one integer")
            identifier = _bounded_int(identifiers[0], "query.antigen_ids[0]", 1, self.catalog_antigen_id_max)
            query = {"kind": "library", "library": library, "antigen_ids": [identifier]}
        elif kind == "portable_protein":
            _reject_unknown(query, {"kind", "portable_id", "projection_library"}, "query")
            portable_id = query.get("portable_id")
            projection_library = query.get("projection_library")
            if not isinstance(portable_id, str) or P9P_ID.fullmatch(portable_id) is None:
                raise ScanError(422, "invalid_portable_id", "portable_id must match P9P plus nine digits")
            if projection_library not in P9P_LIBRARY_CLASS:
                raise ScanError(
                    422,
                    "unsupported_projection_library",
                    "projection_library must be panscan9_human or panscan9_exposure",
                )
            query = {
                "kind": "portable_protein",
                "portable_id": portable_id,
                "projection_library": projection_library,
            }
        else:
            raise ScanError(400, "invalid_query_kind", "query.kind must be library or portable_protein")

        target = _object(payload.get("target"), "target")
        _reject_unknown(target, {"kind", "library", "filters"}, "target")
        target_kind = target.get("kind")
        if target_kind not in {"library", "canonical_proteome"}:
            raise ScanError(
                400,
                "invalid_target_kind",
                "target.kind must be library or canonical_proteome",
            )
        target_library = target.get("library")
        if not isinstance(target_library, str) or target_library not in self.owner.library_keys:
            raise ScanError(400, "unknown_library", "target.library is not an analysis catalog library")
        filters = target.get("filters")
        if target_kind == "canonical_proteome":
            if target_library not in P9P_LIBRARY_CLASS:
                raise ScanError(
                    422,
                    "canonical_target_library_unsupported",
                    "Canonical proteome targets are Human proteins or Non-human exposures",
                )
            if floor != PLAYER_FLOOR:
                raise ScanError(
                    422,
                    "canonical_target_floor_unsupported",
                    "Canonical proteome player targets are exact only at 7/9",
                    {"available_floors": [7], "complete": False},
                )
            if filters is not None:
                raise ScanError(
                    422,
                    "canonical_target_filters_unsupported",
                    "Canonical proteome filters are unavailable until every zero-projection parent has authoritative filter annotations",
                    {"complete": False},
                )
            if self.canonical_overlay is None or getattr(self.owner, "parent_catalog", None) is None:
                raise ScanError(
                    503,
                    "canonical_parent_catalog_unavailable",
                    "The release-bound canonical parent catalog is unavailable",
                )
            if query["kind"] == "portable_protein":
                resolver = getattr(self.owner, "resolve_canonical_parent", None)
                parent = resolver(query["portable_id"]) if callable(resolver) else None
                expected_partition = P9P_LIBRARY_CLASS[query["projection_library"]]
                if (
                    not isinstance(parent, Mapping)
                    or parent.get("parent_key") != query["portable_id"]
                    or parent.get("source_partition") != expected_partition
                ):
                    raise ScanError(
                        409,
                        "canonical_query_catalog_mismatch",
                        "The portable Antigen Target is not an exact member of the frozen canonical catalog",
                        {"complete": False},
                    )
                if type(parent.get("include_default")) is not int or parent["include_default"] != 1:
                    raise ScanError(
                        409,
                        "canonical_query_not_default",
                        "This portable Antigen Target is outside the default canonical proteome",
                        {"complete": False},
                    )
            return floor, query, {
                "kind": "canonical_proteome",
                "library": target_library,
            }, maximum
        if filters is not None:
            membership = membership_for(self.owner, target_library)
            if membership is None:
                raise ScanError(409, "source_filters_unavailable", "This deployment has no membership sidecar")
            try:
                filters = membership.normalize(target_library, filters)
            except MembershipFilterError as error:
                raise ScanError(422, "invalid_source_filters", str(error)) from error
        else:
            membership = membership_for(self.owner, target_library)
            if (membership is not None and target_library in membership.libraries
                    and target_library not in getattr(self.owner, "pinned_memberships", {})):
                filters = membership.normalize(target_library, {})
        target = {"kind": "library", "library": target_library}
        if filters is not None:
            target["filters"] = filters
        return floor, query, target, maximum

    @timed("records")
    def _catalog_records(self, identifiers: Iterable[int], expected_library: str | None = None, *, prepared=None) -> dict[int, ScanRecord]:
        values = sorted(set(int(value) for value in identifiers))
        if not values:
            return {}
        records = prepared.get_many(values) if prepared is not None else {}
        records.update(self._catalog_cache.get_many(identifier for identifier in values if identifier not in records))
        uncached = [identifier for identifier in values if identifier not in records]
        if uncached:
            with closing(_read_only_connection(self.owner.catalog_path)) as connection:
                for batch in _chunks(uncached, CATALOG_BATCH):
                    placeholders = ",".join("?" for _ in batch)
                    rows = connection.execute(
                        f"""SELECT antigen_id,library_key,ordinal,seqid,short_id,raw_header,
                                   sequence,source_row,sequence_status
                            FROM antigen WHERE antigen_id IN ({placeholders})""",
                        tuple(batch),
                    )
                    for row in rows:
                        record = self.owner.scan_service._record_from_row(row)
                        self._catalog_cache.put(record)
                        records[int(record.antigen_id)] = record
        missing = sorted(set(values) - set(records))
        if missing:
            raise ScanError(404, "unknown_antigen", "One or more catalog antigen IDs do not exist", {"antigen_ids": missing})
        if expected_library is not None:
            wrong = sorted(identifier for identifier, record in records.items() if record.library != expected_library)
            if wrong:
                raise ScanError(
                    503,
                    "catalogue_library_mismatch",
                    "Static edge candidates resolve outside the requested target library",
                    {"antigen_ids": wrong[:20], "library": expected_library},
                )
        return {identifier: records[identifier] for identifier in values}

    def _catalog_by_seqid(self, library: str, seqids: Iterable[str]) -> dict[str, ScanRecord]:
        values = sorted(set(str(value) for value in seqids))
        records: dict[str, ScanRecord] = {}
        if not values:
            return records
        with closing(_read_only_connection(self.owner.catalog_path)) as connection:
            for batch in _chunks(values, CATALOG_BATCH):
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""SELECT antigen_id,library_key,ordinal,seqid,short_id,raw_header,
                               sequence,source_row,sequence_status
                        FROM antigen WHERE library_key=? AND seqid IN ({placeholders})""",
                    (library, *batch),
                )
                for row in rows:
                    record = self.owner.scan_service._record_from_row(row)
                    records[record.seqid] = record
        return records

    def _protein_rows(self, portable_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
        values = sorted(set(portable_ids))
        result: dict[str, dict[str, Any]] = {}
        if not values:
            return result
        with closing(self._explorer_connection()) as connection:
            for batch in _chunks(values, CATALOG_BATCH):
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"SELECT * FROM protein WHERE portable_id IN ({placeholders})",
                    tuple(batch),
                )
                result.update((str(row["portable_id"]), dict(row)) for row in rows)
        return result

    @staticmethod
    def _projection_exact(
        row: Mapping[str, Any],
        protein: Mapping[str, Any],
        child: ScanRecord,
        expected_class: str,
    ) -> tuple[ProjectionMap | None, str | None]:
        if str(row.get("cdi_seqid") or "") != child.seqid:
            return None, "tile_seqid_mismatch"
        if str(protein.get("class") or "") != expected_class:
            return None, "parent_class_mismatch"
        if str(row.get("home_partition") or "") != expected_class:
            return None, "home_partition_mismatch"
        if str(row.get("source_partition") or "") != expected_class:
            return None, "source_partition_mismatch"
        if str(row.get("coordinate_system") or "") != "0-based_half-open_on_portable_target":
            return None, "coordinate_system_mismatch"
        if str(row.get("mapping_status") or "") != "resolved_home_coordinate_payload_exact":
            return None, "mapping_status_mismatch"
        if str(row.get("relationship_class") or "") not in {
            "parent_membership",
            "sequence_equivalence",
        }:
            return None, "relationship_class_mismatch"
        try:
            start = int(row["target_start0"])
            end = int(row["target_end0"])
        except (TypeError, ValueError):
            return None, "missing_coordinates"
        sequence = str(protein.get("sequence") or "")
        if start < 0 or end < start or end > len(sequence):
            return None, "coordinate_bounds"
        if end - start != len(child.sequence):
            return None, "projection_length_mismatch"
        if sequence[start:end] != child.sequence:
            return None, "projection_sequence_mismatch"
        return (
            ProjectionMap(
                child_antigen_id=int(child.antigen_id),
                cdi_accession=str(row["cdi_accession"]),
                child_seqid=child.seqid,
                child_raw_header=child.raw_header,
                portable_id=str(row["portable_id"]),
                target_start0=start,
                target_end0=end,
                relationship_class=str(row["relationship_class"]),
                mapping_status=str(row["mapping_status"]),
                coordinate_system=str(row["coordinate_system"]),
                home_partition=str(row["home_partition"]),
                source_partition=str(row["source_partition"]),
            ),
            None,
        )

    def _portable_public(self, protein: Mapping[str, Any], library: str) -> dict[str, Any]:
        portable_id = str(protein["portable_id"])
        sequence = str(protein["sequence"])
        header = str(protein.get("companion_header") or protein.get("source_header") or portable_id)
        payload = {
            "record_space": "portable_protein",
            "entity_level": "portable_parent",
            "portable_id": portable_id,
            "protein_idx": AnalysisPlayerService._portable_protein_idx(portable_id),
            "antigen_id": None,
            "library": library,
            "seqid": header,
            "short_id": str(protein.get("source_accession") or portable_id),
            "raw_header": header,
            "source_header": str(protein.get("source_header") or header),
            "companion_header": str(protein.get("companion_header") or header),
            "source_accession": str(protein.get("source_accession") or ""),
            "display_name": str(protein.get("display_name") or portable_id),
            "primary_gene": protein.get("primary_gene"),
            "source_description": str(protein.get("source_description") or ""),
            "class": str(protein.get("class") or ""),
            "sequence_sha256": str(protein.get("sequence_sha256") or ""),
            "sequence": sequence,
            "length": len(sequence),
            "windows": max(0, len(sequence) - 8),
        }
        hydrator = getattr(self.owner, "annotation_hydrator", None)
        return hydrator.hydrate_canonical(payload) if hydrator is not None else payload

    def _canonical_rows(
        self,
        portable_ids: Iterable[str],
        expected_partition: str,
    ) -> dict[str, dict[str, Any]]:
        values = sorted(set(str(value) for value in portable_ids))
        if not values:
            return {}
        catalog = getattr(self.owner, "parent_catalog", None)
        if catalog is None:
            raise ScanError(
                503,
                "canonical_parent_catalog_unavailable",
                "The release-bound canonical parent catalog is unavailable",
            )
        rows = catalog.rows_by_keys(values, include_receptor_germline=True)
        output = {str(row["parent_key"]): dict(row) for row in rows}
        missing = sorted(set(values) - set(output))
        if missing:
            raise ScanError(
                409,
                "canonical_projection_parent_missing",
                "A hit-bearing tile projection has no frozen canonical parent",
                {"parent_keys": missing[:20], "missing_count": len(missing), "complete": False},
            )
        for parent_key, row in output.items():
            if (
                row.get("parent_key") != parent_key
                or row.get("id_namespace") != "P9P"
                or row.get("source_partition") != expected_partition
                or type(row.get("mapped_tile_count")) is not int
                or row["mapped_tile_count"] < 1
            ):
                raise ScanError(
                    409,
                    "canonical_projection_parent_mismatch",
                    "A hit-bearing tile projection disagrees with the frozen canonical parent policy",
                    {"parent_key": parent_key, "complete": False},
                )
            include_default = row.get("include_default")
            optional = row.get("optional_receptor_germline")
            if (
                type(include_default) is not int
                or type(optional) is not int
                or (include_default, optional) not in {(1, 0), (0, 1)}
            ):
                raise ScanError(
                    409,
                    "canonical_projection_parent_policy_mismatch",
                    "A hit-bearing tile projection has an invalid default/optional policy",
                    {"parent_key": parent_key, "complete": False},
                )
        return output

    def _canonical_public(
        self,
        parent: Mapping[str, Any],
        protein: Mapping[str, Any],
        library: str,
    ) -> dict[str, Any]:
        parent_key = str(parent["parent_key"])
        sequence = str(parent["sequence"])
        explorer_sequence = str(protein.get("sequence") or "")
        if sequence != explorer_sequence:
            raise ScanError(
                409,
                "canonical_projection_sequence_mismatch",
                "A hit-bearing projected parent differs between Explorer and the frozen canonical catalog",
                {"parent_key": parent_key, "complete": False},
            )
        base = self._portable_public(protein, library)
        original_header = str(parent["original_header"])
        canonical_header = str(parent["canonical_header"])
        seqid = original_header[1:] if original_header.startswith(">") else original_header
        companion = canonical_header[1:] if canonical_header.startswith(">") else canonical_header
        base.update(dict(parent))
        base.update({
            "record_space": "canonical_parent",
            "entity_level": "canonical_parent",
            "parent_key": parent_key,
            "portable_id": parent_key,
            "protein_idx": canonical_protein_idx(parent_key),
            "antigen_id": None,
            "library": library,
            "seqid": seqid,
            "short_id": str(parent.get("accession") or parent_key),
            "raw_header": seqid,
            "source_header": seqid,
            "companion_header": companion,
            "class": str(parent["parent_class"]),
            "source_accession": str(parent.get("accession") or ""),
            "primary_gene": str(parent.get("gene") or ""),
            "display_name": str(
                parent.get("protein_name")
                or parent.get("gene")
                or parent.get("accession")
                or parent_key
            ),
            "source_description": str(parent.get("protein_name") or ""),
            "sequence": sequence,
            "length": len(sequence),
            "windows": max(0, len(sequence) - 8),
        })
        hydrator = getattr(self.owner, "annotation_hydrator", None)
        return hydrator.hydrate_canonical(base) if hydrator is not None else base

    def _portable_query(
        self, portable_id: str, projection_library: str
    ) -> tuple[dict[str, Any], dict[int, ScanRecord], dict[int, list[dict[str, Any]]], dict[str, Any]]:
        expected_class = P9P_LIBRARY_CLASS[projection_library]
        with closing(self._explorer_connection()) as connection:
            protein_row = connection.execute(
                "SELECT * FROM protein WHERE portable_id=?", (portable_id,)
            ).fetchone()
            if protein_row is None:
                raise ScanError(404, "unknown_portable_protein", "Portable protein was not found")
            protein = dict(protein_row)
            if protein["class"] != expected_class:
                required = "panscan9_human" if protein["class"] == "Human" else "panscan9_exposure"
                raise ScanError(
                    422,
                    "projection_class_mismatch",
                    f"{protein['class']} portable proteins require projection_library={required}",
                )
            raw_rows = [
                dict(row)
                for row in connection.execute(
                    """SELECT x.*,t.cdi_seqid,t.source_partition
                       FROM projection x JOIN tile t USING(cdi_accession)
                       WHERE x.portable_id=?
                       ORDER BY x.target_start0,x.target_end0,x.cdi_accession""",
                    (portable_id,),
                )
            ]
        catalogue = self._catalog_by_seqid(
            projection_library, (row["cdi_seqid"] for row in raw_rows)
        )
        exact: dict[tuple[Any, ...], ProjectionMap] = {}
        unsafe_reasons: dict[str, int] = defaultdict(int)
        library_rows = 0
        for row in raw_rows:
            child = catalogue.get(str(row["cdi_seqid"]))
            if child is None:
                continue
            library_rows += 1
            mapping, reason = self._projection_exact(row, protein, child, expected_class)
            if mapping is None:
                unsafe_reasons[str(reason)] += 1
                continue
            key = (
                mapping.child_antigen_id,
                mapping.portable_id,
                mapping.target_start0,
                mapping.target_end0,
                mapping.cdi_accession,
            )
            exact[key] = mapping
        if unsafe_reasons:
            raise ScanError(
                422,
                "portable_projection_unsafe",
                "One or more selected query projections fail exact SeqID/sequence/coordinate validation",
                {
                    "portable_id": portable_id,
                    "projection_library": projection_library,
                    "unsafe_rows": sum(unsafe_reasons.values()),
                    "reasons": dict(sorted(unsafe_reasons.items())),
                    "live_fallback": {
                        "route": "/api/analysis/scan",
                        "mode": "live",
                        "action": "submit the full portable protein sequence as one FASTA query",
                    },
                },
            )
        if not exact:
            raise ScanError(
                422,
                "portable_projection_unavailable",
                "The portable protein has no exact child projections in the requested library",
                {
                    "portable_id": portable_id,
                    "projection_library": projection_library,
                    "live_fallback": {
                        "route": "/api/analysis/scan",
                        "mode": "live",
                        "action": "submit the full portable protein sequence as one FASTA query",
                    },
                },
            )

        sequence = str(protein["sequence"])
        searchable = max(0, len(sequence) - 8)
        covered = [False] * searchable
        spans: dict[int, list[dict[str, Any]]] = defaultdict(list)
        children: dict[int, ScanRecord] = {}
        for mapping in exact.values():
            child = catalogue[mapping.child_seqid]
            children[int(child.antigen_id)] = child
            spans[int(child.antigen_id)].append(
                {
                    "kind": "portable_projection",
                    "start0": mapping.target_start0,
                    "end0": mapping.target_end0,
                    "projection": mapping,
                }
            )
            for start in range(mapping.target_start0, mapping.target_end0 - 8):
                if 0 <= start < searchable:
                    covered[start] = True
        missing = _missing_ranges(covered)
        if missing:
            raise ScanError(
                422,
                "portable_projection_incomplete",
                "Exact projected children do not cover every searchable query 9-mer",
                {
                    "portable_id": portable_id,
                    "projection_library": projection_library,
                    "searchable_windows": searchable,
                    "covered_windows": sum(covered),
                    "missing_window_ranges_1based": missing[:100],
                    "missing_range_count": len(missing),
                    "live_fallback": {
                        "route": "/api/analysis/scan",
                        "mode": "live",
                        "action": "submit the full portable protein sequence as one FASTA query",
                    },
                },
            )
        query_record = self._portable_public(protein, projection_library)
        audit = {
            "kind": "portable_protein",
            "portable_id": portable_id,
            "projection_library": projection_library,
            "explorer_projection_rows": len(raw_rows),
            "projection_library_rows": library_rows,
            "exact_projection_rows": len(exact),
            "unique_child_antigens": len(children),
            "searchable_windows": searchable,
            "covered_windows": sum(covered),
            "coverage_complete": True,
            "child_antigen_ids": sorted(children),
            "child_seqids": [children[key].seqid for key in sorted(children)],
        }
        return query_record, children, dict(spans), audit

    def _target_projections(
        self,
        records: Mapping[int, ScanRecord],
        target_library: str,
    ) -> tuple[
        dict[int, list[ProjectionMap]],
        dict[int, set[str]],
        dict[str, dict[str, Any]],
        dict[str, Any],
    ]:
        expected_class = P9P_LIBRARY_CLASS[target_library]
        accession_to_child: dict[str, ScanRecord] = {}
        for record in records.values():
            accession = _cdi_accession(record.seqid)
            if accession is not None:
                accession_to_child[accession] = record
        raw_rows: list[dict[str, Any]] = []
        with closing(self._explorer_connection()) as connection:
            accessions = sorted(accession_to_child)
            for batch in _chunks(accessions, CATALOG_BATCH):
                placeholders = ",".join("?" for _ in batch)
                raw_rows.extend(
                    dict(row)
                    for row in connection.execute(
                        f"""SELECT x.*,t.cdi_seqid,t.source_partition
                            FROM tile t JOIN projection x USING(cdi_accession)
                            WHERE t.cdi_accession IN ({placeholders})""",
                        tuple(batch),
                    )
                )
        proteins = self._protein_rows(row["portable_id"] for row in raw_rows)
        exact: dict[int, dict[tuple[Any, ...], ProjectionMap]] = defaultdict(dict)
        all_parent_ids: dict[int, set[str]] = defaultdict(set)
        unsafe_reasons: dict[str, int] = defaultdict(int)
        rows_by_child: dict[int, int] = defaultdict(int)
        for row in raw_rows:
            child = accession_to_child.get(str(row["cdi_accession"]))
            if child is None:
                continue
            child_id = int(child.antigen_id)
            rows_by_child[child_id] += 1
            portable_id = str(row["portable_id"])
            all_parent_ids[child_id].add(portable_id)
            protein = proteins.get(portable_id)
            if protein is None:
                unsafe_reasons["missing_parent"] += 1
                continue
            mapping, reason = self._projection_exact(row, protein, child, expected_class)
            if mapping is None:
                unsafe_reasons[str(reason)] += 1
                continue
            key = (
                mapping.portable_id,
                mapping.target_start0,
                mapping.target_end0,
                mapping.cdi_accession,
            )
            exact[child_id][key] = mapping
        exact_lists = {key: list(value.values()) for key, value in exact.items()}
        audit = {
            "kind": "portable_parent_projection",
            "projection_library": target_library,
            "candidate_child_antigens": len(records),
            "candidate_children_with_projection_rows": len(rows_by_child),
            "mapped_candidate_children": sum(bool(exact_lists.get(key)) for key in records),
            "unresolved_candidate_children": sum(not exact_lists.get(key) for key in records),
            "exact_projection_rows": sum(len(value) for value in exact_lists.values()),
            "unsafe_projection_rows": sum(unsafe_reasons.values()),
            "unsafe_reasons": dict(sorted(unsafe_reasons.items())),
        }
        return exact_lists, all_parent_ids, proteins, audit

    def canonical_query_parent_keys(
        self,
        query_library: str,
        query_records: Mapping[int, ScanRecord],
    ) -> set[str]:
        """Resolve exact immutable parents for same-partition assay self exclusion."""

        if query_library not in P9P_LIBRARY_CLASS or not query_records:
            raise ScanError(
                409,
                "canonical_query_projection_unclassifiable",
                "The assay Antigen Target has no canonical parent projection space",
                {"complete": False, "no_partial_payload": True},
            )
        exact, all_parents, _proteins, audit = self._target_projections(
            query_records, query_library
        )
        unresolved = sorted(
            int(identifier) for identifier in query_records if not exact.get(int(identifier))
        )
        unsafe = int(audit.get("unsafe_projection_rows", 0))
        if unsafe or unresolved:
            raise ScanError(
                409,
                "canonical_query_projection_unclassifiable",
                "The assay Antigen Target cannot be classified safely for canonical self-parent exclusion",
                {
                    "antigen_ids": sorted(int(value) for value in query_records),
                    "unresolved_antigen_ids": unresolved,
                    "candidate_parent_keys": sorted({
                        parent_key
                        for identifier in query_records
                        for parent_key in all_parents.get(int(identifier), set())
                    }),
                    "unsafe_projection_rows": unsafe,
                    "unsafe_reasons": audit.get("unsafe_reasons", {}),
                    "complete": False,
                    "no_partial_payload": True,
                },
            )
        keys = {
            projection.portable_id
            for identifier in query_records
            for projection in exact[int(identifier)]
        }
        if not keys:
            raise ScanError(
                409,
                "canonical_query_projection_unclassifiable",
                "The assay Antigen Target resolved no immutable canonical parent keys",
                {"complete": False, "no_partial_payload": True},
            )
        return keys

    def _comparison(self, query_library: str, target_library: str) -> Any:
        key = self.owner._comparison_key_for_libraries(query_library, target_library)
        if key is None:
            raise ScanError(
                409,
                "precomputed_player_pair_unavailable",
                "The requested unordered library pair is not one of the finalized static comparisons",
                {"query_library": query_library, "target_library": target_library},
            )
        comparison = self.owner.comparisons[key]
        if not self.owner._comparison_ready(comparison):
            raise ScanError(409, "precomputed_player_pair_unavailable", "The static comparison is not complete")
        return comparison

    @timed("edges")
    def _edge_candidates(
        self,
        comparison: Any,
        query_child_ids: Sequence[int],
        *,
        floor: int,
        self_comparison: bool,
        portable_query: bool,
    ) -> list[dict[str, Any]]:
        values = sorted(set(query_child_ids))
        candidates: dict[tuple[int, int], dict[str, Any]] = {}
        query_set = set(values)
        shard = self.owner._shard_path(comparison)
        with closing(_read_only_connection(shard)) as connection:
            self.owner._assert_complete_shard(connection)
            for batch in _chunks(values, EDGE_BATCH):
                placeholders = ",".join("?" for _ in batch)
                sql = f"""
                    SELECT {EDGE_COLUMNS},antigen_a AS query_child_id,antigen_b AS source_child_id
                    FROM edge WHERE antigen_a IN ({placeholders}) AND best_identity>=?
                    UNION ALL
                    SELECT {EDGE_COLUMNS},antigen_b AS query_child_id,antigen_a AS source_child_id
                    FROM edge WHERE antigen_b IN ({placeholders}) AND best_identity>=?
                """
                rows = connection.execute(
                    sql, (*batch, int(floor), *batch, int(floor))
                )
                for row in rows:
                    query_id = int(row["query_child_id"])
                    source_id = int(row["source_child_id"])
                    if query_id == source_id:
                        continue
                    # A one-tile assay query excludes only its exact diagonal.  A
                    # portable self query is filtered later at whole-parent scope.
                    if self_comparison and not portable_query and source_id in query_set:
                        continue
                    candidates[(query_id, source_id)] = dict(row)
                    if len(candidates) > MAX_STATIC_EDGE_CANDIDATES:
                        raise ScanError(
                            422,
                            "static_candidate_limit_exceeded",
                            "Static edge candidates exceed the bounded player expansion limit",
                            {
                                "observed_minimum": len(candidates),
                                "maximum": MAX_STATIC_EDGE_CANDIDATES,
                                "no_partial_payload": True,
                                "suggested_action": (
                                    "Narrow the query or inspect static edges with keyset pagination"
                                ),
                                "pagination_route": "/api/analysis/edges",
                            },
                        )
        return list(candidates.values())

    def _static_m7_root(self, library: str) -> Path | None:
        """Return one release-bound exact-m7 cache root, if the release has one."""

        roots = getattr(self, "_static_m7_roots", None)
        if roots is None:
            roots = {}
            self._static_m7_roots = roots
        cached = roots.get(library)
        if library in roots:
            return cached
        if np is None:
            roots[library] = None
            return None
        root = Path(self.owner.root) / "window_cache" / library
        cache_manifest_path = root / "manifest.json"
        family_root = root / "indexes" / "m7"
        family_manifest_path = family_root / "manifest.json"
        # An exact m7 route needs BOTH the window cache and its m7 family manifest.
        # Libraries such as panscan9_variant, panscan9_dark and virscan_exposome_current
        # ship the window cache with a live index but no m7 family, so a missing manifest
        # means "no exact m7 index for this library", not a corrupt one. Reserve the
        # unreadable error for manifests that exist and fail to parse.
        if not cache_manifest_path.is_file() or not family_manifest_path.is_file():
            roots[library] = None
            return None
        try:
            cache = json.loads(cache_manifest_path.read_text(encoding="utf-8"))
            family = json.loads(family_manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ScanError(
                503,
                "static_m7_index_incompatible",
                "The release-bound exact m7 positional index manifest is unreadable",
            ) from error
        fingerprint = str(self.owner.manifest.get("release_fingerprint") or "")
        seeds = family.get("seeds")
        seed_rows = family.get("seed_indexes")
        expected_seeds = [list(seed) for seed in M7_SEEDS]
        required_cache = (
            "windows.npy", "window_antigen.npy", "window_position.npy", "record_offsets.npy"
        )
        valid = (
            cache.get("schema") == WINDOW_CACHE_SCHEMA
            and family.get("schema") == LIVE_INDEX_SCHEMA
            and cache.get("release_fingerprint") == fingerprint
            and family.get("release_fingerprint") == fingerprint
            and cache.get("library_key") == library
            and family.get("library_key") == library
            and family.get("mode") == "m7"
            and bool(family.get("completed_at"))
            and seeds == expected_seeds
            and isinstance(seed_rows, list)
            and len(seed_rows) == len(expected_seeds)
            and all((root / name).is_file() for name in required_cache)
        )
        if valid:
            for index, (seed, row) in enumerate(zip(expected_seeds, seed_rows)):
                seed_root = family_root / f"seed_{index:02d}"
                if (
                    not isinstance(row, dict)
                    or row.get("schema") != LIVE_SEED_SCHEMA
                    or row.get("release_fingerprint") != fingerprint
                    or row.get("library_key") != library
                    or row.get("mode") != "m7"
                    or row.get("seed_index") != index
                    or row.get("seed") != seed
                    or not all(
                        (seed_root / name).is_file()
                        for name in ("order.npy", "unique_keys.npy", "offsets.npy")
                    )
                ):
                    valid = False
                    break
        if not valid:
            raise ScanError(
                503,
                "static_m7_index_incompatible",
                "The release-bound exact m7 positional index does not match the analysis release",
                {"library": library, "complete": False, "no_partial_payload": True},
            )
        roots[library] = root
        return root

    @timed("positions")
    def _indexed_candidate_matches(
        self,
        query_records: Mapping[int, ScanRecord],
        source_records: Mapping[int, ScanRecord],
        target_library: str,
        candidates: Sequence[Mapping[str, Any]],
        *,
        floor: int,
        deadline: float,
        cancelled,
    ) -> tuple[dict[tuple[int, int], list[dict[str, Any]]], dict[str, Any]] | None:
        """Reconstruct only frozen edge candidates through the exact m7 index.

        The immutable shard remains the candidate authority.  This routine uses
        the release-bound window cache solely to materialize positions in one
        vectorized pass, then the caller independently checks every frozen n7/n8/n9
        aggregate exactly as it did for per-pair reconstruction.
        """

        root = self._static_m7_root(target_library)
        if root is None or not candidates:
            return None
        assert np is not None
        prepared_index = (
            getattr(self, "_prepared_human_index", None)
            if target_library == "canonical_human"
            and all(record.library == "canonical_human" for record in query_records.values())
            else None
        )
        def load_array(path):
            return (prepared_index.load(path) if prepared_index is not None
                    else np.load(path, mmap_mode="r", allow_pickle=False))
        query_items = [query_records[key] for key in sorted(query_records)]
        query_windows_parts = []
        query_ids_parts = []
        query_positions_parts = []
        for record in query_items:
            windows = _sequence_windows(record.sequence)
            count = int(windows.shape[0])
            if not count:
                continue
            query_windows_parts.append(windows)
            query_ids_parts.append(
                np.full(count, int(record.antigen_id), dtype=np.uint32)
            )
            query_positions_parts.append(
                np.arange(1, count + 1, dtype=np.uint32)
            )
        if not query_windows_parts:
            return {}, {
                "used": True,
                "raw_seed_hits": 0,
                "filtered_seed_hits": 0,
                "unique_candidate_pairs": 0,
                "verified_window_pairs": 0,
                "seed_count": len(M7_SEEDS),
            }
        query_windows = np.concatenate(query_windows_parts)
        query_ids_by_window = np.concatenate(query_ids_parts)
        query_positions = np.concatenate(query_positions_parts)
        allowed_edges = np.array(
            sorted({
                (int(row["query_child_id"]) << 32) | int(row["source_child_id"])
                for row in candidates
            }),
            dtype=np.uint64,
        )
        target_antigens = load_array(root / "window_antigen.npy")
        family_root = root / "indexes" / "m7"
        candidate_pairs = np.empty(0, dtype=np.uint64)
        raw_seed_hits = 0
        filtered_seed_hits = 0
        for seed_index, seed in enumerate(M7_SEEDS):
            if cancelled():
                raise ScanError(499, "client_cancelled", "The superseded player request was canceled")
            if time.monotonic() > deadline:
                raise ScanError(
                    408,
                    "static_player_timeout",
                    "Static indexed positional reconstruction exceeded its bounded wall-time",
                    {"maximum_seconds": MAX_PLAYER_SECONDS},
                )
            seed_root = family_root / f"seed_{seed_index:02d}"
            unique_keys = load_array(seed_root / "unique_keys.npy")
            offsets = load_array(seed_root / "offsets.npy")
            order = load_array(seed_root / "order.npy")
            matching = _matching_buckets(
                _pack_seed_keys(query_windows, seed), unique_keys, offsets
            )
            counts = matching[2]
            raw_seed_hits += int(np.sum(counts, dtype=np.uint64)) if counts.size else 0
            if raw_seed_hits > MAX_STATIC_M7_RAW_SEED_HITS:
                raise ScanError(
                    422,
                    "static_m7_candidate_limit_exceeded",
                    "The exact static m7 index exceeds the synchronous seed-candidate budget",
                    {
                        "guard": "raw_seed_hits",
                        "observed": raw_seed_hits,
                        "maximum": MAX_STATIC_M7_RAW_SEED_HITS,
                        "async_required": True,
                        "complete": False,
                        "no_partial_payload": True,
                    },
                )
            for query_local, target_order_positions in _flatten_candidates(*matching):
                target_local = order[target_order_positions].astype(np.uint64, copy=False)
                edge_keys = (
                    query_ids_by_window[query_local].astype(np.uint64, copy=False)
                    << np.uint64(32)
                ) | target_antigens[target_local].astype(np.uint64, copy=False)
                locations = np.searchsorted(allowed_edges, edge_keys)
                keep = locations < allowed_edges.size
                if np.any(keep):
                    valid = np.flatnonzero(keep)
                    keep[valid] = allowed_edges[locations[valid]] == edge_keys[valid]
                if not np.any(keep):
                    continue
                filtered_seed_hits += int(np.count_nonzero(keep))
                if filtered_seed_hits > MAX_STATIC_M7_FILTERED_SEED_HITS:
                    raise ScanError(
                        422,
                        "static_m7_candidate_limit_exceeded",
                        "The exact static m7 index exceeds the synchronous filtered-candidate budget",
                        {
                            "guard": "filtered_seed_hits",
                            "observed": filtered_seed_hits,
                            "maximum": MAX_STATIC_M7_FILTERED_SEED_HITS,
                            "async_required": True,
                            "complete": False,
                            "no_partial_payload": True,
                        },
                    )
                packed = (
                    query_local[keep].astype(np.uint64, copy=False) << np.uint64(32)
                ) | target_local[keep]
                unique = np.unique(packed)
                candidate_pairs = (
                    unique
                    if not candidate_pairs.size
                    else np.union1d(candidate_pairs, unique)
                )
                if candidate_pairs.size > MAX_STATIC_M7_UNIQUE_CANDIDATES:
                    raise ScanError(
                        422,
                        "static_m7_candidate_limit_exceeded",
                        "The exact static m7 index exceeds the synchronous unique-candidate budget",
                        {
                            "guard": "unique_candidate_pairs",
                            "observed": int(candidate_pairs.size),
                            "maximum": MAX_STATIC_M7_UNIQUE_CANDIDATES,
                            "async_required": True,
                            "complete": False,
                            "no_partial_payload": True,
                        },
                    )

        query_local = (candidate_pairs >> np.uint64(32)).astype(np.intp, copy=False)
        target_local = (
            candidate_pairs & np.uint64(0xFFFFFFFF)
        ).astype(np.intp, copy=False)
        target_windows = load_array(root / "windows.npy")
        target_positions = load_array(root / "window_position.npy")
        output: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
        verified_hits = 0
        for start in range(0, query_local.size, CANDIDATE_BATCH):
            if cancelled():
                raise ScanError(499, "client_cancelled", "The superseded player request was canceled")
            if time.monotonic() > deadline:
                raise ScanError(
                    408,
                    "static_player_timeout",
                    "Static indexed positional reconstruction exceeded its bounded wall-time",
                    {"maximum_seconds": MAX_PLAYER_SECONDS},
                )
            stop = min(query_local.size, start + CANDIDATE_BATCH)
            selected_query = query_local[start:stop]
            selected_target = target_local[start:stop]
            left = query_windows[selected_query]
            right = target_windows[selected_target]
            identities = np.count_nonzero(
                (left == right) & (left < 20) & (right < 20), axis=1
            ).astype(np.uint8)
            keep = identities >= int(floor)
            if not np.any(keep):
                continue
            kept_query = selected_query[keep]
            kept_target = selected_target[keep]
            kept_identity = identities[keep]
            verified_hits += int(kept_query.size)
            if verified_hits > MAX_RECONSTRUCTED_CHILD_HITS:
                raise ScanError(
                    422,
                    "reconstruction_limit_exceeded",
                    "Static child-pair positions exceed the bounded reconstruction limit",
                    {"maximum": MAX_RECONSTRUCTED_CHILD_HITS},
                )
            for query_index, target_index, identity in zip(
                kept_query.tolist(), kept_target.tolist(), kept_identity.tolist()
            ):
                query_id = int(query_ids_by_window[query_index])
                source_id = int(target_antigens[target_index])
                query_position = int(query_positions[query_index])
                source_position = int(target_positions[target_index])
                query_record = query_records[query_id]
                source_record = source_records[source_id]
                output[(query_id, source_id)].append(
                    {
                        "position_a": query_position,
                        "position_b": source_position,
                        "identity": int(identity),
                        "window_a": query_record.sequence[
                            query_position - 1 : query_position + 8
                        ],
                        "window_b": source_record.sequence[
                            source_position - 1 : source_position + 8
                        ],
                    }
                )
        for matches in output.values():
            matches.sort(
                key=lambda row: (
                    int(row["position_a"]),
                    int(row["position_b"]),
                    -int(row["identity"]),
                )
            )
        return dict(output), {
            "used": True,
            "raw_seed_hits": raw_seed_hits,
            "filtered_seed_hits": filtered_seed_hits,
            "unique_candidate_pairs": int(candidate_pairs.size),
            "verified_window_pairs": verified_hits,
            "seed_count": len(M7_SEEDS),
        }

    def _source_plan(
        self,
        source_records: Mapping[int, ScanRecord],
        target_library: str,
        *,
        portable_query_id: str | None,
        query_parent_keys: set[str] | frozenset[str] | None = None,
        self_comparison: bool,
        max_results: int,
        canonical_view: bool = False,
    ) -> tuple[dict[int, list[dict[str, Any]]], dict[tuple[str, Any], dict[str, Any]], dict[str, Any]]:
        mappings: dict[int, list[dict[str, Any]]] = defaultdict(list)
        entities: dict[tuple[str, Any], dict[str, Any]] = {}
        # Literal assay libraries stay tile-versus-tile at every floor: a library
        # target keeps its own catalog rows and coordinates. Painting tiles onto
        # full-length parents belongs to the canonical proteome view alone, which is
        # the only caller that asks for canonical_view (guaranteed to be a
        # P9P_LIBRARY_CLASS library by the target_kind validation above).
        if not (canonical_view and target_library in P9P_LIBRARY_CLASS):
            for child_id, child in source_records.items():
                key = ("antigen", child_id)
                record = child.public()
                record.update(
                    {
                        "protein_idx": child_id,
                        "entity_level": "analysis_catalog_antigen",
                        "mapping_status": "not_applicable",
                    }
                )
                entities[key] = {"kind": "analysis_catalog_antigen", "record": record}
                mappings[child_id].append(
                    {
                        "entity_key": key,
                        "start0": 0,
                        "projection": None,
                        "mapping_status": "not_applicable",
                    }
                )
            audit = {
                "kind": "assay_catalog",
                "candidate_child_antigens": len(source_records),
                "mapped_candidate_children": 0,
                "unresolved_candidate_children": 0,
                "self_parent_exclusions": 0,
            }
        else:
            exact, all_parents, proteins, audit = self._target_projections(
                source_records, target_library
            )
            if canonical_view and int(audit.get("unsafe_projection_rows", 0)) > 0:
                raise ScanError(
                    409,
                    "canonical_target_projection_unclassifiable",
                    "A hit-bearing target tile has an unsafe canonical-parent projection",
                    {
                        "unsafe_projection_rows": int(audit["unsafe_projection_rows"]),
                        "unsafe_reasons": audit.get("unsafe_reasons", {}),
                        "complete": False,
                    },
                )
            canonical_rows = (
                self._canonical_rows(
                    (
                        projection.portable_id
                        for projections in exact.values()
                        for projection in projections
                    ),
                    P9P_LIBRARY_CLASS[target_library],
                )
                if canonical_view
                else {}
            )
            excluded_query_parents = set(query_parent_keys or ())
            if portable_query_id is not None:
                excluded_query_parents.add(portable_query_id)
            self_exclusions = 0
            policy_exclusions = 0
            policy_excluded_parents: set[str] = set()
            mapped_children = 0
            unresolved_children = 0
            for child_id, child in source_records.items():
                exact_maps = exact.get(child_id, [])
                kept = []
                for projection in exact_maps:
                    if (
                        self_comparison
                        and projection.portable_id in excluded_query_parents
                    ):
                        self_exclusions += 1
                        continue
                    if canonical_view:
                        canonical_parent = canonical_rows[projection.portable_id]
                        if canonical_parent["include_default"] != 1:
                            policy_exclusions += 1
                            policy_excluded_parents.add(projection.portable_id)
                            continue
                    kept.append(projection)
                if kept:
                    mapped_children += 1
                    for projection in kept:
                        protein = proteins[projection.portable_id]
                        key = ("portable", projection.portable_id)
                        if canonical_view:
                            entity_kind = "canonical_parent"
                            entity_record = self._canonical_public(
                                canonical_rows[projection.portable_id],
                                protein,
                                target_library,
                            )
                        else:
                            entity_kind = "portable_parent"
                            entity_record = self._portable_public(protein, target_library)
                        entities.setdefault(
                            key,
                            {
                                "kind": entity_kind,
                                "record": entity_record,
                            },
                        )
                        mappings[child_id].append(
                            {
                                "entity_key": key,
                                "start0": projection.target_start0,
                                "projection": projection,
                                "mapping_status": "exact_portable_projection",
                            }
                        )
                    continue

                belongs_to_query_parent = (
                    self_comparison
                    and bool(excluded_query_parents.intersection(all_parents.get(child_id, set())))
                )
                if belongs_to_query_parent:
                    self_exclusions += 1
                    continue
                if exact_maps and not kept:
                    # Every exact projection was intentionally excluded either
                    # as whole-parent self or by the frozen optional policy.
                    continue
                unresolved_children += 1
                if canonical_view:
                    continue
                key = ("unresolved", child_id)
                record = child.public()
                record.update(
                    {
                        "protein_idx": child_id,
                        "entity_level": "unresolved_assay_antigen",
                        "mapping_status": (
                            "unsafe_nonexact_projection"
                            if all_parents.get(child_id)
                            else "no_projection_mapping"
                        ),
                    }
                )
                entities[key] = {"kind": "unresolved_assay_antigen", "record": record}
                mappings[child_id].append(
                    {
                        "entity_key": key,
                        "start0": 0,
                        "projection": None,
                        "mapping_status": record["mapping_status"],
                    }
                )
            audit.update(
                {
                    "mapped_candidate_children_after_self_exclusion": mapped_children,
                    "unresolved_candidate_children_after_self_exclusion": unresolved_children,
                    "self_parent_exclusions": self_exclusions,
                    "canonical_policy_projection_exclusions": policy_exclusions,
                    "canonical_policy_parent_exclusions": len(policy_excluded_parents),
                    "canonical_policy_excluded_parent_keys": sorted(policy_excluded_parents),
                }
            )
            if canonical_view and unresolved_children:
                raise ScanError(
                    409,
                    "canonical_target_unclassifiable_rows",
                    "One or more hit-bearing target tiles cannot be classified as a canonical parent",
                    {
                        "unresolved_candidate_children": unresolved_children,
                        "complete": False,
                    },
                )

        if len(entities) > max_results:
            raise ScanError(
                422,
                "result_limit_exceeded",
                "The complete static player result exceeds max_results; no partial payload was returned",
                {"result_pairs": len(entities), "maximum": max_results},
            )
        return dict(mappings), entities, audit

    @staticmethod
    def _floor_stats(hits: Sequence[list[Any]], floor: int) -> dict[str, Any]:
        output: dict[str, Any] = {}
        for threshold in range(floor, 10):
            selected = [hit for hit in hits if int(hit[2]) >= threshold]
            query_positions = [int(hit[0]) for hit in selected]
            source_positions = [int(hit[1]) for hit in selected]
            output[f"m{threshold}"] = {
                "query_windows": len(set(query_positions)),
                "source_windows": len(set(source_positions)),
                "pairs": len(selected),
                "query_loci": _loci_count(query_positions),
                "source_loci": _loci_count(source_positions),
            }
        return output

    @staticmethod
    def _contribution_key(item: Mapping[str, Any]) -> tuple[Any, ...]:
        query = item["query_child"]
        source = item["source_child"]
        return (
            query.get("antigen_id"),
            query.get("target_start0"),
            source.get("antigen_id"),
            source.get("portable_id"),
            source.get("target_start0"),
        )

    @timed("player")
    def _run(self, payload: dict[str, Any], *, cancelled=None) -> dict[str, Any]:
        cancelled = cancelled or (lambda: False)
        if cancelled():
            raise ScanError(499, "client_cancelled", "The superseded player request was canceled")
        floor, query_selector, target_selector, max_results = self._parse_request(payload)
        started = time.monotonic()
        deadline = started + MAX_PLAYER_SECONDS
        target_library = target_selector["library"]
        canonical_view = target_selector["kind"] == "canonical_proteome"
        portable_query_id: str | None = None
        # Pre-resolved display metadata is used only for direct human-to-human
        # requests. Scope, self exclusion and matching still run below unchanged.
        prepared_records = (
            getattr(self, "_prepared_human_records", None)
            if query_selector["kind"] == "library"
            and query_selector["library"] == "canonical_human"
            and target_selector["kind"] == "library"
            and target_library == "canonical_human"
            else None
        )

        if query_selector["kind"] == "portable_protein":
            portable_query_id = query_selector["portable_id"]
            query_library = query_selector["projection_library"]
            query_record, query_children, query_spans, query_audit = self._portable_query(
                portable_query_id, query_library
            )
            if canonical_view:
                parent = self._canonical_rows(
                    [portable_query_id], P9P_LIBRARY_CLASS[query_library]
                )[portable_query_id]
                if parent["include_default"] != 1:
                    raise ScanError(
                        409,
                        "canonical_query_not_default",
                        "This portable Antigen Target is outside the default canonical proteome",
                        {"complete": False},
                    )
                query_record = self._canonical_public(parent, query_record, query_library)
        else:
            query_library = query_selector["library"]
            identifier = int(query_selector["antigen_ids"][0])
            query_children = self._catalog_records(
                [identifier], expected_library=query_library, prepared=prepared_records)
            child = query_children[identifier]
            query_record = child.public()
            query_record["protein_idx"] = identifier
            query_spans = {
                identifier: [
                    {
                        "kind": "analysis_catalog_query",
                        "start0": 0,
                        "end0": len(child.sequence),
                        "projection": None,
                    }
                ]
            }
            query_audit = {
                "kind": "analysis_catalog_antigen",
                "library": query_library,
                "antigen_id": identifier,
                "seqid": child.seqid,
                "coverage_complete": True,
            }

        if cancelled():
            raise ScanError(499, "client_cancelled", "The superseded player request was canceled")

        comparison = self._comparison(query_library, target_library)
        self_comparison = query_library == target_library
        query_parent_keys: set[str] = {portable_query_id} if portable_query_id else set()
        if (
            canonical_view
            and self_comparison
            and portable_query_id is None
            and query_library in P9P_LIBRARY_CLASS
        ):
            query_parent_keys = self.canonical_query_parent_keys(
                query_library, query_children
            )
            query_audit["canonical_query_parent_keys"] = sorted(query_parent_keys)
            query_audit["canonical_self_parent_exclusion"] = True
        candidates = self._edge_candidates(
            comparison,
            list(query_children),
            floor=floor,
            self_comparison=self_comparison,
            portable_query=portable_query_id is not None,
        )
        if cancelled():
            raise ScanError(499, "client_cancelled", "The superseded player request was canceled")
        target_filters = target_selector.get("filters")
        if target_filters is not None:
            membership = membership_for(self.owner, target_library)
            assert membership is not None
            candidate_ids = {int(row["source_child_id"]) for row in candidates}
            allowed_ids = membership.allowed_ids(
                target_library, candidate_ids, target_filters
            )
            candidates = [
                row for row in candidates
                if int(row["source_child_id"]) in allowed_ids
            ]
        source_ids = sorted({int(row["source_child_id"]) for row in candidates})
        source_records = self._catalog_records(
            source_ids, expected_library=target_library, prepared=prepared_records)
        source_mappings, entities, target_audit = self._source_plan(
            source_records,
            target_library,
            portable_query_id=portable_query_id,
            query_parent_keys=query_parent_keys,
            self_comparison=self_comparison,
            max_results=max_results,
            canonical_view=canonical_view,
        )
        if cancelled():
            raise ScanError(499, "client_cancelled", "The superseded player request was canceled")

        groups: dict[tuple[str, Any], dict[str, Any]] = {}
        pair_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
        query_seed_indexes: dict[str, tuple[dict[str, list[int]], ...]] = {}
        indexed_expansion = self._indexed_candidate_matches(
            query_children,
            source_records,
            target_library,
            candidates,
            floor=floor,
            deadline=deadline,
            cancelled=cancelled,
        )
        indexed_matches = indexed_expansion[0] if indexed_expansion is not None else None
        static_m7_metrics = indexed_expansion[1] if indexed_expansion is not None else {
            "used": False,
            "reason": "release_bound_m7_index_unavailable",
        }
        raw_child_hits = 0
        provenance_contributions = 0
        canonical_overlay_metrics: dict[str, Any] | None = None
        for candidate in candidates:
            if cancelled():
                raise ScanError(499, "client_cancelled", "The superseded player request was canceled")
            if time.monotonic() > deadline:
                raise ScanError(
                    408,
                    "static_player_timeout",
                    "Static positional reconstruction exceeded its bounded wall-time",
                    {"maximum_seconds": MAX_PLAYER_SECONDS},
                )
            query_child_id = int(candidate["query_child_id"])
            source_child_id = int(candidate["source_child_id"])
            query_child = query_children.get(query_child_id)
            source_child = source_records.get(source_child_id)
            if query_child is None or source_child is None:
                raise ScanError(503, "catalog_join_failed", "A static edge candidate is missing from the catalog")
            cache_key = (query_child.sequence, source_child.sequence)
            matches = (
                indexed_matches.get((query_child_id, source_child_id), [])
                if indexed_matches is not None
                else pair_cache.get(cache_key)
            )
            if matches is None:
                try:
                    # Every candidate shares one of a small number of query
                    # children. Index that repeated side once, scan each parent
                    # against it, then restore the public query/source direction.
                    target_indexes = query_seed_indexes.get(query_child.sequence)
                    if target_indexes is None:
                        target_indexes = _pair_seed_index(query_child.sequence)
                        query_seed_indexes[query_child.sequence] = target_indexes
                    reversed_matches, truncated = _pair_matches_indexed(
                        source_child.sequence,
                        query_child.sequence,
                        floor=floor,
                        maximum=MAX_RETURNED_HITS,
                        target_indexes=target_indexes,
                    )
                    matches = [
                        {
                            "position_a": match["position_b"],
                            "position_b": match["position_a"],
                            "identity": match["identity"],
                            "window_a": match["window_b"],
                            "window_b": match["window_a"],
                        }
                        for match in reversed_matches
                    ]
                except APIError as error:
                    raise ScanError(
                        422,
                        "positions_unavailable",
                        "A static edge candidate cannot be expanded completely within the positional guard",
                        {
                            "query_child_antigen_id": query_child_id,
                            "source_child_antigen_id": source_child_id,
                            "reason": error.message,
                        },
                    ) from error
                if truncated:
                    raise ScanError(
                        422,
                        "positions_incomplete",
                        "A static edge candidate exceeds the complete positional-hit guard",
                        {
                            "query_child_antigen_id": query_child_id,
                            "source_child_antigen_id": source_child_id,
                            "maximum": MAX_RETURNED_HITS,
                        },
                    )
                pair_cache[cache_key] = matches
            observed = {
                threshold: sum(int(match["identity"]) >= threshold for match in matches)
                for threshold in range(floor, 10)
            }
            if (
                any(observed[threshold] != int(candidate[f"n{threshold}"]) for threshold in range(floor, 10))
                or (matches and max(int(match["identity"]) for match in matches) != int(candidate["best_identity"]))
                or (not matches and int(candidate["best_identity"]) >= floor)
            ):
                raise ScanError(
                    409,
                    "static_position_mismatch",
                    "Reconstructed positions do not reproduce the frozen edge aggregate",
                    {
                        "comparison": comparison.key,
                        "query_child_antigen_id": query_child_id,
                        "source_child_antigen_id": source_child_id,
                    },
                )
            raw_child_hits += len(matches)
            if raw_child_hits > MAX_RECONSTRUCTED_CHILD_HITS:
                raise ScanError(
                    422,
                    "reconstruction_limit_exceeded",
                    "Static child-pair positions exceed the bounded reconstruction limit",
                    {"maximum": MAX_RECONSTRUCTED_CHILD_HITS},
                )

            for query_span in query_spans[query_child_id]:
                query_start0 = int(query_span["start0"])
                query_projection = query_span.get("projection")
                for source_mapping in source_mappings.get(source_child_id, []):
                    entity_key = source_mapping["entity_key"]
                    entity = entities[entity_key]
                    source_record = entity["record"]
                    source_start0 = int(source_mapping["start0"])
                    source_projection = source_mapping.get("projection")
                    group = groups.setdefault(
                        entity_key,
                        {
                            "entity": entity,
                            "hits": {},
                            "source_children": {},
                            "source_projections": {},
                        },
                    )
                    group["source_children"][source_child_id] = source_child
                    if source_projection is not None:
                        projection_public = source_projection.public()
                        projection_key = (
                            projection_public["child_antigen_id"],
                            projection_public["portable_id"],
                            projection_public["target_start0"],
                            projection_public["target_end0"],
                        )
                        group["source_projections"][projection_key] = projection_public
                    for match in matches:
                        query_start = query_start0 + int(match["position_a"])
                        source_start = source_start0 + int(match["position_b"])
                        identity = int(match["identity"])
                        query_9mer = str(match["window_a"])
                        source_9mer = str(match["window_b"])
                        if str(query_record["sequence"])[query_start - 1 : query_start + 8] != query_9mer:
                            raise ScanError(409, "query_projection_mismatch", "A remapped query hit does not match the full protein sequence")
                        if str(source_record["sequence"])[source_start - 1 : source_start + 8] != source_9mer:
                            raise ScanError(409, "source_projection_mismatch", "A remapped source hit does not match the full protein sequence")
                        hit_key = (query_start, source_start, identity, query_9mer, source_9mer)
                        hit_item = group["hits"].setdefault(
                            hit_key,
                            {
                                "hit": [query_start, source_start, identity, query_9mer, source_9mer],
                                "contributions": {},
                            },
                        )
                        query_child_public = {
                            "antigen_id": query_child_id,
                            "seqid": query_child.seqid,
                            "raw_header": query_child.raw_header,
                            "cdi_accession": _cdi_accession(query_child.seqid),
                            "target_start0": query_start0,
                            "target_end0": int(query_span["end0"]),
                            "portable_id": portable_query_id,
                        }
                        source_child_public = {
                            "antigen_id": source_child_id,
                            "seqid": source_child.seqid,
                            "raw_header": source_child.raw_header,
                            "cdi_accession": _cdi_accession(source_child.seqid),
                            "portable_id": (
                                source_projection.portable_id
                                if source_projection is not None
                                else None
                            ),
                            "target_start0": source_start0,
                            "target_end0": (
                                source_projection.target_end0
                                if source_projection is not None
                                else len(source_child.sequence)
                            ),
                            "mapping_status": source_mapping["mapping_status"],
                        }
                        contribution = {
                            "query_child": query_child_public,
                            "source_child": source_child_public,
                            "static_edge": {
                                "comparison": comparison.key,
                                "query_child_antigen_id": query_child_id,
                                "source_child_antigen_id": source_child_id,
                                "best_identity": int(candidate["best_identity"]),
                            },
                        }
                        contribution_key = self._contribution_key(contribution)
                        if contribution_key not in hit_item["contributions"]:
                            hit_item["contributions"][contribution_key] = contribution
                            provenance_contributions += 1
                            if provenance_contributions > MAX_PROVENANCE_CONTRIBUTIONS:
                                raise ScanError(
                                    422,
                                    "projection_provenance_limit_exceeded",
                                    "Projected hit provenance exceeds the bounded response limit",
                                    {"maximum": MAX_PROVENANCE_CONTRIBUTIONS},
                                )

            total_hits = sum(len(group["hits"]) for group in groups.values())
            if total_hits > MAX_RETURNED_HITS:
                raise ScanError(
                    422,
                    "returned_hit_limit_exceeded",
                    "The complete projected result exceeds the positional-hit response guard",
                    {"hits": total_hits, "maximum": MAX_RETURNED_HITS},
                )

        if canonical_view:
            if cancelled():
                raise ScanError(499, "client_cancelled", "The superseded player request was canceled")
            assert self.canonical_overlay is not None
            try:
                overlay = self.canonical_overlay.match(
                    str(query_record["sequence"]),
                    partition=P9P_LIBRARY_CLASS[target_library],
                    floor=floor,
                    query_parent_key=portable_query_id,
                    deadline=deadline,
                )
            except CanonicalParentOverlayError as error:
                raise ScanError(
                    error.status,
                    error.code,
                    error.message,
                    error.details,
                ) from error
            canonical_overlay_metrics = dict(overlay.metrics)
            for parent_key, overlay_group in overlay.groups.items():
                entity_key = ("portable", parent_key)
                if entity_key in groups or entity_key in entities:
                    raise ScanError(
                        409,
                        "canonical_overlay_projection_collision",
                        "A zero-projection canonical parent also appeared in the projected static result",
                        {"parent_key": parent_key, "complete": False},
                    )
                source_record = dict(overlay_group["record"])
                hydrator = getattr(self.owner, "annotation_hydrator", None)
                if hydrator is not None:
                    source_record = hydrator.hydrate_canonical(source_record)
                entity = {"kind": "canonical_parent", "record": source_record}
                entities[entity_key] = entity
                group = {
                    "entity": entity,
                    "hits": {},
                    "source_children": {},
                    "source_projections": {},
                }
                for hit in overlay_group["hits"]:
                    query_start, source_start, identity, query_9mer, source_9mer = hit
                    if str(query_record["sequence"])[query_start - 1:query_start + 8] != query_9mer:
                        raise ScanError(
                            409,
                            "canonical_overlay_query_mismatch",
                            "An overlay query 9-mer differs from its full sequence",
                            {"parent_key": parent_key, "complete": False},
                        )
                    if str(source_record["sequence"])[source_start - 1:source_start + 8] != source_9mer:
                        raise ScanError(
                            409,
                            "canonical_overlay_source_mismatch",
                            "An overlay source 9-mer differs from its full canonical sequence",
                            {"parent_key": parent_key, "complete": False},
                        )
                    hit_key = (
                        int(query_start), int(source_start), int(identity),
                        str(query_9mer), str(source_9mer),
                    )
                    contribution = {
                        "query_child": {
                            "antigen_id": query_record.get("antigen_id"),
                            "seqid": query_record.get("seqid"),
                            "raw_header": query_record.get("raw_header"),
                            "target_start0": int(query_start) - 1,
                            "target_end0": int(query_start) + 8,
                            "portable_id": portable_query_id,
                        },
                        "source_child": {
                            "antigen_id": None,
                            "seqid": source_record.get("seqid"),
                            "raw_header": source_record.get("raw_header"),
                            "portable_id": parent_key,
                            "target_start0": int(source_start) - 1,
                            "target_end0": int(source_start) + 8,
                            "mapping_status": "canonical_parent_overlay_exact_full_sequence",
                        },
                        "canonical_parent_overlay": {
                            "parent_key": parent_key,
                            "id_namespace": source_record.get("id_namespace"),
                            "floor": floor,
                            "event_semantics": "unique_query_start_source_start_coordinate_pairs",
                        },
                    }
                    contribution_key = self._contribution_key(contribution)
                    group["hits"][hit_key] = {
                        "hit": list(hit),
                        "contributions": {contribution_key: contribution},
                    }
                    provenance_contributions += 1
                    if provenance_contributions > MAX_PROVENANCE_CONTRIBUTIONS:
                        raise ScanError(
                            422,
                            "projection_provenance_limit_exceeded",
                            "Canonical positional provenance exceeds the bounded response limit",
                            {"maximum": MAX_PROVENANCE_CONTRIBUTIONS, "complete": False},
                        )
                groups[entity_key] = group
            total_hits = sum(len(group["hits"]) for group in groups.values())
            if total_hits > MAX_RETURNED_HITS:
                raise ScanError(
                    422,
                    "returned_hit_limit_exceeded",
                    "The complete canonical result exceeds the positional-hit response guard",
                    {"hits": total_hits, "maximum": MAX_RETURNED_HITS, "complete": False},
                )

        # Candidate entities always have at least one frozen >=7 edge.  Empty groups
        # arise only from explicit whole-parent self exclusion and are omitted safely.
        if len(groups) > max_results:
            raise ScanError(
                422,
                "result_limit_exceeded",
                "The complete static player result exceeds max_results; no partial payload was returned",
                {"result_pairs": len(groups), "maximum": max_results},
            )

        source_catalog: list[dict[str, Any]] = []
        results: list[dict[str, Any]] = []
        query_result_record = _without_sequence(query_record)
        for entity_key, group in groups.items():
            hit_items = sorted(
                group["hits"].values(),
                key=lambda item: (item["hit"][0], item["hit"][1], -item["hit"][2]),
            )
            hits = [item["hit"] for item in hit_items]
            if not hits:
                continue
            source_record = dict(group["entity"]["record"])
            child_ids = sorted(group["source_children"])
            child_seqids = [group["source_children"][key].seqid for key in child_ids]
            child_headers = [group["source_children"][key].raw_header for key in child_ids]
            projections = list(group["source_projections"].values())
            source_record.update(
                {
                    "child_antigen_ids": child_ids,
                    "child_seqids": child_seqids,
                    "child_raw_headers": child_headers,
                    "projection_provenance": projections,
                }
            )
            source_catalog.append(source_record)
            source_result = _without_sequence(source_record)
            result = {
                "query": query_result_record,
                "source": source_result,
                "best_identity": max(int(hit[2]) for hit in hits),
                "floors": self._floor_stats(hits, floor),
                "positions": "included",
                "hits_schema": [
                    "query_start",
                    "source_start",
                    "identity",
                    "query_9mer",
                    "source_9mer",
                ],
                "hits": hits,
                "hit_provenance_schema": (
                    "one object per hits row; contributions list preserves every "
                    "deduplicated static child-tile or exact canonical-overlay path"
                ),
                "hit_provenance": [
                    {
                        "hit_index": index,
                        "contributions": list(item["contributions"].values()),
                    }
                    for index, item in enumerate(hit_items)
                ],
                "child_antigen_ids": child_ids,
                "child_seqids": child_seqids,
                "child_raw_headers": child_headers,
                "projection_provenance": projections,
            }
            results.append(result)

        results.sort(
            key=lambda row: (
                -int(row["best_identity"]),
                str(row["source"].get("seqid") or ""),
            )
        )
        source_catalog.sort(key=lambda row: int(row["protein_idx"]))
        referenced = {int(row["source"]["protein_idx"]) for row in results}
        if referenced != {int(row["protein_idx"]) for row in source_catalog}:
            raise ScanError(500, "source_catalog_invariant", "Source catalog reference invariant failed")

        kinds = {group["entity"]["kind"] for group in groups.values() if group["hits"]}
        if canonical_view:
            if not kinds.issubset({"canonical_parent"}):
                raise ScanError(
                    500,
                    "canonical_target_entity_invariant",
                    "A canonical proteome result contains a noncanonical source entity",
                )
            entity_level = "canonical_parent"
            entity_label = "canonical parent proteins"
        else:
            # Every library target, PanScan9 included, now reports its literal
            # catalog rows; parent grouping only happens in the canonical view above.
            entity_level = "analysis_catalog_antigen"
            entity_label = "assay antigens"

        target_audit.update(
            {
                "result_entities": len(results),
                "portable_parent_results": sum(
                    row.get("entity_level") == "portable_parent" for row in source_catalog
                ),
                "canonical_parent_results": sum(
                    row.get("entity_level") == "canonical_parent" for row in source_catalog
                ),
                "unresolved_assay_results": sum(
                    row.get("entity_level") == "unresolved_assay_antigen"
                    for row in source_catalog
                ),
            }
        )
        elapsed = round(time.monotonic() - started, 6)
        return {
            "schema": PLAYER_SCHEMA,
            "release_fingerprint": str(
                getattr(self.owner, "manifest", {}).get("release_fingerprint") or ""
            ),
            "job_id": uuid.uuid4().hex,
            "available_floors": [7, 8, 9],
            "request": {
                "mode_requested": "precomputed_player",
                "floor": floor,
                "window": 9,
                "query": query_selector,
                "target": target_selector,
                "include_hits": True,
                "max_results": max_results,
            },
            "comparison": comparison.key,
            "query_records": [query_record],
            "target": {
                "kind": target_selector["kind"],
                "library": target_library,
                "entity_level": entity_level,
                "entity_label": entity_label,
                "comparison": comparison.key,
                **({
                    "canonical_default_count": CANONICAL_DEFAULT_COUNTS[target_library],
                    "canonical_complete": True,
                } if canonical_view else {}),
            },
            "source_catalog": source_catalog,
            "results": results,
            "result_count": len(results),
            "projection_audit": {
                "child_edge_count": len(candidates),
                "grouped_result_count": len(results),
                "query": query_audit,
                "target": {
                    **target_audit,
                    "child_edge_count": len(candidates),
                    "grouped_result_count": len(results),
                    **({
                        "canonical_default_count": CANONICAL_DEFAULT_COUNTS[target_library],
                        "canonical_overlay": canonical_overlay_metrics,
                    } if canonical_view else {}),
                },
                "protein_idx_namespace": {
                    "catalog_antigen_ids": f"1..{self.catalog_antigen_id_max}",
                    "portable_parent_offset": P9P_PROTEIN_IDX_OFFSET,
                    "portable_parent_formula": "offset + numeric P9P suffix",
                    "canonical_parent_offsets": {
                        "P9P": 10_000_000_000,
                        "M1E": 20_000_000_000,
                    },
                    "collision_free": True,
                },
            },
            "execution": {
                "mode": "precomputed_player",
                "complete": True,
                "synchronous": True,
                "bounded": True,
                "positional_hits_included": True,
                "aggregate_counts_exact": True,
                "strategy": (
                    "frozen_edge_candidates_plus_exact_pair_position_reconstruction_plus_atomic_canonical_overlay"
                    if canonical_view
                    else "frozen_edge_candidates_plus_exact_pair_position_reconstruction"
                ),
                "whole_library_live_scan": False,
                "live_index_used": False,
                "static_m7_index_used": bool(static_m7_metrics.get("used")),
                "static_m7_index": static_m7_metrics,
                "precomputed_schema": "mimicryone/analysis-ready-edges-lean/2",
                "candidate_edge_pairs": len(candidates),
                "child_edge_count": len(candidates),
                "grouped_result_count": len(results),
                "reconstructed_child_hits": raw_child_hits,
                "returned_deduplicated_hits": sum(len(row["hits"]) for row in results),
                "projection_provenance_contributions": provenance_contributions,
                "canonical_overlay": canonical_overlay_metrics,
                "elapsed_seconds": elapsed,
            },
            "contract": {
                "record_space": (
                    "analysis_catalog_antigen_or_canonical_parent"
                    if canonical_view
                    else "analysis_catalog_antigen_or_portable_parent"
                ),
                "static_candidates_complete": True,
                "canonical_target_complete": canonical_view,
                "positions_complete": True,
                "truncation": False,
                "event_semantics": "unique_query_start_source_start_coordinate_pairs",
                "non_overlapping": False,
                "statistics_status": "descriptive_only",
            },
        }


__all__ = [
    "AnalysisPlayerService",
    "PLAYER_ROUTE",
    "P9P_PROTEIN_IDX_OFFSET",
]
