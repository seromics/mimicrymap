# Manuscript and Publication Staging

MimicryMap is the research software and sequence-comparison dataset accompanying
the methods paper. The broader SeroMap application, study installation packages
and deployment license are separate. The paper draft is sequence/method focused;
patient-enrichment examples remain on the site and are not required paper figures.

## Current Components

| Component | Location | Status |
| --- | --- | --- |
| CPU/GPU research code and scientific exporters | This repository | Current shared source; CPU and GPU support 5/9 through 9/9 |
| Illustrated methods and worked examples | README, docs/calculation and examples | Included; historical example ZIPs are identified as saved outputs |
| Optional larger-label paper plots | figures/paper | Nine PNG/SVG pairs exported November 8; retained as alternatives, not the author's current figure selection |
| Preprint | Forthcoming | Author-written text, final figure arrangement and citation pending |
| Comparisons, atlas and structures | [Zenodo draft 24046306](https://zenodo.org/uploads/24046306) | Uploaded together; unpublished; CC BY 4.0 |
| Dataset inventory | [atlas-manifest.json](../data/atlas-manifest.json) | Current 47-file consolidated inventory and planned public links |

The dataset comprises 16 CSV/FASTA comparison ZIPs, 16 SQLite companions,
one focused atlas numerical-data ZIP, one 13,516-state figure ZIP and three
structure/annotation ZIPs. Six input FASTAs, figure-index.csv, README, format and
method definitions, and the manifest complete the 47 files: 41,258,798,832 bytes.
Large payloads remain outside Git. These are separate downloads in one dataset
record; the earlier atlas-only draft records are superseded unpublished backups.

The numerical atlas retains maximum identity per human window and viral protein,
not every matching viral position. Its human coverage and qualifying windows are
preserved. General research builds can retain full positions when requested.
The atlas uses 20,333 canonical human proteins of at least 50 residues; the
comparison downloads use all 20,431 canonical human records. The atlas has no
10%-coverage pair filter. Listed comparison pairs require at least 10% coverage
of either sequence at each identity threshold. See [Atlas provenance](ATLAS.md).

## Figures and Editorial Files

The full atlas archive contains the historical 9,066 states, 4,444 additional
parent arrangements and six global pair rankings, totaling 13,516. The historical
capture completed its figure states but failed its final source-change guard;
that limitation remains recorded in the data methods. Figure states are alternate
presentations, not independent experiments.

The selected paper exports are presentation variants of retained native figures.
They do not replace or modify the full atlas archive. Their inventory retains
source hashes and identifies the original captures. Panel letters remain editable
in Word. Figure 4 is arranged by subcellular location; its caption must not call
that arrangement genomic position.

The author's current November 7 manuscript and FIGURES Word files use the original
label sizes. Preserve that selection; do not substitute the November 8 larger-label
variants when preparing the public paper figures.

The editable Figure 1 PowerPoint and the author-edited Word manuscript remain in
the separate editorial workspace. They are not silently replaced by the README
method-overview illustration. The local `outputs/paper-figures-2026-11-08/` holds
the selected export sources and `outputs/paper-package-2026-11-06/` the earlier
editable components. These outputs are not part of a source clone.

## Before Public Release

- Original MimicryMap software uses MIT; retain third-party and data notices alongside it.
- Software author: Tyler W. Hulett; citation metadata is in CITATION.cff. Add the preprint link after submission.
- Finalize the human-edited manuscript and Figure 1; review figure captions against the selected files.
- Tag the tested code version and publish the approved Zenodo draft when authorized.
- Replace draft links with the published dataset DOI/download links and connect the website.

The repository remains private. MIT is now explicitly granted for original
MimicryMap software. No public software release or dataset publication is implied
by this staging. CC BY 4.0 applies to the dataset record;
original source terms and attribution remain applicable. SeroMap deployment and
application licensing remain a separate release decision.

## Release Order and Shared Links

The consolidated data upload is complete and remains unpublished. No further bulk
scientific payload is currently required. Final authors, version metadata, software
notices and the selected paper figures still need release review. A tagged software
archive or a final selected-paper-figures archive may be added only if chosen for
the release; they are not missing comparison or atlas data.

Publish the approved dataset only on explicit authorization, then use its final
DOI in the preprint's data availability text before public submission. The website,
this repository and the later public SeroMap app must use that same DOI and the
public file URLs represented in the release manifest. Do not ship draft API links.
Add the actual preprint link when available rather than inventing a citation.

The current local canonical website is the deployment source. Prepare its fresh
indexable pages, production runtime and reference-data selection separately from
the old live site's configuration. Advance storage/image staging may precede the
release, but Fly production cutover goes last with the preprint. The public desktop
application and its installation/licensing material remain a later release.
