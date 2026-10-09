"""Exact metadata-only scope totals, including records without matches."""
import json
import sqlite3
from contextlib import closing
from functools import lru_cache

from analysis_api import APIError
from analysis_membership import MembershipFilterError


@lru_cache(maxsize=128)
def _count(database, release, policy, predicate, parameters):
    with closing(sqlite3.connect(database + "?mode=ro&immutable=1", uri=True)) as db:
        return db.execute(
            "SELECT COUNT(DISTINCT m.antigen_id) FROM antigen_membership m WHERE " + predicate,
            parameters,
        ).fetchone()[0]


def scope_count(owner, query):
    if set(query) - {"library", "filters", "component"} or any(len(v) != 1 for v in query.values()):
        raise APIError(400, "Invalid scope-count parameters")
    library = query.get("library", [None])[0]
    membership = getattr(owner, "membership", None)
    if membership is None or library not in membership.libraries:
        raise APIError(404, "Scope metadata unavailable for this library")
    try:
        filters = json.loads(query.get("filters", ["{}"])[0])
        if not isinstance(filters, dict):
            raise ValueError("Expected filters object")
        normalized = membership.normalize(library, filters)
        predicate, parameters = membership.sql_predicate(library, normalized, alias="m")
    except (ValueError, TypeError, MembershipFilterError) as error:
        raise APIError(400, "Invalid record-count scope") from error
    return {
        "library": library,
        "filters": normalized,
        "release_fingerprint": membership.release_fingerprint,
        "filter_policy_fingerprint": membership.filter_policy_fingerprint,
        "records": _count(membership.database.resolve().as_uri(), membership.release_fingerprint,
                          membership.filter_policy_fingerprint, predicate, tuple(parameters)),
    }
