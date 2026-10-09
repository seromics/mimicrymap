"""Bounded, process-local cache for complete public indexed player responses.

No custom inputs, live scans, incomplete responses or user-specific results.
Cache lifetime is one immutable server deployment; release and all request fields
participate in identity. Bytes are retained so consumers cannot mutate a cached result.
"""
from collections import OrderedDict
from contextlib import contextmanager
import hashlib
import gzip
import json
import select
import socket
import threading


def disconnected(handler):
    connection = getattr(handler, "connection", None)
    if connection is None:
        return False
    try:
        readable, _, _ = select.select([connection], [], [], 0)
        return bool(readable) and connection.recv(1, socket.MSG_PEEK) == b""
    except (BlockingIOError, InterruptedError):
        return False
    except OSError:
        return True


class PublicResultCache:
    def __init__(self, max_bytes=64 * 1024 * 1024, max_entries=32):
        self.max_bytes, self.max_entries = max_bytes, max_entries
        self._items = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()
        self._pending_wire = {}

    @staticmethod
    def key(component, fingerprint, request):
        if not isinstance(request, dict) or not isinstance(request.get("query"), dict) or not isinstance(request.get("target"), dict):
            return None
        if (request.get("query", {}).get("kind") not in {"library", "portable_protein"}
                or request.get("target", {}).get("kind") not in {"library", "canonical_proteome"}
                or request.get("floor", 7) not in (7, 8, 9) or request.get("include_hits") is not True):
            return None
        body = json.dumps(["public-player-response/1", component, fingerprint, request], sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(body.encode()).hexdigest()

    def get(self, key):
        with self._lock:
            value = self._items.get(key)
            if value is None:
                return None
            self._items.move_to_end(key)
        return json.loads(value)

    def put(self, key, response):
        execution = response.get("execution", {})
        if key is None or execution.get("complete") is not True or execution.get("positional_hits_included") is not True:
            return
        value = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._store(key, value)

    def _store(self, key, value):
        if key is None:
            return
        if len(value) > self.max_bytes:
            return
        with self._lock:
            if key in self._items:
                self._bytes -= len(self._items.pop(key))
            self._items[key] = value
            self._bytes += len(value)
            while self._bytes > self.max_bytes or len(self._items) > self.max_entries:
                self._bytes -= len(self._items.popitem(last=False)[1])

    @contextmanager
    def deferred_wire(self, key):
        """Let an immediate download await post-delivery serialization.

        Only bounded completion notices are retained, never response objects or
        queued jobs. The existing request thread does the serialization. Failure
        always wakes waiters, which can then follow the normal cache-miss path.
        """
        event = None
        with self._lock:
            if key is not None and key not in self._pending_wire and len(self._pending_wire) < self.max_entries:
                event = threading.Event()
                self._pending_wire[key] = event
        try:
            yield
        finally:
            if event is not None:
                with self._lock:
                    self._pending_wire.pop(key, None)
                    event.set()

    def get_wire(self, key, accepts_gzip):
        """Final post-crosswalk bytes; no JSON parsing or annotation on a hit."""
        if key is None:
            return None
        wire_key = ('wire', key, bool(accepts_gzip))
        with self._lock:
            pending = self._pending_wire.get(key) if (
                wire_key not in self._items and ('wire', key, False) not in self._items
            ) else None
        if pending is not None:
            # A stalled client must not hold another request indefinitely.
            pending.wait(timeout=30)
        with self._lock:
            value = self._items.get(wire_key)
            if value is not None:
                self._items.move_to_end(wire_key)
            plain = self._items.get(('wire', key, False)) if accepts_gzip and value is None else None
        if plain is not None:
            value = gzip.compress(plain, compresslevel=5, mtime=0) if len(plain) >= 1024 else plain
            self._store(wire_key, value)
        return None if value is None else (value, value.startswith(b'\x1f\x8b'))

    def encode_wire(self, key, response, accepts_gzip):
        value = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode('utf-8')
        plain = value
        compressed = bool(accepts_gzip) and len(value) >= 1024
        if compressed:
            value = gzip.compress(value, compresslevel=5, mtime=0)
        execution = response.get('execution', {})
        if key is not None and execution.get('complete') is True and execution.get('positional_hits_included') is True:
            self._store(('wire', key, False), plain)
            self._store(('wire', key, bool(accepts_gzip)), value)
        return value, compressed
