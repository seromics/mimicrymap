"""Exact, bounded overlay matching for canonical parents without tile projections.

The r3 static shards contain assay-library rows.  Most canonical Human and
Exposure parents project completely onto those rows, but a small release-pinned
set has ``mapped_tile_count == 0``.  This module indexes only that frozen set so
the canonical-proteome presentation can add it atomically to the static player
result without changing or relabelling the assay-tile libraries.

Every reported hit is one unique pair of 1-based 9-mer starts.  These are
coordinate-pair-deduplicated events, not non-overlapping matches.  All resource
and deadline guards fail before a result is returned; no partial mapping is
ever exposed.
"""

from __future__ import annotations

import hashlib
import itertools
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Iterable, Mapping


WINDOW = 9
CANONICAL = "ACDEFGHIKLMNPQRSTVWY"
CANONICAL_CODE = {residue: index for index, residue in enumerate(CANONICAL)}
PARENT_KEY_RE = re.compile(r"^(P9P|M1E)(\d{9})$")

EXPECTED_PARTITION_COUNTS = MappingProxyType({"Human": 23, "Exposure": 29})
PARTITION_LIBRARY = MappingProxyType({
    "Human": "panscan9_human",
    "Exposure": "panscan9_exposure",
})
PARTITION_CLASSES = MappingProxyType({
    "Human": frozenset({"human_canonical", "immune_constant"}),
    "Exposure": frozenset({"exposure_canonical", "exposure_supplement"}),
})
NAMESPACE_OFFSET = MappingProxyType({"P9P": 10_000_000_000, "M1E": 20_000_000_000})
MAX_SAFE_JS_INTEGER = 9_007_199_254_740_991

DEFAULT_MAX_INDEX_ENTRIES = 2_000_000
DEFAULT_MAX_RAW_SEED_HITS = 500_000
DEFAULT_MAX_UNIQUE_CANDIDATES = 500_000
DEFAULT_MAX_VERIFIED_HITS = 100_000
DEFAULT_MAX_RESULT_PARENTS = 10_000
DEFAULT_MAX_QUERY_RESIDUES = 50_000


class CanonicalParentOverlayError(Exception):
    """ScanError-compatible complete-or-error failure."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = int(status)
        self.code = str(code)
        self.message = str(message)
        self.details = {"complete": False, "no_partial_payload": True, **dict(details or {})}


@dataclass(frozen=True)
class OverlayLimits:
    max_index_entries: int = DEFAULT_MAX_INDEX_ENTRIES
    max_raw_seed_hits: int = DEFAULT_MAX_RAW_SEED_HITS
    max_unique_candidates: int = DEFAULT_MAX_UNIQUE_CANDIDATES
    max_verified_hits: int = DEFAULT_MAX_VERIFIED_HITS
    max_result_parents: int = DEFAULT_MAX_RESULT_PARENTS
    max_query_residues: int = DEFAULT_MAX_QUERY_RESIDUES

    def __post_init__(self) -> None:
        for name, value in self.__dict__.items():
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ValueError(f"{name} must be a positive integer")


@dataclass(frozen=True)
class _Parent:
    parent_key: str
    partition: str
    sequence: str
    record: Mapping[str, Any]


@dataclass(frozen=True)
class _SeedIndex:
    partition: str
    floor: int
    seeds: tuple[tuple[int, ...], ...]
    buckets: tuple[Mapping[int, tuple[tuple[int, int], ...]], ...]
    index_entries: int
    target_windows: int


@dataclass(frozen=True)
class OverlayMatchResult:
    groups: Mapping[str, Mapping[str, Any]]
    metrics: Mapping[str, Any]


def canonical_protein_idx(parent_key: object) -> int:
    """Return the documented collision-free, JavaScript-safe parent identity."""

    value = str(parent_key or "")
    match = PARENT_KEY_RE.fullmatch(value)
    if match is None:
        raise ValueError("parent_key must match P9P or M1E plus nine digits")
    output = NAMESPACE_OFFSET[match.group(1)] + int(match.group(2))
    if output > MAX_SAFE_JS_INTEGER:  # defensive: current namespaces are far below it
        raise ValueError("canonical protein_idx exceeds the JavaScript-safe integer range")
    return output


def _seed_blocks(floor: int) -> tuple[tuple[int, ...], ...]:
    """Disjoint pigeonhole blocks that exhaustively cover a floor.

    With ``d = 9-floor`` mismatches, partitioning all positions into ``d+1``
    disjoint blocks guarantees that at least one complete block has no mismatch.
    Interleaving positions avoids relying only on contiguous sequence runs.
    """

    if isinstance(floor, bool) or not isinstance(floor, int) or floor not in {5, 6, 7}:
        raise ValueError("floor must be 5, 6, or 7")
    block_count = WINDOW - floor + 1
    seeds = tuple(tuple(range(offset, WINDOW, block_count)) for offset in range(block_count))
    if sorted(itertools.chain.from_iterable(seeds)) != list(range(WINDOW)):
        raise AssertionError("seed blocks do not partition the 9-mer")
    if not _seeds_exhaustive(seeds, floor):
        raise AssertionError("seed blocks do not exhaustively cover the requested floor")
    return seeds


def _seeds_exhaustive(seeds: Iterable[Iterable[int]], floor: int) -> bool:
    normalized = tuple(frozenset(int(position) for position in seed) for seed in seeds)
    max_mismatches = WINDOW - int(floor)
    return all(
        any(seed.isdisjoint(mismatches) for seed in normalized)
        for count in range(max_mismatches + 1)
        for mismatches in itertools.combinations(range(WINDOW), count)
    )


def _pack_seed(window: str, seed: tuple[int, ...]) -> int | None:
    key = 0
    for position in seed:
        code = CANONICAL_CODE.get(window[position])
        if code is None:
            return None
        key = key * len(CANONICAL) + code
    return key


def _identity(left: str, right: str) -> int:
    return sum(a == b and a in CANONICAL for a, b in zip(left, right))


def _deadline(deadline: float | None, stage: str) -> None:
    if deadline is not None and time.monotonic() > deadline:
        raise CanonicalParentOverlayError(
            408,
            "canonical_overlay_timeout",
            "The exact canonical-parent overlay exceeded its bounded wall-time",
            {"stage": stage, "async_required": True},
        )


def _async_guard(guard: str, observed: int, maximum: int, message: str) -> None:
    raise CanonicalParentOverlayError(
        422,
        "async_required",
        message,
        {
            "guard": guard,
            "observed": int(observed),
            "maximum": int(maximum),
            "async_required": True,
        },
    )


class CanonicalParentOverlay:
    """Immutable, release-count-gated overlay over all default zero-projection parents."""

    def __init__(
        self,
        rows: Iterable[Mapping[str, Any]],
        *,
        limits: OverlayLimits | None = None,
        expected_partition_counts: Mapping[str, int] = EXPECTED_PARTITION_COUNTS,
    ) -> None:
        self.limits = limits or OverlayLimits()
        expected = dict(expected_partition_counts)
        if expected != dict(EXPECTED_PARTITION_COUNTS):
            raise ValueError("r3 canonical overlay counts must be exactly Human=23 and Exposure=29")
        parents: list[_Parent] = []
        seen: set[str] = set()
        observed = defaultdict(int)
        for source in rows:
            row = dict(source)
            parent = self._validate_row(row)
            if parent.parent_key in seen:
                raise CanonicalParentOverlayError(
                    503,
                    "canonical_overlay_catalog_incompatible",
                    "The zero-projection canonical catalog contains a duplicate parent_key",
                    {"parent_key": parent.parent_key},
                )
            seen.add(parent.parent_key)
            observed[parent.partition] += 1
            parents.append(parent)
        if dict(observed) != expected:
            raise CanonicalParentOverlayError(
                503,
                "canonical_overlay_count_mismatch",
                "The canonical overlay does not contain the exact frozen r3 parent census",
                {"expected": expected, "observed": dict(observed)},
            )
        self._parents = tuple(sorted(parents, key=lambda item: item.parent_key))
        self._partition_parent_indexes = {
            partition: tuple(
                index for index, parent in enumerate(self._parents)
                if parent.partition == partition
            )
            for partition in expected
        }
        self._index_lock = threading.RLock()
        self._indexes: dict[tuple[str, int], _SeedIndex] = {}

    @staticmethod
    def _validate_row(row: dict[str, Any]) -> _Parent:
        required = {
            "parent_key", "id_namespace", "parent_class", "original_header",
            "canonical_header", "source_partition", "sequence", "sequence_length",
            "sequence_sha256", "mapped_tile_count", "include_default",
            "optional_receptor_germline",
        }
        missing = sorted(required - set(row))
        if missing:
            raise CanonicalParentOverlayError(
                503,
                "canonical_overlay_catalog_incompatible",
                "A zero-projection canonical row is missing frozen fields",
                {"missing_fields": missing},
            )
        parent_key = row["parent_key"]
        match = PARENT_KEY_RE.fullmatch(parent_key) if isinstance(parent_key, str) else None
        if match is None or row["id_namespace"] != match.group(1):
            raise CanonicalParentOverlayError(
                503,
                "canonical_overlay_catalog_incompatible",
                "A zero-projection canonical row has an invalid immutable identity",
                {"parent_key": parent_key},
            )
        partition = row["source_partition"]
        if partition not in EXPECTED_PARTITION_COUNTS or row["parent_class"] not in PARTITION_CLASSES[partition]:
            raise CanonicalParentOverlayError(
                503,
                "canonical_overlay_catalog_incompatible",
                "A zero-projection canonical row has an invalid partition/class contract",
                {"parent_key": parent_key},
            )
        if (
            type(row["include_default"]) is not int
            or row["include_default"] != 1
            or type(row["mapped_tile_count"]) is not int
            or row["mapped_tile_count"] != 0
            or type(row["optional_receptor_germline"]) is not int
            or row["optional_receptor_germline"] != 0
        ):
            raise CanonicalParentOverlayError(
                503,
                "canonical_overlay_policy_mismatch",
                "The canonical overlay admits only default, non-optional, zero-projection parents",
                {"parent_key": parent_key},
            )
        if match.group(1) == "M1E" and row["parent_class"] != "exposure_supplement":
            raise CanonicalParentOverlayError(
                503,
                "canonical_overlay_catalog_incompatible",
                "M1E is reserved for Exposure supplements",
                {"parent_key": parent_key},
            )
        sequence = row["sequence"]
        if (
            not isinstance(sequence, str)
            or not sequence
            or re.fullmatch(r"[A-Z]+", sequence) is None
            or type(row["sequence_length"]) is not int
            or row["sequence_length"] != len(sequence)
            or row["sequence_sha256"] != hashlib.sha256(sequence.encode("ascii")).hexdigest()
        ):
            raise CanonicalParentOverlayError(
                503,
                "canonical_overlay_sequence_mismatch",
                "A zero-projection canonical row violates the frozen sequence contract",
                {"parent_key": parent_key},
            )
        for name in ("original_header", "canonical_header"):
            value = row[name]
            if not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value:
                raise CanonicalParentOverlayError(
                    503,
                    "canonical_overlay_header_mismatch",
                    "A zero-projection canonical row violates the one-line header contract",
                    {"parent_key": parent_key, "field": name},
                )
        original_header = row["original_header"]
        canonical_header = row["canonical_header"]
        seqid = original_header[1:] if original_header.startswith(">") else original_header
        companion = canonical_header[1:] if canonical_header.startswith(">") else canonical_header
        public = {
            **row,
            "record_space": "canonical_parent",
            "entity_level": "canonical_parent",
            "portable_id": parent_key,
            "protein_idx": canonical_protein_idx(parent_key),
            "library": PARTITION_LIBRARY[partition],
            "seqid": seqid,
            "short_id": str(row.get("accession") or parent_key),
            "raw_header": seqid,
            "source_header": seqid,
            "companion_header": companion,
            "class": row["parent_class"],
            "source_accession": str(row.get("accession") or ""),
            "primary_gene": str(row.get("gene") or ""),
            "display_name": str(
                row.get("protein_name")
                or row.get("gene")
                or row.get("accession")
                or parent_key
            ),
            "source_description": str(row.get("protein_name") or ""),
            "length": len(sequence),
            "windows": max(0, len(sequence) - WINDOW + 1),
        }
        return _Parent(parent_key, partition, sequence, MappingProxyType(public))

    def rows(self, partition: str) -> tuple[Mapping[str, Any], ...]:
        self._require_partition(partition)
        return tuple(self._parents[index].record for index in self._partition_parent_indexes[partition])

    @staticmethod
    def _require_partition(partition: str) -> None:
        if partition not in EXPECTED_PARTITION_COUNTS:
            raise ValueError("partition must be Human or Exposure")

    def _build_index(self, partition: str, floor: int, deadline: float | None) -> _SeedIndex:
        self._require_partition(partition)
        seeds = _seed_blocks(floor)
        local_buckets: list[dict[int, list[tuple[int, int]]]] = [defaultdict(list) for _ in seeds]
        entries = 0
        target_windows = 0
        for parent_index in self._partition_parent_indexes[partition]:
            parent = self._parents[parent_index]
            windows = max(0, len(parent.sequence) - WINDOW + 1)
            target_windows += windows
            for start0 in range(windows):
                window = parent.sequence[start0:start0 + WINDOW]
                for seed_index, seed in enumerate(seeds):
                    key = _pack_seed(window, seed)
                    if key is None:
                        continue
                    entries += 1
                    if entries > self.limits.max_index_entries:
                        raise CanonicalParentOverlayError(
                            503,
                            "canonical_overlay_index_limit",
                            "The frozen canonical overlay exceeds its startup index budget",
                            {
                                "guard": "index_entries",
                                "observed": entries,
                                "maximum": self.limits.max_index_entries,
                            },
                        )
                    local_buckets[seed_index][key].append((parent_index, start0))
                if start0 % 1024 == 0:
                    _deadline(deadline, "overlay index build")
        frozen_buckets = tuple(
            MappingProxyType({key: tuple(value) for key, value in bucket.items()})
            for bucket in local_buckets
        )
        return _SeedIndex(partition, floor, seeds, frozen_buckets, entries, target_windows)

    def index(self, partition: str, floor: int, *, deadline: float | None = None) -> _SeedIndex:
        self._require_partition(partition)
        if floor not in {5, 6, 7}:
            raise ValueError("floor must be 5, 6, or 7")
        cache_key = (partition, int(floor))
        with self._index_lock:
            cached = self._indexes.get(cache_key)
            if cached is not None:
                return cached
            built = self._build_index(partition, int(floor), deadline)
            # Assignment happens only after a complete local build.
            self._indexes[cache_key] = built
            return built

    def match(
        self,
        query_sequence: str,
        *,
        partition: str,
        floor: int,
        query_parent_key: str | None = None,
        deadline: float | None = None,
    ) -> OverlayMatchResult:
        """Return all exact overlay hits, or raise without returning a partial result."""

        self._require_partition(partition)
        if floor not in {5, 6, 7}:
            raise ValueError("floor must be 5, 6, or 7")
        if (
            not isinstance(query_sequence, str)
            or re.fullmatch(r"[A-Z]+", query_sequence) is None
            or len(query_sequence) < WINDOW
        ):
            raise CanonicalParentOverlayError(
                422,
                "canonical_overlay_invalid_query",
                "The canonical overlay query must be one uppercase sequence of at least 9 residues",
            )
        if len(query_sequence) > self.limits.max_query_residues:
            _async_guard(
                "query_residues",
                len(query_sequence),
                self.limits.max_query_residues,
                "The canonical overlay query exceeds the synchronous residue budget",
            )
        if query_parent_key is not None and PARENT_KEY_RE.fullmatch(query_parent_key) is None:
            raise CanonicalParentOverlayError(
                422,
                "canonical_overlay_invalid_query_parent",
                "query_parent_key must match P9P or M1E plus nine digits",
            )
        seed_index = self.index(partition, floor, deadline=deadline)
        raw_seed_hits = 0
        self_seed_hits_excluded = 0
        candidates: set[tuple[int, int, int]] = set()
        query_windows = len(query_sequence) - WINDOW + 1
        for query_start0 in range(query_windows):
            window = query_sequence[query_start0:query_start0 + WINDOW]
            for block_index, seed in enumerate(seed_index.seeds):
                key = _pack_seed(window, seed)
                if key is None:
                    continue
                bucket = seed_index.buckets[block_index].get(key, ())
                raw_seed_hits += len(bucket)
                if raw_seed_hits > self.limits.max_raw_seed_hits:
                    _async_guard(
                        "raw_seed_hits",
                        raw_seed_hits,
                        self.limits.max_raw_seed_hits,
                        "The exact canonical overlay exceeds the synchronous seed-candidate budget",
                    )
                for parent_index, target_start0 in bucket:
                    if query_parent_key is not None and self._parents[parent_index].parent_key == query_parent_key:
                        self_seed_hits_excluded += 1
                        continue
                    candidates.add((query_start0, parent_index, target_start0))
                if len(candidates) > self.limits.max_unique_candidates:
                    _async_guard(
                        "unique_candidate_pairs",
                        len(candidates),
                        self.limits.max_unique_candidates,
                        "The exact canonical overlay exceeds the synchronous unique-candidate budget",
                    )
            if query_start0 % 256 == 0:
                _deadline(deadline, "overlay candidate collection")

        grouped_hits: dict[str, list[list[Any]]] = defaultdict(list)
        verified_hits = 0
        for index, (query_start0, parent_index, target_start0) in enumerate(sorted(candidates)):
            if index % 1024 == 0:
                _deadline(deadline, "overlay exact verification")
            parent = self._parents[parent_index]
            query_window = query_sequence[query_start0:query_start0 + WINDOW]
            target_window = parent.sequence[target_start0:target_start0 + WINDOW]
            identity = _identity(query_window, target_window)
            if identity < floor:
                continue
            verified_hits += 1
            if verified_hits > self.limits.max_verified_hits:
                _async_guard(
                    "verified_window_pairs",
                    verified_hits,
                    self.limits.max_verified_hits,
                    "The exact canonical overlay exceeds the synchronous positional-pair budget",
                )
            grouped_hits[parent.parent_key].append([
                query_start0 + 1,
                target_start0 + 1,
                identity,
                query_window,
                target_window,
            ])
        if len(grouped_hits) > self.limits.max_result_parents:
            _async_guard(
                "result_parents",
                len(grouped_hits),
                self.limits.max_result_parents,
                "The exact canonical overlay exceeds the synchronous parent-result budget",
            )

        parent_by_key = {parent.parent_key: parent for parent in self._parents}
        groups: dict[str, Mapping[str, Any]] = {}
        for parent_key in sorted(grouped_hits):
            hits = sorted(grouped_hits[parent_key], key=lambda hit: (hit[0], hit[1], -hit[2]))
            groups[parent_key] = {
                "record": dict(parent_by_key[parent_key].record),
                "hits": hits,
            }
        metrics = {
            "partition": partition,
            "library": PARTITION_LIBRARY[partition],
            "floor": int(floor),
            "canonical_default_no_projection_parents": EXPECTED_PARTITION_COUNTS[partition],
            "target_windows": seed_index.target_windows,
            "seed_blocks": [list(seed) for seed in seed_index.seeds],
            "index_entries": seed_index.index_entries,
            "query_windows": query_windows,
            "raw_seed_hits": raw_seed_hits,
            "unique_candidate_pairs": len(candidates),
            "self_seed_hits_excluded": self_seed_hits_excluded,
            "verified_window_pairs": verified_hits,
            "result_parents": len(groups),
            "event_semantics": "unique_query_start_source_start_coordinate_pairs",
            "non_overlapping": False,
            "complete": True,
            "truncation": False,
        }
        return OverlayMatchResult(MappingProxyType(groups), MappingProxyType(metrics))

    def scan(
        self,
        query_sequence: str,
        *,
        partition: str,
        floor: int,
        query_parent_key: str | None = None,
        deadline: float | None = None,
    ) -> Mapping[str, Mapping[str, Any]]:
        """Convenience API returning only ``{parent_key: {record, hits}}``."""

        return self.match(
            query_sequence,
            partition=partition,
            floor=floor,
            query_parent_key=query_parent_key,
            deadline=deadline,
        ).groups


__all__ = [
    "CanonicalParentOverlay",
    "CanonicalParentOverlayError",
    "EXPECTED_PARTITION_COUNTS",
    "OverlayLimits",
    "OverlayMatchResult",
    "PARTITION_LIBRARY",
    "canonical_protein_idx",
]
