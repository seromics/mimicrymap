"""Small response-size hardening layer for the bounded analysis scan service."""

from __future__ import annotations

from analysis_scan import AnalysisScanService as _AnalysisScanService


class AnalysisScanService(_AnalysisScanService):
    """Retain each query sequence once, never once per result edge."""

    @staticmethod
    def _strip_repeated_sequences(rows):
        for row in rows:
            for side in ("query", "source"):
                value = row.get(side)
                if isinstance(value, dict):
                    value.pop("sequence", None)
        return rows

    def _precomputed(self, *args, **kwargs):
        payload = super()._precomputed(*args, **kwargs)
        self._strip_repeated_sequences(payload.get("results", []))
        return payload

    def _aggregate_live(self, *args, **kwargs):
        rows = super()._aggregate_live(*args, **kwargs)
        return self._strip_repeated_sequences(rows)

    def capabilities(self, *args, **kwargs):
        payload = super().capabilities(*args, **kwargs)
        payload["record_contract"]["entity_level"] = "assay_antigen_or_canonical_parent"
        return payload


__all__ = ["AnalysisScanService"]
