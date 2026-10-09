"""Installed entry point for guarded MimicryMap analysis and scan routes."""

from __future__ import annotations

from analysis_api import AnalysisConfigurationError
from analysis_api_routes_unified import AnalysisAPI as _UnifiedAnalysisAPI
from analysis_membership import AnalysisMembership
from analysis_player import AnalysisPlayerService
from analysis_scan_production import AnalysisScanService
from annotation_hydration import AnnotationHydrator
from canonical_aliases import CanonicalAliasResolver
from canonical_parent_catalog import CanonicalParentCatalog
from canonical_parent_index import CanonicalParentIndex
from canonical_parent_index_service import CanonicalParentIndexService
from comparison_exclusions import ComparisonExclusions


class AnalysisAPI(_UnifiedAnalysisAPI):
    def __init__(
        self,
        analysis_db,
        *,
        explorer_db=None,
        alias_db=None,
        annotation_db=None,
        membership_db=None,
        parent_db=None,
        parent_catalog: CanonicalParentCatalog | None = None,
        parent_index_root=None,
        parent_index: CanonicalParentIndex | None = None,
        comparison_exclusions=None,
    ):
        if parent_db is not None and parent_catalog is not None:
            raise ValueError("parent_db and parent_catalog are mutually exclusive")
        if parent_index_root is not None and parent_index is not None:
            raise ValueError("parent_index_root and parent_index are mutually exclusive")
        super().__init__(analysis_db)
        self.comparison_exclusions = (
            ComparisonExclusions(
                comparison_exclusions,
                release_fingerprint=str(
                    self.manifest.get("release_fingerprint") or ""
                ),
                comparisons=self.comparisons.values(),
            )
            if comparison_exclusions is not None
            else None
        )
        if self.comparison_exclusions is not None:
            excluded = self.comparison_exclusions.excluded_keys
            self._ready_comparison_metadata = {
                key: value
                for key, value in self._ready_comparison_metadata.items()
                if key not in excluded
            }
            self._ready_comparison_keys = frozenset(
                self._ready_comparison_metadata
            )
        self.parent_catalog = (
            parent_catalog
            if parent_catalog is not None
            else CanonicalParentCatalog(parent_db) if parent_db is not None else None
        )
        self.canonical_parent_catalog_available = self.parent_catalog is not None
        self.alias_resolver = CanonicalAliasResolver(alias_db) if alias_db is not None else None
        self.annotation_hydrator = AnnotationHydrator(
            self.alias_resolver,
            annotation_db,
            expected_release_fingerprint=str(
                self.manifest.get("release_fingerprint") or ""
            ),
        )
        self.membership = (
            AnalysisMembership(
                membership_db,
                expected_fingerprint=str(self.manifest.get("release_fingerprint") or ""),
            )
            if membership_db is not None else None
        )
        self.player_service = AnalysisPlayerService(self, explorer_db)
        if parent_index_root is not None or parent_index is not None:
            if self.parent_catalog is None:
                raise ValueError("canonical parent index requires the frozen parent catalog")
            expected_analysis = {
                "release_id": str(self.manifest.get("release_id") or ""),
                "release_fingerprint": str(
                    self.manifest.get("release_fingerprint") or ""
                ),
            }
            expected_catalog = {
                "release_id": str(self.parent_catalog.manifest["release_id"]),
                "database_sha256": str(self.parent_catalog.database_sha256),
            }
            loaded_index = (
                parent_index
                if parent_index is not None
                else CanonicalParentIndex(
                    parent_index_root,
                    expected_analysis_release=expected_analysis,
                    expected_catalog=expected_catalog,
                )
            )
            self.canonical_parent_index_service = CanonicalParentIndexService(
                loaded_index,
                self.parent_catalog,
                assay_parent_resolver=self.player_service.canonical_query_parent_keys,
                annotation_hydrator=self.annotation_hydrator,
            )
        else:
            self.canonical_parent_index_service = None
        self.scan_service = AnalysisScanService(self)
        self._rebuild_cached_meta()

    def resolve_canonical_parent(self, parent_key: object):
        """Return the frozen raw parent row, including optional policy rows."""

        if self.parent_catalog is None:
            return None
        return self.parent_catalog.resolve_canonical_parent(parent_key)

    def dispatch(self, handler, *, head_only: bool = False):
        if self.player_service.dispatch(handler, head_only=head_only):
            return True
        return super().dispatch(handler, head_only=head_only)


__all__ = ["AnalysisAPI", "AnalysisConfigurationError"]
