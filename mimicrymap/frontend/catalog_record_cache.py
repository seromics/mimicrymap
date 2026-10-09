"""Bounded hydrated records from one immutable installed catalog.

Each player service owns its own cache; custom inputs never enter it. Copies at
both boundaries keep mutable annotation/provenance fields request-local.
"""
from collections import OrderedDict
from copy import deepcopy
from sys import getsizeof
from threading import Lock


def _size(value, seen):
    identity = id(value)
    if identity in seen:
        return 0
    seen.add(identity)
    size = getsizeof(value)
    if isinstance(value, dict):
        size += sum(_size(k, seen) + _size(v, seen) for k, v in value.items())
    elif isinstance(value, (list, tuple)):
        size += sum(_size(v, seen) for v in value)
    return size


class CatalogRecordCache:
    def __init__(self, max_bytes=16 * 1024 * 1024, max_entries=4096):
        self.max_bytes, self.max_entries = max_bytes, max_entries
        self._items = OrderedDict()
        self._bytes = 0
        self._lock = Lock()

    def get_many(self, identifiers):
        with self._lock:
            found = {}
            for identifier in identifiers:
                item = self._items.get(identifier)
                if item is not None:
                    self._items.move_to_end(identifier)
                    found[identifier] = item[0]
        return {identifier: deepcopy(record) for identifier, record in found.items()}

    def put(self, record):
        if record.antigen_id is None:
            return
        # Account for nested annotations and strings as well as entry overhead.
        # Shared strings are charged per entry, conservatively bounding retention.
        size = getsizeof(record) + _size(vars(record), set()) + 256
        if size > self.max_bytes or self.max_entries < 1:
            return
        stored = deepcopy(record)
        with self._lock:
            previous = self._items.pop(record.antigen_id, None)
            if previous is not None:
                self._bytes -= previous[1]
            self._items[record.antigen_id] = (stored, size)
            self._bytes += size
            while self._bytes > self.max_bytes or len(self._items) > self.max_entries:
                self._bytes -= self._items.popitem(last=False)[1][1]
