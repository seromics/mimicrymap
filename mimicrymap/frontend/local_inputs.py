"""Read-only, release-bound inputs for browser-local analysis. No matching code."""
from contextlib import closing
import base64
import hashlib
import json
from threading import Lock

from analysis_api import APIError, ANTIGEN_COLUMNS, _antigen_payload, _read_only_connection
from analysis_membership import MembershipFilterError, normalize_record_slice
from pinned_subset_membership import membership_for


# Per-record identity/geometry stays on the row; everything below is annotation text
# shared by every tile of the same parent record, so it is emitted once per page.
COMPACT_ROW_COLUMNS=("antigen_id","seqid","short_id","raw_header","sequence","length",
                     "window_count","noncanonical_windows","ordinal","source_row",
                     "sequence_status","annotation")
COMPACT_ANNOTATION_FIELDS=("display_accession","accession","source_accession","display_gene",
                           "primary_gene","gene","display_name","protein_name","description",
                           "organism","library","entity_level")


def _compact_records(records):
    """Split hydrated records into row tuples plus a deduplicated annotation table.

    Lossless for the fields the player and exports read: the client rebuilds each
    record by merging its annotation entry back over the row.
    """
    annotations=[]
    index={}
    rows=[]
    for record in records:
        shared=tuple(record.get(name) for name in COMPACT_ANNOTATION_FIELDS)
        reference=index.get(shared)
        if reference is None:
            reference=index[shared]=len(annotations)
            annotations.append(dict(zip(COMPACT_ANNOTATION_FIELDS,shared)))
        row=[record.get(name) for name in COMPACT_ROW_COLUMNS[:-1]]
        row.append(reference)
        if "expected_counts" in record:
            row.append(record["expected_counts"])
        rows.append(row)
    return rows,annotations


# Population totals depend on the scope, never on the page cursor, but a whole-library
# download asks for them once per page. The release is immutable and opened read-only,
# so they are memoised per scope for the life of the process.
_SCOPE_TOTALS={}
_SCOPE_TOTALS_LIMIT=64


def _scope_totals(db, key, compute):
    cached=_SCOPE_TOTALS.get(key)
    if cached is not None:
        return cached
    value=compute()
    if len(_SCOPE_TOTALS)>=_SCOPE_TOTALS_LIMIT:
        _SCOPE_TOTALS.pop(next(iter(_SCOPE_TOTALS)),None)
    _SCOPE_TOTALS[key]=value
    return value


# Bounded metadata cache: no sequences, annotations, or comparison results.
_PACKAGE_SCOPES = {}
_PACKAGE_SCOPE_LOCK = Lock()
_PACKAGE_SCOPE_BYTES = 0
_PACKAGE_SCOPE_LIMIT = 32 * 1024 * 1024


def _package_scope(db, owner, library, fp, filters, floor, join, where, parameters, *, query_id=0, query_library=None):
    """Resolve package membership using the same predicate as the paginated API."""
    global _PACKAGE_SCOPE_BYTES
    membership = membership_for(owner, library)
    key = (str(owner.catalog_path), str(getattr(membership, "database", "")), fp, library,
           json.dumps(filters, sort_keys=True, separators=(",", ":")), query_id, query_library)
    cached = _PACKAGE_SCOPES.get(key)
    if cached is None:
        low, high = db.execute("SELECT min(antigen_id),max(antigen_id) FROM antigen WHERE library_key=?", (library,)).fetchone()
        low, high = (int(low), int(high)) if low is not None else (0, -1)
        width = high - low + 1
        if width > 128 * 1024 * 1024:
            raise APIError(503, "Input package identity range exceeds the supported scope size")
        bits = bytearray((width + 7) // 8)
        records = windows = eligible = 0
        # Bound the primary-key scan as in the record endpoint; avoid sorting the library index.
        bounded = where.replace("a.library_key=?", "+a.library_key=?") + " AND a.antigen_id>=? AND a.antigen_id<=?"
        for record_id, count in db.execute(f"SELECT a.antigen_id,a.window_count FROM antigen a{join} WHERE {bounded} ORDER BY a.antigen_id", [*parameters, low, high]):
            offset = record_id - low
            bits[offset >> 3] |= 1 << (offset & 7)
            records += 1
            windows += count
            eligible += count > 0
        mask = {"schema": "mimicryone/input-scope-mask/1", "start_id": low, "end_id": high,
                "count": records, "bits": base64.b64encode(bits).decode("ascii")}
        cached = (mask, records, windows, eligible)
        size = len(mask["bits"]) + 1024
        with _PACKAGE_SCOPE_LOCK:
            if key not in _PACKAGE_SCOPES:
                while _PACKAGE_SCOPES and (_PACKAGE_SCOPE_BYTES + size > _PACKAGE_SCOPE_LIMIT or len(_PACKAGE_SCOPES) >= 32):
                    evicted = _PACKAGE_SCOPES.pop(next(iter(_PACKAGE_SCOPES)))
                    _PACKAGE_SCOPE_BYTES -= len(evicted[0]["bits"]) + 1024
                if size <= _PACKAGE_SCOPE_LIMIT:
                    _PACKAGE_SCOPES[key] = cached
                    _PACKAGE_SCOPE_BYTES += size
    mask, records, windows, eligible = cached
    manifest = {"release_fingerprint": fp, "library": library, "filters": filters, "floor": floor,
                "query_library": query_library, "query_id": query_id, "mode": "full_selected_library",
                "population_records": records, "population_windows": windows, "eligible_records": eligible,
                "download_records": records, "self_policy": "exclude identical native record; retain distinct identities",
                "identity_policy": "canonical residues match exactly; noncanonical positions are forced mismatches"}
    scope_hash = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"schema": "mimicryone/local-inputs/1", "shape": "scope", "release_fingerprint": fp,
            "scope_hash": scope_hash, "manifest": manifest, "membership_mask": mask,
            "query_records": [], "source_catalog": [], "next_after_id": None,
            "row_filter_columns": membership.row_filter_columns(library) if membership is not None and library in membership.libraries else {}}


def local_inputs(owner, query):
    allowed={"library","query_library","query_id","floor","after_id","filters","component","release","population_only","projection_inputs","query_portable_id","query_projection_library","fields","limit","shape"}
    if set(query)-allowed or any(len(value)!=1 for value in query.values()):
        raise APIError(400,"Invalid local-input parameters")
    def value(key,default=None): return query.get(key,[default])[0]
    library=value("library")
    portable_id=value("query_portable_id")
    if value("projection_inputs", "false") not in {"true", "false"}:
        raise APIError(400,"Invalid projection_inputs flag")
    if library not in owner.library_keys:
        raise APIError(404,"Unknown parent library")
    fp=owner.manifest["release_fingerprint"]
    if value("release") and value("release")!=fp:
        raise APIError(409,"Input release changed; restart the download")
    try:
        floor=int(value("floor","7")); after=int(value("after_id","0"))
        query_id=int(value("query_id","0"))
        if floor not in range(5,10) or min(after,query_id)<0: raise ValueError()
        filters=json.loads(value("filters","{}"))
        membership=membership_for(owner,library)
        # Not every mounted library has a membership specification (huprot4 and
        # human_current do not). Those have no scope filters to normalize, so an
        # empty request is the complete library rather than an invalid scope. An
        # exact catalog ID can still select one native record directly. Other
        # filters remain invalid rather than being silently discarded.
        scoped=membership is not None and library in getattr(membership,"libraries",{})
        if scoped and not filters and library in getattr(owner,"pinned_memberships",{}): filters=None
        elif scoped: filters=membership.normalize(library,filters)
        elif isinstance(filters, dict) and set(filters) == {"record_ids"}:
            filters = {"record_ids": normalize_record_slice(filters["record_ids"])}
        elif filters: raise MembershipFilterError(f"Source filters are unavailable for {library}")
        else: filters=None
    except (ValueError,TypeError,MembershipFilterError) as error:
        raise APIError(400,"Invalid local-input scope") from error
    clauses=["a.library_key=?"]
    parameters=[library]
    if not scoped and filters is not None:
        identifiers = filters["record_ids"]
        clauses.append("a.antigen_id=?" if identifiers else "0")
        parameters.extend(identifiers)
    join=""
    if value("population_only", "false") not in {"true", "false"}:
        raise APIError(400,"Invalid population_only flag")
    # "lean" omits annotation-display hydration and returns only the identity and
    # sequence fields a browser-local run needs. It changes payload size only; the
    # record population, ordering, completeness and manifest are identical.
    fields=value("fields","full")
    if fields not in {"full","lean"}:
        raise APIError(400,"Invalid fields selector")
    # "compact" keeps every hydrated display value but sends the repeated annotation
    # text once per page instead of once per record. Assay tiles of one protein share
    # an identical annotation, so this is 20x smaller with nothing dropped.
    shape=value("shape","records")
    if shape not in {"records","compact","scope","projection_refs","native_contract"}:
        raise APIError(400,"Invalid shape selector")
    if shape == "scope" and (value("population_only", "false") != "true" or query_id or after or portable_id or value("projection_inputs", "false") == "true"):
        raise APIError(400,"Scope metadata requires the full parent population")
    if shape == "projection_refs" and (value("projection_inputs", "false") != "true" or value("population_only", "false") != "true"):
        raise APIError(400,"Mapping metadata requires complete selected inputs")
    if shape == "native_contract" and (not query_id or portable_id or after or value("projection_inputs", "false") != "true" or value("population_only", "false") != "true"):
        raise APIError(400,"Native record metadata requires one exact catalog query and a complete parent scope")
    try:
        page_limit=int(value("limit","500"))
    except (TypeError,ValueError):
        raise APIError(400,"Invalid page limit") from None
    if not 1<=page_limit<=5000:
        raise APIError(400,"Page limit must be between 1 and 5000")
    static=bool(query_id and floor>=7 and value("population_only", "false") != "true")
    query_library=value("query_projection_library") if portable_id else value("query_library")
    if portable_id and query_id:
        raise APIError(400,"Choose one query identity")
    comparison=None
    with closing(_read_only_connection(owner.catalog_path)) as db:
        query_record=None
        if query_id:
            row=db.execute(f"SELECT {ANTIGEN_COLUMNS} FROM antigen WHERE antigen_id=? AND library_key=?",(query_id,query_library)).fetchone()
            if row is None: raise APIError(404,"Target identity is outside the declared library")
            query_record=_antigen_payload(row,include_sequence=True,annotation_hydrator=owner.annotation_hydrator)
            clauses.append("a.antigen_id<>?"); parameters.append(query_id)
            comparison=next((item for item in owner.comparisons.values() if {item.library_a,item.library_b}=={library,query_library}),None)
            if comparison is None: raise APIError(409,"No authorized comparison covers these libraries")
        if filters is not None and scoped:
            if hasattr(membership, "catalog_subset_ids"):
                identifiers = membership.catalog_subset_ids(library, filters)
                clauses.append("a.antigen_id IN (SELECT value FROM json_each(?))")
                parameters.append(json.dumps(identifiers))
            else:
                db.execute("ATTACH DATABASE ? AS analysis_filter",(membership.database.resolve().as_uri()+"?mode=ro&immutable=1",))
                predicate,arguments=membership.sql_predicate(library,filters,alias="m")
                join=" JOIN analysis_filter.antigen_membership m ON m.antigen_id=a.antigen_id"
                clauses.append(predicate);parameters.extend(arguments)
        where=" AND ".join(clauses)
        if shape == "scope":
            return _package_scope(db, owner, library, fp, filters, floor, join, where, parameters,
                                  query_id=query_id, query_library=query_library)
        if shape == "native_contract":
            # Native library records are identity mappings in _source_plan with
            # canonical_view=False. Certify the population once; do not hydrate
            # or serialize every parent that the browser already holds.
            scope = _package_scope(db, owner, library, fp, filters, floor, join, where, parameters,
                                   query_id=query_id, query_library=query_library)
            from reproduction_inputs import projection_inputs
            from analysis_scan import ScanError
            try:
                plan = projection_inputs(owner, [], library=library, query_id=query_id, query_library=query_library)
            except ScanError as error:
                raise APIError(error.status, error.message) from error
            scope["shape"] = "native_contract"
            scope["projection_inputs"] = {**plan, "transport": "prepared-native-records/1",
                                           "parent_mapping": "identity", "complete": True}
            return scope
        scope_key=(fp,library,json.dumps(filters,sort_keys=True),floor,query_id,query_library,static)
        totals=_scope_totals(db,("totals",)+scope_key,lambda:tuple(db.execute(
            f"SELECT count(*),coalesce(sum(a.window_count),0),coalesce(sum(a.window_count>0),0) FROM antigen a{join} WHERE {where}",
            parameters).fetchone()))
        edge_join=""; expected_columns=""
        if static:
            shard=owner._shard_path(comparison)
            with closing(_read_only_connection(shard)) as edge:
                owner._assert_complete_shard(edge)
                metadata=dict(edge.execute("SELECT key,value FROM meta"))
                if metadata.get("release_fingerprint")!=fp or metadata.get("cap")!="none":
                    raise APIError(409,"Static candidate comparison is not complete for this release")
            db.execute("ATTACH DATABASE ? AS static_edges",(shard.resolve().as_uri()+"?mode=ro&immutable=1",))
            # Two indexed lookups, transposed by numeric identity, not library name.
            edge_join=f" JOIN (SELECT antigen_b AS parent_id,* FROM static_edges.edge WHERE antigen_a={query_id} UNION ALL SELECT antigen_a AS parent_id,* FROM static_edges.edge WHERE antigen_b={query_id}) e ON e.parent_id=a.antigen_id"
            where+=f" AND e.n{floor}>0"
            expected_columns=",e.antigen_a,e.n7,e.n8,e.n9,e.a_windows_m7,e.a_windows_m8,e.a_windows_m9,e.b_windows_m7,e.b_windows_m8,e.b_windows_m9"
        candidate_count=_scope_totals(db,("candidates",)+scope_key,lambda:db.execute(
            f"SELECT count(*) FROM antigen a{join}{edge_join} WHERE {where}",parameters).fetchone()[0])
        page_where=where
        page_parameters=list(parameters)
        page_after=after
        if not edge_join:
            # Catalog ids are contiguous within a library, so a keyset page is just a
            # primary-key range scan. Bounding the range and suppressing the library_key
            # index removes the temporary sort SQLite otherwise rebuilds over the whole
            # library on every page. This matters most with a membership filter joined
            # in, where the unbounded plan costs ~1.1 s per page on the largest library.
            bounds=_scope_totals(db,("bounds",fp,library),lambda:tuple(db.execute(
                "SELECT min(antigen_id),max(antigen_id) FROM antigen WHERE library_key=?",(library,)).fetchone()))
            if bounds and bounds[0] is not None:
                page_where=page_where.replace("a.library_key=?","+a.library_key=?")+" AND a.antigen_id<=?"
                page_parameters.append(int(bounds[1]))
                page_after=max(after,int(bounds[0])-1)
        columns=",".join("a."+name for name in ANTIGEN_COLUMNS.split(","))
        rows=list(db.execute(
            f"SELECT {columns}{expected_columns} FROM antigen a{join}{edge_join}"
            f" WHERE {page_where} AND a.antigen_id>? ORDER BY a.antigen_id LIMIT ?",
            [*page_parameters,page_after,page_limit+1]))
        more=len(rows)>page_limit;rows=rows[:page_limit]
        hydrator=None if fields=="lean" else owner.annotation_hydrator
        records=[]
        for row in rows:
            record=_antigen_payload(row,include_sequence=True,annotation_hydrator=hydrator)
            if static:
                side="a" if row["antigen_a"]==query_id else "b"
                other="b" if side=="a" else "a"
                record["expected_counts"]={str(h):{"pairs":row[f"n{h}"],"target_windows":row[f"{side}_windows_m{h}"],"parent_windows":row[f"{other}_windows_m{h}"]} for h in range(floor,10)}
            records.append(record)
    manifest={"release_fingerprint":fp,"library":library,"filters":filters,"floor":floor,
              "query_library":query_library,"query_id":query_id,"mode":"static_candidates" if static else "full_selected_library",
              "population_records":totals[0],"population_windows":totals[1],"eligible_records":totals[2],
              "download_records":candidate_count,"self_policy":"exclude identical native record; retain distinct identities",
              "identity_policy":"canonical residues match exactly; noncanonical positions are forced mismatches"}
    if portable_id:
        manifest["query_portable_id"]=portable_id
        manifest["query_projection_library"]=value("query_projection_library")
    scope_hash=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    if shape=="compact":
        compact_rows,compact_annotations=_compact_records(records)
        catalog_payload=[]
    else:
        compact_rows=compact_annotations=None
        catalog_payload=records
    # Which request fields a browser holding the baked package may decide for itself, as
    # field -> membership column. It is published rather than assumed because the two differ:
    # request fields are plural, columns are singular, and a client that tested the request
    # key against a package row found undefined and silently rejected the whole library.
    # Empty means the scope has to be applied here - schema v4's filters live on a joined
    # provenance table, which no per-record test on a package can reproduce.
    output={"schema":"mimicryone/local-inputs/1","release_fingerprint":fp,"scope_hash":scope_hash,
            "manifest":manifest,"query_records":[query_record] if query_record else [],"source_catalog":catalog_payload,
            "target":{"kind":"library","library":library},
            "row_filter_columns":membership.row_filter_columns(library) if (membership is not None and scoped) else {},
            "next_after_id":records[-1]["antigen_id"] if more and records else None}
    if shape=="compact":
        output["shape"]="compact"
        output["row_columns"]=list(COMPACT_ROW_COLUMNS)+(["expected_counts"] if static else [])
        output["annotation_fields"]=list(COMPACT_ANNOTATION_FIELDS)
        output["rows"]=compact_rows
        output["annotations"]=compact_annotations
    if value("projection_inputs", "false") == "true":
        if static or value("population_only", "false") != "true":
            raise APIError(400,"Reproduction requires the full selected input population")
        from reproduction_inputs import projection_inputs
        from analysis_scan import ScanError
        try:
            output["projection_inputs"]=projection_inputs(owner, records, library=library,
                query_id=query_id, query_library=query_library, portable_id=portable_id,
                projection_library=value("query_projection_library"))
        except ScanError as error:
            raise APIError(error.status,error.message) from error
    if shape == "projection_refs":
        from reproduction_inputs import projection_references
        output["projection_inputs"] = projection_references(output["projection_inputs"])
        output["source_catalog"] = []
        output["query_records"] = []
        output["shape"] = "projection_refs"
    return output
