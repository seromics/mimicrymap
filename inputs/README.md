# Input FASTAs

- **antigen-target.fasta:** one or more target records.
- **mimicry-parents.fasta:** the complete parent population to compare against.

The starter ZIP contains the [HEPACAM–EBNA1 example](../docs/EXAMPLE.md). A download from the player contains the current selection instead. Both are ready to run with the included settings.

Replace the two files for your own comparison, or append records to include additional inputs. Use `>identifier description` headers; plain sequence text is also accepted. The local pipeline retains nonempty target and parent records shorter than nine residues; they cannot produce nine-residue windows and their summary regions are labeled Not assessable (<9 AA). The browser target input requires at least nine residues. Repeated identifiers receive occurrence suffixes. Parent records without matches remain in the input metadata.

The browser uses only the first target record. This local pipeline processes every target, one after another, with a separate output folder for each. Both retain every supplied parent record.

Selection downloads use a compact optional selection.json for record overrides, grouping, and coordinate mappings. With no sidecar, or changed input records, the pipeline uses the FASTAs as user-supplied records. Names, accessions, OS= organisms, and GN= genes are parsed consistently; recognized native assay headers retain their assay IDs. An additional mapped-records.fasta appears only when required full records are absent from the two main inputs.

Normalization is shared with the browser: uppercase; remove spaces, digits, `.`, `_`, `-` and `*`; represent B/Z/J/U/O as X. X is a forced mismatch. Unsupported characters produce a record-specific error. Original FASTAs and normalization details are retained. Positions refer to normalized sequences.

## Record metadata

The same rules apply to every record in single-target and multiple-target runs:

| Header format | Metadata retained |
| --- | --- |
| `>sample_1` | Record label only; Gene, Accession, Protein Description, and organism stay blank |
| `>sample_1 Supplied description` | Record label and supplied description; other fields stay blank |
| `>P00001 Example protein OS=Example organism GN=GENEA` | Recognized accession, description, organism and explicit gene |
| `>sp\|P00001\|ENTRY_TEST Example protein OS=Example organism GN=GENEA` | The same fields; the UniProt entry name is not used as a gene if GN= is absent |
| `>GENEA P00001 \| Example protein \| Example organism` | Explicit gene, recognized accession, description and organism, as used by the starter example |

The readable format requires a UniProt or RefSeq accession in its second token. Recognized native assay headers retain their assay metadata. No remote lookup or sequence-based annotation is performed. Unknown fields remain empty rather than containing "user supplied"; input provenance is recorded in run.json. Original headers remain in the copied FASTAs and records.json.

`selection.json` is tied to the ordered headers and normalized sequences of both original inputs. Editing headers/sequences, reordering records, or adding targets causes the runner to ignore the old sidecar as a whole and use the new FASTA metadata. Changing only settings preserves it. The sidecar is not a general annotation file for unrelated replacement records.

For the site’s summary-download table, use Target FASTA as antigen-target.fasta and Comparison FASTA as mimicry-parents.fasta. See the [Summary Download Guide](../docs/SUMMARY-DOWNLOADS.md) for population definitions and coverage denominators.
