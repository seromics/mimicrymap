# Atlas Files and Provenance

The pan-viral atlas applies MimicryMap to canonical human proteins and 120 viral
proteomes. Explore the figures through the website or download the data and
offline catalogue from the [Zenodo dataset record](https://doi.org/10.5281/zenodo.24046306).
See [Using MimicryMap](USAGE.md) for the viewer and [Build Libraries](BUILD.md)
for comparisons using your own FASTAs.

## Downloads

The dataset contains 47 files totaling 41.26 GB: 16 CSV/FASTA comparison ZIPs,
16 SQLite companions, the atlas numerical-data ZIP, the 13,516-state figure ZIP,
three structure/annotation ZIPs, six FASTAs, figure-index.csv, README, format
definitions and manifest. The dataset uses CC BY 4.0, with original source
attribution and applicable terms retained.

| Product | Contents |
| --- | --- |
| Comparison summaries | Directional coverage tables, pair-specific residue ranges and exact input FASTAs at 7/9–9/9 |
| Mapping databases | Record identities, aliases, sequence-defined memberships and bidirectional coverage/range queries |
| Atlas numerical data | Maximum identity per human window and viral protein at 5/9–9/9, summaries and a Python reader |
| Atlas figures | PNG, SVG, legends and saved data for 13,516 views, with an offline catalogue |
| Structures and annotations | Human monomers, human dimers, non-human structures and available residue tracks, readers and source terms |

[data/atlas-manifest.json](../data/atlas-manifest.json) lists filenames, sizes,
checksums and download locations. Large datasets are downloaded separately
from the software. The dataset is published as [version 1.0](https://doi.org/10.5281/zenodo.24046306).

## Populations and Coverage

The atlas uses 20,333 canonical human proteins of at least 50 amino acids from
UniProtKB/Swiss-Prot 2026_01, compared with 2,222 proteins and polyproteins from
120 viral proteomes. Atlas coverage and reach retain all five identity thresholds
from 5/9 through 9/9 without a pair-coverage reporting filter.

The general-use comparison summaries retain all 20,431 canonical human records,
including shorter sequences. Their listed pairs require at least 10% coverage
of either sequence at 7/9, 8/9 or 9/9. The six global pair-ranking views use this
summary population and reporting rule, rather than the atlas plotting population.

The reduced numerical atlas stores the maximum identity per human nine-residue
window and viral protein. It preserves human-side coverage and reach, but does
not retain viral coordinates. Complete positional comparisons can be generated
with the research builder when both sides' window coordinates are needed.

## Figure Catalogue

The catalogue includes collection-wide summaries, individual viral proteomes
and individual viral proteins. Views show reach, residue coverage, identity
thresholds, human genomic position, subcellular location, protein length and
ranked matches. Figure-specific legends and CSVs identify the population and
quantities displayed. Extract the figure ZIP and open `Pan-Viral-Atlas/index.html`
to browse it locally.

Selected manuscript figures are available in [figures/paper/current](../figures/paper/current/README.md).
The complete archive also includes the alternative layouts and rankings.

## Reuse and Reproduction

Use the exact FASTAs and their annotation metadata to reproduce curated labels,
reference groups and record identities. FASTA sequences alone do not supply
taxonomy, assay aliases, structures or residue annotations. Mapping databases
declare their schema and supported identity/coverage cutoffs; independent residue
ranges do not reconstruct individual window correspondences.

Compare the same sequence populations, record units, thresholds, coverage rules
and annotation versions when evaluating equivalent outputs. Cite the software
version, dataset version and original input databases separately. The software
citation is in [CITATION.cff](../CITATION.cff); original MimicryMap software uses MIT.
