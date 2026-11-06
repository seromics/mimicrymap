"""MimicryOne bulk CUDA matching adapted to Workspace FASTAs and record IDs.

Uses threshold-specific complete covering seeds and window-budgeted multi-record
batches. Coverage and scientific CSVs remain in the shared JavaScript writers.
"""
import argparse
import ctypes
import json
import importlib.metadata
import os
import queue
import sqlite3
import sys
import threading

# The worker is started with -I; only its own trusted code directory is added.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bulk_seeds import seeds_for_floor, first_eligible_seed_table


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def driver():
    if sys.platform == "darwin":
        raise RuntimeError("NVIDIA acceleration is unavailable on macOS; use CPU.")
    lib = ctypes.CDLL("nvcuda.dll" if sys.platform == "win32" else "libcuda.so.1")
    if lib.cuInit(0) != 0:
        raise RuntimeError("An NVIDIA GPU and working CUDA driver are required.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe-driver", action="store_true")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--library")
    parser.add_argument("--floor", type=int, default=7)
    args = parser.parse_args()
    driver()
    if args.probe_driver:
        emit({"available": True})
        return
    # The optional runtime brings CUDA 12 wheels. Never mix their compiler with
    # a developer's unrelated CUDA_PATH (e.g. globally installed CUDA 13 headers).
    try:
        runtime = importlib.metadata.distribution('nvidia-cuda-runtime-cu12')
        wheel_root = str(runtime.locate_file('nvidia/cuda_runtime'))
        if os.path.isdir(os.path.join(wheel_root, 'include')):
            os.environ['CUDA_PATH'] = wheel_root
            os.environ.pop('CUPY_NVCC_GENERATE_CODE', None)
    except importlib.metadata.PackageNotFoundError:
        pass
    import numpy as np
    import cupy as cp
    # Probe actual kernel compilation, not just driver/device enumeration.
    if int(cp.sum(cp.arange(9, dtype=cp.int32)).get()) != 36:
        raise RuntimeError("CUDA calculation check failed.")
    if args.probe:
        device = cp.cuda.runtime.getDeviceProperties(0)["name"]
        emit({"available": True, "device": device.decode() if isinstance(device, bytes) else device,
              "memory": int(cp.cuda.runtime.getDeviceProperties(0)["totalGlobalMem"]),
              "cupy": cp.__version__})
        return
    if args.floor not in (5, 6, 7, 8, 9):
        raise RuntimeError("GPU matching supports 5/9–9/9.")

    # EOF also arrives when the Node worker is killed. The reader remains active
    # during kernels so cancellation never leaves an orphaned GPU calculation.
    messages = queue.Queue()
    def reader():
        for line in sys.stdin:
            messages.put(json.loads(line))
        os._exit(0)
    threading.Thread(target=reader, daemon=True).start()
    alphabet = "ACDEFGHIKLMNPQRSTVWY"
    lut = np.zeros(256, dtype=np.uint8)
    for i, c in enumerate(alphabet, 1):
        lut[ord(c)] = i
    encode = lambda s: lut[np.frombuffer(s.encode("ascii"), dtype=np.uint8)]
    chunk_size = max(1, int(os.environ.get("SERO_GPU_CHUNK_WINDOWS", "250000")))
    batch_size = max(1, int(os.environ.get("SERO_GPU_CANDIDATES", "250000")))
    query_budget = max(1, int(os.environ.get("SERO_GPU_QUERY_WINDOWS", "100000")))
    seeds = seeds_for_floor(args.floor)
    first_seed = cp.asarray(first_eligible_seed_table(args.floor), dtype=cp.uint8)
    # Preserve the existing 7/9+ cache; lower floors need their own complete
    # indexes and must never reuse a higher-floor candidate population.
    cache_prefix = "gpu-v2-m7-" if args.floor >= 7 else f"gpu-v3-m{args.floor}-"
    index_file = os.path.join(args.library, cache_prefix + "manifest.npz")
    chunks = []
    if os.path.exists(index_file):
        with np.load(index_file, allow_pickle=False) as saved:
            chunks = [os.path.join(args.library, str(n)) for n in saved["files"]]
        if not all(os.path.isfile(f) for f in chunks):
            chunks = []

    def keys(windows, seed, xp):
        code = xp.zeros(len(windows), dtype=xp.uint32)
        valid = xp.ones(len(windows), dtype=xp.bool_)
        for col in seed:
            code = code * 21 + windows[:, col]
            valid &= windows[:, col] != 0
        return code, valid

    if not chunks:
        windows, owners, positions, pending_count = [], [], [], 0
        def flush():
            nonlocal windows, owners, positions, pending_count
            if not pending_count:
                return
            host = {"windows": np.concatenate(windows), "owners": np.concatenate(owners),
                    "positions": np.concatenate(positions)}
            gpu = cp.asarray(host["windows"])
            for b, seed in enumerate(seeds):
                code, valid = keys(gpu, seed, cp)
                inds = cp.flatnonzero(valid)
                order = inds[cp.argsort(code[inds])]
                host["keys" + str(b)] = code[order].get()
                host["order" + str(b)] = order.astype(cp.int32).get()
            name = cache_prefix + str(len(chunks)).zfill(6) + ".npz"
            destination = os.path.join(args.library, name)
            with open(destination + ".pending", "wb") as f:
                np.savez(f, **host)
            os.replace(destination + ".pending", destination)
            chunks.append(destination)
            windows, owners, positions, pending_count = [], [], [], 0
        with sqlite3.connect(os.path.join(args.library, "library.sqlite")) as db:
            total = db.execute("select count(*) from records").fetchone()[0]
            for done, (rid, sequence) in enumerate(db.execute("select id,sequence from records order by id"), 1):
                values = encode(sequence)
                count = max(0, len(values) - 8)
                for offset in range(0, count, chunk_size):
                    n = min(chunk_size, count - offset)
                    if pending_count and pending_count + n > chunk_size:
                        flush()
                    windows.append(np.lib.stride_tricks.sliding_window_view(values[offset:offset+n+8], 9).copy())
                    owners.append(np.full(n, rid, dtype=np.int64))
                    positions.append(np.arange(offset + 1, offset + n + 1, dtype=np.int32))
                    pending_count += n
                    if pending_count >= chunk_size:
                        flush()
                if done % 500 == 0 or done == total:
                    emit({"progress": {"phase": "Indexing GPU parent windows", "done": done, "total": total}})
            flush()
        with open(index_file + ".pending", "wb") as f:
            np.savez(f, files=np.array([os.path.basename(f) for f in chunks], dtype="U100"))
        os.replace(index_file + ".pending", index_file)

    # Keep indexes resident when they fit. Larger libraries stream bounded chunks;
    # output size and duplicate occurrences are never silently capped.
    resident, resident_bytes = {}, 0
    budget = int(cp.cuda.runtime.memGetInfo()[0] * 0.45)
    def load_chunk(filename):
        nonlocal resident_bytes
        if filename in resident:
            return resident[filename]
        with np.load(filename, allow_pickle=False) as saved:
            arrays = {k: cp.asarray(saved[k]) for k in saved.files}
        size = sum(a.nbytes for a in arrays.values())
        if resident_bytes + size <= budget:
            resident[filename] = arrays
            resident_bytes += size
        return arrays

    emit({"ready": True})
    while True:
        message = messages.get()
        if message.get("close"):
            return
        queries = message["queries"]
        # Original bulk layout: query windows, owning records and positions are
        # contiguous arrays. Record boundaries never become sequence windows.
        def query_chunks():
            windows, owners, positions, skips, count = [], [], [], [], 0
            for qid, query in enumerate(queries):
                values = encode(query["sequence"])
                offset, total = 0, max(0, len(values) - 8)
                while offset < total:
                    n = min(query_budget - count, total - offset)
                    windows.append(np.lib.stride_tricks.sliding_window_view(values[offset:offset+n+8], 9).copy())
                    owners.append(np.full(n, qid, dtype=np.int32))
                    positions.append(np.arange(offset + 1, offset + n + 1, dtype=np.int32))
                    skips.append(np.full(n, query.get("skipId") or -1, dtype=np.int64))
                    offset += n
                    count += n
                    if count == query_budget:
                        yield tuple(cp.asarray(np.concatenate(a)) for a in (windows, owners, positions, skips))
                        windows, owners, positions, skips, count = [], [], [], [], 0
            if count:
                yield tuple(cp.asarray(np.concatenate(a)) for a in (windows, owners, positions, skips))

        completed = 0
        for qwin, qowners, qpositions, qskips in query_chunks():
            for filename in chunks:
                p = load_chunk(filename)
                for b, seed in enumerate(seeds):
                    qkeys, valid = keys(qwin, seed, cp)
                    sorted_keys, order = p["keys" + str(b)], p["order" + str(b)]
                    left = cp.searchsorted(sorted_keys, qkeys, side="left")
                    right = cp.searchsorted(sorted_keys, qkeys, side="right")
                    counts = cp.where(valid, right - left, 0)
                    ends = cp.cumsum(counts)
                    total = int(ends[-1].get())
                    starts = ends - counts
                    for offset in range(0, total, batch_size):
                        flat = cp.arange(offset, min(total, offset + batch_size), dtype=cp.int64)
                        qi = cp.searchsorted(ends, flat, side="right")
                        pi = order[left[qi] + flat - starts[qi]]
                        qw, pw = qwin[qi], p["windows"][pi]
                        same = (qw == pw) & (qw != 0)
                        identity = cp.sum(same, axis=1, dtype=cp.int8)
                        keep = identity >= args.floor
                        keep &= p["owners"][pi] != qskips[qi]
                        # Retained bulk builder's constant-size mismatch lookup
                        # replaces repeated comparisons against earlier seeds.
                        masks = cp.zeros(len(qi), dtype=cp.uint16)
                        for col in range(9):
                            masks |= (~same[:, col]).astype(cp.uint16) << col
                        keep &= first_seed[masks] == b
                        inds = cp.flatnonzero(keep)
                        if len(inds):
                            rows = cp.stack((qowners[qi[inds]], p["owners"][pi[inds]], qpositions[qi[inds]],
                                             p["positions"][pi[inds]], identity[inds]), axis=1).get().tolist()
                            emit({"hits": rows})
                del p
            completed += len(qwin)
            emit({"progress": {"detail": "Comparing batch · " + format(completed, ",") + " target windows"}})
        emit({"done": True})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"error": str(error)})
        sys.exit(1)
