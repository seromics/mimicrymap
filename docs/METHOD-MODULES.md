# Scientific methods and reusable figures

MimicryMap's sequence comparison defines reusable reference sets. Applying
those sets to measured antibody reactivity produces the Mimicry candidates
figure: sequence comparison → candidate sets → sample measurements → statistics
and figures. That figure can be a capstone of the MimicryMap paper even though
SeroMap currently supplies its application interface.

## Current implementations

| Method | Inputs | Current implementation in `seromap_electron` |
| --- | --- | --- |
| Mimicry candidates | Assay identities and sequence memberships, measured/hit masks, sample metadata, observation scope and coverage settings | `atlas/viewer/src/components/MimicryReactivity.jsx`, `src/lib/mimicryCounts.js`, `src/lib/mimicryPresentation.js`, `src/lib/sequenceLegend.js`, `server/mimicryReactivity.js`, `server/workspaceMimicryReferences.js` (paths relative to `atlas/viewer/` after the first) |
| Repertoire | Sample/antigen hit calls with measuredness, metadata and explicit linked-sample design | `atlas/viewer/src/components/RepertoireAtlas.jsx`, `atlas/viewer/shared/repertoireStatistics.js` |
| Admixture | Hit calls, measuredness, linked-set/person/visit/member metadata and selected anchors | `atlas/viewer/shared/familyAdmixture.js`, `atlas/viewer/shared/admixtureAnchorRoutes.js` and the existing summary renderer |

The candidate calculation uses each sample's measured background and total
hits, not just a list of positive antigens. Fold enrichment is the fraction of
sample hits in a set divided by the fraction of measured antigens belonging to
that set. Sets may overlap. Statistical families, eligibility, paired observation
rules and missingness must accompany the exported measurements. A rounded
coverage-summary parent list alone is insufficient to reproduce these results.

## Proposed reusable toolkit boundary

A separate `seromics-tools` repository could contain `mimicry-candidates/`,
`repertoire/`, `admixture/` and shared scientific/export utilities. Organize one
module per method, each supporting its related figure types. Each should have:

- A versioned input table/metadata contract, including missingness and design.
- One calculation implementation consumed by both the runner and SeroMap.
- Existing figure layouts, colors and technical legends.
- A small worked example, runnable figure export and citation information.

This is an extraction boundary, not an implemented standalone toolkit. The
current candidates component depends on React/application state, SQLite study
readers, reference resolution and observation controls. Its Code export can
replay a captured result; that is distinct from recomputing its statistics from
new measurements. No independent toolkit repository or new scientific API is
created by this MimicryMap staging commit.

MimicryMap remains responsible for sequence comparisons and atlas products.
SeroMap remains the integrated study/import/analysis host. Independent scientific
modules can be cited and used without duplicating either full application.
