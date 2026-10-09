"""Bounded exact scanner over the immutable canonical-parent index sidecar."""

from __future__ import annotations

import time
from typing import Any, Mapping, Sequence

import numpy as np

from analysis_scan import (
    CANDIDATE_BATCH,
    MAX_CANONICAL_PARENT_FLOOR7_WINDOWS,
    MAX_ESTIMATED_RSS_BYTES,
    MAX_INDEX_CANDIDATES,
    MAX_PREFLIGHT_CACHE_BYTES,
    MAX_QUERY_WINDOWS,
    MAX_RESPONSE_BYTES,
    MAX_RESULT_PAIRS,
    MAX_RETURNED_HITS,
    MAX_UNIQUE_CANDIDATES,
    MAX_VERIFIED_HITS,
    MAX_WALL_SECONDS,
    POSITIONAL_HIT_OVERHEAD_BYTES,
    RESULT_PAIR_OVERHEAD_BYTES,
    ScanError,
    ScanRecord,
    WINDOW,
    _array_bytes,
    _check_deadline,
    _flatten_candidates,
    _floor_seed_entries,
    _loci_count,
    _matching_buckets,
    _pack_seed_keys,
    _raise_async_required,
    _record_payload_bytes,
    _sequence_windows,
)
from canonical_parent_index import (
    CanonicalParentIndex,
    CanonicalParentIndexError,
    FLOORS,
    SCHEMA,
)


def _protein_idx(parent_key: str) -> int:
    if parent_key.startswith("P9P"):
        return 10_000_000_000 + int(parent_key[3:])
    if parent_key.startswith("M1E"):
        return 20_000_000_000 + int(parent_key[3:])
    raise CanonicalParentIndexError(f"invalid canonical parent key: {parent_key}")


def _catalog_record(
    row: Mapping[str, Any], library: str, ordinal: int, annotation_hydrator: Any | None = None
) -> ScanRecord:
    parent_key = str(row["parent_key"])
    original = str(row["original_header"])
    canonical = str(row["canonical_header"])
    original = original[1:] if original.startswith(">") else original
    canonical = canonical[1:] if canonical.startswith(">") else canonical
    display_name = str(
        row["protein_name"] or row["gene"] or row["accession"] or parent_key
    )
    annotation = annotation_hydrator.hydrate_canonical(dict(row)) if annotation_hydrator else None
    return ScanRecord(
        key=ordinal,
        antigen_id=None,
        library=library,
        seqid=original,
        short_id=parent_key,
        raw_header=original,
        sequence=str(row["sequence"]),
        ordinal=ordinal,
        original_id=parent_key,
        parent_key=parent_key,
        id_namespace=str(row["id_namespace"]),
        parent_class=str(row["parent_class"]),
        source_header=original,
        companion_header=canonical,
        sequence_sha256=str(row["sequence_sha256"]),
        include_default=int(row["include_default"]),
        mapped_tile_count=int(row["mapped_tile_count"]),
        source_accession=str(row["accession"] or ""),
        organism=str(row["organism"] or ""),
        primary_gene=str(row["gene"] or ""),
        display_name=display_name,
        annotation=annotation,
    )


class CanonicalParentIndexService:
    """Execute complete-or-error parent-level scans at floors 5, 6, and 7."""

    def __init__(
        self,
        index: CanonicalParentIndex,
        catalog: Any,
        *,
        assay_parent_resolver: Any | None = None,
        annotation_hydrator: Any | None = None,
    ) -> None:
        self.index = index
        self.catalog = catalog
        self.assay_parent_resolver = assay_parent_resolver
        self.annotation_hydrator = annotation_hydrator
        manifest_catalog = dict(index.manifest["canonical_parent_catalog"])
        observed = {
            "release_id": str(catalog.manifest["release_id"]),
            "database_sha256": str(catalog.database_sha256),
        }
        if observed != manifest_catalog:
            raise CanonicalParentIndexError(
                "canonical parent index/catalog release binding differs"
            )

    def capabilities(self) -> dict[str, Any]:
        result = self.index.capabilities()
        result["query_guards"] = {
            "custom_or_catalog_query_windows": MAX_QUERY_WINDOWS,
            "canonical_parent_floor5_query_windows": MAX_QUERY_WINDOWS,
            "canonical_parent_floor6_query_windows": MAX_QUERY_WINDOWS,
            "canonical_parent_floor7_query_windows": MAX_CANONICAL_PARENT_FLOOR7_WINDOWS,
            "wall_seconds": MAX_WALL_SECONDS,
            "indexed_candidate_instances": MAX_INDEX_CANDIDATES,
            "unique_candidate_pairs": MAX_UNIQUE_CANDIDATES,
            "verified_window_pairs": MAX_VERIFIED_HITS,
            "returned_positional_hits": MAX_RETURNED_HITS,
            "result_pairs": MAX_RESULT_PAIRS,
            "estimated_resident_bytes": MAX_ESTIMATED_RSS_BYTES,
            "response_bytes": MAX_RESPONSE_BYTES,
        }
        result["self_parent_exclusion"] = (
            "canonical query parent_key excluded when present in target partition"
        )
        return result

    @staticmethod
    def _window_arrays(records: Sequence[ScanRecord]):
        windows: list[np.ndarray] = []
        keys: list[np.ndarray] = []
        positions: list[np.ndarray] = []
        for index, record in enumerate(records):
            record_windows = _sequence_windows(record.sequence)
            count = record_windows.shape[0]
            if count:
                windows.append(record_windows)
                keys.append(np.full(count, index, dtype=np.uint32))
                positions.append(np.arange(1, count + 1, dtype=np.uint32))
        if not windows:
            return (
                np.empty((0, WINDOW), dtype=np.uint8),
                np.empty(0, dtype=np.uint32),
                np.empty(0, dtype=np.uint32),
            )
        return np.concatenate(windows), np.concatenate(keys), np.concatenate(positions)

    @staticmethod
    def _empty_hits() -> tuple[np.ndarray, ...]:
        return (
            np.empty(0, dtype=np.uint32),
            np.empty(0, dtype=np.uint32),
            np.empty(0, dtype=np.uint32),
            np.empty(0, dtype=np.uint32),
            np.empty(0, dtype=np.uint8),
        )

    def _scan_index(
        self,
        query_records: Sequence[ScanRecord],
        partition: str,
        floor: int,
        include_hits: bool,
        deadline: float,
        excluded_parent_keys: Mapping[int, set[str]],
    ) -> tuple[tuple[np.ndarray, ...], dict[str, Any]]:
        status = self.index.status(partition, include_internal=True)
        root = status["_root"]
        root_path = self.index.root / self.index.expected_partitions[partition]["directory"]
        seeds = tuple(tuple(seed) for seed in status["_seeds"])
        seed_entries = _floor_seed_entries(seeds, floor)
        query_windows, query_by_window, query_positions = self._window_arrays(query_records)
        if not query_windows.size:
            return self._empty_hits(), {
                "work_guard": "seed_candidates",
                "candidate_instances": 0,
                "verified_window_pairs": 0,
            }
        candidate_total = 0
        preflight_bytes = 0
        preflight: list[tuple[int, tuple[int, ...], tuple[Any, Any, Any] | None]] = []
        for seed_index, seed in seed_entries:
            seed_root = root_path / "indexes" / "live" / f"seed_{seed_index:02d}"
            unique_keys = np.load(seed_root / "unique_keys.npy", mmap_mode="r", allow_pickle=False)
            offsets = np.load(seed_root / "offsets.npy", mmap_mode="r", allow_pickle=False)
            matching = _matching_buckets(_pack_seed_keys(query_windows, seed), unique_keys, offsets)
            count = int(np.sum(matching[2], dtype=np.uint64)) if matching[2].size else 0
            candidate_total += count
            if candidate_total > MAX_INDEX_CANDIDATES:
                _raise_async_required(
                    "raw_seed_hits", candidate_total, MAX_INDEX_CANDIDATES,
                    "The exact canonical-parent scan exceeds the synchronous candidate budget",
                )
            matching_bytes = sum(int(array.nbytes) for array in matching)
            if preflight_bytes + matching_bytes <= MAX_PREFLIGHT_CACHE_BYTES:
                preflight.append((seed_index, seed, matching))
                preflight_bytes += matching_bytes
            else:
                preflight.append((seed_index, seed, None))
            _check_deadline(deadline, "canonical seed-bucket preflight")

        candidate_pairs = np.empty(0, dtype=np.uint64)
        for seed_index, seed, matching in preflight:
            seed_root = root_path / "indexes" / "live" / f"seed_{seed_index:02d}"
            order = np.load(seed_root / "order.npy", mmap_mode="r", allow_pickle=False)
            if matching is None:
                unique_keys = np.load(seed_root / "unique_keys.npy", mmap_mode="r", allow_pickle=False)
                offsets = np.load(seed_root / "offsets.npy", mmap_mode="r", allow_pickle=False)
                matching = _matching_buckets(
                    _pack_seed_keys(query_windows, seed), unique_keys, offsets
                )
            for query_local, target_order_positions in _flatten_candidates(*matching):
                target_local = order[target_order_positions].astype(np.uint64, copy=False)
                packed = (query_local.astype(np.uint64) << np.uint64(32)) | target_local
                unique = np.unique(packed)
                candidate_pairs = unique if not candidate_pairs.size else np.union1d(candidate_pairs, unique)
                if candidate_pairs.size > MAX_UNIQUE_CANDIDATES:
                    _raise_async_required(
                        "unique_candidate_pairs", int(candidate_pairs.size),
                        MAX_UNIQUE_CANDIDATES,
                        "The exact canonical-parent scan exceeds the synchronous unique-candidate budget",
                    )
                _check_deadline(deadline, "canonical candidate deduplication")

        target_parents = np.load(
            root_path / "window_parent.npy", mmap_mode="r", allow_pickle=False
        )
        query_local = (candidate_pairs >> np.uint64(32)).astype(np.intp, copy=False)
        target_local = (candidate_pairs & np.uint64(0xFFFFFFFF)).astype(np.intp, copy=False)
        self_ids: dict[int, np.ndarray] = {}
        for query_index, parent_keys in excluded_parent_keys.items():
            local_ids = sorted({
                local
                for parent_key in parent_keys
                for local in (self.index.record_id(partition, parent_key),)
                if local is not None
            })
            if local_ids:
                self_ids[query_index] = np.asarray(local_ids, dtype=np.uint32)
        self_excluded = 0
        if candidate_pairs.size and self_ids:
            keep = np.ones(query_local.size, dtype=np.bool_)
            target_record_ids = target_parents[target_local]
            query_record_ids = query_by_window[query_local]
            for query_index, local_ids in self_ids.items():
                same_query = query_record_ids == query_index
                if np.any(same_query):
                    keep[same_query] &= ~np.isin(
                        target_record_ids[same_query], local_ids, assume_unique=False
                    )
            self_excluded = int(np.count_nonzero(~keep))
            query_local, target_local = query_local[keep], target_local[keep]

        target_windows = np.load(root_path / "windows.npy", mmap_mode="r", allow_pickle=False)
        target_positions = np.load(
            root_path / "window_position.npy", mmap_mode="r", allow_pickle=False
        )
        parts: list[list[np.ndarray]] = [[], [], [], [], []]
        retained = 0
        for start in range(0, query_local.size, CANDIDATE_BATCH):
            _check_deadline(deadline, "canonical candidate verification")
            stop = min(query_local.size, start + CANDIDATE_BATCH)
            selected_query, selected_target = query_local[start:stop], target_local[start:stop]
            left, right = query_windows[selected_query], target_windows[selected_target]
            equal = (left == right) & (left < 20) & (right < 20)
            identities = np.count_nonzero(equal, axis=1).astype(np.uint8)
            keep = identities >= floor
            if not np.any(keep):
                continue
            kept_query = selected_query[keep]
            kept_target = selected_target[keep]
            count = kept_query.size
            retained += int(count)
            if retained > MAX_VERIFIED_HITS:
                _raise_async_required(
                    "verified_window_pairs", retained, MAX_VERIFIED_HITS,
                    "The exact canonical-parent result exceeds the synchronous positional-pair guard",
                )
            if include_hits and retained > MAX_RETURNED_HITS:
                _raise_async_required(
                    "returned_positional_hits", retained, MAX_RETURNED_HITS,
                    "The exact canonical-parent result is too large to return with positions",
                )
            values = (
                query_by_window[kept_query],
                query_positions[kept_query],
                target_parents[kept_target],
                target_positions[kept_target],
                identities[keep],
            )
            for destination, value in zip(parts, values):
                destination.append(value.astype(value.dtype, copy=False))
        arrays = tuple(
            np.concatenate(values) if values else empty
            for values, empty in zip(parts, self._empty_hits())
        )
        return arrays, {
            "work_guard": "seed_candidates",
            "candidate_instances": candidate_total,
            "raw_seed_hits": candidate_total,
            "unique_candidate_pairs": int(candidate_pairs.size),
            "self_candidates_excluded": self_excluded,
            "verified_window_pairs": retained,
            "live_seed_count": len(seed_entries),
            "live_seed_family_count": len(seeds),
            "live_seed_indexes": [index for index, _ in seed_entries],
            "preflight_cache_bytes": preflight_bytes,
            "partition_index_windows": int(status["windows"]),
        }

    def _catalog_records(
        self, partition: str, library: str, record_ids: Sequence[int]
    ) -> tuple[dict[int, ScanRecord], dict[int, dict[str, Any]]]:
        keys = self.index.parent_keys(partition, record_ids)
        rows = self.catalog.rows_by_keys(keys.values())
        by_key = {row["parent_key"]: row for row in rows}
        if set(by_key) != set(keys.values()):
            raise CanonicalParentIndexError("canonical index/catalog result membership differs")
        output: dict[int, ScanRecord] = {}
        annotations: dict[int, dict[str, Any]] = {}
        for record_id, parent_key in keys.items():
            row = by_key[parent_key]
            if (
                row["source_partition"] != partition
                or row["include_default"] != 1
                or row["optional_receptor_germline"] != 0
            ):
                raise CanonicalParentIndexError(
                    f"canonical index/catalog policy differs for {parent_key}"
                )
            output[record_id] = _catalog_record(
                row, library, record_id, self.annotation_hydrator
            )
            annotations[record_id] = dict(row)
        return output, annotations

    def _source_public(
        self,
        record: ScanRecord,
        row: Mapping[str, Any],
    ) -> dict[str, Any]:
        source = record.public()
        source.update({
            "protein_idx": _protein_idx(str(record.parent_key)),
            "parent_key": row["parent_key"],
            "portable_id": row["parent_key"],
            "id_namespace": row["id_namespace"],
            "parent_class": row["parent_class"],
            "class": row["parent_class"],
            "include_default": int(row["include_default"]),
            "mapped_tile_count": int(row["mapped_tile_count"]),
            "optional_receptor_germline": int(row["optional_receptor_germline"]),
            "original_header": row["original_header"],
            "canonical_header": row["canonical_header"],
            "source_header": (
                str(row["original_header"])[1:]
                if str(row["original_header"]).startswith(">")
                else str(row["original_header"])
            ),
            "companion_header": (
                str(row["canonical_header"])[1:]
                if str(row["canonical_header"]).startswith(">")
                else str(row["canonical_header"])
            ),
            "accession": row["accession"],
            "source_accession": row["accession"],
            "gene": row["gene"],
            "primary_gene": row["gene"],
            "protein_name": row["protein_name"],
            "source_description": row["protein_name"],
            "display_name": (
                row["protein_name"] or row["gene"] or row["accession"]
                or row["parent_key"]
            ),
            "organism": row["organism"],
            "assay_interference_prone": int(row["assay_interference_prone"]),
            "interference_flag": row["interference_flag"],
            "interference_note": row["interference_note"],
        })
        return (
            self.annotation_hydrator.hydrate_canonical(source)
            if self.annotation_hydrator is not None else source
        )

    @staticmethod
    def _guard_result_pairs(arrays: tuple[np.ndarray, ...], maximum: int) -> int:
        if not arrays[0].size:
            return 0
        pairs = (
            arrays[0].astype(np.uint64) << np.uint64(32)
        ) | arrays[2].astype(np.uint64)
        count = int(np.unique(pairs).size)
        if count > maximum:
            _raise_async_required(
                "result_pairs", count, maximum,
                "The exact canonical-parent result exceeds the synchronous source-pair guard",
            )
        return count

    def _aggregate(
        self,
        query_records: Sequence[ScanRecord],
        target_records: Mapping[int, ScanRecord],
        target_annotations: Mapping[int, Mapping[str, Any]],
        arrays: tuple[np.ndarray, ...],
        floor: int,
        include_hits: bool,
        deadline: float,
    ) -> list[dict[str, Any]]:
        query_keys, query_positions, target_keys, target_positions, identities = arrays
        if not query_keys.size:
            return []
        pair_keys = (
            query_keys.astype(np.uint64) << np.uint64(32)
        ) | target_keys.astype(np.uint64)
        order = np.argsort(pair_keys, kind="stable")
        sorted_pairs = pair_keys[order]
        change = np.empty(sorted_pairs.size, dtype=np.bool_)
        change[0] = True
        change[1:] = sorted_pairs[1:] != sorted_pairs[:-1]
        starts = np.flatnonzero(change)
        ends = np.append(starts[1:], sorted_pairs.size)
        results: list[dict[str, Any]] = []
        for start, end in zip(starts.tolist(), ends.tolist()):
            _check_deadline(deadline, "canonical result aggregation")
            selected = order[start:end]
            query_record = query_records[int(query_keys[selected[0]])]
            target_id = int(target_keys[selected[0]])
            target_record = target_records[target_id]
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
            source = self._source_public(
                target_record, target_annotations[target_id]
            )
            item: dict[str, Any] = {
                "query": query_record.public(),
                "source": source,
                "best_identity": int(pair_identity.max()),
                "floors": floors,
                "positions": "included" if include_hits else "computed_but_not_returned",
            }
            if include_hits:
                hits: list[list[Any]] = []
                for index in selected.tolist():
                    query_start = int(query_positions[index])
                    source_start = int(target_positions[index])
                    hits.append([
                        query_start,
                        source_start,
                        int(identities[index]),
                        query_record.sequence[query_start - 1:query_start - 1 + WINDOW],
                        target_record.sequence[source_start - 1:source_start - 1 + WINDOW],
                    ])
                item["hits_schema"] = [
                    "query_start", "source_start", "identity", "query_9mer", "source_9mer"
                ]
                item["hits"] = hits
            results.append(item)
        results.sort(
            key=lambda row: (
                -row["best_identity"], row["query"]["seqid"], row["source"]["seqid"]
            )
        )
        return results

    def scan(
        self,
        *,
        query: Mapping[str, Any],
        query_records: Sequence[ScanRecord],
        target: Mapping[str, Any],
        floor: int,
        include_hits: bool,
        max_results: int,
        started: float,
    ) -> dict[str, Any]:
        if floor not in FLOORS:
            raise ScanError(400, "invalid_seed_floor", "Canonical parent floor must be 5, 6, or 7")
        if not query_records:
            raise ScanError(400, "invalid_fasta", "No query records were resolved")
        if target.get("kind") != "canonical_proteome":
            raise ScanError(422, "invalid_canonical_target", "Canonical index target shape differs")
        partition = str(target.get("partition") or "")
        status = self.index.status(partition)
        if (
            target.get("library") != status["library"]
            or target.get("canonical_default_count") != status["records"]
        ):
            raise ScanError(422, "invalid_canonical_target", "Canonical index target contract differs")
        query_windows = sum(record.windows for record in query_records)
        maximum = (
            MAX_CANONICAL_PARENT_FLOOR7_WINDOWS
            if floor == 7 and query.get("kind") == "canonical_parent"
            else MAX_QUERY_WINDOWS
        )
        if query_windows > maximum:
            _raise_async_required(
                "query_windows", query_windows, maximum,
                "The canonical-proteome query exceeds the synchronous window limit",
            )
        deadline = started + MAX_WALL_SECONDS
        excluded_parent_keys: dict[int, set[str]] = {
            index: {str(record.parent_key)}
            for index, record in enumerate(query_records)
            if record.parent_key
        }
        if (
            query.get("kind") == "library"
            and query.get("library") == target.get("library")
        ):
            if not callable(self.assay_parent_resolver):
                raise ScanError(
                    409,
                    "canonical_query_projection_unclassifiable",
                    "The assay Antigen Target cannot be classified safely for canonical self-parent exclusion",
                    {
                        "complete": False,
                        "no_partial_payload": True,
                        "reason": "authoritative_assay_parent_resolver_not_bound",
                    },
                )
            try:
                resolved = self.assay_parent_resolver(
                    query_library=str(query["library"]),
                    query_records=query_records,
                )
            except ScanError:
                raise
            except Exception as error:
                raise ScanError(
                    409,
                    "canonical_query_projection_unclassifiable",
                    "The assay Antigen Target cannot be classified safely for canonical self-parent exclusion",
                    {"complete": False, "no_partial_payload": True},
                ) from error
            parent_keys = {str(value) for value in resolved}
            if not parent_keys:
                raise ScanError(
                    409,
                    "canonical_query_projection_unclassifiable",
                    "The assay Antigen Target has no exact canonical parent for self-parent exclusion",
                    {"complete": False, "no_partial_payload": True},
                )
            excluded_parent_keys[0] = parent_keys
        arrays, counts = self._scan_index(
            query_records, partition, floor, include_hits, deadline,
            excluded_parent_keys,
        )
        result_pair_count = self._guard_result_pairs(arrays, max_results)
        target_ids = sorted({int(value) for value in arrays[2].tolist()})
        target_records, target_annotations = self._catalog_records(
            partition, str(target["library"]), target_ids
        ) if target_ids else ({}, {})
        estimated_response = (
            sum(_record_payload_bytes(record) for record in query_records)
            + sum(_record_payload_bytes(record) for record in target_records.values()) * 2
            + result_pair_count * RESULT_PAIR_OVERHEAD_BYTES
            + (int(arrays[0].size) * POSITIONAL_HIT_OVERHEAD_BYTES if include_hits else 0)
        )
        estimated_rss = _array_bytes(arrays) * 4 + estimated_response * 4
        if estimated_response > MAX_RESPONSE_BYTES:
            _raise_async_required(
                "response_bytes", estimated_response, MAX_RESPONSE_BYTES,
                "The exact canonical-parent response exceeds the synchronous serialization budget",
            )
        if estimated_rss > MAX_ESTIMATED_RSS_BYTES:
            _raise_async_required(
                "estimated_resident_bytes", estimated_rss, MAX_ESTIMATED_RSS_BYTES,
                "The exact canonical-parent response exceeds the synchronous resident-memory estimate",
            )
        results = self._aggregate(
            query_records, target_records, target_annotations,
            arrays, floor, include_hits, deadline
        )
        referenced = {
            int(row["source"]["protein_idx"]): row["source"]
            for row in results
        }
        source_catalog = [referenced[key] for key in sorted(referenced)]
        _check_deadline(deadline, "canonical response assembly")
        return {
            "query_records": [record.public() for record in query_records],
            "target": {
                "kind": "canonical_proteome",
                "library": target["library"],
                "partition": partition,
                "canonical_default_count": status["records"],
                "canonical_complete": True,
                "entity_level": "canonical_parent",
                "entity_label": "canonical parent proteins",
                "indexed_windows": status["windows"],
                "index_fingerprint": self.index.manifest["index_fingerprint"],
            },
            "source_catalog": source_catalog,
            "results": results,
            "result_count": len(results),
            "execution": {
                **counts,
                "complete": True,
                "aggregate_counts_exact": True,
                "positional_hits_included": include_hits,
                "coordinate_system": "1-based window starts",
                "identity_policy": (
                    "canonical residues match exactly; every X/noncanonical position is a forced mismatch"
                ),
                "event_deduplication": "exact_query_source_window_coordinate_pair",
                "non_overlapping_compression": False,
                "self_parent_keys_excluded": sorted({
                    value for values in excluded_parent_keys.values() for value in values
                    if self.index.record_id(partition, value) is not None
                }),
                "estimated_response_bytes_pre_materialization": estimated_response,
                "estimated_resident_bytes_pre_materialization": estimated_rss,
            },
            "contract": {
                "truncation": False,
                "complete_or_error": True,
                "canonical_parent_identity": "immutable P9P/M1E parent_key",
            },
            "_working_bytes": _array_bytes(arrays),
        }


__all__ = ["CanonicalParentIndexService"]
