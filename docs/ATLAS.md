# Atlas files and provenance

For a tour of the current atlas interface and its relationship to individual
sequence comparisons, see [Using MimicryMap](USAGE.md).

The current dataset archives are staged locally for a future Zenodo deposit.
`data/atlas-manifest.json` records filenames, sizes and SHA-256 values. Its DOI
and URLs are deliberately unset: the files have not been published by this task.

| Product | Purpose |
| --- | --- |
| Coverage summaries | Library-wide target rows and paired parent coverage, including the Pan-viral Atlas and other retained comparisons |
| Record-match indexes | Bidirectional protein-page lookups at 7/9–9/9; qualifying record pairs and, in range-enabled packages, merged residue ranges on each sequence |
| Candidate indexes | Assay-mapped membership databases consumed by SeroMap statistics |
| Reference FASTAs and record annotations | Exact sequences and identity/grouping metadata needed for new local builds |

## Pan-Viral Atlas and static figures

The curated atlas is one application of the general method. Users can compare
their own protein sequences or FASTA libraries with any chosen sequence library;
the code and summary workflow are not restricted to human proteins, viruses,
the supplied assays or the installed reference collections.

The full Pan-Viral Atlas at 5/9 through 9/9 is a separate publication product
from the general-use 7/9–9/9 coverage summaries and mapping indexes. The current
archive manifest inventories the latter downloads; it does not yet inventory
the complete atlas figure tree or its underlying 5/9–9/9 data.

The atlas landscape uses 20,333 canonical human proteins of at least 50 amino
acids from UniProtKB/Swiss-Prot 2026_01. Its coverage and reach figures retain
all five identity thresholds without the summary tables' 10%-either-sequence
pair reporting floor. The general-use human summaries retain all 20,431
canonical human records, including shorter proteins. These populations and
denominators must remain explicit in methods, legends and downloadable data.

Retained MimicryOne sources include pooled coverage, per-parent results,
reference sequences and the figure export workflow. The 15 September 2026
static capture contains all 9,066 planned figure states for all 120 proteomes:
9,066 SVGs, 9,066 PNGs, 9,066 captured legends and 3,183 shared CSVs. Its job
failed the final source-change guard after completing capture, not during
figure collection. Preserve that receipt and distinguish complete figure
coverage from a claim of one frozen renderer throughout the historical run.
The recovered atlas, saved data and reference FASTAs are staged independently
of the legacy checkout. See [Publication staging](PUBLICATION.md). Reuse these
results rather than rebuilding the sequence comparisons.

The staged static companion follows the atlas hierarchy: collection-wide
overview, one folder per viral proteome, then individual viral proteins. It
contains reach and coverage figures, threshold summaries, human-coordinate
maps and ranked protein/pair views, with CSV data and figure-specific legends.
The manuscript uses a selected set of SVG panels from that larger collection.
The full figure companion, atlas data and practical mapping summaries should
be independently identifiable downloads.

The current companion also includes an extended EBV/EBNA1 figure bank with
current interface variants and the five-step methods walkthrough as separate
SVG masters. Additional genome-position and human-protein-length arrangements
are being exported from saved atlas data for all 2,222 viral proteins: 4,444
states beyond the historical capture. Six current global pair-ranking states
are already saved. The local catalogue records completed images and remaining
work; it does not count a planned export as completed. See
[Publication staging](PUBLICATION.md) for the package layout and progress location.

The staging manifest records the currently completed packages and their measured
sizes; it is not a decision that every archive belongs in the first MimicryMap
paper deposit. Range-enabled bidirectional summary bundles contain one comprehensive
CSV per direction, with pair-specific range columns beside the corresponding
coverage lists. Self-comparisons have one direction. ZIP payloads sit at the archive
root; their install catalogue supplies application destinations. Record-match
indexes do not retain all matching window positions and are separate from
candidate membership databases. Large payloads are excluded from Git and from
the research ZIP.

Use the exact FASTAs **and** their annotation CSVs when reproducing curated
labels and reference sets. An arbitrary FASTA can reproduce sequence matching,
but does not invent taxonomy, assay aliases, grouped record membership,
structures or the curated source provenance. The existing source attribution
is retained in the applet's Sources documents and `source-licenses.js`.

The standalone builder writes portable `comparison.sqlite` packages. Historical
candidate databases have their own assay-specific schemas and
packaging. Both are consumed by SeroMap through the appropriate adapters;
byte identity between these formats is not claimed. A publication reproduction
must compare the same sequence populations, record units, identity thresholds,
coverage rules and annotation versions before equating the scientific outputs.

Keep separate citations for the method/code version, atlas dataset version,
and any input databases. Final authors, paper reference, software/data license
choices and DOI metadata remain to be supplied before a public release.
