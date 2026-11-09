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
| Selected paper plots | figures/paper | Nine current PNG/SVG pairs exported November 8 with larger typography; no new calculations |
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

The editable Figure 1 PowerPoint and the author-edited Word manuscript remain in
the separate editorial workspace. They are not silently replaced by the README
method-overview illustration. The local `outputs/paper-figures-2026-11-08/` holds
the selected export sources and `outputs/paper-package-2026-11-06/` the earlier
editable components. These outputs are not part of a source clone.

## Before Public Release

- Select the software license and confirm the copyright holder and third-party notices.
- Supply final authors and citation metadata, then add CITATION.cff and the preprint link.
- Finalize the human-edited manuscript and Figure 1; review figure captions against the selected files.
- Tag the tested code version and publish the approved Zenodo draft when authorized.
- Replace draft links with the published dataset DOI/download links and connect the website.

The repository remains private. No DOI, public software release or software
license grant is implied by this staging. CC BY 4.0 applies to the dataset record;
original source terms and attribution remain applicable. SeroMap deployment and
application licensing remain a separate release decision.
