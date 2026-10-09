# Atlas files and provenance

The current dataset archives are staged locally for a future Zenodo deposit.
`data/atlas-manifest.json` records filenames, sizes and SHA-256 values. Its DOI
and URLs are deliberately unset: the files have not been published by this task.

| Product | Purpose |
| --- | --- |
| Coverage summaries | Library-wide target rows and paired parent coverage, including the Pan-viral Atlas and other retained comparisons |
| Candidate indexes | Assay-mapped membership databases consumed by SeroMap statistics |
| Reference FASTAs and record annotations | Exact sequences and identity/grouping metadata needed for new local builds |

The staging manifest contains 15 comparison archives, eight candidate-index
archives and one FASTA/annotation archive. It records the current broad staging
set; this is not a decision that every archive belongs in the first MimicryMap
paper deposit. Bidirectional and individual-virus files retain their existing
packaging. Large payloads are excluded from Git and from the research ZIP.

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
