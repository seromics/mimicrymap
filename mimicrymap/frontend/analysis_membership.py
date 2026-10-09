"""Read-only biological/source filters for analysis antigens.

The filter database is an additive sidecar. It never changes the immutable
analysis catalog, precomputed 7/9 shards, or live 5/9--6/9 indexes.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, Iterable, Mapping


SCHEMA_V1 = "mimicryone/analysis-antigen-membership-sidecar/1"
SCHEMA_V2 = "mimicryone/analysis-filter-sidecar/2"
SCHEMA_V2_COMPAT = "mimicryone/analysis-antigen-membership-sidecar/2"
SCHEMA_V3 = "mimicryone/analysis-filter-sidecar/3"
SCHEMA_V4 = "mimicryone/analysis-filter-sidecar/4"
SCHEMA = SCHEMA_V4
SUPPORTED_SCHEMAS = frozenset(
    {SCHEMA_V1, SCHEMA_V2, SCHEMA_V2_COMPAT, SCHEMA_V3, SCHEMA_V4}
)

# Compatibility metadata for the already validated v1 sidecar. A v2 sidecar
# carries this structure in its own immutable metadata so its taxonomy/source
# choices and counts cannot drift away from the rows they describe.
PANSCAN_OPTIONS: dict[str, dict[str, Any]] = {
    "panscan9_human": {
        "label": "PanScan9 Human",
        "sublibraries": {"SwissProt": 1_317_982, "HORDB": 1_559},
        "controls": 0,
    },
    "panscan9_variant": {
        "label": "PanScan9 Variant / Tumor",
        "sublibraries": {"humsavar": 165_098, "Tumor": 51_390},
        "controls": 50,
        "variant_sources": {
            "humsavar": 165_098,
            "TCGA_MC3": 18_449,
            "L9B": 15_122,
            "Frameshift": 8_104,
            "ChimerKB": 6_453,
            "Gao2018_TCGA": 3_262,
        },
        "humsavar_significance": {"LB/B": 79_588, "LP/P": 63_694, "US": 21_816},
    },
    "panscan9_exposure": {
        "label": "PanScan9 Exposure",
        "sublibraries": {
            "IEDB": 163_490,
            "Virus": 105_697,
            "Allergen": 70_572,
            "Other": 22_878,
        },
        "controls": 50,
    },
    "panscan9_dark": {
        "label": "PanScan9 Dark",
        "sublibraries": {"GENCODE": 123_225, "Dfam": 22_253, "L1Base2": 4_768},
        "controls": 50,
    },
}

FILTER_COLUMNS = {
    "sublibraries": "sublibrary",
    "source_details": "source_detail",
    "legacy_sources": "legacy_source_library",
    "domains": "domain",
    "genera": "genus",
    "species": "species",
    "variant_sources": "variant_source",
    "humsavar_significance": "humsavar_significance",
    "tile_kinds": "tile_kind",
    "human_tropism_statuses": "human_tropism_status",
}
OPTION_ALIASES = {
    "genera": ("genera", "top_genera"),
    "species": ("species", "top_species"),
    "human_tropism_statuses": ("human_tropism_statuses", "human_tropism"),
}
BOOLEAN_FILTERS = frozenset({"include_controls", "include_unclassified"})

# Schema v4 keeps parent membership singular and applies biological filters to
# source-provenance rows.  These names deliberately do not alter the accepted
# v1-v3 request surface above.
V4_FILTER_COLUMNS = {
    "facets": "facet",
    "source_collections": "source_collection",
    "source_organisms": "source_organism",
    "domain_groups": "domain_group",
    "domains": "domain",
    "kingdoms": "kingdom",
    "phyla": "phylum",
    "classes": "class_name",
    "orders": "tax_order",
    "families": "family",
    "genera": "genus",
    "species": "species",
    "locations": "scope_keys",
    "accessibilities": "scope_keys",
    "regions": "scope_keys",
}
V4_PROVENANCE_FILTER_COLUMNS = {
    "source_collections": "source_collection",
    "source_organisms": "source_organism",
}
V4_SCOPE_FILTER_KEYS = {
    "locations": "location",
    "accessibilities": "accessible",
    "regions": "region",
}
V4_REQUEST_FIELD_ALIASES = {
    "source_collection": "source_collections",
    "source_organism": "source_organisms",
    "location": "locations",
    "accessible": "accessibilities",
    "region": "regions",
}
V4_TAXONOMY_FIELDS = frozenset(
    {
        "domain_groups",
        "domains",
        "kingdoms",
        "phyla",
        "classes",
        "orders",
        "families",
        "genera",
        "species",
    }
)
V4_BOOLEAN_FILTERS = frozenset(
    {"include_controls", "include_unclassified", "exclude_mammals", "exclude_vertebrates"}
)
# Vertebrate classes present in the retained canonical taxonomy snapshot.
# Ascidiacea is an invertebrate chordate and is deliberately retained.
VERTEBRATE_CLASSES = ("Actinopteri", "Amphibia", "Aves", "Chondrichthyes", "Lepidosauria", "Mammalia")

MIN_REFERENCE_THRESHOLDS = frozenset({1, 2, 5, 10, 50, 200})

FILTER_POLICY_SCHEMA = "mimicryone/analysis-filter-policy/1"
FILTER_POLICY_RELEASE = "e8e76d98f977a239929b85a1a46aca715a61e524d7683fa6afc499c49cb21e64"


def _identifier_ranges(*ranges: tuple[int, int]) -> frozenset[int]:
    return frozenset(
        identifier
        for start, end in ranges
        for identifier in range(start, end + 1)
    )


# Exact, release-pinned redundant GFAP controls. These are never inferred from
# the word GFAP: Human, HuProt, and non-control HumSaVar GFAP records remain valid.
IMPLICIT_EXCLUSIONS_BY_RELEASE: Mapping[str, Mapping[str, frozenset[int]]] = {
    FILTER_POLICY_RELEASE: {
        "virscan_exposome_current": _identifier_ranges(
            (1_230_242, 1_230_252),
            (1_328_253, 1_328_262),
            (1_348_521, 1_348_530),
        ),
        "panscan9_variant": _identifier_ranges((2_969_655, 2_969_704)),
        "panscan9_dark": _identifier_ranges((3_119_951, 3_120_000)),
        "panscan9_exposure": _identifier_ranges((3_482_638, 3_482_687)),
    }
}


class MembershipFilterError(ValueError):
    pass


def _read_only_connection(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


def _option_map(specification: Mapping[str, Any], field: str) -> Mapping[str, Any] | None:
    for name in OPTION_ALIASES.get(field, (field,)):
        value = specification.get(name)
        if isinstance(value, Mapping):
            return value
        if isinstance(value, list):
            output: dict[str, Any] = {}
            for item in value:
                if isinstance(item, str):
                    output[item] = None
                elif isinstance(item, Mapping) and isinstance(item.get("value"), str):
                    output[str(item["value"])] = item.get("count")
            return output
    return None


def _v4_column_options(
    connection: sqlite3.Connection,
    library: str,
    column: str,
) -> list[dict[str, Any]]:
    if column not in set(V4_PROVENANCE_FILTER_COLUMNS.values()):
        raise ValueError("unsupported v4 provenance option column")
    return [
        {"value": str(value), "label": str(value), "count": int(count)}
        for value, count in connection.execute(
            f"SELECT {column},COUNT(DISTINCT antigen_id) FROM source_provenance "
            f"WHERE library_key=? AND {column} IS NOT NULL AND trim({column})!='' "
            f"GROUP BY {column} ORDER BY COUNT(DISTINCT antigen_id) DESC,"
            f"{column} COLLATE NOCASE",
            (library,),
        )
    ]


def _v4_scope_options(
    connection: sqlite3.Connection,
    library: str,
) -> dict[str, list[dict[str, Any]]]:
    values: dict[str, dict[str, set[int]]] = {
        field: {} for field in V4_SCOPE_FILTER_KEYS
    }
    fields_by_token = {
        token: field for field, token in V4_SCOPE_FILTER_KEYS.items()
    }
    for antigen_id, raw_scope in connection.execute(
        "SELECT antigen_id,scope_keys FROM source_provenance "
        "WHERE library_key=? AND scope_keys IS NOT NULL",
        (library,),
    ):
        for token in str(raw_scope).split(";"):
            key, separator, value = token.partition("=")
            field = fields_by_token.get(key)
            if not separator or field is None or not value:
                continue
            values[field].setdefault(value, set()).add(int(antigen_id))
    return {
        field: [
            {"value": value, "label": value.replace("_", " "), "count": len(identifiers)}
            for value, identifiers in sorted(
                options.items(),
                key=lambda item: (-len(item[1]), item[0].casefold()),
            )
        ]
        for field, options in values.items()
    }


def normalize_record_slice(identifiers):
    """Validate an exact catalog slice; an empty selection remains empty."""
    if (not isinstance(identifiers, list) or len(identifiers) > 1
            or any(type(item) is not int or not 0 < item <= 0xFFFFFFFF for item in identifiers)):
        raise MembershipFilterError("record_ids must contain at most one positive catalog ID")
    return list(identifiers)


class AnalysisMembership:
    def __init__(self, database: str | Path, *, expected_fingerprint: str):
        self.database = Path(database).resolve()
        if not self.database.is_file():
            raise FileNotFoundError(self.database)
        with closing(_read_only_connection(self.database)) as connection:
            metadata = {
                str(row["key"]): json.loads(row["value_json"])
                for row in connection.execute("SELECT key,value_json FROM metadata")
            }
            columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(antigen_membership)")
            }
            provenance_columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(source_provenance)")
            }
            facet_columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(source_provenance_facet)")
            }
        schema = metadata.get("schema")
        if schema not in SUPPORTED_SCHEMAS:
            raise ValueError(f"unsupported membership sidecar schema: {schema!r}")
        if metadata.get("analysis_release_fingerprint") != expected_fingerprint:
            raise ValueError("membership sidecar fingerprint does not match the analysis release")
        required = {"antigen_id", "library_key", "is_control"}
        if not required.issubset(columns):
            raise ValueError("membership sidecar is missing required columns")
        if schema == SCHEMA_V4:
            required_provenance = {
                "provenance_id",
                "antigen_id",
                "library_key",
                "domain_group",
                "domain",
                "kingdom",
                "phylum",
                "class_name",
                "tax_order",
                "family",
                "genus",
                "species",
                "taxonomy_status",
                "is_mammal",
                "n_references",
            }
            if not required_provenance.issubset(provenance_columns):
                raise ValueError("schema v4 sidecar is missing source-provenance columns")
            if not {"provenance_id", "facet"}.issubset(facet_columns):
                raise ValueError("schema v4 sidecar is missing source-provenance facets")
        capabilities = metadata.get("capabilities")
        if schema == SCHEMA_V1:
            libraries: Mapping[str, Any] = PANSCAN_OPTIONS
        elif isinstance(capabilities, Mapping) and isinstance(capabilities.get("libraries"), Mapping):
            libraries = capabilities["libraries"]
        else:
            raise ValueError("filter sidecar has no pinned filter capabilities")
        self.metadata = metadata
        self.schema = str(schema)
        self.columns = columns
        self.provenance_columns = provenance_columns
        self.facet_columns = facet_columns
        self.libraries = {str(key): dict(value) for key, value in libraries.items()}
        if self.schema == SCHEMA_V4:
            with closing(_read_only_connection(self.database)) as connection:
                for library, specification in self.libraries.items():
                    count = connection.execute(
                        "SELECT count(DISTINCT antigen_id) FROM source_provenance WHERE library_key=? AND class_name IN ("
                        + ",".join("?" for _ in VERTEBRATE_CLASSES) + ")", (library, *VERTEBRATE_CLASSES)
                    ).fetchone()[0]
                    specification["exclude_vertebrates"] = {
                        "default": False, "distinct_vertebrate_parent_count": count,
                        "classes": list(VERTEBRATE_CLASSES),
                    }
                    for field, column in V4_PROVENANCE_FILTER_COLUMNS.items():
                        if column not in self.provenance_columns:
                            continue
                        options = _v4_column_options(connection, library, column)
                        if options:
                            specification.setdefault(field, options)
                    if "scope_keys" in self.provenance_columns:
                        for field, options in _v4_scope_options(
                            connection, library
                        ).items():
                            if options:
                                specification.setdefault(field, options)
        self.release_fingerprint = expected_fingerprint
        self.implicit_exclusions = {
            str(key): frozenset(int(value) for value in values)
            for key, values in IMPLICIT_EXCLUSIONS_BY_RELEASE.get(
                expected_fingerprint, {}
            ).items()
        }
        policy_payload = {
            "schema": FILTER_POLICY_SCHEMA,
            "analysis_release_fingerprint": expected_fingerprint,
            "excluded_antigen_ids": {
                key: sorted(values)
                for key, values in sorted(self.implicit_exclusions.items())
            },
        }
        self.filter_policy_fingerprint = hashlib.sha256(
            json.dumps(policy_payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).hexdigest()
        with closing(_read_only_connection(self.database)) as connection:
            for library, identifiers in self.implicit_exclusions.items():
                if not identifiers:
                    continue
                rows = connection.execute(
                    "SELECT antigen_id FROM antigen_membership WHERE library_key=? "
                    "AND antigen_id IN (" + ",".join("?" for _ in identifiers) + ")",
                    [library, *sorted(identifiers)],
                )
                observed = {int(row[0]) for row in rows}
                if observed != set(identifiers):
                    raise ValueError(
                        f"filter-policy exclusions do not match the pinned sidecar for {library}"
                    )
        self._capabilities = {
            "available": True,
            "schema": self.schema,
            "semantics": "OR within one field; AND across fields; physical antigen observations remain singular",
            "controls_default": False,
            "controls_exposed": False,
            "filter_policy_fingerprint": self.filter_policy_fingerprint,
            "implicit_exclusions": {
                "policy": "Redundant GFAP controls are excluded; legitimate human and variant GFAP remains",
                "total": sum(len(values) for values in self.implicit_exclusions.values()),
                "libraries": {
                    key: len(values) for key, values in sorted(self.implicit_exclusions.items())
                },
            },
            "unclassified_policy": "Unresolved taxonomy is excluded from narrowed domain filters unless explicitly included",
            "libraries": self.libraries,
        }
        if isinstance(capabilities, Mapping):
            for key, value in capabilities.items():
                if key not in {"libraries", "filter_policy_fingerprint", "implicit_exclusions"}:
                    self._capabilities[str(key)] = value
        if self.schema == SCHEMA_V4:
            filter_fields = self._capabilities.get("filter_fields")
            if not isinstance(filter_fields, dict):
                filter_fields = {}
                self._capabilities["filter_fields"] = filter_fields
            filter_fields["exclude_vertebrates"] = "boolean"
            for field in (
                *V4_PROVENANCE_FILTER_COLUMNS,
                *V4_SCOPE_FILTER_KEYS,
            ):
                if any(field in specification for specification in self.libraries.values()):
                    filter_fields.setdefault(field, "multi_select")
            if any(
                field in specification
                for specification in self.libraries.values()
                for field in V4_SCOPE_FILTER_KEYS
            ):
                self._capabilities.setdefault(
                    "scope_key_semantics",
                    (
                        "location, accessible, and region are exact semicolon-delimited "
                        "tokens on one qualifying source-provenance row"
                    ),
                )
        for library, identifiers in self.implicit_exclusions.items():
            specification = self.libraries.get(library)
            if specification is not None:
                specification["eligible_rows"] = max(
                    0, int(specification.get("row_count", 0)) - len(identifiers)
                )
        legacy_specification = self.libraries.get("virscan_exposome_current")
        if legacy_specification is not None and int(legacy_specification.get("controls", 0)) == 0:
            legacy_specification["controls"] = 31

            def reduce_option(field: str, option: str, amount: int) -> None:
                entries = legacy_specification.get(field)
                if not isinstance(entries, list):
                    return
                for entry in entries:
                    if isinstance(entry, dict) and entry.get("value") == option:
                        entry["count"] = max(0, int(entry.get("count", 0)) - amount)

            reduce_option("legacy_sources", "virscan_legacy", 11)
            reduce_option("legacy_sources", "exposome_legacy", 20)
            reduce_option("domains", "Viruses", 11)
            reduce_option("human_tropism_statuses", "included", 11)
            reduce_option("human_tropism_statuses", "unlabelled", 20)
            legacy = self._capabilities.get("legacy")
            subset = legacy.get("human_subset") if isinstance(legacy, dict) else None
            if isinstance(subset, dict):
                subset["included_rows"] = max(0, int(subset.get("included_rows", 0)) - 11)
                subset["unlabelled_rows"] = max(0, int(subset.get("unlabelled_rows", 0)) - 20)

    def capabilities(self) -> dict[str, Any]:
        return self._capabilities

    def row_filter_columns(self, library: str) -> dict[str, str]:
        """Request fields a single antigen_membership row can answer, as field -> column.

        A browser holding a baked package holds those columns and nothing else, so this is
        exactly the set it may decide for itself; everything absent has to be decided here.
        The mapping matters as much as the membership: request fields are plural and columns
        are singular (sublibraries -> sublibrary), and a client that tested the request key
        against the row found undefined and quietly rejected every record. Publishing the
        mapping keeps that correspondence in the one place that already owns it.

        Empty for schema v4, whose antigen_membership carries only is_control - its filters
        live on source_provenance, where one row must satisfy every condition at once, which
        no per-record test on a package can reproduce.
        """
        if library not in self.libraries:
            return {}
        mapping = V4_FILTER_COLUMNS if self.schema == SCHEMA_V4 else FILTER_COLUMNS
        return {
            field: column
            for field, column in mapping.items()
            if column in self.columns
        }

    def normalize(self, library: str, value: object) -> dict[str, Any] | None:
        if value in (None, False):
            return None
        if library not in self.libraries:
            raise MembershipFilterError(f"Source filters are unavailable for {library}")
        if not isinstance(value, Mapping):
            raise MembershipFilterError("filters must be an object")
        request = dict(value)
        if self.schema == SCHEMA_V4:
            for alias, field in V4_REQUEST_FIELD_ALIASES.items():
                if alias not in request:
                    continue
                if field in request:
                    raise MembershipFilterError(
                        f"Use only one of {alias} or {field}"
                    )
                request[field] = request.pop(alias)
        filter_columns = V4_FILTER_COLUMNS if self.schema == SCHEMA_V4 else FILTER_COLUMNS
        boolean_filters = V4_BOOLEAN_FILTERS if self.schema == SCHEMA_V4 else BOOLEAN_FILTERS
        scalar_filters = {"min_references"} if self.schema == SCHEMA_V4 else set()
        unknown = sorted(set(request) - set(filter_columns) - set(boolean_filters) - scalar_filters - {"record_ids"})
        if unknown:
            raise MembershipFilterError("Unknown filter field(s): " + ", ".join(unknown))

        specification = self.libraries[library]
        normalized: dict[str, Any] = {}
        for field in boolean_filters:
            if field not in request:
                continue
            raw_boolean = request[field]
            if type(raw_boolean) is not bool:
                raise MembershipFilterError(f"{field} must be true or false")
            normalized[field] = raw_boolean
        normalized.setdefault("include_controls", False)
        if "record_ids" in request:
            normalized["record_ids"] = normalize_record_slice(request["record_ids"])

        available_columns = (
            self.provenance_columns | ({"facet"} if self.facet_columns else set())
            if self.schema == SCHEMA_V4
            else self.columns
        )
        for field, column in filter_columns.items():
            raw = request.get(field)
            if raw in (None, []):
                continue
            if column not in available_columns:
                raise MembershipFilterError(f"{field} is unavailable in this sidecar")
            if not isinstance(raw, list) or not all(isinstance(item, str) and item for item in raw):
                raise MembershipFilterError(f"{field} must be an array of non-empty strings")
            selected = list(dict.fromkeys(raw))
            valid = _option_map(specification, field)
            # tile_kinds remains an expert/internal field in v1 and was not exposed
            # in its capability metadata; all user-facing v2 fields are pinned.
            if valid is None and field != "tile_kinds":
                raise MembershipFilterError(f"{field} is unavailable for {library}")
            invalid = sorted(set(selected) - set(valid or selected))
            if invalid:
                raise MembershipFilterError(f"Unsupported {field}: {', '.join(invalid)}")
            normalized[field] = selected

        if self.schema == SCHEMA_V4 and request.get("min_references") is not None:
            threshold = request["min_references"]
            if type(threshold) is not int or threshold not in MIN_REFERENCE_THRESHOLDS:
                choices = ", ".join(str(item) for item in sorted(MIN_REFERENCE_THRESHOLDS))
                raise MembershipFilterError(f"min_references must be one of: {choices}")
            normalized["min_references"] = threshold

        if normalized.get("include_unclassified"):
            if self.schema == SCHEMA_V4:
                if not any(normalized.get(field) for field in V4_TAXONOMY_FIELDS):
                    raise MembershipFilterError(
                        "include_unclassified requires a narrowed taxonomy filter"
                    )
            elif not normalized.get("domains"):
                raise MembershipFilterError(
                    "include_unclassified requires a narrowed domains filter"
                )
        return normalized

    def allowed_ids(
        self,
        library: str,
        identifiers: Iterable[int],
        filters: Mapping[str, Any] | None,
    ) -> set[int]:
        values = sorted(set(int(value) for value in identifiers))
        if not values:
            return set()
        effective_filters: Mapping[str, Any] | None = filters
        if effective_filters is None and library in self.libraries:
            effective_filters = {}
        normalized = self.normalize(library, effective_filters)
        if normalized is None:
            return set(values) - set(self.implicit_exclusions.get(library, ()))
        predicate, predicate_parameters = self.sql_predicate(
            library, normalized
        )
        output: set[int] = set()
        with closing(_read_only_connection(self.database)) as connection:
            for start in range(0, len(values), 700):
                chunk = values[start : start + 700]
                conditions = [
                    predicate,
                    "antigen_id IN (" + ",".join("?" for _ in chunk) + ")",
                ]
                parameters: list[Any] = [*predicate_parameters, *chunk]
                rows = connection.execute(
                    "SELECT antigen_id FROM antigen_membership WHERE " + " AND ".join(conditions),
                    parameters,
                )
                output.update(int(row[0]) for row in rows)
        return output

    def sql_predicate(
        self,
        library: str,
        filters: Mapping[str, Any] | None,
        *,
        alias: str = "",
    ) -> tuple[str, list[Any]]:
        """Return the pinned filter predicate for a read-only catalog join.

        Filtering at the join is important for FTS: it prevents a valid match
        from disappearing merely because an unfiltered shortlist reached LIMIT
        first. ``alias`` is internal and deliberately restricted to a SQL
        identifier before it is interpolated.
        """
        effective_filters: Mapping[str, Any] | None = filters
        if effective_filters is None and library in self.libraries:
            effective_filters = {}
        normalized = self.normalize(library, effective_filters)
        if alias and (not alias.replace("_", "").isalnum() or alias[0].isdigit()):
            raise ValueError("invalid membership SQL alias")
        qualified = f"{alias}." if alias else ""
        conditions = [f"{qualified}library_key=?"]
        parameters: list[Any] = [library]
        implicit_exclusions = sorted(self.implicit_exclusions.get(library, ()))
        if implicit_exclusions:
            conditions.append(
                f"{qualified}antigen_id NOT IN ("
                + ",".join("?" for _ in implicit_exclusions)
                + ")"
            )
            parameters.extend(implicit_exclusions)
        if normalized is None:
            return " AND ".join(conditions), parameters

        if "record_ids" in normalized:
            identifiers = normalized["record_ids"]
            conditions.append(f"{qualified}antigen_id=?" if identifiers else "0")
            parameters.extend(identifiers)

        if self.schema == SCHEMA_V4:
            outer_provenance_key = qualified if alias else "antigen_membership."
            provenance_conditions = [
                f"p.antigen_id={outer_provenance_key}antigen_id",
                f"p.library_key={outer_provenance_key}library_key",
            ]
            provenance_parameters: list[Any] = []
            facet_join = ""
            selected_facets = normalized.get("facets")
            if selected_facets:
                facet_join = (
                    " JOIN source_provenance_facet pf"
                    " ON pf.provenance_id=p.provenance_id"
                )
                provenance_conditions.append(
                    "pf.facet IN (" + ",".join("?" for _ in selected_facets) + ")"
                )
                provenance_parameters.extend(selected_facets)
            if "min_references" in normalized:
                facet_join += (
                    " JOIN source_provenance_facet rf"
                    " ON rf.provenance_id=p.provenance_id"
                )
                provenance_conditions.append("rf.facet='iedb'")

            for field, column in V4_PROVENANCE_FILTER_COLUMNS.items():
                selected = normalized.get(field)
                if not selected:
                    continue
                provenance_conditions.append(
                    f"p.{column} IN (" + ",".join("?" for _ in selected) + ")"
                )
                provenance_parameters.extend(selected)

            taxonomy_conditions: list[str] = []
            taxonomy_parameters: list[Any] = []
            for field in V4_FILTER_COLUMNS:
                if field not in V4_TAXONOMY_FIELDS:
                    continue
                selected = normalized.get(field)
                if not selected:
                    continue
                column = V4_FILTER_COLUMNS[field]
                taxonomy_conditions.append(
                    f"p.{column} IN (" + ",".join("?" for _ in selected) + ")"
                )
                taxonomy_parameters.extend(selected)
            if taxonomy_conditions:
                taxonomy_clause = " AND ".join(taxonomy_conditions)
                if normalized.get("include_unclassified"):
                    taxonomy_clause = (
                        f"(({taxonomy_clause}) OR p.taxonomy_status='unclassified')"
                    )
                provenance_conditions.append(taxonomy_clause)
                provenance_parameters.extend(taxonomy_parameters)

            for field, token_key in V4_SCOPE_FILTER_KEYS.items():
                selected = normalized.get(field)
                if not selected:
                    continue
                provenance_conditions.append(
                    "("
                    + " OR ".join(
                        "instr(';' || coalesce(p.scope_keys,'') || ';', ?) > 0"
                        for _ in selected
                    )
                    + ")"
                )
                provenance_parameters.extend(
                    f";{token_key}={value};" for value in selected
                )

            if normalized.get("exclude_vertebrates"):
                provenance_conditions.append("p.taxonomy_status='resolved' AND coalesce(p.class_name,'') NOT IN (" + ",".join("?" for _ in VERTEBRATE_CLASSES) + ")")
                provenance_parameters.extend(VERTEBRATE_CLASSES)
            elif normalized.get("exclude_mammals"):
                provenance_conditions.append("p.is_mammal=0")
            if "min_references" in normalized:
                provenance_conditions.append("p.n_references>=?")
                provenance_parameters.append(normalized["min_references"])

            has_provenance_filter = any(
                normalized.get(field) for field in V4_FILTER_COLUMNS
            ) or bool(normalized.get("exclude_mammals")) or bool(normalized.get("exclude_vertebrates")) or "min_references" in normalized
            biological: list[str] = []
            if has_provenance_filter:
                biological.append(
                    "EXISTS (SELECT 1 FROM source_provenance p"
                    + facet_join
                    + " WHERE "
                    + " AND ".join(provenance_conditions)
                    + ")"
                )
            control_column = qualified + "is_control"
            if normalized["include_controls"]:
                biological_scope = " AND ".join([f"{control_column}=0", *biological])
                conditions.append(f"({control_column}=1 OR ({biological_scope}))")
            else:
                conditions.extend([f"{control_column}=0", *biological])
            parameters.extend(provenance_parameters)
            return " AND ".join(conditions), parameters

        biological: list[str] = []
        biological_parameters: list[Any] = []
        for field, column in FILTER_COLUMNS.items():
            selected = normalized.get(field)
            if not selected:
                continue
            qualified_column = qualified + column
            clause = qualified_column + " IN (" + ",".join("?" for _ in selected) + ")"
            if field == "domains" and normalized.get("include_unclassified"):
                clause = "(" + clause + f" OR {qualified_column} IS NULL)"
            biological.append(clause)
            biological_parameters.extend(selected)
        control_column = qualified + "is_control"
        if normalized["include_controls"]:
            biological_scope = " AND ".join([f"{control_column}=0", *biological])
            conditions.append(f"({control_column}=1 OR ({biological_scope}))")
        else:
            conditions.extend([f"{control_column}=0", *biological])
        parameters.extend(biological_parameters)
        return " AND ".join(conditions), parameters


__all__ = [
    "AnalysisMembership",
    "MembershipFilterError",
    "PANSCAN_OPTIONS",
    "SCHEMA",
    "SCHEMA_V1",
    "SCHEMA_V2",
    "SCHEMA_V2_COMPAT",
    "SCHEMA_V3",
    "SCHEMA_V4",
]
