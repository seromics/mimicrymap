# MimicryMap runtime source

This directory tracks the native application, analysis runtime, authored public
documentation, reproduction code and required small assets extracted from the
pinned `reference-2026-09` pack. `source-origin.json` records original file hashes;
Git records subsequent changes. Runtime code is now packaged with the application.
Large reference payloads, example datasets and prepared downloads remain in the
immutable pack and are resolved by the host adapter.

`frontend/demo-structures/manifest.json` records the original reference paths and
SHA-256 checksums of five existing PDB models for IL10, HEPACAM and IGHG2. These
small examples ship as lossless gzip files; decompression preserves the source
bytes. The existing model attribution, provenance and distribution terms apply.

Source attribution and distribution constraints remain in the repository's
`SOURCE_LICENSE_LEDGER.md`, `LICENSE_AND_GOVERNANCE.md`, provenance records,
font notices, and the native Sources page. Extraction grants no new rights.
The engineering and promotion workflow is maintained in `wiki/index.md`.
