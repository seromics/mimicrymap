# Using the MimicryMap mimicry coverage summaries

## Canonical reference downloads

The first population in Target → comparison supplies the rows. Reversing the direction changes the target sequence and coverage denominator. **Canonical Human Proteins** contains all 20,431 reviewed human UniProtKB/Swiss-Prot records, including short proteins. The seven core reference tables cover human self-comparison and both directions versus Canonical Exposures, Curated Viral Proteomes (120) and Non-Vertebrate Exposures. Plot eligibility affects figures only. Hormone-only supplements remain available in the interface, with no separate standard export variant.
The standard human reference is UniProtKB/Swiss-Prot release 2026_01 (January 28, 2026), with 20,431 reviewed records. The broader human library in the interface also includes 339 retained TrEMBL records and 218 additional HORDB peptide-hormone sequences, for 20,988 records. The hormone scope includes ten further proteins already present in Swiss-Prot. UniProt supplies sequence annotations and variants; GO supplies fallback cellular-component assignments. AlphaFold, FreeSASA and pepsickle provide the structure, accessibility and cleavage tracks described on Data & Licenses. Available target annotations travel with Current Comparison in a separate metadata file; population FASTAs contain sequences and headers.
Canonical exposures combines UniProt Allergome-tagged proteins (4,016 source records), the IEDB human-exposure positive protein-antigen selection downloaded September 1, 2026 (19,621 sequence-bearing source records), the 120 curated viral proteomes (2,222 records), and 8,826 retained exposure reference records. The retained collection includes allergen, IEDB, viral and other exposure proteins, including 16 supplementary UniProt records; twelve updated sequence records are also retained. Identical amino-acid sequences are merged while retaining source memberships, yielding 24,867 sequence records. Source counts overlap and must not be added. The viral atlas is a subset of this combined collection.
The IEDB selection excludes Primates (including humans) and non-protein antigens; sequence-bearing records enter the comparison population. It describes antigens associated with positive responses, not individual assay reactions. All canonical exposures includes non-primate mammalian proteins. The two non-vertebrate downloads use 21,689 records with at least one resolved non-vertebrate source, retaining sequences shared with vertebrates. Mammals, birds, reptiles, amphibians and fish are excluded unless another source provides resolved non-vertebrate provenance. Records with only unresolved taxonomy are excluded. See Data & Licenses for citations and licenses.
The viral atlas uses 2,222 protein and polyprotein records across 120 curated viral proteomes. Standard exports use the complete Swiss-Prot population without a length or plotting-eligibility filter. Scope nests Vertebrates and Mammals beneath Eukaryotes. Uncheck Mammals to exclude mammalian-only records, or Vertebrates to exclude vertebrate-only records and turn off both nested selections. The standard filtered downloads use the latter population in both directions and exclude controls and records with only unresolved taxonomy. Swiss-Prot-only excludes supplemental hormone-only and TrEMBL records but retains Swiss-Prot proteins that themselves have hormone-related annotations.

## Assay library summaries and antibody-data identifiers

The assay libraries contain **21,197 HuProt 4.0 protein constructs**, **731,724 HuScan peptides**, and **680,704 VirScan/Exposome peptides**. VirScan/Exposome combines the full VirScan library, including viruses of nonhuman hosts, with the Exposome add-on. Downloads retain all 680,704 records, including 31 controls; the default mapping Scope excludes controls and shows 680,673 records across its three selectable subsets. The paired catalogue covers these assay libraries against each other, human Swiss-Prot, the 120-proteome viral atlas and canonical exposures, plus HuProt self-comparison. Each ready paired bundle includes both directions at 7/9, 8/9 and 9/9. Earlier single-direction or 7/9-only indexes remain identified as such until a completed replacement is available.
Use the original assay ID to join a row to multiplex antibody measurements. **Antigen Target Protein Description** starts with its **JHU ID** for HuProt or **CDI ID** for HuScan and VirScan/Exposome, followed by the retained description when present. Mimicry Parent lists retain the corresponding partner IDs. For example, `JHU00001`, `CDIH20000001` and `CDIV20000001` identify individual assay records; gene names and accessions may recur across different records.
Assay FASTAs preserve the original catalog headers, with the assay ID before the first `|`, and the exact stored sequences. Coverage uses each assayed construct or peptide's own length. Distinct records remain separate even when they share a sequence or accession. These CSVs contain sequence comparisons to align with antibody data, not antibody measurements. See [CDI Labs assay resources](https://www.cdilabs.com/resources/literature?page=1&category=content) for assay background.
Public filenames use `huprot4`, `huscan` and `virscan_exposome`, with single underscores between filename components. Displayed comparison names are HuProt 4.0, HuScan and VirScan/Exposome. Original record identifiers remain unchanged.

## What the tables contain

Whole-library summaries carry all three thresholds in one file. Each row has seven target/comparison fields and a coverage/range pair of columns at 7/9, 8/9 and 9/9: 13 base columns in total. Target fields retain gene, accession, description, length, full sequence, organism/taxon label and comparison library. Parent sequences are not embedded; cross-reference their identifiers with the comparison FASTA or database. Optional target annotations follow the base columns.

Coverage counts the union of residues in qualifying nine-residue cores for each individual record pair, including mismatches. Overlaps count once, context flanks are excluded, and each denominator is that record's full sequence length. Coordinates are 1-based inclusive `start..end`.

Every target row remains present, including records with no listed matches. Records shorter than nine residues cannot form a complete core and have empty pair lists; their length and sequence remain explicit. Self-comparisons exclude the same physical record while retaining distinct records with identical sequences.

## Read Mimicry Parent lists and choose cutoffs

At each identity level, **Mimicry Parents at 7/9 with Coverage (%) Parent|Target (>=10% either)** (and the corresponding 8/9 and 9/9 columns) records entries as `label@parent_percent|target_percent`, separated by semicolons. For example, `DGUOK|Q16854-2|JHU11068@25.9|55.1`. Label components are gene (or the existing organism fallback), accession, then assay ID, joined by `|` without surrounding spaces. Missing components are omitted. Original identifier values remain intact. The order is always **Parent|Target**.
Lists retain every pair reaching at least 10% coverage on either endpoint at that identity level. Inclusion is inherited from the existing numeric summaries before rounding; a listed parent's other endpoint may be below 10%. Pair percentages have one decimal, rounded half-up from the original summary values. Use the residue ranges and original sequence lengths for boundary-sensitive calculations.
Parse outer CSV quoting first. Split unescaped semicolons between entries, then the unescaped `@` between label and percentages. The left side of `@` is the label: split its unescaped pipes into components. The right side contains exactly two numeric values separated by `|`. Structural pipes and `@` are unescaped; backslash escapes a literal backslash, semicolon, `@` or `|` inside a label component. Empty lists retain their target rows. Numeric zero is a rounded value, not missing data.
Count entries in the paired list to obtain the number of qualifying partners. Each identity level has its own list and ranges.
These tables describe sequence relationships and can supply candidate sets for downstream analyses; they do not contain antibody measurements or enrichment statistics.

### Regions for each listed pair

New exports include **Mimicry Parent Regions at 7/9 Parent|Target (>=10% either)** and corresponding 8/9 and 9/9 columns. Entries use the same escaped labels, ordering and qualifying pairs as the percentage lists: `label@parent_ranges|target_ranges`. Commas separate ranges within one sequence; unescaped semicolons separate parent entries. For example, `GENE|P12345@1..18,50..61|21..38,90..101` describes two independent residue unions for that pair. Coordinates are 1-based and inclusive. Duplicate and overlapping cores count once; adjacent covered intervals merge. Empty lists mean no qualifying listed pair at that threshold.

Per-pair intervals can draw footprints on either sequence. They do not associate intervals across the sequences, identify mismatches or establish a continuous alignment. Full window correspondences remain a separate MimicryMap result.

## File layout

Downloads are grouped by library pair. The **Summaries ZIP** contains one comprehensive CSV for each available direction; self-comparisons have one CSV. Each directional row uses its own target sequence and denominator. Each pair-coverage column is immediately followed by its pair-region column. Optional annotation fields are listed in the file manifest; original annotations also travel in the complete package metadata sidecars.

The **Protein-page index** is built from the range-enabled summary CSVs, with reference metadata supplying record identities and lengths. It retains each listed pair at 7/9, 8/9 and 9/9 and serves both query directions. Reverse queries swap coverage denominators and residue ranges. Each protein's neighbours are individually compressed and indexed, so a page reads only its selected record. Exact coverage is recovered from merged residue intervals and sequence lengths, then checked against the published percentages. Ribbons use these independent unions; they are not window-by-window alignments.

The **Statistical membership index** packages sequence relationships for sample and group analyses. Reusable summary packages supply the CSV, stable record metadata and original FASTAs needed to derive this index and the protein-page index without repeating sequence matching. SeroMap applies identity and coverage thresholds, groups qualifying assay records by reference protein or proteome, and counts each assay record once within a set. Study measurements and hit calls are joined separately. Neither index contains antibody measurements, Fisher tests or BH results. Each download states its supported identities.

Packages containing `summary.json` can be imported with SeroMap's **Import summary / comparison** action, without an input database. `summary-records.jsonl` preserves complete record populations, including records with no matches; `summary-keys.jsonl` identifies every listed pair even when display labels repeat. The manifest binds those files, the CSV and both FASTAs by checksum. Ordinary CSV readers can still read the table independently.

Coverage is recovered from the independent residue unions and sequence lengths. Packages declare supported identity thresholds and omit pairs below 10% on both sequences; cutoffs below that floor cannot be reconstructed. New builds use exact residue coverage for memberships. Retained products that historically used one-decimal percentages declare that policy explicitly so converting storage does not silently move boundary memberships. Protein-page ribbons always use exact ranges. The two indexes are derived query formats; the CSV and its identity metadata remain the reusable source.

Full positional lookup databases are not part of the standard download catalogue. MimicryMap calculates detailed sequence maps on demand. Advanced Workspace builds can explicitly retain complete positions. The reference FASTAs remain separately available.

The catalogue identifies each product’s actual columns, thresholds and files. The 240 contextual selected-virus CSVs retain paired coverage lists without per-pair ranges and have 10 base columns. Browser/custom exports use the selected threshold; whole-library summaries include all three thresholds. Reproducing curated labels and source relationships requires the corresponding record metadata as well as the exact FASTAs.

## Assays mapped to canonical human proteins

The HuProt, HuScan and VirScan/Exposome → Canonical Human Proteins products use the full
20,431-record 2026_01 parent library and retain 7/9, 8/9 and 9/9 coverage.
Their installable membership databases support protein-level analysis in Proteome reactivity
in SeroMap; the CSVs retain the target-library summary format. CPU and the optional
NVIDIA accelerator feed the same coverage calculations and file writers.

An assay antigen contributes once to each qualifying protein set. Own-protein
matches and evidence shared with other sets remain included. HuProt replicate
spots count once per construct in study statistics; distinct peptides remain
distinct, including overlapping or homologous peptides. The viral analysis uses
the same counting rules. These memberships do not assign an exclusive infection
origin or establish that an antibody binds the matched protein. Protein sets are
not ontology categories. Full positional lookup databases are a separate,
optional build product.

## Spreadsheet or code?

Each CSV preserves complete fields in their original columns, including long sequences and parent lists. Import identifiers as text.

## From sequence summaries to proteome reactivity

MimicryMap's summaries describe which assay antigens match each reference protein and how much of each sequence is covered. Complete membership indexes use the selected identity and coverage thresholds to form reference sets before antibody hits are considered. An antigen counts once within a set, even if it matches several proteins from that proteome; it can belong to several sets. Join these memberships to assay measurements and hit calls by the original assay identifiers, retaining measured non-hits and missingness.

SeroMap's **Proteome reactivity** analysis and the [Seromics Tools reference workflow](https://github.com/seromics/seromics-tools/blob/main/docs/REFERENCES.md) use these inputs for **repertoire enrichment**. Within each sample and platform, fold enrichment is the fraction of all hits belonging to a set divided by the fraction of measured antigens belonging to that set. A one-sided Fisher test assesses excess set hits; Sample BH corrects across eligible reference sets and platforms within that sample. Separate group tests and Group BH support cohort comparisons.

The CSVs supply the sequence evidence, not antibody measurements or enrichment statistics. Their displayed percentages are rounded and pair lists have a coverage floor; they are not substitutes for complete membership indexes at arbitrary cutoffs. Exact reproduction requires the matching reference metadata, full-precision memberships, measured antigens, hit calls and selected statistical settings. Shared sequences remain shared evidence: enrichment does not establish a unique infection source or shared antibody binding.

## Populations and reproducibility

The accompanying manifest supplies file sizes, row counts, SHA-256 checksums, identity thresholds and suggested coverage cutoffs. The exact target and comparison FASTAs in each complete package retain both populations’ identifiers; the sequences section also supplies the original reference FASTAs. Reference FASTAs use accession, gene and protein-description headers; assay FASTAs use the original catalog headers beginning with JHU/CDI IDs. Each population FASTA comes from the corresponding public target rows; the non-vertebrate FASTA is the same population in both directions. Comparison FASTA includes the full comparison population, not only parents retained by the 10% list floor. Empty sequences, if present, are omitted from FASTA and reported in the manifest; short nonempty sequences remain.
The downloadable code package’s README and Input Guide explain how to run these populations, replace inputs, and use Current Comparison metadata. This dictionary describes the populations and output fields. Standalone FASTA contains sequences and headers; reproducing reference annotations and mapped record relationships also requires their metadata.
See How It Works for the matching method and Data & Licenses for source references and terms.

### Organism labels in summary CSVs

`Antigen Target Organism (TaxID)` identifies the organism and its NCBI taxon ID. Full source organism/strain names and their corresponding NCBI taxon IDs share one cell, with `; ` separating multiple source taxa. Exposure labels preserve the supplied source TaxID rather than replacing it with a species-level TaxID. The target library remains in the filename and manifest. Missing IDs are shown explicitly as `TaxID: not supplied`. Atlas-scoped rows use the full organism/strain name and matching taxon ID shown by the atlas page. Existing VirScan species and genus/family text remains in record labels.
App/local exports retain supplied `OS=` and `OX=` FASTA metadata and organism/taxon metadata in the Current Comparison sidecar. Bound human libraries use Homo sapiens (9606). Arbitrary FASTA inputs without taxonomy remain unspecified. Offline runs do not fetch taxonomy.
Short sequences retain their sequence and length with empty pair lists.

## One selected virus

The Pan-Viral Atlas offers both Human → virus and Virus → human CSVs for its selected viral proteome, alongside the pooled All viruses downloads. Each human-target file includes all 20,431 Swiss-Prot records. Its pair lists include only proteins from that virus; the reverse file retains the corresponding viral rows against the full human population. Contextual files have 10 columns; range-enabled pooled files have 13. Both use the same listing floor. The selected virus's organism/strain and TaxID identify the scope. No-match and short human records remain included.

### Selected virus and All viruses

The collection contains 240 selected-virus CSVs: two directions for each of the 120 reference proteomes. Selected virus refers to the reference proteome shown by the selector, including its organism/strain and TaxID; it does not combine every strain of that species. All viruses pools the declared atlas collection and is separate from the full canonical exposure library.
Human → virus supplies one row for each of the 20,431 Swiss-Prot human records, with only the selected virus as the comparison population. Virus → human supplies the selected proteome's viral rows against the full human population. The 20,333-record, ≥50-AA restriction applies to plots only. Human summary downloads retain short and no-match records.
The files are static downloads; changing the selector changes both links without starting a new comparison. The downloadable manifest's `selected_viruses` section records each proteome's identity and both URLs, row counts, byte sizes and SHA-256 checksums. The pooled tables remain available in the All viruses row.
Selected-virus files and pooled files use the same per-pair coverage definitions. A selected-virus list contains only pairs against the named reference proteome.

### Separate research outputs

Virus-linked human gene sets derived from assay-tile comparisons use their own membership and reciprocal tile-coverage definitions. They are not interchangeable with these whole-protein summary percentages. Cohort antibody analyses and positivity audits are separate research outputs; an assay-positive label or sequence-defined set is not an enrichment result or evidence of imprinting. See each research output's own methods and completion status.
Current CSVs use UTF-8 with a byte-order mark (BOM), and column headers use ASCII `>=10% either`. This keeps headers readable in spreadsheet apps while preserving Unicode in record names. Python readers should use `encoding="utf-8-sig"`; parse CSV quoting before the escaped parent-list delimiters.


## Download products

Each library pair occupies one row within canonical comparisons, assay-to-virus, assay-to-human, assay-to-exposure or cross-assay comparisons. Coverage summaries, protein-page indexes and statistical membership indexes have separate columns. A reversed reference-to-assay CSV changes the sequence reference and denominator, not the orientation of a study's statistical comparison.

Scientific download ZIPs place files directly at the root. Installable packages include `catalog.json`: each file's `source` is its extracted filename, while `path` is its destination inside SeroMap's managed library. Extract each ZIP into its own folder, then choose that folder in Workspace → Reference libraries → Install from folder. Install the standard reference dependencies first; the installer reuses matching verified versions. Source paths and ZIP compression do not change scientific file contents. Compressed and extracted/installed sizes are shown separately. Full positional lookup packages are excluded from this catalogue.

SeroMap's protein pages offer Sequence matches and Co-reactivity within the same
figure. The first selects exact assay sequence matches before looking at measured
reactivity; the second selects by Spearman correlation. Their shared scatter
shows the same paired observations. Neither sequence similarity nor correlation
alone establishes that one antibody binds both antigens.
