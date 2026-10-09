"""Read-only HTTP API for MimicryMap analysis-ready artifacts.

The release layout is deliberately simple::

    manifest.json
    catalog.sqlite
    comparisons/<manifest comparison key>.sqlite

``catalog.sqlite`` owns antigen metadata and sequences.  Comparison shards own only
the deduplicated, symmetric ``edge`` relation.  Every request gets fresh read-only
SQLite connections, which keeps ``ThreadingHTTPServer`` safe without connection
pooling and permits completed shards to be replaced atomically between requests.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import parse_qs, urlsplit

from canonical_aliases import normalize_alias
from analysis_membership import MembershipFilterError


API_PREFIX = "/api/analysis"
MAX_JSON_ROWS = 200
MAX_EXPORT_ROWS = 1_000_000
MAX_PAIR_MATCHES = 5_000
MAX_PAIR_WINDOWS = 250_000
JSON_GZIP_MIN_BYTES = 1_024

EDGE_COLUMNS = (
    "antigen_a,antigen_b,best_identity,n7,n8,n9,"
    "a_windows_m7,a_windows_m8,a_windows_m9,"
    "b_windows_m7,b_windows_m8,b_windows_m9"
)
ANTIGEN_COLUMNS = (
    "antigen_id,library_key,ordinal,seqid,short_id,raw_header,sequence,"
    "length,window_count,noncanonical_windows,source_row,sequence_status"
)
COMPARISON_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
FTS_TOKEN = re.compile(r"[A-Za-z0-9_]+")
CANONICAL = frozenset("ACDEFGHIKLMNPQRSTVWY")

# Exact 7/9 covering family used by the analysis-ready builder.  The first
# eligible seed is canonical, so a positional window pair is returned once.
M7_SEEDS: tuple[tuple[int, ...], ...] = tuple(
    tuple(int(position) for position in seed)
    for seed in (
        "012345",
        "012367",
        "012468",
        "012578",
        "013478",
        "013568",
        "014567",
        "234567",
        "023458",
        "023678",
        "045678",
        "123458",
        "123678",
        "145678",
    )
)


class AnalysisConfigurationError(RuntimeError):
    """Raised at startup when an analysis release is not safe to expose."""


class APIError(RuntimeError):
    """A request error that is safe to report to the browser."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Comparison:
    key: str
    library_a: str
    library_b: str
    label: str


def _read_only_connection(path: Path) -> sqlite3.Connection:
    """Open a path without creating it or allowing writes."""

    if not path.is_file():
        raise FileNotFoundError(path)
    # These release databases are fingerprinted, sealed, and never mutated in place.
    # immutable=1 also prevents read-only requests from creating WAL/SHM sidecars.
    uri = f"{path.resolve().as_uri()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True, timeout=10.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA busy_timeout=10000")
    return connection


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _accepts_gzip(value: Any) -> bool:
    """Return true only when HTTP content negotiation gives gzip positive quality."""

    explicit: list[float] = []
    wildcard: list[float] = []
    for raw_item in str(value or "").split(","):
        parts = [part.strip() for part in raw_item.split(";")]
        encoding = parts[0].lower()
        if not encoding:
            continue
        quality = 1.0
        for parameter in parts[1:]:
            name, separator, raw_quality = parameter.partition("=")
            if separator and name.strip().lower() == "q":
                try:
                    quality = max(0.0, min(1.0, float(raw_quality.strip())))
                except ValueError:
                    quality = 0.0
                break
        if encoding == "gzip":
            explicit.append(quality)
        elif encoding == "*":
            wildcard.append(quality)
    if explicit:
        return max(explicit) > 0.0
    return bool(wildcard and max(wildcard) > 0.0)


def _send_json(handler: Any, status: int, payload: Any, *, head_only: bool = False) -> None:
    body = _json_bytes(payload)
    accepts_gzip = _accepts_gzip(handler.headers.get("Accept-Encoding", ""))
    compressed = accepts_gzip and len(body) >= JSON_GZIP_MIN_BYTES
    if compressed:
        body = gzip.compress(body, compresslevel=5, mtime=0)
    _send_json_bytes(handler, status, body, compressed=compressed, head_only=head_only)


def _send_json_bytes(handler: Any, status: int, body: bytes, *, compressed: bool = False,
                     head_only: bool = False, cache_status: str | None = None) -> None:
    """Send immutable JSON bytes, including already-negotiated cached encoding."""
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Vary", "Accept-Encoding, X-Mimicry-View")
    if cache_status is not None:
        handler.send_header("X-Mimicry-Cache", cache_status)
    if compressed:
        handler.send_header("Content-Encoding", "gzip")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    if not head_only:
        try:
            handler.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # A latest-click abort deliberately closes the old socket. The
            # computation already observed cancellation; there is no client left
            # to receive its structured 499 response.
            return


def _one(query: Mapping[str, list[str]], name: str, default: str | None = None) -> str | None:
    values = query.get(name)
    if not values:
        return default
    if len(values) != 1:
        raise APIError(400, f"Parameter '{name}' may appear only once")
    return values[0]


def _integer(
    query: Mapping[str, list[str]],
    name: str,
    *,
    default: int | None = None,
    minimum: int = 0,
    maximum: int | None = None,
) -> int | None:
    raw = _one(query, name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise APIError(400, f"Parameter '{name}' must be an integer") from error
    if value < minimum or (maximum is not None and value > maximum):
        bounds = f">= {minimum}" if maximum is None else f"between {minimum} and {maximum}"
        raise APIError(400, f"Parameter '{name}' must be {bounds}")
    return value


def _boolean(query: Mapping[str, list[str]], name: str, default: bool = False) -> bool:
    raw = _one(query, name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise APIError(400, f"Parameter '{name}' must be true or false")


def _reject_unknown(query: Mapping[str, list[str]], allowed: set[str]) -> None:
    unknown = sorted(set(query) - allowed)
    if unknown:
        raise APIError(400, f"Unknown parameter(s): {', '.join(unknown)}")


def _fts_expression(text: str, *, prefix: bool = True) -> str:
    if len(text) > 512:
        raise APIError(400, "Search text is limited to 512 characters")
    tokens = FTS_TOKEN.findall(text)
    if not tokens:
        raise APIError(400, "Search text must contain a letter, number, or underscore")
    # Exact token matches must win before completion prefixes. Quoting every token
    # prevents callers from injecting FTS operators.
    suffix = "*" if prefix else ""
    return " AND ".join(f'"{token}"{suffix}' for token in tokens)


def _antigen_payload(
    row: sqlite3.Row,
    *,
    include_sequence: bool = False,
    annotation_hydrator: Any | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "antigen_id": int(row["antigen_id"]),
        "library": row["library_key"],
        "ordinal": int(row["ordinal"]),
        "seqid": row["seqid"],
        "short_id": row["short_id"],
        "raw_header": row["raw_header"],
        "length": int(row["length"]),
        "window_count": int(row["window_count"]),
        "noncanonical_windows": int(row["noncanonical_windows"]),
        "source_row": int(row["source_row"]),
        "sequence_status": row["sequence_status"],
    }
    if include_sequence:
        payload["sequence"] = row["sequence"]
    if "search_rank" in row.keys():
        payload["search_rank"] = float(row["search_rank"])
    return (
        annotation_hydrator.hydrate_assay(payload)
        if annotation_hydrator is not None else payload
    )


def _chunks(values: Sequence[int], size: int = 400) -> Iterable[Sequence[int]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _fetch_antigens(
    connection: sqlite3.Connection,
    antigen_ids: Iterable[int],
) -> dict[int, sqlite3.Row]:
    unique = sorted(set(int(value) for value in antigen_ids))
    records: dict[int, sqlite3.Row] = {}
    for chunk in _chunks(unique):
        placeholders = ",".join("?" for _ in chunk)
        rows = connection.execute(
            f"SELECT {ANTIGEN_COLUMNS} FROM antigen WHERE antigen_id IN ({placeholders})",
            tuple(chunk),
        )
        records.update((int(row["antigen_id"]), row) for row in rows)
    return records


def _edge_metrics(row: sqlite3.Row) -> dict[str, int]:
    return {
        "best_identity": int(row["best_identity"]),
        "n7": int(row["n7"]),
        "n8": int(row["n8"]),
        "n9": int(row["n9"]),
        "a_windows_m7": int(row["a_windows_m7"]),
        "a_windows_m8": int(row["a_windows_m8"]),
        "a_windows_m9": int(row["a_windows_m9"]),
        "b_windows_m7": int(row["b_windows_m7"]),
        "b_windows_m8": int(row["b_windows_m8"]),
        "b_windows_m9": int(row["b_windows_m9"]),
    }


def _edge_payload(
    row: sqlite3.Row,
    antigens: Mapping[int, sqlite3.Row],
    *,
    query_antigen: int | None = None,
    annotation_hydrator: Any | None = None,
) -> dict[str, Any]:
    antigen_a = int(row["antigen_a"])
    antigen_b = int(row["antigen_b"])
    payload: dict[str, Any] = {
        "antigen_a": _antigen_payload(
            antigens[antigen_a], annotation_hydrator=annotation_hydrator
        ),
        "antigen_b": _antigen_payload(
            antigens[antigen_b], annotation_hydrator=annotation_hydrator
        ),
        **_edge_metrics(row),
    }
    if query_antigen is not None:
        query_is_a = query_antigen == antigen_a
        partner = antigen_b if query_is_a else antigen_a
        query_prefix, partner_prefix = ("a", "b") if query_is_a else ("b", "a")
        payload["direction"] = {
            "query_antigen_id": query_antigen,
            "partner_antigen_id": partner,
            "query_side": "a" if query_is_a else "b",
            "query_windows_m7": int(row[f"{query_prefix}_windows_m7"]),
            "query_windows_m8": int(row[f"{query_prefix}_windows_m8"]),
            "query_windows_m9": int(row[f"{query_prefix}_windows_m9"]),
            "partner_windows_m7": int(row[f"{partner_prefix}_windows_m7"]),
            "partner_windows_m8": int(row[f"{partner_prefix}_windows_m8"]),
            "partner_windows_m9": int(row[f"{partner_prefix}_windows_m9"]),
        }
    return payload


def _seed_key(sequence: str, start: int, seed: tuple[int, ...]) -> str | None:
    residues = [sequence[start + position] for position in seed]
    if any(residue not in CANONICAL for residue in residues):
        return None
    return "".join(residues)


def _pair_matches(
    sequence_a: str,
    sequence_b: str,
    *,
    floor: int,
    maximum: int,
) -> tuple[list[dict[str, Any]], bool]:
    target_indexes = _pair_seed_index(sequence_b)
    return _pair_matches_indexed(
        sequence_a,
        sequence_b,
        floor=floor,
        maximum=maximum,
        target_indexes=target_indexes,
    )


def _pair_seed_index(sequence: str) -> tuple[dict[str, list[int]], ...]:
    """Build the seed buckets used by exact pair expansion.

    Static-player requests compare one target with many parents. Keeping
    this small index separate lets that route build it once for the repeated
    query sequence instead of rebuilding the same buckets for every parent.
    """

    windows = max(0, len(sequence) - 8)
    target_indexes: list[dict[str, list[int]]] = [dict() for _ in M7_SEEDS]
    for target_start in range(windows):
        for seed_index, seed in enumerate(M7_SEEDS):
            key = _seed_key(sequence, target_start, seed)
            if key is not None:
                target_indexes[seed_index].setdefault(key, []).append(target_start)
    return tuple(target_indexes)


def _pair_matches_indexed(
    sequence_a: str,
    sequence_b: str,
    *,
    floor: int,
    maximum: int,
    target_indexes: Sequence[Mapping[str, Sequence[int]]],
) -> tuple[list[dict[str, Any]], bool]:
    """Expand one pair using prebuilt seed buckets for ``sequence_b``.

    Matching and first-eligible-seed deduplication are identical to
    :func:`_pair_matches`; only target-side bucket construction is factored out
    for safe reuse within a single static-player request.
    """

    windows_a = max(0, len(sequence_a) - 8)
    windows_b = max(0, len(sequence_b) - 8)
    if not windows_a or not windows_b:
        return [], False
    if windows_a + windows_b > MAX_PAIR_WINDOWS:
        raise APIError(
            413,
            "Pair is too large for positional expansion; request include_matches=false for aggregate data",
        )
    if len(target_indexes) != len(M7_SEEDS):
        raise ValueError("target_indexes must contain one bucket map per M7 seed")

    matches: list[dict[str, Any]] = []
    for source_start in range(windows_a):
        source_window = sequence_a[source_start : source_start + 9]
        for seed_index, seed in enumerate(M7_SEEDS):
            key = _seed_key(sequence_a, source_start, seed)
            if key is None:
                continue
            for target_start in target_indexes[seed_index].get(key, ()):
                target_window = sequence_b[target_start : target_start + 9]
                # A pair eligible for an earlier seed has already been emitted.
                duplicate = False
                for earlier_seed in M7_SEEDS[:seed_index]:
                    earlier_a = _seed_key(sequence_a, source_start, earlier_seed)
                    if earlier_a is not None and earlier_a == _seed_key(sequence_b, target_start, earlier_seed):
                        duplicate = True
                        break
                if duplicate:
                    continue
                identity = sum(
                    residue_a == residue_b and residue_a in CANONICAL
                    for residue_a, residue_b in zip(source_window, target_window)
                )
                if identity < floor:
                    continue
                matches.append(
                    {
                        "position_a": source_start + 1,
                        "position_b": target_start + 1,
                        "identity": identity,
                        "window_a": source_window,
                        "window_b": target_window,
                    }
                )
                if len(matches) > maximum:
                    return matches[:maximum], True
    return matches, False


class AnalysisAPI:
    """Route ``/api/analysis/*`` requests over a release directory."""

    def __init__(self, analysis_db: str | Path):
        supplied = Path(analysis_db).expanduser()
        if supplied.suffix.lower() == ".sqlite":
            self.root = supplied.resolve().parent
            self.catalog_path = supplied.resolve()
        else:
            self.root = supplied.resolve()
            self.catalog_path = self.root / "catalog.sqlite"
        self.manifest_path = self.root / "manifest.json"
        self.comparisons_root = self.root / "comparisons"
        self.manifest = self._load_manifest()
        self.comparisons = self._load_comparisons()
        self.library_keys = self._validate_catalog()
        self.annotation_hydrator = None

    def _load_manifest(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise AnalysisConfigurationError(
                f"Cannot read analysis manifest: {self.manifest_path}"
            ) from error
        if not isinstance(payload, dict) or payload.get("catalog_status") != "complete":
            raise AnalysisConfigurationError("Analysis manifest does not describe a complete catalog")
        return payload

    def _load_comparisons(self) -> dict[str, Comparison]:
        raw_comparisons = self.manifest.get("comparisons")
        if not isinstance(raw_comparisons, list):
            raise AnalysisConfigurationError("Manifest comparisons must be a list")
        comparisons: dict[str, Comparison] = {}
        for raw in raw_comparisons:
            if not isinstance(raw, dict):
                raise AnalysisConfigurationError("Every manifest comparison must be an object")
            key, library_a, library_b = raw.get("key"), raw.get("a"), raw.get("b")
            if not all(isinstance(value, str) and value for value in (key, library_a, library_b)):
                raise AnalysisConfigurationError("Comparison key/a/b values must be nonempty strings")
            if not COMPARISON_KEY.fullmatch(key):
                raise AnalysisConfigurationError(f"Unsafe comparison key in manifest: {key!r}")
            if key in comparisons:
                raise AnalysisConfigurationError(f"Duplicate comparison key in manifest: {key}")
            comparisons[key] = Comparison(
                key=key,
                library_a=library_a,
                library_b=library_b,
                label=str(raw.get("label") or f"{library_a} vs {library_b}"),
            )
        return comparisons

    def _validate_catalog(self) -> frozenset[str]:
        try:
            with closing(_read_only_connection(self.catalog_path)) as connection:
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_schema WHERE type IN ('table','view')"
                    )
                }
                missing = {"meta", "library", "antigen"} - tables
                if missing:
                    raise AnalysisConfigurationError(
                        f"Catalog is missing required table(s): {', '.join(sorted(missing))}"
                    )
                libraries = frozenset(
                    row[0] for row in connection.execute("SELECT library_key FROM library")
                )
        except (OSError, sqlite3.Error) as error:
            raise AnalysisConfigurationError(f"Cannot open analysis catalog: {self.catalog_path}") from error
        unknown = {
            library
            for comparison in self.comparisons.values()
            for library in (comparison.library_a, comparison.library_b)
            if library not in libraries
        }
        if unknown:
            raise AnalysisConfigurationError(
                f"Manifest comparisons reference unknown libraries: {', '.join(sorted(unknown))}"
            )
        return libraries

    def dispatch(self, handler: Any, *, head_only: bool = False) -> bool:
        """Handle an analysis route and return ``True``; ignore other routes."""

        parsed = urlsplit(handler.path)
        path = parsed.path.rstrip("/") or "/"
        if path != API_PREFIX and not path.startswith(f"{API_PREFIX}/"):
            return False
        try:
            query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=32)
            if path in {API_PREFIX, f"{API_PREFIX}/meta"}:
                _reject_unknown(query, set())
                _send_json(handler, 200, self._meta(), head_only=head_only)
            elif path == f"{API_PREFIX}/antigens":
                _send_json(handler, 200, self._antigens(query), head_only=head_only)
            elif path == f"{API_PREFIX}/edges":
                _send_json(handler, 200, self._edges(query), head_only=head_only)
            elif path == f"{API_PREFIX}/pair":
                _send_json(handler, 200, self._pair(query), head_only=head_only)
            elif path == f"{API_PREFIX}/export.csv":
                self._export_csv(handler, query, head_only=head_only)
            else:
                raise APIError(404, "Unknown analysis endpoint")
        except APIError as error:
            _send_json(handler, error.status, {"error": error.message}, head_only=head_only)
        except (FileNotFoundError, OSError, sqlite3.Error, json.JSONDecodeError) as error:
            handler.log_error("Analysis API unavailable: %s", error)
            _send_json(handler, 503, {"error": "Analysis data are temporarily unavailable"}, head_only=head_only)
        except Exception as error:  # keep local paths and SQL details out of HTTP responses
            handler.log_error("Analysis API internal error: %s", error)
            _send_json(handler, 500, {"error": "Internal analysis API error"}, head_only=head_only)
        return True

    def _comparison(self, query: Mapping[str, list[str]]) -> Comparison:
        key = _one(query, "comparison")
        if not key:
            raise APIError(400, "Parameter 'comparison' is required")
        comparison = self.comparisons.get(key)
        if comparison is None:
            raise APIError(404, "Unknown comparison")
        return comparison

    def _shard_path(self, comparison: Comparison) -> Path:
        # Key syntax and manifest membership were validated at startup.  No request
        # value is ever interpolated into a filesystem path.
        return self.comparisons_root / f"{comparison.key}.sqlite"

    @staticmethod
    def _assert_complete_shard(connection: sqlite3.Connection) -> None:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('edge','build_progress')"
            )
        }
        if "edge" not in tables:
            raise APIError(503, "Comparison shard has no edge table")
        if "build_progress" in tables:
            row = connection.execute(
                "SELECT status FROM build_progress WHERE singleton=1"
            ).fetchone()
            if row is None or row[0] != "complete":
                raise APIError(409, "Comparison is still building")

    def _meta(self) -> dict[str, Any]:
        with closing(_read_only_connection(self.catalog_path)) as catalog:
            metadata = {row["key"]: row["value"] for row in catalog.execute("SELECT key,value FROM meta")}
            tables = {
                row[0]
                for row in catalog.execute(
                    "SELECT name FROM sqlite_schema WHERE type IN ('table','view')"
                )
            }
            libraries = [
                {
                    "key": row["library_key"],
                    "label": row["label"],
                    "class": row["class"],
                    "generation": row["generation"],
                    "records": int(row["records"]),
                    "residues": int(row["residues"]),
                    "windows": int(row["windows"]),
                    "noncanonical_windows": int(row["noncanonical_windows"]),
                    "empty_sequences": int(row["empty_sequences"]),
                    "duplicate_seqids": int(row["duplicate_seqids"]),
                }
                for row in catalog.execute(
                    """SELECT library_key,label,class,generation,records,residues,windows,
                              noncanonical_windows,empty_sequences,duplicate_seqids
                       FROM library ORDER BY library_key"""
                )
            ]
        comparisons = []
        for comparison in self.comparisons.values():
            shard = self._shard_path(comparison)
            side_manifest = shard.with_suffix(".manifest.json")
            status = "pending"
            edges: int | None = None
            if side_manifest.is_file():
                try:
                    built = json.loads(side_manifest.read_text(encoding="utf-8"))
                    status = str(built.get("status") or "unknown")
                    if built.get("edges") is not None:
                        edges = int(built["edges"])
                except (OSError, ValueError, json.JSONDecodeError):
                    status = "unreadable"
            elif shard.is_file():
                status = "building"
            comparisons.append(
                {
                    "key": comparison.key,
                    "label": comparison.label,
                    "library_a": comparison.library_a,
                    "library_b": comparison.library_b,
                    "self_comparison": comparison.library_a == comparison.library_b,
                    "stored_once": True,
                    "reverse_lookup": True,
                    "status": status,
                    "edges": edges,
                }
            )
        return {
            "schema": metadata.get("schema"),
            "release_id": metadata.get("release_id") or self.manifest.get("release_id"),
            "release_fingerprint": metadata.get("release_fingerprint"),
            "window": int(metadata.get("window", "9")),
            "identity_policy": metadata.get("identity_policy"),
            "catalog_status": self.manifest.get("catalog_status"),
            "search": {"full_seqid_exact": True, "fts": "antigen_fts" in tables},
            "libraries": libraries,
            "comparisons": comparisons,
        }

    def _antigens(self, query: Mapping[str, list[str]]) -> dict[str, Any]:
        allowed = {
            "antigen_id", "library", "seqid", "q", "limit", "after_id",
            "include_sequence", "filters",
        }
        _reject_unknown(query, allowed)
        antigen_id = _integer(query, "antigen_id", minimum=1)
        library = _one(query, "library")
        seqid = _one(query, "seqid")
        text = _one(query, "q")
        limit = _integer(query, "limit", default=50, minimum=1, maximum=MAX_JSON_ROWS)
        after_id = _integer(query, "after_id", default=0, minimum=0)
        include_sequence = _boolean(query, "include_sequence", False)
        filters_text = _one(query, "filters")
        filters: dict[str, Any] | None = None
        assert limit is not None and after_id is not None
        if library and library not in self.library_keys:
            raise APIError(404, "Unknown library")
        if filters_text is not None:
            if not library:
                raise APIError(400, "filters requires one library")
            try:
                raw_filters = json.loads(filters_text)
            except json.JSONDecodeError as error:
                raise APIError(400, "filters must be a JSON object") from error
            membership = getattr(self, "membership", None)
            if membership is None:
                raise APIError(409, "Source filters are unavailable in this deployment")
            try:
                filters = membership.normalize(library, raw_filters)
            except MembershipFilterError as error:
                raise APIError(422, str(error)) from error
        elif library:
            membership = getattr(self, "membership", None)
            if membership is not None and library in membership.libraries:
                filters = membership.normalize(library, {})
        selectors = sum(value is not None for value in (antigen_id, seqid, text))
        if selectors > 1:
            raise APIError(400, "Use only one of antigen_id, seqid, or q")
        if selectors and after_id:
            raise APIError(400, "after_id is only valid when listing antigens")

        with closing(_read_only_connection(self.catalog_path)) as catalog:
            rows: list[sqlite3.Row]
            mode: str
            search_match_mode: str | None = None
            search_matches: dict[int, dict[str, Any]] = {}
            if antigen_id is not None:
                parameters: list[Any] = [antigen_id]
                where = "antigen_id=?"
                if library:
                    where += " AND library_key=?"
                    parameters.append(library)
                row = catalog.execute(
                    f"SELECT {ANTIGEN_COLUMNS} FROM antigen WHERE {where}", parameters
                ).fetchone()
                rows = [] if row is None else [row]
                mode = "antigen_id"
            elif seqid is not None:
                if len(seqid) > 16_384:
                    raise APIError(400, "seqid is too long")
                if library:
                    rows = list(
                        catalog.execute(
                            f"SELECT {ANTIGEN_COLUMNS} FROM antigen WHERE library_key=? AND seqid=? LIMIT ?",
                            (library, seqid, limit),
                        )
                    )
                else:
                    # The catalog index begins with library_key.  One indexed lookup
                    # per small, fixed library is faster than a multimillion-row scan.
                    rows = []
                    for library_key in sorted(self.library_keys):
                        rows.extend(
                            catalog.execute(
                                f"SELECT {ANTIGEN_COLUMNS} FROM antigen WHERE library_key=? AND seqid=? LIMIT ?",
                                (library_key, seqid, limit - len(rows)),
                            )
                        )
                        if len(rows) >= limit:
                            break
                mode = "seqid_exact"
            elif text is not None:
                tables = {
                    row[0]
                    for row in catalog.execute(
                        "SELECT name FROM sqlite_schema WHERE type IN ('table','view')"
                    )
                }
                if "antigen_fts" not in tables:
                    raise APIError(503, "Catalog text index is not installed; exact seqid lookup remains available")
                library_clause = ""
                if library:
                    library_clause = " AND a.library_key=?"
                resolver = getattr(self, "alias_resolver", None)
                human_aligned = not library or library in {
                    "canonical_human", "human_current", "huprot4", "panscan9_human",
                    "panscan9_variant", "panscan9_dark",
                }
                expanded = (
                    resolver.expanded_terms(text, limit=16)
                    if resolver is not None and human_aligned
                    else {"terms": [text], "matches": [], "ambiguous": False}
                )
                terms = list(expanded["terms"])[:24] or [text]
                matches = list(expanded["matches"])
                canonical_genes = {
                    normalize_alias(row.get("canonical_gene") or row.get("display_gene"))
                    for row in matches
                    if row.get("canonical_gene") or row.get("display_gene")
                }
                canonical_accessions = {
                    normalize_alias(row.get("accession"))
                    for row in matches
                    if row.get("accession")
                }
                raw_normalized = normalize_alias(text)
                fetch_limit = min(MAX_JSON_ROWS, max(50, limit * 4))
                membership_join = ""
                membership_clause = ""
                membership_parameters: list[Any] = []
                if filters is not None:
                    membership = getattr(self, "membership", None)
                    assert membership is not None and library is not None
                    membership_uri = membership.database.as_uri() + "?mode=ro&immutable=1"
                    catalog.execute(
                        "ATTACH DATABASE ? AS analysis_filter", (membership_uri,)
                    )
                    predicate, membership_parameters = membership.sql_predicate(
                        library, filters, alias="m"
                    )
                    membership_join = (
                        " JOIN analysis_filter.antigen_membership m"
                        " ON m.antigen_id=a.antigen_id"
                    )
                    membership_clause = " AND " + predicate
                candidates: dict[int, tuple[tuple[Any, ...], sqlite3.Row]] = {}
                saw_exact = False
                for term_index, term in enumerate(terms):
                    exact_expression = _fts_expression(term, prefix=False)
                    exact_parameters: list[Any] = [exact_expression]
                    if library:
                        exact_parameters.append(library)
                    exact_parameters.extend(membership_parameters)
                    exact = bool(
                        catalog.execute(
                            f"""SELECT EXISTS(
                                SELECT 1 FROM antigen_fts
                                JOIN antigen a ON a.antigen_id=antigen_fts.rowid
                                {membership_join}
                                WHERE antigen_fts MATCH ?{library_clause}{membership_clause}
                                LIMIT 1)""",
                            exact_parameters,
                        ).fetchone()[0]
                    )
                    saw_exact = saw_exact or exact
                    expression = exact_expression if exact else _fts_expression(term, prefix=True)
                    parameters: list[Any] = [expression]
                    if library:
                        parameters.append(library)
                    parameters.extend(membership_parameters)
                    parameters.append(fetch_limit)
                    term_rows = catalog.execute(
                        f"""SELECT {','.join('a.' + column.strip() for column in ANTIGEN_COLUMNS.split(','))},
                                   bm25(antigen_fts) AS search_rank
                            FROM antigen_fts
                            JOIN antigen a ON a.antigen_id=antigen_fts.rowid
                            {membership_join}
                            WHERE antigen_fts MATCH ?{library_clause}{membership_clause}
                            ORDER BY search_rank,a.antigen_id LIMIT ?""",
                        parameters,
                    )
                    for row in term_rows:
                        fields = [normalize_alias(value) for value in str(row["seqid"]).split("|")]
                        gene_field = fields[1] if len(fields) > 1 else ""
                        accessions = {
                            value.split("=", 1)[1]
                            for value in fields
                            if value.startswith("UNIPROT=") and "=" in value
                        }
                        if len(fields) > 2 and "=" not in fields[2]:
                            accessions.add(fields[2])
                        if gene_field and gene_field in canonical_genes:
                            tier = 0
                        elif accessions & canonical_accessions:
                            tier = 1
                        elif raw_normalized in fields:
                            tier = 2
                        else:
                            tier = 3 if exact else 4
                        rank = (
                            tier,
                            term_index,
                            float(row["search_rank"]),
                            int(row["antigen_id"]),
                        )
                        identifier = int(row["antigen_id"])
                        if identifier not in candidates or rank < candidates[identifier][0]:
                            candidates[identifier] = (rank, row)
                annotation_sidecar = getattr(
                    getattr(self, "annotation_hydrator", None),
                    "annotation_sidecar",
                    None,
                )
                display_hits = []
                if annotation_sidecar is not None:
                    display_hits = annotation_sidecar.search_source_rows(
                        text,
                        [library] if library else sorted(self.library_keys),
                        limit=fetch_limit,
                    )
                    hit_by_key = {
                        (str(hit["library_key"]), int(hit["source_row"])): hit
                        for hit in display_hits
                    }
                    for library_key in sorted({key[0] for key in hit_by_key}):
                        source_rows = sorted(
                            source_row for candidate_library, source_row in hit_by_key
                            if candidate_library == library_key
                        )
                        for source_chunk in _chunks(source_rows):
                            placeholders = ",".join("?" for _ in source_chunk)
                            display_rows = catalog.execute(
                                f"""SELECT {ANTIGEN_COLUMNS} FROM antigen
                                    WHERE library_key=? AND source_row IN ({placeholders})""",
                                (library_key, *source_chunk),
                            )
                            for row in display_rows:
                                hit = hit_by_key[(library_key, int(row["source_row"]))]
                                rank = (
                                    3,
                                    len(terms),
                                    float(hit["search_rank"]),
                                    int(row["antigen_id"]),
                                )
                                identifier = int(row["antigen_id"])
                                if identifier not in candidates or rank < candidates[identifier][0]:
                                    candidates[identifier] = (rank, row)
                                    search_matches[identifier] = {
                                        "query": text,
                                        "match_kind": "display_annotation",
                                        "annotation_id": int(hit["annotation_id"]),
                                        "matched_protein": hit["protein"],
                                        "matched_description": hit["description"],
                                        "identity_authoritative": False,
                                    }
                if filters is not None and candidates:
                    membership = getattr(self, "membership", None)
                    assert membership is not None and library is not None
                    allowed_ids = membership.allowed_ids(library, candidates, filters)
                    candidates = {
                        identifier: candidate for identifier, candidate in candidates.items()
                        if identifier in allowed_ids
                    }
                    search_matches = {
                        identifier: match for identifier, match in search_matches.items()
                        if identifier in allowed_ids
                    }
                selected = sorted(candidates.values(), key=lambda item: item[0])
                selected = selected[:limit]
                rows = [row for _rank, row in selected]
                search_match_mode = (
                    "canonical_alias+display_annotation"
                    if matches and display_hits else
                    "canonical_alias" if matches else
                    "display_annotation" if display_hits else
                    "exact_token" if saw_exact else "prefix"
                )
                if matches:
                    ambiguous = bool(expanded["ambiguous"])
                    for row in rows:
                        fields = [normalize_alias(value) for value in str(row["seqid"]).split("|")]
                        gene_field = fields[1] if len(fields) > 1 else ""
                        row_accessions = {
                            value.split("=", 1)[1]
                            for value in fields
                            if value.startswith("UNIPROT=") and "=" in value
                        }
                        if len(fields) > 2 and "=" not in fields[2]:
                            row_accessions.add(fields[2])
                        chosen = next(
                            (
                                match for match in matches
                                if gene_field in {
                                    normalize_alias(match.get("canonical_gene")),
                                    normalize_alias(match.get("display_gene")),
                                }
                                or normalize_alias(match.get("accession")) in row_accessions
                            ),
                            None,
                        )
                        if chosen is None:
                            continue
                        search_matches[int(row["antigen_id"])] = {
                            "query": text,
                            "matched_alias": chosen["alias"],
                            "match_kind": "canonical_alias",
                            "canonical_gene": chosen["canonical_gene"],
                            "canonical_accession": chosen["accession"],
                            "ambiguous": ambiguous,
                        }
                mode = "fts"
            else:
                if filters is not None:
                    membership = getattr(self, "membership", None)
                    assert membership is not None and library is not None
                    membership_uri = membership.database.as_uri() + "?mode=ro&immutable=1"
                    catalog.execute(
                        "ATTACH DATABASE ? AS analysis_filter", (membership_uri,)
                    )
                    predicate, filter_parameters = membership.sql_predicate(
                        library, filters, alias="m"
                    )
                    parameters = [after_id, library, *filter_parameters, limit + 1]
                    rows = list(
                        catalog.execute(
                            f"""SELECT {','.join('a.' + column.strip() for column in ANTIGEN_COLUMNS.split(','))}
                                FROM antigen a
                                JOIN analysis_filter.antigen_membership m
                                  ON m.antigen_id=a.antigen_id
                                WHERE a.antigen_id>? AND a.library_key=? AND {predicate}
                                ORDER BY a.antigen_id LIMIT ?""",
                            parameters,
                        )
                    )
                else:
                    parameters = [after_id]
                    library_clause = ""
                    if library:
                        library_clause = " AND library_key=?"
                        parameters.append(library)
                    parameters.append(limit + 1)
                    rows = list(
                        catalog.execute(
                            f"""SELECT {ANTIGEN_COLUMNS} FROM antigen
                                WHERE antigen_id>?{library_clause}
                                ORDER BY antigen_id LIMIT ?""",
                            parameters,
                        )
                    )
                mode = "list"

        has_more = mode == "list" and len(rows) > limit
        if filters is not None and mode != "fts":
            membership = getattr(self, "membership", None)
            assert membership is not None and library is not None
            allowed_ids = membership.allowed_ids(
                library, (int(row["antigen_id"]) for row in rows), filters
            )
            rows = [row for row in rows if int(row["antigen_id"]) in allowed_ids]
        if has_more:
            rows = rows[:limit]
        antigens = []
        for row in rows:
            item = _antigen_payload(
                row,
                include_sequence=include_sequence,
                annotation_hydrator=self.annotation_hydrator,
            )
            if int(row["antigen_id"]) in search_matches:
                item["search_match"] = search_matches[int(row["antigen_id"])]
            antigens.append(item)
        return {
            "mode": mode,
            "search_match_mode": search_match_mode,
            "count": len(rows),
            "next_after_id": int(rows[-1]["antigen_id"]) if has_more and rows else None,
            "antigens": antigens,
        }

    def _edge_arguments(
        self,
        query: Mapping[str, list[str]],
        *,
        default_limit: int,
        maximum_limit: int,
    ) -> tuple[Comparison, int | None, int, int, int, int, int]:
        comparison = self._comparison(query)
        antigen_id = _integer(query, "antigen_id", minimum=1)
        minimum_identity = _integer(query, "min_identity", default=7, minimum=7, maximum=9)
        limit = _integer(query, "limit", default=default_limit, minimum=1, maximum=maximum_limit)
        after_a = _integer(query, "after_a", default=0, minimum=0)
        after_b = _integer(query, "after_b", default=0, minimum=0)
        after_partner = _integer(query, "after_partner", default=0, minimum=0)
        assert None not in (minimum_identity, limit, after_a, after_b, after_partner)
        if antigen_id is not None and (after_a or after_b):
            raise APIError(400, "Use after_partner, not after_a/after_b, with antigen_id")
        if antigen_id is None and after_partner:
            raise APIError(400, "after_partner requires antigen_id")
        return (
            comparison,
            antigen_id,
            int(minimum_identity),
            int(limit),
            int(after_a),
            int(after_b),
            int(after_partner),
        )

    @staticmethod
    def _select_edges(
        shard: sqlite3.Connection,
        *,
        antigen_id: int | None,
        minimum_identity: int,
        limit: int,
        after_a: int,
        after_b: int,
        after_partner: int,
    ) -> sqlite3.Cursor:
        if antigen_id is not None:
            return shard.execute(
                f"""SELECT {EDGE_COLUMNS},antigen_b AS partner_id FROM edge
                    WHERE antigen_a=? AND antigen_b>? AND best_identity>=?
                    UNION ALL
                    SELECT {EDGE_COLUMNS},antigen_a AS partner_id FROM edge
                    WHERE antigen_b=? AND antigen_a>? AND best_identity>=?
                    ORDER BY partner_id LIMIT ?""",
                (
                    antigen_id,
                    after_partner,
                    minimum_identity,
                    antigen_id,
                    after_partner,
                    minimum_identity,
                    limit,
                ),
            )
        return shard.execute(
            f"""SELECT {EDGE_COLUMNS} FROM edge
                WHERE (antigen_a>? OR (antigen_a=? AND antigen_b>?)) AND best_identity>=?
                ORDER BY antigen_a,antigen_b LIMIT ?""",
            (after_a, after_a, after_b, minimum_identity, limit),
        )

    def _edges(self, query: Mapping[str, list[str]]) -> dict[str, Any]:
        allowed = {
            "comparison", "antigen_id", "min_identity", "limit",
            "after_a", "after_b", "after_partner",
        }
        _reject_unknown(query, allowed)
        comparison, antigen_id, minimum_identity, limit, after_a, after_b, after_partner = (
            self._edge_arguments(query, default_limit=50, maximum_limit=MAX_JSON_ROWS)
        )
        with closing(_read_only_connection(self.catalog_path)) as catalog:
            if antigen_id is not None:
                query_record = _fetch_antigens(catalog, [antigen_id]).get(antigen_id)
                if query_record is None:
                    raise APIError(404, "Unknown antigen_id")
                if query_record["library_key"] not in {comparison.library_a, comparison.library_b}:
                    raise APIError(400, "antigen_id is not part of this comparison")
            with closing(_read_only_connection(self._shard_path(comparison))) as shard:
                self._assert_complete_shard(shard)
                rows = list(
                    self._select_edges(
                        shard,
                        antigen_id=antigen_id,
                        minimum_identity=minimum_identity,
                        limit=limit + 1,
                        after_a=after_a,
                        after_b=after_b,
                        after_partner=after_partner,
                    )
                )
            has_more = len(rows) > limit
            if has_more:
                rows = rows[:limit]
            antigens = _fetch_antigens(
                catalog,
                (value for row in rows for value in (row["antigen_a"], row["antigen_b"])),
            )
        if any(int(row[value]) not in antigens for row in rows for value in ("antigen_a", "antigen_b")):
            raise APIError(503, "Comparison references an antigen missing from the central catalog")
        next_cursor: dict[str, int] | None = None
        if has_more and rows:
            if antigen_id is not None:
                next_cursor = {"after_partner": int(rows[-1]["partner_id"])}
            else:
                next_cursor = {
                    "after_a": int(rows[-1]["antigen_a"]),
                    "after_b": int(rows[-1]["antigen_b"]),
                }
        return {
            "comparison": comparison.key,
            "stored_once": True,
            "query_antigen_id": antigen_id,
            "min_identity": minimum_identity,
            "count": len(rows),
            "next": next_cursor,
            "edges": [
                _edge_payload(
                    row,
                    antigens,
                    query_antigen=antigen_id,
                    annotation_hydrator=self.annotation_hydrator,
                ) for row in rows
            ],
        }

    def _pair(self, query: Mapping[str, list[str]]) -> dict[str, Any]:
        allowed = {
            "comparison", "antigen_a", "antigen_b", "floor",
            "include_matches", "max_matches",
        }
        _reject_unknown(query, allowed)
        comparison = self._comparison(query)
        requested_a = _integer(query, "antigen_a", minimum=1)
        requested_b = _integer(query, "antigen_b", minimum=1)
        floor = _integer(query, "floor", default=7, minimum=7, maximum=9)
        include_matches = _boolean(query, "include_matches", True)
        maximum = _integer(
            query, "max_matches", default=500, minimum=1, maximum=MAX_PAIR_MATCHES
        )
        if requested_a is None or requested_b is None:
            raise APIError(400, "Parameters 'antigen_a' and 'antigen_b' are required")
        if requested_a == requested_b:
            raise APIError(400, "A pair requires two distinct antigen IDs")
        assert floor is not None and maximum is not None
        canonical_a, canonical_b = sorted((requested_a, requested_b))

        with closing(_read_only_connection(self.catalog_path)) as catalog:
            records = _fetch_antigens(catalog, [requested_a, requested_b])
            if len(records) != 2:
                raise APIError(404, "One or both antigen IDs are unknown")
            library_a = records[requested_a]["library_key"]
            library_b = records[requested_b]["library_key"]
            if comparison.library_a == comparison.library_b:
                valid_pair = library_a == library_b == comparison.library_a
            else:
                valid_pair = {library_a, library_b} == {
                    comparison.library_a,
                    comparison.library_b,
                }
            if not valid_pair:
                raise APIError(400, "Antigens do not belong to the selected comparison")
            with closing(_read_only_connection(self._shard_path(comparison))) as shard:
                self._assert_complete_shard(shard)
                edge = shard.execute(
                    f"SELECT {EDGE_COLUMNS} FROM edge WHERE antigen_a=? AND antigen_b=?",
                    (canonical_a, canonical_b),
                ).fetchone()

        edge_payload = None
        if edge is not None:
            edge_payload = _edge_payload(
                edge,
                records,
                query_antigen=requested_a,
                annotation_hydrator=self.annotation_hydrator,
            )
        matches: list[dict[str, Any]] | None = None
        truncated = False
        aggregate_consistent: bool | None = None
        if include_matches:
            if edge is None or int(edge["best_identity"]) < floor:
                matches = []
            else:
                matches, truncated = _pair_matches(
                    records[requested_a]["sequence"],
                    records[requested_b]["sequence"],
                    floor=floor,
                    maximum=maximum,
                )
                if not truncated:
                    observed = {
                        identity: sum(match["identity"] >= identity for match in matches)
                        for identity in range(floor, 10)
                    }
                    aggregate_consistent = all(
                        observed[identity] == int(edge[f"n{identity}"])
                        for identity in range(floor, 10)
                    )
        return {
            "comparison": comparison.key,
            "antigen_a": _antigen_payload(
                records[requested_a], include_sequence=True,
                annotation_hydrator=self.annotation_hydrator,
            ),
            "antigen_b": _antigen_payload(
                records[requested_b], include_sequence=True,
                annotation_hydrator=self.annotation_hydrator,
            ),
            "edge": edge_payload,
            "match_floor": floor,
            "matches": matches,
            "matches_truncated": truncated,
            "aggregate_consistent": aggregate_consistent,
        }

    def _export_csv(
        self,
        handler: Any,
        query: Mapping[str, list[str]],
        *,
        head_only: bool,
    ) -> None:
        allowed = {
            "comparison", "antigen_id", "min_identity", "limit",
            "after_a", "after_b", "after_partner",
        }
        _reject_unknown(query, allowed)
        comparison, antigen_id, minimum_identity, limit, after_a, after_b, after_partner = (
            self._edge_arguments(
                query, default_limit=100_000, maximum_limit=MAX_EXPORT_ROWS
            )
        )
        with closing(_read_only_connection(self._shard_path(comparison))) as shard:
            self._assert_complete_shard(shard)
            cursor = self._select_edges(
                shard,
                antigen_id=antigen_id,
                minimum_identity=minimum_identity,
                limit=limit,
                after_a=after_a,
                after_b=after_b,
                after_partner=after_partner,
            )
            handler.send_response(200)
            handler.send_header("Content-Type", "text/csv; charset=utf-8")
            handler.send_header(
                "Content-Disposition", f'attachment; filename="{comparison.key}-edges.csv"'
            )
            handler.send_header("X-Export-Row-Limit", str(limit))
            handler.send_header("Connection", "close")
            handler.end_headers()
            handler.close_connection = True
            if head_only:
                return

            columns = [
                "comparison", "antigen_a", "library_a", "seqid_a",
                "antigen_b", "library_b", "seqid_b", "best_identity",
                "n7", "n8", "n9", "a_windows_m7", "a_windows_m8",
                "a_windows_m9", "b_windows_m7", "b_windows_m8", "b_windows_m9",
            ]
            buffer = io.StringIO()
            writer = csv.writer(buffer, lineterminator="\n")
            writer.writerow(columns)
            handler.wfile.write(buffer.getvalue().encode("utf-8"))
            with closing(_read_only_connection(self.catalog_path)) as catalog:
                while True:
                    rows = cursor.fetchmany(500)
                    if not rows:
                        break
                    antigens = _fetch_antigens(
                        catalog,
                        (value for row in rows for value in (row["antigen_a"], row["antigen_b"])),
                    )
                    if any(
                        int(row[value]) not in antigens
                        for row in rows
                        for value in ("antigen_a", "antigen_b")
                    ):
                        raise APIError(503, "Comparison references a missing antigen")
                    buffer = io.StringIO()
                    writer = csv.writer(buffer, lineterminator="\n")
                    for row in rows:
                        aid_a, aid_b = int(row["antigen_a"]), int(row["antigen_b"])
                        record_a, record_b = antigens[aid_a], antigens[aid_b]
                        writer.writerow(
                            [
                                comparison.key,
                                aid_a,
                                record_a["library_key"],
                                record_a["seqid"],
                                aid_b,
                                record_b["library_key"],
                                record_b["seqid"],
                                row["best_identity"],
                                row["n7"],
                                row["n8"],
                                row["n9"],
                                row["a_windows_m7"],
                                row["a_windows_m8"],
                                row["a_windows_m9"],
                                row["b_windows_m7"],
                                row["b_windows_m8"],
                                row["b_windows_m9"],
                            ]
                        )
                    handler.wfile.write(buffer.getvalue().encode("utf-8"))


__all__ = ["AnalysisAPI", "AnalysisConfigurationError"]
