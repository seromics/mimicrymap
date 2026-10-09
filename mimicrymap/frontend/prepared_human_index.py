"""Keep immutable human lookup keys ready; leave large position arrays mapped."""
from pathlib import Path
import time

import numpy as np
from analysis_scan import ScanError

MAX_KEY_BYTES = 512 * 1024 * 1024
MAX_MAPPED_BYTES = 3 * 1024 * 1024 * 1024


class PreparedHumanIndex:
    def __init__(self, root):
        self.root = Path(root)
        paths = [self.root / name for name in ("window_antigen.npy", "windows.npy", "window_position.npy")]
        paths += sorted((self.root / "indexes" / "m7").glob("seed_*/*.npy"))
        keys = [path for path in paths if path.name == "unique_keys.npy"]
        self.key_bytes = sum(path.stat().st_size for path in keys)
        self.mapped_bytes = sum(path.stat().st_size for path in paths if path not in keys)
        if not keys or self.key_bytes > MAX_KEY_BYTES or self.mapped_bytes > MAX_MAPPED_BYTES:
            raise ValueError("Human lookup arrays exceed the preparation budget")
        arrays = {}
        for path in paths:
            # Sequentially read the small search-key portion once at startup.
            # Retain read-only mappings for offsets, positions and source windows.
            # Plain ndarray views avoid propagating memmap objects into temporary
            # indexing results; all elements, dtypes and shapes remain identical.
            array = np.load(path, allow_pickle=False, mmap_mode=None if path in keys else "r")
            array = array.view(np.ndarray)
            array.flags.writeable = False
            arrays[path] = array
        self._arrays = arrays

    def load(self, path):
        return self._arrays[Path(path)]


def install(analysis_api):
    if analysis_api is None:
        return
    components = getattr(analysis_api, "components", None) or {"primary": analysis_api}
    for key, component in components.items():
        if "canonical_human" not in component.library_keys:
            continue
        service = component.player_service
        started = time.perf_counter()
        try:
            root = service._static_m7_root("canonical_human")
            if root is None:
                continue
            prepared = PreparedHumanIndex(root)
            service._prepared_human_index = prepared
            print(f"Prepared human index [{key}]: {prepared.key_bytes / 1048576:.1f} MiB keys; "
                  f"remaining arrays read-only mapped; {time.perf_counter() - started:.2f}s")
        except (OSError, ValueError, MemoryError, ScanError):
            print(f"Prepared human index [{key}] unavailable; using request-time array loading.")
