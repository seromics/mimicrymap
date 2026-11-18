# MimicryMap Overview

MimicryMap maps local amino-acid sequence resemblance and whole-record coverage
between proteins, peptides and libraries. Use it interactively for a target of
interest, run your own FASTAs, or reuse saved library summaries and mappings.
The human–viral atlas is a worked example of a library-agnostic method.

MimicryMap includes:

- The current explorer and five-page interface: MimicryMap, Pan-Viral Atlas,
  How It Works, How to Use, and Data & Licenses.
- A five-step illustrated calculation walkthrough, HEPACAM–EBNA1, IL10 and
  IGHG2 examples, and a general description of potential reactivity-enrichment use.
- Portable detailed CPU comparisons with captured inputs and settings.
- Whole-library builds producing coverage CSVs, pair-specific residue ranges
  and reusable mapping databases; complete matching positions are optional.
- CPU and optional NVIDIA/CUDA research builds at 5/9–9/9, defaulting to 7/9.
- Stable record identities, original FASTA headers and optional annotations.
- Documentation separating the full 5/9–9/9 atlas from general-use 7/9–9/9
  summaries, mapping indexes and selected manuscript figures.

Start with [Using MimicryMap](USAGE.md), the [illustrated README](../README.md),
or [Build libraries](BUILD.md). The source checkout does not contain the full
reference installation, large atlas datasets, private studies or a CUDA
environment. Curated browsing needs the reference assets and host services;
the standalone FASTA runners do not require an installed study.

The selected paper PNG/SVG exports are in [figures/paper](../figures/paper/README.md).
The full atlas, comparisons and structure supplements are uploaded together to
the [published Zenodo dataset](https://doi.org/10.5281/zenodo.24046306).
[Publication Components](PUBLICATION.md) connects the software, data and selected figures.

Original MimicryMap software is [MIT licensed](../LICENSE), copyright (c) 2026
Tyler Hulett. [CITATION.cff](../CITATION.cff) supplies the software citation.
The dataset uses CC BY 4.0; original source attribution and third-party terms remain applicable.
