Private research draft. Licensing, authorship/citation metadata and a public
release remain undecided.

- Current MimicryMap applet source and the original portable CPU runner.
- Standalone complete-library candidate-index builder; retaining all matched
  positions is optional.
- Optional NVIDIA/CUDA acceleration at 7/9–9/9 through the shared summary and
  database writers. CPU retains 5/9–9/9 support.
- FASTA metadata, canonical annotation presets and atlas download inventory.
- Integration guide for the private Seromics Tools candidate-analysis modules.

The source ZIP does not include the large atlas payloads or an installed CUDA
environment. Follow README.md and docs/BUILD.md. Existing web and desktop
deployments were not replaced by this staging work.

The builder passed Windows, macOS and Linux CI. A local NVIDIA run matched CPU
scientific CSVs and database contents on the bounded example; whole packages
retain distinct timestamps and generated IDs.
