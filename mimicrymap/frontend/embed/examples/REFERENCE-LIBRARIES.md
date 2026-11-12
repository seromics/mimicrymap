# Standalone Reference Options

The viewer itself is static software. Reference libraries are optional data:
loading a library does not start a scan. Choose one target and click **Compare
Sequences**. Local input files are not uploaded.

| Setup | What Is Included | Additional Download |
| --- | --- | --- |
| Your FASTAs | Empty inputs in the same viewer | None |
| Small IL10 Example | Human IL10 and its EBV homolog; ready immediately | None |
| Human Canonical + 120 Viral Proteomes | 20,431 human targets and 2,222 viral proteins/polyproteins | 15.23 MB for both FASTAs |
| Optional Tracks and Structure Example | Supplied IL10 model and pLDDT confidence | Included small example |

## Human Canonical + 120 Viral Proteomes

These are the exact inputs in the consolidated MimicryMap Zenodo release:

| Input | File | Size |
| --- | --- | --- |
| Human canonical: UniProtKB/Swiss-Prot 2026_01 | `human_swissprot.fasta` | 14.08 MB |
| Curated 120 viral proteomes | `atlas_120_viruses.fasta` | 1.15 MB |

The [Zenodo record](https://zenodo.org/records/24046306) is currently unpublished.
`references.json` records the intended public file URLs; its download action is
disabled until publication. There is no token, login or draft-download dependency
in this viewer. Release maintainers should verify the published URLs and set
`published` to `true`. If cross-origin downloading is unavailable, download the
files from Zenodo and open them using the local file selectors.

To use local copies now, choose the human FASTA as **Antigen Targets** and the
viral FASTA as **Mimicry Parents**. Find a human accession or name, select its
record, choose the identity threshold, then compare. Swap the files for the
opposite direction. Inputs are kept for this tab's session; reopening the page
does not silently download or restore full reference libraries.

Browser matching enumerates window pairs. Long targets and low identity floors
can be expensive. Use the CPU/GPU research builder for whole-library work; the
standalone viewer does not automatically launch all-versus-all calculations.

## Optional Precomputed Mappings

The same release offers `source-atlas-120-viruses-human-swissprot.zip` (21.42 MB:
CSV/FASTA) and `atlas_120_viruses--human_swissprot-sqlite.zip` (13.49 MB). These
summarize retained 7/9–9/9 pairs with at least 10% coverage of either sequence.
They are optional for inspecting or selecting candidate pairs. They are not
complete positional viewer JSON and cannot substitute for a full window scan.
Each SQLite package includes its reader and format definitions.

## Optional Structure and Annotation Collections

Keep these separate from the lightweight viewer:

| Package | Compressed Size |
| --- | --- |
| `MimicryMap-Human-Structures-and-Reference-Tracks.zip` | 3.18 GB |
| `MimicryMap-Nonhuman-Structures-and-Annotations.zip` | 2.14 GB |
| `MimicryMap-Human-Dimer-Structures.zip` | 187.02 MB |

Sizes are decimal, from the staged release manifest. The complete collections
remain optional downloads, not prerequisites for comparing sequences.

A host can extract a model/annotation record, verify it against the selected
target sequence, and pass that record through `compare({assets})`. Use
`il10-assets.json` and `annotations.html` as the working example. The viewer
accepts its documented per-residue arrays and one PDB chain with target-numbered
residues. Collection ZIPs are not imported automatically; dimer/multichain models
require a host adapter and are not claimed as standalone API support. Retain
each source's attribution and coordinate metadata. Missing annotations stay absent.
