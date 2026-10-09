# HEPACAM: plot and table data

HuProt 4.0 HEPACAM/GlialCAM (JHU19101; Q14CZ8; 416 AA) compared with 87,590 human-infecting VirScan tiles. These saved sequence comparisons contain no antibody measurements. Native CDI IDs distinguish tiles; matching tiles here are 62 AA long. The source subset is CDIV2; Exposome is excluded.

## Files

- `Q14CZ8.m5.parents.csv`: all 53,157 matching tiles at ≥5/9, for the left scatterplot and parent table.
- `Q14CZ8.m7.parents.csv`: all 185 matching tiles at ≥7/9, for the right scatterplot and parent table.
- `Q14CZ8.m5.matches.csv`: all 204,544 window pairs at ≥5/9, for the peptide table, published-site alignment and rank table.

The CSVs retain the original bytes and row order. `manifest.json` records their sizes and SHA-256 checksums.

## Scatterplots and parent tables

Each parent row is one point. Plot `Antigen Target Residues Covered (%)` on X and `Mimicry Parent Residues Covered (%)` on Y, with both axes spanning 0–100%. For full precision, calculate each percentage as 100 × its Covered Residues / Eligible Residues. Keep every CDI tile distinct, even where points overlap.

The first three rows of each parent CSV supply the parent table, in saved target-coverage order. Display the two percentages to one decimal place and use `Best Context Identity` for Best Context (`27|27` displays as `27/27`).

## Peptide and rank tables

For the top three peptide rows, order the 5/9 matches by descending Context BLOSUM62, then core identity, then context identity, retaining original CSV order for ties. Select the first row for each distinct Mimicry Parent Assay ID, then take three. Identity values use `matched|length` notation. Use saved context coordinates, sequences and match masks for the alignment; Missing Context gives any terminal padding to display as dots.

For the published-site row, select target core start 376 and CDI ID CDIV20413116, with parent core start 40. Parent coordinates in this file are tile-local; the referenced EBNA1 full-protein site is 392–400. The six corresponding tiles are CDIV20413116, CDIV20413241, CDIV20424730, CDIV20428202, CDIV20436295 and CDIV20442001; their target and parent context sequences match the representative row.

The saved Context BLOSUM62 is 12. Count scores strictly greater than 12, then add one for its tied rank. Use all 204,544 rows; target core start 376 only (1,454 rows); or that same start with Mimicry Parent Organism containing `Epstein-Barr virus` (136 rows). The ranks are 53,085, 708 and 74, respectively.
