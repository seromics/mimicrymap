# Running and Verification

This guide describes the retained snapshot-bundle runner and its verification mode. It is not included in the current pipeline package. For current FASTA/settings runs, use [README.md](../README.md); both the example-filled and selection-filled packages use that workflow. The commands below apply only to the legacy snapshot layout.

## Requirements and commands

Use Node.js 20 or later. Python/R can install a private Node.js runtime if it is missing; only that first setup requires internet access. No CRAN or pip packages are needed. Keep the extracted folders together. Paths resolve relative to the runner, so this also works from another working directory:

```sh
node "/path with spaces/to/bundle/run/reproduce.cjs"
```

| Command from the bundle root | Result |
| --- | --- |
| `node run/reproduce.cjs` | Verify shipped hashes and reproduce two primary CSVs from the frozen snapshot |
| `node run/reproduce.cjs --rescan` | Also run the independent CPU input comparison and verify agreement |
| `node run/reproduce.cjs --help` | Show commands without running a comparison |
| `python run/reproduce.py` | Run the default check through Python |
| `Rscript run/reproduce.R` | Run the default check through R |

Python and R require Node.js and forward arguments, including `--rescan`, to the same implementation. They are entry points, not separate numerical implementations. R on Windows requires R 4.2 or later for UTF-8 path handling. Rscript paths and arguments may contain spaces, Unicode and ampersands; quote each path as shown above. The R wrapper uses a process-local UTF-8 locale when an inherited Windows locale cannot represent those paths.

## What is verified

Before loading shared calculation code, the runner checks every listed input, code, documentation, and expected-result file against its SHA-256 in the manifest. Required files must be included in the manifest. Hashes establish consistency with the bundled manifest; the manifest is not a signed provenance certificate.

Default mode rebuilds two primary CSVs from `reference/comparison-snapshot.json` through the site's shared modules. Positional counts are reconciled against the result's parent summaries, and every output must match the expected bytes. It proves table reproduction from that frozen comparison, not an independent sequence rescan.

With `--rescan`, the runner additionally uses the unchanged browser CPU worker on all selected input records, including records with no matches. Parent sequences are stored in `inputs/mimicry-parents.fasta`. The accompanying `inputs/mimicry-parent-records.json` preserves identifiers, original headers, and metadata in FASTA order; original headers alone may not uniquely identify records. All shipped input representations are checksum-verified.

For mapped comparisons, `inputs/coordinate-projections.json` supplies original input records, exclusions, and exact mappings to displayed records. The runner compares these inputs, projects the resulting window pairs, retains assay contributions, and independently rebuilds both primary CSVs for byte-for-byte comparison. It never substitutes a full-record search for a partial input tile.

For direct comparisons, the rescan checks every independently generated parent identity, coordinate pair, core sequence, and core identity against the frozen result. The two primary CSVs are also reproduced and verified in the default step. These guarantees are reported separately in `reproduced/verification.json`.

`reference/record-mappings.json` is frozen supporting metadata. Its checksum is checked; it is not written as a regenerated result in either mode. Any assay contributions are regenerated on their All Matches rows; there is no separate assay-mapping CSV in new bundles. Figures are supplied in the separate Figure bundle.

## Success, failure, and an empty selected window

Success prints JSON containing `verified: true`, the mode, counts, and output folder. `reproduced/verification.json` records the same result and each CSV's expected and reproduced SHA-256.

A failed check exits with status 1 and a diagnostic on stderr before writing new reproduced files. Previous successful output, if present, remains unchanged; use the current exit code and report, not merely the existence of a folder. Check the Node.js exit status directly when piping output through another program.

The selected target start can have no qualifying window pairs even when matches occur elsewhere. `docs/COMPARISON.md` states the selected start and pair count. This bundle retains the complete All Matches table; the Current Window Slice CSV is a separate browser export.

If a file is missing, re-extract the entire ZIP. For a checksum mismatch, use a fresh original bundle; do not edit hashes to make a modified comparison appear verified. Older flat bundles retain their original filenames and runners. The current runner also accepts legacy flat bundles with their matching modules and manifest. Old mapped bundles without complete input projections need a new export for independent rescanning.

CPU work grows with target windows multiplied by parent input windows. The local scanner uses available CPUs minus one for every eight CPUs (rounded up), with at least one worker. For example, 8 available CPUs allow up to 7 workers; 16 allow up to 14. Set the environment variable MIMICRY_WORKERS to a positive integer to override this limit; 1 uses the serial scanner. The actual worker count can be lower when dividing parent records into chunks. The console reports the worker count. Targets are processed one at a time, and each target’s tables are written after its scan completes. During rescans, console progress reports completed parent records and elapsed time; the percentage counts records, not remaining compute time. Ctrl+C cancels. Only canonical amino acids contribute identity; unsupported symbols are forced mismatches.

## Select another comparison

Choose the target, Mimicry Parent Library, Scope, and Identity ≥ in the site, complete the comparison, and export a new Reproducibility bundle. Keep published bundles intact. No example's library size or release is assumed: `docs/COMPARISON.md` and `manifest.json` describe each export.

## Run a new comparison from FASTA

The public CPU pipeline ZIP and GitHub folder stage HEPACAM and EBNA1 in two editable FASTAs. Its root README describes Python, interactive R, automatic private Node.js setup, and the minimal per-target output folders. Local output captures each input once and keeps calculation code in the tool package.

The input/settings files are intentionally editable and are listed separately in the source manifest. Shipped code and guides remain checksum-verified. Each local run captures inputs, settings, record metadata, and code hashes once, with two main CSVs per target. The console identifies the temporary staging folder and each saved target folder as it completes. Per-Target scan, export, write, and total times are recorded in run.json under timings_seconds. Rerunning refreshes the managed output only after the new calculation succeeds; added files prevent replacement.

For programmatic integrations, the existing `--scan antigen-target-records.json mimicry-parent-records.json 7 NEW_OUTPUT_DIRECTORY` interface remains available. It accepts normalized JSON records and retains its older output format. The FASTA/settings workflow is the documented user entry point.
