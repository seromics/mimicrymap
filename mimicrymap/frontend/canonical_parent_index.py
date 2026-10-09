"""Immutable, lazy loader for the canonical-parent 9-mer seed sidecar.

The package is fully hashed by its builder/finalizer. Runtime validation is
deliberately metadata-only for the ~2.1 GiB array payload: small attestations
are hashed, every declared file size is checked, and NPY dtype/shape contracts
are opened through NumPy mmap without reading the full arrays.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

try:
    import numpy as np
except ImportError:  # pragma: no cover - exercised by deployment capability gate
    np = None


SCHEMA = "mimicryone/canonical-parent-live-index/1"
VALIDATION_SCHEMA = "mimicryone/canonical-parent-live-index-validation/1"
PARTITION_SCHEMA = "mimicryone/canonical-parent-window-cache/1"
SEED_FAMILY_SCHEMA = "mimicryone/seed-family-index/1"
SEED_INDEX_SCHEMA = "mimicryone/seed-index/1"
RELEASE_ID = "mimicryone-canonical-parent-live-index-v1-r3"
PARENT_RELEASE_ID = "mimicryone_panscan9_3B04D688_20260831_r3"
SOURCE_RELEASE = "PanScan9_3B04D688_20260831"
MANIFEST_NAME = "MANIFEST.json"
VALIDATION_NAME = "VALIDATION.json"
WINDOW = 9
ENCODING_BASE = 21
PARENT_KEY_BYTES = 12
FLOORS = (5, 6, 7)
PARENT_KEY_RE = re.compile(rb"^(?:P9P|M1E)[0-9]{9}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TRANSIENT_NAMES = frozenset({"__pycache__", ".DS_Store"})
TRANSIENT_SUFFIXES = (".pyc", ".pyo", ".log", ".tmp", ".partial", ".building", "-wal", "-shm")

EXPECTED_PARTITIONS: Mapping[str, Mapping[str, Any]] = {
    "Human": {
        "directory": "human",
        "records": 20_563,
        "windows": 11_267_946,
        "library": "panscan9_human",
        "fasta": "parents/human_default.fasta.gz",
    },
    "Exposure": {
        "directory": "exposure",
        "records": 8_827,
        "windows": 3_584_530,
        "library": "panscan9_exposure",
        "fasta": "parents/exposure_default.fasta.gz",
    },
}


class CanonicalParentIndexError(ValueError):
    """The package is incomplete, stale, mixed-release, or malformed."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CanonicalParentIndexError(message)


def _mapping(value: object, context: str) -> Mapping[str, Any]:
    _require(isinstance(value, Mapping), f"{context} must be an object")
    return value


def _json(path: Path, context: str) -> dict[str, Any]:
    _require(path.is_file(), f"{context} is missing: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CanonicalParentIndexError(f"{context} is invalid: {path}: {error}") from error
    _require(isinstance(value, dict), f"{context} must contain an object")
    return value


def sha256_file(path: Path, block_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(block_size), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def fingerprint_material(manifest: Mapping[str, Any]) -> dict[str, Any]:
    fields = (
        "schema", "release_id", "parent_release_id", "source_release",
        "analysis_release", "canonical_parent_catalog", "inputs", "counts",
        "window", "floors", "seed_family", "policy", "partitions",
    )
    missing = [field for field in fields if field not in manifest]
    _require(not missing, f"index fingerprint fields are missing: {missing}")
    return {field: manifest[field] for field in fields}


def index_fingerprint(manifest: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json_bytes(fingerprint_material(manifest))).hexdigest()


def build_covering_seeds(
    length: int = WINDOW, weight: int = 4, mismatches: int = 4
) -> tuple[tuple[int, ...], ...]:
    """Return the deterministic greedy family used by the existing live index."""

    positions = tuple(range(length))
    choices = tuple(itertools.combinations(positions, weight))
    mismatch_sets = tuple(itertools.combinations(positions, mismatches))
    uncovered = set(mismatch_sets)
    chosen: list[tuple[int, ...]] = []
    choice_sets = [(seed, frozenset(seed)) for seed in choices]
    while uncovered:
        best_seed: tuple[int, ...] | None = None
        best_cover: set[tuple[int, ...]] = set()
        for seed, seed_set in choice_sets:
            cover = {row for row in uncovered if seed_set.isdisjoint(row)}
            if len(cover) > len(best_cover):
                best_seed, best_cover = seed, cover
        _require(best_seed is not None and bool(best_cover), "cannot build covering seed family")
        chosen.append(best_seed)
        uncovered.difference_update(best_cover)
    verify_covering_seeds(chosen)
    return tuple(chosen)


def verify_covering_seeds(seeds: Sequence[Sequence[int]]) -> None:
    normalized = [tuple(int(value) for value in seed) for seed in seeds]
    _require(len(normalized) == 32, "live seed family must contain exactly 32 seeds")
    _require(
        all(len(seed) == 4 and len(set(seed)) == 4 and all(0 <= p < WINDOW for p in seed)
            for seed in normalized),
        "live seed family shape differs",
    )
    for mismatch_count in range(5):
        for mismatches in itertools.combinations(range(WINDOW), mismatch_count):
            mismatch_set = set(mismatches)
            _require(
                any(mismatch_set.isdisjoint(seed) for seed in normalized),
                f"live seed family misses mismatch set {mismatches}",
            )


# Frozen output of build_covering_seeds(9, 4, 4). Do not recompute the
# greedy set during server import; doing so needlessly adds seconds to startup.
LIVE_SEEDS = (
    (0, 1, 2, 3), (0, 1, 4, 5), (0, 1, 6, 7), (0, 2, 4, 6),
    (0, 2, 5, 7), (0, 3, 4, 7), (0, 3, 5, 6), (1, 2, 4, 7),
    (1, 2, 5, 6), (1, 3, 4, 6), (1, 3, 5, 7), (2, 3, 4, 5),
    (2, 3, 6, 7), (4, 5, 6, 7), (0, 1, 2, 8), (0, 1, 3, 8),
    (0, 2, 3, 8), (0, 4, 5, 8), (0, 6, 7, 8), (1, 2, 3, 8),
    (1, 4, 5, 8), (1, 6, 7, 8), (2, 4, 6, 8), (2, 5, 7, 8),
    (3, 4, 7, 8), (3, 5, 6, 8), (0, 1, 4, 8), (0, 1, 5, 8),
    (0, 2, 4, 7), (0, 2, 5, 6), (0, 3, 4, 6), (0, 3, 5, 7),
)
verify_covering_seeds(LIVE_SEEDS)
LIVE_FAMILY_HASH = hashlib.sha256(
    json.dumps([list(seed) for seed in LIVE_SEEDS], sort_keys=True, separators=(",", ":")).encode("ascii")
).hexdigest()


@dataclass(frozen=True)
class PartitionStatus:
    partition: str
    directory: str
    library: str
    records: int
    windows: int
    root: Path
    parent_keys: Any


class CanonicalParentIndex:
    """Validate one frozen sidecar and expose mmap-safe partition descriptors."""

    def __init__(
        self,
        root: str | Path,
        *,
        expected_release_id: str = RELEASE_ID,
        expected_parent_release_id: str = PARENT_RELEASE_ID,
        expected_source_release: str = SOURCE_RELEASE,
        expected_partitions: Mapping[str, Mapping[str, Any]] = EXPECTED_PARTITIONS,
        expected_analysis_release: Mapping[str, str] | None = None,
        expected_catalog: Mapping[str, str] | None = None,
    ) -> None:
        started = time.monotonic()
        if np is None:
            raise CanonicalParentIndexError("NumPy is required for the canonical parent index")
        self.root = Path(root).resolve()
        _require(self.root.is_dir(), f"canonical parent index root is missing: {self.root}")
        self.manifest_path = self.root / MANIFEST_NAME
        self.validation_path = self.root / VALIDATION_NAME
        self.manifest = _json(self.manifest_path, "canonical parent index manifest")
        self.validation = _json(self.validation_path, "canonical parent index validation")
        self.expected_partitions = {
            key: dict(value) for key, value in expected_partitions.items()
        }
        self._statuses: dict[str, PartitionStatus] = {}
        self._key_to_record: dict[str, dict[str, int]] = {}
        self._validate_root(
            expected_release_id,
            expected_parent_release_id,
            expected_source_release,
            expected_analysis_release,
            expected_catalog,
        )
        self.startup_validation_seconds = round(time.monotonic() - started, 6)

    def _small_attestation(
        self,
        root: Path,
        filename: str,
        specification: object,
        context: str,
    ) -> Path:
        spec = _mapping(specification, context)
        _require(spec.get("path") == filename, f"{context} path differs")
        relative = Path(filename)
        _require(not relative.is_absolute() and ".." not in relative.parts,
                 f"{context} filename is unsafe")
        path = root / relative
        _require(path.is_file(), f"{context} is missing: {path}")
        size = spec.get("bytes")
        digest = str(spec.get("sha256") or "")
        _require(type(size) is int and size == path.stat().st_size, f"{context} byte count differs")
        _require(SHA256_RE.fullmatch(digest) is not None, f"{context} SHA-256 is invalid")
        _require(sha256_file(path) == digest, f"{context} SHA-256 differs")
        return path

    def _validate_root(
        self,
        release_id: str,
        parent_release_id: str,
        source_release: str,
        expected_analysis_release: Mapping[str, str] | None,
        expected_catalog: Mapping[str, str] | None,
    ) -> None:
        manifest, validation = self.manifest, self.validation
        _require(manifest.get("schema") == SCHEMA, "canonical parent index schema differs")
        _require(manifest.get("status") == "PASS", "canonical parent index manifest is not PASS")
        _require(manifest.get("release_id") == release_id, "canonical parent index release_id differs")
        _require(manifest.get("parent_release_id") == parent_release_id, "parent release binding differs")
        _require(manifest.get("source_release") == source_release, "source release binding differs")
        _require(manifest.get("window") == WINDOW, "canonical parent index window differs")
        _require(manifest.get("floors") == list(FLOORS), "canonical parent index floors differ")
        family = _mapping(manifest.get("seed_family"), "manifest.seed_family")
        _require(family.get("mode") == "live", "canonical parent seed mode differs")
        _require(family.get("seed_count") == len(LIVE_SEEDS), "canonical parent seed count differs")
        _require(family.get("family_hash") == LIVE_FAMILY_HASH, "canonical parent seed hash differs")
        _require(family.get("seeds") == [list(seed) for seed in LIVE_SEEDS], "canonical parent seeds differ")
        _require(manifest.get("policy") == {
            "include_default": 1,
            "optional_receptor_germline": 0,
            "exact_full_window_verification": True,
            "coordinate_pair_deduplication": True,
            "non_overlapping": False,
            "complete_or_error": True,
        }, "canonical parent index policy differs")
        observed_fingerprint = str(manifest.get("index_fingerprint") or "")
        _require(SHA256_RE.fullmatch(observed_fingerprint) is not None,
                 "canonical parent index fingerprint is invalid")
        _require(index_fingerprint(manifest) == observed_fingerprint,
                 "canonical parent index fingerprint differs")
        analysis_release = _mapping(manifest.get("analysis_release"), "manifest.analysis_release")
        for name in ("release_id", "release_fingerprint"):
            _require(isinstance(analysis_release.get(name), str) and bool(analysis_release[name]),
                     f"analysis release {name} is missing")
        if expected_analysis_release is not None:
            _require(dict(analysis_release) == dict(expected_analysis_release),
                     "analysis release binding differs")
        catalog = _mapping(manifest.get("canonical_parent_catalog"),
                           "manifest.canonical_parent_catalog")
        for name in ("release_id", "database_sha256"):
            _require(isinstance(catalog.get(name), str) and bool(catalog[name]),
                     f"canonical parent catalog {name} is missing")
        _require(SHA256_RE.fullmatch(str(catalog["database_sha256"])) is not None,
                 "canonical parent catalog database SHA-256 is invalid")
        if expected_catalog is not None:
            _require(dict(catalog) == dict(expected_catalog), "canonical parent catalog binding differs")

        _require(validation.get("schema") == VALIDATION_SCHEMA,
                 "canonical parent index validation schema differs")
        _require(validation.get("status") == "PASS" and validation.get("failures") == [],
                 "canonical parent index validation is not PASS")
        for name in ("release_id", "parent_release_id", "source_release", "analysis_release",
                     "canonical_parent_catalog", "counts", "seed_family", "policy",
                     "index_fingerprint"):
            _require(validation.get(name) == manifest.get(name),
                     f"validation {name} binding differs")
        outputs = _mapping(manifest.get("outputs"), "manifest.outputs")
        validation_spec = _mapping(outputs.get("validation"), "manifest.outputs.validation")
        self._small_attestation(
            self.root, VALIDATION_NAME, validation_spec, "validation attestation"
        )

        inputs = _mapping(manifest.get("inputs"), "manifest.inputs")
        parent_manifest = _mapping(inputs.get("parent_manifest"),
                                   "manifest.inputs.parent_manifest")
        _require(
            parent_manifest.get("path") == "manifests/parent_release_manifest.json"
            and type(parent_manifest.get("bytes")) is int
            and parent_manifest["bytes"] > 0
            and SHA256_RE.fullmatch(str(parent_manifest.get("sha256") or "")) is not None,
            "parent release manifest input binding differs",
        )
        input_fastas = _mapping(inputs.get("parent_fastas"),
                                "manifest.inputs.parent_fastas")
        _require(set(input_fastas) == set(self.expected_partitions),
                 "parent FASTA input partition set differs")

        partitions = _mapping(manifest.get("partitions"), "manifest.partitions")
        counts = _mapping(manifest.get("counts"), "manifest.counts")
        _require(set(partitions) == set(self.expected_partitions), "partition set differs")
        _require(set(counts) == set(self.expected_partitions), "partition count set differs")
        for partition, contract in self.expected_partitions.items():
            spec = _mapping(partitions[partition], f"manifest.partitions.{partition}")
            count_spec = _mapping(counts[partition], f"manifest.counts.{partition}")
            expected_records = int(contract["records"])
            expected_windows = int(contract["windows"])
            _require(count_spec == {"records": expected_records, "windows": expected_windows},
                     f"{partition} counts differ")
            _require(spec.get("fasta") == input_fastas[partition],
                     f"{partition} root/input FASTA binding differs")
            self._statuses[partition] = self._validate_partition(partition, contract, spec)
        self._reject_transients()

    def _declared_array(
        self,
        root: Path,
        filename: str,
        specification: object,
        dtype: Any,
        shape: tuple[int, ...],
        context: str,
    ) -> Any:
        spec = _mapping(specification, context)
        _require(spec.get("path") == filename, f"{context} path differs")
        _require(type(spec.get("bytes")) is int and spec["bytes"] >= 0,
                 f"{context} byte count is invalid")
        _require(SHA256_RE.fullmatch(str(spec.get("sha256") or "")) is not None,
                 f"{context} SHA-256 is invalid")
        path = root / filename
        _require(path.is_file(), f"{context} is missing: {path}")
        _require(path.stat().st_size == spec["bytes"], f"{context} byte count differs")
        try:
            array = np.load(path, mmap_mode="r", allow_pickle=False)
        except (OSError, ValueError) as error:
            raise CanonicalParentIndexError(f"{context} NPY header is invalid: {error}") from error
        _require(array.dtype == np.dtype(dtype), f"{context} dtype differs")
        _require(array.shape == shape, f"{context} shape differs")
        return array

    def _validate_partition(
        self,
        partition: str,
        contract: Mapping[str, Any],
        root_spec: Mapping[str, Any],
    ) -> PartitionStatus:
        directory = str(contract["directory"])
        _require(root_spec.get("directory") == directory, f"{partition} directory differs")
        root = self.root / directory
        _require(root.is_dir(), f"{partition} index directory is missing")
        self._small_attestation(
            root,
            "manifest.json",
            root_spec.get("manifest"),
            f"{partition} partition manifest attestation",
        )
        manifest = _json(root / "manifest.json", f"{partition} partition manifest")
        _require(manifest.get("schema") == PARTITION_SCHEMA, f"{partition} schema differs")
        _require(manifest.get("status") == "PASS", f"{partition} partition is not PASS")
        _require(manifest.get("partition") == partition, f"{partition} identity differs")
        _require(manifest.get("library") == contract["library"], f"{partition} library differs")
        records, windows = int(contract["records"]), int(contract["windows"])
        _require(manifest.get("records") == records and manifest.get("windows") == windows,
                 f"{partition} partition counts differ")
        _require(manifest.get("fasta") == root_spec.get("fasta"),
                 f"{partition} FASTA binding differs")
        arrays = _mapping(manifest.get("arrays"), f"{partition}.arrays")
        expected_arrays = {
            "windows.npy": (np.uint8, (windows, WINDOW)),
            "window_parent.npy": (np.uint32, (windows,)),
            "window_position.npy": (np.uint32, (windows,)),
            "record_offsets.npy": (np.uint64, (records + 1,)),
            "record_parent_key.npy": (np.dtype(f"S{PARENT_KEY_BYTES}"), (records,)),
        }
        _require(set(arrays) == set(expected_arrays), f"{partition} array set differs")
        loaded = {
            name: self._declared_array(root, name, arrays[name], dtype, shape,
                                       f"{partition} {name}")
            for name, (dtype, shape) in expected_arrays.items()
        }
        offsets = loaded["record_offsets.npy"]
        _require(int(offsets[0]) == 0 and int(offsets[-1]) == windows,
                 f"{partition} record offsets bounds differ")
        _require(bool(np.all(offsets[1:] >= offsets[:-1])),
                 f"{partition} record offsets are not monotonic")
        keys = loaded["record_parent_key.npy"]
        decoded: list[str] = []
        for raw in keys.tolist():
            value = bytes(raw).rstrip(b"\0")
            _require(PARENT_KEY_RE.fullmatch(value) is not None,
                     f"{partition} record parent_key is invalid")
            decoded.append(value.decode("ascii"))
        _require(len(set(decoded)) == records, f"{partition} parent keys are not unique")

        family_spec = _mapping(manifest.get("seed_family"),
                               f"{partition}.seed_family")
        self._small_attestation(
            root,
            "indexes/live/manifest.json",
            family_spec,
            f"{partition} live seed family attestation",
        )
        family_path = root / "indexes" / "live" / "manifest.json"
        family = _json(family_path, f"{partition} live seed family")
        _require(family.get("schema") == SEED_FAMILY_SCHEMA,
                 f"{partition} seed family schema differs")
        _require(family.get("partition") == partition and family.get("mode") == "live",
                 f"{partition} seed family identity differs")
        _require(family.get("family_hash") == LIVE_FAMILY_HASH,
                 f"{partition} seed family hash differs")
        _require(family.get("seeds") == [list(seed) for seed in LIVE_SEEDS],
                 f"{partition} seed family differs")
        seed_indexes = family.get("seed_indexes")
        _require(isinstance(seed_indexes, list) and len(seed_indexes) == len(LIVE_SEEDS),
                 f"{partition} seed index list differs")
        for index, seed in enumerate(LIVE_SEEDS):
            seed_root = root / "indexes" / "live" / f"seed_{index:02d}"
            seed_manifest = _json(seed_root / "manifest.json",
                                  f"{partition} seed {index} manifest")
            _require(seed_manifest == seed_indexes[index],
                     f"{partition} seed {index} family attestation differs")
            _require(seed_manifest.get("schema") == SEED_INDEX_SCHEMA,
                     f"{partition} seed {index} schema differs")
            _require(seed_manifest.get("partition") == partition
                     and seed_manifest.get("seed_index") == index
                     and seed_manifest.get("seed") == list(seed)
                     and seed_manifest.get("family_hash") == LIVE_FAMILY_HASH
                     and seed_manifest.get("windows") == windows,
                     f"{partition} seed {index} identity differs")
            files = _mapping(seed_manifest.get("files"),
                             f"{partition} seed {index} files")
            _require(set(files) == {"order.npy", "unique_keys.npy", "offsets.npy"},
                     f"{partition} seed {index} file set differs")
            unique_count = seed_manifest.get("unique_keys")
            _require(type(unique_count) is int and 0 <= unique_count <= ENCODING_BASE ** 4,
                     f"{partition} seed {index} unique-key count differs")
            order = self._declared_array(seed_root, "order.npy", files["order.npy"],
                                         np.uint32, (windows,),
                                         f"{partition} seed {index} order")
            unique = self._declared_array(seed_root, "unique_keys.npy",
                                          files["unique_keys.npy"], np.uint32,
                                          (unique_count,),
                                          f"{partition} seed {index} unique keys")
            seed_offsets = self._declared_array(seed_root, "offsets.npy",
                                                files["offsets.npy"], np.uint64,
                                                (unique_count + 1,),
                                                f"{partition} seed {index} offsets")
            _require(int(seed_offsets[0]) == 0 and int(seed_offsets[-1]) == windows,
                     f"{partition} seed {index} offset bounds differ")
            del order, unique, seed_offsets
        self._key_to_record[partition] = {
            key: index + 1 for index, key in enumerate(decoded)
        }
        return PartitionStatus(
            partition=partition,
            directory=directory,
            library=str(contract["library"]),
            records=records,
            windows=windows,
            root=root,
            parent_keys=keys,
        )

    def _reject_transients(self) -> None:
        for path in self.root.rglob("*"):
            name = path.name
            lower = name.lower()
            _require(name not in TRANSIENT_NAMES and not any(lower.endswith(suffix)
                     for suffix in TRANSIENT_SUFFIXES),
                     f"canonical parent index contains transient path: {path}")

    def status(self, partition: str, *, include_internal: bool = False) -> dict[str, Any]:
        item = self._statuses.get(str(partition))
        if item is None:
            raise CanonicalParentIndexError(f"unknown canonical partition: {partition}")
        result: dict[str, Any] = {
            "available": True,
            "partition": item.partition,
            "library": item.library,
            "records": item.records,
            "windows": item.windows,
            "floors": list(FLOORS),
            "family_hash": LIVE_FAMILY_HASH,
        }
        if include_internal:
            result["_root"] = str(item.root)
            result["_seeds"] = [list(seed) for seed in LIVE_SEEDS]
            result["_parent_keys"] = item.parent_keys
        return result

    def parent_keys(self, partition: str, record_ids: Iterable[int]) -> dict[int, str]:
        item = self._statuses.get(str(partition))
        if item is None:
            raise CanonicalParentIndexError(f"unknown canonical partition: {partition}")
        output: dict[int, str] = {}
        for raw in record_ids:
            if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= item.records:
                raise CanonicalParentIndexError(f"invalid {partition} record id: {raw}")
            value = bytes(item.parent_keys[raw - 1]).rstrip(b"\0").decode("ascii")
            output[raw] = value
        return output

    def record_id(self, partition: str, parent_key: str) -> int | None:
        values = self._key_to_record.get(str(partition))
        if values is None:
            raise CanonicalParentIndexError(f"unknown canonical partition: {partition}")
        return values.get(str(parent_key))

    def capabilities(self) -> dict[str, Any]:
        partitions = {
            key: {"records": status.records, "windows": status.windows,
                  "library": status.library}
            for key, status in self._statuses.items()
        }
        return {
            "schema": SCHEMA,
            "available": True,
            "release_id": self.manifest["release_id"],
            "analysis_release": dict(self.manifest["analysis_release"]),
            "index_fingerprint": self.manifest["index_fingerprint"],
            "floors": list(FLOORS),
            "partitions": partitions,
            "complete_or_error": True,
            "positional_pairs": "deduplicated_coordinate_pairs",
            "non_overlapping": False,
            "startup_validation_seconds": self.startup_validation_seconds,
        }


__all__ = [
    "CanonicalParentIndex",
    "CanonicalParentIndexError",
    "EXPECTED_PARTITIONS",
    "FLOORS",
    "LIVE_FAMILY_HASH",
    "LIVE_SEEDS",
    "PARTITION_SCHEMA",
    "RELEASE_ID",
    "SCHEMA",
    "SEED_FAMILY_SCHEMA",
    "SEED_INDEX_SCHEMA",
    "SOURCE_RELEASE",
    "VALIDATION_SCHEMA",
    "WINDOW",
    "canonical_json_bytes",
    "fingerprint_material",
    "index_fingerprint",
    "sha256_file",
]
