"""Bounded live and unified scans over the MimicryMap analysis catalog.

This module is deliberately additive.  It does not claim that analysis-ready
aggregate edges are native ``mimicryone/result/1`` objects: the native format is
directed and positional, while precomputed analysis-ready v2 shards are
symmetric aggregate edge censuses.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import re
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from analysis_membership import MembershipFilterError
from urllib.parse import urlsplit

from analysis_api import _read_only_connection, _send_json

try:  # Keep the read-only/precomputed API bootable without NumPy.
    import numpy as np
except ImportError:  # pragma: no cover - exercised only on a reduced runtime
    np = None


WINDOW = 9
CANONICAL = "ACDEFGHIKLMNPQRSTVWY"
UNKNOWN_CODE = 20
ENCODING_BASE = 21

SCAN_SCHEMA = "mimicryone/analysis-scan/1"
LIVE_SCHEMA = "mimicryone/analysis-live/1"
CAPABILITIES_SCHEMA = "mimicryone/analysis-compute-capabilities/1"
ERROR_SCHEMA = "mimicryone/analysis-scan-error/1"
LIVE_INDEX_SCHEMA = "mimicryone/seed-family-index/1"
LIVE_SEED_SCHEMA = "mimicryone/seed-index/1"
WINDOW_CACHE_SCHEMA = "mimicryone/window-cache/2"
CANONICAL_PROTEOME_INDEX_SCHEMA = "mimicryone/canonical-parent-live-index/1"

MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_FASTA_RECORDS = 8
MAX_FASTA_RESIDUES = 100_000
MAX_FASTA_RECORD_RESIDUES = 50_000
MAX_QUERY_ANTIGENS = 8
MAX_TARGET_ANTIGENS = 512
MAX_QUERY_WINDOWS = 128
# A release-authorized canonical parent at 7/9 is much cheaper than a 5/9 or
# 6/9 arbitrary FASTA query. Keep that legacy guard unchanged and let the
# candidate, hit, response-size, deadline, and queue guards bound this distinct
# one-record route instead.
MAX_CANONICAL_PARENT_FLOOR7_WINDOWS = MAX_FASTA_RECORD_RESIDUES - WINDOW + 1
MAX_DIRECT_WINDOW_PAIRS = 100_000
MAX_INDEX_CANDIDATES = 250_000
MAX_UNIQUE_CANDIDATES = 100_000
MAX_VERIFIED_HITS = 100_000
MAX_RETURNED_HITS = 50_000
MAX_RESULT_PAIRS = 10_000
DEFAULT_RESULT_PAIRS = 5_000
MAX_WALL_SECONDS = 10.0
MAX_ESTIMATED_RSS_BYTES = 256 * 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
CANDIDATE_BATCH = 250_000
MAX_PREFLIGHT_CACHE_BYTES = 64 * 1024 * 1024
SQLITE_BIND_CHUNK = 500
RESULT_PAIR_OVERHEAD_BYTES = 2_048
POSITIONAL_HIT_OVERHEAD_BYTES = 128

CANONICAL_PARENT_ID = re.compile(r"^(?:P9P|M1E)\d{9}$")
CANONICAL_PARENT_LIBRARY = {
    "human_canonical": "panscan9_human",
    "immune_constant": "panscan9_human",
    "optional_receptor_germline": "panscan9_human",
    "exposure_canonical": "panscan9_exposure",
    "exposure_supplement": "panscan9_exposure",
}
CANONICAL_PROTEOME_TARGETS = {
    "panscan9_human": {"partition": "Human", "records": 20_563, "windows": 11_267_946},
    "panscan9_exposure": {"partition": "Exposure", "records": 8_827, "windows": 3_584_530},
}


class ScanError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = dict(details or {})


@dataclass(frozen=True)
class ScanRecord:
    key: int | None
    antigen_id: int | None
    library: str
    seqid: str
    short_id: str
    raw_header: str
    sequence: str
    ordinal: int | None = None
    source_row: int | None = None
    sequence_status: str | None = None
    normalization: str | None = None
    original_id: str | None = None
    parent_key: str | None = None
    id_namespace: str | None = None
    parent_class: str | None = None
    source_header: str | None = None
    companion_header: str | None = None
    sequence_sha256: str | None = None
    include_default: int | None = None
    mapped_tile_count: int | None = None
    source_accession: str | None = None
    organism: str | None = None
    primary_gene: str | None = None
    display_name: str | None = None
    annotation: Mapping[str, Any] | None = None

    @property
    def windows(self) -> int:
        return max(0, len(self.sequence) - WINDOW + 1)

    def public(self, *, include_sequence: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "record_space": (
                "canonical_parent"
                if self.parent_key is not None
                else ("custom_fasta" if self.antigen_id is None else "analysis_catalog_antigen")
            ),
            "antigen_id": self.antigen_id,
            "library": self.library,
            "seqid": self.seqid,
            "short_id": self.short_id,
            "raw_header": self.raw_header,
            "length": len(self.sequence),
            "windows": self.windows,
        }
        if include_sequence:
            payload["sequence"] = self.sequence
        if self.ordinal is not None:
            payload["ordinal"] = self.ordinal
        if self.source_row is not None:
            payload["source_row"] = self.source_row
        if self.sequence_status is not None:
            payload["sequence_status"] = self.sequence_status
        if self.normalization is not None:
            payload["normalization"] = self.normalization
        if self.original_id is not None:
            payload["original_id"] = self.original_id
        if self.parent_key is not None:
            payload["parent_key"] = self.parent_key
            payload["portable_id"] = self.parent_key
        if self.id_namespace is not None:
            payload["id_namespace"] = self.id_namespace
        if self.parent_class is not None:
            payload["parent_class"] = self.parent_class
            payload["class"] = self.parent_class
        if self.source_header is not None:
            payload["source_header"] = self.source_header
        if self.companion_header is not None:
            payload["companion_header"] = self.companion_header
        if self.sequence_sha256 is not None:
            payload["sequence_sha256"] = self.sequence_sha256
        if self.include_default is not None:
            payload["include_default"] = self.include_default
        if self.mapped_tile_count is not None:
            payload["mapped_tile_count"] = self.mapped_tile_count
        if self.source_accession is not None:
            payload["source_accession"] = self.source_accession
        if self.organism is not None:
            payload["organism"] = self.organism
        if self.primary_gene is not None:
            payload["primary_gene"] = self.primary_gene
        if self.display_name is not None:
            payload["display_name"] = self.display_name
        if self.annotation is not None:
            payload.update(dict(self.annotation))
        return payload


def _error_payload(error: ScanError) -> dict[str, Any]:
    item: dict[str, Any] = {"code": error.code, "message": error.message}
    if error.details:
        item["details"] = error.details
    return {"schema": ERROR_SCHEMA, "error": item}


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ScanError(400, "invalid_request", f"{label} must be a JSON object")
    return value


def _reject_unknown(value: Mapping[str, Any], allowed: set[str], label: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ScanError(
            400,
            "unknown_field",
            f"Unknown {label} field(s): {', '.join(unknown)}",
        )


def _bounded_int(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise ScanError(400, "invalid_request", f"{label} must be an integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ScanError(400, "invalid_request", f"{label} must be an integer") from error
    if parsed < minimum or parsed > maximum:
        raise ScanError(
            400,
            "invalid_request",
            f"{label} must be between {minimum} and {maximum}",
        )
    return parsed


def _native_fasta(text: Any, default_id: str) -> list[ScanRecord]:
    """Mirror ``parseFastaStrict`` in ``mimicryone-runtime.js``."""

    if not isinstance(text, str) or not text.strip():
        raise ScanError(400, "invalid_fasta", "No sequence was supplied")
    stripped = text.strip()
    raw_records: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    if not stripped.startswith(">"):
        current = {"id": default_id, "header": default_id, "raw": ""}
    for physical_line in stripped.splitlines():
        line = physical_line.strip()
        if not line:
            continue
        if line.startswith(">"):
            if current is not None:
                raw_records.append(current)
            header = line[1:].strip()
            identifier = header.split(None, 1)[0] if header else f"sequence_{len(raw_records) + 1}"
            current = {"id": identifier, "header": header or identifier, "raw": ""}
        else:
            if current is None:
                current = {"id": default_id, "header": default_id, "raw": ""}
            current["raw"] += "".join(
                character
                for character in line
                if not (character.isspace() or character.isdigit() or character in "._-")
            )
    if current is not None:
        raw_records.append(current)
    if not raw_records:
        raise ScanError(400, "invalid_fasta", "No sequence was supplied")
    if len(raw_records) > MAX_FASTA_RECORDS:
        raise ScanError(
            413,
            "fasta_record_limit",
            "The FASTA contains too many records for a synchronous scan",
            {"records": len(raw_records), "maximum": MAX_FASTA_RECORDS},
        )

    accepted = set(CANONICAL + "BXZJUO*")
    ambiguous = set("BXZJUO")
    id_counts: dict[str, int] = {}
    records: list[ScanRecord] = []
    total_residues = 0
    for raw in raw_records:
        original = raw["raw"].upper()
        invalid = sorted(set(original) - accepted)
        if invalid:
            raise ScanError(
                400,
                "invalid_fasta",
                f"{raw['id']}: unsupported characters {' '.join(invalid)}",
            )
        replacements = sum(character in ambiguous for character in original)
        sequence = "".join(
            "X" if character in ambiguous else character
            for character in original
            if character != "*"
        )
        if len(sequence) < WINDOW:
            raise ScanError(
                400,
                "invalid_fasta",
                f"{raw['id']}: {len(sequence)} residues; at least {WINDOW} are required",
            )
        if len(sequence) > MAX_FASTA_RECORD_RESIDUES:
            raise ScanError(
                413,
                "fasta_record_residue_limit",
                f"{raw['id']} exceeds the per-record residue limit",
                {"residues": len(sequence), "maximum": MAX_FASTA_RECORD_RESIDUES},
            )
        total_residues += len(sequence)
        if total_residues > MAX_FASTA_RESIDUES:
            raise ScanError(
                413,
                "fasta_residue_limit",
                "The FASTA exceeds the total residue limit",
                {"residues": total_residues, "maximum": MAX_FASTA_RESIDUES},
            )
        original_id = raw["id"]
        occurrence = id_counts.get(original_id, 0) + 1
        id_counts[original_id] = occurrence
        identifier = original_id if occurrence == 1 else f"{original_id}__{occurrence}"
        records.append(
            ScanRecord(
                key=None,
                antigen_id=None,
                library="__custom_query__" if default_id == "query" else "__custom_target__",
                seqid=raw["header"],
                short_id=identifier,
                raw_header=raw["header"],
                sequence=sequence,
                normalization=(
                    f"{replacements} ambiguous residue(s) represented as X"
                    if replacements
                    else "none"
                ),
                original_id=original_id,
            )
        )
    return records


def _verify_covering_seeds(
    seeds: Sequence[Sequence[int]],
    max_mismatches: int = 4,
) -> bool:
    if not seeds:
        return False
    normalized = []
    for seed in seeds:
        positions = tuple(int(position) for position in seed)
        if len(positions) != 4 or len(set(positions)) != 4 or any(position < 0 or position >= WINDOW for position in positions):
            return False
        normalized.append(frozenset(positions))
    positions = tuple(range(WINDOW))
    for mismatch_count in range(max_mismatches + 1):
        for mismatches in itertools.combinations(positions, mismatch_count):
            if not any(seed.isdisjoint(mismatches) for seed in normalized):
                return False
    return True


def _floor_seed_entries(
    seeds: Sequence[Sequence[int]],
    floor: int,
) -> tuple[tuple[int, tuple[int, ...]], ...]:
    """Return a deterministic covering subset without renumbering index directories."""

    max_mismatches = WINDOW - int(floor)
    if max_mismatches < 0 or max_mismatches > 4:
        raise ScanError(500, "invalid_seed_floor", "The live seed floor is outside the supported range")
    normalized = tuple((index, tuple(int(position) for position in seed)) for index, seed in enumerate(seeds))
    if not _verify_covering_seeds([seed for _, seed in normalized], max_mismatches):
        raise ScanError(
            503,
            "seed_family_floor_incomplete",
            "The live seed family does not cover every mismatch mask at the requested floor",
            {"floor": int(floor)},
        )
    # The production m5 family is already the required 32-entry covering family.
    # Preserve its authored order and canonical assignment exactly.
    if max_mismatches == 4:
        return normalized
    uncovered = {
        frozenset(mismatches)
        for mismatch_count in range(max_mismatches + 1)
        for mismatches in itertools.combinations(range(WINDOW), mismatch_count)
    }
    remaining = list(normalized)
    selected: list[tuple[int, tuple[int, ...]]] = []
    while uncovered:
        best = max(
            remaining,
            key=lambda entry: (
                sum(mask.isdisjoint(entry[1]) for mask in uncovered),
                -entry[0],
            ),
        )
        covered = {mask for mask in uncovered if mask.isdisjoint(best[1])}
        if not covered:
            raise ScanError(
                503,
                "seed_family_floor_incomplete",
                "The live seed family cannot complete floor-specific candidate coverage",
                {"floor": int(floor)},
            )
        selected.append(best)
        remaining.remove(best)
        uncovered.difference_update(covered)
    active_seeds = [seed for _, seed in selected]
    if not _verify_covering_seeds(active_seeds, max_mismatches):
        raise ScanError(503, "seed_family_floor_incomplete", "Floor-specific seed selection failed verification")
    return tuple(selected)


def _first_seed_table(
    seeds: Sequence[Sequence[int]],
    seed_indexes: Sequence[int] | None = None,
):
    table = np.full(1 << WINDOW, -1, dtype=np.int16)
    indexes = tuple(range(len(seeds))) if seed_indexes is None else tuple(int(index) for index in seed_indexes)
    if len(indexes) != len(seeds):
        raise ValueError("seed_indexes must align one-to-one with seeds")
    masks = [sum(1 << int(position) for position in seed) for seed in seeds]
    for mismatch_mask in range(1 << WINDOW):
        for index, seed_mask in enumerate(masks):
            if mismatch_mask & seed_mask == 0:
                table[mismatch_mask] = indexes[index]
                break
    return table


def _encode_sequence(sequence: str):
    try:
        raw = np.frombuffer(sequence.encode("ascii"), dtype=np.uint8)
    except UnicodeEncodeError as error:
        raise ScanError(400, "invalid_sequence", "Protein sequence contains non-ASCII characters") from error
    lookup = np.full(256, 255, dtype=np.uint8)
    for index, residue in enumerate(CANONICAL):
        lookup[ord(residue)] = index
    for residue in "XBZUO*.-?":
        lookup[ord(residue)] = UNKNOWN_CODE
    encoded = lookup[raw]
    if np.any(encoded == 255):
        raise ScanError(500, "catalog_sequence_invalid", "A catalog sequence contains an unsupported residue")
    return encoded


def _sequence_windows(sequence: str):
    encoded = _encode_sequence(sequence)
    if encoded.size < WINDOW:
        return np.empty((0, WINDOW), dtype=np.uint8)
    return np.lib.stride_tricks.sliding_window_view(encoded, WINDOW).copy()


def _pack_seed_keys(windows, seed: Sequence[int]):
    keys = np.zeros(windows.shape[0], dtype=np.uint32)
    for position in seed:
        np.multiply(keys, ENCODING_BASE, out=keys)
        np.add(keys, windows[:, int(position)], out=keys)
    return keys


def _mismatch_masks(equal):
    masks = np.zeros(equal.shape[0], dtype=np.uint16)
    for position in range(WINDOW):
        masks |= ((~equal[:, position]).astype(np.uint16) << position)
    return masks


def _flatten_candidates(source_indices, starts, counts):
    if source_indices.size == 0:
        return
    cumulative = np.cumsum(counts.astype(np.uint64), dtype=np.uint64)
    total = int(cumulative[-1])
    for flat_start in range(0, total, CANDIDATE_BATCH):
        flat_stop = min(total, flat_start + CANDIDATE_BATCH)
        flat = np.arange(flat_start, flat_stop, dtype=np.uint64)
        group = np.searchsorted(cumulative, flat, side="right")
        previous = np.zeros(group.size, dtype=np.uint64)
        nonzero = group > 0
        previous[nonzero] = cumulative[group[nonzero] - 1]
        target_positions = starts[group] + (flat - previous)
        yield source_indices[group].astype(np.intp, copy=False), target_positions.astype(np.intp, copy=False)


def _matching_buckets(query_keys, unique_keys, offsets):
    locations = np.searchsorted(unique_keys, query_keys)
    valid = locations < unique_keys.size
    if not np.any(valid):
        return np.empty(0, dtype=np.intp), np.empty(0, dtype=np.uint64), np.empty(0, dtype=np.uint64)
    valid_indices = np.flatnonzero(valid)
    valid_locations = locations[valid]
    equal = unique_keys[valid_locations] == query_keys[valid]
    source_indices = valid_indices[equal]
    matched = valid_locations[equal]
    return source_indices, offsets[matched], offsets[matched + 1] - offsets[matched]


def _loci_count(starts: Iterable[int]) -> int:
    ordered = sorted(set(int(value) for value in starts))
    if not ordered:
        return 0
    loci = 1
    interval_end = ordered[0] + WINDOW - 1
    for start in ordered[1:]:
        if start > interval_end:
            loci += 1
        interval_end = max(interval_end, start + WINDOW - 1)
    return loci


def _raise_async_required(
    guard: str,
    observed: int | float,
    maximum: int | float,
    message: str,
) -> None:
    raise ScanError(
        413,
        "async_required",
        message,
        {
            "guard": guard,
            "observed": observed,
            "maximum": maximum,
            "complete": False,
            "async_required": True,
            "async_available": False,
            "suggested_action": "Narrow the scope or use the downloadable local pipeline",
        },
    )


def _check_deadline(deadline: float, phase: str) -> None:
    if time.monotonic() <= deadline:
        return
    raise ScanError(
        408,
        "live_timeout",
        "The exact synchronous scan exceeded its wall-time limit",
        {
            "guard": "wall_seconds",
            "maximum": MAX_WALL_SECONDS,
            "phase": phase,
            "complete": False,
            "async_required": True,
            "async_available": False,
        },
    )


def _array_bytes(arrays: Sequence[Any]) -> int:
    return sum(int(getattr(array, "nbytes", 0)) for array in arrays)


def _record_payload_bytes(record: ScanRecord) -> int:
    return (
        len(record.sequence.encode("utf-8"))
        + len(record.seqid.encode("utf-8"))
        + len(record.short_id.encode("utf-8"))
        + len(record.raw_header.encode("utf-8"))
        + 512
    )


def _response_resource_metrics(payload: Mapping[str, Any], working_bytes: int) -> dict[str, int]:
    encoded_bytes = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    estimated_rss = int(working_bytes) * 4 + encoded_bytes * 4
    if encoded_bytes > MAX_RESPONSE_BYTES:
        _raise_async_required(
            "response_bytes",
            encoded_bytes,
            MAX_RESPONSE_BYTES,
            "The exact response exceeds the synchronous serialization budget",
        )
    if estimated_rss > MAX_ESTIMATED_RSS_BYTES:
        _raise_async_required(
            "estimated_resident_bytes",
            estimated_rss,
            MAX_ESTIMATED_RSS_BYTES,
            "The exact response exceeds the synchronous resident-memory estimate",
        )
    return {"response_bytes": encoded_bytes, "estimated_resident_bytes": estimated_rss}


class AnalysisScanService:
    """POST routes layered over an initialized read-only :class:`AnalysisAPI`."""

    def __init__(self, owner: Any) -> None:
        self.owner = owner
        self._live_slot = threading.BoundedSemaphore(value=1)
        self._live_status_cache: dict[str, dict[str, Any]] = {}

    def dispatch(self, handler: Any, *, head_only: bool = False) -> bool:
        path = (urlsplit(handler.path).path.rstrip("/") or "/")
        if path not in {"/api/analysis/live", "/api/analysis/scan"}:
            return False
        try:
            if head_only or getattr(handler, "command", "GET") != "POST":
                raise ScanError(405, "method_not_allowed", "This endpoint requires POST")
            payload = self._read_json(handler)
            if path.endswith("/live"):
                payload = self._expand_live_alias(payload)
                response = self.run(payload, response_schema=LIVE_SCHEMA)
            else:
                response = self.run(payload, response_schema=SCAN_SCHEMA)
            _send_json(handler, 200, response)
        except ScanError as error:
            _send_json(handler, error.status, _error_payload(error))
        except (FileNotFoundError, OSError, sqlite3.Error, json.JSONDecodeError, ValueError) as error:
            handler.log_error("Analysis scan unavailable: %s", error)
            _send_json(
                handler,
                503,
                _error_payload(ScanError(503, "temporarily_unavailable", "Analysis scan data are temporarily unavailable")),
            )
        except Exception as error:  # do not leak local paths or array internals
            handler.log_error("Analysis scan internal error: %s", error)
            _send_json(
                handler,
                500,
                _error_payload(ScanError(500, "internal_error", "Internal analysis scan error")),
            )
        return True

    def _read_json(self, handler: Any) -> dict[str, Any]:
        content_type = str(handler.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise ScanError(415, "unsupported_media_type", "Content-Type must be application/json")
        raw_length = handler.headers.get("Content-Length")
        if raw_length is None:
            raise ScanError(411, "length_required", "Content-Length is required")
        try:
            length = int(raw_length)
        except ValueError as error:
            raise ScanError(400, "invalid_content_length", "Invalid Content-Length") from error
        if length < 0:
            raise ScanError(400, "invalid_content_length", "Invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise ScanError(
                413,
                "request_too_large",
                "The JSON request body is too large",
                {"bytes": length, "maximum": MAX_BODY_BYTES},
            )
        raw = handler.rfile.read(length)
        if len(raw) != length:
            raise ScanError(400, "incomplete_request", "The request body ended early")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ScanError(400, "invalid_json", "The request body is not valid UTF-8 JSON") from error
        return _require_object(value, "Request")

    def _expand_live_alias(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown(
            payload,
            {"query_fasta", "target_library", "target_antigen_ids", "floor", "include_hits", "max_results"},
            "request",
        )
        if "query_fasta" not in payload or "target_library" not in payload:
            raise ScanError(400, "invalid_request", "query_fasta and target_library are required")
        target: dict[str, Any] = {
            "kind": "library",
            "library": payload["target_library"],
        }
        if "target_antigen_ids" in payload:
            target["antigen_ids"] = payload["target_antigen_ids"]
        expanded: dict[str, Any] = {
            "mode": "live",
            "floor": payload.get("floor", 5),
            "query": {"kind": "fasta", "fasta": payload["query_fasta"]},
            "target": target,
            "include_hits": payload.get("include_hits", False),
        }
        if "max_results" in payload:
            expanded["max_results"] = payload["max_results"]
        return expanded

    def run(self, payload: dict[str, Any], *, response_schema: str = SCAN_SCHEMA) -> dict[str, Any]:
        _reject_unknown(
            payload,
            {"mode", "floor", "query", "target", "include_hits", "max_results"},
            "request",
        )
        floor = _bounded_int(payload.get("floor", 7), "floor", 5, 7)
        mode_requested = payload.get("mode", "auto")
        if mode_requested not in {"auto", "precomputed", "live"}:
            raise ScanError(400, "invalid_mode", "mode must be auto, precomputed, or live")
        include_hits = payload.get("include_hits", False)
        if not isinstance(include_hits, bool):
            raise ScanError(400, "invalid_request", "include_hits must be true or false")
        max_results = _bounded_int(
            payload.get("max_results", DEFAULT_RESULT_PAIRS),
            "max_results",
            1,
            MAX_RESULT_PAIRS,
        )
        query = self._selector(payload.get("query"), "query")
        target = self._selector(payload.get("target"), "target")
        self._prepare_canonical_parent(
            query,
            allow_mapped=target["kind"] == "canonical_proteome",
        )
        if query["kind"] == "fasta" and target["kind"] == "fasta":
            raise ScanError(
                400,
                "custom_to_custom_server_unsupported",
                "Custom FASTA versus custom FASTA remains device-local and is not accepted by the server",
                {"browser_worker_supported": True, "complete": False},
            )
        if query["kind"] == "canonical_parent" and target["kind"] != "canonical_proteome":
            if target["kind"] != "library" or target.get("antigen_ids") is not None:
                raise ScanError(
                    422,
                    "canonical_parent_index_required",
                    "A canonical parent must scan one complete authorized indexed library",
                    {"complete": False},
                )
            if self._comparison_key(query["source_library"], target["library"]) is None:
                raise ScanError(
                    409,
                    "comparison_not_authorized",
                    "The canonical parent and Mimicry Parent library are not an authorized release direction",
                    {
                        "query_library": query["source_library"],
                        "target_library": target["library"],
                        "complete": False,
                    },
                )
        if target["kind"] == "canonical_proteome":
            source_library = (
                query.get("source_library")
                if query["kind"] == "canonical_parent"
                else query.get("library")
                if query["kind"] == "library"
                else None
            )
            if source_library is not None and self._comparison_key(source_library, target["library"]) is None:
                raise ScanError(
                    409,
                    "comparison_not_authorized",
                    "The Antigen Target and canonical Mimicry Parent set are not an authorized release direction",
                    {
                        "query_library": source_library,
                        "target_library": target["library"],
                        "complete": False,
                        "no_partial_payload": True,
                    },
                )
            canonical_scanner, canonical_status = self._canonical_index_binding()
            if canonical_scanner is None:
                raise self._canonical_index_required(target, canonical_status)
        if (
            floor in {5, 6}
            and getattr(self.owner, "enforce_live_comparison_matrix", False)
            and query["kind"] == "library"
            and target["kind"] == "library"
            and self._comparison_key(query["library"], target["library"]) is None
        ):
            raise ScanError(
                409,
                "comparison_not_authorized",
                "The requested built-in library pair is not one of the release's authorized comparisons",
                {
                    "query_library": query["library"],
                    "target_library": target["library"],
                    "complete": False,
                },
            )
        mode = self._select_mode(mode_requested, floor, query, target)
        started = time.monotonic()
        job_id = uuid.uuid4().hex
        if mode == "precomputed":
            response = self._precomputed(query, target, floor, include_hits, max_results)
        elif mode == "canonical_proteome_index":
            response = self._scan_canonical_index(
                canonical_scanner,
                query,
                target,
                floor,
                include_hits,
                max_results,
                started,
            )
        else:
            response = self._live(query, target, floor, include_hits, max_results, started)
        working_bytes = int(response.pop("_working_bytes", 0))
        response.update(
            {
                "schema": response_schema,
                "release_fingerprint": str(
                    getattr(self.owner, "manifest", {}).get("release_fingerprint") or ""
                ),
                "job_id": job_id,
                "request": {
                    "mode_requested": mode_requested,
                    "floor": floor,
                    "window": WINDOW,
                    "query": self._selector_public(query),
                    "target": self._selector_public(target),
                    "include_hits": include_hits,
                    "max_results": max_results,
                },
                "execution": {
                    **response.get("execution", {}),
                    "mode": mode,
                    "synchronous": True,
                    "bounded": True,
                    "complete": True,
                    "elapsed_seconds": round(time.monotonic() - started, 6),
                },
                "contract": {
                    "record_space": "analysis_catalog_antigen_or_custom_fasta_or_canonical_parent",
                    "catalog_identity": (
                        "global antigen_id or immutable canonical parent_key; full seqid/raw_header retained verbatim"
                    ),
                    "canonical_protein_projection": (
                        "authoritative_no_projection_parent"
                        if mode == "canonical_parent_live7"
                        else "full_default_canonical_parent_index"
                        if mode == "canonical_proteome_index"
                        else "not_available"
                    ),
                    "native_result_compatible": False,
                    "native_result_adapter": (
                        "live results retain exact aggregate and optional positional data, but do not populate "
                        "the complete mimicryone/result/1 coverage, source_catalog, inputs, and provenance contract"
                    ),
                    "analysis_ready_v2_compatible": mode == "precomputed",
                    "statistics_status": "descriptive_only",
                    "event_deduplication": "exact_query_source_window_coordinate_pair",
                    "non_overlapping_compression": False,
                    "truncation": False,
                    "no_partial_payload": True,
                },
            }
        )
        response["execution"].update(_response_resource_metrics(response, working_bytes))
        response["execution"]["elapsed_seconds"] = round(time.monotonic() - started, 6)
        if mode in {"live", "canonical_parent_live7", "canonical_proteome_index"}:
            _check_deadline(started + MAX_WALL_SECONDS, "response serialization")
        return response

    def _selector(self, value: Any, role: str) -> dict[str, Any]:
        selector = _require_object(value, role.capitalize())
        kind = selector.get("kind")
        if kind == "fasta":
            _reject_unknown(selector, {"kind", "fasta"}, f"{role} selector")
            if "fasta" not in selector:
                raise ScanError(400, "invalid_selector", f"{role}.fasta is required")
            return {"kind": "fasta", "fasta": selector["fasta"]}
        if kind == "canonical_parent":
            _reject_unknown(selector, {"kind", "parent_key"}, f"{role} selector")
            if role != "query":
                raise ScanError(
                    422,
                    "canonical_parent_query_only",
                    "A canonical parent is valid only as the single query sequence",
                )
            parent_key = selector.get("parent_key")
            if not isinstance(parent_key, str) or CANONICAL_PARENT_ID.fullmatch(parent_key) is None:
                raise ScanError(
                    422,
                    "invalid_canonical_parent_id",
                    "parent_key must match P9P or M1E plus nine digits",
                )
            return {"kind": "canonical_parent", "parent_key": parent_key}
        if kind == "canonical_proteome":
            _reject_unknown(selector, {"kind", "library", "filters"}, f"{role} selector")
            if role != "target":
                raise ScanError(
                    422,
                    "canonical_proteome_target_only",
                    "A canonical proteome is valid only as the Mimicry Parent target set",
                )
            if "filters" in selector:
                raise ScanError(
                    422,
                    "canonical_target_filters_unsupported",
                    "Canonical Human/Exposure parent filters are unavailable until every parent has authoritative annotations",
                    {"complete": False, "no_partial_payload": True},
                )
            library = selector.get("library")
            target = CANONICAL_PROTEOME_TARGETS.get(library)
            if target is None:
                raise ScanError(
                    404,
                    "unknown_canonical_proteome",
                    "Canonical proteome targets are limited to Human proteins or Non-human exposures",
                )
            return {
                "kind": "canonical_proteome",
                "library": library,
                "partition": target["partition"],
                "canonical_default_count": target["records"],
            }
        if kind == "library":
            _reject_unknown(selector, {"kind", "library", "antigen_ids", "filters"}, f"{role} selector")
            library = selector.get("library")
            if not isinstance(library, str) or library not in self.owner.library_keys:
                raise ScanError(404, "unknown_library", f"Unknown {role} library")
            identifiers = selector.get("antigen_ids")
            if identifiers is None:
                parsed_ids = None
            else:
                if not isinstance(identifiers, list) or not identifiers:
                    raise ScanError(400, "invalid_selector", f"{role}.antigen_ids must be a nonempty array")
                maximum = MAX_QUERY_ANTIGENS if role == "query" else MAX_TARGET_ANTIGENS
                if len(identifiers) > maximum:
                    raise ScanError(
                        413,
                        "antigen_id_limit",
                        f"Too many {role} antigen IDs",
                        {"identifiers": len(identifiers), "maximum": maximum},
                    )
                parsed_ids = []
                seen: set[int] = set()
                for raw in identifiers:
                    identifier = _bounded_int(raw, f"{role}.antigen_ids", 1, 0xFFFFFFFF)
                    if identifier not in seen:
                        seen.add(identifier)
                        parsed_ids.append(identifier)
            if role == "query" and not parsed_ids:
                raise ScanError(
                    400,
                    "query_ids_required",
                    "A library query must name exact catalog antigen_ids; whole-library query expansion is not allowed",
                )
            filters = selector.get("filters")
            if filters is not None:
                if role != "target":
                    raise ScanError(422, "invalid_source_filters", "filters are valid only on the target selector")
                membership = getattr(self.owner, "membership", None)
                if membership is None:
                    raise ScanError(409, "source_filters_unavailable", "This deployment has no membership sidecar")
                try:
                    filters = membership.normalize(library, filters)
                except MembershipFilterError as error:
                    raise ScanError(422, "invalid_source_filters", str(error)) from error
                if parsed_ids is not None:
                    allowed = membership.allowed_ids(library, parsed_ids, filters)
                    parsed_ids = [identifier for identifier in parsed_ids if identifier in allowed]
            elif role == "target":
                membership = getattr(self.owner, "membership", None)
                if membership is not None and library in membership.libraries:
                    filters = membership.normalize(library, {})
                    if parsed_ids is not None:
                        allowed = membership.allowed_ids(library, parsed_ids, filters)
                        parsed_ids = [identifier for identifier in parsed_ids if identifier in allowed]
            result = {"kind": "library", "library": library, "antigen_ids": parsed_ids}
            if filters is not None:
                result["filters"] = filters
            return result
        raise ScanError(
            400,
            "invalid_selector",
            f"{role}.kind must be fasta, library, canonical_parent, or canonical_proteome",
        )

    @staticmethod
    def _selector_public(selector: Mapping[str, Any]) -> dict[str, Any]:
        if selector["kind"] == "fasta":
            return {"kind": "fasta", "records": "parsed server-side with native FASTA normalization"}
        if selector["kind"] == "canonical_parent":
            return {
                "kind": "canonical_parent",
                "record_space": "canonical_parent",
                "parent_key": selector["parent_key"],
                "source_library": selector.get("source_library"),
            }
        if selector["kind"] == "canonical_proteome":
            return {
                "kind": "canonical_proteome",
                "record_space": "canonical_parent",
                "library": selector["library"],
                "partition": selector["partition"],
                "canonical_default_count": selector["canonical_default_count"],
            }
        output = {
            "kind": "library",
            "record_space": "analysis_catalog_antigen",
            "library": selector["library"],
            "antigen_ids": selector.get("antigen_ids"),
        }
        if selector.get("filters") is not None:
            output["filters"] = selector["filters"]
        return output

    def _canonical_index_binding(self):
        service = getattr(self.owner, "canonical_parent_index_service", None)
        scanner = getattr(service, "scan", None) if service is not None else None
        provider = getattr(service, "capabilities", None) if service is not None else None
        source = "canonical_parent_index_service"
        if service is None:
            scanner = getattr(self.owner, "scan_canonical_proteome", None)
            provider = getattr(self.owner, "canonical_proteome_index_capabilities", None)
            source = "scan_canonical_proteome"
        status: dict[str, Any] = {
            "schema": CANONICAL_PROTEOME_INDEX_SCHEMA,
            "available": False,
            "floors": [5, 6, 7],
            "selectors": ["protein:panscan9_human", "protein:panscan9_exposure"],
            "partitions": {
                row["partition"]: {"records": row["records"], "windows": row["windows"]}
                for row in CANONICAL_PROTEOME_TARGETS.values()
            },
            "complete_or_error": True,
            "positional_pairs": "deduplicated_coordinate_pairs",
            "non_overlapping": False,
        }
        if not callable(scanner) or not callable(provider):
            status["reason"] = "canonical_parent_index_service_not_bound"
            return None, status
        try:
            capabilities = provider()
        except Exception:
            status["reason"] = "canonical_parent_index_capabilities_unavailable"
            return None, status
        if not isinstance(capabilities, Mapping):
            status["reason"] = "canonical_parent_index_capabilities_invalid"
            return None, status
        partitions = capabilities.get("partitions")
        valid = (
            capabilities.get("schema") == CANONICAL_PROTEOME_INDEX_SCHEMA
            and capabilities.get("available") is True
            and set(capabilities.get("floors") or ()) == {5, 6, 7}
            and capabilities.get("complete_or_error") is True
            and capabilities.get("positional_pairs") == "deduplicated_coordinate_pairs"
            and capabilities.get("non_overlapping") is False
            and isinstance(partitions, Mapping)
        )
        if valid:
            for expected in CANONICAL_PROTEOME_TARGETS.values():
                partition = partitions.get(expected["partition"])
                if not isinstance(partition, Mapping) or (
                    partition.get("records") != expected["records"]
                    or partition.get("windows") != expected["windows"]
                ):
                    valid = False
                    break
        if not valid:
            status["reason"] = "canonical_parent_index_capabilities_mismatch"
            return None, status
        status = dict(capabilities)
        status["source"] = source
        return scanner, status

    @staticmethod
    def _canonical_index_required(target: Mapping[str, Any], status: Mapping[str, Any]) -> ScanError:
        return ScanError(
            409,
            "canonical_parent_index_required",
            "The complete canonical Human/Exposure parent index is required; raw PanScan assay tiles are not a substitute",
            {
                "complete": False,
                "no_partial_payload": True,
                "required_schema": CANONICAL_PROTEOME_INDEX_SCHEMA,
                "floors": [5, 6, 7],
                "target_kind": "canonical_proteome",
                "library": target.get("library"),
                "partition": target.get("partition"),
                "canonical_default_count": target.get("canonical_default_count"),
                "service_status": dict(status),
            },
        )

    def _scan_canonical_index(
        self,
        scanner: Any,
        query: Mapping[str, Any],
        target: Mapping[str, Any],
        floor: int,
        include_hits: bool,
        max_results: int,
        started: float,
    ) -> dict[str, Any]:
        query_records = self._resolve_records(query, "query")
        if query["kind"] in {"canonical_parent", "library"} and len(query_records) != 1:
            raise ScanError(
                422,
                "canonical_index_query_cardinality",
                "A catalog or canonical-parent query against a canonical proteome must resolve to exactly one record",
                {"complete": False, "no_partial_payload": True},
            )
        query_windows = sum(record.windows for record in query_records)
        maximum = (
            MAX_CANONICAL_PARENT_FLOOR7_WINDOWS
            if floor == 7 and query["kind"] == "canonical_parent"
            else MAX_QUERY_WINDOWS
        )
        if query_windows > maximum:
            _raise_async_required(
                "query_windows",
                query_windows,
                maximum,
                "The canonical-proteome query exceeds the synchronous window limit",
            )
        if not self._live_slot.acquire(blocking=False):
            raise ScanError(429, "live_slot_busy", "Another bounded live scan is already running; retry shortly")
        try:
            try:
                response = scanner(
                    query=query,
                    query_records=query_records,
                    target=target,
                    floor=floor,
                    include_hits=include_hits,
                    max_results=max_results,
                    started=started,
                )
            except ScanError:
                raise
            except Exception as error:
                raise ScanError(
                    503,
                    "canonical_parent_index_unavailable",
                    "The complete canonical parent index failed before returning a scientific result",
                    {"complete": False, "no_partial_payload": True},
                ) from error
        finally:
            self._live_slot.release()
        if not isinstance(response, Mapping):
            raise ScanError(
                503,
                "canonical_parent_index_incompatible",
                "The canonical parent index did not return the bounded response contract",
                {"complete": False, "no_partial_payload": True},
            )
        response = dict(response)
        required = {"query_records", "target", "source_catalog", "results", "result_count", "execution"}
        if not required.issubset(response):
            raise ScanError(
                503,
                "canonical_parent_index_incompatible",
                "The canonical parent index response is missing required fields",
                {"complete": False, "no_partial_payload": True},
            )
        response_target = response.get("target")
        results = response.get("results")
        sources = response.get("source_catalog")
        execution = response.get("execution")
        valid_shape = (
            isinstance(response_target, Mapping)
            and isinstance(results, list)
            and isinstance(sources, list)
            and isinstance(execution, Mapping)
            and response.get("result_count") == len(results)
            and response_target.get("kind") == "canonical_proteome"
            and response_target.get("library") == target["library"]
            and response_target.get("partition") == target["partition"]
            and response_target.get("canonical_default_count") == target["canonical_default_count"]
            and response_target.get("canonical_complete") is True
            and response_target.get("entity_level") == "canonical_parent"
            and response_target.get("entity_label") == "canonical parent proteins"
            and execution.get("complete") is not False
            and not bool((response.get("contract") or {}).get("truncation"))
        )
        if not valid_shape:
            raise ScanError(
                503,
                "canonical_parent_index_incompatible",
                "The canonical parent index response did not prove a complete canonical target",
                {"complete": False, "no_partial_payload": True},
            )
        query_parent_keys = {record.parent_key for record in query_records if record.parent_key}
        source_by_index: dict[int, str] = {}
        for source in sources:
            if not isinstance(source, Mapping):
                raise ScanError(503, "canonical_parent_index_incompatible", "Canonical source catalog row is invalid")
            parent_key = source.get("parent_key")
            namespace = source.get("id_namespace")
            protein_idx = source.get("protein_idx")
            expected_idx = (
                10_000_000_000 + int(parent_key[3:])
                if isinstance(parent_key, str) and parent_key.startswith("P9P")
                else 20_000_000_000 + int(parent_key[3:])
                if isinstance(parent_key, str) and parent_key.startswith("M1E")
                else None
            )
            if (
                not isinstance(parent_key, str)
                or CANONICAL_PARENT_ID.fullmatch(parent_key) is None
                or namespace != parent_key[:3]
                or protein_idx != expected_idx
                or source.get("record_space") != "canonical_parent"
                or source.get("include_default") != 1
                or source.get("optional_receptor_germline", 0) != 0
                or not isinstance(source.get("seqid"), str)
                or not source.get("seqid")
                or not isinstance(source.get("raw_header"), str)
                or not source.get("raw_header")
                or parent_key in query_parent_keys
                or protein_idx in source_by_index
            ):
                raise ScanError(503, "canonical_parent_index_incompatible", "Canonical source identity or policy is invalid")
            source_by_index[protein_idx] = parent_key
        referenced: set[int] = set()
        result_pairs: set[tuple[str, str]] = set()
        for row in results:
            if not isinstance(row, Mapping) or not isinstance(row.get("source"), Mapping):
                raise ScanError(503, "canonical_parent_index_incompatible", "Canonical result row is invalid")
            source = row["source"]
            protein_idx = source.get("protein_idx")
            parent_key = source.get("parent_key")
            if source_by_index.get(protein_idx) != parent_key:
                raise ScanError(503, "canonical_parent_index_incompatible", "Canonical result source is not cataloged")
            referenced.add(protein_idx)
            # Native FASTA parsing preserves the full SeqID/header but assigns
            # duplicate occurrences unique short_id values. Pair identity must
            # use that stable per-request key or legitimate duplicate headers
            # would be rejected as duplicated scientific result pairs.
            query_id = str((row.get("query") or {}).get("short_id") or "")
            if not query_id:
                raise ScanError(
                    503,
                    "canonical_parent_index_incompatible",
                    "Canonical result query identity is absent",
                )
            pair = (query_id, parent_key)
            if pair in result_pairs:
                raise ScanError(503, "canonical_parent_index_incompatible", "Canonical result pairs are duplicated")
            result_pairs.add(pair)
            if include_hits:
                hits = row.get("hits")
                if not isinstance(hits, list):
                    raise ScanError(503, "canonical_parent_index_incompatible", "Canonical positional hits are absent")
                coordinates: set[tuple[int, int]] = set()
                for hit in hits:
                    if not isinstance(hit, list) or len(hit) != 5:
                        raise ScanError(503, "canonical_parent_index_incompatible", "Canonical positional hit is invalid")
                    coordinate = (hit[0], hit[1])
                    if coordinate in coordinates:
                        raise ScanError(503, "canonical_parent_index_incompatible", "Canonical positional hits are not coordinate-pair deduplicated")
                    coordinates.add(coordinate)
        if referenced != set(source_by_index):
            raise ScanError(503, "canonical_parent_index_incompatible", "Canonical source catalog is not the exact referenced set")
        return response

    def _prepare_canonical_parent(
        self,
        selector: dict[str, Any],
        *,
        allow_mapped: bool = False,
    ) -> None:
        if selector.get("kind") != "canonical_parent":
            return
        resolver = getattr(self.owner, "resolve_canonical_parent", None)
        if (
            getattr(self.owner, "canonical_parent_catalog_available", False) is not True
            or not callable(resolver)
        ):
            raise ScanError(
                503,
                "canonical_parent_catalog_unavailable",
                "The release-bound canonical parent catalog is unavailable",
            )
        parent_key = selector["parent_key"]
        row = resolver(parent_key)
        if row is None:
            raise ScanError(404, "unknown_canonical_parent", "The canonical parent does not exist")
        if not isinstance(row, Mapping):
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent lookup did not return the frozen mapping contract",
            )
        required = {
            "parent_key",
            "id_namespace",
            "parent_class",
            "accession",
            "original_header",
            "canonical_header",
            "organism",
            "gene",
            "protein_name",
            "sequence",
            "sequence_length",
            "sequence_sha256",
            "mapped_tile_count",
            "include_default",
        }
        missing = sorted(name for name in required if name not in row)
        if missing:
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent lookup is missing frozen contract fields",
                {"missing_fields": missing},
            )
        if row["parent_key"] != parent_key:
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent lookup returned a different immutable parent_key",
            )
        namespace = parent_key[:3]
        if row["id_namespace"] != namespace:
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent id_namespace does not match parent_key",
            )
        include_default = row["include_default"]
        if isinstance(include_default, bool) or not isinstance(include_default, int) or include_default != 1:
            raise ScanError(
                409,
                "canonical_parent_not_default",
                "This canonical parent is outside the default analysis index",
                {"parent_key": parent_key, "complete": False},
            )
        mapped_tile_count = row["mapped_tile_count"]
        if isinstance(mapped_tile_count, bool) or not isinstance(mapped_tile_count, int):
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "mapped_tile_count must be an integer in the frozen parent catalog",
            )
        if mapped_tile_count != 0 and not allow_mapped:
            raise ScanError(
                409,
                "canonical_parent_has_projection",
                "This canonical parent has assay-tile projections and must use the static player route",
                {"parent_key": parent_key, "mapped_tile_count": mapped_tile_count, "complete": False},
            )
        parent_class = row["parent_class"]
        source_library = CANONICAL_PARENT_LIBRARY.get(parent_class)
        if source_library is None or source_library not in self.owner.library_keys:
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent_class does not map to a release analysis library",
            )
        sequence = row["sequence"]
        if (
            not isinstance(sequence, str)
            or re.fullmatch(r"[A-Z]+", sequence) is None
            or len(sequence) < WINDOW
            or len(sequence) > MAX_FASTA_RECORD_RESIDUES
        ):
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent sequence violates the frozen sequence contract",
            )
        sequence_length = row["sequence_length"]
        if (
            isinstance(sequence_length, bool)
            or not isinstance(sequence_length, int)
            or sequence_length != len(sequence)
        ):
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent sequence_length does not match sequence",
            )
        sequence_sha256 = row["sequence_sha256"]
        observed_sha256 = hashlib.sha256(sequence.encode("ascii")).hexdigest()
        if (
            not isinstance(sequence_sha256, str)
            or re.fullmatch(r"[0-9a-f]{64}", sequence_sha256) is None
            or sequence_sha256 != observed_sha256
        ):
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent sequence SHA-256 does not match sequence",
            )
        original_header = row["original_header"]
        canonical_header = row["canonical_header"]
        if (
            not isinstance(original_header, str)
            or not original_header.strip()
            or "\n" in original_header
            or "\r" in original_header
            or not isinstance(canonical_header, str)
            or not canonical_header.strip()
            or "\n" in canonical_header
            or "\r" in canonical_header
        ):
            raise ScanError(
                503,
                "canonical_parent_catalog_incompatible",
                "Canonical parent headers violate the frozen one-line header contract",
            )
        seqid = original_header[1:] if original_header.startswith(">") else original_header
        companion = canonical_header[1:] if canonical_header.startswith(">") else canonical_header
        hydrator = getattr(self.owner, "annotation_hydrator", None)
        annotation = (
            hydrator.hydrate_canonical({
                "parent_key": parent_key,
                "portable_id": parent_key,
                "parent_class": parent_class,
                "accession": row["accession"],
                "gene": row["gene"],
                "protein_name": row["protein_name"],
                "organism": row["organism"],
                "source_header": seqid,
                "original_header": original_header,
                "canonical_header": canonical_header,
            })
            if hydrator is not None else None
        )
        selector["source_library"] = source_library
        selector["_record"] = ScanRecord(
            key=None,
            antigen_id=None,
            library=source_library,
            seqid=seqid,
            short_id=parent_key,
            raw_header=seqid,
            sequence=sequence,
            original_id=parent_key,
            parent_key=parent_key,
            id_namespace=namespace,
            parent_class=parent_class,
            source_header=seqid,
            companion_header=companion,
            sequence_sha256=sequence_sha256,
            include_default=1,
            mapped_tile_count=mapped_tile_count,
            source_accession=str(row["accession"] or ""),
            organism=str(row["organism"] or ""),
            primary_gene=str(row["gene"] or ""),
            display_name=str(
                row["protein_name"]
                or row["gene"]
                or row["accession"]
                or parent_key
            ),
            annotation=annotation,
        )

    def _select_mode(
        self,
        requested: str,
        floor: int,
        query: Mapping[str, Any],
        target: Mapping[str, Any],
    ) -> str:
        if target["kind"] == "canonical_proteome":
            if requested == "precomputed":
                raise ScanError(
                    409,
                    "canonical_parent_index_required",
                    "Canonical Human/Exposure targets use the complete canonical parent index, not assay-tile precomputed edges",
                    {
                        "complete": False,
                        "no_partial_payload": True,
                        "required_schema": CANONICAL_PROTEOME_INDEX_SCHEMA,
                    },
                )
            return "canonical_proteome_index"
        can_precompute = (
            floor == 7
            and query["kind"] == "library"
            and target["kind"] == "library"
            and query.get("antigen_ids") is not None
            and self._comparison_key(query["library"], target["library"]) is not None
        )
        if floor == 7:
            if query["kind"] == "canonical_parent":
                if requested == "precomputed":
                    raise ScanError(
                        409,
                        "canonical_parent_precomputed_unavailable",
                        "This no-projection canonical parent requires the exact indexed 7/9 route",
                        {"complete": False},
                    )
                if target["kind"] != "library" or target.get("antigen_ids") is not None:
                    raise ScanError(
                        422,
                        "canonical_parent_index_required",
                        "A canonical parent must scan one complete authorized indexed library",
                        {"complete": False},
                    )
                return "canonical_parent_live7"
            if requested == "live":
                raise ScanError(
                    409,
                    "live_floor_unsupported",
                    "Server live scanning is restricted to 5/9 and 6/9; built-in 7/9 uses finalized static shards",
                    {"floors": [5, 6], "complete": False},
                )
            if not can_precompute:
                code = "precomputed_unavailable" if query["kind"] == target["kind"] == "library" else "floor7_server_shape_unsupported"
                message = (
                    "No finalized planned comparison covers these exact analysis libraries"
                    if code == "precomputed_unavailable"
                    else "This 7/9 selector shape is not available through the server; use the device-local scanner"
                )
                raise ScanError(404, code, message, {"complete": False})
            return "precomputed"
        if requested == "precomputed":
            raise ScanError(400, "precomputed_floor", "Precomputed analysis-ready edges are available only at 7/9")
        return "live"

    def _comparison_key(self, library_a: str, library_b: str) -> str | None:
        helper = getattr(self.owner, "_comparison_key_for_libraries", None)
        if helper is not None:
            return helper(library_a, library_b)
        matches = []
        for comparison in self.owner.comparisons.values():
            valid = (
                library_a == library_b == comparison.library_a
                if comparison.library_a == comparison.library_b
                else {library_a, library_b} == {comparison.library_a, comparison.library_b}
            )
            if valid:
                matches.append(comparison.key)
        return matches[0] if len(matches) == 1 else None

    def _catalog_records(self, library: str, identifiers: Sequence[int]) -> list[ScanRecord]:
        if not identifiers:
            return []
        rows = []
        with closing(_read_only_connection(self.owner.catalog_path)) as connection:
            for start in range(0, len(identifiers), SQLITE_BIND_CHUNK):
                chunk = tuple(identifiers[start : start + SQLITE_BIND_CHUNK])
                placeholders = ",".join("?" for _ in chunk)
                rows.extend(connection.execute(
                    f"""SELECT antigen_id,library_key,ordinal,seqid,short_id,raw_header,sequence,
                               source_row,sequence_status
                        FROM antigen WHERE antigen_id IN ({placeholders})""",
                    chunk,
                ))
        by_id = {int(row["antigen_id"]): row for row in rows}
        missing = [identifier for identifier in identifiers if identifier not in by_id]
        if missing:
            raise ScanError(404, "unknown_antigen", "One or more catalog antigen IDs do not exist", {"antigen_ids": missing})
        wrong = [identifier for identifier in identifiers if by_id[identifier]["library_key"] != library]
        if wrong:
            raise ScanError(
                400,
                "antigen_library_mismatch",
                "One or more antigen IDs do not belong to the selected library",
                {"antigen_ids": wrong, "library": library},
            )
        return [self._record_from_row(by_id[identifier]) for identifier in identifiers]

    def _catalog_record_sizes(self, library: str, identifiers: Sequence[int]) -> dict[int, dict[str, int]]:
        if not identifiers:
            return {}
        rows = []
        with closing(_read_only_connection(self.owner.catalog_path)) as connection:
            for start in range(0, len(identifiers), SQLITE_BIND_CHUNK):
                chunk = tuple(identifiers[start : start + SQLITE_BIND_CHUNK])
                placeholders = ",".join("?" for _ in chunk)
                rows.extend(connection.execute(
                    f"""SELECT antigen_id,library_key,length(sequence) AS sequence_length,
                               length(seqid)+length(short_id)+length(raw_header) AS header_length
                        FROM antigen WHERE antigen_id IN ({placeholders})""",
                    chunk,
                ))
        by_id = {int(row["antigen_id"]): row for row in rows}
        missing = [identifier for identifier in identifiers if identifier not in by_id]
        if missing:
            raise ScanError(404, "unknown_antigen", "One or more catalog antigen IDs do not exist", {"antigen_ids": missing})
        wrong = [identifier for identifier in identifiers if by_id[identifier]["library_key"] != library]
        if wrong:
            raise ScanError(
                400,
                "antigen_library_mismatch",
                "One or more antigen IDs do not belong to the selected library",
                {"antigen_ids": wrong, "library": library},
            )
        return {
            identifier: {
                "length": int(by_id[identifier]["sequence_length"]),
                "payload_bytes": (
                    int(by_id[identifier]["sequence_length"])
                    + 2 * int(by_id[identifier]["header_length"])
                    + 512
                ),
            }
            for identifier in identifiers
        }

    def _record_from_row(self, row: Mapping[str, Any]) -> ScanRecord:
        identifier = int(row["antigen_id"])
        hydrator = getattr(self.owner, "annotation_hydrator", None)
        annotation = (
            hydrator.hydrate_assay({
                "antigen_id": identifier,
                "library": row["library_key"],
                "seqid": row["seqid"],
                "short_id": row["short_id"],
                "raw_header": row["raw_header"],
                "source_row": row["source_row"],
            })
            if hydrator is not None else None
        )
        return ScanRecord(
            key=identifier,
            antigen_id=identifier,
            library=str(row["library_key"]),
            seqid=str(row["seqid"]),
            short_id=str(row["short_id"]),
            raw_header=str(row["raw_header"]),
            sequence=str(row["sequence"]),
            ordinal=int(row["ordinal"]),
            source_row=int(row["source_row"]),
            sequence_status=str(row["sequence_status"]),
            annotation=annotation,
        )

    def _resolve_records(self, selector: Mapping[str, Any], role: str) -> list[ScanRecord]:
        if selector["kind"] == "fasta":
            return _native_fasta(selector["fasta"], role)
        if selector["kind"] == "canonical_parent":
            record = selector.get("_record")
            if not isinstance(record, ScanRecord):
                raise ScanError(
                    503,
                    "canonical_parent_catalog_incompatible",
                    "The canonical parent was not resolved through the release-bound catalog",
                )
            return [record]
        identifiers = selector.get("antigen_ids")
        if not identifiers:
            raise ScanError(400, "antigen_ids_required", f"Exact {role} antigen IDs are required for this execution path")
        return self._catalog_records(selector["library"], identifiers)

    def _precomputed(
        self,
        query: Mapping[str, Any],
        target: Mapping[str, Any],
        floor: int,
        include_hits: bool,
        max_results: int,
    ) -> dict[str, Any]:
        if include_hits:
            raise ScanError(
                422,
                "positions_not_materialized",
                "Precomputed v2 edges do not store positions; use /api/analysis/pair for one edge or mode=live",
            )
        key = self._comparison_key(query["library"], target["library"])
        if key is None:
            raise ScanError(409, "precomputed_unavailable", "The requested comparison is not finalized")
        comparison = self.owner.comparisons[key]
        query_records = self._catalog_records(query["library"], query["antigen_ids"])
        target_ids = set(target.get("antigen_ids") or [])
        if target_ids:
            self._catalog_records(target["library"], list(target_ids))
        edge_rows: list[tuple[int, sqlite3.Row]] = []
        shard = self.owner._shard_path(comparison)
        with closing(_read_only_connection(shard)) as connection:
            self.owner._assert_complete_shard(connection)
            for query_record in query_records:
                remaining = max_results - len(edge_rows)
                if remaining <= 0:
                    raise ScanError(
                        422,
                        "result_limit_exceeded",
                        "The exact precomputed lookup exceeds the synchronous result guard; narrow target_antigen_ids or use /edges pagination",
                        {"maximum": max_results},
                    )
                conditions_a = ["antigen_a=?"]
                conditions_b = ["antigen_b=?"]
                parameters_a: list[Any] = [query_record.antigen_id]
                parameters_b: list[Any] = [query_record.antigen_id]
                if target_ids:
                    placeholders = ",".join("?" for _ in target_ids)
                    conditions_a.append(f"antigen_b IN ({placeholders})")
                    conditions_b.append(f"antigen_a IN ({placeholders})")
                    parameters_a.extend(sorted(target_ids))
                    parameters_b.extend(sorted(target_ids))
                sql = f"""
                    SELECT * FROM (
                      SELECT * FROM edge WHERE {' AND '.join(conditions_a)}
                      UNION ALL
                      SELECT * FROM edge WHERE {' AND '.join(conditions_b)}
                    ) LIMIT ?
                """
                rows = list(connection.execute(sql, tuple(parameters_a + parameters_b + [remaining + 1])))
                if len(rows) > remaining:
                    raise ScanError(
                        422,
                        "result_limit_exceeded",
                        "The exact precomputed lookup exceeds the synchronous result guard; narrow target_antigen_ids or use /edges pagination",
                        {"maximum": max_results, "observed_at_least": max_results + 1},
                    )
                edge_rows.extend((int(query_record.antigen_id), row) for row in rows)
        partner_ids = {
            int(row["antigen_b"] if int(row["antigen_a"]) == query_id else row["antigen_a"])
            for query_id, row in edge_rows
        }
        partner_records = {
            int(record.antigen_id): record
            for record in self._catalog_records(target["library"], sorted(partner_ids))
        } if partner_ids else {}
        query_by_id = {int(record.antigen_id): record for record in query_records}
        results = []
        for query_id, row in edge_rows:
            canonical_a = int(row["antigen_a"])
            partner_id = int(row["antigen_b"] if canonical_a == query_id else canonical_a)
            if partner_id not in partner_records:
                continue
            query_is_a = canonical_a == query_id
            floors = {}
            for threshold in range(7, 10):
                floors[f"m{threshold}"] = {
                    "query_windows": int(row[f"{'a' if query_is_a else 'b'}_windows_m{threshold}"]),
                    "source_windows": int(row[f"{'b' if query_is_a else 'a'}_windows_m{threshold}"]),
                    "pairs": int(row[f"n{threshold}"]),
                    "query_loci": None,
                    "source_loci": None,
                }
            results.append(
                {
                    "query": query_by_id[query_id].public(),
                    "source": partner_records[partner_id].public(),
                    "best_identity": int(row["best_identity"]),
                    "floors": floors,
                    "positions": "not_materialized",
                }
            )
        results.sort(key=lambda row: (-row["best_identity"], row["query"]["seqid"], row["source"]["seqid"]))
        return {
            "comparison": key,
            "query_records": [record.public() for record in query_records],
            "results": results,
            "result_count": len(results),
            "execution": {
                "aggregate_counts_exact": True,
                "positional_hits_included": False,
                "precomputed_schema": "mimicryone/analysis-ready-edges-lean/2",
            },
        }

    def _live(
        self,
        query: Mapping[str, Any],
        target: Mapping[str, Any],
        floor: int,
        include_hits: bool,
        max_results: int,
        started: float,
    ) -> dict[str, Any]:
        if np is None:
            raise ScanError(503, "numpy_unavailable", "Live analysis requires a NumPy-enabled Python runtime")
        deadline = started + MAX_WALL_SECONDS
        query_records = self._resolve_records(query, "query")
        query_window_count = sum(record.windows for record in query_records)
        query_window_limit = (
            MAX_CANONICAL_PARENT_FLOOR7_WINDOWS
            if floor == 7 and query["kind"] == "canonical_parent"
            else MAX_QUERY_WINDOWS
        )
        if query_window_count > query_window_limit:
            _raise_async_required(
                "query_windows",
                query_window_count,
                query_window_limit,
                "The query exceeds the synchronous window limit",
            )
        _check_deadline(deadline, "query resolution")
        if not self._live_slot.acquire(blocking=False):
            raise ScanError(429, "live_slot_busy", "Another bounded live scan is already running; retry shortly")
        try:
            if target["kind"] == "library" and target.get("antigen_ids") is None:
                status = self._live_index_status(target["library"], include_internal=True)
                if not status["available"]:
                    raise ScanError(
                        409,
                        "live_index_unavailable",
                        "The selected target library's atomic live index is not complete",
                        {"library": target["library"], "reason": status["reason"]},
                    )
                arrays, counts = self._scan_index(query_records, status, floor, include_hits, deadline)
                target_filters = target.get("filters")
                if target_filters is not None and arrays[2].size:
                    membership = getattr(self.owner, "membership", None)
                    assert membership is not None
                    observed = {int(value) for value in np.unique(arrays[2]).tolist()}
                    allowed = membership.allowed_ids(
                        target["library"], observed, target_filters
                    )
                    mask = np.isin(
                        arrays[2],
                        np.fromiter(sorted(allowed), dtype=np.uint32),
                        assume_unique=False,
                    )
                    arrays = tuple(values[mask] for values in arrays)
                    counts["membership_filter_source_antigens"] = len(allowed)
                    counts["membership_filter_hits_retained"] = int(arrays[0].size)
                result_pairs = self._guard_live_result_pairs(arrays, max_results)
                target_ids = sorted(set(int(value) for value in arrays[2].tolist()))
                target_sizes = self._catalog_record_sizes(target["library"], target_ids)
                estimate = self._estimate_live_resources(
                    query_records, target_sizes, arrays, result_pairs, include_hits
                )
                _check_deadline(deadline, "catalog preflight")
                target_records = self._catalog_records(
                    target["library"], target_ids
                ) if target_ids else []
                target_by_key = {int(record.antigen_id): record for record in target_records}
                target_descriptor = {
                    "kind": "library",
                    "library": target["library"],
                    "record_space": "analysis_catalog_antigen",
                    "indexed_windows": int(status["windows"]),
                }
                if target_filters is not None:
                    target_descriptor["filters"] = target_filters
            else:
                if target["kind"] == "library":
                    target_sizes_preflight = self._catalog_record_sizes(
                        target["library"], target["antigen_ids"]
                    )
                    target_window_count = sum(
                        max(0, item["length"] - WINDOW + 1) for item in target_sizes_preflight.values()
                    )
                    direct_work = query_window_count * target_window_count
                    if direct_work > MAX_DIRECT_WINDOW_PAIRS:
                        _raise_async_required(
                            "unique_candidate_pairs",
                            direct_work,
                            MAX_DIRECT_WINDOW_PAIRS,
                            "The exact direct scan exceeds the synchronous candidate budget",
                        )
                target_records = self._resolve_records(target, "target")
                for index, record in enumerate(target_records, start=1):
                    if record.key is None:
                        target_records[index - 1] = ScanRecord(
                            **{**record.__dict__, "key": index}
                        )
                arrays, counts = self._scan_direct(
                    query_records, target_records, floor, include_hits, deadline
                )
                result_pairs = self._guard_live_result_pairs(arrays, max_results)
                target_by_key = {int(record.key): record for record in target_records}
                target_sizes = {
                    int(record.key): {
                        "length": len(record.sequence),
                        "payload_bytes": _record_payload_bytes(record),
                    }
                    for record in target_records
                }
                estimate = self._estimate_live_resources(
                    query_records, target_sizes, arrays, result_pairs, include_hits
                )
                target_descriptor = {
                    "kind": target["kind"],
                    "library": target.get("library"),
                    "records": len(target_records),
                    "windows": sum(record.windows for record in target_records),
                }
            results = self._aggregate_live(
                query_records,
                target_by_key,
                arrays,
                floor,
                include_hits,
                max_results,
                deadline,
            )
            referenced_source_keys = {
                int(row["source"]["protein_idx"])
                for row in results
            }
            source_catalog = []
            for protein_idx in sorted(referenced_source_keys):
                _check_deadline(deadline, "source catalog assembly")
                record = target_by_key.get(protein_idx)
                if record is None:
                    raise ScanError(
                        503,
                        "catalog_join_failed",
                        "A live result source could not be added to the deduplicated source catalog",
                    )
                source = record.public()
                source["protein_idx"] = protein_idx
                source_catalog.append(source)
            _check_deadline(deadline, "response assembly")
            return {
                "query_records": [record.public() for record in query_records],
                "target": target_descriptor,
                "source_catalog": source_catalog,
                "results": results,
                "result_count": len(results),
                "execution": {
                    **counts,
                    **estimate,
                    "aggregate_counts_exact": True,
                    "positional_hits_included": include_hits,
                    "coordinate_system": "1-based window starts",
                    "identity_policy": "canonical residues match exactly; every X/noncanonical position is a forced mismatch",
                },
                "_working_bytes": _array_bytes(arrays),
            }
        finally:
            self._live_slot.release()

    @staticmethod
    def _window_arrays(records: Sequence[ScanRecord], *, target: bool = False):
        windows = []
        record_keys = []
        positions = []
        for index, record in enumerate(records):
            record_windows = _sequence_windows(record.sequence)
            if not record_windows.size:
                continue
            key = int(record.key) if target else index
            windows.append(record_windows)
            record_keys.append(np.full(record_windows.shape[0], key, dtype=np.uint32))
            positions.append(np.arange(1, record_windows.shape[0] + 1, dtype=np.uint32))
        if not windows:
            return (
                np.empty((0, WINDOW), dtype=np.uint8),
                np.empty(0, dtype=np.uint32),
                np.empty(0, dtype=np.uint32),
            )
        return np.concatenate(windows), np.concatenate(record_keys), np.concatenate(positions)

    @staticmethod
    def _empty_hits():
        return tuple(np.empty(0, dtype=dtype) for dtype in (np.uint32, np.uint32, np.uint32, np.uint32, np.uint8))

    @staticmethod
    def _append_hits(parts: list[list[Any]], values: tuple[Any, ...], retained: int) -> int:
        if retained == 0:
            return 0
        for destination, value in zip(parts, values):
            destination.append(value)
        return retained

    @staticmethod
    def _finish_hits(parts: list[list[Any]]):
        if not parts[0]:
            return AnalysisScanService._empty_hits()
        return tuple(np.concatenate(part) for part in parts)

    @staticmethod
    def _result_pair_keys(arrays: tuple[Any, ...]):
        query_keys, _, target_keys, _, _ = arrays
        if not query_keys.size:
            return np.empty(0, dtype=np.uint64)
        packed = (query_keys.astype(np.uint64) << np.uint64(32)) | target_keys.astype(np.uint64)
        return np.unique(packed)

    def _guard_live_result_pairs(self, arrays: tuple[Any, ...], max_results: int):
        pairs = self._result_pair_keys(arrays)
        if pairs.size > max_results:
            _raise_async_required(
                "result_pairs",
                int(pairs.size),
                max_results,
                "The exact live result exceeds the synchronous source-pair budget",
            )
        return pairs

    @staticmethod
    def _estimate_live_resources(
        query_records: Sequence[ScanRecord],
        target_sizes: Mapping[int, Mapping[str, int]],
        arrays: tuple[Any, ...],
        result_pairs: Any,
        include_hits: bool,
    ) -> dict[str, int]:
        query_sizes = [_record_payload_bytes(record) for record in query_records]
        estimated_response = 4_096 + sum(query_sizes)
        referenced_targets = set(int(value) for value in arrays[2].tolist())
        for target_key in referenced_targets:
            item = target_sizes.get(target_key)
            if item is None:
                raise ScanError(503, "catalog_join_failed", "A live hit could not be sized against its catalog antigen")
            estimated_response += int(item["payload_bytes"])
        for packed in result_pairs.tolist():
            query_index = int(packed >> 32)
            target_key = int(packed & 0xFFFFFFFF)
            item = target_sizes.get(target_key)
            if item is None or query_index >= len(query_sizes):
                raise ScanError(503, "catalog_join_failed", "A live pair could not be sized before materialization")
            estimated_response += query_sizes[query_index] + int(item["payload_bytes"]) + RESULT_PAIR_OVERHEAD_BYTES
        if include_hits:
            estimated_response += int(arrays[4].size) * POSITIONAL_HIT_OVERHEAD_BYTES
        working_bytes = _array_bytes(arrays)
        estimated_rss = estimated_response * 4 + working_bytes * 4
        if estimated_response > MAX_RESPONSE_BYTES:
            _raise_async_required(
                "response_bytes",
                estimated_response,
                MAX_RESPONSE_BYTES,
                "The exact live result exceeds the synchronous response estimate",
            )
        if estimated_rss > MAX_ESTIMATED_RSS_BYTES:
            _raise_async_required(
                "estimated_resident_bytes",
                estimated_rss,
                MAX_ESTIMATED_RSS_BYTES,
                "The exact live result exceeds the synchronous resident-memory estimate",
            )
        return {
            "estimated_response_bytes": int(estimated_response),
            "estimated_resident_bytes_pre_materialization": int(estimated_rss),
        }

    def _scan_direct(
        self,
        query_records: Sequence[ScanRecord],
        target_records: Sequence[ScanRecord],
        floor: int,
        include_hits: bool,
        deadline: float,
    ):
        work = sum(record.windows for record in query_records) * sum(record.windows for record in target_records)
        if work > MAX_DIRECT_WINDOW_PAIRS:
            _raise_async_required(
                "unique_candidate_pairs",
                work,
                MAX_DIRECT_WINDOW_PAIRS,
                "The exact live scan exceeds the synchronous direct-comparison budget",
            )
        query_windows, query_keys, query_positions = self._window_arrays(query_records)
        target_windows, target_keys, target_positions = self._window_arrays(target_records, target=True)
        parts: list[list[Any]] = [[], [], [], [], []]
        retained_total = 0
        for query_index in range(query_windows.shape[0]):
            _check_deadline(deadline, "direct verification")
            left = query_windows[query_index]
            for start in range(0, target_windows.shape[0], CANDIDATE_BATCH):
                stop = min(target_windows.shape[0], start + CANDIDATE_BATCH)
                right = target_windows[start:stop]
                equal = (right == left) & (right < len(CANONICAL)) & (left < len(CANONICAL))
                identity = np.count_nonzero(equal, axis=1).astype(np.uint8)
                keep = identity >= floor
                query_record = query_records[int(query_keys[query_index])]
                if query_record.antigen_id is not None:
                    keep &= target_keys[start:stop] != int(query_record.antigen_id)
                if not np.any(keep):
                    continue
                selected = np.flatnonzero(keep)
                count = selected.size
                retained_total += count
                if retained_total > MAX_VERIFIED_HITS:
                    _raise_async_required(
                        "verified_window_pairs",
                        retained_total,
                        MAX_VERIFIED_HITS,
                        "The exact live result exceeds the synchronous positional-pair guard; narrow the target",
                    )
                if include_hits and retained_total > MAX_RETURNED_HITS:
                    _raise_async_required(
                        "returned_positional_hits",
                        retained_total,
                        MAX_RETURNED_HITS,
                        "The exact result is too large to return with positions synchronously",
                    )
                self._append_hits(
                    parts,
                    (
                        np.full(count, int(query_keys[query_index]), dtype=np.uint32),
                        np.full(count, int(query_positions[query_index]), dtype=np.uint32),
                        target_keys[start:stop][selected],
                        target_positions[start:stop][selected],
                        identity[selected],
                    ),
                    count,
                )
        return self._finish_hits(parts), {
            "work_guard": "direct_window_pairs",
            "window_pairs_considered": work,
            "verified_window_pairs": retained_total,
        }

    def _scan_index(
        self,
        query_records: Sequence[ScanRecord],
        status: Mapping[str, Any],
        floor: int,
        include_hits: bool,
        deadline: float,
    ):
        root = Path(status["_root"])
        seeds = tuple(tuple(seed) for seed in status["_seeds"])
        seed_entries = _floor_seed_entries(seeds, floor)
        query_windows, query_records_by_window, query_positions = self._window_arrays(query_records)
        if not query_windows.size:
            return self._empty_hits(), {"work_guard": "seed_candidates", "candidate_instances": 0, "verified_window_pairs": 0}
        candidate_total = 0
        preflight_cache_bytes = 0
        preflight: list[tuple[int, tuple[int, ...], tuple[Any, Any, Any] | None]] = []
        for seed_index, seed in seed_entries:
            index_root = root / "indexes" / "live" / f"seed_{seed_index:02d}"
            unique_keys = np.load(index_root / "unique_keys.npy", mmap_mode="r")
            offsets = np.load(index_root / "offsets.npy", mmap_mode="r")
            query_keys = _pack_seed_keys(query_windows, seed)
            matching = _matching_buckets(query_keys, unique_keys, offsets)
            source_indices, starts, counts = matching
            candidate_total += int(np.sum(counts, dtype=np.uint64)) if counts.size else 0
            if candidate_total > MAX_INDEX_CANDIDATES:
                _raise_async_required(
                    "raw_seed_hits",
                    candidate_total,
                    MAX_INDEX_CANDIDATES,
                    "The exact indexed live scan exceeds the synchronous candidate budget",
                )
            matching_bytes = sum(int(array.nbytes) for array in matching)
            if preflight_cache_bytes + matching_bytes <= MAX_PREFLIGHT_CACHE_BYTES:
                preflight.append((seed_index, seed, matching))
                preflight_cache_bytes += matching_bytes
            else:
                preflight.append((seed_index, seed, None))
            _check_deadline(deadline, "seed-bucket preflight")
        candidate_pairs = np.empty(0, dtype=np.uint64)
        for seed_index, seed, matching in preflight:
            index_root = root / "indexes" / "live" / f"seed_{seed_index:02d}"
            order = np.load(index_root / "order.npy", mmap_mode="r")
            if matching is None:
                unique_keys = np.load(index_root / "unique_keys.npy", mmap_mode="r")
                offsets = np.load(index_root / "offsets.npy", mmap_mode="r")
                matching = _matching_buckets(_pack_seed_keys(query_windows, seed), unique_keys, offsets)
            source_indices, starts, counts = matching
            for query_local, target_order_positions in _flatten_candidates(source_indices, starts, counts):
                target_local = order[target_order_positions].astype(np.uint64, copy=False)
                packed = (query_local.astype(np.uint64) << np.uint64(32)) | target_local
                batch_unique = np.unique(packed)
                candidate_pairs = batch_unique if not candidate_pairs.size else np.union1d(candidate_pairs, batch_unique)
                if candidate_pairs.size > MAX_UNIQUE_CANDIDATES:
                    _raise_async_required(
                        "unique_candidate_pairs",
                        int(candidate_pairs.size),
                        MAX_UNIQUE_CANDIDATES,
                        "The exact indexed live scan exceeds the synchronous unique-candidate budget",
                    )
                _check_deadline(deadline, "candidate deduplication")
        unique_candidate_total = int(candidate_pairs.size)
        target_antigens = np.load(root / "window_antigen.npy", mmap_mode="r")
        query_local = (candidate_pairs >> np.uint64(32)).astype(np.intp, copy=False)
        target_local = (candidate_pairs & np.uint64(0xFFFFFFFF)).astype(np.intp, copy=False)
        self_excluded = 0
        if any(record.antigen_id is not None for record in query_records) and candidate_pairs.size:
            query_antigens = np.array(
                [int(record.antigen_id or 0) for record in query_records], dtype=np.uint32
            )[query_records_by_window[query_local]]
            not_self = (query_antigens == 0) | (query_antigens != target_antigens[target_local])
            self_excluded = int(np.count_nonzero(~not_self))
            query_local = query_local[not_self]
            target_local = target_local[not_self]
        _check_deadline(deadline, "candidate preflight")
        target_windows = np.load(root / "windows.npy", mmap_mode="r")
        target_positions = np.load(root / "window_position.npy", mmap_mode="r")
        parts: list[list[Any]] = [[], [], [], [], []]
        retained_total = 0
        for start in range(0, query_local.size, CANDIDATE_BATCH):
                _check_deadline(deadline, "candidate verification")
                stop = min(query_local.size, start + CANDIDATE_BATCH)
                selected_query = query_local[start:stop]
                selected_target = target_local[start:stop]
                left = query_windows[selected_query]
                right = target_windows[selected_target]
                equal = (left == right) & (left < len(CANONICAL)) & (right < len(CANONICAL))
                identities = np.count_nonzero(equal, axis=1).astype(np.uint8)
                keep = identities >= floor
                if not np.any(keep):
                    continue
                kept_query = selected_query[keep]
                kept_target = selected_target[keep]
                kept_identity = identities[keep]
                count = kept_query.size
                if not count:
                    continue
                retained_total += count
                if retained_total > MAX_VERIFIED_HITS:
                    _raise_async_required(
                        "verified_window_pairs",
                        retained_total,
                        MAX_VERIFIED_HITS,
                        "The exact indexed live result exceeds the synchronous positional-pair guard; narrow the query or target",
                    )
                if include_hits and retained_total > MAX_RETURNED_HITS:
                    _raise_async_required(
                        "returned_positional_hits",
                        retained_total,
                        MAX_RETURNED_HITS,
                        "The exact result is too large to return with positions synchronously",
                    )
                self._append_hits(
                    parts,
                    (
                        query_records_by_window[kept_query],
                        query_positions[kept_query],
                        target_antigens[kept_target],
                        target_positions[kept_target],
                        kept_identity,
                    ),
                    count,
                )
        return self._finish_hits(parts), {
            "work_guard": "seed_candidates",
            "candidate_instances": candidate_total,
            "raw_seed_hits": candidate_total,
            "unique_candidate_pairs": unique_candidate_total,
            "self_candidates_excluded": self_excluded,
            "verified_window_pairs": retained_total,
            "live_seed_count": len(seed_entries),
            "live_seed_family_count": len(seeds),
            "live_seed_indexes": [seed_index for seed_index, _ in seed_entries],
            "preflight_cache_bytes": preflight_cache_bytes,
        }

    def _aggregate_live(
        self,
        query_records: Sequence[ScanRecord],
        target_by_key: Mapping[int, ScanRecord],
        arrays: tuple[Any, ...],
        floor: int,
        include_hits: bool,
        max_results: int,
        deadline: float,
    ) -> list[dict[str, Any]]:
        query_keys, query_positions, target_keys, target_positions, identities = arrays
        if not query_keys.size:
            return []
        _check_deadline(deadline, "aggregation setup")
        pair_keys = (query_keys.astype(np.uint64) << np.uint64(32)) | target_keys.astype(np.uint64)
        order = np.argsort(pair_keys, kind="stable")
        _check_deadline(deadline, "aggregation sort")
        sorted_pairs = pair_keys[order]
        change = np.empty(sorted_pairs.size, dtype=np.bool_)
        change[0] = True
        change[1:] = sorted_pairs[1:] != sorted_pairs[:-1]
        starts = np.flatnonzero(change)
        if starts.size > max_results:
            _raise_async_required(
                "result_pairs",
                int(starts.size),
                max_results,
                "The exact live result exceeds the synchronous source-pair guard; narrow the target",
            )
        if include_hits and identities.size > MAX_RETURNED_HITS:
            _raise_async_required(
                "returned_positional_hits",
                int(identities.size),
                MAX_RETURNED_HITS,
                "The exact result is valid but too large to return with positions; retry with include_hits=false or narrow the target",
            )
        ends = np.append(starts[1:], sorted_pairs.size)
        results = []
        for start, end in zip(starts.tolist(), ends.tolist()):
            _check_deadline(deadline, "result aggregation")
            selected = order[start:end]
            query_index = int(query_keys[selected[0]])
            target_key = int(target_keys[selected[0]])
            query_record = query_records[query_index]
            target_record = target_by_key.get(target_key)
            if target_record is None:
                raise ScanError(503, "catalog_join_failed", "A live hit could not be joined to its catalog antigen")
            pair_identity = identities[selected]
            floors: dict[str, Any] = {}
            for threshold in range(floor, 10):
                keep = pair_identity >= threshold
                qpos = query_positions[selected][keep]
                tpos = target_positions[selected][keep]
                floors[f"m{threshold}"] = {
                    "query_windows": int(np.unique(qpos).size),
                    "source_windows": int(np.unique(tpos).size),
                    "pairs": int(np.count_nonzero(keep)),
                    "query_loci": _loci_count(qpos.tolist()),
                    "source_loci": _loci_count(tpos.tolist()),
                }
            source = target_record.public()
            source["protein_idx"] = target_key
            item: dict[str, Any] = {
                "query": query_record.public(),
                "source": source,
                "best_identity": int(pair_identity.max()),
                "floors": floors,
                "positions": "included" if include_hits else "computed_but_not_returned",
            }
            if include_hits:
                hits = []
                for index in selected.tolist():
                    query_start = int(query_positions[index])
                    source_start = int(target_positions[index])
                    hits.append(
                        [
                            query_start,
                            source_start,
                            int(identities[index]),
                            query_record.sequence[query_start - 1 : query_start - 1 + WINDOW],
                            target_record.sequence[source_start - 1 : source_start - 1 + WINDOW],
                        ]
                    )
                item["hits_schema"] = [
                    "query_start",
                    "source_start",
                    "identity",
                    "query_9mer",
                    "source_9mer",
                ]
                item["hits"] = hits
            results.append(item)
        _check_deadline(deadline, "result ordering")
        results.sort(key=lambda row: (-row["best_identity"], row["query"]["seqid"], row["source"]["seqid"]))
        return results

    def _live_index_status(self, library: str, *, include_internal: bool = False) -> dict[str, Any]:
        cached = self._live_status_cache.get(library)
        if cached is not None:
            status = dict(cached)
            if not include_internal:
                status.pop("_root", None)
                status.pop("_seeds", None)
            return status
        status: dict[str, Any] = {
            "available": False,
            "reason": "manifest_missing",
            "completed_at": None,
            "floors": [5, 6, 7],
        }
        if np is None:
            status["reason"] = "numpy_unavailable"
            return status
        root = self.owner.root / "window_cache" / library
        cache_manifest_path = root / "manifest.json"
        family_manifest_path = root / "indexes" / "live" / "manifest.json"
        if not cache_manifest_path.is_file() or not family_manifest_path.is_file():
            return status
        try:
            cache = json.loads(cache_manifest_path.read_text(encoding="utf-8"))
            family = json.loads(family_manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            status["reason"] = "manifest_invalid"
            return status
        fingerprint = self.owner.manifest.get("release_fingerprint")
        if (
            cache.get("schema") != WINDOW_CACHE_SCHEMA
            or family.get("schema") != LIVE_INDEX_SCHEMA
            or cache.get("release_fingerprint") != fingerprint
            or family.get("release_fingerprint") != fingerprint
            or cache.get("library_key") != library
            or family.get("library_key") != library
            or family.get("mode") != "live"
            or not family.get("completed_at")
        ):
            status["reason"] = "manifest_stale_or_incompatible"
            return status
        seeds = family.get("seeds")
        seed_indexes = family.get("seed_indexes")
        if not isinstance(seeds, list) or not isinstance(seed_indexes, list) or len(seeds) != len(seed_indexes):
            status["reason"] = "manifest_incomplete"
            return status
        if not _verify_covering_seeds(seeds):
            status["reason"] = "seed_family_invalid"
            return status
        required_cache = ("windows.npy", "window_antigen.npy", "window_position.npy", "record_offsets.npy")
        if not all((root / name).is_file() for name in required_cache):
            status["reason"] = "window_cache_incomplete"
            return status
        for index, (seed, item) in enumerate(zip(seeds, seed_indexes)):
            seed_root = root / "indexes" / "live" / f"seed_{index:02d}"
            if (
                not isinstance(item, dict)
                or item.get("schema") != LIVE_SEED_SCHEMA
                or item.get("release_fingerprint") != fingerprint
                or item.get("library_key") != library
                or item.get("mode") != "live"
                or item.get("seed_index") != index
                or item.get("seed") != seed
                or not all((seed_root / name).is_file() for name in ("order.npy", "unique_keys.npy", "offsets.npy"))
            ):
                status["reason"] = "seed_index_incomplete"
                return status
        status.update(
            {
                "available": True,
                "reason": "complete",
                "completed_at": family["completed_at"],
                "windows": int(cache.get("windows", 0)),
                "records": int(cache.get("records", 0)),
                "seed_count": len(seeds),
                "family_hash": family.get("family_hash"),
            }
        )
        status["_root"] = str(root)
        status["_seeds"] = seeds
        self._live_status_cache[library] = dict(status)
        if not include_internal:
            status.pop("_root", None)
            status.pop("_seeds", None)
        return status

    def capabilities(self, libraries: Sequence[Mapping[str, Any]] | None = None) -> dict[str, Any]:
        keys = [str(row["key"]) for row in libraries] if libraries is not None else sorted(self.owner.library_keys)
        statuses = {key: self._live_index_status(key) for key in keys}
        available = [key for key, status in statuses.items() if status["available"]]
        canonical_catalog_available = (
            getattr(self.owner, "canonical_parent_catalog_available", False) is True
            and callable(getattr(self.owner, "resolve_canonical_parent", None))
        )
        canonical_scanner, canonical_index = self._canonical_index_binding()
        return {
            "schema": CAPABILITIES_SCHEMA,
            "endpoints": {
                "simple_live": "/api/analysis/live",
                "unified_scan": "/api/analysis/scan",
                "precomputed_edges": "/api/analysis/edges",
                "precomputed_pair_positions": "/api/analysis/pair",
            },
            "record_contract": {
                "unit": "analysis_catalog_antigen_or_canonical_parent",
                "identity_key": "global antigen_id or immutable parent_key",
                "header_fields": ["seqid", "raw_header"],
                "canonical_protein_projection": (
                    "release-bound exact projection or authoritative mapped_tile_count=0"
                ),
                "warning": (
                    "PanScan9 Human and other assay libraries are catalog antigen/assay rows; "
                    "they are not the native Human protein pack row-for-row"
                ),
            },
            "compatibility": {
                "native_fasta_parser": "compatible",
                "identity_science": "exact 9-aa windows; noncanonical residues are forced mismatches",
                "native_result_compatible": False,
                "reason": (
                    "analysis-ready v2 precomputed rows are symmetric aggregate edges; native result/CSV "
                    "contracts are directed and retain complete positional/provenance fields"
                ),
            },
            "modes": {
                "precomputed": {
                    "floor": 7,
                    "selectors": "exact catalog antigen IDs within finalized planned library pairs",
                },
                "live": {
                    "floors": [5, 6],
                    "available_target_libraries": available,
                    "custom_fasta_server_processing": True,
                    "custom_to_custom": False,
                    "privacy_notice": "FASTA text is sent to this local HTTP server; the legacy custom scanner remains browser-local",
                },
                "canonical_parent_live7": {
                    "available": canonical_catalog_available,
                    "floor": 7,
                    "selector": "one release-bound canonical parent_key",
                    "eligibility": "include_default=1 and mapped_tile_count=0",
                    "available_target_libraries": available if canonical_catalog_available else [],
                    "authorized_pairs_only": True,
                    "arbitrary_fasta": False,
                    "complete_or_explicit_error": True,
                },
                "canonical_proteome_index": {
                    **canonical_index,
                    "available": canonical_scanner is not None,
                    "target_kind": "canonical_proteome",
                    "library_is_ui_authorization_mapping_not_index_identity": True,
                    "raw_tile_substitution": False,
                    "filters": "unsupported_until_all_canonical_parents_have_authoritative_annotations",
                },
                "auto": (
                    "uses finalized precomputed 7/9 for projected assay IDs; canonical_proteome targets "
                    "require the separately validated full default-parent index and never substitute raw tiles"
                ),
            },
            "libraries": statuses,
            "limits": {
                "request_bytes": MAX_BODY_BYTES,
                "fasta_records": MAX_FASTA_RECORDS,
                "fasta_total_residues": MAX_FASTA_RESIDUES,
                "fasta_record_residues": MAX_FASTA_RECORD_RESIDUES,
                "query_antigen_ids": MAX_QUERY_ANTIGENS,
                "target_antigen_ids": MAX_TARGET_ANTIGENS,
                "query_windows": MAX_QUERY_WINDOWS,
                "canonical_parent_floor7_query_windows": MAX_CANONICAL_PARENT_FLOOR7_WINDOWS,
                "direct_window_pairs": MAX_DIRECT_WINDOW_PAIRS,
                "indexed_candidate_instances": MAX_INDEX_CANDIDATES,
                "unique_candidate_pairs": MAX_UNIQUE_CANDIDATES,
                "verified_window_pairs": MAX_VERIFIED_HITS,
                "returned_positional_hits": MAX_RETURNED_HITS,
                "result_pairs": MAX_RESULT_PAIRS,
                "wall_seconds": MAX_WALL_SECONDS,
                "estimated_resident_bytes": MAX_ESTIMATED_RSS_BYTES,
                "response_bytes": MAX_RESPONSE_BYTES,
                "concurrent_live_jobs": 1,
            },
            "runtime": {
                "numpy_available": np is not None,
                "numpy_version": getattr(np, "__version__", None),
            },
        }


__all__ = [
    "AnalysisScanService",
    "CAPABILITIES_SCHEMA",
    "LIVE_SCHEMA",
    "SCAN_SCHEMA",
    "ScanError",
    "_native_fasta",
]
