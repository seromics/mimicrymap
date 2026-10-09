"""Reuse the viewer's installed annotations for exact built-in FASTA records."""
import json
import sqlite3
import sys
from contextlib import ExitStack, closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "frontend"))
from annotation_hydration import AnnotationHydrator
from canonical_aliases import CanonicalAliasResolver
from runtime_components import load_runtime_components

LIBRARIES = {
    "builtin-viral120": ("atlas120", "atlas_120_viruses", "Exposure"),
    "builtin-human": ("canonical", "canonical_human", "Human"),
    "builtin-exposure": ("canonical", "canonical_exposure", "Exposure"),
    "builtin-nonvertebrate": ("canonical", "canonical_exposure", "Exposure"),
    "builtin-huprot": ("r3", "huprot4", ""),
    "builtin-huscan": ("r3", "human_current", ""),
    "builtin-virscan": ("r3", "virscan_exposome_current", ""),
}
FIELDS = ("display_gene", "display_accession", "protein_name", "description",
          "organism", "annotation_schema", "annotation_provenance", "annotation_conflicts")


def normalized(sequence):
    return str(sequence).upper().translate(str.maketrans("BXZJUO", "XXXXXX", "*"))


def annotate(request):
    directory = Path(request["moduleRoot"]) / "mimicrymap/bake/releases/mimicryone_runtime_20260904_r1"
    manifest = next((directory / name for name in ("runtime_components_lite.json", "runtime_components_local.json")
                     if (directory / name).is_file()), None)
    groups = request["groups"]
    if manifest is None:
        return [[None for _ in group["records"]] for group in groups]
    specs = {spec.key: spec for spec in load_runtime_components(manifest)}
    output = []
    with ExitStack() as stack:
        connections, hydrators = {}, {}

        def connection(file):
            if file not in connections:
                db = stack.enter_context(closing(sqlite3.connect(file.as_uri() + "?mode=ro", uri=True)))
                db.row_factory = sqlite3.Row
                connections[file] = db
            return connections[file]

        for group in groups:
            route = LIBRARIES.get(group.get("library"))
            spec = specs.get(route[0]) if route else None
            if spec is None or spec.analysis_db is None:
                output.append([None for _ in group["records"]])
                continue
            if spec.key not in hydrators:
                alias = spec.sidecars.get("alias_db")
                hydrators[spec.key] = AnnotationHydrator(
                    CanonicalAliasResolver(alias) if alias else None, spec.sidecars.get("annotation_db"))
            hydrate = hydrators[spec.key]
            catalog = connection(spec.analysis_db)
            annotated = []
            for record in group["records"]:
                header = record.get("raw_header") or record.get("header") or record.get("seqid") or ""
                sequence = record.get("sequence", "")
                rows = catalog.execute("SELECT * FROM antigen WHERE library_key=? AND seqid=?", (route[1], header)).fetchall()
                exact = [row for row in rows if normalized(row["sequence"]) == sequence]
                value = None
                if len(exact) == 1:
                    value = hydrate.hydrate_assay(dict(exact[0], library=route[1]))
                elif not exact and route[0] == "canonical":
                    # Canonical FASTAs can use accession headers instead of the
                    # assay catalogue's IDs. Require accession AND exact sequence.
                    accession = record.get("source_accession") or record.get("protein_id")
                    parent_file = next((s.sidecars["parent_db"] for s in specs.values() if "parent_db" in s.sidecars), None)
                    if parent_file and accession:
                        rows = connection(parent_file).execute("SELECT * FROM canonical_parent WHERE accession=?", (accession,)).fetchall()
                        exact = [row for row in rows if normalized(row["sequence"]) == sequence]
                        if len(exact) == 1:
                            value = hydrate.hydrate_canonical(exact[0])
                annotated.append(dict({key: value[key] for key in FIELDS if key in value}, parent_class=route[2]) if value else None)
            output.append(annotated)
    return output


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump(annotate(json.load(sys.stdin)), sys.stdout, ensure_ascii=False)
