# Summary Downloads and Internal Compilation

Public downloads have two separate uses:

- **General-Use Summaries (.csv):** one CSV per direction (one for a
  self-comparison), the original input FASTAs and a short README. FASTA headers
  and sequences are retained, including records without a qualifying match.
- **SeroMap Index (.sqlite):** the unified mapping database and its installation
  configuration. The database contains complete record identities, aliases,
  organism metadata, pairs, ranges and statistical cutoff values.

CSV ZIPs do not contain record/key JSON sidecars or an installation catalog.
SeroMap imports the completed mapping database. Fresh FASTA builds produce
readable summaries and SQLite from the same comparison without repeating
matching. Annotation updates change record metadata without rebuilding pairs.

The internal `mimicrymap.summary-package/1` compiler format connects verified
range summaries to the unified database during a build. Its temporary files
are removed after successful verification and are not a download product.
Node.js 24 supplies the SQLite runtime. The intermediate contains:

- The ordinary summary CSV, with each paired percentage column followed by its
  independent parent and target residue unions.
- `summary-records.jsonl`: every input record on both sides, including records
  with no qualifying pair. Fields include side (0 target, 1 parent), a 1-based
  ID in FASTA order, unique token, source identifier, aliases, metadata, length
  and SHA-256 of the CSV sequence. `normalizedSha256` records normalization to
  the matching alphabet when it differs from the original sequence.
- `summary-keys.jsonl`: one line per CSV target row, for example
  `{"target":1,"parents":{"7":[[4,null]],"8":[],"9":[]}}`. Every entry identifies
  the corresponding physical parent record in the same order as the CSV list.
  The second value is the saved window-pair count, or null when unavailable.
  Display labels are never used as unique identities.
- Both original FASTAs, and optional complete annotation CSVs.
- `summary.json`: file paths, checksums, library descriptors, supported identity
  floors, row count, completeness and coverage policy.

The coverage contract is 1-based inclusive independent residue unions, with a
10% minimum on either sequence before display rounding. Packages cannot answer
lower coverage cutoffs or identity floors they do not contain. Record rosters
preserve the measured universe independently of whether a record has a match.

`membershipCoverage` is `exact-residue-union` for new builds. Legacy conversions
may declare `csv-pair-percent`, or a policy per identity, to retain their prior
cutoff arithmetic. Canonical organism and source-collection metadata determine
reference groups. A data correction to those assignments is recorded separately
from format conversion. Protein-page coordinates always use exact unions.

`summary-index.cjs` validates these internal files and compiles the unified
database. The source CSV is copied unchanged. Derived tables retain both query
directions; reverse queries exchange sequence IDs, coverage denominators and
ranges. No residue correspondence, mismatch sequence or continuous alignment
is inferred from a union. The public app and command-line builders do not expose
a CSV-only reconstruction route.

Native fresh builds verify CSV-derived pair values and aliases against the
initial computation before publishing the database. Catalogue conversions also
check existing cutoff memberships and coordinate payloads. Study measurements,
hit calls, Fisher tests and BH results are not stored in the mapping database.
