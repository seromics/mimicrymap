# Example Sources

The FASTAs are literal records copied from the staged MimicryMap reference inputs:

| File | Record | Source |
| --- | --- | --- |
| target.fasta | Human IL10, P22301 | human_swissprot.fasta, UniProtKB/Swiss-Prot 2026_01 |
| parents.fasta | Epstein-Barr virus IL10 homolog, P03180 | atlas_120_viruses.fasta, curated 120-virus reference |
| il10-assets.json | IL10 AlphaFold structure and confidence | AF-P22301-F1-model_v6.pdb, retained reference model |

The two sequences and original FASTA headers are unchanged. The annotations file
contains the original PDB text and its C-alpha B-factor values as pLDDT, in the
target's 1-based residue coordinates. It contains no fabricated variants or
computed cleavage predictions. No scientific matching results are baked into
these examples: pressing Compare runs the shared local worker.

UniProt source data and AlphaFold DB predictions are distributed under CC BY 4.0.
See [UniProt](https://www.uniprot.org/help/license),
[AlphaFold DB](https://alphafold.ebi.ac.uk/entry/P22301), and the included model header.
These data terms remain separate from the MIT software license.
