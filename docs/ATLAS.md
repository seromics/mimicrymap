# Atlas files and provenance

The current dataset archives are staged locally for a future Zenodo deposit.
`data/atlas-manifest.json` records filenames, sizes and SHA-256 values. Its DOI
and URLs are deliberately unset: the files have not been published by this task.

| Product | Purpose |
| --- | --- |
| Coverage summaries | Library-wide target rows and paired parent coverage, including the Pan-viral Atlas and other retained comparisons |
| Record-match indexes | Bidirectional protein-page lookups at 7/9–9/9; qualifying record pairs and, in range-enabled packages, merged residue ranges on each sequence |
| Candidate indexes | Assay-mapped membership databases consumed by SeroMap statistics |
| Reference FASTAs and record annotations | Exact sequences and identity/grouping metadata needed for new local builds |

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

The new builder writes portable `comparison.sqlite` packages. Historical
published candidate databases have their own assay-specific schemas and
packaging. Both are consumed by SeroMap through the appropriate adapters;
byte identity between these formats is not claimed. A publication reproduction
must compare the same sequence populations, record units, identity thresholds,
coverage rules and annotation versions before equating the scientific outputs.

Keep separate citations for the method/code version, atlas dataset version,
and any input databases. Final authors, paper reference, software/data license
choices and DOI metadata remain to be supplied before a public release.
