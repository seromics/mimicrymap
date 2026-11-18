# Publication Components

MimicryMap comprises the sequence-comparison software, the pan-viral atlas and
reusable library comparisons. The website provides interactive exploration;
the downloadable datasets include readers for independent use.

| Component | Location |
| --- | --- |
| Viewer, CPU pipeline and optional NVIDIA GPU builder | [Software and usage](../README.md) |
| Matching definitions and worked example | [How It Works](HOW-IT-WORKS.md) |
| Comparison summaries, atlas data, figures and structures | [Zenodo dataset record](https://doi.org/10.5281/zenodo.24046306) |
| Dataset inventory and checksums | [Release manifest](../data/atlas-manifest.json) |
| Selected paper figures | [Current PNG/SVG exports](../figures/paper/current/README.md) |
| Software authorship and citation | [CITATION.cff](../CITATION.cff) |

## Figure Selection

The main atlas examples show pooled Epstein–Barr virus and EBNA1 coverage
arranged by subcellular location. Supplementary Figures S4 and S5 each show
50 pan-viral pairs ranked by human target coverage, at ≥7/9 and 9/9 respectively.
Parent-ranked lists and genomic-position views remain available through the
website and full figure archive. The selected exports retain the original label
sizes; panel letters and captions are editable in the Word documents.

The atlas population contains 20,333 human proteins of at least 50 residues.
Pair rankings use all 20,431 canonical human records and require ≥10% coverage
of either sequence. The full atlas has no such pair-coverage filter. See
[Atlas Files](ATLAS.md) for the numerical archive, figure catalogue and definitions.

## Citation and Terms

The software and dataset are separate citable resources. Cite the version used
and retain attribution to the original sequence and annotation databases.
Original MimicryMap software is MIT licensed, copyright (c) 2026 Tyler Hulett.
The compiled dataset uses CC BY 4.0; original source attribution and applicable
terms remain in its documentation. The dataset is published as [version 1.0](https://doi.org/10.5281/zenodo.24046306).
