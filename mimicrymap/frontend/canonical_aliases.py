"""Read-only loader contract for the MimicryMap canonical alias sidecar."""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from contextlib import closing, contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any


SCHEMA = "mimicryone/canonical-human-alias-sidecar/1"
USER_VERSION = 1
_metadata_connections = ContextVar('metadata_connections', default=None)
_metadata_paths = ContextVar('metadata_paths', default=None)


@contextmanager
def metadata_read_session():
    """Reuse immutable metadata connections within one request, never across threads."""
    if _metadata_connections.get() is not None:
        yield
        return
    connections = {}
    token = _metadata_connections.set(connections)
    paths_token = _metadata_paths.set({})
    try:
        yield
    finally:
        _metadata_paths.reset(paths_token)
        _metadata_connections.reset(token)
        for connection in connections.values():
            connection.close()


@contextmanager
def metadata_connection(path):
    connections = _metadata_connections.get()
    if connections is None:
        with closing(read_only_connection(path)) as connection:
            yield connection
    else:
        # Resolve each spelling once per request. Relative paths include the cwd;
        # aliases still converge on one canonical connection, without a global
        # path cache that could outlive a changed symlink or deployment.
        supplied = Path(path)
        raw_key = str(supplied if supplied.is_absolute() else Path.cwd() / supplied)
        paths = _metadata_paths.get()
        key = paths.get(raw_key)
        if key is None:
            key = str(supplied.resolve())
            paths[raw_key] = key
        if key not in connections:
            connections[key] = read_only_connection(key)
        yield connections[key]


def normalize_alias(value: object) -> str:
    """Normalize an exact alias key without erasing meaningful punctuation."""

    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    return re.sub(r"\s+", " ", text).upper()


def read_only_connection(path: Path | str) -> sqlite3.Connection:
    resolved = Path(path).resolve()
    connection = sqlite3.connect(resolved.as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


class CanonicalAliasResolver:
    """Resolve an exact human alias while preserving one-to-many mappings."""

    def __init__(self, database: Path | str):
        self.database = Path(database).resolve()
        if not self.database.is_file():
            raise FileNotFoundError(self.database)
        with metadata_connection(self.database) as connection:
            schema = connection.execute(
                "SELECT value FROM meta WHERE key='schema'"
            ).fetchone()
            user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        if schema is None or schema[0] != SCHEMA:
            raise ValueError(f"unsupported canonical alias schema: {None if schema is None else schema[0]!r}")
        if user_version != USER_VERSION:
            raise ValueError(f"unsupported canonical alias user_version: {user_version}")

    def meta(self) -> dict[str, str]:
        with metadata_connection(self.database) as connection:
            return {str(row[0]): str(row[1]) for row in connection.execute(
                "SELECT key,value FROM meta ORDER BY key"
            )}

    def resolve_exact(self, query: object, *, limit: int = 32) -> list[dict[str, Any]]:
        """Return one best row per accession for an exact normalized alias.

        Multiple accessions are intentionally returned. Callers must not silently
        select one target when an alias is biologically or historically ambiguous.
        """

        alias_upper = normalize_alias(query)
        if not alias_upper:
            return []
        bounded_limit = max(1, min(int(limit), 256))
        with metadata_connection(self.database) as connection:
            rows = connection.execute(
                """
                WITH ranked AS (
                  SELECT r.*,
                         ROW_NUMBER() OVER (
                           PARTITION BY r.accession
                           ORDER BY r.priority,r.alias_type,r.alias
                         ) AS accession_rank
                  FROM alias_resolution r
                  WHERE r.alias_upper=?
                )
                SELECT alias_upper,alias,alias_type,source,priority,accession,
                       entry_name,canonical_gene,display_gene,protein_name
                FROM ranked
                WHERE accession_rank=1
                ORDER BY priority,accession
                LIMIT ?
                """,
                (alias_upper, bounded_limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def protein_by_accession(self, accession: object) -> dict[str, Any] | None:
        """Return canonical display metadata for one exact UniProt accession."""

        accession_upper = normalize_alias(accession)
        if not accession_upper:
            return None
        with metadata_connection(self.database) as connection:
            try:
                row = connection.execute(
                    """
                    SELECT accession,entry_name,canonical_gene,display_gene,protein_name
                    FROM canonical_protein
                    WHERE accession=?
                    LIMIT 1
                    """,
                    (accession_upper,),
                ).fetchone()
            except sqlite3.OperationalError:
                # Small contract fixtures may expose only alias_resolution.
                row = connection.execute(
                    """SELECT accession,entry_name,canonical_gene,display_gene,protein_name
                       FROM alias_resolution WHERE accession=?
                       ORDER BY priority LIMIT 1""",
                    (accession_upper,),
                ).fetchone()
        return dict(row) if row is not None else None

    def expanded_terms(self, query: object, *, limit: int = 32) -> dict[str, Any]:
        """Return raw + canonical exact terms for ranked assay search.

        The original query is always retained. Canonical genes and accessions are
        additive candidates, not an irreversible rewrite.
        """

        raw = str(query or "").strip()
        matches = self.resolve_exact(raw, limit=limit)
        terms: list[str] = []
        seen: set[str] = set()
        for value in [raw, *[row.get("canonical_gene") for row in matches],
                      *[row.get("display_gene") for row in matches],
                      *[row.get("accession") for row in matches]]:
            normalized = normalize_alias(value)
            if normalized and normalized not in seen:
                seen.add(normalized)
                terms.append(str(value).strip())
        return {
            "query": raw,
            "normalized_query": normalize_alias(raw),
            "terms": terms,
            "matches": matches,
            "ambiguous": len({row["accession"] for row in matches}) > 1,
        }


__all__ = [
    "CanonicalAliasResolver",
    "SCHEMA",
    "USER_VERSION",
    "normalize_alias",
    "read_only_connection",
]
