# Build sequence libraries

The standalone builder calls the same engine as SeroMap Workspace. Inputs are
amino-acid FASTAs, optionally accompanied by record annotation CSVs. There is no
dependency on a study, Electron, old release catalogs or a fixed comparison list.

For the interactive route and Desktop Workspace button names, see
[Using MimicryMap](USAGE.md). The instructions below are for the standalone CLI.

## CPU

Install Node.js 24 or later. No npm dependencies are required.

```sh
node build.cjs --targets inputs/antigen-target.fasta --parents inputs/mimicry-parents.fasta --out outputs/example-index
```

The default is a unified mapping index at ≥7/9. Every target record is compared with
the parent library. `--floor 5`, `6`, `7`, `8` or `9` controls the lowest retained
identity; all higher thresholds are included. CPU uses the existing indexed
Workspace matcher. `node run.cjs` remains the detailed browser-worker CPU route
for Current Comparison exports, including their saved coordinate mappings.

The default mapping database already serves coverage and memberships in both
directions. Add `--bidirectional` only for full positional lookups in both
directions. This retains every matching
window in compact consecutive runs, writes `library_summary.csv` and
`reverse_summary.csv`, and supplies complete lookups in either direction from
one database. Record identities and repeated placements are preserved. Reverse
coverage uses the opposite sequence denominator; no second sequence scan is
needed. This option includes positions and can require much more storage than
the default candidate index. It uses the same CPU/GPU matching engine.

## Optional NVIDIA acceleration

Use a separate Python 3.11+ environment. The requirement matches the desktop's
CuPy/CUDA 12 wheel family. An NVIDIA GPU and compatible installed driver are
required. This command downloads software dependencies; comparison inputs stay local.

Windows PowerShell:

```powershell
py -3.11 -m venv .venv-gpu
.\.venv-gpu\Scripts\python.exe -m pip install --only-binary=:all: -r requirements-gpu.txt
node build.cjs --probe-gpu --python .\.venv-gpu\Scripts\python.exe
node build.cjs --targets inputs/antigen-target.fasta --parents inputs/mimicry-parents.fasta --out outputs/example-gpu --engine gpu --python .\.venv-gpu\Scripts\python.exe
```

Linux with NVIDIA:

```sh
python3 -m venv .venv-gpu
.venv-gpu/bin/python -m pip install --only-binary=:all: -r requirements-gpu.txt
node build.cjs --probe-gpu --python .venv-gpu/bin/python
node build.cjs --targets inputs/antigen-target.fasta --parents inputs/mimicry-parents.fasta --out outputs/example-gpu --engine gpu --python .venv-gpu/bin/python
```

GPU currently supports **7/9–9/9**. macOS uses CPU. The probe compiles and executes
a CUDA calculation; device enumeration alone is not treated as success. A GPU
error is reported rather than silently switching engines. GPU batches span
multiple target records, using the retained MimicryOne covering-seed strategy.
Coverage, metadata, summaries and database writers are shared with CPU.

The pinned CuPy requirement is the supported dependency entry point, not a claim
that every transitive wheel or hardware combination is identical. Record the
environment with `python -m pip freeze` for a publication build.

## Record metadata

Use the exact first FASTA header token as `record_id`. All other columns are optional:

```csv
record_id,gene,accession,description,organism,taxid,reference_set
my_record_1,IL10,P22301,Interleukin-10,Homo sapiens,9606,Human cytokines
```

Pass `--target-annotations targets.csv` and/or `--parent-annotations parents.csv`.
The same parser and field rules as Workspace apply. Unknown or duplicate IDs
reject the input. Blank cells retain parsed defaults. Original headers, sequences
and assay IDs remain intact. `reference_set` supplies an explicit candidate-set
label; otherwise the parent organism or library name supplies the grouping.

For the exact released FASTAs, retain their paired record annotation CSVs from
the reference bundle. The optional `--target-library` and `--parent-library`
presets are `builtin-human`, `builtin-viral120`, `builtin-exposure`,
`builtin-nonvertebrate`, `builtin-huprot`, `builtin-huscan` and `builtin-virscan`.
Use them only for the corresponding canonical inputs. Omit them for custom
libraries. These presets preserve canonical identity conventions; they do not
download annotations or add structures and filters to a new FASTA.

## Results

| File | Meaning |
| --- | --- |
| `library_summary.csv` | One row per target, with whole-library unmatched regions followed by paired coverage and ranges at each computed identity threshold |
| `pair_coverage.csv` | Exact target/parent coverage and ranges for listed pairs |
| `comparison.sqlite` | Unified identities, aliases, independent residue ranges and statistical memberships; complete positions instead when explicitly requested |
| `inputs/` | Exact FASTAs and effective annotation CSVs/SQLite indexes |
| `comparison.json` | Product type, completeness, backend, input checksums, counts and timing |
| `settings.json` | Floor, input names and positional-retention choice |
| `membership-index.sqlite` | Unified mapping sidecar when the main database retains complete positions |

The summary's parent lists use the ≥10% coverage-on-either-side reporting floor.
The package preserves all input records, including those with no listed match.
One shared SQLite writer saves these same matches directly, including record
metadata and independent residue ranges. CSVs are separate readable exports;
the build does not parse them back into a second database. No statistical
significance or antibody measurements are generated by this builder.

Unmatched Target Regions uses all qualifying core matches in the stated
comparison population, including pairs below the reporting floor. Complete
unions and their scope are retained in SQLite for re-export without matching.
Missing complete evidence is reported as **Not available**, never as uniqueness.
These unions do not change listed pairs or statistical memberships.

The builder also creates two separate downloads:

- `summaries.zip`: one CSV per direction, the original input FASTAs and a short README. A self-comparison has one CSV and one FASTA.
- `mapping-database.zip`: the SeroMap SQLite database, original input FASTAs and small installation configuration files. Extract it for installation on a new computer.

Record identities, aliases, organism metadata, pairs, ranges and statistical
cutoff values live in SQLite. Neither product requires JSON record/key sidecars.

The `unified-mapping/1` database stores each record pair and identity threshold
once. Protein pages use exact coverage and independent ranges; statistical
memberships use the package's declared cutoff policy. The builder prepares
SQLite lookup indexes locally. Distribution ZIPs can omit those lookup indexes
and declare local preparation in `catalog.json`; SeroMap verifies the transport
file, prepares it in staging and records the installed checksum. No matching is
repeated during installation.

`--retain-positions` adds every qualifying matching position and complete saved
viewer results. It can substantially increase disk space. Candidate indexes do
the same sequence comparison work with less retained output.

`--out` must be a new directory. There is no overwrite switch. The build uses
temporary input/search indexes beside that output and removes them after success
or a handled failure/cancellation. Inputs are copied into the final package.
Abrupt power loss can leave a `.mimicry-build-*` temporary directory; it is not a
completed comparison. Choose sufficient free space for inputs, search indexes
and output, not just the final CSV. No whole-atlas time estimate is implied by a
small example's timing.

## Use in SeroMap

Extract `mapping-database.zip`, then choose **Workspace → MimicryMap Libraries → Import Mapping Database…** and select the
extracted directory. The completed working directory is also accepted. Assign its target FASTA to the matching assay
platform(s). Candidate collections combine independently built target assays
against one parent library. A custom reference alone does not establish how an
assay's antigen IDs map to its sequences.

## Reproduce a completed result

Read its floor and retention choice from `settings.json`, then run the repository's
`build.cjs` with the saved `inputs/targets.fasta`, `inputs/parents.fasta` and both
annotation CSVs. Preserve canonical library presets where applicable. Use a new
output directory. CPU and GPU share scientific writers; timestamps, generated
IDs and runtime timings make entire packages differ. Compare scientific CSVs,
membership rows and positional coordinates for equivalent inputs/settings.

This fresh-FASTA route does not replay an old browser package's `selection.json`
coordinate projections or residue annotation tracks. Use that package's
`run.cjs` when reproducing those specifically mapped/grouped browser records.
