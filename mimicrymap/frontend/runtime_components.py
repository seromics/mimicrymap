"""Load a release-bound collection of independently fingerprinted API components."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping


SCHEMA = "mimicryone/runtime-components/1"
COMPONENT_KEY = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
SIDECAR_KEYS = frozenset(
    {
        "alias_db",
        "asset_crosswalk_db",
        "annotation_db",
        "membership_db",
        "native_annotation_root",
        "parent_db",
        "parent_index",
        "comparison_exclusions",
        "dimer_root",
        "structure_root",
    }
)


@dataclass(frozen=True)
class RuntimeComponent:
    key: str
    primary: bool
    analysis_db: Path | None
    analysis_release_fingerprint: str | None
    explorer_db: Path | None
    explorer_release_fingerprint: str | None
    sidecars: Mapping[str, Path] = field(default_factory=dict)
    sidecar_pins: Mapping[str, Mapping[str, str]] = field(default_factory=dict)


def _path(base: Path, raw: object, context: str) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"{context} must be a nonempty path string")
    candidate = Path(raw).expanduser()
    return (candidate if candidate.is_absolute() else base / candidate).resolve()


def _fingerprint(raw: object, context: str) -> str:
    value = str(raw or "").lower()
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ValueError(f"{context} must be a lowercase 64-character SHA-256")
    return value


def _release(
    base: Path,
    raw: object,
    context: str,
) -> tuple[Path | None, str | None]:
    if raw is None:
        return None, None
    if not isinstance(raw, Mapping) or set(raw) != {"path", "release_fingerprint"}:
        raise ValueError(
            f"{context} must contain exactly path and release_fingerprint"
        )
    return (
        _path(base, raw["path"], f"{context}.path"),
        _fingerprint(raw["release_fingerprint"], f"{context}.release_fingerprint"),
    )


def load_runtime_components(path: Path | str) -> tuple[RuntimeComponent, ...]:
    """Parse a strict manifest without opening any declared release artifact."""

    manifest_path = Path(path).expanduser().resolve()
    try:
        payload: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Cannot read runtime component manifest: {manifest_path}") from error
    if not isinstance(payload, Mapping) or set(payload) != {"schema", "components"}:
        raise ValueError("Runtime component manifest must contain exactly schema and components")
    if payload.get("schema") != SCHEMA:
        raise ValueError(f"Unsupported runtime component schema: {payload.get('schema')!r}")
    rows = payload.get("components")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Runtime component manifest must contain at least one component")

    base = manifest_path.parent
    components: list[RuntimeComponent] = []
    seen: set[str] = set()
    for index, raw in enumerate(rows):
        context = f"components[{index}]"
        if not isinstance(raw, Mapping):
            raise ValueError(f"{context} must be an object")
        unknown = set(raw) - {"key", "primary", "analysis", "explorer", "sidecars"}
        if unknown:
            raise ValueError(f"{context} has unknown fields: {sorted(unknown)}")
        key = raw.get("key")
        if not isinstance(key, str) or COMPONENT_KEY.fullmatch(key) is None:
            raise ValueError(f"{context}.key is invalid")
        if key in seen:
            raise ValueError(f"Duplicate runtime component key: {key}")
        seen.add(key)
        primary = raw.get("primary", False)
        if not isinstance(primary, bool):
            raise ValueError(f"{context}.primary must be true or false")
        analysis_db, analysis_fingerprint = _release(
            base, raw.get("analysis"), f"{context}.analysis"
        )
        explorer_db, explorer_fingerprint = _release(
            base, raw.get("explorer"), f"{context}.explorer"
        )
        if analysis_db is None and explorer_db is None:
            raise ValueError(f"{context} must declare analysis and/or explorer")
        raw_sidecars = raw.get("sidecars", {})
        if not isinstance(raw_sidecars, Mapping):
            raise ValueError(f"{context}.sidecars must be an object")
        unknown_sidecars = set(raw_sidecars) - SIDECAR_KEYS
        if unknown_sidecars:
            raise ValueError(
                f"{context}.sidecars has unknown fields: {sorted(unknown_sidecars)}"
            )
        sidecars: dict[str, Path] = {}
        sidecar_pins: dict[str, Mapping[str, str]] = {}
        for name, value in raw_sidecars.items():
            sidecar_context = f"{context}.sidecars.{name}"
            if name == "asset_crosswalk_db":
                if not isinstance(value, Mapping) or set(value) != {
                    "path", "release_fingerprint", "sha256"
                }:
                    raise ValueError(
                        f"{sidecar_context} must contain exactly path, "
                        "release_fingerprint, and sha256"
                    )
                sidecars[str(name)] = _path(
                    base, value["path"], f"{sidecar_context}.path"
                )
                sidecar_pins[str(name)] = {
                    "release_fingerprint": _fingerprint(
                        value["release_fingerprint"],
                        f"{sidecar_context}.release_fingerprint",
                    ),
                    "sha256": _fingerprint(
                        value["sha256"], f"{sidecar_context}.sha256"
                    ),
                }
            else:
                sidecars[str(name)] = _path(base, value, sidecar_context)
        components.append(
            RuntimeComponent(
                key=key,
                primary=primary,
                analysis_db=analysis_db,
                analysis_release_fingerprint=analysis_fingerprint,
                explorer_db=explorer_db,
                explorer_release_fingerprint=explorer_fingerprint,
                sidecars=sidecars,
                sidecar_pins=sidecar_pins,
            )
        )
    primary = [component.key for component in components if component.primary]
    if len(primary) != 1:
        raise ValueError("Runtime component manifest must mark exactly one component primary")
    return tuple(components)


__all__ = ["RuntimeComponent", "SCHEMA", "load_runtime_components"]
