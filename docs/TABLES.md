# Table Guide

Each target has its own folder under `outputs/targets/`.

| CSV | Contents |
| --- | --- |
| `comparison_summary.csv` | One target summary with 7/9, 8/9 and 9/9 column groups |
| `all-matches.csv` | All qualifying target–parent window pairs |
| `overall-mimicry-parents.csv` | One row per matching parent comparison |
| `current-window-slice.csv` | The same columns as All Matches, restricted to the selected target start; generated when `selected_target_start` is set |

`outputs/library_summary.csv` combines one summary row per supplied target. Summary rows remain present for targets without matches. Detailed match tables with no matches contain column headings only. `run.json` records settings, counts, coverage, and timings. The input FASTAs retain all supplied records, including parents without matches. Selection-filled packages also retain the metadata needed for sequence grouping and mapped coordinates.

## Coverage

Target and parent coverage measure the percentage of each record's full stored length within qualifying nine-residue cores. All nine positions count, including mismatches; overlaps count once and context flanks are excluded. Records shorter than nine residues have no eligible windows and contribute no coverage denominator.

Each row in Overall Mimicry Parents reports coverage for that parent comparison. The target coverage summary in `run.json` pools covered residues across all matching parents. Window coverage counts target starts with a qualifying match as a percentage of eligible starts.

Aggregate summary coverage and detailed percentage columns use two decimal places. Summary parent-list entries use one decimal for each Parent|Target value; their either-side 10% inclusion check uses unrounded counts. Counts remain exact, and calculations and ranking use unrounded values. Use the counts to distinguish rounded `0.00` or `100.00` from exact zero or complete coverage.

## Coordinates and sequence columns

Coordinates are 1-based and inclusive. Each event table groups the target's fields before the parent's: role label, Gene, Accession, Protein Description, optional assay ID, core coordinates and sequence, then context coordinates and sequence. Parent fields also include organism before the optional assay ID. Paired match masks, identity counts, and context scores follow.

The core contains nine residues. Context extends by up to nine residues on each side. Context Start and Context End delimit the actual sequence, which contains up to 27 residues without padding. Missing Context is blank for complete context; otherwise it gives unavailable flank positions, such as `N: 7; C: 4`. The core starts at zero-based offset `9 − missing N` within Context Sequence.

## Identity, match masks, and scores

| Field | Meaning |
| --- | --- |
| Core Identity | Identical amino acids across nine aligned positions; `7\|9` means seven of nine |
| Context Identity | Identical amino acids across the fixed 27-position context; `18\|27` means 18 of 27. Missing or unresolved positions contribute no matches |
| Best Core Identity / Best Context Identity | The respective maximum across a parent's qualifying window pairs. These maxima may occur at different sites |
| Context BLOSUM62 | Sum of substitution scores across the core and available aligned flanks. Missing positions and unsupported residue symbols contribute zero; scores may be negative |
| Core Matches / Core Mismatches | Counts across the nine core positions, excluding unresolved or absent positions |
| Flank Matches / Flank Mismatches | Combined counts across the two flanks, excluding unresolved or absent positions |
| Loci | Groups of overlapping core intervals; intervals that only touch remain separate |

Match masks begin with `mask: `. Letters show matching amino acids, `X` a mismatch, `?` an unresolved residue, and `-` an absent residue. Core masks cover nine positions. Context masks cover 27 positions: nine before the core, nine in the core, and nine after it. Flanks align by offset from the core. Context scores describe the surrounding alignment; the core identity threshold determines inclusion.

## Ordering

All Matches and Current Window Slice use coordinate order: target start, parent identifier, then parent start.

Overall Mimicry Parents defaults to descending target coverage. A selection-filled package retains the selected parent sort. Ties use target coverage, parent coverage, best core identity, and best context identity in descending order, skipping the primary sort key, then parent identifier in ascending order. Missing values appear last.

In the viewer, Core sorts by core identity, context BLOSUM62, then context identity. Context sorts by context identity, context BLOSUM62, then core identity. BLOSUM62 sorts by context BLOSUM62, core identity, then context identity. These scores sort in descending order; remaining ties use parent identifier and coordinates in ascending order.

## Assay metadata

Assay-ID columns appear when source assay identifiers are available. Assay Contributions contains the target and parent assay sequence IDs, original headers, available assay IDs, and mapped-record coordinates for each window pair. Multiple mapping contributions can belong to one window pair. These fields describe the source records and coordinate mappings; measured reactivity must come from the experimental data.

## Explicit record identity

Export schema `mimicryone/export/21` retains separate **Gene**, **Accession**, and **Protein Description** columns for both Antigen Target and Mimicry Parent in complete events, the selected window, and parent summaries. These columns sit beside each record's compact label. Gene values are retained source metadata; a missing annotation stays empty. Native assay IDs and mapping contributions keep their existing columns. The same serializer produces browser and reproduced tables.

For new FASTA inputs, these fields describe only supplied or recognized header metadata. Unknown fields stay blank; a generic FASTA identifier remains the compact record label rather than an inferred gene or accession. Metadata is per record, including in multiple-target runs. See the [Input Guide](../inputs/README.md) for supported headers and sidecar invalidation.

## Consistent client headers

The player, figure-data CSVs and atlas CSVs use the same record identity block: **Antigen Target**, **Antigen Target Gene**, **Antigen Target Accession**, **Antigen Target Protein Description**; the corresponding block uses **Mimicry Parent**. Human and viral scope does not change these role names. Lengths use `(AA)`, percentages use `(%)`, and threshold-specific columns state their threshold. Pooled coverage, individual-parent coverage, library-wide reach and figure coordinates remain separately labeled because they describe different quantities. Internal proteome routing slugs are not client CSV columns.

## Coverage and sharing summary

The player’s Summary CSV contains one row at the selected identity threshold for the selected comparison population. The local pipeline also writes `library_summary.csv` for every supplied target, with separate 7/9, 8/9 and 9/9 column groups, and `comparison_summary.csv` in each target folder. Detailed match/parent tables retain the selected threshold.

Each summary retains the full target sequence, Shared Regions (the union of covered target residues), Uncovered Residue Regions (its exact complement), All Matching Parent Count and a paired parent-coverage list. Coordinates are 1-based inclusive `start..end`. Uncovered Residue Regions means target residues outside all qualifying 9-residue windows at the stated identity threshold and comparison scope. Qualifying windows include mismatch positions; uncovered residues may participate in lower-identity matches. The number of entries in each paired list can be counted directly. Short records remain unassessable rather than being labeled uncovered.

Headers state **Coverage (%) Parent|Target (>=10% either)**. Entries use `label@parent_percent|target_percent`, separated by semicolons. Labels join the existing gene (or organism fallback), accession and assay ID with `|` and no surrounding spaces; missing components are omitted. Example: `DGUOK|Q16854-2|JHU11068@25.9|55.1`. Split each entry at the unescaped `@` before interpreting label components and the numeric Parent|Target pair. Backslash escapes literal backslash, semicolon, `@` and `|` inside components; structural separators remain unescaped. CSV quoting is a separate outer layer. Parent labels and native IDs are retained, but parent sequences are not embedded. Inclusion uses unrounded residue counts with an inclusive 10% threshold on either endpoint. Pair percentages use one decimal, half-up from the two-decimal serialization; overall coverage keeps two decimals. The paired list can be counted directly. All Matching Parent Count also includes matches below the listing floor, and whole-target coverage is not restricted to listed parents.

Duplicate sequence records remain separate partners. For byte-identical raw target/parent FASTAs, the corresponding same-index record is excluded from self comparison; distinct identical records remain. Otherwise records remain distinct across supplied files. These are descriptive sequence relationships, not antibody measurements or evidence of cross-reactivity.

### Stored residue annotations in Summary CSV

The interactive Summary CSV and local summary tables append Variants, Surface, Topology, rSASA, pLDDT and Cleavage. These columns include available target annotations regardless of track visibility. Regions use 1-based inclusive `start..end`; numeric tracks use `position:value` pairs at stored precision. Surface identifies the captured monomer/dimer context; topology lists annotated categories. Missing data is `Not available`, distinct from `None recorded` variants. Overall coverage uses two decimals and paired coverage uses one; list inclusion uses unrounded residue counts.

When target annotations are available, Current Comparison includes `inputs/residue-annotations.json`, containing the target sequence, stored track arrays, selected surface context and provenance. Offline runs reuse it only when the packaged input identity/mapping sidecar is accepted, and validate the exact target sequence. Changed FASTA inputs do not inherit old annotations. No annotation prediction or network lookup occurs locally. Static collection CSVs have 22 columns: seven target/comparison fields and five fields at each of 7/9, 8/9 and 9/9; app/local exports additionally carry six annotation columns.


### Organism labels in summary CSVs

`Antigen Target Organism (TaxID)` identifies the organism and its NCBI taxon ID. Organism names and NCBI taxon IDs share one cell, with `; ` separating multiple source taxa. The target library remains in the filename and manifest. Missing IDs are shown explicitly as `TaxID: not supplied`. Existing VirScan species and genus/family text remains in record labels.

App/local exports retain supplied `OS=` and `OX=` FASTA metadata and organism/taxon metadata in the Current Comparison sidecar. Bound human libraries use Homo sapiens (9606). Arbitrary FASTA inputs without taxonomy remain unspecified. Offline runs do not fetch taxonomy.

Short sequences retain `Not assessable (<9 AA)` in their region fields. Uncovered Residue Regions describes residues outside the qualifying core coverage for the selected comparison scope.

See the [Summary Download Guide](SUMMARY-DOWNLOADS.md) for the site’s static CSV populations, paired Target FASTA / Comparison FASTA inputs, source composition, and region examples.

Current CSVs use UTF-8 with a byte-order mark (BOM), and column headers use ASCII `>=10% either`. This keeps headers readable in spreadsheet apps while preserving Unicode in record names. Python readers should use `encoding="utf-8-sig"`; parse CSV quoting before the escaped parent-list delimiters.
