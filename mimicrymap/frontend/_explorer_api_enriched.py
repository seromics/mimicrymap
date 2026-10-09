"""Enriched Explorer API: native annotations and crosswalk provenance."""

from __future__ import annotations

import re
from contextlib import closing
from urllib.parse import parse_qs, unquote, urlparse

from explorer_annotations import native_annotations
from _explorer_api_base import ExplorerAPI as BaseExplorerAPI
from _explorer_api_base import ExplorerAPIError, ID_RE, read_only_connection


def _table_exists(connection, name: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


class ExplorerAPI(BaseExplorerAPI):
    def dispatch(self, handler, *, head_only: bool = False) -> bool:
        path = urlparse(handler.path).path.rstrip("/")
        match = re.fullmatch(
            r"/api/explorer/proteins/([^/]+)/(annotations|variant-projections)", path
        )
        if match is None:
            return super().dispatch(handler, head_only=head_only)
        portable_id = unquote(match.group(1))
        if not ID_RE.fullmatch(portable_id):
            self._send(
                handler,
                422,
                {"schema": "mimicryone/error/1", "status": 422, "error": "portable_id must match P9P or M1E plus nine digits"},
                head_only,
            )
            return True
        try:
            query = parse_qs(
                urlparse(handler.path).query,
                keep_blank_values=True,
                max_num_fields=8,
            )
            include_optional = self._boolean(query, "include_receptor_germline")
            if match.group(2) == "annotations":
                payload = self.annotations(
                    portable_id,
                    include_receptor_germline=include_optional,
                )
            else:
                payload = self.variant_projections(
                    portable_id,
                    query,
                    include_receptor_germline=include_optional,
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

    def annotations(
        self,
        portable_id: str,
        *,
        include_receptor_germline: bool = False,
    ) -> dict[str, object]:
        """Return native annotation tracks without going through HTTP dispatch."""

        parent = (
            self.parent_catalog.get(
                portable_id,
                include_receptor_germline=include_receptor_germline,
            )
            if self.parent_catalog is not None
            else None
        )
        if self.parent_catalog is not None and parent is None:
            raise ExplorerAPIError(404, "Protein not found")
        with closing(read_only_connection(self.database)) as connection:
            core_exists = (
                connection.execute(
                    "SELECT 1 FROM protein WHERE portable_id=?", (portable_id,)
                ).fetchone()
                is not None
            )
            variant_projection_exists = _table_exists(
                connection, "variant_projection"
            )
        if (
            (not core_exists and parent is not None)
            or (core_exists and not variant_projection_exists)
        ):
            return {
                "schema": "mimicryone/panscan9-native-annotations/1",
                "protein_id": portable_id,
                "annotations": {"variants": [], "variant_intervals": []},
                "annotation_sources": {},
                "diagnostics": {
                    "projection_rows": 0,
                    "native_missense_rows": 0,
                    "native_variants_deduplicated": 0,
                    "variant_projection_table_available": variant_projection_exists,
                },
            }
        try:
            return native_annotations(self.database, portable_id)
        except KeyError as error:
            raise ExplorerAPIError(404, "Protein not found") from error

    def protein(
        self,
        portable_id: str,
        *,
        include_receptor_germline: bool = False,
    ) -> dict[str, object]:
        payload = super().protein(
            portable_id,
            include_receptor_germline=include_receptor_germline,
        )
        with closing(read_only_connection(self.database)) as connection:
            crosswalk = (
                [dict(row) for row in connection.execute(
                    """
                    SELECT alias_kind,alias_value,source_id,source_record_key,mapping_basis,
                           sequence_identity_status,conflict_status,is_preferred,occurrences
                    FROM annotation_crosswalk WHERE portable_id=?
                    ORDER BY is_preferred DESC,alias_kind,source_id,alias_value
                    """,
                    (portable_id,),
                )]
                if _table_exists(connection, "annotation_crosswalk") else []
            )
            variant_summary = (
                dict(connection.execute(
                    """
                    SELECT COUNT(*) AS projection_rows,
                           COUNT(DISTINCT cdi_accession) AS distinct_tiles,
                           COUNT(DISTINCT variant_entity) AS distinct_variant_entities,
                           MIN(target_start0) AS min_target_start0,
                           MAX(target_end0) AS max_target_end0
                    FROM variant_projection WHERE portable_id=?
                    """,
                    (portable_id,),
                ).fetchone())
                if _table_exists(connection, "variant_projection")
                else {
                    "projection_rows": 0,
                    "distinct_tiles": 0,
                    "distinct_variant_entities": 0,
                    "min_target_start0": None,
                    "max_target_end0": None,
                }
            )
        payload["protein"]["annotation_crosswalk"] = crosswalk
        payload["protein"]["humsavar_projection_summary"] = variant_summary
        return payload

    def variant_projections(
        self,
        portable_id: str,
        query: dict[str, list[str]],
        *,
        include_receptor_germline: bool = False,
    ) -> dict[str, object]:
        limit = self._integer(query, "limit", 100, 500)
        offset = self._integer(query, "offset", 0, 1_000_000)
        parent = None
        if self.parent_catalog is not None:
            parent = self.parent_catalog.get(
                portable_id,
                include_receptor_germline=include_receptor_germline,
            )
            if parent is None:
                raise ExplorerAPIError(404, "Protein not found")
        with closing(read_only_connection(self.database)) as connection:
            core_exists = connection.execute(
                "SELECT 1 FROM protein WHERE portable_id=?", (portable_id,)
            ).fetchone() is not None
            if not core_exists and parent is None:
                raise ExplorerAPIError(404, "Protein not found")
            if not core_exists or not _table_exists(connection, "variant_projection"):
                total = 0
                rows = []
            else:
                total = connection.execute(
                    "SELECT COUNT(*) FROM variant_projection WHERE portable_id=?", (portable_id,)
                ).fetchone()[0]
                rows = [
                    dict(row)
                    for row in connection.execute(
                        """
                        SELECT * FROM variant_projection WHERE portable_id=?
                        ORDER BY target_start0,target_end0,cdi_accession LIMIT ? OFFSET ?
                        """,
                        (portable_id, limit, offset),
                    )
                ]
        return {
            "schema": "mimicryone/panscan9-protein-explorer/1",
            "entity_level": "humsavar_tile_projection",
            "portable_id": portable_id,
            "parent_key": portable_id if parent is not None else None,
            "total": total,
            "limit": limit,
            "offset": offset,
            "projections": rows,
            "observation_warning": "These are track annotations; they do not create proteins or independent assay observations.",
        }


__all__ = ["ExplorerAPI"]
