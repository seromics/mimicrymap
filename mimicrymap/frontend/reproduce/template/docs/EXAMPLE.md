# HEPACAM–EBNA1 Example

This small example contains one target (HEPACAM/GlialCAM) and one parent (EBNA1, an Epstein-Barr virus protein).

## Run or replace the example

The starter pipeline ZIP contains two staged records in inputs/ and settings.json, with Min Identity set to 5/9. From the package folder, run `node run.cjs`. A player download contains the current selection instead. Read the [pipeline instructions](../README.md) to run either package.

For your own comparison, replace inputs/antigen-target.fasta and inputs/mimicry-parents.fasta, edit settings.json, and rerun. Choose a different output_directory if you want to keep a separate run.

To process more targets, append records to inputs/antigen-target.fasta. Each target is compared separately against the supplied parents, with its own output folder. Run time grows with the number and length of the input records.
