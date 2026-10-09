"""Validate optional Explorer-to-analysis record references across release roots."""

from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, Mapping

from _explorer_api_base import read_only_connection


CROSSWALK_SCHEMA = "mimicryone/explorer-analysis-crosswalk/1"
CROSSWALK_TABLE = "analysis_record_crosswalk"
VERIFICATION_METHOD = "source_row+exact_sequence_sha256"
CROSSWALK_COLUMNS = (
    "schema",
    "portable_id",
    "analysis_release_fingerprint",
    "analysis_library_key",
    "analysis_antigen_id",
    "analysis_source_row",
    "sequence_sha256",
    "verification_method",
)
CROSSWALK_DDL = f"""
CREATE TABLE {CROSSWALK_TABLE}(
    schema TEXT NOT NULL CHECK(schema='{CROSSWALK_SCHEMA}'),
    portable_id TEXT PRIMARY KEY REFERENCES protein(portable_id),
    analysis_release_fingerprint TEXT NOT NULL,
    analysis_library_key TEXT NOT NULL,
    analysis_antigen_id INTEGER NOT NULL CHECK(analysis_antigen_id > 0),
    analysis_source_row INTEGER NOT NULL CHECK(analysis_source_row > 0),
    sequence_sha256 TEXT NOT NULL,
    verification_method TEXT NOT NULL CHECK(verification_method='{VERIFICATION_METHOD}'),
    UNIQUE(analysis_library_key, analysis_antigen_id)
) WITHOUT ROWID
""".strip()
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def _chunks(values: list[int], size: int = 700) -> Iterable[list[int]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


class ExplorerAnalysisCrosswalk:
    """Load only references proven identical in both immutable child releases."""

    def __init__(
        self,
        component_key: str,
        explorer_component: Any,
        analysis_component: Any,
    ) -> None:
        self.component_key = component_key
        self.explorer_database = Path(explorer_component.database)
        self.analysis_database = Path(analysis_component.catalog_path)
        self.analysis_release_fingerprint = str(
            analysis_component.manifest.get("release_fingerprint") or ""
        )
        self.analysis_libraries = frozenset(
            str(value) for value in analysis_component.library_keys
        )
        self.available = False
        self._references: dict[str, dict[str, Any]] = {}
        self._analysis_ids_by_library: dict[str, dict[int, str]] = {}
        self._record_identities: dict[tuple[str, int], dict[str, Any]] = {}
        self._representations: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        with closing(read_only_connection(self.explorer_database)) as explorer:
            exists = explorer.execute(
                "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?",
                (CROSSWALK_TABLE,),
            ).fetchone()
            if exists is None:
                return
            columns = tuple(
                str(row["name"])
                for row in explorer.execute(f"PRAGMA table_info({CROSSWALK_TABLE})")
            )
            if columns != CROSSWALK_COLUMNS:
                raise ValueError(
                    f"Explorer analysis crosswalk columns differ for component {self.component_key!r}"
                )
            stored_count = int(
                explorer.execute(f"SELECT count(*) FROM {CROSSWALK_TABLE}").fetchone()[0]
            )
            protein_columns = {str(row["name"]) for row in explorer.execute("PRAGMA table_info(protein)")}
            kind_column = "p.parent_kind" if "parent_kind" in protein_columns else "''"
            rows = [
                dict(row)
                for row in explorer.execute(
                    f"""SELECT x.*, p.sequence_sha256 AS explorer_sequence_sha256,
                               {kind_column} AS parent_kind
                        FROM {CROSSWALK_TABLE} x
                        JOIN protein p ON p.portable_id=x.portable_id
                        ORDER BY x.portable_id"""
                )
            ]
        if stored_count != len(rows):
            raise ValueError(
                f"Explorer analysis crosswalk has orphan records for component {self.component_key!r}"
            )
        if not SHA256_RE.fullmatch(self.analysis_release_fingerprint):
            raise ValueError(
                f"Analysis release fingerprint is invalid for component {self.component_key!r}"
            )

        identifiers = [int(row["analysis_antigen_id"]) for row in rows]
        analysis_rows: dict[int, Mapping[str, Any]] = {}
        with closing(read_only_connection(self.analysis_database)) as analysis:
            analysis_counts = dict(analysis.execute("SELECT library_key,count(*) FROM antigen GROUP BY library_key"))
            for chunk in _chunks(identifiers):
                placeholders = ",".join("?" for _ in chunk)
                for row in analysis.execute(
                    "SELECT antigen_id,library_key,source_row,sequence_sha256 "
                    f"FROM antigen WHERE antigen_id IN ({placeholders})",
                    chunk,
                ):
                    analysis_rows[int(row["antigen_id"])] = row

        references: dict[str, dict[str, Any]] = {}
        for row in rows:
            portable_id = str(row["portable_id"])
            fingerprint = str(row["analysis_release_fingerprint"])
            library = str(row["analysis_library_key"])
            antigen_id = int(row["analysis_antigen_id"])
            source_row = int(row["analysis_source_row"])
            sequence_sha256 = str(row["sequence_sha256"])
            analysis_row = analysis_rows.get(antigen_id)
            valid = (
                row["schema"] == CROSSWALK_SCHEMA
                and row["verification_method"] == VERIFICATION_METHOD
                and fingerprint == self.analysis_release_fingerprint
                and library in self.analysis_libraries
                and SHA256_RE.fullmatch(sequence_sha256) is not None
                and str(row["explorer_sequence_sha256"]) == sequence_sha256
                and analysis_row is not None
                and str(analysis_row["library_key"]) == library
                and int(analysis_row["source_row"]) == source_row
                and str(analysis_row["sequence_sha256"]) == sequence_sha256
            )
            if not valid:
                raise ValueError(
                    f"Explorer analysis crosswalk verification failed for "
                    f"{self.component_key!r}:{portable_id}"
                )
            references[portable_id] = {
                "analysis_component_key": self.component_key,
                "analysis_library_key": library,
                "analysis_antigen_id": antigen_id,
                "analysis_ref": f"{self.component_key}:{library}:{antigen_id}",
            }
        self._references = references
        by_library: dict[str, dict[int, str]] = {}
        for portable_id, reference in references.items():
            library = str(reference["analysis_library_key"])
            by_library.setdefault(library, {})[
                int(reference["analysis_antigen_id"])
            ] = portable_id
        self._analysis_ids_by_library = by_library
        # Metadata only. Keep compute-record identity separate from the older
        # projected-parent namespace and from one-to-many source memberships.
        units = {
            "full_length_swissprot": ("biological_parent", "biological protein / natural-form records"),
            "natural_hormone_form": ("biological_parent", "biological protein / natural-form records"),
            "exact_sequence_parent": ("exact_sequence_group", "exact-sequence groups"),
        }
        for row in rows:
            kind = str(row["parent_kind"])
            if kind not in units:
                continue
            library, antigen_id = str(row["analysis_library_key"]), int(row["analysis_antigen_id"])
            unit, label = units[kind]
            self._record_identities[library, antigen_id] = {
                "schema": "mimicryone/record-identity/1",
                "analysis_release_fingerprint": self.analysis_release_fingerprint,
                "library": library, "antigen_id": antigen_id,
                "portable_id": str(row["portable_id"]), "parent_kind": kind,
                "unit": unit, "verification_method": VERIFICATION_METHOD,
            }
        for library, records in by_library.items():
            identities = [self._record_identities.get((library, key)) for key in records]
            unit_set = {value["unit"] for value in identities if value}
            if identities and all(identities) and len(unit_set) == 1 and len(records) == analysis_counts.get(library):
                unit = next(iter(unit_set))
                self._representations[library] = {
                    "schema": "mimicryone/library-representation/1",
                    "analysis_release_fingerprint": self.analysis_release_fingerprint,
                    "library": library, "unit": unit,
                    "label": next(label for candidate, label in units.values() if candidate == unit),
                    "verified_records": len(records),
                    "population_denominator": False,
                }
        self.available = True

    def annotate_result(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Attach proven identities without changing coordinates, IDs or counts."""
        if payload.get("release_fingerprint") != self.analysis_release_fingerprint:
            return dict(payload)
        result = dict(payload)
        def annotate(record):
            value = dict(record)
            identity = self._record_identities.get((str(value.get("library") or value.get("library_key") or ""), value.get("antigen_id")))
            if identity:
                value["record_identity"] = dict(identity)
            return value
        result["query_records"] = [annotate(row) for row in payload.get("query_records", [])]
        result["source_catalog"] = [annotate(row) for row in payload.get("source_catalog", [])]
        target = dict(payload.get("target") or {})
        representation = self._representations.get(str(target.get("library") or ""))
        if representation and all(row.get("record_identity", {}).get("library") == target["library"] for row in result["source_catalog"]):
            target["record_representation"] = dict(representation)
            target["entity_label"] = representation["label"]
        result["target"] = target
        return result

    def enrich(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        result = deepcopy(dict(payload))
        reference = self._references.get(str(result.get("portable_id") or ""))
        if reference is not None:
            result.update(reference)
        return result

    def analysis_records(self, library: str) -> dict[int, str]:
        """Return the verified analysis-id to portable-id map for one library."""

        return dict(self._analysis_ids_by_library.get(library, {}))

    def meta(self) -> dict[str, Any]:
        return {
            "schema": CROSSWALK_SCHEMA,
            "available": self.available,
            "verified_records": len(self._references),
            "verified_records_by_library": {
                library: len(records)
                for library, records in sorted(self._analysis_ids_by_library.items())
            },
            "analysis_release_fingerprint": (
                self.analysis_release_fingerprint if self.available else None
            ),
            "verification_method": VERIFICATION_METHOD,
        }


__all__ = [
    "CROSSWALK_COLUMNS",
    "CROSSWALK_DDL",
    "CROSSWALK_SCHEMA",
    "CROSSWALK_TABLE",
    "ExplorerAnalysisCrosswalk",
    "VERIFICATION_METHOD",
]
