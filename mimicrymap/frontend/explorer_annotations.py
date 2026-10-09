"""Adapt resolved PanScan9 Humsavar projections to the native player ANN shape."""

from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from pathlib import Path


THREE_TO_ONE = {
    "Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C",
    "Gln": "Q", "Glu": "E", "Gly": "G", "His": "H", "Ile": "I",
    "Leu": "L", "Lys": "K", "Met": "M", "Phe": "F", "Pro": "P",
    "Ser": "S", "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V",
}
MISSENSE_RE = re.compile(r"^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})$")


def read_only_connection(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(
        f"file:{path.resolve().as_posix()}?mode=ro&immutable=1", uri=True
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


def native_annotations(database: Path, portable_id: str) -> dict[str, object]:
    """Return the payload consumed by existing ``loadAnnots``/Variants rendering.

    Only an exact, reference-validated three-letter missense change enters
    ``annotations.variants``.  Every resolved tile remains available in the additive
    ``variant_intervals`` field with full SeqID and mapping status.
    """

    connection = read_only_connection(database)
    try:
        protein = connection.execute(
            "SELECT portable_id,sequence,sequence_length FROM protein WHERE portable_id=?",
            (portable_id,),
        ).fetchone()
        if protein is None:
            raise KeyError(portable_id)
        rows = connection.execute(
            """
            SELECT * FROM variant_projection WHERE portable_id=?
            ORDER BY target_start0,target_end0,cdi_accession
            """,
            (portable_id,),
        ).fetchall()
    finally:
        connection.close()

    sequence = protein["sequence"]
    intervals = []
    grouped = defaultdict(lambda: {"cdi_accessions": [], "cdi_seqids": [], "tile_kinds": [], "resolution_statuses": []})
    diagnostics = {"projection_rows": len(rows), "native_missense_rows": 0, "unparsed_change_rows": 0, "reference_mismatch_rows": 0}
    for row in rows:
        intervals.append(
            {
                "start0": row["target_start0"],
                "end0": row["target_end0"],
                "coordinate_system": row["coordinate_system"],
                "change": row["humsavar_change"],
                "cat": row["humsavar_significance"],
                "ftid": row["variant_entity"],
                "dbsnp": row["humsavar_dbsnp"],
                "disease": row["humsavar_disease"],
                "cdi_accession": row["cdi_accession"],
                "cdi_seqid": row["cdi_seqid"],
                "tile_kind": row["tile_kind"],
                "resolution_status": row["resolution_status"],
                "uniprot_tile_check": row["uniprot_tile_check"],
                "reference_validation_status": row["reference_validation_status"],
                "native_point_eligible": bool(row["native_point_eligible"]),
            }
        )
        change = row["humsavar_change"] or ""
        match = MISSENSE_RE.fullmatch(change)
        if match is None or match.group(1) not in THREE_TO_ONE or match.group(3) not in THREE_TO_ONE:
            diagnostics["unparsed_change_rows"] += 1
            continue
        ref = THREE_TO_ONE[match.group(1)]
        pos = int(match.group(2))
        alt = THREE_TO_ONE[match.group(3)]
        if (
            not row["native_point_eligible"]
            or row["reference_validation_status"] != "p9p_reference_residue_exact"
            or pos < 1
            or pos > len(sequence)
            or sequence[pos - 1] != ref
        ):
            diagnostics["reference_mismatch_rows"] += 1
            continue
        if not (row["target_start0"] < pos <= row["target_end0"]):
            diagnostics["reference_mismatch_rows"] += 1
            continue
        key = (
            pos,
            ref,
            alt,
            row["humsavar_significance"] or "",
            row["variant_entity"] or "",
            row["humsavar_dbsnp"] or "",
            row["humsavar_disease"] or "",
        )
        evidence = grouped[key]
        evidence["cdi_accessions"].append(row["cdi_accession"])
        evidence["cdi_seqids"].append(row["cdi_seqid"])
        evidence["tile_kinds"].append(row["tile_kind"])
        evidence["resolution_statuses"].append(row["resolution_status"])
        diagnostics["native_missense_rows"] += 1

    variants = []
    for key, evidence in sorted(grouped.items()):
        pos, ref, alt, category, entity, dbsnp, disease = key
        variants.append(
            {
                "pos": pos,
                "ref": ref,
                "alt": alt,
                "cat": category,
                "ftid": entity,
                "dbsnp": dbsnp,
                "disease": disease,
                "change": f"p.{ref}{pos}{alt}",
                "evidence": {
                    "cdi_accessions": sorted(set(evidence["cdi_accessions"])),
                    "cdi_seqids": sorted(set(evidence["cdi_seqids"])),
                    "tile_kinds": sorted(set(value for value in evidence["tile_kinds"] if value)),
                    "resolution_statuses": sorted(set(evidence["resolution_statuses"])),
                },
            }
        )
    diagnostics["native_variants_deduplicated"] = len(variants)
    return {
        "schema": "mimicryone/panscan9-native-annotations/1",
        "protein_id": portable_id,
        "annotations": {
            "variants": variants,
            "variant_intervals": intervals,
        },
        "annotation_sources": {
            "variants": {
                "name": "Frozen PanScan9 Humsavar projection",
                "categories": {
                    "LP/P": "likely pathogenic or pathogenic",
                    "US": "uncertain significance",
                    "LB/B": "likely benign or benign",
                },
                "identity_boundary": "P9P raw sequence is authoritative; only reference-validated missense changes enter the native point track.",
            }
        },
        "diagnostics": diagnostics,
    }


__all__ = ["native_annotations"]
