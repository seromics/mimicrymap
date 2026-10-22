# MimicryMap research release draft

MimicryMap maps local amino-acid sequence resemblance and whole-record coverage
between proteins, peptides and libraries. Use it interactively for a target of
interest, run your own FASTAs, or reuse saved library summaries and mappings.
The human–viral atlas is a worked example of a library-agnostic method.

This source stage includes:

- The current explorer and five-page interface: MimicryMap, Pan-Viral Atlas,
  How It Works, How to Use, and Data & Licenses.
- A five-step illustrated calculation walkthrough and four worked examples:
  HEPACAM–EBNA1, Reactivity Enrichment, IL10 and IGHG2.
- Portable detailed CPU comparisons with captured inputs and settings.
- Whole-library builds producing coverage CSVs, pair-specific residue ranges
  and reusable mapping databases; complete matching positions are optional.
- Optional NVIDIA/CUDA matching at 7/9–9/9. CPU supports 5/9–9/9.
- Stable record identities, original FASTA headers and optional annotations.
- Documentation separating the full 5/9–9/9 atlas from general-use 7/9–9/9
  summaries, mapping indexes and selected manuscript figures.

Start with [Using MimicryMap](USAGE.md), the [illustrated README](../README.md),
or [Build libraries](BUILD.md). The source checkout does not contain the full
reference installation, large atlas datasets, private studies or a CUDA
environment. Curated browsing needs the reference assets and host services;
the standalone FASTA runners do not require an installed study.

The manuscript, extended EBV/EBNA1 supplement, SVG masters and full atlas
companion are staged separately; [Publication staging](PUBLICATION.md) records
their contents and the remaining image exports. They are not a Zenodo deposit.

The repository remains private. Software, figure and dataset licenses, final
authorship/citation metadata and deposit identifiers still need author decisions
before public release. Existing source attribution and third-party terms remain
applicable; no license or DOI is assigned by this draft.
