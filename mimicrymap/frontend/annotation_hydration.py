"""Read-only display annotation for assay and canonical API payloads.

Immutable antigen/parent identifiers remain authoritative.  Hydration is
additive, names every source, and reports disagreements instead of silently
rewriting identity.
"""

from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from canonical_aliases import CanonicalAliasResolver, normalize_alias, read_only_connection, metadata_connection


SCHEMA = "mimicryone/annotation-hydration/1"
DISPLAY_SCHEMA = "mimicryone/annotation-display-sidecar/1"
HUMAN_LIBRARIES = frozenset(
    {
        "canonical_human",
        "human_current",
        "huprot4",
        "panscan9_human",
        "panscan9_variant",
    }
)
AUTHORED_ID = re.compile(r"^(?:JHU|CDI)[A-Za-z0-9._-]+$", re.I)
ISOFORM_ACCESSION = re.compile(r"^([A-Z0-9]+)-\d+$", re.I)
LETTER_NUMBER_BOUNDARY = re.compile(r"(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])")


def _text(value: object) -> str:
    return str(value or "").strip()


def _display(value: object) -> str:
    return re.sub(r"\s+", " ", _text(value).replace("_", " ")).strip()


def _dict(value: Mapping[str, Any] | sqlite3.Row) -> dict[str, Any]:
    return {key: value[key] for key in value.keys()}


def _first(value: Mapping[str, Any], *names: str) -> str:
    return next((_text(value.get(name)) for name in names if _text(value.get(name))), "")


def _organism(value: object) -> str:
    result = _display(value)
    return "Homo sapiens" if normalize_alias(result) == "HOMO SAPIENS" else result


def parse_assay_header(
    library: object, raw_header: object, *, seqid: object = "", short_id: object = ""
) -> dict[str, Any]:
    """Parse the documented native grammars while preserving the full header."""

    key = _text(library)
    full = (_text(raw_header) or _text(seqid)).removeprefix(">")
    parts = full.split("|") if full else []
    authored = bool(parts and AUTHORED_ID.fullmatch(parts[0]))
    parsed: dict[str, Any] = {
        "grammar": "unknown",
        "platform_id": parts[0] if authored else "",
        "platform_record_id": _text(seqid) or _text(short_id) or full,
        "source_label": _display(parts[1]) if authored and len(parts) > 1 else "",
        "source_accession": "",
        "source_group": "",
        "tile": "",
        "organism": "",
        "attributes": {},
    }
    if authored and len(parts) > 1 and re.fullmatch(
        r"(?:Seq[_-]?\d+|\d+-\d+|(?:FUS|VAR|WT|MUT)[_-].+)", parts[-1], re.I
    ):
        parsed["tile"] = parts[-1]
    accession = _text(parts[2]) if authored and len(parts) > 2 else ""
    fourth = _text(parts[3]) if authored and len(parts) > 3 else ""
    if key == "human_current" and authored:
        parsed.update(grammar="CDIH2", source_accession=accession,
                      organism=_organism(fourth) or "Homo sapiens")
    elif key == "huprot4" and authored:
        attributes = {}
        for field in parts[2:]:
            name, separator, value = field.partition("=")
            if separator:
                attributes[_text(name)] = _text(value)
        parsed.update(grammar="JHU-HuProt4", source_accession=attributes.get("UniProt", ""),
                      organism="Homo sapiens", attributes=attributes)
    elif key == "panscan9_human" and authored:
        parsed.update(grammar="CDI9H", source_accession=accession,
                      organism=_organism(fourth) or "Homo sapiens")
    elif key == "panscan9_variant" and authored:
        parsed.update(grammar="CDI9V", source_accession=accession,
                      source_group=_display(fourth), organism="Homo sapiens")
    elif key == "panscan9_dark" and authored:
        parsed.update(grammar="CDI9D", source_accession=accession,
                      source_group=_display(fourth))
    elif key == "panscan9_exposure" and authored:
        parsed.update(grammar="CDI9E", source_accession=accession,
                      source_group=_display(fourth), organism=_organism(parts[1]))
    elif key == "virscan_exposome_current" and authored:
        parsed.update(grammar="CDIV2/3", source_accession=accession,
                      source_group=_display(fourth), organism=_organism(parts[1]))
    return parsed


class AnnotationDisplaySidecar:
    """Optional long-description sidecar keyed by (library_key, source_row)."""

    def __init__(
        self, database: Path | str, *, expected_release_fingerprint: str | None = None
    ):
        self.database = Path(database).resolve()
        if not self.database.is_file():
            raise FileNotFoundError(self.database)
        with metadata_connection(self.database) as connection:
            metadata = {str(row[0]): str(row[1]) for row in connection.execute(
                "SELECT key,value FROM metadata"
            )}
            schema = metadata.get("schema", "")
            names = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type IN ('table','view')"
            )}
            self.annotation_columns = frozenset(
                str(row[1]) for row in connection.execute("PRAGMA table_info(annotation_text)")
            )
        if schema != DISPLAY_SCHEMA:
            raise ValueError(f"unsupported annotation display sidecar: {schema!r}")
        if (
            expected_release_fingerprint
            and metadata.get("release_fingerprint") != expected_release_fingerprint
        ):
            raise ValueError("annotation display sidecar release fingerprint differs")
        required = {"annotation_text", "antigen_annotation", "annotation_fts", "source_library"}
        if not required.issubset(names):
            raise ValueError("annotation display sidecar is missing required tables")

    @lru_cache(maxsize=16_384)
    def lookup(self, library: object, source_row: object) -> dict[str, Any] | None:
        try:
            key, row_number = _text(library), int(source_row)
        except (TypeError, ValueError):
            return None
        if not key or row_number < 0:
            return None
        with metadata_connection(self.database) as connection:
            identity_columns = "".join(
                f",t.{name}"
                for name in ("accession", "gene", "entry_name")
                if name in self.annotation_columns
            )
            row = connection.execute(
                f"""SELECT aa.library_key,aa.source_row,t.protein,t.description,
                          t.display_description,t.protein_name,t.description_organism,
                          s.protein_identity_semantics{identity_columns}
                   FROM antigen_annotation aa
                   JOIN annotation_text t USING(annotation_id)
                   JOIN source_library s USING(library_key)
                   WHERE aa.library_key=? AND aa.source_row=?""",
                (key, row_number),
            ).fetchone()
        return dict(row) if row is not None else None

    def search_source_rows(
        self, query: object, libraries: list[str] | tuple[str, ...], *, limit: int
    ) -> list[dict[str, Any]]:
        """Return bounded display-only FTS matches without changing identity."""

        tokens = re.findall(r"[A-Za-z0-9_]+", _text(query))[:8]
        if not tokens:
            return []
        expressions = [
            " AND ".join('"' + token.replace('"', '""') + '"*' for token in tokens)
        ]
        # Search names as people write them as well as the punctuation used upstream.
        # For example, UniProt describes EBNA1 as "EBNA-1"; FTS tokenizes that into
        # adjacent EBNA and 1 tokens, while a user normally enters one compact token.
        if len(tokens) == 1:
            boundary_parts = [
                part for part in LETTER_NUMBER_BOUNDARY.split(tokens[0]) if part
            ]
            if len(boundary_parts) > 1:
                boundary_expression = " AND ".join(
                    '"' + part.replace('"', '""') + '"' for part in boundary_parts
                )
                if boundary_expression not in expressions:
                    expressions.append(boundary_expression)
        per_library = max(1, min(int(limit), 800))
        found: dict[tuple[str, int, int], tuple[tuple[Any, ...], dict[str, Any]]] = {}
        with metadata_connection(self.database) as connection:
            for library in libraries:
                for expression_rank, expression in enumerate(expressions):
                    rows = connection.execute(
                        """SELECT aa.library_key,aa.source_row,f.annotation_id,
                                  f.protein,f.description,f.protein_name,f.organism,
                                  bm25(annotation_fts) AS search_rank
                           FROM annotation_fts f
                           JOIN antigen_annotation aa
                             ON aa.annotation_id=CAST(f.annotation_id AS INTEGER)
                            AND aa.library_key=?
                           WHERE annotation_fts MATCH ?
                           ORDER BY search_rank,aa.source_row LIMIT ?""",
                        (_text(library), expression, per_library),
                    )
                    for row in rows:
                        payload = dict(row)
                        key = (
                            str(payload["library_key"]),
                            int(payload["source_row"]),
                            int(payload["annotation_id"]),
                        )
                        rank = (
                            expression_rank,
                            float(payload["search_rank"]),
                            str(payload["library_key"]),
                            int(payload["source_row"]),
                        )
                        if key not in found or rank < found[key][0]:
                            found[key] = (rank, payload)
        return [payload for _rank, payload in sorted(found.values())[:limit]]


class AnnotationHydrator:
    """Create one normalized identity vocabulary for every backend surface."""

    def __init__(
        self,
        alias_resolver: CanonicalAliasResolver | None = None,
        annotation_sidecar: AnnotationDisplaySidecar | Path | str | None = None,
        *,
        expected_release_fingerprint: str | None = None,
    ) -> None:
        self.alias_resolver = alias_resolver
        self.annotation_sidecar = (
            AnnotationDisplaySidecar(
                annotation_sidecar,
                expected_release_fingerprint=expected_release_fingerprint,
            )
            if annotation_sidecar is not None
            and not isinstance(annotation_sidecar, AnnotationDisplaySidecar)
            else annotation_sidecar
        )

    @lru_cache(maxsize=16_384)
    def _accession(self, value: str) -> dict[str, Any] | None:
        return self.alias_resolver.protein_by_accession(value) if self.alias_resolver else None

    @lru_cache(maxsize=16_384)
    def _alias(self, value: str) -> tuple[tuple[tuple[str, Any], ...], ...]:
        rows = self.alias_resolver.resolve_exact(value) if self.alias_resolver and value else []
        return tuple(tuple(sorted(row.items())) for row in rows)

    def _human_match(
        self, accession: str, gene: str, conflicts: list[dict[str, Any]]
    ) -> tuple[dict[str, Any] | None, str]:
        selected = self._accession(accession) if accession else None
        source = "canonical_alias_v1.accession_exact" if selected else ""
        isoform = ISOFORM_ACCESSION.fullmatch(accession)
        if selected is None and isoform:
            selected = self._accession(isoform.group(1))
            source = "canonical_alias_v1.accession_isoform_base" if selected else ""
        gene_rows = [dict(items) for items in self._alias(gene)] if gene else []
        gene_accessions = {_text(row.get("accession")) for row in gene_rows if row.get("accession")}
        if selected and gene_accessions and _text(selected.get("accession")) not in gene_accessions:
            conflicts.append({"code": "gene_accession_disagreement", "field": "display_gene",
                              "observed": gene, "canonical_accession": selected.get("accession"),
                              "alias_accessions": sorted(gene_accessions)})
        if selected is None and len(gene_accessions) == 1:
            selected, source = gene_rows[0], "canonical_alias_v1.unique_alias"
        elif selected is None and len(gene_accessions) > 1:
            conflicts.append({"code": "ambiguous_alias", "field": "display_gene",
                              "observed": gene, "alias_accessions": sorted(gene_accessions)})
        return selected, source

    @staticmethod
    def _canonical_values(row: Mapping[str, Any]) -> tuple[str, str, str]:
        return (_text(row.get("accession")), _first(row, "display_gene", "canonical_gene"),
                _text(row.get("protein_name")))

    @staticmethod
    def _finish(
        payload: dict[str, Any], *, gene: str, accession: str, protein: str,
        description: str, organism: str, platform: str, full_header: str,
        canonical_header: str, provenance: dict[str, str], conflicts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        authored_name = _first(payload, "display_name", "name")
        technical = {
            normalize_alias(item) for item in (
                accession, platform, organism, full_header, canonical_header,
                _first(payload, "parent_key", "portable_id", "short_id", "seqid"),
            ) if item
        }
        display_name = (
            authored_name
            if authored_name and normalize_alias(authored_name) not in technical
            else gene or protein or accession or platform or _first(
                payload, "parent_key", "portable_id", "short_id", "seqid"
            )
        )
        payload.update({
            "display_gene": gene, "display_accession": accession,
            "gene": gene, "accession": accession,
            "protein_name": protein, "description": description,
            "source_description": description,
            "organism": organism, "platform_id": platform,
            "full_source_header": full_header, "canonical_header": canonical_header,
            "display_name": display_name, "primary_gene": gene,
            "annotation_schema": SCHEMA,
            "annotation_provenance": {k: v for k, v in provenance.items() if v},
            "annotation_conflict": bool(conflicts), "annotation_conflicts": conflicts,
        })
        payload["missing_annotation_fields"] = [
            name for name in ("display_gene", "display_accession", "protein_name", "description", "organism")
            if not _text(payload.get(name))
        ]
        return payload

    def hydrate_assay(self, value: Mapping[str, Any] | sqlite3.Row) -> dict[str, Any]:
        payload = _dict(value)
        library = _first(payload, "library", "library_key")
        parsed = parse_assay_header(library, _first(payload, "raw_header", "seqid"),
                                    seqid=payload.get("seqid"), short_id=payload.get("short_id"))
        provenance = {"full_source_header": "analysis_catalog.raw_header",
                      "canonical_header": "analysis_catalog.raw_header",
                      "platform_id": "authored_header.field_1" if parsed["platform_id"] else ""}
        conflicts: list[dict[str, Any]] = []
        accession = _first(payload, "display_accession", "accession") or parsed["source_accession"]
        gene = _first(payload, "display_gene", "primary_gene", "canonical_gene", "gene")
        protein, description = _first(payload, "protein_name"), _first(payload, "description")
        organism = _organism(_first(payload, "organism") or parsed["organism"])
        annotation = self.annotation_sidecar.lookup(library, payload.get("source_row")) if self.annotation_sidecar else None
        if annotation:
            if "accession" in annotation:
                accession = _text(annotation.get("accession")) or accession
            if "gene" in annotation:
                gene = _text(annotation.get("gene")) or gene
            description = _text(annotation.get("display_description") or annotation.get("description")) or description
            protein = _text(annotation.get("protein_name")) or protein
            organism = _organism(annotation.get("description_organism")) or organism
            payload.update(source_protein=_text(annotation.get("protein")),
                           source_entry_name=_text(annotation.get("entry_name")),
                           source_description_verbatim=_text(annotation.get("description")),
                           annotation_source_note=_text(annotation.get("protein_identity_semantics")))
            provenance.update(description="annotation_display_v1.source_csv.Description",
                              protein_name="annotation_display_v1.normalized",
                              organism="annotation_display_v1.normalized")
        if library in HUMAN_LIBRARIES:
            hint = gene or (parsed["source_label"] if library != "panscan9_variant" else "")
            selected, source = self._human_match(parsed["source_accession"] or accession, hint, conflicts)
            if selected:
                canonical_accession, canonical_gene, canonical_protein = self._canonical_values(selected)
                accession, gene, protein = (canonical_accession or accession,
                                             canonical_gene or gene or hint,
                                             canonical_protein or protein)
                for name, present in (("display_accession", canonical_accession),
                                      ("display_gene", canonical_gene), ("protein_name", canonical_protein)):
                    if present:
                        provenance[name] = source
        if not gene and library in HUMAN_LIBRARIES and library != "panscan9_variant":
            gene, provenance["display_gene"] = parsed["source_label"], "authored_header.field_2"
        if not protein and library in {
            "canonical_exposure", "panscan9_dark", "panscan9_exposure",
            "virscan_exposome_current",
        }:
            protein, provenance["protein_name"] = parsed["source_label"], "authored_header.field_2"
        if accession and "display_accession" not in provenance:
            provenance["display_accession"] = "authored_header.field_3"
        if organism and "organism" not in provenance:
            provenance["organism"] = "authored_header"
        full = _first(payload, "full_source_header", "raw_header", "seqid")
        if parsed["source_accession"]:
            payload["source_accession"] = parsed["source_accession"]
        payload["assay_header"] = parsed
        payload["platform_record_id"] = parsed["platform_record_id"]
        return self._finish(payload, gene=gene, accession=accession, protein=protein,
                            description=description, organism=organism, platform=parsed["platform_id"],
                            full_header=full, canonical_header=_first(payload, "canonical_header") or full,
                            provenance=provenance, conflicts=conflicts)

    def hydrate_canonical(self, value: Mapping[str, Any] | sqlite3.Row) -> dict[str, Any]:
        payload = _dict(value)
        conflicts: list[dict[str, Any]] = []
        provenance: dict[str, str] = {}
        accession = _first(payload, "display_accession", "accession", "source_accession")
        gene = _first(payload, "display_gene", "primary_gene", "gene")
        protein = _first(payload, "protein_name")
        organism = _organism(_first(payload, "organism"))
        description = _first(payload, "description", "source_description")
        if description and organism and normalize_alias(description) == normalize_alias(organism):
            description = ""
        parent_class = _first(payload, "parent_class", "class").casefold()
        source_partition = _first(payload, "source_partition").casefold()
        if source_partition == "human" or parent_class in {
            "human", "human_canonical", "optional_receptor_germline"
        }:
            selected, source = self._human_match(accession, gene, conflicts)
            if selected:
                canonical_accession, canonical_gene, canonical_protein = self._canonical_values(selected)
                accession = canonical_accession or accession
                if gene and canonical_gene and normalize_alias(gene) != normalize_alias(canonical_gene):
                    conflicts.append({"code": "curated_gene_differs_from_alias", "field": "display_gene",
                                      "observed": gene, "canonical": canonical_gene,
                                      "canonical_accession": canonical_accession})
                if not gene and canonical_gene:
                    gene, provenance["display_gene"] = canonical_gene, source
                if not protein and canonical_protein:
                    protein, provenance["protein_name"] = canonical_protein, source
                if canonical_accession:
                    provenance["display_accession"] = source
        if protein and not description:
            description = protein
            provenance["description"] = provenance.get("protein_name", "canonical_parent_catalog.protein_name")
        full = _first(payload, "full_source_header", "source_header", "original_header", "raw_header")
        result = self._finish(payload, gene=gene, accession=accession, protein=protein,
                              description=description, organism=organism,
                              platform=_first(payload, "platform_id"), full_header=full,
                              canonical_header=_first(payload, "canonical_header", "companion_header"),
                              provenance=provenance, conflicts=conflicts)
        result["gene"] = gene
        result["source_description"] = description
        return result


__all__ = ["AnnotationDisplaySidecar", "AnnotationHydrator", "DISPLAY_SCHEMA",
           "HUMAN_LIBRARIES", "SCHEMA", "parse_assay_header"]
