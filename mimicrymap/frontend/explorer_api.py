"""Final Explorer API adapter including coordinate-safe native asset reuse."""

from __future__ import annotations

from contextlib import closing
import hashlib
from pathlib import Path
import re

from _explorer_api_base import read_only_connection
from _explorer_api_enriched import ExplorerAPI as EnrichedExplorerAPI


ASSET_CROSSWALK_SCHEMA = "mimicryone/native-asset-crosswalk-sidecar/1"
ASSET_COLUMNS = (
    "portable_id",
    "sequence_sha256",
    "source_accession",
    "parent_kind",
    "native_track_accession",
    "structure_accession",
    "legacy_protein_id",
    "legacy_library_id",
    "mapping_basis",
    "sequence_identity_status",
    "coordinate_status",
    "conflict_status",
    "annotation_asset_available",
    "monomer_structure_available",
    "dimer_structure_available",
    "annotation_mapping_source",
    "structure_mapping_source",
    "annotation_file_sha256",
    "structure_file_sha256",
    "dimer_file_sha256",
)
PORTABLE_ID_RE = {
    "M1E": re.compile(r"^M1E[0-9]{9}$"),
    "P9P": re.compile(r"^P9P[0-9]{9}$"),
}
EXACT_BASIS = "exact_unique_source_accession_and_full_sequence"
EXACT_SEQUENCE = "full_sequence_exact"
EXACT_COORDINATES = "coordinate_identity_exact"
CONSISTENT = "consistent"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(chunk_size):
            digest.update(block)
    return digest.hexdigest()


class ExplorerAPI(EnrichedExplorerAPI):
    def __init__(
        self,
        release,
        *args,
        asset_crosswalk_db: Path | str | None = None,
        asset_crosswalk_release_fingerprint: str | None = None,
        asset_crosswalk_sha256: str | None = None,
        **kwargs,
    ):
        super().__init__(release, *args, **kwargs)
        self.asset_crosswalk_database = (
            Path(asset_crosswalk_db).resolve()
            if asset_crosswalk_db is not None else None
        )
        self.asset_crosswalk_metadata: dict[str, str] = {}
        self._asset_crosswalk_rows: dict[str, dict[str, object]] = {}
        self.structure_asset_hashes: dict[str, str] = {}
        self.dimer_asset_hashes: dict[str, str] = {}
        self.annotation_asset_hashes: dict[str, str] = {}
        self._expected_asset_release_fingerprint = (
            asset_crosswalk_release_fingerprint
        )
        self._expected_asset_sha256 = asset_crosswalk_sha256
        if self.asset_crosswalk_database is not None:
            self._validate_asset_crosswalk()
        elif asset_crosswalk_release_fingerprint or asset_crosswalk_sha256:
            raise ValueError("native asset sidecar pins require asset_crosswalk_db")

    def _validate_asset_crosswalk(self) -> None:
        """Fail closed unless the sidecar is bound to this exact Explorer."""

        assert self.asset_crosswalk_database is not None
        if not self.asset_crosswalk_database.is_file():
            raise FileNotFoundError(self.asset_crosswalk_database)
        if self._expected_asset_sha256 is not None:
            if SHA256_RE.fullmatch(self._expected_asset_sha256) is None:
                raise ValueError("native asset sidecar SHA-256 pin is invalid")
            if sha256_file(self.asset_crosswalk_database) != self._expected_asset_sha256:
                raise ValueError("native asset sidecar SHA-256 pin differs")
        with closing(read_only_connection(self.asset_crosswalk_database)) as sidecar:
            tables = {
                str(row["name"])
                for row in sidecar.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            if not {"metadata", "native_asset_crosswalk"} <= tables:
                raise ValueError("native asset sidecar lacks required tables")
            columns = tuple(
                str(row["name"])
                for row in sidecar.execute(
                    "PRAGMA table_info(native_asset_crosswalk)"
                )
            )
            if columns != ASSET_COLUMNS:
                raise ValueError("native asset sidecar schema columns differ")
            metadata = {
                str(row["key"]): str(row["value"])
                for row in sidecar.execute("SELECT key,value FROM metadata")
            }
            required_metadata = {
                "schema",
                "release_id",
                "release_fingerprint",
                "explorer_release_id",
                "explorer_release_fingerprint",
                "explorer_db_sha256",
                "source_explorer_db_sha256",
                "portable_id_namespace",
                "row_count",
                "structure_alias_count",
                "native_track_alias_count",
            }
            missing = required_metadata - metadata.keys()
            if missing:
                raise ValueError(
                    f"native asset sidecar metadata lacks {sorted(missing)}"
                )
            if metadata["schema"] != ASSET_CROSSWALK_SCHEMA:
                raise ValueError(
                    f"unsupported native asset sidecar schema: {metadata['schema']!r}"
                )
            if self._expected_asset_release_fingerprint is not None and (
                metadata["release_fingerprint"]
                != self._expected_asset_release_fingerprint
            ):
                raise ValueError("native asset sidecar release fingerprint pin differs")
            if metadata["explorer_release_id"] != str(self.manifest.get("release_id") or ""):
                raise ValueError("native asset sidecar Explorer release id differs")
            if metadata["explorer_release_fingerprint"] != str(
                self.manifest.get("release_fingerprint") or ""
            ):
                raise ValueError("native asset sidecar Explorer fingerprint differs")
            namespace = metadata["portable_id_namespace"]
            if namespace not in PORTABLE_ID_RE:
                raise ValueError("native asset sidecar portable namespace differs")
            manifest_hash = str(
                (
                    self.manifest.get("outputs", {})
                    .get("explorer.sqlite", {})
                    .get("sha256", "")
                )
            )
            if manifest_hash and metadata["explorer_db_sha256"] != manifest_hash:
                raise ValueError("native asset sidecar Explorer database hash differs")
            try:
                declared_rows = int(metadata["row_count"])
                declared_structures = int(metadata["structure_alias_count"])
                declared_tracks = int(metadata["native_track_alias_count"])
            except ValueError as error:
                raise ValueError("native asset sidecar counts are not integers") from error
            rows = sidecar.execute(
                "SELECT * FROM native_asset_crosswalk ORDER BY portable_id"
            ).fetchall()
        if declared_rows != len(rows):
            raise ValueError("native asset sidecar row count differs")

        with closing(read_only_connection(self.database)) as explorer:
            explorer_columns = {
                str(row["name"])
                for row in explorer.execute("PRAGMA table_info(protein)")
            }
            parent_kind_expression = (
                "parent_kind" if "parent_kind" in explorer_columns else "'' AS parent_kind"
            )
            current = {
                str(row["portable_id"]): row
                for row in explorer.execute(
                    "SELECT portable_id,class,source_accession,sequence_sha256,"
                    f"{parent_kind_expression} FROM protein WHERE class='Human'"
                )
            }
        observed_structures = 0
        observed_tracks = 0
        for row in rows:
            portable_id = str(row["portable_id"])
            core = current.get(portable_id)
            if PORTABLE_ID_RE[namespace].fullmatch(portable_id) is None or core is None:
                raise ValueError(
                    f"native asset sidecar has an unknown canonical Human id: {portable_id}"
                )
            if (
                str(core["source_accession"]) != str(row["source_accession"])
                or str(core["sequence_sha256"]) != str(row["sequence_sha256"])
                or (
                    str(core["parent_kind"])
                    and str(core["parent_kind"]) != str(row["parent_kind"])
                )
            ):
                raise ValueError(
                    f"native asset sidecar identity differs for {portable_id}"
                )
            if (
                row["mapping_basis"] != EXACT_BASIS
                or row["sequence_identity_status"] != EXACT_SEQUENCE
                or row["coordinate_status"] != EXACT_COORDINATES
                or row["conflict_status"] != CONSISTENT
                or row["legacy_protein_id"] != row["source_accession"]
                or row["legacy_library_id"] != "human_swissprot"
            ):
                raise ValueError(
                    f"native asset sidecar coordinate gate differs for {portable_id}"
                )
            track = row["native_track_accession"]
            track_flag = int(row["annotation_asset_available"])
            annotation_hash = str(row["annotation_file_sha256"] or "")
            if bool(track) != bool(track_flag) or (
                track and track != row["legacy_protein_id"]
            ) or bool(track) != bool(annotation_hash) or (
                annotation_hash and SHA256_RE.fullmatch(annotation_hash) is None
            ):
                raise ValueError(
                    f"native asset sidecar annotation gate differs for {portable_id}"
                )
            structure = row["structure_accession"]
            monomer = int(row["monomer_structure_available"])
            dimer = int(row["dimer_structure_available"])
            structure_hash = str(row["structure_file_sha256"] or "")
            dimer_hash = str(row["dimer_file_sha256"] or "")
            if bool(structure) != bool(monomer or dimer) or (
                structure and structure != row["legacy_protein_id"]
            ) or bool(monomer) != bool(structure_hash) or (
                structure_hash and SHA256_RE.fullmatch(structure_hash) is None
            ) or bool(dimer) != bool(dimer_hash) or (
                dimer_hash and SHA256_RE.fullmatch(dimer_hash) is None
            ):
                raise ValueError(
                    f"native asset sidecar structure gate differs for {portable_id}"
                )
            if structure and row["parent_kind"] != "full_length_swissprot":
                raise ValueError(
                    f"native asset sidecar exposes a non-full-length structure: {portable_id}"
                )
            observed_tracks += int(bool(track))
            observed_structures += int(bool(structure))
            record = dict(row)
            self._asset_crosswalk_rows[portable_id] = record
            if track:
                previous = self.annotation_asset_hashes.setdefault(
                    str(track), annotation_hash
                )
                if previous != annotation_hash:
                    raise ValueError(
                        f"native annotation hash conflict for {track}"
                    )
            if structure:
                previous = self.structure_asset_hashes.setdefault(
                    str(structure), structure_hash
                )
                if previous != structure_hash:
                    raise ValueError(
                        f"native structure hash conflict for {structure}"
                    )
            if dimer:
                previous = self.dimer_asset_hashes.setdefault(
                    str(structure), dimer_hash
                )
                if previous != dimer_hash:
                    raise ValueError(
                        f"native dimer hash conflict for {structure}"
                    )
        if observed_tracks != declared_tracks:
            raise ValueError("native asset sidecar track count differs")
        if observed_structures != declared_structures:
            raise ValueError("native asset sidecar structure count differs")
        self.asset_crosswalk_metadata = metadata

    def meta(self) -> dict[str, object]:
        payload = super().meta()
        if self.asset_crosswalk_database is not None:
            payload["native_asset_crosswalk"] = {
                "schema": self.asset_crosswalk_metadata["schema"],
                "release_id": self.asset_crosswalk_metadata["release_id"],
                "release_fingerprint": self.asset_crosswalk_metadata[
                    "release_fingerprint"
                ],
                "rows": int(self.asset_crosswalk_metadata["row_count"]),
                "native_track_aliases": int(
                    self.asset_crosswalk_metadata["native_track_alias_count"]
                ),
                "structure_aliases": int(
                    self.asset_crosswalk_metadata["structure_alias_count"]
                ),
            }
        return payload

    def _asset_crosswalk_row(self, portable_id: str):
        if self.asset_crosswalk_database is not None:
            return self._asset_crosswalk_rows.get(portable_id)
        with closing(read_only_connection(self.database)) as connection:
            table_exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' "
                "AND name='native_asset_crosswalk'"
            ).fetchone() is not None
            return (
                connection.execute(
                    "SELECT * FROM native_asset_crosswalk WHERE portable_id=?",
                    (portable_id,),
                ).fetchone()
                if table_exists else None
            )

    def protein(
        self,
        portable_id: str,
        *,
        include_receptor_germline: bool = False,
    ) -> dict[str, object]:
        payload = super().protein(
            portable_id,
            include_receptor_germline=include_receptor_germline,
        )
        row = self._asset_crosswalk_row(portable_id)
        if row is not None:
            crosswalk = dict(row)
            payload["protein"]["native_asset_crosswalk"] = crosswalk
            # Optional convenience fields are emitted only when the corresponding
            # verified asset exists.  Null crosswalk columns never escape as a claim.
            if (
                row["native_track_accession"]
                and int(row["annotation_asset_available"]) == 1
            ):
                payload["protein"]["native_track_accession"] = row["native_track_accession"]
            if (
                row["structure_accession"]
                and (
                    int(row["monomer_structure_available"]) == 1
                    or int(row["dimer_structure_available"]) == 1
                )
            ):
                payload["protein"]["structure_accession"] = row["structure_accession"]
        return payload


__all__ = ["ASSET_CROSSWALK_SCHEMA", "ExplorerAPI"]
