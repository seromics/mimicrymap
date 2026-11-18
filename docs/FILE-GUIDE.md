# File Guide

## Research repository

| Path | Purpose |
| --- | --- |
| `README.md` | Product overview, local quick start, illustrated methods and worked examples |
| `docs/USAGE.md` | Current explorer pages, desktop library routes and download choices |
| `docs/BUILD.md` | Whole-library CPU/GPU builds, metadata and output formats |
| `docs/ATLAS.md` | Separate atlas, summary and mapping datasets and their populations |
| `docs/PUBLICATION.md` | Publication components and selected manuscript figures |
| `mimicrymap/frontend/` | Explorer, atlas and authored method-page source; reference assets and host services are separate |
| `mimicrymap/workspace/` | Shared sequence-library and comparison engine |
| `build.cjs` | Standalone library-builder entry point |
| `code/` | Portable detailed-comparison implementation promoted from the shared source |
| `source-manifest.json` | Provenance of the promoted implementation |

## Detailed-comparison package

The plain Pipeline ZIP and Current Comparison download contain the same detailed
CPU pipeline. Their prepared inputs and selection settings differ. These files
are also retained in the research repository:

| File | Purpose |
| --- | --- |
| `code/export-core.js` | The same CSV and table implementation used by the site. |
| `code/context-score.js` | The shared Context BLOSUM62 implementation. |
| `code/ranking.js` | The captured ordering rules for window pairs and parents. |
| `code/residue-coverage.js` | The shared union-of-core-residues coverage implementation. |
| `code/projected-events.js` | Shared calculation and coordinate handling used by the site. |
| `code/custom-worker.js` | Shared calculation and coordinate handling used by the site. |
| `code/fasta-input.js` | The browser Custom FASTA parser and normalization, shared with the offline pipeline. |
| `code/mimicryone-identity.js` | The same header and public protein-label resolver used by the browser. |
| `run/ensure-node.py` | Local Node.js runtime setup for Python/R launchers; reuses a compatible installation or downloads a checksum-verified private copy. |
| `run/ensure-node.R` | Local Node.js runtime setup for Python/R launchers; reuses a compatible installation or downloads a checksum-verified private copy. |
| `run/node-runtime.tsv` | Local Node.js runtime setup for Python/R launchers; reuses a compatible installation or downloads a checksum-verified private copy. |
| `code/parallel-scan.cjs` | CPU scheduling for local scans; automatically selects concurrency with an optional worker-count override. |
| `docs/TABLES.md` | CSV field meanings, counting units, coverage, ordering, and empty-table interpretation. |
| `docs/GLOSSARY.md` | Definitions generated from the site's single terminology authority. |
| `README.md` | Run the prepared inputs or replace them for a new comparison. |
| `settings.json` | Input paths, identity threshold, selected start, and output folder. |
| `inputs/antigen-target.fasta` | The target input records with readable FASTA headers. |
| `inputs/mimicry-parents.fasta` | The complete selected parent population, including records without matches. |
| `inputs/selection.json` | Optional compact record overrides, grouping, and coordinate references; sequences remain in FASTA. Included for a selected comparison when needed. |
| `docs/COMPARISON.md` | The selected records, scope, and settings in a preloaded comparison package. Included for a selected comparison when needed. |
| `code/pipeline.cjs` | Shared FASTA pipeline and output-folder management. |
| `code/pipeline-runner.cjs` | The shared entry point used by all launchers. |
| `code/pipeline-selection.js` | Readable record labels and automatic selection metadata. |
| `code/pipeline-layout.json` | Shared package file paths. |
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

Results are written under outputs/targets/, one folder per target, including comparison_summary.csv. outputs/library_summary.csv combines all target summary rows. run.json records settings and summaries; inputs and record metadata are retained once per run.
