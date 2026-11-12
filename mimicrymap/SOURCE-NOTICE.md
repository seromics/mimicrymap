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

Original MimicryMap software in this directory is licensed under the MIT license
in LICENSE. This grant covers the shared MimicryMap viewer, exporters and engines;
it does not relicense the surrounding SeroMap application. Third-party source,
fonts, reference sequences, annotations and models retain their original terms.
The font notices and native Sources page record attribution. Example model
provenance is retained in demo-structures/manifest.json and embed/examples/PROVENANCE.md.
