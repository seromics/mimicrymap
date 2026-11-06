# File Guide

Both downloads contain the same pipeline. Only the prepared inputs and selection settings differ.

| File | Purpose |
| --- | --- |
| `code/export-core.js` | Writes CSV exports and result tables. |
| `code/context-score.js` | Calculates Context BLOSUM62 scores. |
| `code/ranking.js` | Orders window pairs and parent records. |
| `code/residue-coverage.js` | Calculates coverage from merged qualifying core residues. |
| `code/projected-events.js` | Maps child-record matches to their original record coordinates. |
| `code/custom-worker.js` | Finds qualifying core window matches. |
| `code/fasta-input.js` | Reads and normalizes Custom FASTA inputs. |
| `code/mimicryone-identity.js` | Reads record identifiers and protein labels from FASTA headers. |
| `run/ensure-node.py` | Local Node.js runtime setup for Python/R launchers; reuses a compatible installation or downloads a checksum-verified private copy. |
| `run/ensure-node.R` | Local Node.js runtime setup for Python/R launchers; reuses a compatible installation or downloads a checksum-verified private copy. |
| `run/node-runtime.tsv` | Local Node.js runtime setup for Python/R launchers; reuses a compatible installation or downloads a checksum-verified private copy. |
| `code/parallel-scan.cjs` | CPU scheduling for local scans; automatically selects concurrency with an optional worker-count override. |
| `docs/TABLES.md` | CSV field meanings, counting units, coverage, ordering, and empty-table interpretation. |
| `docs/GLOSSARY.md` | Definitions of comparison inputs, sequence matches and result fields. |
| `README.md` | Run the prepared inputs or replace them for a new comparison. |
| `settings.json` | Input paths, identity threshold, selected start, and output folder. |
| `inputs/antigen-target.fasta` | The target input records with readable FASTA headers. |
| `inputs/mimicry-parents.fasta` | The complete selected parent population, including records without matches. |
| `inputs/selection.json` | Optional compact record overrides, grouping, and coordinate references; sequences remain in FASTA. Included for a selected comparison when needed. |
| `docs/COMPARISON.md` | The selected records, scope, and settings in a preloaded comparison package. Included for a selected comparison when needed. |
| `code/pipeline.cjs` | Runs FASTA comparisons and manages output folders. |
| `code/pipeline-runner.cjs` | Starts the comparison from the Node.js, Python and R launchers. |
| `code/pipeline-selection.js` | Readable record labels and automatic selection metadata. |
| `code/pipeline-layout.json` | Lists package files and their locations. |
| `docs/FILE-GUIDE.md` | Package folders and output tables. |
| `run.cjs` | Node.js launcher. |
| `run.py` | Python launcher. |
| `run.R` | R launcher. |
| `inputs/README.md` | Input editing and normalization. |
| `docs/EXAMPLE.md` | The editable example shipped with the starter package. |
| `inputs/mapped-records.fasta` | Additional full records needed for mapped coordinates, only when their sequences are absent from the two input FASTAs. Included for a selected comparison when needed. |
| `docs/SUMMARY-DOWNLOADS.md` | Reference populations, site summary CSVs, paired FASTA inputs, parent lists, and region definitions. |
| `inputs/residue-annotations.json` | Captured target residue annotations, surface context and provenance; reused only with matching selection metadata and target sequence. Included for a selected comparison when needed. |
| `docs/calculation/step-1.png` | Illustration for step 1 of the calculation walkthrough. |
| `docs/calculation/step-2.png` | Illustration for step 2 of the calculation walkthrough. |
| `docs/calculation/step-3.png` | Illustration for step 3 of the calculation walkthrough. |
| `docs/calculation/step-4.png` | Illustration for step 4 of the calculation walkthrough. |
| `docs/calculation/step-5.png` | Illustration for step 5 of the calculation walkthrough. |
| `docs/walkthroughs/example-1-panel.png` | Complete worked-example figure panel. |
| `docs/walkthroughs/example-2-panel.png` | Complete worked-example figure panel. |
| `docs/walkthroughs/example-3-panel.png` | Complete worked-example figure panel. |

Results are written under outputs/targets/, one folder per target, including comparison_summary.csv. outputs/library_summary.csv combines all target summary rows. summaries.zip contains directional CSVs, original FASTAs and a README. mapping-database.zip contains the installable SQLite and its inputs/settings; it has no CSV dependency. run.json records settings and summaries; inputs and record metadata remain available in the working output.
