"""Browser-UI compatibility, availability guards, and bounded scan routes."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from copy import deepcopy
from typing import Any, Mapping
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from analysis_api import AnalysisAPI as _AnalysisAPI
from analysis_api import (
    APIError,
    AnalysisConfigurationError,
    _read_only_connection,
    _send_json,
)
from analysis_scan import AnalysisScanService


EXPECTED_EDGE_SCHEMA = "mimicryone/analysis-ready-edges-lean/2"
FRONTEND_ROUTE_PLAN_SCHEMA = "mimicryone/frontend-route-plan/1"
CANONICAL_SELECTORS = {
    "panscan9_human": "protein:panscan9_human",
    "panscan9_exposure": "protein:panscan9_exposure",
}
EXPECTED_PLANNED_COMPARISONS = 18
EXPECTED_AUTHORIZED_COMPARISONS = 17
EXPECTED_BASE_DIRECTIONS = 31
EXPECTED_CANONICAL_VIEWS = 25
EXPECTED_FRONTEND_VIEWS = 56

# Presentation-only names keyed by immutable analysis library IDs. These must
# never participate in catalog identity, release fingerprints, or routing.
LIBRARY_DISPLAY_LABELS = {
    "human_current": "HuScan",
    "huprot4": "HuProt 4.0",
    "panscan9_dark": "PanScan9 Dark",
    "panscan9_exposure": "PanScan9 Exposure",
    "panscan9_human": "PanScan9 Human",
    "panscan9_variant": "PanScan9 Variant",
    "virscan_exposome_current": "VirScan Exposome",
}


class AnalysisAPI(_AnalysisAPI):
    """Expose concise UI parameters while preserving the strict canonical API."""

    def __init__(self, analysis_db):
        super().__init__(analysis_db)
        ready_metadata = {}
        for comparison in self.comparisons.values():
            metadata = self._probe_comparison_ready(comparison)
            if metadata is not None:
                ready_metadata[comparison.key] = metadata
        self._ready_comparison_metadata = ready_metadata
        self._ready_comparison_keys = frozenset(ready_metadata)
        self.enforce_live_comparison_matrix = True
        self.scan_service = AnalysisScanService(self)
        self._cached_meta = {}
        self._rebuild_cached_meta()

    def _probe_comparison_ready(self, comparison):
        """Validate one immutable shard once during API startup."""

        try:
            with closing(_read_only_connection(self._shard_path(comparison))) as connection:
                self._assert_complete_shard(connection)
                metadata = dict(connection.execute("SELECT key,value FROM meta"))
        except (FileNotFoundError, OSError, sqlite3.Error, APIError):
            return None
        ready = (
            metadata.get("schema") == EXPECTED_EDGE_SCHEMA
            and metadata.get("release_fingerprint") == self.manifest.get("release_fingerprint")
            and metadata.get("comparison_key") == comparison.key
            and metadata.get("library_a") == comparison.library_a
            and metadata.get("library_b") == comparison.library_b
            and bool(metadata.get("completed_at"))
        )
        return metadata if ready else None

    def _comparison_ready(self, comparison) -> bool:
        """Return startup-validated readiness for the fingerprinted immutable release."""

        return comparison.key in self._ready_comparison_keys

    def _comparison(self, query):
        comparison = super()._comparison(query)
        if not self._comparison_ready(comparison):
            raise APIError(409, "Comparison is planned but not finalized")
        return comparison

    def _comparison_key_for_libraries(self, library_a: str, library_b: str) -> str | None:
        matches = []
        for comparison in self.comparisons.values():
            if comparison.library_a == comparison.library_b:
                valid = library_a == library_b == comparison.library_a
            else:
                valid = {library_a, library_b} == {
                    comparison.library_a,
                    comparison.library_b,
                }
            if valid and self._comparison_ready(comparison):
                matches.append(comparison.key)
        return matches[0] if len(matches) == 1 else None

    def _comparison_key_for_antigens(self, antigen_a: str, antigen_b: str) -> str | None:
        try:
            identifiers = (int(antigen_a), int(antigen_b))
        except (TypeError, ValueError):
            return None
        with closing(_read_only_connection(self.catalog_path)) as connection:
            rows = list(
                connection.execute(
                    "SELECT antigen_id,library_key FROM antigen WHERE antigen_id IN (?,?)",
                    identifiers,
                )
            )
        if len(rows) != 2:
            return None
        libraries = {int(row["antigen_id"]): row["library_key"] for row in rows}
        return self._comparison_key_for_libraries(
            libraries.get(identifiers[0], ""), libraries.get(identifiers[1], "")
        )

    def _rewrite_ui_query(self, path: str, query: dict[str, list[str]]) -> None:
        if path.endswith("/antigens") and query.get("offset") == ["0"]:
            query.pop("offset", None)

        if path.endswith("/edges") or path.endswith("/export.csv"):
            if query.get("offset") == ["0"]:
                query.pop("offset", None)
            library_a = (query.pop("library_a", [""])[0] or "").strip()
            library_b = (query.pop("library_b", [""])[0] or "").strip()
            if "comparison" not in query and library_a and library_b:
                key = self._comparison_key_for_libraries(library_a, library_b)
                if key:
                    query["comparison"] = [key]

        if path.endswith("/pair"):
            if "antigen_a" not in query and "a" in query:
                query["antigen_a"] = query.pop("a")
            if "antigen_b" not in query and "b" in query:
                query["antigen_b"] = query.pop("b")
            if "comparison" not in query:
                antigen_a = (query.get("antigen_a") or [""])[0]
                antigen_b = (query.get("antigen_b") or [""])[0]
                key = self._comparison_key_for_antigens(antigen_a, antigen_b)
                if key:
                    query["comparison"] = [key]

    def dispatch(self, handler, *, head_only: bool = False):
        parsed_route = urlsplit(handler.path)
        route_path = parsed_route.path.rstrip("/") or "/"
        if route_path == "/api/analysis/route-plan":
            if parsed_route.query:
                _send_json(
                    handler,
                    400,
                    {"error": "The frontend route plan does not accept parameters"},
                    head_only=head_only,
                )
            else:
                try:
                    _send_json(
                        handler,
                        200,
                        self._frontend_route_plan(),
                        head_only=head_only,
                    )
                except APIError as error:
                    _send_json(
                        handler,
                        error.status,
                        {"error": error.message},
                        head_only=head_only,
                    )
            return True
        if self.scan_service.dispatch(handler, head_only=head_only):
            return True
        original_path = handler.path
        parsed = urlsplit(original_path)
        path = parsed.path
        if path.startswith("/api/analysis/edges.csv"):
            path = path.replace("/api/analysis/edges.csv", "/api/analysis/export.csv", 1)
        query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=32)
        self._rewrite_ui_query(path, query)
        handler.path = urlunsplit((parsed.scheme, parsed.netloc, path, urlencode(query, doseq=True), parsed.fragment))
        try:
            return super().dispatch(handler, head_only=head_only)
        finally:
            handler.path = original_path

    def _build_meta(self):
        payload = super()._meta()
        for library in payload.get("libraries", []):
            library["label"] = LIBRARY_DISPLAY_LABELS.get(
                library.get("key"), library.get("label")
            )
        planned = []
        queryable = []
        exclusion_policy = getattr(self, "comparison_exclusions", None)
        for row in payload.get("comparisons", []):
            item = dict(row)
            comparison = self.comparisons.get(item.get("key"))
            exclusion = (
                exclusion_policy.row(item.get("key"))
                if exclusion_policy is not None
                else None
            )
            ready = (
                comparison is not None
                and exclusion is None
                and self._comparison_ready(comparison)
            )
            item["queryable"] = ready
            if ready:
                item["status"] = "complete"
                queryable.append(item)
            elif exclusion is not None:
                item["status"] = "excluded"
                item["exclusion"] = exclusion
            elif item.get("status") == "complete":
                item["status"] = "unavailable"
            planned.append(item)
        payload["planned_comparisons"] = planned
        payload["comparisons"] = queryable
        payload["comparison_count_planned"] = len(planned)
        payload["comparison_count_queryable"] = len(queryable)
        payload["comparison_exclusions"] = (
            exclusion_policy.capabilities(len(planned))
            if exclusion_policy is not None
            else {"available": False, "excluded_count": 0}
        )
        payload["antigen_count"] = sum(int(row.get("records", 0)) for row in payload["libraries"])

        capabilities = self.scan_service.capabilities(payload["libraries"])
        payload["entity_level"] = "assay_antigen"
        payload["record_contract"] = capabilities["record_contract"]
        payload["compute_capabilities"] = capabilities
        for library in payload["libraries"]:
            library["entity_level"] = "assay_antigen"
            library["live_index"] = capabilities["libraries"].get(
                library["key"],
                {"available": False, "reason": "unknown_library"},
            )
        parent_catalog = getattr(self, "parent_catalog", None)
        if parent_catalog is not None:
            parent_capabilities = deepcopy(parent_catalog.capabilities())
            payload["canonical_projection"] = {
                "status": "available",
                "target_kind": "canonical_proteome",
                "floor": 7,
                "available_floors": [7],
                "catalog_schema": parent_capabilities.get("schema"),
                "catalog_release_id": parent_capabilities.get("release_id"),
                "default_counts": {
                    "panscan9_human": 20_563,
                    "panscan9_exposure": 8_827,
                },
                "zero_projection_overlay_counts": {
                    "panscan9_human": 23,
                    "panscan9_exposure": 29,
                },
                "strategy": "mapped_static_tile_projection_plus_atomic_exact_zero_projection_overlay",
                "filters": "unsupported_until_zero_projection_annotations_are_authoritative",
                "complete_or_explicit_error": True,
                "optional_receptor_germline_default": False,
                "excluded_from_full_protein_space": ["panscan9_dark", "panscan9_variant"],
                "raw_tile_warning": (
                    "target.kind=library selects native assay/tile entries; it is distinct "
                    "from the canonical Human and Exposure parent proteomes."
                ),
            }
        else:
            payload["canonical_projection"] = {
                "status": "not_available",
                "current_catalog": "assay_antigen_ids_and_full_seqids_only",
                "excluded_from_full_protein_space": ["panscan9_dark", "panscan9_variant"],
                "warning": "The release-bound canonical parent catalog is unavailable.",
            }
        payload["static_player"] = {
            "route": "/api/analysis/player",
            "available": hasattr(self, "player_service"),
            "floor": 7,
            "available_floors": [7, 8, 9],
            "mode": "precomputed_player",
            "whole_library_live_scan": False,
        }
        membership = getattr(self, "membership", None)
        source_filters = (
            deepcopy(membership.capabilities())
            if membership is not None
            else {"available": False, "libraries": {}}
        )
        for key, options in source_filters.get("libraries", {}).items():
            if isinstance(options, dict) and key in LIBRARY_DISPLAY_LABELS:
                options["label"] = LIBRARY_DISPLAY_LABELS[key]
        payload["source_filters"] = source_filters
        payload["canonical_parent_catalog_available"] = parent_catalog is not None
        payload["canonical_parent_catalog"] = (
            deepcopy(parent_catalog.capabilities())
            if parent_catalog is not None
            else {"available": False}
        )
        return payload

    @staticmethod
    def _route_orientation(
        source_library: str,
        target_library: str,
        comparison: Mapping[str, Any],
    ) -> tuple[str, str]:
        library_a = str(comparison.get("library_a") or "")
        library_b = str(comparison.get("library_b") or "")
        if library_a == library_b == source_library == target_library:
            return "self", "primary_key"
        if source_library == library_a and target_library == library_b:
            return "a_to_b", "primary_key"
        if source_library == library_b and target_library == library_a:
            return "b_to_a", "edge_by_b"
        raise APIError(503, "Frontend route plan comparison orientation differs")

    def _frontend_route_plan(self) -> dict[str, Any]:
        """Return the bounded selector-to-engine inventory for the mounted release."""

        meta = self._meta()
        planned = meta.get("planned_comparisons")
        authorized = meta.get("comparisons")
        exclusions = meta.get("comparison_exclusions")
        if (
            not isinstance(planned, list)
            or not isinstance(authorized, list)
            or not isinstance(exclusions, Mapping)
        ):
            raise APIError(503, "Frontend route plan comparison metadata differs")
        planned_count = len(planned)
        authorized_count = len(authorized)
        excluded_count = int(exclusions.get("excluded_count", 0))
        if (
            exclusions.get("planned_count", planned_count) != planned_count
            or exclusions.get("authorized_count", authorized_count)
            != authorized_count
            or planned_count != authorized_count + excluded_count
        ):
            raise APIError(503, "Frontend route plan comparison census differs")

        modes = meta.get("compute_capabilities", {}).get("modes", {})
        raw_mode = modes.get("live", {}) if isinstance(modes, Mapping) else {}
        canonical_mode = (
            modes.get("canonical_proteome_index", {})
            if isinstance(modes, Mapping)
            else {}
        )
        orphan_mode = (
            modes.get("canonical_parent_live7", {})
            if isinstance(modes, Mapping)
            else {}
        )
        library_ids = {
            str(row.get("key"))
            for row in meta.get("libraries", [])
            if isinstance(row, Mapping) and row.get("key")
        }
        strict_r3_contract = set(CANONICAL_SELECTORS).issubset(library_ids)
        raw_floors = sorted({int(value) for value in raw_mode.get("floors", [])})
        raw_libraries = set(raw_mode.get("available_target_libraries", []))
        if meta.get("static_player", {}).get("available") is not True:
            raise APIError(503, "Frontend route plan engine capabilities differ")
        if strict_r3_contract and (
            planned_count != EXPECTED_PLANNED_COMPARISONS
            or authorized_count != EXPECTED_AUTHORIZED_COMPARISONS
            or excluded_count != 1
            or raw_floors != [5, 6]
            or raw_libraries != library_ids
            or canonical_mode.get("available") is not True
            or sorted({int(value) for value in canonical_mode.get("floors", [])})
            != [5, 6, 7]
            or orphan_mode.get("available") is not True
            or orphan_mode.get("floor") != 7
            or set(orphan_mode.get("available_target_libraries", []))
            != library_ids
        ):
            raise APIError(503, "Frontend route plan engine capabilities differ")
        canonical_virtual_enabled = strict_r3_contract

        filter_libraries = set(
            meta.get("source_filters", {}).get("libraries", {})
            if isinstance(meta.get("source_filters"), Mapping)
            else {}
        )
        views: list[dict[str, Any]] = []

        def add_view(
            *,
            row_kind: str,
            source_selector: str,
            target_selector: str,
            source_library: str,
            target_library: str,
            comparison: Mapping[str, Any],
            orientation: str,
            lookup_endpoint: str,
        ) -> None:
            source_canonical = source_selector.startswith("protein:")
            target_canonical = target_selector.startswith("protein:")
            if target_canonical:
                live_floors = [5, 6, 7]
                live_service = "canonical_parent_index"
                static_status = (
                    "ready_mapped_static_or_orphan_canonical_index_7"
                    if source_canonical
                    else "ready_for_mapped_queries_static_plus_exact_overlay"
                )
                static_strategy = (
                    "mapped_static_projection_or_canonical_parent_index"
                    if source_canonical
                    else "mapped_static_projection_plus_exact_overlay"
                )
            elif source_canonical:
                live_floors = []
                live_service = "none"
                static_status = "ready_mapped_static_or_orphan_exact_live7"
                static_strategy = (
                    "mapped_static_projection_or_canonical_parent_live7"
                )
            else:
                live_floors = (
                    raw_floors if target_library in raw_libraries else []
                )
                live_service = (
                    "raw_library_index" if live_floors else "none"
                )
                static_status = "ready"
                static_strategy = "precomputed_player"

            required_engines = [{"engine": "precomputed_player", "floor": 7}]
            if source_canonical and not target_canonical:
                required_engines.append(
                    {"engine": "canonical_parent_live7", "floor": 7}
                )
            elif live_service != "none":
                required_engines.extend(
                    {"engine": live_service, "floor": floor}
                    for floor in live_floors
                )

            views.append(
                {
                    "row_kind": row_kind,
                    "direction_id": f"{source_selector}->{target_selector}",
                    "antigen_target_selector": source_selector,
                    "mimicry_parent_selector": target_selector,
                    "source_library": source_library,
                    "target_library": target_library,
                    "stored_comparison_id": str(comparison.get("key") or ""),
                    "stored_orientation": orientation,
                    "lookup_endpoint": lookup_endpoint,
                    "source_entity_level": (
                        "canonical_parent" if source_canonical else "assay_antigen"
                    ),
                    "target_entity_level": (
                        "canonical_parent" if target_canonical else "assay_antigen"
                    ),
                    "static_7_status": static_status,
                    "static_7_strategy": static_strategy,
                    "indexed_live_floors": live_floors,
                    "live_service": live_service,
                    "required_engines": required_engines,
                    "scope_filters_supported": (
                        not target_canonical and target_library in filter_libraries
                    ),
                    "optional_receptor_germline_default": False,
                    "complete": True,
                    "no_partial_results": True,
                }
            )

        for comparison in authorized:
            if (
                not isinstance(comparison, Mapping)
                or comparison.get("queryable") is not True
                or comparison.get("status") != "complete"
            ):
                raise APIError(503, "Frontend route plan contains an unavailable comparison")
            library_a = str(comparison.get("library_a") or "")
            library_b = str(comparison.get("library_b") or "")
            orientations = [(library_a, library_b)]
            if library_a != library_b:
                orientations.append((library_b, library_a))
            for source_library, target_library in orientations:
                orientation, lookup_endpoint = self._route_orientation(
                    source_library,
                    target_library,
                    comparison,
                )
                source_raw = f"library:{source_library}"
                target_raw = f"library:{target_library}"
                add_view(
                    row_kind="base_direction",
                    source_selector=source_raw,
                    target_selector=target_raw,
                    source_library=source_library,
                    target_library=target_library,
                    comparison=comparison,
                    orientation=orientation,
                    lookup_endpoint=lookup_endpoint,
                )
                source_canonical = (
                    CANONICAL_SELECTORS.get(source_library)
                    if canonical_virtual_enabled
                    else None
                )
                target_canonical = (
                    CANONICAL_SELECTORS.get(target_library)
                    if canonical_virtual_enabled
                    else None
                )
                if source_canonical is not None:
                    add_view(
                        row_kind="canonical_antigen_target_view",
                        source_selector=source_canonical,
                        target_selector=target_raw,
                        source_library=source_library,
                        target_library=target_library,
                        comparison=comparison,
                        orientation=orientation,
                        lookup_endpoint=lookup_endpoint,
                    )
                if target_canonical is not None:
                    add_view(
                        row_kind="canonical_parent_view",
                        source_selector=source_raw,
                        target_selector=target_canonical,
                        source_library=source_library,
                        target_library=target_library,
                        comparison=comparison,
                        orientation=orientation,
                        lookup_endpoint=lookup_endpoint,
                    )
                if source_canonical is not None and target_canonical is not None:
                    add_view(
                        row_kind="canonical_both_view",
                        source_selector=source_canonical,
                        target_selector=target_canonical,
                        source_library=source_library,
                        target_library=target_library,
                        comparison=comparison,
                        orientation=orientation,
                        lookup_endpoint=lookup_endpoint,
                    )

        row_counts = {
            kind: sum(row["row_kind"] == kind for row in views)
            for kind in {
                "base_direction",
                "canonical_antigen_target_view",
                "canonical_parent_view",
                "canonical_both_view",
            }
        }
        view_ids = [row["direction_id"] for row in views]
        expected_base_directions = sum(
            1 if row.get("library_a") == row.get("library_b") else 2
            for row in authorized
        )
        canonical_virtual_count = sum(
            count
            for kind, count in row_counts.items()
            if kind != "base_direction"
        )
        if (
            len(view_ids) != len(set(view_ids))
            or row_counts["base_direction"] != expected_base_directions
        ):
            raise APIError(503, "Frontend route plan view census differs")
        if strict_r3_contract and (
            len(view_ids) != EXPECTED_FRONTEND_VIEWS
            or row_counts["base_direction"] != EXPECTED_BASE_DIRECTIONS
            or canonical_virtual_count != EXPECTED_CANONICAL_VIEWS
            or row_counts["canonical_antigen_target_view"] != 11
            or row_counts["canonical_parent_view"] != 11
            or row_counts["canonical_both_view"] != 3
        ):
            raise APIError(503, "Frontend route plan view census differs")

        return {
            "schema": FRONTEND_ROUTE_PLAN_SCHEMA,
            "release_id": str(meta.get("release_id") or ""),
            "release_fingerprint": str(meta.get("release_fingerprint") or ""),
            "planned_physical_count": planned_count,
            "authorized_physical_count": authorized_count,
            "excluded_count": excluded_count,
            "base_direction_count": expected_base_directions,
            "canonical_virtual_count": canonical_virtual_count,
            "frontend_view_count": len(views),
            "views": views,
        }

    def _rebuild_cached_meta(self):
        self._cached_meta = self._build_meta()

    def _meta(self):
        return deepcopy(self._cached_meta)

    def _edges(self, query):
        payload = super()._edges(query)
        for edge in payload.get("edges", []):
            antigen_a = edge.get("antigen_a", {})
            antigen_b = edge.get("antigen_b", {})
            edge["a"] = antigen_a
            edge["b"] = antigen_b
            edge["antigen_a_id"] = antigen_a.get("antigen_id")
            edge["antigen_b_id"] = antigen_b.get("antigen_id")
            edge["seqid_a"] = antigen_a.get("seqid")
            edge["seqid_b"] = antigen_b.get("seqid")
        return payload


__all__ = ["AnalysisAPI", "AnalysisConfigurationError"]
