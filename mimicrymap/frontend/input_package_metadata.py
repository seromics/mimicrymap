"""Small metadata sidecars for existing immutable local-input packages."""
import gzip
import hashlib
import json
from pathlib import Path

SCHEMA = "mimicryone/local-input-metadata/1"

def write_metadata(package):
    package = Path(package)
    before = package.stat()
    with gzip.open(package, "rt", encoding="utf-8") as stream:
        prefix = ""
        while '"annotations":' not in prefix:
            block = stream.read(8192)
            if not block or len(prefix) > 1024 * 1024:
                raise ValueError("Package header is unavailable")
            prefix += block
    header = json.loads(prefix.split('"annotations":', 1)[0].rstrip().rstrip(',') + '}')
    if header.get("schema") != "mimicryone/local-input-package/1":
        raise ValueError("Unsupported package schema")
    library = package.name.removesuffix(".json.gz")
    if header.get("library") != library or header.get("release_fingerprint") != package.parent.name:
        raise ValueError("Package path and release disagree")
    digest = hashlib.sha256()
    with package.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    after = package.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("Package changed while indexing")
    metadata = {"schema": SCHEMA, "release_fingerprint": header["release_fingerprint"],
                "library": library, "sha256": digest.hexdigest(), "compressed_bytes": after.st_size,
                "membership_fields": header.get("membership_fields", []),
                "row_columns": header["row_columns"], "manifest": header["manifest"]}
    target = package.with_name(library + ".meta.json")
    text = json.dumps(metadata, separators=(",", ":")) + "\n"
    if not target.exists() or target.read_text(encoding="utf-8") != text:
        temporary = target.with_suffix(".tmp")
        temporary.write_text(text, encoding="utf-8")
        temporary.replace(target)
    return metadata


def metadata_state(package, *, verify_hash=False, required_membership=()):
    """Validate the descriptor binding; optionally verify all compressed bytes."""
    package = Path(package)
    try:
        library = package.name.removesuffix(".json.gz")
        metadata = json.loads(package.with_name(library + ".meta.json").read_text(encoding="utf-8"))
        digest = metadata.get("sha256", "")
        if (metadata.get("schema") != SCHEMA
                or metadata.get("library") != library
                or metadata.get("release_fingerprint") != package.parent.name
                or metadata.get("compressed_bytes") != package.stat().st_size
                or not isinstance(digest, str) or len(digest) != 64
                or any(char not in "0123456789abcdef" for char in digest)
                or not isinstance(metadata.get("manifest"), dict)
                or not isinstance(metadata.get("row_columns"), list)
                or not isinstance(metadata.get("membership_fields"), list)):
            return "invalid_metadata"
        if not set(required_membership).issubset(metadata["membership_fields"]) or not set(required_membership).issubset(metadata["row_columns"]):
            return "incomplete_membership"
        if verify_hash:
            actual = hashlib.sha256()
            with package.open("rb") as stream:
                for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                    actual.update(block)
            if actual.hexdigest() != digest:
                return "stale_metadata"
        return "current"
    except (OSError, ValueError, TypeError, AttributeError):
        return "missing_or_invalid_metadata"
