"""Request-local preparation timings; no records or query values are retained."""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from time import perf_counter

_current = ContextVar("player_preparation_timings", default=None)


@contextmanager
def collect():
    timings = {}
    token = _current.set(timings)
    try:
        yield timings
    finally:
        _current.reset(token)


def timed(name):
    def decorate(function):
        @wraps(function)
        def call(*args, **kwargs):
            timings = _current.get()
            if timings is None:
                return function(*args, **kwargs)
            started = perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                timings[name] = timings.get(name, 0.0) + (perf_counter() - started) * 1000
        return call
    return decorate
