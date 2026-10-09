"""Serve clone-local metadata and static assets; comparisons run in the browser."""
from pathlib import Path
import sys
import os
CODE_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get('ATLAS_MIMICRYMAP_ROOT', CODE_ROOT)).resolve()
# Isolation guard: the lite service must never read data from the original checkout.
ORIGINAL = ROOT.with_name("MimicryOne")
def isolation_guard(event, args):
    if event not in {"open", "sqlite3.connect"} or not args: return
    raw = args[0]
    if not isinstance(raw, (str, bytes, os.PathLike)): return
    value = os.fsdecode(raw)
    if value.startswith("file:"):
        from urllib.parse import unquote, urlparse
        value = unquote(urlparse(value).path).lstrip("/")
    try:
        candidate = Path(value).resolve()
        if candidate == ORIGINAL or ORIGINAL in candidate.parents:
            raise PermissionError("Lite isolation guard refused original-project access")
    except (OSError, ValueError):
        raise
sys.addaudithook(isolation_guard)
sys.path.insert(0, str(CODE_ROOT / "frontend"))
import serve
from analysis_api import _send_json

def no_server_comparison(self):
    _send_json(self, 409, {"error": "This lite deployment computes interactive comparisons in the browser.", "code": "browser_compute_required"})


def main():
    serve.install_human_player_store = lambda *args, **kwargs: None
    serve.MimicryHandler.do_POST = no_server_comparison
    supplied = sys.argv[1:]
    if "--data" not in supplied:
        supplied += ["--data", str(ROOT / "bake/out_v2_complete")]
    if "--component-manifest" not in supplied:
        directory = ROOT / "bake/releases/mimicryone_runtime_20260904_r1"
        manifest = directory / "runtime_components_lite.json"
        if os.environ.get("SERO_DESKTOP_MODULE_ROOT") and not manifest.is_file():
            manifest = directory / "runtime_components_local.json"
        supplied += ["--component-manifest", str(manifest)]
    if "--port" not in supplied: supplied += ["--port", "5186"]
    supplied += ["--no-prepare-human-records"]
    sys.argv = [sys.argv[0], *supplied]
    serve.main()

if __name__ == "__main__": main()
