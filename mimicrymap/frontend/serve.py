#!/usr/bin/env python3
"""Serve the standalone MimicryMap release and its bounded read-only APIs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import io
from asset_packs import AssetLibrary, AssetPackError
from exposure_assets import ExposureAssets
from contextlib import closing
from http.server import SimpleHTTPRequestHandler
from http_transport import BrowserHTTPServer
from static_asset_cache import StaticAssetCacheMixin
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs

from analysis_api_routes import AnalysisAPI
from canonical_parent_catalog import CanonicalParentCatalog
from composite_analysis_api import CompositeAnalysisAPI
from composite_explorer_api import CompositeExplorerAPI
from explorer_api import ExplorerAPI
from runtime_components import load_runtime_components
from input_package_metadata import metadata_state
from scoped_input_packages import get_package as get_scoped_input_package
from collections import OrderedDict
from public_sections import build as build_public_sections
from prepared_human_records import install as install_prepared_human_records
from prepared_human_index import install as install_prepared_human_index
from human_player_store import install as install_human_player_store


FRONTEND = Path(__file__).resolve().parent
PACK_FRONTEND = Path(os.environ.get('ATLAS_MIMICRYMAP_ROOT', FRONTEND.parent)).resolve() / 'frontend'
DEFAULT_DATA = FRONTEND.parent / "bake" / "out_v2_complete"
ANALYSIS_POST_ROUTES = frozenset({"/api/analysis/player", "/api/analysis/scan", "/api/analysis/live"})
STRUCTURE_ROUTE_RE = re.compile(
    r"^/data/structures/([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\.pdb$"
)
PACKAGED_DIMER_ROUTE_RE = re.compile(
    r"^/data/structures_dimer/([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\.pdb$"
)
ANNOTATION_ASSET_ROUTE_RE = re.compile(
    r"^/data/assets/proteins_catalogue/([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\.json$"
)


def _verified_asset_path(
    candidate: Path,
    expected_sha256: str,
    cache: dict[str, tuple[str, int, int]],
    lock: threading.Lock,
) -> Path | None:
    """Verify a bound asset once, and reverify whenever its stat identity changes."""

    try:
        # Bindings are lexical at startup. Resolve only the requested asset;
        # symlinks must still remain inside the pinned, resolved asset root.
        if candidate.resolve().parent != candidate.parent:
            return None
        stat = candidate.stat()
    except OSError:
        return None
    key = str(candidate)
    with lock:
        cached = cache.get(key)
    if cached == (expected_sha256, stat.st_size, stat.st_mtime_ns):
        return candidate
    digest = hashlib.sha256()
    try:
        with candidate.open("rb") as handle:
            while block := handle.read(8 * 1024 * 1024):
                digest.update(block)
        after = candidate.stat()
    except OSError:
        return None
    if (
        digest.hexdigest() != expected_sha256
        or stat.st_size != after.st_size
        or stat.st_mtime_ns != after.st_mtime_ns
    ):
        return None
    with lock:
        cache[key] = (expected_sha256, after.st_size, after.st_mtime_ns)
    return candidate


class MimicryHandler(StaticAssetCacheMixin, SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    asset_library = None
    exposure_assets = None
    data_root = DEFAULT_DATA
    structure_assets: dict[str, tuple[Path, str]] = {}
    dimer_assets: dict[str, tuple[Path, str]] = {}
    annotation_assets: dict[str, tuple[Path, str]] = {}
    _verified_asset_cache: dict[str, tuple[str, int, int]] = {}
    _asset_cache_lock = threading.Lock()
    analysis_api = None
    explorer_api = None

    _scope_input_paths = OrderedDict()
    _scope_input_lock = threading.Lock()

    def attach_input_package(self, payload):
        """Add exact-scope delivery without changing the authoritative membership."""
        if payload.get("shape") != "scope":
            return
        try:
            prepared = get_scoped_input_package(self.data_root, payload)
            metadata, path = prepared["metadata"], prepared["path"]
            digest = metadata["sha256"]
            with self._scope_input_lock:
                self._scope_input_paths[digest] = path
                self._scope_input_paths.move_to_end(digest)
                while len(self._scope_input_paths) > 128:
                    self._scope_input_paths.popitem(last=False)
            payload["input_package"] = {
                "url": "/data/scoped-inputs/" + digest + ".json.gz?raw=1",
                "metadata": metadata,
            }
        except (OSError, ValueError, KeyError, TypeError) as error:
            # Preserve the verified full-package path if a derived slice is unavailable.
            self.log_message("Scoped input delivery unavailable: %s", str(error))


    def do_GET(self):
        self._static_etag = None
        self._verified_input_package = False
        self._input_raw = False
        self._request_started = time.perf_counter()
        self._player_timings = {}
        if self.exposure_assets is not None and self.exposure_assets.dispatch(self):
            return
        if self.explorer_api is not None and self.explorer_api.dispatch(self):
            return
        if self.analysis_api is not None and self.analysis_api.dispatch(self):
            return
        super().do_GET()

    def do_HEAD(self):
        self._static_etag = None
        self._verified_input_package = False
        self._input_raw = False
        self._request_started = time.perf_counter()
        self._player_timings = {}
        if self.exposure_assets is not None and self.exposure_assets.dispatch(self, head_only=True):
            return
        if self.explorer_api is not None and self.explorer_api.dispatch(self, head_only=True):
            return
        if self.analysis_api is not None and self.analysis_api.dispatch(self, head_only=True):
            return
        super().do_HEAD()

    def do_POST(self):
        self._static_etag = None
        self._verified_input_package = False
        self._input_raw = False
        self._request_started = time.perf_counter()
        self._player_timings = {}
        request_path = urlparse(self.path).path.rstrip("/")
        if (
            self.analysis_api is not None
            and request_path in ANALYSIS_POST_ROUTES
            and self.analysis_api.dispatch(self)
        ):
            return
        self.send_error(405, "POST is supported only by /api/analysis/player, /scan, and /live")

    def send_head(self):
        request_path = unquote(urlparse(self.path).path)
        model = re.fullmatch(r'/data/exposure-models/(AF-[A-Za-z0-9_-]{1,100})\.pdb', request_path)
        if model:
            try:
                asset = self.exposure_assets.model(model.group(1)) if self.exposure_assets else None
            except (OSError, ValueError, sqlite3.Error) as error:
                self.send_error(503, str(error)); return None
            if asset is None:
                self.send_error(404, 'Reference model is unavailable'); return None
            self._static_etag = '"'+asset['sha256']+'"'
            if any(v.strip().removeprefix('W/') in (self._static_etag, '*') for v in self.headers.get('If-None-Match', '').split(',')):
                self.send_response(304); self.end_headers(); return None
            self.send_response(200)
            self.send_header('Content-Type', 'chemical/x-pdb')
            self.send_header('Content-Length', str(len(asset['data'])))
            self.end_headers()
            return io.BytesIO(asset['data'])
        candidate = expected = None
        for regex, bindings in ((STRUCTURE_ROUTE_RE,self.structure_assets),
                                (PACKAGED_DIMER_ROUTE_RE,self.dimer_assets),
                                (ANNOTATION_ASSET_ROUTE_RE,self.annotation_assets)):
            match = regex.fullmatch(request_path)
            if match:
                binding = bindings.get(match.group(1))
                if binding is not None:candidate,expected = binding
                else:candidate = self.data_root / request_path.removeprefix('/data/')
                break
        library = self.asset_library
        if candidate is None and request_path.startswith(('/data/collection-protein-surfaces/','/data/collection-coverage/','/data/collection-sequences/')):
            if any(part in ('.','..') for part in request_path.split('/')):
                self.send_error(404,'Reference asset not found');return None
            candidate = self.data_root / request_path.removeprefix('/data/')
        pack = library.owner(candidate) if library and candidate is not None else None
        if pack is not None:
            self.protocol_version = 'HTTP/1.1'
            self.close_connection = True
            try:asset = pack.get(library.relative(candidate),expected)
            except AssetPackError as error:
                self.send_error(503,str(error));return None
            if asset is None:self.send_error(404,'Reference asset not found');return None
            self._static_etag = '"'+asset['sha256']+'"'
            validators = self.headers.get('If-None-Match','').split(',')
            if any(v.strip().removeprefix('W/') in (self._static_etag,'*') for v in validators):
                self.send_response(304);self.end_headers();return None
            self.send_response(200);self.send_header('Content-Type',self.guess_type(str(candidate)))
            self.send_header('Content-Length',str(len(asset['data'])));self.end_headers()
            return io.BytesIO(asset['data'])
        return super().send_head()

    def translate_path(self, path):
        request_path = unquote(urlparse(path).path)
        parts = request_path.strip('/').split('/')
        if any(part.startswith('.') for part in parts) or (
            len(parts) == 1 and parts[0].lower().endswith('.py')
        ):
            return str(FRONTEND / '__invalid__')
        if request_path == "/plot-palette.js":
            return str(FRONTEND.parent.parent / "atlas/viewer/shared/plotPalette.cjs")
        scoped = re.fullmatch(r"/data/scoped-inputs/([0-9a-f]{64})\.json\.gz", request_path)
        if scoped:
            digest = scoped.group(1)
            with self._scope_input_lock:
                candidate = self._scope_input_paths.get(digest)
            valid = parse_qs(urlparse(path).query) == {"raw": ["1"]}
            verified = (_verified_asset_path(candidate, digest, self._verified_asset_cache, self._asset_cache_lock)
                        if valid and candidate is not None else None)
            self._verified_input_package = verified is not None
            self._input_raw = verified is not None
            return str(verified if verified is not None else self.data_root / "__invalid__")
        match = re.fullmatch(r"/data/local-inputs/([0-9a-f]{64})/([A-Za-z0-9_]+)\.json\.gz", request_path)
        parameters = parse_qs(urlparse(path).query)
        if match and "sha256" in parameters:
            release, library = match.groups()
            candidate = self.data_root / "local-inputs" / release / (library + ".json.gz")
            try:
                metadata = json.loads(candidate.with_name(library + ".meta.json").read_text(encoding="utf-8"))
                digest = metadata["sha256"]
                valid = (metadata.get("schema") == "mimicryone/local-input-metadata/1"
                         and metadata.get("release_fingerprint") == release and metadata.get("library") == library
                         and re.fullmatch(r"[0-9a-f]{64}", digest) and parameters in ({"sha256": [digest]}, {"sha256": [digest], "raw": ["1"]}))
                verified = _verified_asset_path(candidate, digest, self._verified_asset_cache, self._asset_cache_lock) if valid else None
            except (OSError, ValueError, KeyError, TypeError):
                verified = None
            self._verified_input_package = verified is not None
            self._input_raw = verified is not None and parameters.get("raw") == ["1"]
            return str(verified if verified is not None else self.data_root / "__invalid__")
        if request_path.startswith("/data/structures/"):
            match = STRUCTURE_ROUTE_RE.fullmatch(request_path)
            if match is None:
                return str(self.data_root.resolve() / "__invalid__")
            accession = match.group(1)
            binding = self.structure_assets.get(accession)
            if binding is not None:
                verified = _verified_asset_path(
                    binding[0],
                    binding[1],
                    self._verified_asset_cache,
                    self._asset_cache_lock,
                )
                return str(
                    verified
                    if verified is not None
                    else self.data_root.resolve() / "__invalid__"
                )
            # Keep the small packaged demonstration set as a compatibility
            # fallback when no declared external cache contains the accession.
        if request_path.startswith("/data/structures_dimer/"):
            match = PACKAGED_DIMER_ROUTE_RE.fullmatch(request_path)
            if match is None:
                return str(self.data_root.resolve() / "__invalid__")
            binding = self.dimer_assets.get(match.group(1))
            if binding is not None:
                verified = _verified_asset_path(
                    binding[0],
                    binding[1],
                    self._verified_asset_cache,
                    self._asset_cache_lock,
                )
                return str(
                    verified
                    if verified is not None
                    else self.data_root.resolve() / "__invalid__"
                )
        if request_path.startswith("/data/assets/proteins_catalogue/"):
            match = ANNOTATION_ASSET_ROUTE_RE.fullmatch(request_path)
            if match is None:
                return str(self.data_root.resolve() / "__invalid__")
            binding = self.annotation_assets.get(match.group(1))
            if binding is not None:
                verified = _verified_asset_path(
                    binding[0],
                    binding[1],
                    self._verified_asset_cache,
                    self._asset_cache_lock,
                )
                return str(
                    verified
                    if verified is not None
                    else self.data_root.resolve() / "__invalid__"
                )
        if request_path.startswith("/data/"):
            relative = request_path.removeprefix("/data/")
            candidate = (self.data_root / relative).resolve()
            root = self.data_root.resolve()
            if root not in candidate.parents and candidate != root:
                return str(root / "__invalid__")
            return str(candidate)
        if request_path in ("", "/"):
            return str(FRONTEND / "index.html")
        candidate = (FRONTEND / request_path.lstrip("/")).resolve()
        if FRONTEND not in candidate.parents and candidate != FRONTEND:
            return str(FRONTEND / "__invalid__")
        if not candidate.is_file() and PACK_FRONTEND != FRONTEND:
            # Data/examples stay in the immutable pack. Never fall back to an
            # old executable runtime from that pack when tracked code is absent.
            suffix = candidate.suffix.lower()
            relative = candidate.relative_to(FRONTEND)
            if suffix not in {'.py', '.js', '.mjs', '.html', '.css'}:
                packed = (PACK_FRONTEND / relative).resolve()
                if PACK_FRONTEND in packed.parents:
                    return str(packed)
        return str(candidate)

    def guess_type(self, path):
        if str(path).endswith(".cjs"):
            return "text/javascript; charset=utf-8"
        if str(path).lower().endswith(".csv"):
            return "text/csv; charset=utf-8"
        if path.endswith(".json.gz") and getattr(self, "_input_raw", False):
            return "application/gzip"
        if path.endswith(".json") or path.endswith(".json.gz"):
            return "application/json; charset=utf-8"
        if path.endswith((".js", ".mjs")):
            return "text/javascript; charset=utf-8"
        if path.endswith(".css"):
            return "text/css; charset=utf-8"
        if path.endswith(".woff2"):
            return "font/woff2"
        if path.endswith(".pdb"):
            return "chemical/x-pdb"
        return super().guess_type(path)

    def send_response(self, code, message=None):
        self._response_status = code
        super().send_response(code, message)

    def end_headers(self):
        started = getattr(self, "_request_started", None)
        if started is not None:
            timing = [f"prepare;dur={(time.perf_counter()-started)*1000:.3f}"]
            timing.extend(f"{name};dur={duration:.3f}"
                          for name, duration in getattr(self, "_player_timings", {}).items())
            self.send_header("Server-Timing", ", ".join(timing))
        if urlparse(self.path).path.endswith(".json.gz") and not getattr(self, "_input_raw", False) and getattr(self, "_response_status", 0) in (200, 304):
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable"
                         if getattr(self, "_verified_input_package", False) and getattr(self, "_response_status", 0) in (200, 304) else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def log_message(self, format_string, *arguments):
        print(f"[{self.log_date_time_string()}] {format_string % arguments}")


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5182)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--player-record-cache", type=Path,
                        default=DEFAULT_DATA.parent / "player-record-cache",
                        help="Private persistent human display-record cache; never an installed release")
    parser.add_argument("--human-player-store", type=Path,
                        default=DEFAULT_DATA.parent / "player-result-cache",
                        help="Private prepared complete human-to-human responses")
    parser.add_argument("--prepare-human-records", action=argparse.BooleanOptionalAction,
                        default=True, help="Resolve human-to-human display metadata before accepting requests")
    parser.add_argument(
        "--analysis-db",
        type=Path,
        help="Analysis release directory, or its catalog.sqlite file",
    )
    parser.add_argument(
        "--explorer-db",
        type=Path,
        help="PanScan9 Protein Explorer release directory, or its explorer.sqlite file",
    )
    parser.add_argument(
        "--alias-db",
        type=Path,
        help="Versioned canonical human alias sidecar SQLite file",
    )
    parser.add_argument(
        "--annotation-db",
        type=Path,
        help="Optional versioned display-annotation sidecar SQLite file",
    )
    parser.add_argument(
        "--membership-db",
        type=Path,
        help="Versioned PanScan9 antigen-membership sidecar SQLite file",
    )
    parser.add_argument(
        "--asset-crosswalk-db",
        type=Path,
        help="Versioned coordinate-safe native-asset crosswalk SQLite file",
    )
    parser.add_argument(
        "--parent-db",
        type=Path,
        help="Frozen canonical parent catalog directory, or its SQLite file",
    )
    parser.add_argument(
        "--parent-index",
        type=Path,
        help="Frozen canonical Human/Exposure live-index sidecar directory",
    )
    parser.add_argument(
        "--comparison-exclusions",
        type=Path,
        help="Release-bound comparison exclusion policy JSON",
    )
    parser.add_argument(
        "--structure-root",
        type=Path,
        help="External AlphaFold monomer cache containing AF-{accession}-F1-model_v6.pdb",
    )
    parser.add_argument(
        "--native-annotation-root",
        type=Path,
        help="Verified native annotation JSON root containing {accession}.json",
    )
    parser.add_argument(
        "--dimer-root",
        type=Path,
        help="Verified packaged homodimer root containing {accession}.pdb",
    )
    parser.add_argument(
        "--component-manifest",
        type=Path,
        help=(
            "Release-bound runtime component manifest. This is mutually exclusive "
            "with the legacy single-release database and sidecar flags."
        ),
    )
    parser.add_argument(
        "--require-input-packages",
        action=argparse.BooleanOptionalAction, default=True,
        help=(
            "Require a compatible prepared input package for every mounted library "
            "by default. Disable only for an incomplete development preview."
        ),
    )
    return parser


def _component_apis(component_manifest: Path, *, unavailable_assets=frozenset()):
    specifications = load_runtime_components(component_manifest)
    analysis_components = {}
    explorer_components = {}
    primary_key = next(row.key for row in specifications if row.primary)
    for specification in specifications:
        sidecars = specification.sidecars
        parent_catalog = (
            CanonicalParentCatalog(sidecars["parent_db"])
            if "parent_db" in sidecars
            else None
        )
        if specification.analysis_db is not None:
            analysis = AnalysisAPI(
                specification.analysis_db,
                explorer_db=specification.explorer_db,
                alias_db=sidecars.get("alias_db"),
                annotation_db=sidecars.get("annotation_db"),
                membership_db=sidecars.get("membership_db"),
                parent_catalog=parent_catalog,
                parent_index_root=sidecars.get("parent_index"),
                comparison_exclusions=sidecars.get("comparison_exclusions"),
            )
            # Release acceptance binds data/configuration, never unrelated source edits.
            analysis._saved_acceptance_sources = {
                "runtime_manifest": Path(component_manifest).resolve(),
                "analysis_manifest": analysis.manifest_path,
                "explorer": analysis.player_service.explorer_database,
                **{name: path for name, path in sidecars.items() if path.is_file()},
            }
            observed = str(analysis.manifest.get("release_fingerprint") or "")
            if observed != specification.analysis_release_fingerprint:
                raise ValueError(
                    f"Analysis fingerprint differs for component {specification.key!r}"
                )
            analysis_components[specification.key] = analysis
        if specification.explorer_db is not None:
            asset_pins = specification.sidecar_pins.get(
                "asset_crosswalk_db", {}
            )
            explorer = ExplorerAPI(
                specification.explorer_db,
                alias_db=sidecars.get("alias_db"),
                annotation_db=sidecars.get("annotation_db"),
                parent_catalog=parent_catalog,
                asset_crosswalk_db=sidecars.get("asset_crosswalk_db"),
                asset_crosswalk_release_fingerprint=asset_pins.get(
                    "release_fingerprint"
                ),
                asset_crosswalk_sha256=asset_pins.get("sha256"),
            )
            observed = str(explorer.manifest.get("release_fingerprint") or "")
            if observed != specification.explorer_release_fingerprint:
                raise ValueError(
                    f"Explorer fingerprint differs for component {specification.key!r}"
                )
            explorer_components[specification.key] = explorer
    if primary_key not in analysis_components or primary_key not in explorer_components:
        raise ValueError(
            "The primary runtime component must declare both analysis and explorer releases"
        )
    # A non-primary component may mount analysis alone. Demanding both of every component was
    # too strict: load_runtime_components accepts "analysis and/or explorer", the asset-binding
    # loop below already skips components with no explorer, and a release added only to serve
    # one extra library pair has no protein-explorer content of its own to publish. The primary
    # still has to declare both, checked just above, and an explorer release still needs its own
    # analysis release because the composite explorer crosswalks the two.
    explorer_without_analysis = sorted(set(explorer_components) - set(analysis_components))
    if explorer_without_analysis:
        raise ValueError(
            "Runtime components declaring an explorer release must also declare analysis: "
            + ", ".join(explorer_without_analysis)
        )
    # Manifest mode always exposes component identity, even while a deployment is
    # staged with one component.  Legacy flags retain the original single API.
    analysis_api = CompositeAnalysisAPI(analysis_components, primary=primary_key)
    explorer_api = CompositeExplorerAPI(
        explorer_components,
        primary=primary_key,
        analysis_components=analysis_components,
    )
    analysis_api.record_identity_crosswalks = explorer_api.analysis_crosswalks
    bindings = {
        "structure": {},
        "dimer": {},
        "annotation": {},
    }
    root_keys = {
        "structure": "structure_root",
        "dimer": "dimer_root",
        "annotation": "native_annotation_root",
    }
    declared_roots = {}
    for specification in specifications:
        explorer = explorer_components.get(specification.key)
        if explorer is None or "asset_crosswalk_db" not in specification.sidecars:
            continue
        component_hashes = {
            "structure": getattr(explorer, "structure_asset_hashes", {}),
            "dimer": getattr(explorer, "dimer_asset_hashes", {}),
            "annotation": getattr(explorer, "annotation_asset_hashes", {}),
        }
        for kind, hashes in component_hashes.items():
            # Desktop installations may omit whole optional structure modules.
            # Declared, installed assets retain the ordinary integrity checks.
            if kind in unavailable_assets:
                continue
            if not hashes:
                continue
            root_key = root_keys[kind]
            root = specification.sidecars.get(root_key)
            if root is None:
                raise ValueError(
                    f"component {specification.key!r} has {kind} assets "
                    f"but does not declare {root_key}"
                )
            root = root.resolve()
            if not root.is_dir() and not (MimicryHandler.asset_library and MimicryHandler.asset_library.supports_root(root)):
                raise FileNotFoundError(root)
            if kind in declared_roots and declared_roots[kind] != root:
                raise ValueError(
                    f"runtime components declare conflicting {root_key} paths"
                )
            declared_roots[kind] = root
            for accession, digest in hashes.items():
                filename = (
                    f"AF-{accession}-F1-model_v6.pdb"
                    if kind == "structure"
                    else f"{accession}.pdb"
                    if kind == "dimer"
                    else f"{accession}.json"
                )
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', accession):
                    raise ValueError(f"unsafe {kind} asset path for {accession!r}")
                # Defer filesystem work for ~84,000 assets until requested.
                # _verified_asset_path enforces containment and the pinned hash.
                candidate = root / filename
                existing = bindings[kind].get(accession)
                binding = (candidate, digest)
                if existing is not None and existing != binding:
                    raise ValueError(
                        f"runtime components disagree on {kind} asset {accession}"
                    )
                bindings[kind][accession] = binding
    explorer_api.asset_bindings = bindings
    return analysis_api, explorer_api


def _report_local_input_packages(analysis_api, data_root, *, required=False):
    """Report which mounted libraries have a baked local-input package.

    Packages are keyed by release fingerprint, so a rebuilt release invalidates them.
    Browser input loading requires a compatible package for every mounted library.
    """
    if analysis_api is None or data_root is None:
        return
    roots = getattr(analysis_api, "roots", None)
    components = roots.items() if roots else [("primary", getattr(analysis_api, "root", None))]
    present, missing = 0, []
    for _key, root in components:
        if root is None:
            continue
        try:
            manifest = json.loads((Path(root) / "manifest.json").read_text(encoding="utf-8"))
            fingerprint = str(manifest["release_fingerprint"])
            with closing(sqlite3.connect(
                (Path(root) / "catalog.sqlite").resolve().as_uri() + "?mode=ro&immutable=1", uri=True
            )) as catalog:
                libraries = [row[0] for row in catalog.execute(
                    "SELECT DISTINCT library_key FROM antigen ORDER BY library_key")]
        except (OSError, KeyError, ValueError, sqlite3.Error):
            continue
        for library in libraries:
            package = Path(data_root) / "local-inputs" / fingerprint / f"{library}.json.gz"
            component = getattr(analysis_api, "components", {}).get(_key, analysis_api)
            membership = getattr(component, "membership", None)
            required_fields = ({"is_control", *membership.row_filter_columns(library).values()}
                               if membership is not None and library in membership.libraries else set())
            if package.is_file() and metadata_state(package, required_membership=required_fields) == "current":
                present += 1
            else:
                missing.append(library)
    total = present + len(missing)
    if not total:
        return
    print(f"Baked local-input packages: {present:,}/{total:,}")
    if not missing:
        return
    detail = ", ".join(sorted(missing))
    advice = ("python tools/bake_local_input_packages.py --component-manifest <manifest> "
              "--data <data-root>")
    if required:
        raise SystemExit(
            f"Missing or invalid local-input packages or metadata for: {detail}\n"
            f"Browser-local runs require these prepared packages.\n"
            f"Build them with:\n  {advice}"
        )
    print(f"  WARNING missing packages ({detail}); browser-local threshold runs will "
          f"be unavailable for those libraries. Build with:\n    {advice}")


def main():
    parser = make_parser()
    arguments = parser.parse_args()
    # Public prose is authored in docs/public; internal handbook pages are never published.
    build_public_sections()
    legacy_values = (
        arguments.analysis_db,
        arguments.explorer_db,
        arguments.alias_db,
        arguments.annotation_db,
        arguments.membership_db,
        arguments.asset_crosswalk_db,
        arguments.parent_db,
        arguments.parent_index,
        arguments.comparison_exclusions,
        arguments.structure_root,
        arguments.native_annotation_root,
        arguments.dimer_root,
    )
    if arguments.component_manifest is not None and any(
        value is not None for value in legacy_values
    ):
        parser.error(
            "--component-manifest is mutually exclusive with legacy database/sidecar flags"
        )
    MimicryHandler.asset_library = AssetLibrary(os.environ.get('SERO_DESKTOP_MODULE_ROOT', PACK_FRONTEND.parent.parent))
    MimicryHandler.exposure_assets = ExposureAssets(MimicryHandler.asset_library.root)
    if arguments.component_manifest is not None:
        analysis_api, explorer_api = _component_apis(
            arguments.component_manifest
        )
        parent_catalog = None
    else:
        analysis_api = explorer_api = None
        parent_catalog = (
            CanonicalParentCatalog(arguments.parent_db)
            if arguments.parent_db is not None
            else None
        )
        analysis_api = (
            AnalysisAPI(
                arguments.analysis_db,
                explorer_db=arguments.explorer_db,
                alias_db=arguments.alias_db,
                annotation_db=arguments.annotation_db,
                membership_db=arguments.membership_db,
                parent_catalog=parent_catalog,
                parent_index_root=arguments.parent_index,
                comparison_exclusions=arguments.comparison_exclusions,
            )
            if arguments.analysis_db is not None
            else None
        )
        explorer_api = (
            ExplorerAPI(
                arguments.explorer_db,
                alias_db=arguments.alias_db,
                annotation_db=arguments.annotation_db,
                parent_catalog=parent_catalog,
                asset_crosswalk_db=arguments.asset_crosswalk_db,
            )
            if arguments.explorer_db is not None else None
        )
    MimicryHandler.data_root = arguments.data.resolve()
    if arguments.component_manifest is not None:
        asset_bindings = getattr(
            explorer_api,
            "asset_bindings",
            {"structure": {}, "dimer": {}, "annotation": {}},
        )
    else:
        asset_bindings = {"structure": {}, "dimer": {}, "annotation": {}}
        if explorer_api is not None and arguments.asset_crosswalk_db is not None:
            roots = {
                "structure": arguments.structure_root,
                "dimer": arguments.dimer_root,
                "annotation": arguments.native_annotation_root,
            }
            hashes_by_kind = {
                "structure": explorer_api.structure_asset_hashes,
                "dimer": explorer_api.dimer_asset_hashes,
                "annotation": explorer_api.annotation_asset_hashes,
            }
            for kind, hashes in hashes_by_kind.items():
                if not hashes:
                    continue
                root_value = roots[kind]
                if root_value is None:
                    raise ValueError(f"--{kind.replace('_', '-')} root is required")
                root = root_value.resolve()
                if not root.is_dir() and not MimicryHandler.asset_library.supports_root(root):
                    raise FileNotFoundError(root)
                for accession, digest in hashes.items():
                    filename = (
                        f"AF-{accession}-F1-model_v6.pdb"
                        if kind == "structure"
                        else f"{accession}.pdb"
                        if kind == "dimer"
                        else f"{accession}.json"
                    )
                    candidate = (root / filename).resolve()
                    if candidate.parent != root:
                        raise ValueError(f"unsafe {kind} asset path for {accession!r}")
                    if not candidate.is_file() and not MimicryHandler.asset_library.owner(candidate):
                        raise FileNotFoundError(candidate)
                    asset_bindings[kind][accession] = (candidate, digest)
    MimicryHandler.structure_assets = asset_bindings["structure"]
    MimicryHandler.dimer_assets = asset_bindings["dimer"]
    MimicryHandler.annotation_assets = asset_bindings["annotation"]
    MimicryHandler._verified_asset_cache = {}
    MimicryHandler._asset_cache_lock = threading.Lock()
    if arguments.prepare_human_records:
        install_prepared_human_records(analysis_api, arguments.player_record_cache.resolve())
        install_prepared_human_index(analysis_api)
    install_human_player_store(analysis_api, arguments.human_player_store.resolve())
    MimicryHandler.analysis_api = analysis_api
    MimicryHandler.explorer_api = explorer_api
    os.chdir(FRONTEND)
    server = BrowserHTTPServer((arguments.host, arguments.port), MimicryHandler)
    print(f"MimicryMap: http://{arguments.host}:{arguments.port}")
    print(f"Artifacts: {MimicryHandler.data_root}")
    print(f"Verified AlphaFold structures: {len(MimicryHandler.structure_assets):,}")
    print(f"Verified native annotation tracks: {len(MimicryHandler.annotation_assets):,}")
    print(f"Verified homodimers: {len(MimicryHandler.dimer_assets):,}")
    _report_local_input_packages(MimicryHandler.analysis_api, MimicryHandler.data_root,
                                 required=arguments.require_input_packages)
    if MimicryHandler.analysis_api is not None:
        roots = getattr(
            MimicryHandler.analysis_api,
            "roots",
            {"primary": MimicryHandler.analysis_api.root},
        )
        for key, root in roots.items():
            print(f"Analysis [{key}]: {root}")
    if MimicryHandler.explorer_api is not None:
        roots = getattr(
            MimicryHandler.explorer_api,
            "roots",
            {"primary": MimicryHandler.explorer_api.root},
        )
        for key, root in roots.items():
            print(f"Protein Explorer [{key}]: {root}")
    if (
        MimicryHandler.analysis_api is not None
        and MimicryHandler.analysis_api.canonical_parent_index_service is not None
    ):
        print(
            "Canonical parent index: "
            f"{MimicryHandler.analysis_api.canonical_parent_index_service.index.root}"
        )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if MimicryHandler.asset_library:MimicryHandler.asset_library.close()


if __name__ == "__main__":
    main()
