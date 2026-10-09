"""Strict immutable loader for the frozen MimicryMap r3 parent catalog."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path, PureWindowsPath
from typing import Any, Iterable, Mapping

SCHEMA = "mimicryone/canonical-parent-catalog/1"
VALIDATION_SCHEMA = "mimicryone/canonical-parent-catalog-validation/1"
RELEASE_ID = "mimicryone-canonical-parent-catalog-v1-r3"
PARENT_RELEASE_ID = "mimicryone_panscan9_3B04D688_20260831_r3"
SOURCE_RELEASE = "PanScan9_3B04D688_20260831"
DATABASE_NAME = "canonical_parent_catalog_v1.sqlite"
MANIFEST_NAME, VALIDATION_NAME = "MANIFEST.json", "VALIDATION.json"
APPLICATION_ID, USER_VERSION = 1_295_077_443, 1
PARENT_KEY_RE = re.compile(r"^(P9P|M1E)[0-9]{9}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
NAMESPACES = frozenset({"P9P", "M1E"})
PARENT_CLASSES = frozenset({"human_canonical", "immune_constant",
    "optional_receptor_germline", "exposure_canonical", "exposure_supplement"})
CLASS_CONTRACT = {
    "human_canonical": ("Human", "P9P"),
    "immune_constant": ("Human", "P9P"),
    "optional_receptor_germline": ("Human", "P9P"),
    "exposure_canonical": ("Exposure", "P9P"),
    "exposure_supplement": ("Exposure", "M1E"),
}
BOOLEAN_COLUMNS = ("include_default", "analysis_only",
    "optional_receptor_germline", "assay_interference_prone")
PUBLISHED_COUNTS = {
    "constants_enabled": 21, "default_no_projection": 52,
    "default_total": 29_390, "exposure_base_default_no_projection": 13,
    "exposure_default": 8_827, "exposure_total": 8_827,
    "human_default": 20_563, "human_default_no_projection": 23,
    "human_total": 20_939, "m1e_supplements": 16,
    "optional_receptor_germline": 376, "selected_total": 29_766,
    "supplement_default_no_projection": 16,
}
PUBLISHED_CONTRACT = {**PUBLISHED_COUNTS, "full_fasta_total": 288_136,
    "global_default_total": 287_760, "p9p_total": 288_120,
    "parent_release_id": PARENT_RELEASE_ID, "source_release": SOURCE_RELEASE,
    "supplement_targets": 18, "supplements_appended": 16,
    "supplements_existing": 2}
INPUT_DIGESTS = {
    "exposure_csv": ("exposure_all.csv.gz", 665_481,
        "28955bb727fc2c4ec246a86433a356a1befe7cfdffb186e00bfaff4ba2fbc81b"),
    "fasta": ("mimicryone_parents_all.fasta.gz", 15_170_618,
        "8743502b01f29a73031626a1b0a0226edd92ec85ee9f7a7a5fe757657dca2b72"),
    "human_csv": ("human_all.csv.gz", 1_532_205,
        "e335e1a556b2e9261f96772f099a839b30979cfe8e159219405288c8f25c9c56"),
    "parent_manifest": ("parent_release_manifest.json", 7_354,
        "9e6ce2e529bb4396505a1e934a3d8996fed3d8341578823e9e1a3bbb6b638acd"),
}
PARENT_INPUT_HASHES = {
    "companion_fasta": "9913d8b86aa8585f1d45031cf7fe95101077f9d3f6a98836c275e42d42d9888c",
    "immune_roster": "e1aa6c6fa2acada56bcc5f563cd53cacb39e9c38605a1bd42d18b753a149bd92",
    "parent_map": "f07b1ec745d52cb4616ad41d8ea20d6356960a183f73ff36eeec9d597b1b7be9",
    "restoration_audit": "930205e71247fd94eea66d26f72ff67ddb14435b1ebdcf9ed8319ff1195a7914",
    "source_parent_fasta": "a61c3f7787bf3d49a5c3d24fa27e174037f47d4853f61c6cca123e4e1d0509b9",
}
CANONICAL_PARENT_COLUMNS = (
    "parent_key", "id_namespace", "parent_class", "accession", "original_header",
    "canonical_header", "source_partition", "organism", "gene", "protein_name",
    "record_type", "sequence", "sequence_length", "sequence_sha256",
    "mapped_tile_count", "mapping_rows", "source_sublibraries", "target_types",
    "relationship_classes", "mapping_statuses", "include_default",
    "immune_region_class", "immune_roster_category", "analysis_only",
    "optional_receptor_germline", "assay_interference_prone", "interference_flag",
    "interference_note", "source_kind", "source_release", "source_url")
INTEGER_COLUMNS = frozenset({"sequence_length", "mapped_tile_count", "mapping_rows",
    *BOOLEAN_COLUMNS})
COLUMN_SIGNATURE = tuple((name, "INTEGER" if name in INTEGER_COLUMNS else "TEXT",
    1, int(name == "parent_key")) for name in CANONICAL_PARENT_COLUMNS)
EXPECTED_TABLES = frozenset({"canonical_parent", "metadata", "parent_alias",
    "parent_search", "parent_search_config", "parent_search_content",
    "parent_search_data", "parent_search_docsize", "parent_search_idx", "sqlite_stat1"})
EXPECTED_INDEXES = frozenset({"canonical_parent_accession", "canonical_parent_gene",
    "canonical_parent_policy", "canonical_parent_projection",
    "sqlite_autoindex_canonical_parent_2"})
EXPECTED_METADATA = {"identity_contract":
    "parent_key is immutable; P9P and M1E namespaces are distinct",
    "parent_release_id": PARENT_RELEASE_ID, "release_id": RELEASE_ID, "schema": SCHEMA}
EXPECTED_CHECKS = {"alias_rows": 29_766, "application_id": APPLICATION_ID,
    "constants_enabled": 21, "default_no_projection": 52, "default_total": 29_390,
    "duplicate_parent_keys": 0, "exposure_total": 8_827,
    "foreign_key_failures": 0, "fts_rows": 29_766, "human_total": 20_939,
    "iglc2_searchable_rows": 1, "m1e_supplements": 16,
    "metadata_release_id": RELEASE_ID, "metadata_schema": SCHEMA,
    "optional_receptor_germline": 376, "selected_total": 29_766,
    "sequence_hash_failures": 0, "sqlite_integrity_check": "ok", "user_version": 1}


class CanonicalParentCatalogError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CanonicalParentCatalogError(message)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CanonicalParentCatalogError(f"invalid {path.name}: {error}") from error
    _require(isinstance(value, dict), f"{path.name} must contain an object")
    return value


def _mapping(value: object, context: str) -> Mapping[str, Any]:
    _require(isinstance(value, Mapping), f"{context} must be an object")
    return value


def _limit(value: object, maximum: int = 500) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("limit must be an integer") from error
    if number < 1 or number > maximum:
        raise ValueError(f"limit must be between 1 and {maximum}")
    return number


def _offset(value: object) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("offset must be an integer") from error
    if number < 0:
        raise ValueError("offset must be non-negative")
    return number


class CanonicalParentCatalog:
    def __init__(self, release: str | Path):
        requested = Path(release).resolve()
        if requested.is_dir():
            self.root, self.database = requested, requested / DATABASE_NAME
        elif requested.is_file():
            _require(requested.name == DATABASE_NAME, f"database must be {DATABASE_NAME}")
            self.root, self.database = requested.parent, requested
        else:
            raise FileNotFoundError(requested)
        self.manifest_path = self.root / MANIFEST_NAME
        self.validation_path = self.root / VALIDATION_NAME
        for path in (self.database, self.manifest_path, self.validation_path):
            if not path.is_file():
                raise FileNotFoundError(path)
        self.manifest, self.validation = _json(self.manifest_path), _json(self.validation_path)
        self._validate_package()

    def connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database.as_uri() + "?mode=ro&immutable=1", uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        return connection

    @staticmethod
    def _input_digests(value: object, context: str) -> None:
        # Frozen provenance can contain Windows or POSIX paths on either host.
        observed = _mapping(value, context)
        _require(set(observed) == set(INPUT_DIGESTS), f"{context} keys differ")
        for key, (name, size, digest) in INPUT_DIGESTS.items():
            spec = _mapping(observed[key], f"{context}.{key}")
            _require(PureWindowsPath(str(spec.get("path", ""))).name == name,
                     f"{context}.{key} filename differs")
            _require(spec.get("bytes") == size and str(spec.get("sha256", "")).lower() == digest,
                     f"{context}.{key} digest contract differs")

    def _output_file(self, path: Path, value: object, name: str, context: str) -> str:
        spec = _mapping(value, context)
        _require(PureWindowsPath(str(spec.get("path", ""))).name == name, f"{context} filename differs")
        _require(type(spec.get("bytes")) is int and spec["bytes"] == path.stat().st_size,
                 f"{context} byte count differs")
        expected = str(spec.get("sha256", "")).lower()
        _require(SHA256_RE.fullmatch(expected) is not None, f"{context} sha256 invalid")
        actual = _sha256(path)
        _require(expected == actual, f"{context} sha256 differs")
        return actual

    def _validate_package(self) -> None:
        m, v = self.manifest, self.validation
        _require(m.get("schema") == SCHEMA and m.get("status") == "PASS", "manifest contract differs")
        _require(m.get("release_id") == RELEASE_ID and
                 m.get("parent_release_id") == PARENT_RELEASE_ID and
                 m.get("source_release") == SOURCE_RELEASE, "manifest release binding differs")
        _require(m.get("scope") == ["Human", "Exposure"], "manifest scope differs")
        _require(m.get("identity") == {"key": "parent_key", "namespace_is_immutable": True,
                 "namespaces": ["P9P", "M1E"]}, "manifest identity differs")
        _require(m.get("counts") == PUBLISHED_COUNTS and
                 m.get("contract") == PUBLISHED_CONTRACT, "manifest counts differ")
        self._input_digests(m.get("input_digests"), "manifest.input_digests")
        _require(m.get("parent_manifest_input_hashes") == PARENT_INPUT_HASHES,
                 "parent input hashes differ")
        outputs = _mapping(m.get("outputs"), "manifest.outputs")
        database_hash = self._output_file(self.database, outputs.get("database"),
                                          DATABASE_NAME, "manifest.outputs.database")
        validation_hash = self._output_file(self.validation_path, outputs.get("validation"),
                                            VALIDATION_NAME, "manifest.outputs.validation")
        _require(v.get("schema") == VALIDATION_SCHEMA and v.get("status") == "PASS" and
                 v.get("failures") == [], "validation status differs")
        _require(v.get("release_id") == RELEASE_ID and
                 v.get("parent_release_id") == PARENT_RELEASE_ID, "validation release differs")
        _require(v.get("counts") == PUBLISHED_COUNTS and
                 v.get("checks") == EXPECTED_CHECKS, "validation counts/checks differ")
        self._input_digests(v.get("input_digests"), "validation.input_digests")
        validation_output = _mapping(v.get("output"), "validation.output")
        _require(PureWindowsPath(str(validation_output.get("path", ""))).name == DATABASE_NAME and
                 validation_output.get("bytes") == self.database.stat().st_size and
                 str(validation_output.get("sha256", "")).lower() == database_hash,
                 "validation output binding differs")
        self.database_sha256, self.validation_sha256 = database_hash, validation_hash
        self._validate_sqlite()

    def _validate_sqlite(self) -> None:
        with closing(self.connection()) as connection:
            _require(connection.execute("PRAGMA application_id").fetchone()[0] == APPLICATION_ID,
                     "application_id differs")
            _require(connection.execute("PRAGMA user_version").fetchone()[0] == USER_VERSION,
                     "user_version differs")
            _require(connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok",
                     "integrity_check failed")
            _require(connection.execute("PRAGMA foreign_key_check").fetchall() == [],
                     "foreign_key_check failed")
            tables = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            indexes = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='index'")}
            _require(tables == EXPECTED_TABLES, "table set differs")
            _require(indexes == EXPECTED_INDEXES, "index set differs")
            _require(connection.execute("SELECT name FROM sqlite_master WHERE type='view'").fetchall() == [],
                     "views are not allowed")
            _require(connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall() == [],
                     "triggers are not allowed")
            signature = tuple((str(r[1]), str(r[2]).upper(), int(r[3]), int(r[5]))
                for r in connection.execute("PRAGMA table_info(canonical_parent)"))
            _require(signature == COLUMN_SIGNATURE, "canonical_parent columns differ")
            _require(tuple(r[1] for r in connection.execute("PRAGMA table_info(metadata)")) ==
                     ("key", "value"), "metadata columns differ")
            _require(tuple(r[1] for r in connection.execute("PRAGMA table_info(parent_alias)")) ==
                     ("parent_key", "aliases"), "parent_alias columns differ")
            _require(tuple(r[1] for r in connection.execute("PRAGMA table_xinfo(parent_search)")) ==
                     ("parent_key", "accession", "gene", "protein_name", "organism",
                      "aliases", "parent_search", "rank"), "parent_search columns differ")
            _require(dict(connection.execute("SELECT key,value FROM metadata")) == EXPECTED_METADATA,
                     "metadata rows differ")
            queries = {
                "selected_total": "SELECT count(*) FROM canonical_parent",
                "default_total": "SELECT count(*) FROM canonical_parent WHERE include_default=1",
                "optional_receptor_germline": "SELECT count(*) FROM canonical_parent WHERE optional_receptor_germline=1",
                "constants_enabled": "SELECT count(*) FROM canonical_parent WHERE parent_class='immune_constant' AND include_default=1",
                "m1e_supplements": "SELECT count(*) FROM canonical_parent WHERE id_namespace='M1E'",
                "human_total": "SELECT count(*) FROM canonical_parent WHERE source_partition='Human'",
                "human_default": "SELECT count(*) FROM canonical_parent WHERE source_partition='Human' AND include_default=1",
                "exposure_total": "SELECT count(*) FROM canonical_parent WHERE source_partition='Exposure'",
                "exposure_default": "SELECT count(*) FROM canonical_parent WHERE source_partition='Exposure' AND include_default=1",
                "default_no_projection": "SELECT count(*) FROM canonical_parent WHERE include_default=1 AND mapped_tile_count=0",
                "human_default_no_projection": "SELECT count(*) FROM canonical_parent WHERE source_partition='Human' AND include_default=1 AND mapped_tile_count=0",
                "exposure_base_default_no_projection": "SELECT count(*) FROM canonical_parent WHERE source_partition='Exposure' AND id_namespace='P9P' AND include_default=1 AND mapped_tile_count=0",
                "supplement_default_no_projection": "SELECT count(*) FROM canonical_parent WHERE id_namespace='M1E' AND include_default=1 AND mapped_tile_count=0",
            }
            observed = {key: int(connection.execute(sql).fetchone()[0])
                        for key, sql in queries.items()}
            _require(observed == PUBLISHED_COUNTS, "SQLite published counts differ")
            _require(connection.execute("SELECT count(*) FROM parent_alias").fetchone()[0] == 29_766,
                     "alias count differs")
            _require(connection.execute("SELECT count(*) FROM parent_search").fetchone()[0] == 29_766,
                     "FTS count differs")
            _require(connection.execute("SELECT count(*) FROM parent_search "
                     "WHERE parent_search MATCH 'IGLC2'").fetchone()[0] == 1,
                     "IGLC2 FTS contract differs")
            for row in connection.execute(
                "SELECT parent_key,id_namespace,parent_class,source_partition,include_default,"
                "analysis_only,optional_receptor_germline,assay_interference_prone "
                "FROM canonical_parent"):
                self._validate_identity_policy(dict(row))
            _require(connection.execute("SELECT count(*) FROM canonical_parent "
                     "WHERE id_namespace='M1E' AND assay_interference_prone=1").fetchone()[0] == 13,
                     "M1E interference count differs")

    @staticmethod
    def _validate_identity_policy(row: Mapping[str, Any]) -> None:
        key = row.get("parent_key")
        match = PARENT_KEY_RE.fullmatch(key) if isinstance(key, str) else None
        _require(match is not None, "invalid parent_key")
        namespace, parent_class = row.get("id_namespace"), row.get("parent_class")
        _require(namespace in NAMESPACES and namespace == match.group(1),
                 f"namespace differs for {key}")
        _require(parent_class in PARENT_CLASSES, f"class differs for {key}")
        partition, class_namespace = CLASS_CONTRACT[parent_class]
        _require(row.get("source_partition") == partition and namespace == class_namespace,
                 f"class/partition differs for {key}")
        for column in BOOLEAN_COLUMNS:
            _require(type(row.get(column)) is int and row[column] in (0, 1),
                     f"{column} is not boolean for {key}")
        optional = row["optional_receptor_germline"]
        _require(optional == int(parent_class == "optional_receptor_germline") and
                 row["include_default"] == (0 if optional else 1),
                 f"visibility policy differs for {key}")
        if namespace == "M1E":
            _require(row["analysis_only"] == 1, f"M1E analysis policy differs for {key}")

    def _validated_row(self, row: sqlite3.Row | Mapping[str, Any]) -> dict[str, Any]:
        output = dict(row)
        missing = set(CANONICAL_PARENT_COLUMNS) - set(output)
        _require(not missing, "row is missing: " + ", ".join(sorted(missing)))
        self._validate_identity_policy(output)
        key, sequence = output["parent_key"], output["sequence"]
        _require(isinstance(sequence, str) and sequence and
                 type(output["sequence_length"]) is int and output["sequence_length"] > 0 and
                 len(sequence) == output["sequence_length"], f"sequence length differs for {key}")
        try:
            digest = hashlib.sha256(sequence.encode("ascii")).hexdigest()
        except UnicodeEncodeError as error:
            raise CanonicalParentCatalogError(f"sequence is not ASCII for {key}") from error
        _require(output["sequence_sha256"] == digest, f"sequence sha256 differs for {key}")
        _require(type(output["mapped_tile_count"]) is int and output["mapped_tile_count"] >= 0 and
                 type(output["mapping_rows"]) is int and output["mapping_rows"] >= 0,
                 f"mapping counts differ for {key}")
        if output["id_namespace"] == "M1E":
            _require(output["mapped_tile_count"] == 0, f"M1E projection differs for {key}")
        return output

    @staticmethod
    def _allowed(row: Mapping[str, Any], include_optional: bool) -> bool:
        return bool(row["include_default"]) or (
            include_optional and bool(row["optional_receptor_germline"]))

    def resolve_canonical_parent(self, parent_key: object) -> dict[str, Any] | None:
        """Resolve an exact identity, including optional receptor-germline rows."""
        key = str(parent_key or "").strip()
        if PARENT_KEY_RE.fullmatch(key) is None:
            return None
        with closing(self.connection()) as connection:
            row = connection.execute("SELECT * FROM canonical_parent WHERE parent_key=?",
                                     (key,)).fetchone()
        return None if row is None else self._validated_row(row)

    def get(self, parent_key: object, *,
            include_receptor_germline: bool = False) -> dict[str, Any] | None:
        row = self.resolve_canonical_parent(parent_key)
        return row if row is not None and self._allowed(row, include_receptor_germline) else None

    def rows_by_keys(self, parent_keys: Iterable[object], *,
                     include_receptor_germline: bool = False) -> list[dict[str, Any]]:
        keys, seen = [], set()
        for value in parent_keys:
            key = str(value or "").strip()
            if PARENT_KEY_RE.fullmatch(key) is None:
                raise ValueError(f"invalid canonical parent key: {key!r}")
            if key not in seen:
                seen.add(key); keys.append(key)
        found: dict[str, dict[str, Any]] = {}
        with closing(self.connection()) as connection:
            for start in range(0, len(keys), 700):
                chunk = keys[start:start + 700]
                if chunk:
                    for row in connection.execute("SELECT * FROM canonical_parent WHERE parent_key IN ("
                            + ",".join("?" for _ in chunk) + ")", chunk):
                        item = self._validated_row(row); found[item["parent_key"]] = item
        return [found[key] for key in keys if key in found and
                self._allowed(found[key], include_receptor_germline)]

    def rows_by_accessions(self, accessions: Iterable[object], *,
                           include_receptor_germline: bool = False) -> list[dict[str, Any]]:
        values = sorted({str(value or "").strip() for value in accessions
                         if str(value or "").strip()})
        if len(values) > 5_000:
            raise ValueError("too many accessions")
        output = []
        with closing(self.connection()) as connection:
            for start in range(0, len(values), 700):
                chunk = values[start:start + 700]
                if chunk:
                    for row in connection.execute("SELECT * FROM canonical_parent WHERE accession IN ("
                            + ",".join("?" for _ in chunk) + ") ORDER BY parent_key", chunk):
                        item = self._validated_row(row)
                        if self._allowed(item, include_receptor_germline): output.append(item)
        return sorted(output, key=lambda item: item["parent_key"])

    @staticmethod
    def _selection(*, include_receptor_germline: bool,
                   source_partition: str | None, parent_class: str | None,
                   alias: str = "") -> tuple[list[str], list[Any]]:
        prefix = f"{alias}." if alias else ""
        if source_partition is not None and source_partition not in {"Human", "Exposure"}:
            raise ValueError("source_partition must be Human or Exposure")
        if parent_class is not None and parent_class not in PARENT_CLASSES:
            raise ValueError("unsupported parent_class")
        conditions = [(f"({prefix}include_default=1 OR "
                       f"{prefix}optional_receptor_germline=1)")
                      if include_receptor_germline else f"{prefix}include_default=1"]
        parameters: list[Any] = []
        if source_partition is not None:
            conditions.append(f"{prefix}source_partition=?"); parameters.append(source_partition)
        if parent_class is not None:
            conditions.append(f"{prefix}parent_class=?"); parameters.append(parent_class)
        return conditions, parameters

    def list_rows(self, *, include_receptor_germline: bool = False,
                  source_partition: str | None = None,
                  parent_class: str | None = None, limit: int = 100,
                  offset: int = 0) -> list[dict[str, Any]]:
        conditions, parameters = self._selection(
            include_receptor_germline=include_receptor_germline,
            source_partition=source_partition, parent_class=parent_class)
        with closing(self.connection()) as connection:
            rows = connection.execute("SELECT * FROM canonical_parent WHERE "
                + " AND ".join(conditions) + " ORDER BY parent_key LIMIT ? OFFSET ?",
                [*parameters, _limit(limit), _offset(offset)]).fetchall()
        return [self._validated_row(row) for row in rows]

    def default_no_projection_rows(self) -> list[dict[str, Any]]:
        """Return the exact frozen r3 canonical-overlay census."""

        with closing(self.connection()) as connection:
            rows = connection.execute(
                """SELECT * FROM canonical_parent
                   WHERE include_default=1
                     AND mapped_tile_count=0
                     AND optional_receptor_germline=0
                   ORDER BY parent_key"""
            ).fetchall()
        output = [self._validated_row(row) for row in rows]
        observed = {
            "total": len(output),
            "Human": sum(row["source_partition"] == "Human" for row in output),
            "Exposure": sum(row["source_partition"] == "Exposure" for row in output),
        }
        expected = {
            "total": PUBLISHED_COUNTS["default_no_projection"],
            "Human": PUBLISHED_COUNTS["human_default_no_projection"],
            "Exposure": (
                PUBLISHED_COUNTS["exposure_base_default_no_projection"]
                + PUBLISHED_COUNTS["supplement_default_no_projection"]
            ),
        }
        _require(observed == expected,
                 "default no-projection canonical-parent census differs")
        _require(all(
            row["include_default"] == 1
            and row["mapped_tile_count"] == 0
            and row["optional_receptor_germline"] == 0
            for row in output
        ), "default no-projection canonical-parent policy differs")
        return output

    def search_rows(self, sanitized_expression: object, *,
                    include_receptor_germline: bool = False,
                    source_partition: str | None = None,
                    parent_class: str | None = None, limit: int = 25,
                    offset: int = 0) -> list[dict[str, Any]]:
        """Execute a caller-sanitized FTS5 expression under visibility policy."""
        expression = str(sanitized_expression or "").strip()
        if not expression or len(expression) > 4_096 or "\x00" in expression:
            raise ValueError("sanitized FTS expression is empty or too long")
        conditions, parameters = self._selection(
            include_receptor_germline=include_receptor_germline,
            source_partition=source_partition, parent_class=parent_class, alias="c")
        sql = ("SELECT c.*,bm25(parent_search) AS search_rank FROM parent_search "
               "JOIN canonical_parent c USING(parent_key) WHERE parent_search MATCH ? AND "
               + " AND ".join(conditions)
               + " ORDER BY search_rank,c.parent_key LIMIT ? OFFSET ?")
        try:
            with closing(self.connection()) as connection:
                rows = connection.execute(sql, [expression, *parameters,
                    _limit(limit), _offset(offset)]).fetchall()
        except sqlite3.OperationalError as error:
            raise ValueError("invalid caller-sanitized FTS5 expression") from error
        return [self._validated_row(row) for row in rows]

    def capabilities(self) -> dict[str, Any]:
        return {"available": True, "schema": SCHEMA, "release_id": RELEASE_ID,
            "parent_release_id": PARENT_RELEASE_ID, "source_release": SOURCE_RELEASE,
            "database_sha256": self.database_sha256,
            "validation_sha256": self.validation_sha256,
            "identity": {"key": "parent_key", "namespaces": ["P9P", "M1E"],
                         "immutable": True},
            "counts": dict(PUBLISHED_COUNTS),
            "policy": {"default": "include_default=1",
                "optional_receptor_germline": "explicit opt-in only",
                "static_7": "mapped_tile_count>0",
                "bounded_live_7": "mapped_tile_count=0 with full validated sequence"},
            "search": {"engine": "FTS5 unicode61 remove_diacritics 2",
                       "expression": "caller-sanitized FTS5 expression"},
            "bindings": {"analysis_release_fingerprint": None,
                         "explorer_release_fingerprint": None,
                         "external_runtime_binding_required": True}}


__all__ = ["APPLICATION_ID", "CanonicalParentCatalog",
    "CanonicalParentCatalogError", "DATABASE_NAME", "PARENT_KEY_RE",
    "PARENT_RELEASE_ID", "PUBLISHED_COUNTS", "RELEASE_ID", "SCHEMA",
    "SOURCE_RELEASE", "USER_VERSION", "VALIDATION_SCHEMA"]
