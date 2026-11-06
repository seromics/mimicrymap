# Terminology and Usage Rules

Single editorial authority: [terminology.json](terminology.json). This review page is generated; do not edit it separately.

Definitions govern public prose, controls, tooltips and figure labels. Compact labels are contextual forms, not alternate concepts. Client CSV field names follow the reviewed export contract and shared identity formatter; they use the same record roles across surfaces.

Use sentence case for defined terms in prose, legends, instructions, tooltips, and definitions. Retain established capitalization in figure titles, section headings, column labels, and explicit references to named controls. Define antigen target and mimicry parent once, then use target and parent when clear. Contextual labels do not introduce new concepts.

## Target and parent

The antigen target is the sequence record selected for inspection. A mimicry parent is a comparison record in the selected population. In the viral atlas, human target and viral parent name the same roles in the known library direction. CSV exports use Antigen Target and Mimicry Parent, including atlas and figure-data exports. Each identity block starts with its role label, followed by Gene, Accession and Protein Description with that role prefix. Human and viral labels in figure titles and prose describe biological scope; they do not introduce different CSV record roles.

## Library and scope

A library is an available collection of records; its scope is the population included after filtering. Target-side scope narrows selection, while parent-side scope defines the comparison population. Source collection identifies provenance. Canonical libraries retain protein and natural-form context; assay libraries retain the records used by an assay. In mimicry coverage summaries, the first population in Target → comparison supplies the rows. Selected virus means the currently selected reference proteome and its organism/strain and TaxID; All viruses means the pooled atlas collection, not all canonical exposures. Reversing direction changes the target population and coverage denominator. The download population and plot-eligible population are stated separately. Single mode intersects the active parent library and scope with one exact catalog record. It does not widen the scope or create a new library. With no record selected, single mode has no comparison population ready to run. A record’s presence in an exposure library is not evidence that a person encountered it or that the exposure is common.

## Records and sequence groups

A record is one identified stored sequence. It may be a protein, fragment, natural peptide, or assay antigen. Full record means the entire stored sequence and does not guarantee a biologically full-length protein. An exact-sequence group combines source records with identical full stored sequences into one comparison entry; group counts and source-record counts are different. A tile is a fragment record. Unclassified means no category is assigned at the stated level. Gene is a supplied or retained gene annotation; Accession is the source record accession; Protein Description retains the descriptive protein name separately from the compact label. In assay summary CSVs, Antigen Target Protein Description begins with the original JHU or CDI assay ID so records can be joined to antibody measurements; parent lists and original FASTA headers retain the corresponding IDs. Unknown biological metadata is not inferred. Blank organism metadata and the legacy custom-FASTA label “user supplied” both leave the organism unspecified; the latter describes input provenance. Other unknown metadata stays blank. An arbitrary FASTA identifier is a record label, not an inferred gene or accession. These rules apply independently to every record in multiple-target runs.

## Cores, windows, and context

A core is the nine aligned positions used to determine whether a match qualifies. A window is a positioned occurrence of that core in a record. Windows advance one residue and can overlap. Context adds up to nine available residues on each side of the core, aligned across 27 positions. Missing terminal context remains absent and does not affect inclusion. Summary CSVs retain each qualifying pair’s independently merged target and parent residue ranges. Coordinates are 1-based inclusive. Overlaps count once, flanking context is excluded, and processing direction does not change the union. Short records remain present with their lengths and empty pair lists. Unmatched Target Regions describe the complement of all qualifying target-core residues across the stated comparison population, before the pair-list cutoff. None means every target residue is covered; Not available means complete evidence is missing; Not evaluated applies below nine residues.

## Identity and threshold

Core identity counts identical resolved amino acids out of nine aligned positions; context identity counts them across a fixed 27-position span. Missing or unresolved positions contribute no identities. The core identity threshold is the minimum required for inclusion, labeled Identity ≥ in compact controls. Best Core and Best Context report the respective maxima for a record comparison; they may come from different sites. Context BLOSUM62 ranks available aligned context positions and is a score, not a percentage or inclusion threshold. A wildcard in the Methods illustration leaves a position unconstrained; observed match masks describe the actual alignment. Inclusion is determined by literal, ungapped core identity at the selected threshold. Display sorting is descriptive; no p-value, q-value or enrichment estimate is implied.

## Reach and coverage

Reach is the number or percentage of eligible human records with a qualifying match; each record counts once. Coverage is the percentage of eligible residues within qualifying cores. Target or parent identifies the record used as the denominator. Human target coverage describes one human record; human residue coverage describes the full eligible human residue population. Matches may come from one viral parent or be pooled across a proteome. Pooling takes the union of covered residues, not the sum of parent percentages. Overlaps count once, mismatching positions within qualifying cores are included, and context flanks are excluded. A median of individual record percentages is different from pooled population coverage. Window coverage instead measures the percentage of eligible window starts with a match. Mimicry coverage summaries are static sequence tables, not antibody measurements or enrichment results. Paired Parent|Target percentages describe individual record pairs. Unmatched Target Regions use complete library unions, not only the listed pairs. Human-to-selected-virus summaries use that virus alone for these unions; reverse summaries use the complete human comparison population.

## Counts of matches

Matching records counts comparison entries with at least one qualifying core. Exact-sequence groups count as single comparison entries. Window pairs counts distinct target and parent coordinate pairs, so repeated sites remain separate while duplicate mapping paths count once. Matched target windows counts target starts with at least one match. No matches means zero at the stated window, scope, and threshold. Core Window Matches is the selected-window panel; saved summaries across the whole target state that scope. Overall Mimicry Parents summarizes the full target. Complete results include all qualifying window pairs across the selected population at the stated threshold. Summary CSVs retain every pair reaching at least 10% coverage on either endpoint. Count entries in a paired list to obtain its number of partners.

## Paired parent lists

Summary tables use paired parent coverage with the header Coverage (%) Parent|Target (>=10% either), at the relevant identity level. Entries use Gene|Accession|AssayID@Parent|Target, with missing label components omitted, one-decimal percentages and semicolons between parents. Structural pipes and @ are unescaped; backslash escapes a literal backslash, semicolon, @ or pipe inside a label component. Split at the unescaped @ before interpreting label pipes versus numeric pipes. Original parent labels and assay IDs remain intact. Inclusion uses the inclusive 10% either-side rule before rounding. Count paired entries when a list count is needed. Empty lists retain the target row. Each threshold starts with Unmatched Target Regions for the complete comparison population, then pair coverage immediately followed by the corresponding pair-region column.

## Sequence results and published evidence

A sequence match is a qualifying positioned comparison under the stated input, scope and threshold. Experimental cross-reactivity is a separate observation reported by an assay or study. Reproducing a sequence result means recovering its substantive matches, coordinates, identities and coverage from the same inputs and settings; it does not mean replicating the cited biological experiment. Reproduction requires the original record identities, scope and biological annotations, even when metadata formatting differs. A saved figure retains the provenance of its original result. Additional sequence resemblance does not by itself establish cross-reactivity, exposure history or causation.

## Additional TrEMBL

Additional TrEMBL is the Human proteins scope containing the 339 retained unreviewed UniProtKB/TrEMBL records. These are accounted for separately from reviewed Swiss-Prot records.

## Review Boundaries

- Methods distinguish a Core Match Mask (the displayed alignment record) from a search mask (an internal candidate-selection representation). Neither creates new input sequences. The current two-record Frequency Logo is a frequency display, not a search-scoring PWM or evidence of enrichment.
- Approved naming conventions do not change calculations, population units or completeness gates. Trace labels to their actual counts; retain specific grouping units.
- Compact labels are contextual renderings of one term, not alternate definitions. Tooltips must identify the full term.
- Export field names are versioned contracts, not editable synonyms of display labels.
- Source-protein language in directional population figures must be reviewed in its actual orientation before replacement.
- Atlas figure titles, prose and image headings may use the contextual labels Human Target, Viral Parent and Human Target Coverage. Client CSV role headings use Antigen Target and Mimicry Parent across all matching record surfaces. Frontend and image column headings omit percentage units; percentage values carry %, while CSV percentage headers explicitly include (%).
