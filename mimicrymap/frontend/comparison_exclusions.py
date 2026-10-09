"""Immutable release-level comparison exclusions.

The analysis-ready catalog remains fingerprinted to its original planned matrix.
This sidecar removes explicitly retired pairs at runtime without rewriting that
catalog or pretending an omitted shard is incomplete.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable, Mapping


SCHEMA = "mimicryone/comparison-exclusions/1"
HEX64 = re.compile(r"[0-9a-f]{64}")
REASON_CODE = re.compile(r"[a-z][a-z0-9_]{2,63}")


class ComparisonExclusionError(ValueError):
    """The exclusion policy is absent, malformed, or release-incompatible."""


def _require(condition: object, message: str) -> None:
    if not condition:
        raise ComparisonExclusionError(message)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


class ComparisonExclusions:
    """Validated immutable exclusions for one analysis manifest."""

    def __init__(
        self,
        policy_path: str | Path,
        *,
        release_fingerprint: str,
        comparisons: Iterable[Any],
    ) -> None:
        self.path = Path(policy_path).expanduser().resolve()
        _require(self.path.is_file(), "comparison exclusion policy is missing")
        try:
            raw = self.path.read_bytes()
            payload = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ComparisonExclusionError(
                "comparison exclusion policy is not valid UTF-8 JSON"
            ) from error
        _require(isinstance(payload, dict), "comparison exclusion policy must be an object")
        _require(
            set(payload) == {"schema", "release_fingerprint", "exclusions"},
            "comparison exclusion policy has unexpected or missing fields",
        )
        _require(payload.get("schema") == SCHEMA, "comparison exclusion schema differs")
        expected_fingerprint = str(release_fingerprint or "").lower()
        _require(
            HEX64.fullmatch(expected_fingerprint) is not None,
            "analysis release fingerprint is invalid",
        )
        _require(
            payload.get("release_fingerprint") == expected_fingerprint,
            "comparison exclusion fingerprint differs from the analysis release",
        )
        planned: dict[str, tuple[str, str]] = {}
        for comparison in comparisons:
            key = str(
                comparison.get("key")
                if isinstance(comparison, Mapping)
                else getattr(comparison, "key", "")
            )
            library_a = str(
                comparison.get("a")
                if isinstance(comparison, Mapping)
                else getattr(comparison, "library_a", "")
            )
            library_b = str(
                comparison.get("b")
                if isinstance(comparison, Mapping)
                else getattr(comparison, "library_b", "")
            )
            _require(key and library_a and library_b and key not in planned,
                     "analysis comparison contract is invalid")
            planned[key] = (library_a, library_b)
        values = payload.get("exclusions")
        _require(isinstance(values, list) and values, "at least one exclusion is required")
        rows: dict[str, dict[str, Any]] = {}
        exact_fields = {
            "comparison_key", "library_a", "library_b", "reason_code", "active",
        }
        for raw_row in values:
            _require(
                isinstance(raw_row, dict) and set(raw_row) == exact_fields,
                "comparison exclusion row fields differ",
            )
            key = str(raw_row.get("comparison_key") or "")
            library_a = str(raw_row.get("library_a") or "")
            library_b = str(raw_row.get("library_b") or "")
            reason = str(raw_row.get("reason_code") or "")
            _require(key in planned and key not in rows,
                     "comparison exclusion key is unknown or duplicated")
            _require(
                planned[key] == (library_a, library_b),
                "comparison exclusion library orientation differs from the core manifest",
            )
            _require(REASON_CODE.fullmatch(reason) is not None,
                     "comparison exclusion reason_code is invalid")
            _require(raw_row.get("active") is False,
                     "excluded comparison rows must have active=false")
            rows[key] = {
                "comparison_key": key,
                "library_a": library_a,
                "library_b": library_b,
                "reason_code": reason,
                "active": False,
            }
        self._rows = rows
        self.release_fingerprint = expected_fingerprint
        self.sha256 = hashlib.sha256(raw).hexdigest()
        self.bytes = len(raw)

    @property
    def excluded_keys(self) -> frozenset[str]:
        return frozenset(self._rows)

    def is_excluded(self, comparison_key: object) -> bool:
        return str(comparison_key or "") in self._rows

    def row(self, comparison_key: object) -> dict[str, Any] | None:
        value = self._rows.get(str(comparison_key or ""))
        return None if value is None else dict(value)

    def capabilities(self, planned_count: int) -> dict[str, Any]:
        return {
            "available": True,
            "schema": SCHEMA,
            "release_fingerprint": self.release_fingerprint,
            "policy_sha256": self.sha256,
            "policy_bytes": self.bytes,
            "planned_count": int(planned_count),
            "authorized_count": int(planned_count) - len(self._rows),
            "excluded_count": len(self._rows),
            "exclusions": [dict(self._rows[key]) for key in sorted(self._rows)],
        }


__all__ = ["ComparisonExclusionError", "ComparisonExclusions", "SCHEMA"]
