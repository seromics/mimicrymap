"""Federate independently fingerprinted analysis releases without rebinding artifacts."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import OrderedDict
from copy import deepcopy
from typing import Any, Mapping
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from analysis_api import APIError, _send_json, _send_json_bytes, _accepts_gzip
from analysis_scan import LIVE_SCHEMA, SCAN_SCHEMA, ScanError, _error_payload
from public_result_cache import PublicResultCache, disconnected
from player_view_response import compact_view, VIEW_HEADER
from local_inputs import local_inputs
from scope_count import scope_count
from canonical_aliases import metadata_read_session
from request_timing import collect as collect_request_timings


from pinned_subset_membership import PinnedSubsetMembership


COMPOSITE_META_SCHEMA = "mimicryone/analysis-composite/1"
COMPOSITE_ROUTE_PLAN_SCHEMA = "mimicryone/frontend-route-plan-composite/1"
POST_ROUTES = frozenset(
    {"/api/analysis/player", "/api/analysis/scan", "/api/analysis/live"}
)

# A population that is one scope value of an existing canonical library, held in its own small
# release so it can be compared against an assay library the canonical catalog does not carry.
# The reader selects the canonical library with that scope fixed; the request is rewritten to
# the carrier release, which IS that subset, so nothing implies a separate surface. Record ids
# are mapped through a crosswalk verified row by row on sequence equality.
PINNED_SUBSETS = (
    {
        "library": "canonical_exposure",
        "partner": "huprot4",
        "carrier_component": "atlas120",
        "carrier_library": "atlas_120_viruses",
        "scope_field": "source_collections",
        "scope_value": "viral_nonhuman",
        "crosswalk": "canonical_carrier_crosswalk.json",
    },
)


def _fingerprint(kind: str, rows: list[dict[str, str]]) -> str:
    encoded = json.dumps(
        {"kind": kind, "components": rows, "routing": "component-federation-v1"},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _one(query: Mapping[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    if not values:
        return None
    if len(values) != 1:
        raise APIError(400, f"Parameter {key!r} may appear only once")
    return values[0].strip() or None


def _library_roster(component: Any, library: str) -> dict[str, Any]:
    """The declared facts that decide whether two components mean the same library.

    Drawn from the analysis-ready manifest, so nothing is opened to compare them: the input
    file digest plus the catalog's record count and antigen_id span. Two components that
    ingested the same file into the same contiguous ID range hold the same records.
    """

    manifest = getattr(component, "manifest", None)
    if not isinstance(manifest, Mapping):
        return {}
    roster: dict[str, Any] = {}
    source = manifest.get("inputs")
    if isinstance(source, Mapping):
        entry = source.get(library)
        if isinstance(entry, Mapping) and entry.get("sha256"):
            roster["source_sha256"] = str(entry["sha256"])
    libraries = manifest.get("libraries")
    if isinstance(libraries, Mapping):
        entry = libraries.get(library)
        if isinstance(entry, Mapping):
            for field_name in ("records", "first_antigen_id", "last_antigen_id"):
                if entry.get(field_name) is not None:
                    roster[field_name] = entry[field_name]
    return roster


def _assert_library_agrees(
    library: str,
    incumbent_key: str,
    incumbent: Any,
    candidate_key: str,
    candidate: Any,
) -> None:
    """Admit a repeated library key only on positive evidence that the rosters match."""

    established = _library_roster(incumbent, library)
    proposed = _library_roster(candidate, library)
    shared = sorted(set(established) & set(proposed))
    if not shared:
        raise ValueError(
            f"Analysis library key {library!r} occurs in both {incumbent_key!r} and "
            f"{candidate_key!r}, and neither declares a roster to compare. A shared "
            f"library needs the same source digest and antigen_id span in both."
        )
    differing = [field for field in shared if established[field] != proposed[field]]
    if differing:
        detail = ", ".join(
            f"{field}={established[field]!r} vs {proposed[field]!r}" for field in differing
        )
        raise ValueError(
            f"Analysis library key {library!r} occurs in both {incumbent_key!r} and "
            f"{candidate_key!r} with different records: {detail}"
        )


class CompositeAnalysisAPI:
    """Route each request to one complete child release and merge discovery metadata."""

    def __init__(
        self,
        components: Mapping[str, Any],
        *,
        primary: str,
    ) -> None:
        self.components = OrderedDict(components)
        self.public_result_cache = PublicResultCache()
        if not self.components:
            raise ValueError("At least one analysis component is required")
        if primary not in self.components:
            raise ValueError("The primary analysis component is missing")
        self.primary_key = primary
        self.primary = self.components[primary]
        self.root = self.primary.root
        self.roots = {
            key: value.root for key, value in self.components.items()
        }
        self.canonical_parent_index_service = getattr(
            self.primary, "canonical_parent_index_service", None
        )

        # A library may be mounted by more than one component when the components agree on
        # its roster. The previous rule refused that outright, which was overzealous: it read
        # "the same key appears twice" as "two different libraries", when a component built to
        # add one comparison necessarily re-declares the library it compares against. What
        # actually matters is that both components mean the same records, so that is what is
        # checked. Components that disagree are still refused, and the rosters stay the
        # authority for which component serves a given request.
        self.library_owners: dict[str, tuple[str, ...]] = {}
        self.comparison_owners: dict[str, str] = {}
        for component_key, component in self.components.items():
            for library in component.library_keys:
                key = str(library)
                if key in self.library_owners:
                    incumbent = self.library_owners[key][0]
                    _assert_library_agrees(
                        key,
                        incumbent,
                        self.components[incumbent],
                        component_key,
                        component,
                    )
                    self.library_owners[key] += (component_key,)
                    continue
                self.library_owners[key] = (component_key,)
            for comparison in component.comparisons:
                if comparison in self.comparison_owners:
                    raise ValueError(
                        f"Analysis comparison key {comparison!r} occurs in both "
                        f"{self.comparison_owners[comparison]!r} and {component_key!r}"
                    )
                self.comparison_owners[str(comparison)] = component_key

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
        self.release_fingerprint = _fingerprint("analysis", release_rows)
        self.release_id = "composite-analysis-" + self.release_fingerprint[:12]
        self.manifest = {
            "schema": COMPOSITE_META_SCHEMA,
            "release_id": self.release_id,
            "release_fingerprint": self.release_fingerprint,
            "components": release_rows,
        }
        self.library_keys = frozenset(self.library_owners)
        self._pinned_subsets = self._load_pinned_subsets()
        self._cached_meta = self._build_meta()

    def _load_pinned_subsets(self) -> tuple:
        """Bind each pinned subset to its carrier's verified crosswalk, or skip it."""
        loaded = []
        for rule in PINNED_SUBSETS:
            component = self.components.get(rule["carrier_component"])
            if component is None:
                continue
            try:
                document = json.loads(
                    (component.root / rule["crosswalk"]).read_text(encoding="utf-8")
                )
            except (OSError, ValueError, TypeError):
                continue
            mapping = document.get("canonical_antigen_id_to_carrier_antigen_id")
            if not isinstance(mapping, Mapping) or not mapping:
                continue
            crosswalk = {str(key): int(value) for key, value in mapping.items()}
            source_owners = self.library_owners.get(rule["library"], ())
            if len(source_owners) == 1:
                source = self.components[next(iter(source_owners))]
                membership = getattr(source, "membership", None)
                if membership is not None:
                    component.pinned_memberships = dict(getattr(component, "pinned_memberships", {}))
                    component.pinned_memberships[rule["carrier_library"]] = PinnedSubsetMembership(membership, rule, crosswalk)
            loaded.append((rule, crosswalk))
        return tuple(loaded)

    @staticmethod
    def _is_pinned_selector(
        selector: Any,
        rule: Mapping[str, Any],
        crosswalk: Mapping[str, int],
    ) -> bool:
        """True when this selector is the canonical library reduced to exactly the pinned scope.

        A selector naming records carries the scope in the records themselves: belonging to the
        collection is the evidence, and only the query side ever names them. The target side
        names a population instead, so it has to state the scope as a filter. Requiring the
        filter on both sides silently broke the direction where the reader picks the antigen
        from the canonical library, because that selector never carries one.
        """
        if not isinstance(selector, Mapping) or selector.get("kind") != "library":
            return False
        if selector.get("library") != rule["library"]:
            return False
        identifiers = selector.get("antigen_ids")
        if isinstance(identifiers, list) and identifiers:
            return all(str(value) in crosswalk for value in identifiers)
        filters = selector.get("filters")
        if not isinstance(filters, Mapping):
            return False
        values = filters.get(rule["scope_field"])
        # Only the exact pinned collection. A wider or absent scope is a different request and
        # is left alone, so it fails as unavailable rather than being silently narrowed.
        return isinstance(values, list) and [str(item) for item in values] == [rule["scope_value"]]

    @staticmethod
    def _rewrite_pinned_selector(
        selector: Mapping[str, Any],
        rule: Mapping[str, Any],
        crosswalk: Mapping[str, int],
    ) -> dict[str, Any]:
        item = {key: value for key, value in selector.items() if key != "filters"}
        item["library"] = rule["carrier_library"]
        filters = selector.get("filters") or {}
        # The fixed collection is already represented by the carrier. Preserve
        # every further restriction so validation cannot silently widen it.
        if "record_ids" in filters or any(key not in {rule["scope_field"], "include_controls"} and bool(value)
               for key, value in filters.items()) or filters.get("include_controls"):
            item["filters"] = dict(filters)
        identifiers = selector.get("antigen_ids")
        if isinstance(identifiers, list):
            mapped = []
            for value in identifiers:
                carrier = crosswalk.get(str(value))
                if carrier is None:
                    raise ScanError(
                        404,
                        "record_outside_pinned_subset",
                        "That record is not part of the pinned collection",
                        {"complete": False},
                    )
                mapped.append(carrier)
            item["antigen_ids"] = mapped
        return item

    def _resolve_pinned_subsets(self, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        """Send a pinned-subset request to the release that actually holds the pair.

        The fixed collection alone is represented by the carrier. Further restrictions use
        canonical membership through the verified record-ID crosswalk. Both directions
        go through the same rewrite, so the pairing behaves identically whichever side the
        reader picks their antigen from.
        """
        if not self._pinned_subsets:
            return payload
        for rule, crosswalk in self._pinned_subsets:
            for role, other in (("query", "target"), ("target", "query")):
                if not self._is_pinned_selector(payload.get(role), rule, crosswalk):
                    continue
                partner = payload.get(other)
                if not isinstance(partner, Mapping):
                    continue
                if str(partner.get("library") or "") != rule["partner"]:
                    continue
                updated = dict(payload)
                updated[role] = self._rewrite_pinned_selector(payload[role], rule, crosswalk)
                return updated
        return payload

    def _tag(self, payload: Mapping[str, Any], component_key: str) -> dict[str, Any]:
        item = deepcopy(dict(payload))
        item["component_key"] = component_key
        antigen_id = item.get("antigen_id")
        library_key = item.get("library_key") or item.get("library")
        if antigen_id is not None and library_key:
            item["analysis_ref"] = f"{component_key}:{library_key}:{antigen_id}"
        return item

    def _build_meta(self) -> dict[str, Any]:
        component_meta = {
            key: component._meta() for key, component in self.components.items()
        }
        libraries: list[dict[str, Any]] = []
        comparisons: list[dict[str, Any]] = []
        planned: list[dict[str, Any]] = []
        component_releases: list[dict[str, Any]] = []
        capability_libraries: dict[str, Any] = {}
        source_filter_libraries: dict[str, Any] = {}
        source_filter_components: dict[str, Any] = {}
        component_capabilities: dict[str, Any] = {}
        excluded_rows: list[dict[str, Any]] = []
        live_floors: set[int] = set()
        live_libraries: set[str] = set()

        for key, meta in component_meta.items():
            component_releases.append(
                {
                    "key": key,
                    "primary": key == self.primary_key,
                    "release_id": str(meta.get("release_id") or ""),
                    "release_fingerprint": str(
                        meta.get("release_fingerprint") or ""
                    ),
                }
            )
            libraries.extend(
                self._tag(row, key) for row in meta.get("libraries", [])
            )
            comparisons.extend(
                self._tag(row, key) for row in meta.get("comparisons", [])
            )
            planned.extend(
                self._tag(row, key)
                for row in meta.get(
                    "planned_comparisons", meta.get("comparisons", [])
                )
            )
            exclusions = meta.get("comparison_exclusions", {})
            for row in exclusions.get("exclusions", []) if isinstance(exclusions, Mapping) else []:
                excluded_rows.append(self._tag(row, key))
            capabilities = deepcopy(meta.get("compute_capabilities", {}))
            component_capabilities[key] = capabilities
            capability_libraries.update(
                deepcopy(capabilities.get("libraries", {}))
            )
            live = capabilities.get("modes", {}).get("live", {})
            live_floors.update(int(value) for value in live.get("floors", []))
            live_libraries.update(
                str(value)
                for value in live.get("available_target_libraries", [])
            )
            source_filters = meta.get("source_filters", {})
            if isinstance(source_filters, Mapping):
                component_contract = {
                    str(name): deepcopy(value)
                    for name, value in source_filters.items()
                    if name != "libraries"
                }
                component_contract["libraries"] = sorted(
                    str(value)
                    for value in source_filters.get("libraries", {})
                )
                source_filter_components[key] = component_contract
                for library, raw_specification in source_filters.get(
                    "libraries", {}
                ).items():
                    specification = deepcopy(raw_specification)
                    if isinstance(specification, dict):
                        specification["component_key"] = key
                        specification["filter_schema"] = source_filters.get(
                            "schema"
                        )
                        specification["filter_fields"] = deepcopy(
                            source_filters.get("filter_fields", {})
                        )
                    source_filter_libraries[str(library)] = specification

        primary_meta = component_meta[self.primary_key]
        compute_capabilities = deepcopy(
            primary_meta.get("compute_capabilities", {})
        )
        compute_capabilities["components"] = component_capabilities
        compute_capabilities["libraries"] = capability_libraries
        modes = compute_capabilities.setdefault("modes", {})
        live = modes.setdefault("live", {})
        live["floors"] = sorted(live_floors)
        live["available_target_libraries"] = sorted(live_libraries)
        record_contract = deepcopy(primary_meta.get("record_contract", {}))
        record_contract["catalog_identity"] = (
            "component_key + library_key + component-local antigen_id"
        )

        filter_fingerprints = [
            str(meta.get("source_filters", {}).get("filter_policy_fingerprint") or "")
            for meta in component_meta.values()
            if isinstance(meta.get("source_filters"), Mapping)
        ]
        filter_fingerprint = _fingerprint(
            "source-filters",
            [
                {"key": str(index), "release_id": "", "release_fingerprint": value}
                for index, value in enumerate(filter_fingerprints)
                if value
            ],
        ) if any(filter_fingerprints) else ""

        return {
            "schema": COMPOSITE_META_SCHEMA,
            "release_id": self.release_id,
            "release_fingerprint": self.release_fingerprint,
            "component_releases": component_releases,
            "entity_level": "analysis_catalog_record",
            "record_contract": record_contract,
            "libraries": libraries,
            "antigen_count": sum(int(row.get("records", 0)) for row in libraries),
            "planned_comparisons": planned,
            "comparisons": comparisons,
            "comparison_count_planned": len(planned),
            "comparison_count_queryable": len(comparisons),
            "comparison_exclusions": {
                "available": bool(excluded_rows),
                "planned_count": len(planned),
                "authorized_count": len(comparisons),
                "excluded_count": len(excluded_rows),
                "exclusions": excluded_rows,
            },
            "compute_capabilities": compute_capabilities,
            "static_player": {
                "route": "/api/analysis/player",
                "available": any(
                    meta.get("static_player", {}).get("available") is True
                    for meta in component_meta.values()
                ),
                "floor": 7,
                "available_floors": [7, 8, 9],
                "component_routed": True,
            },
            "source_filters": {
                "available": bool(source_filter_libraries),
                "filter_policy_fingerprint": filter_fingerprint,
                "component_scoped": True,
                "components": source_filter_components,
                "libraries": source_filter_libraries,
            },
            "canonical_projection": deepcopy(
                primary_meta.get("canonical_projection", {})
            ),
            "canonical_parent_catalog_available": primary_meta.get(
                "canonical_parent_catalog_available", False
            ),
            "canonical_parent_catalog": deepcopy(
                primary_meta.get("canonical_parent_catalog", {"available": False})
            ),
        }

    def _meta(self) -> dict[str, Any]:
        return deepcopy(self._cached_meta)

    def _frontend_route_plan(self) -> dict[str, Any]:
        views: list[dict[str, Any]] = []
        planned = authorized = excluded = 0
        for key, component in self.components.items():
            plan = component._frontend_route_plan()
            planned += int(plan.get("planned_physical_count", 0))
            authorized += int(plan.get("authorized_physical_count", 0))
            excluded += int(plan.get("excluded_count", 0))
            for row in plan.get("views", []):
                tagged = self._tag(row, key)
                tagged["component_release_fingerprint"] = str(
                    component.manifest.get("release_fingerprint") or ""
                )
                views.append(tagged)
        direction_ids = [str(row.get("direction_id") or "") for row in views]
        if not all(direction_ids) or len(direction_ids) != len(set(direction_ids)):
            raise APIError(503, "Composite frontend route identifiers collide")
        base = sum(row.get("row_kind") == "base_direction" for row in views)
        virtual = len(views) - base
        return {
            "schema": COMPOSITE_ROUTE_PLAN_SCHEMA,
            "release_id": self.release_id,
            "release_fingerprint": self.release_fingerprint,
            "component_count": len(self.components),
            "planned_physical_count": planned,
            "authorized_physical_count": authorized,
            "excluded_count": excluded,
            "base_direction_count": base,
            "canonical_virtual_count": virtual,
            "frontend_view_count": len(views),
            "views": views,
        }

    def _narrow(self, candidates: list[frozenset[str]]) -> tuple[bool, str | None]:
        """Resolve accumulated component candidate sets to a single component.

        Each selector contributes the set of components that can serve it, so combining them
        is an intersection, not a union: a request naming a library two components share and a
        comparison only one of them holds resolves to that one. An empty intersection is a
        genuine cross-component request and fails closed. A request that never narrows past
        several components is served by the primary, which owns the shared library's own
        comparisons.
        """

        if not candidates:
            return True, None
        common = set(candidates[0])
        for group in candidates[1:]:
            common &= group
        if not common:
            return False, None
        if len(common) > 1 and self.primary_key in common:
            return True, self.primary_key
        return True, sorted(common)[0]

    def _component_from_query(
        self,
        path: str,
        query: Mapping[str, list[str]],
    ) -> str | None:
        explicit = _one(query, "component")
        if explicit is not None and explicit not in self.components:
            raise APIError(404, "Unknown analysis component")
        candidates: list[frozenset[str]] = []
        comparison = _one(query, "comparison")
        if comparison is not None:
            owner = self.comparison_owners.get(comparison)
            if owner is None:
                raise APIError(404, "Unknown comparison")
            candidates.append(frozenset({owner}))
        for name in ("library", "library_a", "library_b"):
            library = _one(query, name)
            if library is None:
                continue
            owners = self.library_owners.get(library)
            if owners is None:
                raise APIError(404, "Unknown library")
            candidates.append(frozenset(owners))
        resolved, inferred_key = self._narrow(candidates)
        if not resolved:
            raise APIError(
                409,
                "No comparison spans independently fingerprinted analysis components",
            )
        if explicit is not None and inferred_key is not None and explicit != inferred_key:
            raise APIError(409, "Analysis component conflicts with the selected library")
        selected = explicit or inferred_key
        if selected is None and path.endswith("/pair"):
            raise APIError(
                409,
                "Component-local antigen IDs require comparison or library context",
            )
        if (
            selected is None
            and path.endswith("/antigens")
            and _one(query, "antigen_id") is not None
        ):
            raise APIError(
                409,
                "Component-local antigen_id requires library or component",
            )
        return selected

    @staticmethod
    def _without_component(
        parsed: Any,
        query: Mapping[str, list[str]],
        *,
        pair: bool = False,
    ) -> str:
        cleaned = dict(query)
        cleaned.pop("component", None)
        if pair:
            cleaned.pop("library_a", None)
            cleaned.pop("library_b", None)
        return urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                urlencode(cleaned, doseq=True),
                parsed.fragment,
            )
        )

    def _delegate(
        self,
        component_key: str,
        handler: Any,
        parsed: Any,
        query: Mapping[str, list[str]],
        *,
        head_only: bool,
    ) -> bool:
        original = handler.path
        handler.path = self._without_component(
            parsed, query, pair=parsed.path.rstrip("/").endswith("/pair")
        )
        try:
            return self.components[component_key].dispatch(
                handler, head_only=head_only
            )
        finally:
            handler.path = original

    def _fanout_antigens(
        self,
        query: Mapping[str, list[str]],
    ) -> dict[str, Any]:
        if not (_one(query, "q") or _one(query, "seqid")):
            raise APIError(
                409,
                "Unscoped catalog listing requires library or component",
            )
        if _one(query, "after_id") not in {None, "0"}:
            raise APIError(
                409,
                "Composite search does not accept component-local after_id",
            )
        try:
            limit = int(_one(query, "limit") or "50")
        except ValueError as error:
            raise APIError(400, "limit must be an integer") from error
        if limit < 1 or limit > 1000:
            raise APIError(400, "limit must be between 1 and 1000")
        child_query = dict(query)
        child_query.pop("component", None)
        child_query["limit"] = [str(limit)]
        results: list[dict[str, Any]] = []
        component_counts: dict[str, int] = {}
        for key, component in self.components.items():
            payload = component._antigens(child_query)
            rows = [
                self._tag(row, key) for row in payload.get("antigens", [])
            ]
            component_counts[key] = len(rows)
            results.extend(rows)
        return {
            "mode": "composite_search",
            "search_match_mode": "component_then_native_rank",
            "count": min(limit, len(results)),
            "next_after_id": None,
            "component_counts": component_counts,
            "antigens": results[:limit],
        }

    def _payload_component(
        self,
        path: str,
        payload: Mapping[str, Any],
        explicit: str | None,
    ) -> str:
        candidates: list[frozenset[str]] = []
        if path.endswith("/live"):
            library = payload.get("target_library")
            if isinstance(library, str):
                owners = self.library_owners.get(library)
                if owners is None:
                    raise ScanError(404, "unknown_library", "Unknown target library")
                candidates.append(frozenset(owners))
        for role in ("query", "target"):
            selector = payload.get(role)
            if not isinstance(selector, Mapping):
                continue
            kind = selector.get("kind")
            if kind == "library":
                library = selector.get("library")
                if isinstance(library, str):
                    owners = self.library_owners.get(library)
                    if owners is None:
                        raise ScanError(404, "unknown_library", f"Unknown {role} library")
                    candidates.append(frozenset(owners))
            elif kind in {"portable_protein", "canonical_parent", "canonical_proteome"}:
                candidates.append(frozenset({self.primary_key}))
            projection_library = selector.get("projection_library")
            if isinstance(projection_library, str):
                owners = self.library_owners.get(projection_library)
                if owners is not None:
                    candidates.append(frozenset(owners))
        resolved, inferred_key = self._narrow(candidates)
        if not resolved:
            raise ScanError(
                409,
                "cross_component_comparison",
                "No request may span independently fingerprinted analysis components",
                {"complete": False, "no_partial_payload": True},
            )
        inferred = {inferred_key} if inferred_key is not None else set()
        selected = inferred_key if inferred_key is not None else (explicit or self.primary_key)
        if explicit is not None:
            if explicit not in self.components:
                raise ScanError(404, "unknown_component", "Unknown analysis component")
            if inferred and selected != explicit:
                raise ScanError(
                    409,
                    "component_conflict",
                    "Analysis component conflicts with the selected library",
                    {"complete": False},
                )
            selected = explicit
        return selected

    def _dispatch_post(self, handler: Any, path: str, query: Mapping[str, list[str]]) -> bool:
        try:
            if getattr(handler, "command", "GET") != "POST":
                raise ScanError(405, "method_not_allowed", "This endpoint requires POST")
            explicit = _one(query, "component")
            unknown_query = set(query) - {"component"}
            if unknown_query:
                raise ScanError(
                    400,
                    "unknown_parameters",
                    "POST analysis routes accept only the optional component query parameter",
                )
            payload = self.primary.scan_service._read_json(handler)
            # Resolved before the component is inferred, so a pinned subset routes by the
            # library it is actually served from rather than needing a special case here.
            payload = self._resolve_pinned_subsets(payload)
            component_key = self._payload_component(path, payload, explicit)
            component = self.components[component_key]
            if path.endswith("/player"):
                cache_key = self.public_result_cache.key(component_key, component.manifest.get("release_fingerprint"), payload)
                accepts_gzip = _accepts_gzip(handler.headers.get('Accept-Encoding', ''))
                view_requested = handler.headers.get('X-Mimicry-View', '') == VIEW_HEADER
                view_key = (cache_key + ':' + VIEW_HEADER) if cache_key and view_requested else cache_key
                wire = self.public_result_cache.get_wire(view_key, accepts_gzip)
                if wire is not None:
                    _send_json_bytes(handler, 200, wire[0], compressed=wire[1], cache_status='hit')
                    return True
                prepared_store = getattr(self, "human_player_stores", {}).get(component_key)
                if prepared_store is not None:
                    prepared_wire = prepared_store.get_wire(
                        payload, view=view_requested, accepts_gzip=accepts_gzip)
                    if prepared_wire is not None:
                        _send_json_bytes(handler, 200, prepared_wire[0],
                                         compressed=prepared_wire[1], cache_status="prepared")
                        return True
                # A complete cached response can supply either representation without
                # another stored-result reconstruction or another crosswalk pass.
                full_wire = self.public_result_cache.get_wire(cache_key, False) if view_requested else None
                if full_wire is not None:
                    response = compact_view(json.loads(full_wire[0]), payload)
                    body, compressed = self.public_result_cache.encode_wire(view_key, response, accepts_gzip)
                    _send_json_bytes(handler, 200, body, compressed=compressed, cache_status='hit')
                    return True
                with metadata_read_session(), collect_request_timings() as timings:
                    response = component.player_service.run(payload, cancelled=lambda: disconnected(handler))
                handler._player_timings = timings
            elif path.endswith("/live"):
                expanded = component.scan_service._expand_live_alias(dict(payload))
                response = component.scan_service.run(
                    expanded, response_schema=LIVE_SCHEMA
                )
            else:
                response = component.scan_service.run(
                    dict(payload), response_schema=SCAN_SCHEMA
                )
            response = dict(response)
            crosswalk = getattr(self, "record_identity_crosswalks", {}).get(component_key)
            if crosswalk is not None:
                response = crosswalk.annotate_result(response)
            response["component_key"] = component_key
            if path.endswith('/player'):
                view = compact_view(response, payload) if view_requested else response
                if view is not response and cache_key is not None:
                    # Deliver and flush the viewer before serializing full export
                    # details. An immediate download waits for these same bytes;
                    # no extra worker, retained mutable object, or comparison run.
                    with self.public_result_cache.deferred_wire(cache_key):
                        body, compressed = self.public_result_cache.encode_wire(view_key, view, accepts_gzip)
                        try:
                            _send_json_bytes(handler, 200, body, compressed=compressed, cache_status='miss')
                            handler.wfile.flush()
                        except OSError:
                            return True  # The client left; never send a second response.
                        try:
                            self.public_result_cache.encode_wire(cache_key, response, False)
                        except Exception as error:
                            # The successful viewer response is already delivered.
                            # Release waiters and let a later download retry normally.
                            handler.log_error("Deferred public response cache unavailable: %s", error)
                else:
                    body, compressed = self.public_result_cache.encode_wire(view_key, view, accepts_gzip)
                    _send_json_bytes(handler, 200, body, compressed=compressed, cache_status='miss')
            else:
                _send_json(handler, 200, response)
        except ScanError as error:
            _send_json(handler, error.status, _error_payload(error))
        except APIError as error:
            _send_json(handler, error.status, {"error": error.message})
        except (FileNotFoundError, OSError, sqlite3.Error, json.JSONDecodeError, ValueError) as error:
            handler.log_error("Composite analysis data unavailable: %s", error)
            _send_json(
                handler,
                503,
                _error_payload(
                    ScanError(
                        503,
                        "temporarily_unavailable",
                        "Analysis data are temporarily unavailable",
                    )
                ),
            )
        except Exception as error:  # keep child paths and internals out of responses
            handler.log_error("Composite analysis internal error: %s", error)
            _send_json(
                handler,
                500,
                _error_payload(
                    ScanError(
                        500,
                        "internal_error",
                        "Internal analysis API error",
                    )
                ),
            )
        return True

    def dispatch(self, handler: Any, *, head_only: bool = False) -> bool:
        parsed = urlsplit(handler.path)
        path = parsed.path.rstrip("/") or "/"
        if path != "/api/analysis" and not path.startswith("/api/analysis/"):
            return False
        query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=32)
        if path in POST_ROUTES:
            if head_only:
                _send_json(
                    handler,
                    405,
                    _error_payload(
                        ScanError(405, "method_not_allowed", "This endpoint requires POST")
                    ),
                    head_only=True,
                )
                return True
            return self._dispatch_post(handler, path, query)
        try:
            explicit = _one(query, "component")
            if path in {"/api/analysis", "/api/analysis/meta"}:
                if set(query) - {"component"}:
                    raise APIError(400, "Analysis metadata accepts only component")
                if explicit is None:
                    payload = self._meta()
                elif explicit in self.components:
                    payload = self.components[explicit]._meta()
                else:
                    raise APIError(404, "Unknown analysis component")
                _send_json(handler, 200, payload, head_only=head_only)
                return True
            if path == "/api/analysis/route-plan":
                if set(query) - {"component"}:
                    raise APIError(400, "The frontend route plan accepts only component")
                if explicit is None:
                    payload = self._frontend_route_plan()
                elif explicit in self.components:
                    payload = self.components[explicit]._frontend_route_plan()
                else:
                    raise APIError(404, "Unknown analysis component")
                _send_json(handler, 200, payload, head_only=head_only)
                return True
            component_key = self._component_from_query(path, query)
            if component_key is None and path.endswith("/antigens"):
                _send_json(
                    handler,
                    200,
                    self._fanout_antigens(query),
                    head_only=head_only,
                )
                return True
            if component_key is None:
                component_key = self.primary_key
            if path == "/api/analysis/scope-count":
                payload = scope_count(self.components[component_key], query)
                payload["component_key"] = component_key
                _send_json(handler, 200, payload, head_only=head_only)
                return True
            if path == "/api/analysis/local-inputs":
                # Annotation hydration performs one immutable metadata lookup per record.
                # Without a read session each lookup opens and closes its own SQLite
                # connection, which dominates the cost of a whole-population page.
                with metadata_read_session():
                    payload = local_inputs(self.components[component_key], query)
                crosswalk = getattr(self, "record_identity_crosswalks", {}).get(component_key)
                if crosswalk is not None:
                    payload = crosswalk.annotate_result(payload)
                payload["component_key"] = component_key
                if hasattr(handler, "attach_input_package"):
                    handler.attach_input_package(payload)
                _send_json(handler, 200, payload, head_only=head_only)
                return True
            if path == "/api/analysis/antigens":
                child_query = dict(query)
                child_query.pop("component", None)
                payload = dict(self.components[component_key]._antigens(child_query))
                payload["component_key"] = component_key
                payload["antigens"] = [
                    self._tag(row, component_key)
                    for row in payload.get("antigens", [])
                ]
                _send_json(handler, 200, payload, head_only=head_only)
                return True
            return self._delegate(
                component_key,
                handler,
                parsed,
                query,
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
        except (FileNotFoundError, OSError, sqlite3.Error, json.JSONDecodeError) as error:
            handler.log_error("Composite analysis unavailable: %s", error)
            _send_json(
                handler,
                503,
                {"error": "Analysis data are temporarily unavailable"},
                head_only=head_only,
            )
            return True
        except Exception as error:  # keep child paths and internals out of responses
            handler.log_error("Composite analysis internal error: %s", error)
            _send_json(
                handler,
                500,
                {"error": "Internal analysis API error"},
                head_only=head_only,
            )
            return True


__all__ = [
    "COMPOSITE_META_SCHEMA",
    "COMPOSITE_ROUTE_PLAN_SCHEMA",
    "CompositeAnalysisAPI",
]
