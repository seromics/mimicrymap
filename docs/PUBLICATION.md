# Manuscript and publication staging

The paper presents a general comparison method for arbitrary target and parent
protein libraries. Human and viral references are worked examples, not a
restriction on the code. Microbiome, food, allergen and custom assay sequences
use the same comparison rule. Experimental analyses are limited to Reactivity
Enrichment; the broader SeroMap application is outside this manuscript.

## Figure sequence

| Figure | Purpose |
| --- | --- |
| 1 | Define nine-residue identity, independent coverage denominators and reusable outputs |
| 2 | Relate reference search-space size to human protein reach and residue coverage |
| 3 | Walk through the EBV atlas at all five identity thresholds |
| 4 | Contrast a local HEPACAM match with extensive IL10 homology |
| 5 | Connect aligned sites to summary tables, mapping indexes and positional outputs |
| 6 | Apply sequence-defined sets to recorded antibody hits and cohort enrichment |
| Extended 1 | Compare human IGHG2 with a human reference library |
| Extended 2 | Compare explicit paired sequence fragments with a shared reference library |

The editable Word skeleton includes the figure walkthrough, complete methods,
legends, references and author-completion notes. SVG masters and original
components accompany it. No new experimental results are inferred from figure
labels, and full-precision data are not invented when only an SVG was retained.

The main Word draft now has 26 pages. Its five dedicated How It Works pages
reuse the original diagrams for record selection, overlapping windows, core
identity, sequence context and independent coverage unions. Each has a brief
summary and a technical legend. Their SVG masters and source manifest are in
`Paper-Figures/How-It-Works/`; Word uses matching high-resolution browser previews.

## Products kept separate

1. Tagged method and software source.
2. Full Pan-Viral Atlas at 5/9–9/9, with its offline figure browser, saved results,
   reference FASTAs, shared CSVs and captured legends.
3. General-use 7/9–9/9 summary tables and their exact reference inputs.
4. Reusable SQLite mapping indexes, separate from full positional outputs.
5. Selected paper figures and permitted experimental source data.

The current reference staging manifest inventories 155 existing archives:
137 summary/reference packages, 13 mapping indexes and five auxiliary
reference/annotation packages. This is an inventory, not a decision to include
every app annotation archive in the paper. The full 5/9 atlas is an additional
product; it is not contained in that reference-download manifest.

The historical atlas figure profile has 20 proteome-level states per virus,
one coverage view per viral protein, and two individual-parent scatter
highlights per viral protein: 2,400 + 2,222 + 4,444 = 9,066 states. Scatter
figures show 5/9 and 7/9; their data retain all five thresholds. Figure states
are alternate presentations, not independent experiments.

## Extended atlas and EBV supplement

`Supplementary-EBV-EBNA1/` in the local paper package contains an editable
40-page Word figure bank, 36 supplementary plates and 66 SVG assets. The
walkthrough covers collection comparisons, all standard EBV views, EBNA1
coverage and target rankings, and retained HEPACAM site/sequence exports.
Full target and literal-pair tables accompany the figure examples.

The historical 9,066 states are not every current view. The supplement adds
31 current native examples: 20 standard EBV states, three EBNA1 arrangements,
two EBNA1 highlights, and six global literal-pair rankings at 7/9–9/9 by
human or viral coverage. It also includes 27 retained sequence export
variants and eight summaries derived from saved data. No sequence matches
or antibody calls were recalculated.

The historical per-parent exports used only subcellular-location arrangement.
Genome-position and protein-length arrangements add a defined set of 4,444
states across 2,222 parents. All 4,444 were completed on 22 October 2026 using
the retained coverage payloads and native figure renderer. The completion receipt
is under `Pan-Viral-Atlas/figures/additional-parent-arrangements/` in the local
package. The main index includes these views and six global pair-ranking states:
13,516 figure states in total.
Pagination, themes and arbitrary highlights are not separate scientific variants.

The native human-target atlas table retains the viral partner selected at
7/9 when another ranking floor is displayed. The literal-pair table instead
lists eligible pairs at each threshold, with a 10% either-endpoint coverage
floor and a 20,431-record human reference including short proteins. These
are distinct from the 20,333-protein atlas population and must remain
explicit in legends. The new EBNA1 rankings use complete saved covered-
residue arrays without a 10% pair-list floor.

## Local package

The 21 October 2026 package is in `outputs/paper-package-2026-10-21/` outside
Git. `index.html` links the Word document, SVG bundle, full atlas and archive
catalogue. The atlas is copied there independently of the legacy MimicryOne
directory. Existing standard reference ZIPs remain in the established
publication-staging directory; the local catalogue records their exact paths.

The current handoff is `outputs/publication-handoff-2026-11-03/`. Its index
separates the manuscript and figures, the complete offline atlas, current CPU/GPU
source, reusable mapping data, and application-only reference packages. The source
snapshot records its base commit and uncommitted changes; it is not a published
tag. Existing data archives are referenced in place rather than duplicated.

Before public release, supply cohort provenance and actual upstream assay
methods, complete the experimental source-data exports, authorize the
paired-fragment accessory, and select software/data/figure licenses and DOI
metadata. Third-party terms remain applicable. The repository remains private;
local staging does not publish the paper or create a Zenodo deposit.
