# Using MimicryMap

MimicryMap compares amino-acid sequences at three scales: a local sequence
window, a pair of complete records, and whole libraries. The target is the
sequence being inspected; parents are the sequences searched for matches.
These roles define coordinates and coverage denominators, not biological origin.

The human–viral atlas is a worked application. Custom proteins, assay peptides,
microbiome sequences, food proteins and other FASTA libraries use the same rule.

To start the browser viewer locally with the supplied example or your own FASTAs,
see [Run the Web Viewer](VIEWER.md). Its optional structure example, reference
preset and embedding instructions are in the same guide. The hosted site adds
the catalogue search and saved atlas pages described below.

## Explore one target

1. **Choose the comparison.** On the MimicryMap page, select a target and parent
   library. Search for the target by gene, accession or description, and narrow
   the available parent scope when needed.
2. **Choose core identity.** ≥7/9 means at least seven identical positions in
   a complete nine-residue core. Lowering the threshold includes more matches.
   A saved build cannot supply thresholds below its retained floor.
3. **Inspect a position.** Click or step through the target. Core Window Matches
   shows aligned cores and their flanking context. Overall Mimicry Parents
   summarizes matches across the target. Available sequence annotations and
   structures help locate a match; they do not change its sequence score.
4. **Read both coverage values.** The coverage plot pairs the fraction of the
   target covered with the fraction of the parent covered. Each uses its own
   full sequence length. Overlapping qualifying cores count each residue once,
   including mismatched positions inside an accepted core; flanks do not count.
5. **Export the relevant result.** Figure PNG/SVG exports preserve the selected
   view. Matches and Parents CSVs describe its comparison. Current Comparison
   supplies a runnable package with the selected inputs, settings and available
   coordinate/annotation metadata.

For an unfamiliar sequence, open **Your Custom Analysis**: paste or load one
target, choose a served parent library or a custom parent FASTA, select a
threshold, and run. This comparison runs in the browser. Only the first target
record is used there; use the [CPU pipeline](../README.md#run-a-detailed-comparison-cpu)
for multiple targets, or the [library builder](BUILD.md) for reusable mappings.
Custom headers remain available even when gene, accession or taxonomy is unknown.

## Explore the saved Pan-Viral Atlas

Start with the collection-wide overview, select one viral proteome, then inspect
individual viral proteins and their human matches. Reach counts human proteins
with at least one qualifying match; residue coverage measures the union of
covered human positions. Views include coverage maps, threshold summaries,
human-coordinate or protein-length arrangements, and ranked targets and pairs.

The atlas retains 5/9–9/9 for 20,333 human proteins of at least 50 AA. Its global
scatter views show 5/9 and 7/9. The separate literal-pair table uses the
general-use 7/9–9/9 summaries, includes all 20,431 human records, and lists pairs
reaching ≥10% coverage on either sequence. Figure CSVs and summary ZIPs therefore
have different populations and reporting rules; their legends and guides state
which applies. See [Atlas files and provenance](ATLAS.md).

## Install or build libraries in Desktop Workspace

Use **Workspace → MimicryMap Libraries → Import Guide** for the installed workflow.
The workspace separates sequence libraries from saved comparisons:

| Task | Route and result |
| --- | --- |
| Add your own sequences | **Add a Sequence Library** imports a FASTA with stable record IDs and retains its headers; it does not run all library comparisons |
| Supply or correct annotations | **Manage → Record Annotations** exports a template and imports labels by record identity |
| Reuse existing results | **Install Reference Data** or **Import Mapping Database** installs the selected saved product |
| Compare two libraries | **Run a Library Comparison** chooses target, parent, identity floor and retained output |
| Map several assays to a reference | **Build a Reference Collection** groups comparisons against one parent library |
| Change a completed analysis | **Clone & Change Settings** prepares another comparison while retaining the previous result |

**SeroMap Index + CSVs** retains record pairs, coverage and ranges for reference
membership and exports. **Full Lookup** additionally retains matching positions
for saved detailed exploration. Both compare the sequences; the output choice
changes what is retained. A lower floor such as 5/9 can produce substantially
more matches and much larger full lookups than 7/9. The research CLI supports
5/9–9/9 on CPU and NVIDIA GPU. SeroMap's bulk-build interface offers 7/9–9/9
using the same engine. Saved lower-threshold results remain viewable.
On-demand exploration of a target does
not require building a full lookup first.

The command-line [builder](BUILD.md) uses the same comparison engine without
Electron or a study. Original measurements and calls enter only through a
separate study import. For Reactivity Enrichment, assay record IDs and sequences
must agree with the mapping library; sequence membership is defined before
considering which records are antibody hits.

## Choose a download

| Product | Use it for |
| --- | --- |
| Figure PNG/SVG | The selected plot or table presentation |
| Matches / Parents CSV | Detailed window matches or parent summaries for the current comparison |
| Current Comparison | Reproducing the selected comparison with its captured inputs and settings |
| Pipeline ZIP | Running editable example FASTAs or your own detailed comparisons locally |
| General-Use Summaries | Whole-library coverage tables, pair-specific ranges and the exact input FASTAs |
| Mapping database | Reusing saved identities, coverage and memberships in a compatible installation |
| Full lookup | Reopening complete saved matching positions without repeating the sequence scan |
| Pan-Viral Atlas companion | Browsing saved atlas figures, legends and data independently of the manuscript |

General-use summary parent lists use a ≥10% coverage-on-either-sequence reporting
floor. This is a reporting convention, not a significance threshold. Unmatched
regions use the declared comparison population and identity floor; they do not
establish uniqueness outside that search. Refer to [Tables](TABLES.md) and the
[Summary Download Guide](SUMMARY-DOWNLOADS.md) for field meanings and denominators.

## Worked examples

The [illustrated walkthrough](../README.md#how-to-use-mimicry-results) follows the
same four examples as the current How to Use page:

1. **Investigate Critical Epitopes:** inspect the HEPACAM–EBNA1 site alongside
   independent antibody evidence.
2. **Calculate Reactivity Enrichment:** use sequence-defined assay sets to
   summarize recorded antibody hits within samples and across a cohort.
3. **Discover Mimicry Across Proteomes:** compare local matches with extensive
   IL10 homology using both coverage denominators.
4. **Find Uniqueness Within Proteomes:** inspect IGHG2 regions unmatched within
   the chosen human comparison library at the selected threshold.

The source repository includes the explorer and methods, runnable comparisons
and builder. It does not include an installed study or the complete reference
and atlas datasets. Curated browsing, structures and saved atlas views require
their separately installed assets and host services.
