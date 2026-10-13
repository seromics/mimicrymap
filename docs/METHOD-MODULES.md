# Scientific methods and reusable figures

MimicryMap's sequence comparison defines reusable reference sets. Applying
those sets to measured antibody reactivity produces the Proteome reactivity
figure: sequence comparison → reference sets → sample measurements → statistics
and figures. That figure can be a capstone of the MimicryMap paper even though
SeroMap currently supplies its application interface.

## Current implementations

| Method | Inputs | Current implementation in `seromap_electron` |
| --- | --- | --- |
| Proteome reactivity | Assay identities and sequence memberships, measured/hit masks, sample metadata, observation scope and coverage settings | `atlas/viewer/src/components/MimicryReactivity.jsx`, `src/lib/mimicryCounts.js`, `src/lib/mimicryPresentation.js`, `src/lib/sequenceLegend.js`, `server/mimicryReactivity.js`, `server/workspaceMimicryReferences.js` (paths relative to `atlas/viewer/` after the first) |
| Repertoire | Sample/antigen hit calls with measuredness, metadata and explicit linked-sample design | `atlas/viewer/src/components/RepertoireAtlas.jsx`, `atlas/viewer/shared/repertoireStatistics.js` |
| Admixture | Hit calls, measuredness, linked-set/person/visit/member metadata and selected anchors | `atlas/viewer/shared/familyAdmixture.js`, `atlas/viewer/shared/admixtureAnchorRoutes.js` and the existing summary renderer |

The repertoire enrichment calculation uses each sample's measured background and total
hits, not just a list of positive antigens. Fold enrichment is the fraction of
sample hits in a set divided by the fraction of measured antigens belonging to
that set. Sets may overlap. Statistical families, eligibility, paired observation
rules and missingness must accompany the exported measurements. A rounded
coverage-summary parent list alone is insufficient to reproduce these results.

## Standalone toolkit draft

The private [seromics-tools](https://github.com/seromics/seromics-tools) repository
now provides a headless runner and modules for Proteome reactivity, repertoire
and admixture, alongside the existing study-analysis methods. Its four cohort
routes accept raw or supplied measurements and manifests, write current `.sero`
files, and support matrix export/re-import. Individual HuProt GPR processing
remains a separate route. No Electron interface or application server is needed.

Complete candidate-index products from this CPU/GPU builder feed the toolkit's
Proteome reactivity calculation through the same membership/alias/coverage reader
used by Workspace. The toolkit's synthetic example demonstrates FASTA → complete
comparison → measured reactivity → fresh statistics → the existing capstone SVG.
See its [reference-input guide](https://github.com/seromics/seromics-tools/blob/main/docs/REFERENCES.md).

Fresh figure adapters and captured Code-bundle replay are documented separately.
Not every application view has a standalone rendering adapter. Scientific source
is currently an exact snapshot of SeroMap; the application has not yet switched
to importing the toolkit as a dependency. That subsequent ownership change can
happen module by module without duplicating numerical implementations. License
and citation decisions remain pending for both private drafts.

MimicryMap remains responsible for sequence comparisons and atlas products.
SeroMap remains the integrated study/import/analysis host. Independent scientific
modules can be cited and used without duplicating either full application.
