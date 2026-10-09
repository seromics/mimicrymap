"""Presentation transport for complete stored results; no matching or filtering.

All coordinates and record metadata remain available to the viewer. Repeated
9-mers are recoverable from the retained sequences. Per-event export metadata
stays in the complete response and is requested only when exporting.
"""
from copy import deepcopy

VIEW_HEADER = "coordinates-v1"
VIEW_SCHEMA = "mimicryone/player-view/1"


def compact_view(response, request):
    execution = response.get("execution", {})
    if (execution.get("mode") != "precomputed_player"
            or execution.get("complete") is not True
            or execution.get("positional_hits_included") is not True):
        return response
    rows = []
    for row in response.get("results", []):
        schema = row.get("hits_schema", [])
        columns = [schema.index(key) for key in ("query_start", "source_start", "identity")]
        # Keep row-level mapping summaries and every catalog annotation intact.
        compact = {key: value for key, value in row.items()
                   if key not in {"hits", "hits_schema", "hit_provenance", "query", "source"}}
        compact["query"] = {key: value for key, value in row.get("query", {}).items()
                            if key in {"antigen_id", "parent_key"}}
        compact["source"] = {key: value for key, value in row.get("source", {}).items()
                             if key in {"protein_idx", "antigen_id"}}
        compact["hits_schema"] = ["query_start", "source_start", "identity"]
        compact["hits"] = [[hit[index] for index in columns] for hit in row["hits"]]
        rows.append(compact)
    return {**response, "results": rows, "viewer_transport": {
        "schema": VIEW_SCHEMA,
        "coordinates_complete": True,
        "export_details_deferred": True,
        "download_request": deepcopy(request),
    }}
