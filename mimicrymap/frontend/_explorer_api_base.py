"""Read-only HTTP adapter for the distinct PanScan9 protein Explorer namespace.

Provides the read-only Explorer routes used by the MimicryMap server.
"""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from annotation_hydration import AnnotationHydrator
from canonical_aliases import CanonicalAliasResolver
from canonical_parent_catalog import (
    CanonicalParentCatalog,
    PARENT_CLASSES,
    PARENT_KEY_RE,
)


SCHEMA = "mimicryone/panscan9-protein-explorer/1"
ID_RE = PARENT_KEY_RE
TOKEN_RE = re.compile(r"[\w.-]+", re.UNICODE)


class ExplorerAPIError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def read_only_connection(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(
        f"file:{path.resolve().as_posix()}?mode=ro&immutable=1", uri=True
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


def fts_query(value: str, *, prefix: bool = True) -> str:
    tokens = TOKEN_RE.findall(value)[:8]
    if not tokens:
        raise ExplorerAPIError(422, "Search must contain at least one letter or number")
    suffix = "*" if prefix else ""
    return " AND ".join(
        '"' + token.replace('"', '""') + '"' + suffix for token in tokens
    )


class ExplorerAPI:
    """Dispatch GET/HEAD requests below ``/api/explorer``."""

    def __init__(
        self,
        release: Path | str,
        *,
        alias_db: Path | str | None = None,
        annotation_db: Path | str | None = None,
        parent_db: Path | str | None = None,
        parent_catalog: CanonicalParentCatalog | None = None,
    ):
        if parent_db is not None and parent_catalog is not None:
            raise ValueError("parent_db and parent_catalog are mutually exclusive")
        candidate = Path(release).resolve()
        self.root = candidate if candidate.is_dir() else candidate.parent
        self.database = candidate / "explorer.sqlite" if candidate.is_dir() else candidate
        self.manifest_path = self.root / "MANIFEST.json"
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        if self.manifest.get("schema") != SCHEMA:
            raise ValueError(f"unsupported Explorer schema: {self.manifest.get('schema')!r}")
        if not self.database.is_file():
            raise FileNotFoundError(self.database)
        self.alias_resolver = CanonicalAliasResolver(alias_db) if alias_db is not None else None
        self.annotation_hydrator = AnnotationHydrator(
            self.alias_resolver, annotation_db
        )
        self.parent_catalog = (
            parent_catalog
            if parent_catalog is not None
            else CanonicalParentCatalog(parent_db) if parent_db is not None else None
        )
        self.canonical_parent_catalog_available = self.parent_catalog is not None
        if self.parent_catalog is not None:
            self._validate_parent_compatibility()

    def _validate_parent_compatibility(self) -> None:
        """Require exact one-to-one P9P agreement before enabling the overlay."""

        assert self.parent_catalog is not None
        with closing(read_only_connection(self.database)) as explorer, closing(
            self.parent_catalog.connection()
        ) as catalog:
            core_rows = {
                str(row["portable_id"]): row
                for row in explorer.execute(
                    "SELECT portable_id,sequence_sha256,class,projection_count FROM protein"
                )
            }
            parent_rows = {
                str(row["parent_key"]): row
                for row in catalog.execute(
                    "SELECT parent_key,sequence_sha256,source_partition,mapping_rows "
                    "FROM canonical_parent WHERE id_namespace='P9P'"
                )
            }
        if len(core_rows) != 29_750 or len(parent_rows) != 29_750:
            raise ValueError("canonical parent / Explorer P9P count mismatch")
        if core_rows.keys() != parent_rows.keys():
            missing = sorted(parent_rows.keys() - core_rows.keys())[:3]
            extra = sorted(core_rows.keys() - parent_rows.keys())[:3]
            raise ValueError(
                f"canonical parent / Explorer P9P identity mismatch: missing={missing}, extra={extra}"
            )
        for parent_key, core in core_rows.items():
            parent = parent_rows[parent_key]
            if (
                core["sequence_sha256"] != parent["sequence_sha256"]
                or core["class"] != parent["source_partition"]
                or int(core["projection_count"]) != int(parent["mapping_rows"])
            ):
                raise ValueError(f"canonical parent / Explorer row mismatch: {parent_key}")

    def resolve_canonical_parent(self, parent_key: object) -> dict[str, object] | None:
        if self.parent_catalog is None:
            return None
        return self.parent_catalog.resolve_canonical_parent(parent_key)

    @staticmethod
    def _integer(query: dict[str, list[str]], name: str, default: int, maximum: int) -> int:
        raw = (query.get(name) or [str(default)])[0]
        try:
            value = int(raw)
        except ValueError as error:
            raise ExplorerAPIError(422, f"{name} must be an integer") from error
        if value < 0 or value > maximum:
            raise ExplorerAPIError(422, f"{name} must be between 0 and {maximum}")
        return value

    @staticmethod
    def _boolean(query: dict[str, list[str]], name: str, default: bool = False) -> bool:
        values = query.get(name)
        if values is None:
            return default
        if len(values) != 1 or values[0] not in {"true", "false"}:
            raise ExplorerAPIError(422, f"{name} must be true or false")
        return values[0] == "true"

    @staticmethod
    def _send(handler, status: int, payload: object, head_only: bool = False) -> None:
        body = (json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.end_headers()
        if not head_only:
            handler.wfile.write(body)

    def dispatch(self, handler, *, head_only: bool = False) -> bool:
        parsed = urlparse(handler.path)
        path = parsed.path.rstrip("/") or "/"
        if path != "/api/explorer" and not path.startswith("/api/explorer/"):
            return False
        try:
            query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=16)
            if path == "/api/explorer/meta":
                payload = self.meta()
            elif path == "/api/explorer/proteins":
                payload = self.proteins(query)
            else:
                match = re.fullmatch(r"/api/explorer/proteins/([^/]+)(/projections)?", path)
                if match is None:
                    raise ExplorerAPIError(404, "Explorer endpoint not found")
                portable_id = unquote(match.group(1))
                if not ID_RE.fullmatch(portable_id):
                    raise ExplorerAPIError(422, "portable_id must match P9P or M1E plus nine digits")
                include_optional = self._boolean(query, "include_receptor_germline")
                payload = (
                    self.projections(
                        portable_id,
                        query,
                        include_receptor_germline=include_optional,
                    )
                    if match.group(2)
                    else self.protein(
                        portable_id,
                        include_receptor_germline=include_optional,
                    )
                )
            self._send(handler, 200, payload, head_only)
        except ExplorerAPIError as error:
            self._send(
                handler,
                error.status,
                {"schema": "mimicryone/error/1", "status": error.status, "error": error.message},
                head_only,
            )
        return True

    def meta(self) -> dict[str, object]:
        payload = {
            "schema": SCHEMA,
            "release_id": self.manifest["release_id"],
            "release_fingerprint": self.manifest["release_fingerprint"],
            "entity_level": "full_protein_parent",
            "counts": self.manifest["counts"],
            "class_counts": self.manifest["class_counts"],
            "classes": ["Human", "Exposure"],
            "excluded_as_proteins": ["Dark", "Variant_Peptides", "P9T"],
            "sequence_semantics": self.manifest["sequence_semantics"],
        }
        payload["canonical_parent_catalog_available"] = self.parent_catalog is not None
        if self.parent_catalog is not None:
            capabilities = self.parent_catalog.capabilities()
            counts = capabilities["counts"]
            payload["canonical_parent_catalog"] = capabilities
            payload["canonical_parent_counts"] = {
                "selected": counts["selected_total"],
                "default": counts["default_total"],
                "optional_receptor_germline": counts["optional_receptor_germline"],
            }
        return payload

    def _summary(self, row: sqlite3.Row) -> dict[str, object]:
        payload = {
            "portable_id": row["portable_id"],
            "class": row["class"],
            "source_accession": row["source_accession"],
            "display_name": row["display_name"],
            "primary_gene": row["primary_gene"],
            "source_description": row["source_description"],
            "sequence_length": row["sequence_length"],
            "projection_count": row["projection_count"],
            "distinct_tile_count": row["distinct_tile_count"],
            "variant_projection_count": row["variant_projection_count"],
        }
        available = set(row.keys())
        for name in (
            "protein_name", "organism", "entry_name", "compute_id", "parent_kind",
            "facets", "source_collections", "source_url", "source_ref",
        ):
            if name in available:
                payload[name] = row[name]
        return self.annotation_hydrator.hydrate_canonical(payload)

    def _catalog_payload(
        self,
        parent: dict[str, object],
        core: sqlite3.Row | None = None,
        *,
        include_sequence: bool = False,
    ) -> dict[str, object]:
        """Map frozen catalog identity/policy and optional Explorer presentation."""

        def presentation(name: str, fallback: object = "") -> object:
            if core is not None and core[name] not in (None, ""):
                return core[name]
            return fallback

        payload: dict[str, object] = {
            "portable_id": parent["parent_key"],
            "parent_key": parent["parent_key"],
            "id_namespace": parent["id_namespace"],
            "class": parent["parent_class"],
            "parent_class": parent["parent_class"],
            "source_partition": parent["source_partition"],
            "source_accession": parent["accession"],
            "accession": parent["accession"],
            "display_name": presentation(
                "display_name",
                parent["protein_name"] or parent["gene"] or parent["accession"],
            ),
            "primary_gene": presentation("primary_gene", parent["gene"]),
            "gene": parent["gene"],
            "source_description": presentation(
                "source_description", parent["protein_name"]
            ),
            "protein_name": parent["protein_name"],
            "organism": parent["organism"],
            "source_header": parent["original_header"],
            "original_header": parent["original_header"],
            "companion_header": parent["canonical_header"],
            "canonical_header": parent["canonical_header"],
            "sequence_length": parent["sequence_length"],
            "sequence_sha256": parent["sequence_sha256"],
            "mapped_tile_count": parent["mapped_tile_count"],
            "projection_count": parent["mapped_tile_count"],
            "mapping_rows": parent["mapping_rows"],
            "distinct_tile_count": (
                int(core["distinct_tile_count"])
                if core is not None else int(parent["mapped_tile_count"])
            ),
            "variant_projection_count": (
                int(core["variant_projection_count"]) if core is not None else 0
            ),
            "include_default": parent["include_default"],
            "optional_receptor_germline": parent["optional_receptor_germline"],
            "analysis_only": parent["analysis_only"],
            "immune_region_class": parent["immune_region_class"],
            "immune_roster_category": parent["immune_roster_category"],
            "assay_interference_prone": parent["assay_interference_prone"],
            "interference_flag": parent["interference_flag"],
            "interference_note": parent["interference_note"],
            "record_type": parent["record_type"],
            "source_sublibraries": parent["source_sublibraries"],
            "target_types": parent["target_types"],
            "relationship_classes": parent["relationship_classes"],
            "mapping_statuses": parent["mapping_statuses"],
            "source_kind": parent["source_kind"],
            "source_release": parent["source_release"],
            "source_url": parent["source_url"],
        }
        if include_sequence:
            payload["sequence"] = parent["sequence"]
            payload["noncanonical_residue_count"] = (
                int(core["noncanonical_residue_count"]) if core is not None else 0
            )
        return self.annotation_hydrator.hydrate_canonical(payload)

    @staticmethod
    def _catalog_conditions(
        *,
        include_receptor_germline: bool,
        record_class: str,
        parent_class: str,
        alias: str = "",
    ) -> tuple[list[str], list[object]]:
        prefix = f"{alias}." if alias else ""
        conditions = [
            (
                f"({prefix}include_default=1 OR "
                f"{prefix}optional_receptor_germline=1)"
            )
            if include_receptor_germline
            else f"{prefix}include_default=1"
        ]
        parameters: list[object] = []
        if record_class:
            conditions.append(f"{prefix}source_partition=?")
            parameters.append(record_class)
        if parent_class:
            conditions.append(f"{prefix}parent_class=?")
            parameters.append(parent_class)
        return conditions, parameters

    def _core_by_ids(self, identifiers: list[str]) -> dict[str, sqlite3.Row]:
        if not identifiers:
            return {}
        output: dict[str, sqlite3.Row] = {}
        with closing(read_only_connection(self.database)) as connection:
            for start in range(0, len(identifiers), 700):
                chunk = identifiers[start : start + 700]
                rows = connection.execute(
                    "SELECT * FROM protein WHERE portable_id IN ("
                    + ",".join("?" for _ in chunk)
                    + ")",
                    chunk,
                )
                output.update((str(row["portable_id"]), row) for row in rows)
        return output

    def _catalog_page_payloads(
        self,
        identifiers: list[str],
        *,
        include_receptor_germline: bool,
    ) -> list[dict[str, object]]:
        assert self.parent_catalog is not None
        parents = self.parent_catalog.rows_by_keys(
            identifiers,
            include_receptor_germline=include_receptor_germline,
        )
        by_id = {str(row["parent_key"]): row for row in parents}
        core = self._core_by_ids(identifiers)
        return [
            self._catalog_payload(by_id[parent_key], core.get(parent_key))
            for parent_key in identifiers
            if parent_key in by_id
        ]

    def _alias_candidates(
        self,
        connection: sqlite3.Connection,
        search: str,
        record_class: str,
    ) -> list[tuple[sqlite3.Row, dict[str, object]]]:
        if self.alias_resolver is None or record_class == "Exposure":
            return []
        matches = self.alias_resolver.resolve_exact(search)
        accessions = list(dict.fromkeys(str(row["accession"]) for row in matches))
        if not accessions:
            return []
        placeholders = ",".join("?" for _ in accessions)
        parameters: list[object] = [*accessions]
        class_clause = ""
        if record_class:
            class_clause = " AND class=?"
            parameters.append(record_class)
        rows = connection.execute(
            f"""SELECT * FROM protein
                WHERE source_accession IN ({placeholders}){class_clause}""",
            parameters,
        ).fetchall()
        by_accession: dict[str, list[sqlite3.Row]] = {}
        for row in rows:
            by_accession.setdefault(str(row["source_accession"]), []).append(row)
        ambiguous = len(accessions) > 1
        candidates: list[tuple[sqlite3.Row, dict[str, object]]] = []
        for match in matches:
            for row in sorted(
                by_accession.get(str(match["accession"]), []),
                key=lambda item: (str(item["display_name"]), str(item["portable_id"])),
            ):
                candidates.append(
                    (
                        row,
                        {
                            "query": search,
                            "matched_alias": match["alias"],
                            "match_kind": "canonical_alias",
                            "canonical_gene": match["canonical_gene"],
                            "canonical_accession": match["accession"],
                            "ambiguous": ambiguous,
                        },
                    )
                )
        seen: set[str] = set()
        return [
            (row, match)
            for row, match in candidates
            if not (str(row["portable_id"]) in seen or seen.add(str(row["portable_id"])))
        ]

    def _catalog_proteins(
        self,
        query: dict[str, list[str]],
        *,
        allowed_portable_ids: set[str] | frozenset[str] | None = None,
    ) -> dict[str, object]:
        assert self.parent_catalog is not None
        limit = self._integer(query, "limit", 25, 100)
        offset = self._integer(query, "offset", 0, 100_000)
        record_class = (query.get("class") or [""])[0]
        if record_class and record_class not in {"Human", "Exposure"}:
            raise ExplorerAPIError(422, "class must be Human or Exposure")
        parent_class = (query.get("parent_class") or [""])[0]
        if parent_class and parent_class not in PARENT_CLASSES:
            raise ExplorerAPIError(422, "unsupported parent_class")
        include_optional = self._boolean(query, "include_receptor_germline")
        search = (query.get("q") or [""])[0].strip()
        conditions, condition_parameters = self._catalog_conditions(
            include_receptor_germline=include_optional,
            record_class=record_class,
            parent_class=parent_class,
        )

        if not search:
            with closing(self.parent_catalog.connection()) as catalog:
                where = " AND ".join(conditions)
                if allowed_portable_ids is None:
                    total = int(catalog.execute(
                        "SELECT count(*) FROM canonical_parent WHERE " + where,
                        condition_parameters,
                    ).fetchone()[0])
                    identifiers = [
                        str(row[0])
                        for row in catalog.execute(
                            "SELECT parent_key FROM canonical_parent WHERE " + where
                            + " ORDER BY parent_key LIMIT ? OFFSET ?",
                            [*condition_parameters, limit, offset],
                        )
                    ]
                else:
                    eligible = [
                        str(row[0])
                        for row in catalog.execute(
                            "SELECT parent_key FROM canonical_parent WHERE " + where
                            + " ORDER BY parent_key",
                            condition_parameters,
                        )
                        if str(row[0]) in allowed_portable_ids
                    ]
                    total = len(eligible)
                    identifiers = eligible[offset : offset + limit]
            proteins = self._catalog_page_payloads(
                identifiers,
                include_receptor_germline=include_optional,
            )
            return {
                "schema": SCHEMA,
                "entity_level": "full_protein_parent",
                "total": total,
                "limit": limit,
                "offset": offset,
                "search_mode": "list",
                "proteins": proteins,
            }

        core_order: list[str] = []
        core_rows: dict[str, sqlite3.Row] = {}
        core_matches: dict[str, dict[str, object]] = {}
        search_mode = "prefix"
        with closing(read_only_connection(self.database)) as explorer:
            alias_candidates = self._alias_candidates(explorer, search, record_class)
            for row, match in alias_candidates:
                parent_key = str(row["portable_id"])
                if parent_key not in core_rows:
                    core_order.append(parent_key)
                    core_rows[parent_key] = row
                    core_matches[parent_key] = match

            if ID_RE.fullmatch(search) and search.startswith("P9P"):
                rows = explorer.execute(
                    "SELECT * FROM protein WHERE portable_id=?"
                    + (" AND class=?" if record_class else ""),
                    [search, *([record_class] if record_class else [])],
                ).fetchall()
                search_mode = "portable_id"
            else:
                exact_expression = fts_query(search, prefix=False)
                fts_conditions = ["protein_search MATCH ?"]
                exact_parameters: list[object] = [exact_expression]
                if record_class:
                    fts_conditions.append("p.class=?")
                    exact_parameters.append(record_class)
                fts_where = " AND ".join(fts_conditions)
                exact_total = int(explorer.execute(
                    "SELECT count(*) FROM protein_search s JOIN protein p "
                    "ON p.portable_id=s.portable_id WHERE " + fts_where,
                    exact_parameters,
                ).fetchone()[0])
                expression = exact_expression if exact_total else fts_query(search, prefix=True)
                parameters = [expression, *exact_parameters[1:]]
                normalized = search.casefold()
                rows = explorer.execute(
                    "SELECT p.* FROM protein_search s JOIN protein p "
                    "ON p.portable_id=s.portable_id WHERE " + fts_where
                    + " ORDER BY CASE WHEN lower(p.primary_gene)=? THEN 0 "
                    "WHEN lower(p.display_name)=? THEN 1 "
                    "WHEN lower(p.source_accession)=? THEN 2 ELSE 3 END,"
                    "bm25(protein_search,0.0,1.0,5.0,12.0,2.0,2.0,16.0,10.0),"
                    "p.class,p.display_name,p.portable_id",
                    [*parameters, normalized, normalized, normalized],
                ).fetchall()
                search_mode = (
                    "canonical_alias" if alias_candidates
                    else "exact_token" if exact_total else "prefix"
                )
            for row in rows:
                parent_key = str(row["portable_id"])
                if parent_key not in core_rows:
                    core_order.append(parent_key)
                    core_rows[parent_key] = row

        # Filter every Explorer-ranked P9P through the catalog's release policy
        # without loading or hashing full sequences for the broad candidate set.
        allowed_core: set[str] = set()
        with closing(self.parent_catalog.connection()) as catalog:
            for start in range(0, len(core_order), 700):
                chunk = core_order[start : start + 700]
                if not chunk:
                    continue
                policy_conditions, policy_parameters = self._catalog_conditions(
                    include_receptor_germline=include_optional,
                    record_class=record_class,
                    parent_class=parent_class,
                )
                rows = catalog.execute(
                    "SELECT parent_key FROM canonical_parent WHERE parent_key IN ("
                    + ",".join("?" for _ in chunk) + ") AND "
                    + " AND ".join(policy_conditions),
                    [*chunk, *policy_parameters],
                )
                allowed_core.update(str(row[0]) for row in rows)

            ordered = [parent_key for parent_key in core_order if parent_key in allowed_core]
            seen = set(ordered)
            catalog_conditions, catalog_parameters = self._catalog_conditions(
                include_receptor_germline=include_optional,
                record_class=record_class,
                parent_class=parent_class,
                alias="c",
            )
            exact_rows = catalog.execute(
                "SELECT c.parent_key FROM canonical_parent c WHERE "
                "(c.parent_key=? OR c.accession=?) AND "
                + " AND ".join(catalog_conditions)
                + " ORDER BY c.parent_key",
                [search, search, *catalog_parameters],
            ).fetchall()
            for row in exact_rows:
                parent_key = str(row[0])
                if parent_key not in seen:
                    seen.add(parent_key); ordered.append(parent_key)

            exact_expression = fts_query(search, prefix=False)
            fts_conditions = ["parent_search MATCH ?", *catalog_conditions]
            exact_count = int(catalog.execute(
                "SELECT count(*) FROM parent_search JOIN canonical_parent c USING(parent_key) "
                "WHERE " + " AND ".join(fts_conditions),
                [exact_expression, *catalog_parameters],
            ).fetchone()[0])
            expression = exact_expression if exact_count else fts_query(search, prefix=True)
            catalog_rows = catalog.execute(
                "SELECT c.parent_key FROM parent_search JOIN canonical_parent c USING(parent_key) "
                "WHERE " + " AND ".join(fts_conditions)
                + " ORDER BY bm25(parent_search),c.parent_key",
                [expression, *catalog_parameters],
            )
            for row in catalog_rows:
                parent_key = str(row[0])
                if parent_key not in seen:
                    seen.add(parent_key); ordered.append(parent_key)

        if allowed_portable_ids is not None:
            ordered = [
                parent_key
                for parent_key in ordered
                if parent_key in allowed_portable_ids
            ]
        total = len(ordered)
        page = ordered[offset : offset + limit]
        proteins = self._catalog_page_payloads(
            page,
            include_receptor_germline=include_optional,
        )
        for item in proteins:
            parent_key = str(item["parent_key"])
            if parent_key in core_matches:
                item["search_match"] = core_matches[parent_key]
            elif parent_key not in core_rows:
                item["search_match"] = {
                    "query": search,
                    "match_kind": "canonical_parent_catalog",
                }
        return {
            "schema": SCHEMA,
            "entity_level": "full_protein_parent",
            "total": total,
            "limit": limit,
            "offset": offset,
            "search_mode": search_mode,
            "proteins": proteins,
        }

    def proteins(
        self,
        query: dict[str, list[str]],
        *,
        allowed_portable_ids: set[str] | frozenset[str] | None = None,
    ) -> dict[str, object]:
        if self.parent_catalog is not None:
            return self._catalog_proteins(
                query, allowed_portable_ids=allowed_portable_ids
            )
        limit = self._integer(query, "limit", 25, 100)
        offset = self._integer(query, "offset", 0, 100_000)
        record_class = (query.get("class") or [""])[0]
        if record_class and record_class not in {"Human", "Exposure"}:
            raise ExplorerAPIError(422, "class must be Human or Exposure")
        search = (query.get("q") or [""])[0].strip()
        search_mode = "list"
        summaries: list[dict[str, object]] | None = None
        with closing(read_only_connection(self.database)) as connection:
            if search and ID_RE.fullmatch(search):
                search_mode = "portable_id"
                conditions = ["portable_id=?"]
                parameters: list[object] = [search]
                if record_class:
                    conditions.append("class=?")
                    parameters.append(record_class)
                where = " AND ".join(conditions)
                if allowed_portable_ids is None:
                    total = connection.execute(
                        f"SELECT COUNT(*) FROM protein WHERE {where}", parameters
                    ).fetchone()[0]
                    rows = connection.execute(
                        f"SELECT * FROM protein WHERE {where} ORDER BY portable_id LIMIT ? OFFSET ?",
                        [*parameters, limit, offset],
                    ).fetchall()
                else:
                    eligible = [
                        row for row in connection.execute(
                            f"SELECT * FROM protein WHERE {where} ORDER BY portable_id",
                            parameters,
                        )
                        if str(row["portable_id"]) in allowed_portable_ids
                    ]
                    total = len(eligible)
                    rows = eligible[offset : offset + limit]
            elif search:
                alias_candidates = self._alias_candidates(connection, search, record_class)
                if allowed_portable_ids is not None:
                    alias_candidates = [
                        (row, match)
                        for row, match in alias_candidates
                        if str(row["portable_id"]) in allowed_portable_ids
                    ]
                conditions = ["protein_search MATCH ?"]
                exact_expression = fts_query(search, prefix=False)
                exact_parameters: list[object] = [exact_expression]
                if record_class:
                    conditions.append("p.class=?")
                    exact_parameters.append(record_class)
                alias_ids = [str(row["portable_id"]) for row, _match in alias_candidates]
                if alias_ids:
                    conditions.append(
                        "p.portable_id NOT IN (" + ",".join("?" for _ in alias_ids) + ")"
                    )
                    exact_parameters.extend(alias_ids)
                where = " AND ".join(conditions)
                exact_total = connection.execute(
                    f"SELECT COUNT(*) FROM protein_search s JOIN protein p ON p.portable_id=s.portable_id WHERE {where}",
                    exact_parameters,
                ).fetchone()[0]
                if allowed_portable_ids is not None:
                    exact_ids = connection.execute(
                        f"SELECT p.portable_id FROM protein_search s JOIN protein p ON p.portable_id=s.portable_id WHERE {where}",
                        exact_parameters,
                    )
                    exact_total = sum(
                        str(row[0]) in allowed_portable_ids for row in exact_ids
                    )
                search_mode = "canonical_alias" if alias_candidates else ("exact_token" if exact_total else "prefix")
                expression = exact_expression if exact_total else fts_query(search, prefix=True)
                parameters = [expression]
                if record_class:
                    parameters.append(record_class)
                parameters.extend(alias_ids)
                normalized = search.casefold()
                alias_count = len(alias_candidates)
                ordered_sql = f"""
                    SELECT p.* FROM protein_search s JOIN protein p ON p.portable_id=s.portable_id
                    WHERE {where}
                    ORDER BY
                      CASE
                        WHEN lower(p.primary_gene)=? THEN 0
                        WHEN lower(p.display_name)=? THEN 1
                        WHEN lower(p.source_accession)=? THEN 2
                        ELSE 3
                      END,
                      bm25(protein_search,0.0,1.0,5.0,12.0,2.0,2.0,16.0,10.0),
                      p.class,p.display_name,p.portable_id
                """
                if allowed_portable_ids is None:
                    total = exact_total if exact_total else connection.execute(
                        f"SELECT COUNT(*) FROM protein_search s JOIN protein p ON p.portable_id=s.portable_id WHERE {where}",
                        parameters,
                    ).fetchone()[0]
                    alias_page = alias_candidates[offset : offset + limit]
                    remaining = limit - len(alias_page)
                    fts_offset = max(0, offset - alias_count)
                    fts_rows = connection.execute(
                        ordered_sql + " LIMIT ? OFFSET ?",
                        [*parameters, normalized, normalized, normalized, remaining, fts_offset],
                    ).fetchall()
                    total += alias_count
                    summaries = []
                    for row, match in alias_page:
                        item = self._summary(row)
                        item["search_match"] = match
                        summaries.append(item)
                    summaries.extend(self._summary(row) for row in fts_rows)
                else:
                    fts_rows = [
                        row for row in connection.execute(
                            ordered_sql,
                            [*parameters, normalized, normalized, normalized],
                        )
                        if str(row["portable_id"]) in allowed_portable_ids
                    ]
                    ordered_rows: list[tuple[sqlite3.Row, dict[str, object] | None]] = [
                        (row, match) for row, match in alias_candidates
                    ]
                    ordered_rows.extend((row, None) for row in fts_rows)
                    total = len(ordered_rows)
                    summaries = []
                    for row, match in ordered_rows[offset : offset + limit]:
                        item = self._summary(row)
                        if match is not None:
                            item["search_match"] = match
                        summaries.append(item)
            else:
                where = "WHERE class=?" if record_class else ""
                parameters = [record_class] if record_class else []
                if allowed_portable_ids is None:
                    total = connection.execute(f"SELECT COUNT(*) FROM protein {where}", parameters).fetchone()[0]
                    rows = connection.execute(
                        f"SELECT * FROM protein {where} ORDER BY class,display_name,portable_id LIMIT ? OFFSET ?",
                        [*parameters, limit, offset],
                    ).fetchall()
                else:
                    eligible = [
                        row for row in connection.execute(
                            f"SELECT * FROM protein {where} ORDER BY class,display_name,portable_id",
                            parameters,
                        )
                        if str(row["portable_id"]) in allowed_portable_ids
                    ]
                    total = len(eligible)
                    rows = eligible[offset : offset + limit]
        return {
            "schema": SCHEMA,
            "entity_level": "full_protein_parent",
            "total": total,
            "limit": limit,
            "offset": offset,
            "search_mode": search_mode,
            "proteins": summaries if summaries is not None else [self._summary(row) for row in rows],
        }

    def protein(
        self,
        portable_id: str,
        *,
        include_receptor_germline: bool = False,
    ) -> dict[str, object]:
        if self.parent_catalog is not None:
            parent = self.parent_catalog.get(
                portable_id,
                include_receptor_germline=include_receptor_germline,
            )
            if parent is None:
                raise ExplorerAPIError(404, "Protein not found")
            with closing(read_only_connection(self.database)) as connection:
                core = connection.execute(
                    "SELECT * FROM protein WHERE portable_id=?", (portable_id,)
                ).fetchone()
                aliases = (
                    [dict(item) for item in connection.execute(
                        "SELECT alias_kind,alias_value,source,occurrences FROM protein_alias "
                        "WHERE portable_id=? ORDER BY alias_kind,occurrences DESC,alias_value",
                        (portable_id,),
                    )]
                    if core is not None else []
                )
                projection_summary = (
                    [dict(item) for item in connection.execute(
                        "SELECT home_partition,relationship_class,projection_count,"
                        "distinct_tile_count,min_target_start0,max_target_end0 "
                        "FROM protein_projection_summary WHERE portable_id=? "
                        "ORDER BY home_partition,relationship_class",
                        (portable_id,),
                    )]
                    if core is not None else []
                )
            with closing(self.parent_catalog.connection()) as catalog_connection:
                alias_row = catalog_connection.execute(
                    "SELECT aliases FROM parent_alias WHERE parent_key=?", (portable_id,)
                ).fetchone()
            protein = self._catalog_payload(parent, core, include_sequence=True)
            protein["aliases"] = aliases
            protein["canonical_alias_text"] = "" if alias_row is None else alias_row[0]
            protein["projection_summary"] = projection_summary
            return {
                "schema": SCHEMA,
                "entity_level": "full_protein_parent",
                "protein": protein,
            }
        with closing(read_only_connection(self.database)) as connection:
            row = connection.execute("SELECT * FROM protein WHERE portable_id=?", (portable_id,)).fetchone()
            if row is None:
                raise ExplorerAPIError(404, "Protein not found")
            aliases = [dict(item) for item in connection.execute(
                """
                SELECT alias_kind,alias_value,source,occurrences FROM protein_alias
                WHERE portable_id=? ORDER BY alias_kind,occurrences DESC,alias_value
                """,
                (portable_id,),
            )]
            projection_summary = [dict(item) for item in connection.execute(
                """
                SELECT home_partition,relationship_class,projection_count,distinct_tile_count,
                       min_target_start0,max_target_end0
                FROM protein_projection_summary WHERE portable_id=?
                ORDER BY home_partition,relationship_class
                """,
                (portable_id,),
            )]
        protein = self._summary(row)
        protein.update(
            {
                "source_header": row["source_header"],
                "companion_header": row["companion_header"],
                "sequence": row["sequence"],
                "sequence_sha256": row["sequence_sha256"],
                "noncanonical_residue_count": row["noncanonical_residue_count"],
                "aliases": aliases,
                "projection_summary": projection_summary,
            }
        )
        return {"schema": SCHEMA, "entity_level": "full_protein_parent", "protein": protein}

    def projections(
        self,
        portable_id: str,
        query: dict[str, list[str]],
        *,
        include_receptor_germline: bool = False,
    ) -> dict[str, object]:
        limit = self._integer(query, "limit", 100, 500)
        offset = self._integer(query, "offset", 0, 1_000_000)
        partition = (query.get("partition") or [""])[0]
        relationship = (query.get("relationship_class") or [""])[0]
        conditions = ["x.portable_id=?"]
        parameters: list[object] = [portable_id]
        if partition:
            conditions.append("x.home_partition=?")
            parameters.append(partition)
        if relationship:
            if relationship not in {"parent_membership", "sequence_equivalence"}:
                raise ExplorerAPIError(422, "unsupported relationship_class")
            conditions.append("x.relationship_class=?")
            parameters.append(relationship)
        where = " AND ".join(conditions)
        parent = None
        if self.parent_catalog is not None:
            parent = self.parent_catalog.get(
                portable_id,
                include_receptor_germline=include_receptor_germline,
            )
            if parent is None:
                raise ExplorerAPIError(404, "Protein not found")
            if int(parent["mapped_tile_count"]) == 0:
                return {
                    "schema": SCHEMA,
                    "entity_level": "tile_projection",
                    "portable_id": portable_id,
                    "parent_key": portable_id,
                    "total": 0,
                    "limit": limit,
                    "offset": offset,
                    "projections": [],
                    "observation_warning": "Projection rows annotate physical tiles; they do not create independent assay observations.",
                }
        with closing(read_only_connection(self.database)) as connection:
            if connection.execute("SELECT 1 FROM protein WHERE portable_id=?", (portable_id,)).fetchone() is None:
                raise ExplorerAPIError(404, "Protein not found")
            total = connection.execute(f"SELECT COUNT(*) FROM projection x WHERE {where}", parameters).fetchone()[0]
            rows = connection.execute(
                f"""
                SELECT x.*,t.cdi_seqid,t.source_partition
                FROM projection x JOIN tile t USING(cdi_accession)
                WHERE {where}
                ORDER BY x.target_start0,x.target_end0,x.cdi_accession,x.source_row_number,x.target_ordinal
                LIMIT ? OFFSET ?
                """,
                [*parameters, limit, offset],
            ).fetchall()
        return {
            "schema": SCHEMA,
            "entity_level": "tile_projection",
            "portable_id": portable_id,
            "parent_key": portable_id if parent is not None else None,
            "total": total,
            "limit": limit,
            "offset": offset,
            "projections": [dict(row) for row in rows],
            "observation_warning": "Projection rows annotate physical tiles; they do not create independent assay observations.",
        }


__all__ = ["ExplorerAPI", "ExplorerAPIError"]
