"""Federate read-only Explorer releases while preserving component identity."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import OrderedDict
from contextlib import closing
from copy import deepcopy
from typing import Any, Mapping
from urllib.parse import parse_qs, unquote, urlparse

from _explorer_api_base import ExplorerAPIError, ID_RE, read_only_connection
from analysis_membership import MembershipFilterError
from explorer_analysis_crosswalk import (
    CROSSWALK_SCHEMA,
    ExplorerAnalysisCrosswalk,
)


COMPOSITE_SCHEMA = "mimicryone/protein-explorer-composite/1"


def _fingerprint(rows: list[dict[str, str]]) -> str:
    encoded = json.dumps(
        {
            "kind": "explorer",
            "components": rows,
            "routing": "component-federation-v1",
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class CompositeExplorerAPI:
    """Merge discovery/search and route record endpoints to exactly one child."""

    def __init__(
        self,
        components: Mapping[str, Any],
        *,
        primary: str,
        analysis_components: Mapping[str, Any] | None = None,
    ) -> None:
        self.components = OrderedDict(components)
        if not self.components:
            raise ValueError("At least one Explorer component is required")
        if primary not in self.components:
            raise ValueError("The primary Explorer component is missing")
        self.primary_key = primary
        self.primary = self.components[primary]
        self.root = self.primary.root
        self.roots = {
            key: value.root for key, value in self.components.items()
        }
        release_rows = [
            {
                "key": key,
                "release_id": str(component.manifest.get("release_id") or ""),
                "release_fingerprint": str(
                    component.manifest.get("release_fingerprint") or ""
                ),
            }
            for key, component in self.components.items()
        ]
        self.release_fingerprint = _fingerprint(release_rows)
        self.release_id = "composite-explorer-" + self.release_fingerprint[:12]
        self._release_rows = release_rows
        linked_analysis = analysis_components or {}
        self.analysis_components = {
            key: linked_analysis[key]
            for key in self.components
            if key in linked_analysis
        }
        self.analysis_crosswalks = {
            key: ExplorerAnalysisCrosswalk(key, component, linked_analysis[key])
            for key, component in self.components.items()
            if key in linked_analysis
        }

    @staticmethod
    def _component(query: Mapping[str, list[str]]) -> str | None:
        values = query.get("component")
        if not values:
            return None
        if len(values) != 1 or not values[0].strip():
            raise ExplorerAPIError(422, "component must be one nonempty value")
        return values[0].strip()

    @staticmethod
    def _without_component(query: Mapping[str, list[str]]) -> dict[str, list[str]]:
        cleaned = dict(query)
        cleaned.pop("component", None)
        return cleaned

    def _tag(self, row: Mapping[str, Any], component_key: str) -> dict[str, Any]:
        value = deepcopy(dict(row))
        value["component_key"] = component_key
        portable_id = value.get("portable_id")
        if portable_id:
            value["portable_ref"] = f"{component_key}:{portable_id}"
        crosswalk = self.analysis_crosswalks.get(component_key)
        if crosswalk is not None:
            value = crosswalk.enrich(value)
        return value

    def meta(self) -> dict[str, Any]:
        component_meta = {
            key: component.meta() for key, component in self.components.items()
        }
        count_keys = {
            name
            for meta in component_meta.values()
            for name, value in meta.get("counts", {}).items()
            if isinstance(value, int) and not isinstance(value, bool)
        }
        class_keys = {
            name
            for meta in component_meta.values()
            for name in meta.get("class_counts", {})
        }
        return {
            "schema": COMPOSITE_SCHEMA,
            "release_id": self.release_id,
            "release_fingerprint": self.release_fingerprint,
            "entity_level": "full_protein_parent",
            "component_releases": [
                {
                    **row,
                    "primary": row["key"] == self.primary_key,
                    "counts": deepcopy(
                        component_meta[row["key"]].get("counts", {})
                    ),
                    "class_counts": deepcopy(
                        component_meta[row["key"]].get("class_counts", {})
                    ),
                }
                for row in self._release_rows
            ],
            "counts": {
                name: sum(
                    int(meta.get("counts", {}).get(name, 0))
                    for meta in component_meta.values()
                )
                for name in sorted(count_keys)
            },
            "class_counts": {
                name: sum(
                    int(meta.get("class_counts", {}).get(name, 0))
                    for meta in component_meta.values()
                )
                for name in sorted(class_keys)
            },
            "classes": sorted(
                {
                    str(value)
                    for meta in component_meta.values()
                    for value in meta.get("classes", [])
                }
            ),
            "search": {
                "ordering": "component_manifest_order_then_native_rank",
                "deduplication": "none; component_key is part of record identity",
                "component_filter": "component",
            },
            "analysis_crosswalk": {
                "schema": CROSSWALK_SCHEMA,
                "components": {
                    key: (
                        self.analysis_crosswalks[key].meta()
                        if key in self.analysis_crosswalks
                        else {
                            "schema": CROSSWALK_SCHEMA,
                            "available": False,
                            "verified_records": 0,
                        }
                    )
                    for key in self.components
                },
            },
            "analysis_scope_filters": {
                "available": any(
                    crosswalk.available
                    and getattr(self.analysis_components.get(key), "membership", None)
                    is not None
                    for key, crosswalk in self.analysis_crosswalks.items()
                ),
                "component_required": True,
                "parameters": {
                    "component": "Explorer/analysis component key",
                    "analysis_library": "component-local analysis library key",
                    "filters": "JSON source-filter object",
                },
                "pagination": "scope membership is applied before total, limit, and offset",
            },
        }

    def proteins(self, query: dict[str, list[str]]) -> dict[str, Any]:
        component_key = self._component(query)
        child_query = self._without_component(query)
        analysis_library_values = child_query.pop("analysis_library", None)
        filter_values = child_query.pop("filters", None)
        if analysis_library_values is not None and (
            len(analysis_library_values) != 1
            or not analysis_library_values[0].strip()
        ):
            raise ExplorerAPIError(
                422, "analysis_library must be one nonempty value"
            )
        if filter_values is not None and (
            len(filter_values) != 1 or not filter_values[0].strip()
        ):
            raise ExplorerAPIError(422, "filters must be one JSON object")
        analysis_library = (
            analysis_library_values[0].strip()
            if analysis_library_values is not None
            else None
        )
        if filter_values is not None and analysis_library is None:
            raise ExplorerAPIError(422, "filters requires analysis_library")
        if analysis_library is not None and component_key is None:
            raise ExplorerAPIError(
                422, "analysis_library requires an explicit component"
            )
        allowed_portable_ids: set[str] | None = None
        normalized_filters: dict[str, Any] | None = None
        if analysis_library is not None:
            analysis = self.analysis_components.get(component_key or "")
            if analysis is None or analysis_library not in analysis.library_keys:
                raise ExplorerAPIError(
                    422,
                    "analysis_library does not belong to the selected component",
                )
            membership = getattr(analysis, "membership", None)
            if membership is None or analysis_library not in membership.libraries:
                raise ExplorerAPIError(
                    409, "Source filters are unavailable for analysis_library"
                )
            crosswalk = self.analysis_crosswalks.get(component_key or "")
            if crosswalk is None or not crosswalk.available:
                raise ExplorerAPIError(
                    409, "Verified Explorer-to-analysis scope membership is unavailable"
                )
            try:
                raw_filters = (
                    json.loads(filter_values[0])
                    if filter_values is not None
                    else {}
                )
                normalized_filters = membership.normalize(
                    analysis_library, raw_filters
                )
            except (json.JSONDecodeError, MembershipFilterError) as error:
                raise ExplorerAPIError(422, f"Invalid source filters: {error}") from error
            records = crosswalk.analysis_records(analysis_library)
            allowed_analysis_ids = membership.allowed_ids(
                analysis_library, records, normalized_filters
            )
            allowed_portable_ids = {
                records[identifier] for identifier in allowed_analysis_ids
            }
        limit = self.primary._integer(child_query, "limit", 25, 100)
        offset = self.primary._integer(child_query, "offset", 0, 100_000)
        if component_key is not None:
            component = self.components.get(component_key)
            if component is None:
                raise ExplorerAPIError(404, "Explorer component not found")
            payload = (
                component.proteins(
                    child_query, allowed_portable_ids=allowed_portable_ids
                )
                if allowed_portable_ids is not None
                else component.proteins(child_query)
            )
            result = {
                **payload,
                "schema": COMPOSITE_SCHEMA,
                "component_key": component_key,
                "component_order": [component_key],
                "proteins": [
                    self._tag(row, component_key)
                    for row in payload.get("proteins", [])
                ],
            }
            if analysis_library is not None:
                result["analysis_scope"] = {
                    "component_key": component_key,
                    "library": analysis_library,
                    "filters": normalized_filters,
                    "eligible_crosswalk_records": len(allowed_portable_ids or ()),
                    "applied_before_pagination": True,
                }
            return result

        probes: list[tuple[str, Any, dict[str, Any]]] = []
        component_totals: dict[str, int] = {}
        component_modes: dict[str, str] = {}
        probe_query = dict(child_query)
        probe_query["limit"] = ["1"]
        probe_query["offset"] = ["0"]
        for key, component in self.components.items():
            payload = component.proteins(probe_query)
            total = int(payload.get("total", 0))
            component_totals[key] = total
            component_modes[key] = str(payload.get("search_mode") or "")
            probes.append((key, component, payload))

        proteins: list[dict[str, Any]] = []
        cursor = 0
        stop = offset + limit
        for key, component, _probe in probes:
            total = component_totals[key]
            component_start = cursor
            component_stop = cursor + total
            cursor = component_stop
            slice_start = max(offset, component_start)
            slice_stop = min(stop, component_stop)
            if slice_start >= slice_stop:
                continue
            page_query = dict(child_query)
            page_query["offset"] = [str(slice_start - component_start)]
            page_query["limit"] = [str(slice_stop - slice_start)]
            payload = component.proteins(page_query)
            proteins.extend(
                self._tag(row, key) for row in payload.get("proteins", [])
            )
        return {
            "schema": COMPOSITE_SCHEMA,
            "entity_level": "full_protein_parent",
            "total": sum(component_totals.values()),
            "limit": limit,
            "offset": offset,
            "search_mode": "component_then_native_rank",
            "component_order": list(self.components),
            "component_totals": component_totals,
            "component_search_modes": component_modes,
            "proteins": proteins,
        }

    def _contains(self, component: Any, portable_id: str) -> bool:
        contains = getattr(component, "contains", None)
        if callable(contains):
            return bool(contains(portable_id))
        parent_resolver = getattr(component, "resolve_canonical_parent", None)
        if callable(parent_resolver) and parent_resolver(portable_id) is not None:
            return True
        database = getattr(component, "database", None)
        if database is None:
            return False
        try:
            with closing(read_only_connection(database)) as connection:
                return (
                    connection.execute(
                        "SELECT 1 FROM protein WHERE portable_id=?",
                        (portable_id,),
                    ).fetchone()
                    is not None
                )
        except (OSError, sqlite3.Error):
            return False

    def _resolve_component(
        self,
        portable_id: str,
        component_key: str | None,
    ) -> str:
        if component_key is not None:
            if component_key not in self.components:
                raise ExplorerAPIError(404, "Explorer component not found")
            return component_key
        matches = [
            key
            for key, component in self.components.items()
            if self._contains(component, portable_id)
        ]
        if len(matches) > 1:
            raise ExplorerAPIError(
                409,
                "portable_id is ambiguous across Explorer components; provide component",
            )
        return matches[0] if matches else self.primary_key

    def protein(
        self,
        portable_id: str,
        *,
        component: str | None = None,
        include_receptor_germline: bool = False,
    ) -> dict[str, Any]:
        key = self._resolve_component(portable_id, component)
        payload = self.components[key].protein(
            portable_id,
            include_receptor_germline=include_receptor_germline,
        )
        result = deepcopy(payload)
        result["component_key"] = key
        result["portable_ref"] = f"{key}:{portable_id}"
        if isinstance(result.get("protein"), Mapping):
            result["protein"] = self._tag(result["protein"], key)
            for field in (
                "analysis_component_key",
                "analysis_library_key",
                "analysis_antigen_id",
                "analysis_ref",
            ):
                if field in result["protein"]:
                    result[field] = result["protein"][field]
        return result

    def _tag_record_payload(
        self,
        payload: Mapping[str, Any],
        component_key: str,
        portable_id: str,
    ) -> dict[str, Any]:
        """Attach stable composite and analysis identity to a record subresource."""

        result = deepcopy(dict(payload))
        identity = self._tag({"portable_id": portable_id}, component_key)
        result["component_key"] = component_key
        result["portable_ref"] = identity["portable_ref"]
        for field in (
            "analysis_component_key",
            "analysis_library_key",
            "analysis_antigen_id",
            "analysis_ref",
        ):
            if field in identity:
                result[field] = identity[field]
        return result

    def projections(
        self,
        portable_id: str,
        query: dict[str, list[str]],
        *,
        component: str | None = None,
        include_receptor_germline: bool = False,
    ) -> dict[str, Any]:
        key = self._resolve_component(portable_id, component)
        payload = self.components[key].projections(
            portable_id,
            query,
            include_receptor_germline=include_receptor_germline,
        )
        return self._tag_record_payload(payload, key, portable_id)

    def annotations(
        self,
        portable_id: str,
        *,
        component: str | None = None,
        include_receptor_germline: bool = False,
    ) -> dict[str, Any]:
        key = self._resolve_component(portable_id, component)
        annotations = getattr(self.components[key], "annotations", None)
        if not callable(annotations):
            raise ExplorerAPIError(404, "Explorer annotations are unavailable")
        payload = annotations(
            portable_id,
            include_receptor_germline=include_receptor_germline,
        )
        return self._tag_record_payload(payload, key, portable_id)

    def variant_projections(
        self,
        portable_id: str,
        query: dict[str, list[str]],
        *,
        component: str | None = None,
        include_receptor_germline: bool = False,
    ) -> dict[str, Any]:
        key = self._resolve_component(portable_id, component)
        variant_projections = getattr(
            self.components[key], "variant_projections", None
        )
        if not callable(variant_projections):
            raise ExplorerAPIError(
                404, "Explorer variant projections are unavailable"
            )
        payload = variant_projections(
            portable_id,
            query,
            include_receptor_germline=include_receptor_germline,
        )
        return self._tag_record_payload(payload, key, portable_id)

    def dispatch(self, handler: Any, *, head_only: bool = False) -> bool:
        parsed = urlparse(handler.path)
        path = parsed.path.rstrip("/") or "/"
        if path != "/api/explorer" and not path.startswith("/api/explorer/"):
            return False
        query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=16)
        try:
            if path == "/api/explorer/meta":
                if set(query) - {"component"}:
                    raise ExplorerAPIError(422, "Explorer metadata accepts only component")
                component_key = self._component(query)
                if component_key is None:
                    payload = self.meta()
                elif component_key in self.components:
                    payload = self.components[component_key].meta()
                else:
                    raise ExplorerAPIError(404, "Explorer component not found")
                self.primary._send(handler, 200, payload, head_only)
                return True
            if path == "/api/explorer/proteins":
                self.primary._send(
                    handler, 200, self.proteins(dict(query)), head_only
                )
                return True
            match = re.fullmatch(
                r"/api/explorer/proteins/([^/]+)"
                r"(/projections|/annotations|/variant-projections)?",
                path,
            )
            if match is None:
                raise ExplorerAPIError(404, "Explorer endpoint not found")
            portable_id = unquote(match.group(1))
            if ID_RE.fullmatch(portable_id) is None:
                raise ExplorerAPIError(
                    422, "portable_id must match P9P or M1E plus nine digits"
                )
            component_key = self._resolve_component(
                portable_id, self._component(query)
            )
            cleaned = self._without_component(query)
            include_optional = self.primary._boolean(
                cleaned, "include_receptor_germline"
            )
            suffix = match.group(2)
            if suffix is None:
                payload = self.protein(
                    portable_id,
                    component=component_key,
                    include_receptor_germline=include_optional,
                )
            elif suffix == "/projections":
                payload = self.projections(
                    portable_id,
                    cleaned,
                    component=component_key,
                    include_receptor_germline=include_optional,
                )
            elif suffix == "/annotations":
                payload = self.annotations(
                    portable_id,
                    component=component_key,
                    include_receptor_germline=include_optional,
                )
            else:
                payload = self.variant_projections(
                    portable_id,
                    cleaned,
                    component=component_key,
                    include_receptor_germline=include_optional,
                )
            self.primary._send(handler, 200, payload, head_only)
            return True
        except ExplorerAPIError as error:
            self.primary._send(
                handler,
                error.status,
                {
                    "schema": "mimicryone/error/1",
                    "status": error.status,
                    "error": error.message,
                },
                head_only,
            )
            return True


__all__ = ["COMPOSITE_SCHEMA", "CompositeExplorerAPI"]
