# Interface Text Catalogue

Generated review view. Edit **interface-copy.json**; shared term labels and definitions belong to **terminology.json**. Then run `python frontend/public_sections.py`.

See [Glossary](GLOSSARY.md). Machine-facing export fields are separate in [the export contract](../contracts/export-fields.json) and are not editorial wording.

Public wording is draft. Locations and placeholder expressions are internal notes and are not shipped as UI text.

## Surface index

- `docs/public/navigation.html` — 5 entries
- `frontend/analysis-entry.js` — 105 entries
- `frontend/atlas-figures.js` — 123 entries
- `frontend/index.html` — 221 entries
- `frontend/method-figure.js` — 4 entries
- `frontend/mimicryone-runtime.js` — 76 entries
- `frontend/modification-symbols.js` — 10 entries
- `frontend/publication-exports.js` — 22 entries
- `frontend/release-provenance.js` — 6 entries
- `frontend/reproduce/export-core.js` — 52 entries
- `frontend/reproduce/ranking.js` — 10 entries
- `frontend/result-extent.js` — 30 entries
- `frontend/source-licenses.js` — 11 entries

Figure legends captured from the live DOM use the player legend entries. Native database descriptions and identifiers are not editable copy. Frozen published SVGs/PNGs retain their original text until explicitly regenerated from their recorded settings.

## analysis-entry.live-target-prefix

**Used in:** `frontend/analysis-entry.js` · Completed target status prefix

```text
Live ·
```


## analysis-entry.pinned-virus-scope

**Used in:** `frontend/analysis-entry.js` · Explain the restricted species and organism picker

```text
Curated Viral Proteomes (120) is fixed for this comparison. Select species or organisms to narrow it.
```


## analysis-entry.pinned-virus-reset

**Used in:** `frontend/analysis-entry.js` · Reset virus refinements while retaining the fixed collection

```text
Clear virus selections within Curated Viral Proteomes (120).
```


## analysis-entry.local-large-continuation

**Used in:** `frontend/analysis-entry.js` · Large stored responses continue on the current device with the same selected scope and threshold

```text
Computing the complete {{floor}}/9 result on this device. The selected scope is unchanged; Cancel is available.
```

- `{{floor}}` ← `Number(floor)` (live renderer value; not authored content)

## analysis-entry.positional-response-limit

**Used in:** `frontend/analysis-entry.js` · Result-size limit message; the response limit is not a complete result count

```text
The server response limit is {{maximum}} window pairs. This {{floor}}/9 selection could not continue locally; the previous result remains displayed.
```

- `{{floor}}` ← `Number(floor)` (live renderer value; not authored content)
- `{{maximum}}` ← `maximum.toLocaleString("en-US")` (live renderer value; not authored content)

## analysis-entry.positional-response-limit-unknown

**Used in:** `frontend/analysis-entry.js` · Result-size limit message when the server supplies no usable numeric limit

```text
This {{floor}}/9 selection exceeded the server response limit and could not continue locally; the previous result remains displayed.
```

- `{{floor}}` ← `Number(floor)` (live renderer value; not authored content)

## analysis-entry.allergome-uniprot-tag

**Used in:** `frontend/analysis-entry.js` · Scope collection label

```text
Allergome (UniProt tag)
```


## analysis-entry.also-include-records-whose-taxonomy.1930524

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Also include records that are unclassified at this taxonomic level.
```


## analysis-entry.assay-tile-libraries.4fc8c12

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Assay Libraries
```

Shared glossary term: `assay_libraries` (edit its label once in terminology.json).


## analysis-entry.assay-tile-libraries.a118897

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Assay Libraries
```

Shared glossary term: `assay_libraries` (edit its label once in terminology.json).


## analysis-entry.assay-tile-libraries.ac0df46

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Assay Libraries
```

Shared glossary term: `assay_libraries` (edit its label once in terminology.json).


## analysis-entry.canonical-proteome-indexed-scans-support.db20a1c

**Used in:** `frontend/analysis-entry.js` · User message

```text
Canonical-proteome indexed scans support only 5/9, 6/9, or 7/9.
```


## analysis-entry.choose-an-antigen-to-open.af874ee

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Choose an antigen to open a comparison.
```


## analysis-entry.choose-mimicry-parent.step-heading

**Used in:** `frontend/analysis-entry.js` · Display heading

```text
Choose Mimicry Parent:
```


## analysis-entry.choose-mimicry-parent-library.044f892

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Choose Mimicry Parent:
```


## analysis-entry.class.ccbad5f

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Class
```


## analysis-entry.clear-narrowing-filters-and-restore.368b6f1

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Clear narrowing filters and restore every available group, including unclassified records.
```


## analysis-entry.compare-your-antigen-target-sequences.41da1ec

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Compare one antigen target with a served library or your own parent FASTA. The analysis runs in this browser.
```


## analysis-entry.complete-cdiv-exposome-collection-independent.85f4d3c

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Complete CDIV3 Exposome add-on; select independently of either VirScan subset.
```


## analysis-entry.custom-antigen-target.43a43c6

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Custom Antigen Target
```


## analysis-entry.exclude-provenance-rows-assigned-to.c843572

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Uncheck to exclude mammalian sources. Shared sequences remain when a non-mammalian source qualifies.
```


## analysis-entry.family.569f43d

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Family
```


## analysis-entry.find-antigen-target.a79bef7

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Gene, accession, description, etc.
```


## analysis-entry.find-antigen-target.ed4fc41

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Gene, accession, description, etc.
```


## analysis-entry.full-proteins.5dbcec4

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Canonical Libraries
```

Shared glossary term: `canonical_libraries` (edit its label once in terminology.json).


## analysis-entry.full-proteins.6389d79

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Canonical Libraries
```

Shared glossary term: `canonical_libraries` (edit its label once in terminology.json).


## analysis-entry.full-proteins.97238cb

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Canonical Libraries
```

Shared glossary term: `canonical_libraries` (edit its label once in terminology.json).


## analysis-entry.gene-accession-protein-name-description.7d012db

**Used in:** `frontend/analysis-entry.js` · Display placeholder

```text
Gene, accession, description, etc.
```


## analysis-entry.gene-accession-protein-name-description.d19214f

**Used in:** `frontend/analysis-entry.js` · Display placeholder

```text
Gene, accession, description, etc.
```


## analysis-entry.genus.5e99945

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Genus
```


## analysis-entry.genus.c279908

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Genus
```


## analysis-entry.human-proteins.0a9ad82

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Human proteins
```


## analysis-entry.human-virus-subset-cdiv.51af5da

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Human-virus VirScan (CDIV2)
```


## analysis-entry.invalid-scope-count.37fbe61

**Used in:** `frontend/analysis-entry.js` · User message

```text
Invalid scope count
```


## analysis-entry.is-not-available-in-the.6d99ef7

**Used in:** `frontend/analysis-entry.js` · User message

```text
{{accession}} is not available in the current canonical catalog.
```

- `{{accession}}` ← `accession` (live renderer value; not authored content)

## analysis-entry.keep-at-least-one-group.1a77a06

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Keep at least one group selected. Uncheck individual groups to narrow the scope.
```


## analysis-entry.keep-at-least-one-option.cc2dca9

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Keep at least one option selected in this group.
```


## analysis-entry.keep-at-least-one-taxonomic.3a31b49

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Keep at least one taxonomic group selected.
```


## analysis-entry.kingdom.9329af1

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Kingdom
```


## analysis-entry.mimicry-parent-index-unavailable.51b1c33

**Used in:** `frontend/analysis-entry.js` · User message

```text
Mimicry parent index unavailable: {{value}}
```

- `{{value}}` ← `liveReason(parentSet.library)` (live renderer value; not authored content)

## analysis-entry.no-mimicry-parent-sequence-was.29f0fdb

**Used in:** `frontend/analysis-entry.js` · User message

```text
No mimicry parent sequence was supplied.
```


## analysis-entry.non-human-exposures.c05f552

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Non-human exposures
```


## analysis-entry.order.c398950

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Order
```


## analysis-entry.organism.bab9696

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Organism
```


## analysis-entry.parent-scope-changed-apply-or.0ce0cd3

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Parent scope changed; apply or close this menu to update the result.
```


## analysis-entry.phylum.a02e130

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Phylum
```


## analysis-entry.player-request-canceled.223a331

**Used in:** `frontend/analysis-entry.js` · User message

```text
Player request canceled.
```


## analysis-entry.precomputed-player-endpoint-unavailable.5a2f080

**Used in:** `frontend/analysis-entry.js` · User message

```text
Precomputed player endpoint unavailable.
```


## analysis-entry.records-without-a-resolved-domain.efec5b9

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Records without a resolved domain assignment.
```


## analysis-entry.run-analysis.f1464c1

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Run analysis
```


## analysis-entry.scope-filtered.474bb16

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Scope · filtered
```


## analysis-entry.scope-filtered.5bbc69a

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Scope · filtered
```


## analysis-entry.scope-filtered.b15bb4b

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Scope · filtered
```


## analysis-entry.scope.9d7f150

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Scope
```

Shared glossary term: `scope` (edit its label once in terminology.json).


## analysis-entry.scope.f3dd6f6

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Scope
```

Shared glossary term: `scope` (edit its label once in terminology.json).


## analysis-entry.scope.f5622cb

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
Scope
```

Shared glossary term: `scope` (edit its label once in terminology.json).


## analysis-entry.select-every-classified-domain-and.e2fef1f

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Select every classified domain and all unclassified records.
```


## analysis-entry.server-indexed-player-scans-support.c186e2a

**Used in:** `frontend/analysis-entry.js` · User message

```text
This comparison supports a minimum identity of 5/9 or 6/9. Choose one of those thresholds to continue.
```


## analysis-entry.species.121ac00

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Species
```


## analysis-entry.species.c974380

**Used in:** `frontend/analysis-entry.js` · Display metadata field

```text
Species
```


## analysis-entry.supply-the-mimicry-parent-fasta.92f3261

**Used in:** `frontend/analysis-entry.js` · User message

```text
Supply the mimicry parent FASTA to compare against.
```


## analysis-entry.the-shared-protein-identity-resolver.08d8c41

**Used in:** `frontend/analysis-entry.js` · User message

```text
The shared protein identity resolver is unavailable.
```


## analysis-entry.the-supplied-mimicry-parent-fasta.0c58085

**Used in:** `frontend/analysis-entry.js` · User message

```text
The supplied mimicry parent FASTA has no sequence of at least 9 residues, so it has no comparable window.
```


## analysis-entry.this-canonical-protein-has-no.777a6f3

**Used in:** `frontend/analysis-entry.js` · User message

```text
This canonical protein has no valid immutable parent identity.
```


## analysis-entry.this-canonical-protein-lacks-a.b39bb63

**Used in:** `frontend/analysis-entry.js` · User message

```text
This canonical protein lacks a frozen mapped-tile count.
```


## analysis-entry.this-component-protein-has-no.0c8e937

**Used in:** `frontend/analysis-entry.js` · User message

```text
This component protein has no verified Explorer-to-analysis crosswalk.
```


## analysis-entry.this-no-projection-canonical-protein.b10bdb8

**Used in:** `frontend/analysis-entry.js` · User message

```text
This no-projection canonical protein is outside the default analysis index.
```


## analysis-entry.this-parent-scope-is-active.71c1fcd

**Used in:** `frontend/analysis-entry.js` · Display textContent

```text
This parent scope is active in the open Player.
```


## analysis-entry.this-portable-protein-has-no.a012862

**Used in:** `frontend/analysis-entry.js` · User message

```text
This portable protein has no verified parent projection.
```


## analysis-entry.this-protein-has-an-invalid.1349e45

**Used in:** `frontend/analysis-entry.js` · User message

```text
This protein has an invalid Explorer-to-analysis crosswalk.
```


## analysis-entry.this-sequence-is-aa-mer.02e1cfb

**Used in:** `frontend/analysis-entry.js` · User message

```text
This sequence is {{value}} AA ({{value2}} 9-mer windows). Live 5/9–6/9 queries above the {{value3}}-window limit exceed this deployment's live compute limit.
```

- `{{value}}` ← `Number(record.length).toLocaleString()` (live renderer value; not authored content)
- `{{value2}}` ← `windows.toLocaleString()` (live renderer value; not authored content)
- `{{value3}}` ← `limit.toLocaleString()` (live renderer value; not authored content)

## analysis-entry.timed-out-waiting-for-the.d9460af

**Used in:** `frontend/analysis-entry.js` · User message

```text
Timed out waiting for the MimicryMap player.
```


## atlas-figures.at.8cc396d

**Used in:** `frontend/atlas-figures.js` · data-tooltip

```text
{{gene}} · {{value}}% {{measure}} at {{label}}
```

- `{{gene}}` ← `v.gene` (live renderer value; not authored content)
- `{{value}}` ← `pct(v.pct)` (live renderer value; not authored content)
- `{{label}}` ← `r.label` (live renderer value; not authored content)
- `{{measure}}` ← `SPREAD_METRIC === 'coverage' ? 'human residues covered' : 'human proteins reached'` (live renderer value; not authored content)

## atlas-figures.choose-another-virus.f46fcba

**Used in:** `frontend/atlas-figures.js` · Display placeholder

```text
Search Viral Proteomes…
```


## atlas-figures.current-release-verified.7916e0a

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
current release verified
```


## atlas-figures.find-a-viral-proteome.59ba495

**Used in:** `frontend/atlas-figures.js` · aria-label

```text
Search Viral Proteomes
```


## atlas-figures.historical-reference.baa5bb3

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
historical reference
```


## atlas-figures.historical-reference.c1b7f5e

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
historical reference
```


## atlas-figures.http.7559a77

**Used in:** `frontend/atlas-figures.js` · User message

```text
HTTP {{status}}
```

- `{{status}}` ← `r.status` (live renderer value; not authored content)

## atlas-figures.human-records-and-the-single.3077515

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
Human Target–Viral Parent Pairs Ranked by Target Residue Coverage · {{PROTEOME}}
```

- `{{PROTEOME}}` ← `PROTEOME` (live renderer value; not authored content)

## atlas-figures.keep-typing-to-narrow-matches.c32c42a

**Used in:** `frontend/atlas-figures.js` · Display textContent

```text
{{length}} Matching Viral Proteomes
```

- `{{length}}` ← `matches.length` (live renderer value; not authored content)

## atlas-figures.matching-viral-proteomes.f3a64a3

**Used in:** `frontend/atlas-figures.js` · aria-label

```text
Viral Proteome
```


## atlas-figures.median-source-protein-at.d884adf

**Used in:** `frontend/atlas-figures.js` · data-tooltip

```text
Median viral parent · {{value}}% {{measure}} at {{label}}
```

- `{{value}}` ← `pct(r.median)` (live renderer value; not authored content)
- `{{label}}` ← `r.label` (live renderer value; not authored content)
- `{{measure}}` ← `SPREAD_METRIC === 'coverage' ? 'human residues covered' : 'human proteins reached'` (live renderer value; not authored content)

## atlas-figures.min-identity.a7f02f5

**Used in:** `frontend/atlas-figures.js` · Display textContent

```text
Identity ≥
```

Shared glossary term: `min_identity` (edit its label once in terminology.json).


## atlas-figures.minimum-identity-for-this-figure.846b3e8

**Used in:** `frontend/atlas-figures.js` · aria-label

```text
Minimum Core Identity for This Figure
```


## atlas-figures.next-proteome-alphabetically.12e0030

**Used in:** `frontend/atlas-figures.js` · aria-label

```text
Next proteome, alphabetically
```


## atlas-figures.no-proteome-in-this-collection.49d8dda

**Used in:** `frontend/atlas-figures.js` · Display textContent

```text
No proteome in this collection matches that.
```


## atlas-figures.of.6092a62

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
6 of 9
```


## atlas-figures.of.818258b

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
7 of 9
```


## atlas-figures.of.da80b9c

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
5 of 9
```


## atlas-figures.of.f246de7

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
8 of 9
```


## atlas-figures.of.f68e1a6

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
9 of 9
```


## atlas-figures.previous-proteome-alphabetically.f96afa6

**Used in:** `frontend/atlas-figures.js` · aria-label

```text
Previous proteome, alphabetically
```


## atlas-figures.release-unverified.264d192

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
release unverified
```


## atlas-figures.source-proteins-of-ranked-by.012f336

**Used in:** `frontend/atlas-figures.js` · Display metadata field

```text
Viral Parents Ranked by Human Protein Reach · {{PROTEOME}}
```

- `{{PROTEOME}}` ← `PROTEOME` (live renderer value; not authored content)

## atlas-figures.text-tspan-font-family.9d0063b

**Used in:** `frontend/atlas-figures.js` · Display textContent

```text
text,tspan{font-family:{{FONT_UI}}}
```

- `{{FONT_UI}}` ← `FONT_UI` (live renderer value; not authored content)

## atlas-figures.text.83f747f

**Used in:** `frontend/atlas-figures.js` · Display textContent

```text
{{label}} · {{value}}
```

- `{{label}}` ← `entry.label` (live renderer value; not authored content)
- `{{value}}` ← `proteomeCount(entry)` (live renderer value; not authored content)

## atlas-figures.text.cd5a6b2

**Used in:** `frontend/atlas-figures.js` · HTML display fragment

```text
<span class="af-topic"></span>
```


## index.html.aa-window.f9e6d2b

**Used in:** `frontend/index.html` · aria-label

```text
{{ariaLabel}}; {{len}} AA; {{N}} Window{{value}}
```

- `{{ariaLabel}}` ← `targetIdentity.ariaLabel` (live renderer value; not authored content)
- `{{len}}` ← `T.len` (live renderer value; not authored content)
- `{{N}}` ← `N` (live renderer value; not authored content)
- `{{value}}` ← `N===1?"":"s"` (live renderer value; not authored content)

## index.html.alphafold-per-residue-model-confidence.3e36eaa

**Used in:** `frontend/index.html` · Display metadata field

```text
AlphaFold per-residue structural confidence (pLDDT), scored from 0 to 100.
```


## index.html.alphafold-residues-drag-to-rotate.8fe50e4

**Used in:** `frontend/index.html` · Display textContent

```text
AlphaFold · {{value}} · {{what}} · {{value2}} Residues · Drag to Rotate
```

- `{{value}}` ← `S3SHAPE==="ribbon"?"C\u03b1 Ribbon":"vdW Surface"` (live renderer value; not authored content)
- `{{what}}` ← `what` (live renderer value; not authored content)
- `{{value2}}` ← `nf(S3.ca.length)` (live renderer value; not authored content)

## index.html.antigen-target-direction-to-mimicry.95f3206

**Used in:** `frontend/index.html` · aria-label

```text
Antigen Target: {{ariaLabel}}; direction to Mimicry Parent set: {{parentLabel}}
```

- `{{ariaLabel}}` ← `identity.ariaLabel` (live renderer value; not authored content)
- `{{parentLabel}}` ← `parentLabel` (live renderer value; not authored content)

## index.html.antigen-target.500f78f

**Used in:** `frontend/index.html` · Display textContent

```text
Antigen Target · {{primaryLine}}
```

- `{{primaryLine}}` ← `targetIdentity.primaryLine` (live renderer value; not authored content)

## index.html.blosum-score-for-the-displayed.7f7c94b

**Used in:** `frontend/index.html` · Display tooltip

```text
Sum of BLOSUM62 substitution scores across available resolved positions in the displayed 27-residue context.
```


## index.html.both-are-shown-selected-window.15091f3

**Used in:** `frontend/index.html` · Display tooltip

```text
Both are shown: selected-window matches on the left and overall mimicry parents on the right.
```


## index.html.cleavage.e377190

**Used in:** `frontend/index.html` · Display metadata field

```text
Cleavage
```


## index.html.compact.e14aaef

**Used in:** `frontend/index.html` · Display textContent

```text
Compact
```


## index.html.context.f1d2429

**Used in:** `frontend/index.html` · Player summary column label

```text
Context
```


## index.html.core.18d0811

**Used in:** `frontend/index.html` · Player summary column label

```text
Core
```


## index.html.figure-export-root-figure-export.a21d481

**Used in:** `frontend/index.html` · Display textContent

```text
{{value}}
{{embeddedFontCss}}
.figure-export-root,.figure-export-root *{animation:none!important;transition:none!important}
```

- `{{value}}` ← `figureExportCss()` (live renderer value; not authored content)
- `{{embeddedFontCss}}` ← `embeddedFontCss` (live renderer value; not authored content)

## index.html.fit-the-protein-plot-above.46d98ff

**Used in:** `frontend/index.html` · Display tooltip

```text
Fit the protein plot above window matches, overall parents and structure.
```


## index.html.full.37296b3

**Used in:** `frontend/index.html` · Display textContent

```text
Full
```


## index.html.http.1f8d2fc

**Used in:** `frontend/index.html` · User message

```text
HTTP {{status}}
```

- `{{status}}` ← `r.status` (live renderer value; not authored content)

## index.html.http.67cc355

**Used in:** `frontend/index.html` · User message

```text
HTTP {{status}}
```

- `{{status}}` ← `r.status` (live renderer value; not authored content)

## index.html.identical-positions-in-the-nine.4ec00da

**Used in:** `frontend/index.html` · Display tooltip

```text
Identical positions in the nine-residue comparison window.
```


## index.html.inspect-the-wrapped-residue-level.374bb27

**Used in:** `frontend/index.html` · Display tooltip

```text
Inspect the wrapped residue-level plot with window matches, overall parents and structure.
```


## index.html.length-aa-windows.36312c4

**Used in:** `frontend/index.html` · Display metadata field

```text
{{tooltip}}
Length: {{len}} AA
Windows: {{N}}
```

- `{{tooltip}}` ← `targetIdentity.tooltip` (live renderer value; not authored content)
- `{{len}}` ← `T.len` (live renderer value; not authored content)
- `{{N}}` ← `N` (live renderer value; not authored content)

## index.html.length-aa-windows.395c709

**Used in:** `frontend/index.html` · Display tooltip

```text
{{tooltip}}
Length: {{len}} AA
Windows: {{N}}
```

- `{{tooltip}}` ← `targetIdentity.tooltip` (live renderer value; not authored content)
- `{{len}}` ← `T.len` (live renderer value; not authored content)
- `{{N}}` ← `N` (live renderer value; not authored content)

## index.html.loading-pipeline-source.e268309

**Used in:** `frontend/index.html` · Display textContent

```text
Loading pipeline source…
```


## index.html.main-track-color-direction-inverted.0795b6f

**Used in:** `frontend/index.html` · aria-label

```text
Main track color direction: inverted. Activate to restore the standard direction.
```


## index.html.main-track-color-direction-standard.e01fddf

**Used in:** `frontend/index.html` · aria-label

```text
Main track color direction: standard. Activate to invert.
```


## index.html.matched-parent-total-includes-every.6c4fead

**Used in:** `frontend/index.html` · Display metadata field

```text
{{value}} · comparison unit: {{entityLabel}} · matched-parent total includes every ranked entity with a hit at the active threshold; player shows the top {{PLAYER_NROW}} tracks{{value2}}
```

- `{{value}}` ← `text+(libraryRecords>0?" · "+nf(libraryRecords)+" library entries searched":"")` (live renderer value; not authored content)
- `{{PLAYER_NROW}}` ← `PLAYER_NROW` (live renderer value; not authored content)
- `{{value2}}` ← `residueSummary?" · "+residueSummary.coveredResidues+" / "+residueSummary.eligibleResidues+" target residues covered by the union of qualifying 9-mer cores; mismatch positions included, context excluded":""` (live renderer value; not authored content)
- `{{entityLabel}}` ← `entityLabel` (live renderer value; not authored content)

## index.html.mimicry.70199e2

**Used in:** `frontend/index.html` · Display metadata field

```text
Mimicry
```


## index.html.needs-the-dev-server-on.ed4a3e1

**Used in:** `frontend/index.html` · Display textContent

```text
Needs the dev server on 5173. ({{message}})
```

- `{{message}}` ← `e.message` (live renderer value; not authored content)

## index.html.no-residue-annotations-for-this.fb22e33

**Used in:** `frontend/index.html` · Display textContent

```text
No residue annotations for this protein
```


## index.html.of-at.e68ad75

**Used in:** `frontend/index.html` · Display textContent

```text
{{value}} of {{value2}} at ≥{{TH}}/9
```

- `{{value}}` ← `(rows.length<matchedTotal?"Top ":"")+rows.length` (live renderer value; not authored content)
- `{{value2}}` ← `nf(matchedTotal)` (live renderer value; not authored content)
- `{{TH}}` ← `TH` (live renderer value; not authored content)

## index.html.overall.d17296a

**Used in:** `frontend/index.html` · Display textContent

```text
Overall
```


## index.html.page-of.2b17489

**Used in:** `frontend/index.html` · Display textContent

```text
Page 0 of 0
```


## index.html.page-of.fc5c699

**Used in:** `frontend/index.html` · Display textContent

```text
Page {{value}} of {{motifPageCount}}
```

- `{{value}}` ← `motifPageIndex+1` (live renderer value; not authored content)
- `{{motifPageCount}}` ← `motifPageCount` (live renderer value; not authored content)

## index.html.pause.c03a935

**Used in:** `frontend/index.html` · aria-label

```text
Pause
```


## index.html.pause.e413f7f

**Used in:** `frontend/index.html` · aria-label

```text
Pause
```


## index.html.pepsickle-model-prediction-of-cleavage.96de2d3

**Used in:** `frontend/index.html` · Display metadata field

```text
Proteasomal cleavage probability from the pepsickle epitope model, scored from 0 to 1.
```


## index.html.play-pause-in-the-selected.4ed7a3d

**Used in:** `frontend/index.html` · Display tooltip

```text
Play / pause in the selected view
```


## index.html.play-pause-in-the-selected.6dca02b

**Used in:** `frontend/index.html` · Display tooltip

```text
Play / pause in the selected view
```


## index.html.play.4cb4578

**Used in:** `frontend/index.html` · aria-label

```text
Play
```


## index.html.play.7121a75

**Used in:** `frontend/index.html` · aria-label

```text
Play
```


## index.html.plddt.980dcc0

**Used in:** `frontend/index.html` · Display metadata field

```text
pLDDT
```


## index.html.png-rasterisation-failed.58cffbc

**Used in:** `frontend/index.html` · User message

```text
PNG rasterization failed.
```


## index.html.png-rasterisation-failed.7fc190d

**Used in:** `frontend/index.html` · User message

```text
PNG rasterization failed.
```


## index.html.preview-the-top-five-parents.9082824

**Used in:** `frontend/index.html` · Display tooltip

```text
Preview up to eight mimicry parents while moving along the antigen target.
```


## index.html.preview.b99d071

**Used in:** `frontend/index.html` · Display textContent

```text
Preview
```


## index.html.proteinstart-merendmatchblosum.be064d2

**Used in:** `frontend/index.html` · HTML display fragment

```text
<span class="enm">Mimicry Parent</span><span class="ediv"></span><span class="epos l" data-tooltip="Context start: first available residue of the displayed parent context, 1-based and inclusive. CSV Core Start instead locates the 9-mer core.">Start</span><span class="eseq" data-tooltip="Context (27-mer): the retained 9-mer core plus up to nine flanking residues on each side.">27-mer</span><span class="epos r" data-tooltip="Context end: last available residue of the displayed parent context, 1-based and inclusive. CSV Core End instead bounds the 9-mer core.">End</span><span class="ebadge" data-tooltip="Context identity counts identical standard amino acids across 27 positions. Core identity determines inclusion; the Order control determines row order." style="color:var(--mm-faint)">Context</span><span class="enum w-bl" data-tooltip="Sum of BLOSUM62 substitution scores across available resolved positions in the displayed 27-residue context.">BLOSUM62</span>
```


## index.html.proteinwinmatch-covindex-covblosum.1dd4100

**Used in:** `frontend/index.html` · HTML display fragment

```text
<span class="enm">Protein</span><span class="ediv"></span><span class="enum w-sw">Win</span><span class="ediv"></span><span style="width:86px;text-align:center">Match Cov</span><span class="ediv"></span><span style="width:86px;text-align:center">Index Cov</span><span class="ediv"></span><span class="enum w-bl">BLOSUM</span>
```


## index.html.relative-solvent-accessible-surface-area.0613031

**Used in:** `frontend/index.html` · Display metadata field

```text
Relative solvent-accessible surface area calculated with FreeSASA in the selected monomer or dimer model. Colors span 0–1; higher values share the maximum color.
```


## index.html.rsasa.16a735d

**Used in:** `frontend/index.html` · Display metadata field

```text
rSASA
```


## index.html.show-matches-at-the-selected.40063a9

**Used in:** `frontend/index.html` · Display tooltip

```text
Show matches at the selected window, ordered by the Order control.
```


## index.html.show-protein-wide-parents-in.bbc5ae0

**Used in:** `frontend/index.html` · Display tooltip

```text
In Preview, up to 50 mimicry parents from the final ranking race using matches up to the scanner, with eight visible at a time. Compact and Full show the final ranking.
```


## index.html.show-the-modeled-dimer-and.b53b44a

**Used in:** `frontend/index.html` · Display tooltip

```text
Show the modeled dimer, and read surface exposure and rSASA in that context.
```


## index.html.show-the-single-chain-and.ee1b8c8

**Used in:** `frontend/index.html` · Display tooltip

```text
Show the single chain, and read surface exposure and rSASA from the monomer.
```


## index.html.solvent-exposure-estimated-from-the.b577526

**Used in:** `frontend/index.html` · Display metadata field

```text
Exposed residues have rSASA ≥0.25 in the selected monomer or dimer model.
```


## index.html.surface.6a80a12

**Used in:** `frontend/index.html` · Display metadata field

```text
Surface
```


## index.html.target-windows-per-second-playback.8879cf5

**Used in:** `frontend/index.html` · Display tooltip

```text
{{value}} target windows per second.
```

- `{{value}}` ← `WPS*m` (live renderer value; not authored content)

## index.html.text.1760f1c

**Used in:** `frontend/index.html` · HTML display fragment

```text
<span class="identity-primary"></span><span class="identity-secondary"></span>
```


## index.html.text.2132109

**Used in:** `frontend/index.html` · Display textContent

```text
{{value}} / {{N}}
```

- `{{value}}` ← `Math.floor(scan)+1` (live renderer value; not authored content)
- `{{N}}` ← `N` (live renderer value; not authored content)

## index.html.text.2bd7cc6

**Used in:** `frontend/index.html` · Display textContent

```text
{{countLabel}} · {{value}}
```

- `{{countLabel}}` ← `countLabel` (live renderer value; not authored content)
- `{{value}}` ← `window.MimicryRanking.describe(window.MimicryRanking.selection).window` (live renderer value; not authored content)

## index.html.text.361359d

**Used in:** `frontend/index.html` · Display textContent

```text
{{value}}/9
```

- `{{value}}` ← `s[2]` (live renderer value; not authored content)

## index.html.text.6340f16

**Used in:** `frontend/index.html` · Display textContent

```text
{{value}}–{{value2}}
```

- `{{value}}` ← `p+1` (live renderer value; not authored content)
- `{{value2}}` ← `p+K` (live renderer value; not authored content)

## index.html.text.7c73091

**Used in:** `frontend/index.html` · Display textContent

```text
{{value}}×
```

- `{{value}}` ← `m===0.25?"¼":m` (live renderer value; not authored content)

## index.html.text.85e04c5

**Used in:** `frontend/index.html` · Display tooltip

```text
{{primaryLine}} → {{parentLabel}}{{value}}{{value2}}
```

- `{{primaryLine}}` ← `identity.primaryLine` (live renderer value; not authored content)
- `{{parentLabel}}` ← `parentLabel` (live renderer value; not authored content)
- `{{value}}` ← `histDetail?"\n"+histDetail:""` (live renderer value; not authored content)
- `{{value2}}` ← `entry.len?("\nLength: "+entry.len+" AA"):""` (live renderer value; not authored content)

## index.html.text.921e1a8

**Used in:** `frontend/index.html` · HTML display fragment

```text
<span class="identity-primary"></span><span class="identity-secondary"></span>
```


## index.html.text.bd9eea8

**Used in:** `frontend/index.html` · HTML display fragment

```text
<span class="rps"></span><span class="rsq"></span><span class="rpe"></span><span class="rid"></span>
```


## index.html.text.bf59f83

**Used in:** `frontend/index.html` · HTML display fragment

```text
<b>{{value}}</b>
```

- `{{value}}` ← `tr[li].label` (live renderer value; not authored content)

## index.html.text.f437022

**Used in:** `frontend/index.html` · HTML display fragment

```text
<span class="rps"></span><span class="rsq"></span><span class="rpe"></span><span></span>
```


## index.html.text.f869023

**Used in:** `frontend/index.html` · HTML display fragment

```text
<span class="nl">{{value}}</span>
```

- `{{value}}` ← `Array((compact?K:W27)+1).join("\u00b7")` (live renderer value; not authored content)

## index.html.text.fd518a8

**Used in:** `frontend/index.html` · Display textContent

```text
 · {{counts}}
```

- `{{counts}}` ← `parentSummary.counts` (live renderer value; not authored content)

## index.html.the-figure-changed-while-preparing.292550d

**Used in:** `frontend/index.html` · User message

```text
The figure changed while preparing the export. Please export the current selection again.
```


## index.html.the-figure-fonts-did-not.4820279

**Used in:** `frontend/index.html` · User message

```text
The figure fonts did not finish loading.
```


## index.html.this-browser-cannot-verify-the.aecf552

**Used in:** `frontend/index.html` · User message

```text
This browser cannot verify the figure fonts.
```


## index.html.topology.f3dfff3

**Used in:** `frontend/index.html` · Display metadata field

```text
Topology
```


## index.html.unable-to-load-for-export.5e21300

**Used in:** `frontend/index.html` · User message

```text
Unable to load {{family}} for export (HTTP {{status}}).
```

- `{{family}}` ← `face.family` (live renderer value; not authored content)
- `{{status}}` ← `response.status` (live renderer value; not authored content)

## index.html.uniprot-extracellular-transmembrane-and-intracellular.fc814e3

**Used in:** `frontend/index.html` · Display metadata field

```text
UniProt extracellular, transmembrane, and intracellular annotations.
```


## index.html.uniprot-humsavar-missense-variant-classifications.1b7b311

**Used in:** `frontend/index.html` · Display metadata field

```text
UniProt HumSAVAR missense variants, colored by clinical significance: (likely) pathogenic, uncertain significance, or (likely) benign.
```


## index.html.unique.3e1e779

**Used in:** `frontend/index.html` · Display textContent

```text
No Matches
```

Shared glossary term: `no_matches` (edit its label once in terminology.json).


## index.html.unique.a67b351

**Used in:** `frontend/index.html` · Display textContent

```text
No Matches
```

Shared glossary term: `no_matches` (edit its label once in terminology.json).


## index.html.uploaded-sequence-reference-annotation-tracks.d23674c

**Used in:** `frontend/index.html` · Display textContent

```text
Uploaded sequence · reference annotation tracks do not apply
```


## index.html.variants.6a0a126

**Used in:** `frontend/index.html` · Display metadata field

```text
Variants
```


## index.html.wait-for-the-selected-result.648b1ca

**Used in:** `frontend/index.html` · User message

```text
Wait for the selected result to finish, or cancel before exporting.
```


## index.html.window.aeacab4

**Used in:** `frontend/index.html` · Display textContent

```text
Window
```

Shared glossary term: `window` (edit its label once in terminology.json).


## player.alphafold-per-residue-model-confidence.b9d3bfd

**Used in:** `frontend/index.html` · Player data-tooltip

```text
AlphaFold per-residue structural confidence (pLDDT), scored from 0 to 100.
```


## player.an-atlas-of-human.3352a78

**Used in:** `frontend/index.html` · Player/controls visible text

```text
An Atlas of Human
```


## player.antigen-target-and-mimicry-parents.dda272b

**Used in:** `frontend/index.html` · Player aria-label

```text
Antigen Target and Mimicry Parents plot
```


## player.antigen-target-fasta.5886b38

**Used in:** `frontend/index.html` · Player aria-label

```text
Antigen Target FASTA
```


## player.assembly-context.3c19bc8

**Used in:** `frontend/index.html` · Player aria-label

```text
Assembly context
```


## player.benign.6fb4f18

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Benign
```


## player.buried.c574eff

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Buried
```


## player.choose-an-antigen-target-and.4c43620

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Choose an antigen target and a mimicry parent library to compare.
```


## player.choose-fasta.1000ebb

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Choose FASTA
```


## player.choose-fasta.4abefa0

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Choose FASTA
```


## player.choose-mimicry-parent-library.b0af3b2

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Choose Mimicry Parent:
```


## player.clear-inputs.903b0eb

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Clear inputs
```


## player.clear.076030b

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Clear
```


## player.clear.a7fd141

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Clear
```


## player.cleavage.ca89c90

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Cleavage
```


## player.color-theme.baf0f4a

**Used in:** `docs/public/navigation.html` · Player aria-label

```text
Color theme
```


## player.compare-your-antigen-target-sequences.722761a

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Compare one antigen target with a served library or your own parent FASTA. The analysis runs in this browser.
```


## player.current-figure.15d5c03

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Current figure:
```


## player.current-selection-data.b8106d6

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Current selection data:
```


## player.custom-fasta.8d6eaf7

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Custom FASTA
```


## player.custom-minimum-identity.402ef58

**Used in:** `frontend/index.html` · Player aria-label

```text
Custom minimum Core Identity
```


## player.custom-sequence.ca7ec3a

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Custom sequence
```


## player.dark-mode.71508c2

**Used in:** `docs/public/navigation.html` · Player aria-label

```text
Dark mode
```


## player.dark-mode.eacd5ae

**Used in:** `docs/public/navigation.html` · Player data-tooltip

```text
Dark mode
```


## player.density.cba3682

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Density
```


## player.displayed-panel.5ac2734

**Used in:** `frontend/index.html` · Player aria-label

```text
Displayed panel
```


## player.download-a-png-of-the.925ccb4

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Download a PNG of the current figure. Playback pauses to capture the selected frame.
```


## player.download-all-matching-window-pairs.d8fd0ff

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Matching target–parent window pairs across the target at the selected core identity threshold.
```


## player.download-all-ranked-parent-records.7eaf481

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Ranked matching parents, with coverage and match counts for the current comparison.
```


## player.download-an-svg-of-the.29a13d1

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Download an SVG of the current figure with embedded fonts. Playback pauses to capture the selected frame.
```


## player.download-browser-local-custom-runs.cbb4599

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Download custom analyses retained in this browser session.
```


## player.download-the-complete-result-and.680433b

**Used in:** `frontend/index.html` · Player data-tooltip

```text
A ready-to-run pipeline ZIP with the current comparison’s sequences, settings and supporting record metadata.
```


## player.exact.ea7dad9

**Used in:** `frontend/index.html` · Player/controls visible text

```text
9/9 exact
```


## player.example-and-recently-opened-antigen.aea4d63

**Used in:** `frontend/index.html` · Player aria-label

```text
Example and recently opened Antigen Target to Mimicry Parent comparisons
```


## player.example-comparison-sources.6e65ebf

**Used in:** `frontend/index.html` · Player aria-label

```text
Example comparison sources
```


## player.explore-the-atlas.724d1a2

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Explore the Atlas
```


## player.exposed.9c5abe8

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Exposed
```


## player.extracellular.eb2113e

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Extracellular
```


## player.find-antigen-target.7f1f4a9

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Gene, accession, description, etc.
```


## player.gene-accession-virus-or-exposure.c7c541c

**Used in:** `frontend/index.html` · Player placeholder

```text
Gene, accession, description, etc.
```


## player.high.5e137e1

**Used in:** `frontend/index.html` · Player/controls visible text

```text
High
```


## player.high.65c7737

**Used in:** `frontend/index.html` · Player/controls visible text

```text
High
```


## player.high.d8354f1

**Used in:** `frontend/index.html` · Player/controls visible text

```text
High
```


## player.history.65b8a4b

**Used in:** `frontend/index.html` · Player/controls visible text

```text
History
```


## player.hormones.86704a1

**Used in:** `frontend/index.html` · Player/controls visible text

```text
 hormones
```


## player.human-proteins.936962c

**Used in:** `frontend/index.html` · Player/controls visible text

```text
 human proteins
```


## player.human.de7554d

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Human
```


## player.humsavar-clinical-missense-classifications-shown.8a76b8d

**Used in:** `frontend/index.html` · Player data-tooltip

```text
UniProt HumSAVAR missense variants: (likely) pathogenic, uncertain significance, or (likely) benign.
```


## player.intracellular.a55084f

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Intracellular
```


## player.legacy-mimicry-parent-collection.721c2a4

**Used in:** `frontend/index.html` · Player aria-label

```text
Legacy Mimicry Parent collection
```


## player.light-mode.1cd2caf

**Used in:** `docs/public/navigation.html` · Player aria-label

```text
Light mode
```


## player.light-mode.2249a42

**Used in:** `docs/public/navigation.html` · Player data-tooltip

```text
Light mode
```


## player.local-runs.ccd18f0

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Local runs
```


## player.low.592a452

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Low
```


## player.low.6cde899

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Low
```


## player.low.f24e0fc

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Low
```


## player.lower-thresholds-include-more-matches.dfcd35b

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Lower thresholds include more matches and take longer to compute in this browser.
```


## player.main-track-color-direction-lit.51db27f

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Main track color direction. Lit is standard: the hot end marks what is most shared. Unlit inverts it, so the hot end marks what nothing else covers at this threshold. Affects the main track and its exports only; every other lane keeps its own scale.
```


## player.main-track-color-direction-standard.91bf8a7

**Used in:** `frontend/index.html` · Player aria-label

```text
Main track color direction: standard. Activate to invert.
```


## player.map-sequence-resemblance-across-human.6c208b5

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Map antigen-specific sequence resemblance within and across proteomes.
```


## player.matches-csv.92fd5c2

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Matches CSV
```


## player.mer-context.28ed164

**Used in:** `frontend/index.html` · Player/controls visible text

```text
27-mer context
```


## player.mer-core.c6b3628

**Used in:** `frontend/index.html` · Player/controls visible text

```text
9-mer core
```


## player.mimicry-parent-fasta.511387e

**Used in:** `frontend/index.html` · Player aria-label

```text
Mimicry Parent FASTA
```


## player.mimicryone-molecular-mimicry-atlas.b16a457

**Used in:** `frontend/index.html` · Browser tab title. Markers must wrap the title element, never appear inside its text.

```text
<title>MimicryMap | Molecular Mimicry Atlas</title>
```


## player.min-identity.3022298

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Identity ≥
```

Shared glossary term: `min_identity` (edit its label once in terminology.json).


## player.min-identity.ed38ba8

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Identity ≥
```

Shared glossary term: `min_identity` (edit its label once in terminology.json).


## player.minimum-window-identity.7539b9f

**Used in:** `frontend/index.html` · Player aria-label

```text
Minimum Core Identity
```


## player.molecular-mimicry.6c45066

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Molecular Mimicry
```


## player.motif-event-pagination.6c65b9f

**Used in:** `frontend/index.html` · Player aria-label

```text
Core Window Matches pagination
```


## player.motifs-at-this-window.cbc2efe

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Core Window Matches
```

Shared glossary term: `core_window_matches` (edit its label once in terminology.json).


## player.move-one-residue-toward-the.97c0695

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Move one residue toward the end of the target.
```


## player.move-one-residue-toward-the.eebbea5

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Move one residue toward the start of the target.
```


## player.my-antigen-merrlvvtlqclvllylapecggtdqcdnfpqmlrdlrdafsrvktffq-my-antigen.c9a0f91

**Used in:** `frontend/index.html` · Player placeholder

```text
>my_parent_1
MERRLVVTLQCLVLLYLAPECGGTDQCDNFPQMLRDLRDAFSRVKTFFQ...
>my_parent_2
MSDEGPGTGPGNGLGEKGDTSGPEGSGGSGPQRRGGDNHGRGRGRGRGR...
```


## player.my-target-mhssallcclvlltgvraspgqgtqsenscthfpgnlpnmlrdlrdafsrvktffqmkdqldnlllkeslledfkgy.c180dd3

**Used in:** `frontend/index.html` · Player placeholder

```text
>my_target_1
MHSSALLCCLVLLTGVRASPGQGTQSENSCTHFPGNLPNMLRDLRDAFS...
```


## player.next-window.054b914

**Used in:** `frontend/index.html` · Player aria-label

```text
Next window
```


## player.next.375eb00

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Next
```


## player.non-human-exposures.9f2c4d9

**Used in:** `frontend/index.html` · Player/controls visible text

```text
 non-human exposures
```


## player.non-human.20151f0

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Non-human
```


## player.one-source.d5c626a

**Used in:** `frontend/index.html` · Player/controls visible text

```text
One source
```


## player.overall-mimicry-parents.7ef973a

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Overall Mimicry Parents
```


## player.page-of.e935d06

**Used in:** `frontend/index.html` · Player/controls visible text

```text
page 0 of 0
```


## player.parent-lane-window-identity-dark.878ec39

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Core identity in the mimicry parent lanes: 30% opacity for 5/9, increasing to full opacity for 9/9. Density uses a separate scale.
```


## player.parents-csv.f0c199a

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Parents CSV
```


## player.paste-one-or-more-fasta.ed5664a

**Used in:** `frontend/index.html` · Player/controls visible text

```text
One target per run; additional records are skipped.
```


## player.paste-or.46f01d7

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Paste or
```


## player.paste-or.d276ad3

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Paste or
```


## player.pathogenic.646a97d

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Pathogenic
```


## player.pause.6b012ba

**Used in:** `frontend/index.html` · Player aria-label

```text
Pause
```


## player.pepsickle-model-prediction-of-cleavage.e8cce4d

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Proteasomal cleavage probability from the pepsickle epitope model, scored from 0 to 1.
```


## player.play-pause.4e8cd9b

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Play / pause
```


## player.playback.68431c6

**Used in:** `frontend/index.html` · Player aria-label

```text
Playback
```


## player.plddt.18d87ef

**Used in:** `frontend/index.html` · Player/controls visible text

```text
pLDDT
```


## player.png.5bc0ccb

**Used in:** `frontend/index.html` · Player/controls visible text

```text
PNG
```


## player.positional-events.49b3cc3

**Used in:** `frontend/index.html` · Player/controls visible text

```text
0 Window Pairs
```


## player.predicted-solvent-exposure-from-relative.c927f0b

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Exposed residues have rSASA ≥0.25 in the selected monomer or dimer model.
```


## player.previous-window.1e2135e

**Used in:** `frontend/index.html` · Player aria-label

```text
Previous window
```


## player.previous.5b4bc70

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Previous
```


## player.relative-solvent-accessible-surface-area.5f2273e

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Relative solvent-accessible surface area calculated with FreeSASA. Colors span 0–1; higher values share the maximum color.
```


## player.required-identical-positions-in-an.893a01d

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Required identical positions in an aligned nine-residue window. Every threshold runs on this device; the lower ones match more and take longer.
```


## player.required-identical-positions-in-each.2d58179

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Minimum number of identical positions required in each aligned nine-residue window.
```


## player.result-json.e2a9217

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Current Comparison
```


## player.rsasa.aa31234

**Used in:** `frontend/index.html` · Player/controls visible text

```text
rSASA
```


## player.run-analysis.5879189

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Run analysis
```


## player.search-the-complete-protein-catalog.d98211a

**Used in:** `frontend/index.html` · Player aria-label

```text
Search the complete protein catalog
```


## player.sequence-matches-at-the-selected.397c6ca

**Used in:** `frontend/index.html` · Player data-tooltip

```text
Qualifying target–parent core matches at the selected target window.
```


## player.session.1c653a5

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Session:
```


## player.shared-by.23d955f

**Used in:** `frontend/index.html` · Player/controls visible text

```text
 Matches
```


## player.sort-window-matches.b9ce74e

**Used in:** `frontend/index.html` · Player aria-label

```text
Order window matches
```


## player.sort.67e0d95

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Order
```


## player.sources.1880a57

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Sources
```


## player.speed.82da045

**Used in:** `frontend/index.html` · Player aria-label

```text
Speed
```


## player.structure.7ccdedc

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Structure
```


## player.supply-antigen-target-sequences.be9c736

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Supply an Antigen Target Sequence:
```


## player.surface.fcfad82

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Surface
```


## player.svg.1638575

**Used in:** `frontend/index.html` · Player/controls visible text

```text
SVG
```


## player.swipe-within-the-plot-or.4c51ce7

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Swipe within the plot or tables to see all columns. Tap a label for details.
```


## player.the-nine-residue-comparison-window.00e5fa4

**Used in:** `frontend/index.html` · Player data-tooltip

```text
The nine-residue comparison window plus up to nine flanking residues on each side. Dots indicate positions beyond the sequence boundary.
```


## player.the-nine-residue-comparison-window.5439c61

**Used in:** `frontend/index.html` · Player data-tooltip

```text
The outlined nine-residue comparison window.
```


## player.topology.1cfebe5

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Topology
```


## player.tracks.2046eea

**Used in:** `frontend/index.html` · Player aria-label

```text
Tracks
```


## player.tracks.28601a7

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Tracks
```


## player.transmembrane.31aaadc

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Transmembrane
```


## player.uncertain.3cfe018

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Uncertain
```


## player.uniprot-residue-topology-categories-shown.51d1aba

**Used in:** `frontend/index.html` · Player data-tooltip

```text
UniProt residue topology categories shown on the active topology track.
```


## player.unique.9edda36

**Used in:** `frontend/index.html` · Player/controls visible text

```text
No Matches
```

Shared glossary term: `no_matches` (edit its label once in terminology.json).


## player.variants.61cad6c

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Variants
```


## player.view.8be4471

**Used in:** `frontend/index.html` · Player aria-label

```text
View
```


## player.view.fffe9c5

**Used in:** `frontend/index.html` · Player/controls visible text

```text
View
```


## player.viral-proteomes.61afa8b

**Used in:** `frontend/index.html` · Player/controls visible text

```text
 viral proteomes
```


## player.virus.5760d60

**Used in:** `frontend/index.html` · Player aria-label

```text
Virus
```


## player.window-identity.1ac492f

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Core Identity
```

Shared glossary term: `core_identity` (edit its label once in terminology.json).


## player.window-match-sorting.b207129

**Used in:** `frontend/index.html` · Player aria-label

```text
Window match sorting
```


## player.your-custom-analysis.8702e18

**Used in:** `frontend/index.html` · Player/controls visible text

```text
Your Custom Analysis
```


## method-figure.merged-mer-frequency-logo.cf4324d

**Used in:** `frontend/method-figure.js` · Figure/canvas label

```text
Merged 27-mer Frequency Logo
```


## method-figure.missing-diagram-copy-value.6e54067

**Used in:** `frontend/method-figure.js` · User message

```text
Missing diagram copy value: {{key}}
```

- `{{key}}` ← `key` (live renderer value; not authored content)

## method-figure.missing-public-diagram-copy.6b4b0f6

**Used in:** `frontend/method-figure.js` · User message

```text
Missing public diagram copy: {{key}}
```

- `{{key}}` ← `key` (live renderer value; not authored content)

## method-figure.text.d66e716

**Used in:** `frontend/method-figure.js` · HTML display fragment

```text
<div class="method-step-copy"><h4 id="{{id}}-title">{{n}} · {{title}}</h4><div class="method-equation" id="{{id2}}-formula">{{equations}}</div><div class="method-caption" id="{{id3}}-caption"></div></div><div class="method-diagram"><svg viewBox="0 0 400 {{height}}" role="img" aria-labelledby="{{id4}}-title" aria-describedby="{{id5}}-formula {{id6}}-caption">{{svg}}</svg></div>
```

- `{{id}}` ← `id` (live renderer value; not authored content)
- `{{n}}` ← `n+1` (live renderer value; not authored content)
- `{{title}}` ← `title` (live renderer value; not authored content)
- `{{id2}}` ← `id` (live renderer value; not authored content)
- `{{equations}}` ← `equations` (live renderer value; not authored content)
- `{{id3}}` ← `id` (live renderer value; not authored content)
- `{{height}}` ← `height` (live renderer value; not authored content)
- `{{id4}}` ← `id` (live renderer value; not authored content)
- `{{id5}}` ← `id` (live renderer value; not authored content)
- `{{id6}}` ← `id` (live renderer value; not authored content)
- `{{svg}}` ← `svg` (live renderer value; not authored content)

## mimicryone-runtime.a-local-worker-request-is.eb30b1a

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
A local worker request is already running.
```


## mimicryone-runtime.antigen-target.20a1587

**Used in:** `frontend/mimicryone-runtime.js` · Display metadata field

```text
Antigen Target
```

Shared glossary term: `antigen_target` (edit its label once in terminology.json).


## mimicryone-runtime.bearing-a-hit-at-complete.196d2a1

**Used in:** `frontend/mimicryone-runtime.js` · Display tooltip

```text
{{value}} {{entityLabel}} bearing a hit at ≥{{TH}}/9. Complete result; pagination does not change this total.
```

- `{{value}}` ← `nf(all.length)` (live renderer value; not authored content)
- `{{entityLabel}}` ← `entityLabel` (live renderer value; not authored content)
- `{{TH}}` ← `TH` (live renderer value; not authored content)

## mimicryone-runtime.best-context.2e8a23c

**Used in:** `frontend/mimicryone-runtime.js` · Player summary column label

```text
Best Context
```

Shared glossary term: `best_context` (edit its label once in terminology.json).


## mimicryone-runtime.best-core.c3950ee

**Used in:** `frontend/mimicryone-runtime.js` · Player summary column label

```text
Best Core
```

Shared glossary term: `best_core` (edit its label once in terminology.json).


## mimicryone-runtime.cancel.32abb4b

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Cancel
```


## mimicryone-runtime.cancel.3ed2bc7

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Cancel
```


## mimicryone-runtime.canceled.3d2e54b

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Canceled.
```


## mimicryone-runtime.canceled.496755b

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Canceled.
```


## mimicryone-runtime.canceled.cb3705c

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Canceled.
```


## mimicryone-runtime.checking.44bf9fb

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Checking…
```


## mimicryone-runtime.clear-inputs.e3972a3

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Clear inputs
```


## mimicryone-runtime.clear-the-fasta-inputs-the.661ae39

**Used in:** `frontend/mimicryone-runtime.js` · Display tooltip

```text
Clear the FASTA inputs; the result currently shown in the main stage is retained.
```


## mimicryone-runtime.compact-input-page-references-a.b724c77

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Compact input page references a missing annotation.
```


## mimicryone-runtime.continue-locally.afb7421

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Continue locally
```


## mimicryone-runtime.duplicate-record-in-the-input.feafa30

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Duplicate record in the input population download.
```


## mimicryone-runtime.export-module-unavailable-reload-the.acd6483

**Used in:** `frontend/mimicryone-runtime.js` · aria-label

```text
Export module unavailable; reload the page.
```


## mimicryone-runtime.full-export-canvas-exceeds-browser.86fd281

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Full export canvas exceeds browser limits
```


## mimicryone-runtime.http.9f505cb

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
HTTP {{status}}
```

- `{{status}}` ← `response.status` (live renderer value; not authored content)

## mimicryone-runtime.human.07b646b

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Human
```


## mimicryone-runtime.imported-identity-must-be-between.d5300d4

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported core identity must be between 5 and 9.
```


## mimicryone-runtime.imported-native-assets-lack-an.4f3a1bf

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported native assets lack an exact coordinate-safe crosswalk.
```


## mimicryone-runtime.imported-native-track-alias-does.a1d0ac3

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported native track alias does not match its exact crosswalk.
```


## mimicryone-runtime.imported-portable-annotation-identity-is.30738e5

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported portable annotation identity is inconsistent with protein_id.
```


## mimicryone-runtime.imported-positional-hit-is-malformed.de5b96f

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported positional hit is malformed.
```


## mimicryone-runtime.imported-positional-source-is-absent.f14278a

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported positional source is absent from source_catalog.
```


## mimicryone-runtime.imported-query-coordinate-is-outside.b464289

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported antigen target coordinate is outside the sequence.
```


## mimicryone-runtime.imported-query-sequence-length-does.40e35ad

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported antigen target sequence length does not match protein.length.
```


## mimicryone-runtime.imported-ranked-source-is-absent.0c4e951

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported ranked source is absent from source_catalog.
```


## mimicryone-runtime.imported-result-does-not-expose.6070a05

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported result does not expose its active floor.
```


## mimicryone-runtime.imported-result-lacks-its-query.dc04635

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported result lacks its antigen target identity or sequence.
```


## mimicryone-runtime.imported-result-lacks-native-catalog.f96ba1d

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported result lacks native catalog, ranked, or positional arrays.
```


## mimicryone-runtime.imported-source-catalog-must-contain.c8ee51f

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported source_catalog must contain exactly referenced result sources.
```


## mimicryone-runtime.imported-source-catalog-must-retain.4d107ac

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported source catalog must retain full SeqID and header fields.
```


## mimicryone-runtime.imported-source-coordinate-is-outside.739142b

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported mimicry parent coordinate is outside the sequence.
```


## mimicryone-runtime.imported-source-protein-idx-values.a77d49a

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported source protein_idx values must be unique numbers.
```


## mimicryone-runtime.imported-source-sequence-length-does.07ed8b1

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported mimicry parent sequence length does not match its catalog length.
```


## mimicryone-runtime.imported-structure-alias-does-not.6245994

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported structure alias does not match its exact crosswalk.
```


## mimicryone-runtime.input-download-stopped-http-no.bae0e1f

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Input download stopped (HTTP {{status}}). No partial result was produced.
```

- `{{status}}` ← `response.status` (live renderer value; not authored content)

## mimicryone-runtime.input-pagination-did-not-advance.be822be

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Input pagination did not advance.
```


## mimicryone-runtime.inspect.eb8e002

**Used in:** `frontend/mimicryone-runtime.js` · aria-label

```text
Inspect {{value}}. {{value2}}
```

- `{{value}}` ← `rowNode.getAttribute("data-display") || rowNode.getAttribute("data-protein")` (live renderer value; not authored content)
- `{{value2}}` ← `rowNode.getAttribute("data-tooltip") || ""` (live renderer value; not authored content)

## mimicryone-runtime.mimicry-parent-source.eda3a8d

**Used in:** `frontend/mimicryone-runtime.js` · aria-label

```text
Mimicry Parent source
```


## mimicryone-runtime.mimicry-parent.92a7f56

**Used in:** `frontend/mimicryone-runtime.js` · Display metadata field

```text
Mimicry Parent
```

Shared glossary term: `mimicry_parent` (edit its label once in terminology.json).


## mimicryone-runtime.mimicryone-openresult-requires-schema.e05eb1a

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Imported results require schema {{RESULT_SCHEMA}}.
```

- `{{RESULT_SCHEMA}}` ← `RESULT_SCHEMA` (live renderer value; not authored content)

## mimicryone-runtime.mimicryone-shared-protein-identity-resolver.523496f

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
MimicryMap shared protein identity resolver is unavailable.
```


## mimicryone-runtime.no-completed-comparison-is-available.bd86ee7

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
No completed comparison is available for export.
```


## mimicryone-runtime.no-matching-protein.1bf2e69

**Used in:** `frontend/mimicryone-runtime.js` · HTML display fragment

```text
<div class="catalogue-no-match">No matching protein</div>
```


## mimicryone-runtime.non-human.54df020

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Non-human
```


## mimicryone-runtime.one-source.aba64b9

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
One source
```


## mimicryone-runtime.parent.fe290c2

**Used in:** `frontend/mimicryone-runtime.js` · Player summary column label

```text
Parent %
```


## mimicryone-runtime.previous-result-remains-visible.403abac

**Used in:** `frontend/mimicryone-runtime.js` · aria-label

```text
Previous result remains visible. {{value}}
```

- `{{value}}` ← `String(failureMessage)` (live renderer value; not authored content)

## mimicryone-runtime.protein.f484089

**Used in:** `frontend/mimicryone-runtime.js` · Player summary column label

```text
Mimicry Parent
```

Shared glossary term: `mimicry_parent` (edit its label once in terminology.json).


## mimicryone-runtime.records-at.8438b33

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
{{value}} {{unit}} at ≥{{TH}}/9 · {{value2}}
```

- `{{value}}` ← `nf(all.length)` (live renderer value; not authored content)
- `{{TH}}` ← `TH` (live renderer value; not authored content)
- `{{value2}}` ← `scopeLabel(result.parameters.source_scope)` (live renderer value; not authored content)
- `{{unit}}` ← `/exact.*sequence.*group/i.test(entityLabel)?'Matching Exact-Sequence Groups':'Matching Records'` (live renderer value; not authored content)

## mimicryone-runtime.run-analysis.8778e7d

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Run analysis
```


## mimicryone-runtime.run-analysis.cad093c

**Used in:** `frontend/mimicryone-runtime.js` · Display textContent

```text
Run analysis
```


## mimicryone-runtime.selection-changed-while-loading-the.eca0356

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Selection changed while loading the structure; export again.
```


## mimicryone-runtime.structure-export-could-not-be.944f75d

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Structure export could not be loaded (HTTP {{status}}).
```

- `{{status}}` ← `response.status` (live renderer value; not authored content)

## mimicryone-runtime.target.02b6624

**Used in:** `frontend/mimicryone-runtime.js` · Player summary column label

```text
Target %
```


## mimicryone-runtime.the-indexed-sequence-is-unavailable.3019fde

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The indexed sequence is unavailable.
```


## mimicryone-runtime.the-input-endpoint-returned-a.5b580ff

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The input endpoint returned a candidate shortlist, not the complete selected population. A complete lower-threshold result requires the full population.
```


## mimicryone-runtime.the-input-endpoint-returned-a.f4aa379

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The input endpoint returned a different record than the one selected.
```


## mimicryone-runtime.the-input-population-download-is.f50d92a

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The input population download is incomplete; no partial result was produced.
```


## mimicryone-runtime.the-input-scope-changed-while.bf60c1b

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The input scope changed while downloading. Restart the request.
```


## mimicryone-runtime.the-selected-mimicry-parent-set.1f43e23

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The selected mimicry parent set contains no sequences of at least 9 residues.
```


## mimicryone-runtime.the-selected-mimicry-parent-source.816b9be

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The selected mimicry parent source contains no sequences.
```


## mimicryone-runtime.the-selected-target-record-could.884c942

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The selected target record could not be read from this release.
```


## mimicryone-runtime.the-selected-target-sequence-was.444b922

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The selected target sequence was not supplied by the input endpoint.
```


## mimicryone-runtime.unable-to-allocate-full-export.445fa70

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Unable to allocate Full export canvas
```


## mimicryone-runtime.unexpected-local-input-schema.f82fb9f

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Unexpected local-input schema.
```


## mimicryone-runtime.unsupported-threshold-for-a-browser.a633781

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
Unsupported threshold for a browser-local run.
```


## modification-symbols.acetylation.31f70be

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
Acetylation
```


## modification-symbols.adp-ribosylation.9e5d65c

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
ADP-ribosylation
```


## modification-symbols.amidation.f664680

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
Amidation
```


## modification-symbols.citrullination.49c7820

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
Citrullination
```


## modification-symbols.hydroxylation.82a28e8

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
Hydroxylation
```


## modification-symbols.methylation.9caaf6b

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
Methylation
```


## modification-symbols.multiple-annotations-alternatives.dbe1b83

**Used in:** `frontend/modification-symbols.js` · Display metadata field

```text
Multiple annotations / alternatives
```


## modification-symbols.other-acylation.b6a883e

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
Other acylation
```


## modification-symbols.phosphorylation.9ee29e5

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
Phosphorylation
```


## modification-symbols.sulfation.722aa5b

**Used in:** `frontend/modification-symbols.js` · Modification legend label

```text
Sulfation
```


## publication-exports.all-matches-at-the-current.e15bf8a

**Used in:** `frontend/publication-exports.js` · data-tooltip

```text
Matching target–parent window pairs at the selected target window and core identity threshold.
```


## publication-exports.all-matches-csv.272edf4

**Used in:** `frontend/publication-exports.js` · Display textContent

```text
All matches CSV
```


## publication-exports.all-supported-figure-panels-as.f7071e0

**Used in:** `frontend/publication-exports.js` · data-tooltip

```text
All supported figure panels as SVG and PNG, with highlighted and unhighlighted target tracks and loaded structures.
```


## publication-exports.complete-reproduction-mappings-were-not.08d225d

**Used in:** `frontend/publication-exports.js` · User message

```text
Complete reproduction mappings were not provided.
```


## publication-exports.conflicting-reproduction-parent-metadata.81ec06e

**Used in:** `frontend/publication-exports.js` · User message

```text
Conflicting reproduction parent metadata.
```


## publication-exports.current-window-slice-csv.82bffee

**Used in:** `frontend/publication-exports.js` · Display textContent

```text
Current window slice CSV
```


## publication-exports.data-matches-csvselected-window-csvparents.be4cd00

**Used in:** `frontend/publication-exports.js` · HTML display fragment

```text
<span class="rt">Data:</span><div class="seg"><button id="expWin" type="button" data-tooltip="Matching target–parent window pairs across the target at the selected core identity threshold.">Matches CSV</button><button id="expSite" type="button" data-tooltip="Matching target–parent window pairs at the selected target window and core identity threshold.">Selected window CSV</button><button id="expRank" type="button" data-tooltip="Ranked matching parents, with coverage and match counts for the current comparison.">Parents CSV</button><button id="expSummary" type="button" data-tooltip="One target row with coverage, unique-window regions and partner lists for the selected comparison and identity threshold.">Summary CSV</button></div><span class="rt">Code:</span><div class="seg"><button id="reproBtn" type="button" data-tooltip="A ready-to-run pipeline ZIP with the current comparison’s sequences, settings and supporting record metadata.">Current Comparison</button></div><span class="rt">Figure:</span><select id="exportPanel" aria-label="Figure panel"><option value="combined">Target + tables</option><option value="target">Target tracks</option><option value="window">Window matches</option><option value="parents">Overall parents</option><option value="structure">Structure</option></select><label class="export-highlight"><input id="exportHighlight" type="checkbox" checked> Site highlight</label><label>Rows <select id="exportRows" aria-label="Figure table rows"><option>5</option><option selected>10</option><option>20</option><option>50</option></select></label><div class="seg"><button id="expSvg" type="button">SVG</button><button id="expPng" type="button">PNG</button></div><button id="exportCancel" type="button" data-tooltip="Cancel preparation of this download." hidden>Cancel export</button><span id="exportStatus" role="status" aria-live="polite" aria-atomic="true" hidden><span>Preparing<span class="export-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></span></span>
```


## publication-exports.duplicate-input-page-record.b6fabb6

**Used in:** `frontend/publication-exports.js` · User message

```text
Duplicate input page record.
```


## publication-exports.export-input-unavailable-http.2c0918c

**Used in:** `frontend/publication-exports.js` · User message

```text
Export input unavailable (HTTP {{status}}).
```

- `{{status}}` ← `r.status` (live renderer value; not authored content)

## publication-exports.figure-bundle.0170c12

**Used in:** `frontend/publication-exports.js` · Display textContent

```text
Figure bundle
```


## publication-exports.input-endpoint-returned-a-hit.20fe549

**Used in:** `frontend/publication-exports.js` · User message

```text
Input endpoint returned a hit shortlist, not the full population.
```


## publication-exports.input-pagination-did-not-advance.4f5514e

**Used in:** `frontend/publication-exports.js` · User message

```text
Input pagination did not advance.
```


## publication-exports.input-scope-changed-while-downloading.2b628df

**Used in:** `frontend/publication-exports.js` · User message

```text
Input scope changed while downloading.
```


## publication-exports.png-encoding-failed.3397749

**Used in:** `frontend/publication-exports.js` · User message

```text
PNG encoding failed.
```


## publication-exports.reproduction-mappings-do-not-cover.2b6cb09

**Used in:** `frontend/publication-exports.js` · User message

```text
Reproduction mappings do not cover the downloaded population.
```


## publication-exports.reproduction-query-mapping-changed-during.16c2c83

**Used in:** `frontend/publication-exports.js` · User message

```text
Reproduction query mapping changed during download.
```


## publication-exports.the-parent-population-download-is.eaf3f6d

**Used in:** `frontend/publication-exports.js` · User message

```text
The parent population download is incomplete.
```


## publication-exports.this-bundle-exceeds-the-zip.8ac81e7

**Used in:** `frontend/publication-exports.js` · User message

```text
This bundle exceeds the ZIP size supported in this browser. Export smaller scopes.
```


## publication-exports.this-comparison-does-not-retain.fc63d63

**Used in:** `frontend/publication-exports.js` · User message

```text
This comparison does not retain a complete portable parent population. CSV and figure exports remain available; no incomplete pipeline package was produced.
```


## publication-exports.unable-to-allocate-png-canvas.4300d97

**Used in:** `frontend/publication-exports.js` · User message

```text
Unable to allocate PNG canvas
```


## release-provenance.exposure-counts-do-not-match.5feed13

**Used in:** `frontend/release-provenance.js` · User message

```text
Exposure counts do not match the running release
```


## release-provenance.no-source-version-is-asserted.b651bcf

**Used in:** `frontend/release-provenance.js` · Display textContent

```text
{{message}}. No source version is asserted for this session.
```

- `{{message}}` ← `error.message` (live renderer value; not authored content)

## release-provenance.source-counts-do-not-match.7ea6685

**Used in:** `frontend/release-provenance.js` · User message

```text
Source counts do not match the running release
```


## release-provenance.source-information-does-not-match.1146e90

**Used in:** `frontend/release-provenance.js` · User message

```text
Source information does not match the running release
```


## release-provenance.source-information-unavailable.b3827f2

**Used in:** `frontend/release-provenance.js` · User message

```text
Source information unavailable
```


## release-provenance.source-membership-counts-do-not.f60946d

**Used in:** `frontend/release-provenance.js` · User message

```text
Source membership counts do not match the running release
```


## export-core.a-hit-bearing-parent-has.b524e4a

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
A hit-bearing parent has no positional export data.
```


## export-core.a-loaded-structure-is-required.4a89902

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
A loaded structure is required for this panel.
```


## export-core.a-presentation-cache-cannot-be.3ca3bd0

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
A presentation cache cannot be exported as complete data.
```


## export-core.aa-window.e11eeef

**Used in:** `frontend/reproduce/export-core.js` · Figure heading

```text
{{length}} AA · {{windows}} Window{{value}} · ≥{{floor}}/9 · {{value2}}
```

- `{{length}}` ← `p.sequence.length` (live renderer value; not authored content)
- `{{windows}}` ← `windows` (live renderer value; not authored content)
- `{{value}}` ← `windows===1?'':'s'` (live renderer value; not authored content)
- `{{floor}}` ← `snapshot.floor` (live renderer value; not authored content)
- `{{value2}}` ← `snapshot.scope_label||snapshot.result.parameters.source_scope_label||snapshot.result.parameters.source_scope` (live renderer value; not authored content)

## export-core.antigen-target-context-core.23d98fb

**Used in:** `frontend/reproduce/export-core.js` · Figure heading

```text
Antigen Target Context {{range_start}}–{{range_end}} · Core {{core_start}}–{{core_end}}
```

- `{{range_start}}` ← `crop.range_start` (live renderer value; not authored content)
- `{{range_end}}` ← `crop.range_end` (live renderer value; not authored content)
- `{{core_start}}` ← `crop.core_start` (live renderer value; not authored content)
- `{{core_end}}` ← `crop.core_end` (live renderer value; not authored content)

## export-core.antigen-target-context.4d3b42e

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
Antigen Target Context
```


## export-core.antigen-target-residues-of.0004f63

**Used in:** `frontend/reproduce/export-core.js` · Figure heading

```text
Antigen Target Residues {{value}}–{{to}} of {{length}}
```

- `{{value}}` ← `from+1` (live renderer value; not authored content)
- `{{to}}` ← `to` (live renderer value; not authored content)
- `{{length}}` ← `p.sequence.length` (live renderer value; not authored content)

## export-core.best-context.1dc6863

**Used in:** `frontend/reproduce/export-core.js` · Export figure column label

```text
Best Context
```

Shared glossary term: `best_context` (edit its label once in terminology.json).


## export-core.best-core.d894396

**Used in:** `frontend/reproduce/export-core.js` · Export figure column label

```text
Best Core
```

Shared glossary term: `best_core` (edit its label once in terminology.json).


## export-core.blosum.85331be

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
BLOSUM62
```


## export-core.c-terminal.c97c523

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
C-Terminal
```


## export-core.context.261cea0

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Context
```


## export-core.context.73798b4

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Context
```


## export-core.context.adb61a2

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Context
```


## export-core.context.e8e0fa1

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Context
```


## export-core.core-window-matches-of.361dae1

**Used in:** `frontend/reproduce/export-core.js` · Figure heading

```text
Core Window Matches · {{selected_start}}–{{value}} · {{value2}} of {{length}} {{value3}}
```

- `{{selected_start}}` ← `snapshot.viewState.selected_start` (live renderer value; not authored content)
- `{{value}}` ← `snapshot.viewState.selected_start+8` (live renderer value; not authored content)
- `{{value2}}` ← `offset?'Rows '+(offset+1)+'–'+Math.min(offset+s.rows,site.length):'Top '+Math.min(s.rows,site.length)` (live renderer value; not authored content)
- `{{length}}` ← `site.length` (live renderer value; not authored content)
- `{{value3}}` ← `site.length===1?'Window Pair':'Window Pairs'` (live renderer value; not authored content)

## export-core.core.5250cd7

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Core
```


## export-core.core.6e1abcd

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Core
```


## export-core.duplicate-coordinate-pair.8262412

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
Duplicate coordinate pair: {{protein_id}} {{key}}
```

- `{{protein_id}}` ← `source.protein_id` (live renderer value; not authored content)
- `{{key}}` ← `key` (live renderer value; not authored content)

## export-core.end.a5519f7

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
End
```


## export-core.export-completeness-check-failed-for.b8ab989

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
Export completeness check failed for {{protein_id}}: positional events disagree with summary.
```

- `{{protein_id}}` ← `source.protein_id` (live renderer value; not authored content)

## export-core.identity.d704868

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Identity
```


## export-core.identity.d92d3a9

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Identity
```


## export-core.invalid-event-coordinates.9f0cfc1

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
Invalid event coordinates.
```


## export-core.mer-identity.20cc708

**Used in:** `frontend/reproduce/export-core.js` · Export figure column label

```text
9-mer Identity
```


## export-core.mer-identity.449a45d

**Used in:** `frontend/reproduce/export-core.js` · Export figure column label

```text
27-mer Identity
```


## export-core.mer.03ccde0

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
27-mer
```


## export-core.mer.58d4200

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
9-mer
```


## export-core.mer.cf23f0f

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
27-mer
```


## export-core.mer.d7b985b

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
9-mer
```


## export-core.mimicry-parent-core-disagrees-with.5869b78

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
Mimicry parent core disagrees with its sequence coordinates.
```


## export-core.mimicry-parent.0efa6b7

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
Mimicry Parent
```

Shared glossary term: `mimicry_parent` (edit its label once in terminology.json).


## export-core.mimicry-parent.10e00b6

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
Mimicry Parent
```

Shared glossary term: `mimicry_parent` (edit its label once in terminology.json).


## export-core.missing-or-duplicate-parent-identity.b5f13e1

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
Missing or duplicate parent identity in export.
```


## export-core.n-terminal.7f32ef1

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
N-Terminal
```


## export-core.no-qualifying-events-at-this.fca5427

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
No qualifying events at this window.
```


## export-core.overall-mimicry-parents-of.6ce2e73

**Used in:** `frontend/reproduce/export-core.js` · Figure heading

```text
Overall Mimicry Parents · {{value}} of {{length}} {{value2}}
```

- `{{value}}` ← `offset?'Rows '+(offset+1)+'–'+Math.min(offset+s.rows,data.parents.length):'Top '+Math.min(s.rows,data.parents.length)` (live renderer value; not authored content)
- `{{length}}` ← `data.parents.length` (live renderer value; not authored content)
- `{{value2}}` ← `/exact.*sequence.*group/i.test(snapshot.result.parameters.source_entity_label||'')?(data.parents.length===1?'Matching Exact-Sequence Group':'Matching Exact-Sequence Groups'):(data.parents.length===1?'Matching Record':'Matching Records')` (live renderer value; not authored content)

## export-core.parent-sequence-is-missing-cannot.be84beb

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
Parent sequence is missing; cannot export the displayed peptide context.
```


## export-core.parent.79bee53

**Used in:** `frontend/reproduce/export-core.js` · Export figure column label

```text
Parent
```


## export-core.residue-colors-and-active-annotation.46f4721

**Used in:** `frontend/reproduce/export-core.js` · Figure heading

```text
Residue colors and active annotation tracks match the captured player. {{value}}
```

- `{{value}}` ← `s.highlight?'Outlines mark the selected 9-mer core and flanking context.':''` (live renderer value; not authored content)

## export-core.residues.2ae8324

**Used in:** `frontend/reproduce/export-core.js` · Export figure column label

```text
Residues (%)
```


## export-core.residues.39ec345

**Used in:** `frontend/reproduce/export-core.js` · Export figure column label

```text
Residues (%)
```


## export-core.start.e4a2fd5

**Used in:** `frontend/reproduce/export-core.js` · Figure column heading

```text
Start
```


## export-core.target.6628056

**Used in:** `frontend/reproduce/export-core.js` · Export figure column label

```text
Target
```


## export-core.text.14dde21

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
{{best_identity}}/9
```

- `{{best_identity}}` ← `row.best_identity` (live renderer value; not authored content)

## export-core.text.5f0727e

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
{{contextMatches}}/27
```

- `{{contextMatches}}` ← `contextMatches` (live renderer value; not authored content)

## export-core.text.acc1f7b

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
{{identity}}/9
```

- `{{identity}}` ← `row.identity` (live renderer value; not authored content)

## export-core.text.bc716f4

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
{{identity}}/27
```

- `{{identity}}` ← `best.identity` (live renderer value; not authored content)

## export-core.text.edf9784

**Used in:** `frontend/reproduce/export-core.js` · Figure/canvas label

```text
{{value}}–{{end}}
```

- `{{value}}` ← `begin+1` (live renderer value; not authored content)
- `{{end}}` ← `end` (live renderer value; not authored content)

## export-core.the-requested-threshold-is-not.3c667ac

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
The requested threshold is not available in this result.
```


## export-core.the-server-did-not-certify.5ec10b7

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
The server did not certify complete positional data.
```


## export-core.the-server-event-total-disagrees.0f8dcc9

**Used in:** `frontend/reproduce/export-core.js` · User message

```text
The server event total disagrees with the received payload.
```


## ranking.best-context-identity.4d7055a

**Used in:** `frontend/reproduce/ranking.js` · Ranking label

```text
Best Context Identity
```


## ranking.best-core-identity.7f98c94

**Used in:** `frontend/reproduce/ranking.js` · Ranking label

```text
Best Core Identity
```


## ranking.context-blosum.809bf49

**Used in:** `frontend/reproduce/ranking.js` · Ranking label

```text
Context BLOSUM62
```

Shared glossary term: `context_blosum62` (edit its label once in terminology.json).


## ranking.context-identity.65c0e81

**Used in:** `frontend/reproduce/ranking.js` · Ranking label

```text
Context Identity
```

Shared glossary term: `context_identity` (edit its label once in terminology.json).


## ranking.core-identity.ea7473a

**Used in:** `frontend/reproduce/ranking.js` · Ranking label

```text
Core Identity
```

Shared glossary term: `core_identity` (edit its label once in terminology.json).


## ranking.parent-coverage.6a111c2

**Used in:** `frontend/reproduce/ranking.js` · Ranking label

```text
Mimicry Parent Coverage
```

Shared glossary term: `parent_coverage` (edit its label once in terminology.json).


## ranking.protein.8b7e452

**Used in:** `frontend/reproduce/ranking.js` · Ranking label

```text
Mimicry Parent
```

Shared glossary term: `mimicry_parent` (edit its label once in terminology.json).


## ranking.target-coverage.2dd5f17

**Used in:** `frontend/reproduce/ranking.js` · Ranking label

```text
Antigen Target Coverage
```

Shared glossary term: `target_coverage` (edit its label once in terminology.json).


## result-extent.a-complete-native-result-is.d48e716

**Used in:** `frontend/result-extent.js` · User message

```text
A complete native result is required; a presentation subset cannot supply these figures.
```


## result-extent.against.bbf1e44

**Used in:** `frontend/result-extent.js` · Figure column heading

```text
{{target_label}} vs {{parent_scope}} · Matching Parents
```

- `{{target_label}}` ← `s.target_label` (live renderer value; not authored content)
- `{{parent_scope}}` ← `s.parent_scope` (live renderer value; not authored content)

## result-extent.complete-positional-columns-are-required.4583aed

**Used in:** `frontend/result-extent.js` · User message

```text
Complete positional columns are required.
```


## result-extent.conflicting-duplicate-event.fde8766

**Used in:** `frontend/result-extent.js` · User message

```text
Conflicting duplicate event.
```


## result-extent.duplicate-source-catalog-identity.80ad5a1

**Used in:** `frontend/result-extent.js` · User message

```text
Duplicate source catalog identity.
```


## result-extent.invalid-complete-threshold-declaration.4f53e16

**Used in:** `frontend/result-extent.js` · User message

```text
Invalid complete-threshold declaration.
```


## result-extent.invalid-positional-event-no-summary.0d3c4a2

**Used in:** `frontend/result-extent.js` · User message

```text
Invalid positional event; no summary was published.
```


## result-extent.matched-complete-current-target-result.f6ce301

**Used in:** `frontend/result-extent.js` · Display textContent

```text
{{target}} → {{scope}} · ≥{{floor}}/9
```

- `{{target}}` ← `summary.target_label` (live renderer value; not authored content)
- `{{scope}}` ← `summary.parent_scope` (live renderer value; not authored content)
- `{{floor}}` ← `summary.floor` (live renderer value; not authored content)

## result-extent.mimicry-parent-residues-covered.cb5aa06

**Used in:** `frontend/result-extent.js` · Display textContent

```text
Mimicry Parent Coverage (%)
```


## result-extent.missing-parent-identity-or-denominator.e629308

**Used in:** `frontend/result-extent.js` · User message

```text
Missing parent identity or denominator.
```


## result-extent.target-window-coverage-is-unavailable.104fa75

**Used in:** `frontend/result-extent.js` · User message

```text
Target window coverage is unavailable for this record.
```


## result-extent.the-selected-threshold-is-not.a65b781

**Used in:** `frontend/result-extent.js` · User message

```text
The selected threshold is not complete in this result.
```


## result-extent.unrecognized-positional-column-schema.02c84aa

**Used in:** `frontend/result-extent.js` · User message

```text
Unrecognized positional column schema.
```


## result-extent.updating-target-summary.630bbf4

**Used in:** `frontend/result-extent.js` · Display textContent

```text
Updating target summary…
```


## source-licenses.reviewed-human-sequences-other-sequence.51edf1e

**Used in:** `frontend/source-licenses.js` · Display textContent

```text
Reviewed Human sequences: {{uniprot_release}} · {{uniprot_release_date}}.
```

- `{{uniprot_release}}` ← `provenance.human.uniprot_release` (live renderer value; not authored content)
- `{{uniprot_release_date}}` ← `provenance.human.uniprot_release_date` (live renderer value; not authored content)

## ranking.coverage-definition

**Used in:** `frontend/reproduce/ranking.js` · Coverage tooltip definition

```text
Target % and Parent % are covered-residue percentages in the antigen target and mimicry parent, respectively: union of qualifying core residues divided by eligible record length. Overlaps count once; context flanks are excluded.
```


## player.custom-target-policy

**Used in:** `frontend/index.html` · Antigen Target input tooltip

```text
One target per browser run. If the pasted text or uploaded file contains multiple FASTA records, only the first record in input order is analyzed. Additional targets are skipped. An invalid first record stops the run; a later record is never substituted. Parent FASTA files may contain many records. Use a local package for multiple targets or larger runs.
```


## player.custom-local-downloads

**Used in:** `frontend/index.html` · Local pipeline download links

```text
<span>Multiple targets or larger runs:</span> <a href="/reproduce/mimicrymap-pipeline.zip" download data-tooltip="Local pipeline with HEPACAM and EBNA1 staged in two editable FASTA files. Run the example, or replace the inputs and settings.">Pipeline ZIP</a> <span aria-hidden="true">·</span> <a href="https://github.com/seromics/mimicrymap" target="_blank" rel="noopener">GitHub</a>
```


## mimicryone-runtime.first-target-ready

**Used in:** `frontend/mimicryone-runtime.js` · Browser first-Target validation notice

```text
{{target}}: first target ready · {{ignored}} additional skipped
```

- `{{target}}` ← `parsed.records[0].protein_id` (live renderer value; not authored content)
- `{{ignored}}` ← `parsed.ignoredRecords` (live renderer value; not authored content)

## atlas-figures.title-collection

**Used in:** `frontend/atlas-figures.js` · Figure title

```text
Human Residue Coverage vs Viral Proteome Length
```


## atlas-figures.title-coverage

**Used in:** `frontend/atlas-figures.js` · Figure title

```text
Human Target Coverage by Genome Position
```


## atlas-figures.sequence-download-label

**Used in:** `frontend/atlas-figures.js` · Viral proteome sequence download

```text
Selected Virus FASTA
```


## atlas-figures.sequence-download-tooltip

**Used in:** `frontend/atlas-figures.js` · Viral proteome sequence download

```text
The {{proteins}} {{label}} proteins used in these figures, {{residues}} residues. Source: UniProtKB/Swiss-Prot.
```

- `{{proteins}}` ← `nf(staged.proteins)` (live renderer value; not authored content)
- `{{label}}` ← `staged.label` (live renderer value; not authored content)
- `{{residues}}` ← `nf(staged.residues)` (live renderer value; not authored content)

## atlas-figures.coverage-source-label

**Used in:** `frontend/atlas-figures.js` · Chromosome figure viral-protein filter

```text
Viral Parent
```

Shared glossary term: `viral_parent` (edit its label once in terminology.json).


## atlas-figures.coverage-source-control

**Used in:** `frontend/atlas-figures.js` · Chromosome figure viral-protein filter

```text
Viral Parent for This Figure
```


## atlas-figures.coverage-source-pooled

**Used in:** `frontend/atlas-figures.js` · Chromosome figure viral-protein filter

```text
All Viral Parents (Pooled)
```


## atlas-figures.coverage-scope-pooled-csv

**Used in:** `frontend/atlas-figures.js` · Chromosome figure export value

```text
All Viral Parents (Pooled)
```


## atlas-figures.title-ladder

**Used in:** `frontend/atlas-figures.js` · Figure title

```text
Human Protein Reach and Residue Coverage
```


## atlas-figures.title-spread

**Used in:** `frontend/atlas-figures.js` · Figure title

```text
Human Protein Reach by Individual Viral Parents
```


## atlas-figures.title-spread-coverage

**Used in:** `frontend/atlas-figures.js` · Atlas figure title

```text
Human Residue Coverage by Individual Viral Parents
```


## atlas-figures.spread-metric-control

**Used in:** `frontend/atlas-figures.js` · Individual viral protein measure control

```text
Individual Viral Parent Measure
```


## atlas-figures.spread-reach-button

**Used in:** `frontend/atlas-figures.js` · Individual viral protein measure control

```text
Reach
```


## atlas-figures.spread-coverage-button

**Used in:** `frontend/atlas-figures.js` · Individual viral protein measure control

```text
Residue Coverage
```


## atlas-figures.title-sources

**Used in:** `frontend/atlas-figures.js` · Figure title

```text
Viral Parents Ranked by Human Protein Reach
```


## atlas-figures.title-targets

**Used in:** `frontend/atlas-figures.js` · Figure title

```text
Human Target–Viral Parent Pairs Ranked by Target Residue Coverage
```


## player.history-previous

**Used in:** `frontend/index.html` · History navigation accessible label

```text
Previous history items
```


## player.history-next

**Used in:** `frontend/index.html` · History navigation accessible label

```text
Next history items
```


## player.history-exposures

**Used in:** `frontend/index.html` · Compact History parent label

```text
Exposures
```


## player.history-human

**Used in:** `frontend/index.html` · Compact History parent label

```text
Human
```


## source-licenses.iedb-download-date

**Used in:** `frontend/source-licenses.js` · Source download date

```text
Downloaded September 1, 2026
```


## source-licenses.iedb-selection

**Used in:** `frontend/source-licenses.js` · Source selection and filtering

```text
Human-exposure positive protein antigens; Primates and non-protein entries excluded.
```


## mimicryone-runtime.input-records-prepared

**Used in:** `frontend/mimicryone-runtime.js` · Input preparation progress

```text
Loading records in this browser · {{count}} ready · Cancel is safe.
```

- `{{count}}` ← `nf(total)` (live renderer value; not authored content)

## atlas-figures.title-collection-reach

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Human Protein Reach vs Viral Proteome Length
```


## atlas-figures.collection-reach-axis

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Human Protein Reach
```


## atlas-figures.collection-coverage-axis

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Human Residue Coverage
```


## atlas-figures.collection-point-measures

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
At ≥{{value1}}/9: human protein reach {{value2}}%; human residue coverage {{value3}}%.
```

- `{{value1}}` ← `floor` (live renderer value; not authored content)
- `{{value2}}` ← `pct(r.reach)` (live renderer value; not authored content)
- `{{value3}}` ← `pct(r.coverage)` (live renderer value; not authored content)

## atlas-figures.collection-point-denominators

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
{{value1}} eligible human proteins · {{value2}} human residues
```

- `{{value1}}` ← `nf(r.eligible)` (live renderer value; not authored content)
- `{{value2}}` ← `nf(r.total)` (live renderer value; not authored content)

## atlas-figures.chromosome-reach-count

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
{{value1}} Reached
```

- `{{value1}}` ← `nf(reached)` (live renderer value; not authored content)

## atlas-figures.chromosome-reach-tooltip

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Human Protein Reach: {{value1}} of {{value2}} human targets ({{value3}}%) at ≥{{value4}}/9. Track height shows human target coverage.
```

- `{{value1}}` ← `nf(reached)` (live renderer value; not authored content)
- `{{value2}}` ← `nf(pts.length)` (live renderer value; not authored content)
- `{{value3}}` ← `pct(pts.length ? 100 * reached / pts.length : 0)` (live renderer value; not authored content)
- `{{value4}}` ← `key` (live renderer value; not authored content)

## atlas-figures.summary-svg-title

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Human Protein Reach and Residue Coverage | {{value1}}
```

- `{{value1}}` ← `PROTEOME` (live renderer value; not authored content)

## atlas-figures.summary-universe

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
{{value1}} Eligible Human Targets
```

- `{{value1}}` ← `nf(SURFACES.eligible_records)` (live renderer value; not authored content)

## atlas-figures.summary-threshold

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Core Identity
Threshold
```


## atlas-figures.summary-reached

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Human Targets
Reached
```


## atlas-figures.summary-covered

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Human Residues
Covered
```


## atlas-figures.summary-coverage-tooltip

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Human residues covered: {{value1}} / {{value2}} ({{value3}}%). Median coverage among reached human proteins: {{value4}}.
```

- `{{value1}}` ← `nf(r.covered)` (live renderer value; not authored content)
- `{{value2}}` ← `nf(r.residues)` (live renderer value; not authored content)
- `{{value3}}` ← `pct(r.coverage_pct)` (live renderer value; not authored content)
- `{{value4}}` ← `r.median_matched_coverage == null ? "not applicable (no proteins reached)" : pct(r.median_matched_coverage) + "%"` (live renderer value; not authored content)

## atlas-figures.summary-median-reach

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Median Reach per
Viral Parent
```


## atlas-figures.summary-median-matched

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Median Coverage
Among Reached
```


## atlas-figures.summary-source-proteins

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Viral Parents
with Matches
```


## atlas-figures.collection-metric-control

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Collection Plot Measure
```


## atlas-figures.collection-reach-button

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Reach
```


## atlas-figures.collection-coverage-button

**Used in:** `frontend/atlas-figures.js` · Reach and coverage figure copy

```text
Residue Coverage
```


## mimicryone-runtime.input-package-unavailable

**Used in:** `frontend/mimicryone-runtime.js` · User message

```text
The prepared inputs for this selection are unavailable or incompatible. Please refresh and try again; if this continues, the site needs its input packages updated.
```


## atlas-figures.human-target-coverage-label

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Human Target Coverage
```

Shared glossary term: `human_target_coverage` (edit its label once in terminology.json).


## atlas-figures.viral-parent-column

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Viral Parent
```

Shared glossary term: `viral_parent` (edit its label once in terminology.json).


## atlas-figures.human-target-column

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Human Target
```

Shared glossary term: `human_target` (edit its label once in terminology.json).


## atlas-figures.viral-parent-length-column

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Viral Parent
Length
```

Shared glossary term: `viral_parent` (edit its label once in terminology.json).


## atlas-figures.human-target-length-column

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Human Target
Length
```

Shared glossary term: `human_target` (edit its label once in terminology.json).


## atlas-figures.human-protein-reach-label

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Human Protein Reach
```

Shared glossary term: `human_protein_reach` (edit its label once in terminology.json).


## atlas-figures.spread-coverage-unit

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Human Residue Coverage
```

Shared glossary term: `human_residue_coverage` (edit its label once in terminology.json).


## atlas-figures.spread-reach-unit

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Human Protein Reach
```

Shared glossary term: `human_protein_reach` (edit its label once in terminology.json).


## atlas-figures.spread-identity-column

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Core Identity
Threshold
```


## atlas-figures.proteome-length-axis

**Used in:** `frontend/atlas-figures.js` · Figure label

```text
Viral Proteome Length (AA)
```


## atlas-figures.viral-parents-loading

**Used in:** `frontend/atlas-figures.js` · Loading label

```text
Viral Parents
```

Shared glossary term: `viral_parent` (edit its label once in terminology.json).


## atlas-figures.human-targets-loading

**Used in:** `frontend/atlas-figures.js` · Loading label

```text
Human Targets
```

Shared glossary term: `human_target` (edit its label once in terminology.json).


## atlas-figures.spread-median-reach

**Used in:** `frontend/atlas-figures.js` · Figure control or column label

```text
Median
Reach
```


## atlas-figures.spread-highest-reach

**Used in:** `frontend/atlas-figures.js` · Figure control or column label

```text
Highest
Reach
```


## atlas-figures.spread-median-coverage

**Used in:** `frontend/atlas-figures.js` · Figure control or column label

```text
Median
Coverage
```


## atlas-figures.spread-highest-coverage

**Used in:** `frontend/atlas-figures.js` · Figure control or column label

```text
Highest
Coverage
```


## atlas-figures.parent-search

**Used in:** `frontend/atlas-figures.js` · Figure control or column label

```text
Search Viral Parents…
```


## atlas-figures.parent-no-results

**Used in:** `frontend/atlas-figures.js` · Figure control or column label

```text
No viral parents match your search.
```


## atlas-figures.parent-option-count

**Used in:** `frontend/atlas-figures.js` · Figure control or column label

```text
{{count}} viral parents in this proteome
```

- `{{count}}` ← `PROTEIN_INDEX ? PROTEIN_INDEX.sources.length : 0` (live renderer value; not authored content)

## atlas-figures.arrangement-position

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Genome Position
```


## atlas-figures.arrangement-length

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Human Target Length
```


## atlas-figures.arrangement-location

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Subcellular Location
```


## atlas-figures.arrangement-control

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Arrange Human Targets
```


## atlas-figures.title-coverage-length

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Human Target Coverage by Human Target Length
```


## atlas-figures.title-coverage-location

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Human Target Coverage by Subcellular Location
```


## atlas-figures.arrangement-length-axis

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Human Target Length (Log Scale)
```


## atlas-figures.arrangement-length-note

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Each mark represents a human target. Horizontal position shows target length on a logarithmic scale; targets longer than 5,000 residues share the >5,000 edge. Equal lengths share a horizontal position.
```


## atlas-figures.arrangement-location-note

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Human targets are grouped by assigned subcellular location and ordered from shortest to longest within each group. Group width reflects the number of targets. Location assignments use UniProt annotations, with GO cellular-component annotations as a fallback when UniProt provides no classifiable location. Each target occupies one display group; this does not establish a dominant biological location. Unclassified means no display group was assigned.
```


## atlas-figures.location-cell-surface

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Cell Surface
```


## atlas-figures.location-secreted

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Secreted
```


## atlas-figures.location-other-membrane

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Other Membrane
```


## atlas-figures.location-intracellular

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Intracellular
```


## atlas-figures.location-not-annotated

**Used in:** `frontend/atlas-figures.js` · Figure arrangement label

```text
Unclassified
```


## atlas-figures.length-overflow-tick

**Used in:** `frontend/atlas-figures.js` · Length axis overflow label

```text
>{{maximum}}
```

- `{{maximum}}` ← `nf(length)` (live renderer value; not authored content)

## index.html.structure-loading

**Used in:** `frontend/index.html` · Retained structure frame status

```text
Loading structure…
```


## index.html.structure-missing

**Used in:** `frontend/index.html` · Retained structure frame status

```text
No structure is available for this Target.
```


## result-extent.window-pair-count

**Used in:** `frontend/result-extent.js` · Approved editorial correction

```text

{{pairs}} Window Pair{{plural}}
```

- `{{pairs}}` ← `p.pairs` (live renderer value; not authored content)
- `{{plural}}` ← `p.pairs === 1 ? "" : "s"` (live renderer value; not authored content)

## ranking.parent-order-description

**Used in:** `frontend/reproduce/ranking.js` · Approved editorial correction

```text
{{measure}} {{direction}}
```

- `{{measure}}` ← `parentLabels[s.parent]` (live renderer value; not authored content)
- `{{direction}}` ← `s.direction==='asc'?'ascending':'descending'` (live renderer value; not authored content)

## index.html.matching-record-total

**Used in:** `frontend/index.html` · Approved editorial correction

```text
{{count}} {{unit}}
```

- `{{count}}` ← `nf(matched)` (live renderer value; not authored content)
- `{{unit}}` ← `/exact.*sequence.*group/i.test(entityLabel)?'Matching Exact-Sequence Groups':'Matching Records'` (live renderer value; not authored content)

## mimicryone-runtime.no-antigen-target-input

**Used in:** `frontend/mimicryone-runtime.js` · Approved editorial correction

```text
No target sequence was supplied.
```


## mimicryone-runtime.custom-comparison-progress

**Used in:** `frontend/mimicryone-runtime.js` · Approved editorial correction

```text
{{targets}} target{{targetPlural}} · {{parents}} parent record{{parentPlural}} · {{work}}. Running on this device.
```

- `{{targets}}` ← `queryParsed.records.length` (live renderer value; not authored content)
- `{{targetPlural}}` ← `queryParsed.records.length === 1 ? "" : "s"` (live renderer value; not authored content)
- `{{parents}}` ← `targetSet.rows.length` (live renderer value; not authored content)
- `{{parentPlural}}` ← `targetSet.rows.length === 1 ? "" : "s"` (live renderer value; not authored content)
- `{{work}}` ← `formatWork(totalQueryWindows, totalTargetWindows)` (live renderer value; not authored content)

## mimicryone-runtime.custom-comparison-complete

**Used in:** `frontend/mimicryone-runtime.js` · Approved editorial correction

```text
{{targets}} target{{plural}} complete · {{pairs}} window pairs retained locally.
```

- `{{targets}}` ← `completed.length` (live renderer value; not authored content)
- `{{plural}}` ← `completed.length === 1 ? "" : "s"` (live renderer value; not authored content)
- `{{pairs}}` ← `completed.reduce(function matches(total, result) { return total + result.positional_matches.reduce(function pairs(subtotal, source) { return subtotal + source.hits.length; }, 0); }, 0).toLocaleString()` (live renderer value; not authored content)

## analysis-entry.one-antigen-target-input

**Used in:** `frontend/analysis-entry.js` · Approved editorial correction

```text
Analyze one Antigen Target at a time in the Player.
```


## analysis-entry.custom-parent-input-label

**Used in:** `frontend/analysis-entry.js` · Approved editorial correction

```text
Mimicry Parent input
```


## analysis-entry.custom-parent-library-label

**Used in:** `frontend/analysis-entry.js` · Approved editorial correction

```text
Mimicry Parent library
```


## publication-exports.figure-table-guide

**Used in:** `frontend/publication-exports.js` · Approved editorial correction

```text
Tables show up to 10 rows. Use All matches CSV and Overall Mimicry Parents CSV for the complete tables. Core identity uses nine positions; context identity uses a fixed span of 27 positions.
```


## player.startup-loading

**Used in:** `frontend/index.html` · Initial presentation loading status

```text
Loading...
```


## player.startup-retry

**Used in:** `frontend/index.html` · Retry initial page loading

```text
Reload
```


## result-extent.target-coverage-axis

**Used in:** `frontend/result-extent.js` · Coverage figure axis label

```text
Antigen Target Coverage (%)
```


## publication-exports.native-figure-caption

**Used in:** `frontend/publication-exports.js` · Companion caption for native figure bundle panels

```text
{{target}} versus {{scope}} at ≥{{floor}}/9 core identity. {{panel}} {{grouping}} {{highlight}}
```

- `{{target}}` ← `target` (live renderer value; not authored content)
- `{{scope}}` ← `scope` (live renderer value; not authored content)
- `{{floor}}` ← `snapshot.floor` (live renderer value; not authored content)
- `{{panel}}` ← `panel==='target' ? 'The sequence view uses the target’s stored coordinates. Colors and annotation marks follow the displayed keys.' : panel==='window' ? 'Rows show qualifying window pairs at the selected target start. Each alignment places the target above its parent; core and context identity use denominators of nine and 27 positions. Rows follow the captured ranking and display limit.' : panel==='parents' ? 'Each row summarizes one matching parent entry across the full target. Target and parent coverage use the respective full stored sequence lengths. Overlapping core residues count once, including mismatching positions; context flanks are excluded. Best Core and Best Context are independent maxima and may occur at different sites. Rows follow the captured ranking and display limit.' : 'The predicted structure uses the captured assembly and pose. Colors follow the displayed key.'` (live renderer value; not authored content)
- `{{grouping}}` ← `grouped && (panel==='window'||panel==='parents') ? 'Parent entries are exact-sequence groups of records with identical full stored sequences.' : ''` (live renderer value; not authored content)
- `{{highlight}}` ← `highlight && (panel==='target'||panel==='structure') ? 'Highlights mark the selected core and its surrounding context.' : ''` (live renderer value; not authored content)

## source-licenses.go-release

**Used in:** `frontend/source-licenses.js` · Annotation snapshot description

```text
Retained GO annotations
```


## source-licenses.go-role

**Used in:** `frontend/source-licenses.js` · Annotation source role

```text
Cellular-component annotations manually aligned by gene names and synonyms; used when UniProt provides no classifiable location.
```


## index.html.density-count-label

**Used in:** `frontend/index.html` · Dynamic density legend maximum; number precedes Matches in both color directions

```text
<b id="maxlab">{{count}}</b> Matches
```

- `{{count}}` ← `current ? current.textContent : ""` (live renderer value; not authored content)

## analysis-entry.public-library-policy-unavailable

**Used in:** `frontend/analysis-entry.js` · Invalid public library visibility policy at startup

```text
Library availability settings could not be loaded.
```


## result-extent.target-residues-covered

**Used in:** `frontend/result-extent.js` · Selected comparison summary label

```text
Target coverage
```


## atlas-figures.collection-parent-reach-title

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Human Protein Reach vs Viral Parent Length
```


## atlas-figures.collection-parent-coverage-title

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Human Residue Coverage vs Viral Parent Length
```


## atlas-figures.collection-highlight-parent

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Highlight {{parent}}
```

- `{{parent}}` ← `[r.label, r.accession].filter(Boolean).join(" · ")` (live renderer value; not authored content)

## atlas-figures.collection-click-parent

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Click to highlight this viral parent
```


## atlas-figures.collection-click-proteome

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Click to open this proteome
```


## atlas-figures.collection-parent-length-axis

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Viral Parent Length (AA)
```


## atlas-figures.collection-parent-highlight-legend

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
The highlighted point is {{parent}}.
```

- `{{parent}}` ← `collectionSelectedLabel()` (live renderer value; not authored content)

## atlas-figures.collection-parent-all-legend

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
All component proteins are shown.
```


## atlas-figures.collection-parent-reach-legend

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
The Y-axis shows human protein reach: the percentage of eligible human proteins matched at least once by that viral protein at the indicated core identity threshold.
```


## atlas-figures.collection-parent-coverage-legend

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
The Y-axis shows the percentage of eligible human residues covered by that viral protein’s matches at the indicated core identity threshold.
```


## atlas-figures.collection-parent-overlaps-legend

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Overlapping cores count once, including mismatching positions; context flanks are excluded.
```


## atlas-figures.collection-unit-control

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Plot Unit
```


## atlas-figures.collection-unit-proteomes

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Viral Proteomes
```


## atlas-figures.collection-unit-parents

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Individual Viral Parents
```


## atlas-figures.collection-highlight-all

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
All Viral Parents
```


## atlas-figures.collection-highlight-control

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Highlight Viral Parent
```


## atlas-figures.human-sequence-download-label

**Used in:** `frontend/atlas-figures.js` · Atlas sequence downloads

```text
Canonical Human Proteins FASTA
```


## atlas-figures.all-sequences-download-label

**Used in:** `frontend/atlas-figures.js` · Atlas sequence downloads

```text
All Viruses FASTA
```


## atlas-figures.human-sequence-download-tooltip

**Used in:** `frontend/atlas-figures.js` · Atlas sequence downloads

```text
All {{records}} canonical human protein records, including short proteins excluded from plots; {{residues}} residues. Source: UniProtKB/Swiss-Prot. Uses public accession, gene and protein-description headers.
```

- `{{records}}` ← `nf(publicHuman.records)` (live renderer value; not authored content)
- `{{residues}}` ← `nf(publicHuman.residues)` (live renderer value; not authored content)

## atlas-figures.all-sequences-download-tooltip

**Used in:** `frontend/atlas-figures.js` · Atlas sequence downloads

```text
All {{proteomes}} viral proteomes in this atlas: {{records}} protein records and {{residues}} residues in one FASTA. Preserves each proteome's records and headers, including shared sequences.
```

- `{{proteomes}}` ← `nf(bundles.all_viruses.proteomes)` (live renderer value; not authored content)
- `{{records}}` ← `nf(bundles.all_viruses.records)` (live renderer value; not authored content)
- `{{residues}}` ← `nf(bundles.all_viruses.residues)` (live renderer value; not authored content)

## analysis-entry.exclude-vertebrates-help

**Used in:** `frontend/analysis-entry.js` · Vertebrate exclusion tooltip

```text
Uncheck to exclude vertebrates, including mammals. Shared sequences remain when a resolved non-vertebrate source qualifies.
```


## analysis-entry.exclude-vertebrates-label

**Used in:** `frontend/analysis-entry.js` · Vertebrate exclusion control and reset notice

```text
Exclude vertebrates
```


## analysis-entry.no-vertebrates-label

**Used in:** `frontend/analysis-entry.js` · Active vertebrate exclusion summary

```text
No vertebrates
```


## analysis-entry.vertebrates-label

**Used in:** `frontend/analysis-entry.js` · Nested taxonomic inclusion checkbox

```text
Vertebrates
```


## analysis-entry.mammals-label

**Used in:** `frontend/analysis-entry.js` · Nested taxonomic inclusion checkbox

```text
Mammals
```


## source-licenses.cdi-name

**Used in:** `frontend/source-licenses.js` · CDI Labs source citation table cell

```text
CDI Labs
```


## source-licenses.cdi-release

**Used in:** `frontend/source-licenses.js` · CDI Labs source citation table cell

```text
HuProt 4.0; retained HuScan and full VirScan + Exposome content
```


## source-licenses.cdi-license

**Used in:** `frontend/source-licenses.js` · CDI Labs source citation table cell

```text
Not specified
```


## source-licenses.cdi-citation

**Used in:** `frontend/source-licenses.js` · CDI Labs source citation table cell

```text
CDI Labs: Library content
```


## source-licenses.cdi-role

**Used in:** `frontend/source-licenses.js` · CDI Labs source citation table cell

```text
Antigen sequences and identifiers for HuScan, full VirScan with the Exposome add-on, and HuProt 4.0 assays run by CDI Labs.
```


## source-licenses.cdi-accessed

**Used in:** `frontend/source-licenses.js` · Project owner-supplied CDI Labs source access month, separate from the library release

```text
Accessed April 2026.
```


## analysis-entry.virscan-human-scope-help

**Used in:** `frontend/analysis-entry.js` · Independent VirScan and Exposome source collection checkboxes

```text
VirScan peptides in the curated human-infecting virus subset. Check both VirScan subsets for the full CDIV2 library.
```


## analysis-entry.virscan-other-scope-label

**Used in:** `frontend/analysis-entry.js` · Independent VirScan and Exposome source collection checkboxes

```text
Other VirScan (CDIV2)
```


## analysis-entry.virscan-other-scope-help

**Used in:** `frontend/analysis-entry.js` · Independent VirScan and Exposome source collection checkboxes

```text
VirScan peptides outside the curated human-virus subset, including viruses of nonhuman hosts.
```


## analysis-entry.exposome-scope-label

**Used in:** `frontend/analysis-entry.js` · Independent VirScan and Exposome source collection checkboxes

```text
Exposome (CDIV3)
```


## analysis-entry.virscan-scope-caption

**Used in:** `frontend/analysis-entry.js` · Shared public VirScan scope labels for captions, scope summaries and exports

```text
VirScan (CDIV2)
```


## analysis-entry.virscan-human-subset-caption

**Used in:** `frontend/analysis-entry.js` · Shared public VirScan scope labels for captions, scope summaries and exports

```text
Curated human-infecting subset
```


## analysis-entry.virscan-other-subset-caption

**Used in:** `frontend/analysis-entry.js` · Shared public VirScan scope labels for captions, scope summaries and exports

```text
Outside curated human-infecting subset
```


## analysis-entry.curated-host-list-label

**Used in:** `frontend/analysis-entry.js` · Shared public VirScan scope labels for captions, scope summaries and exports

```text
Curated host list
```


## analysis-entry.organism-search-empty

**Used in:** `frontend/analysis-entry.js` · Empty organism-search result in a scope panel

```text
No matching organisms or taxa in this scope.
```


## analysis-entry.organism-search-narrow

**Used in:** `frontend/analysis-entry.js` · Scope search with more than sixty matching organism choices

```text
Keep typing to narrow {{count}} matches.
```

- `{{count}}` ← `matches.length` (live renderer value; not authored content)

## analysis-entry.selected-organism-filters

**Used in:** `frontend/analysis-entry.js` · Removable restored organism filters when complete search is unavailable

```text
Selected organism filters
```


## analysis-entry.saved-local-choice

**Used in:** `frontend/analysis-entry.js` · Explicit local-compute choice after saved delivery fails; retry saved delivery before local work

```text
This saved result is unavailable or too large to deliver. The previous result is retained. You can choose to compute on this device.
```


## analysis-entry.compute-on-device

**Used in:** `frontend/analysis-entry.js` · Explicit local-compute choice after saved delivery fails; retry saved delivery before local work

```text
Compute on this device
```


## analysis-entry.single-parent-mode

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
Mimicry Parent comparison mode
```


## analysis-entry.single-parent-library

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
vs library
```


## analysis-entry.single-parent-single

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
vs single
```


## analysis-entry.single-parent-placeholder

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
Gene, accession, description, etc.
```


## analysis-entry.single-parent-results

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
Mimicry Parents in selected scope
```


## analysis-entry.single-parent-clear

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
Clear protein
```


## analysis-entry.single-parent-choose

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
Choose one Mimicry Parent from the selected library and scope.
```


## analysis-entry.single-parent-empty

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
No matching proteins in the selected library and scope.
```


## analysis-entry.single-parent-failed

**Used in:** `frontend/analysis-entry.js` · Single-protein parent scope picker

```text
Parent search stopped:
```


## analysis-entry.custom-selected-parent-note

**Used in:** `frontend/analysis-entry.js` · Describe the current custom parent scope and local execution

```text
The {{parent}} {{unit}} compared in this browser at {{floor}}/9. Your sequences stay on this device.
```

- `{{parent}}` ← `selectedParentLabel(selectedParent, false)` (live renderer value; not authored content)
- `{{unit}}` ← `selection && selection.singleMode ? "record is" : "records are"` (live renderer value; not authored content)
- `{{floor}}` ← `floor` (live renderer value; not authored content)

## analysis-entry.additional-trembl

**Used in:** `frontend/analysis-entry.js` · Scope collection label

```text
Additional TrEMBL
```

Shared glossary term: `additional_trembl` (edit its label once in terminology.json).


## result-extent.caption-scientific-legend

**Used in:** `frontend/result-extent.js` · Scientific figure legend

```text
Each point pairs {{target}} with {{unit}} in {{scope}} at ≥{{floor}}/9 core identity; all {{count}} matching {{population}} are shown. The axes show covered residues as a percentage of full sequence length: {{target}} on the X-axis and its paired parent on the Y-axis.
```

**Edit in:** `docs/public/figure-legends.json`

- `{{target}}` ← `s.target_label` (live renderer value; not authored content)
- `{{scope}}` ← `s.parent_scope` (live renderer value; not authored content)
- `{{floor}}` ← `s.floor` (live renderer value; not authored content)
- `{{unit}}` ← `groups?'one distinct parent sequence':'one parent record'` (live renderer value; not authored content)
- `{{population}}` ← `groups?'sequences':'records'` (live renderer value; not authored content)
- `{{count}}` ← `s.parents.length.toLocaleString()` (live renderer value; not authored content)

## atlas-figures.collection-scientific-legend

**Used in:** `frontend/atlas-figures.js` · Scientific figure legend

```text
Each point represents one viral proteome; the highlighted point is the selected proteome. The X-axis shows the total length of its protein sequences. {{definition}} The denominator includes {{population}}. {{coreRule}}Each threshold panel has its own Y-axis range.
```

**Edit in:** `docs/public/figure-legends.json`

- `{{definition}}` ← `COLLECTION_METRIC === 'reach' ? 'The Y-axis shows human protein reach: the percentage of eligible human targets matched at least once by any protein in that proteome at the indicated core identity threshold.' : 'The Y-axis shows the percentage of all eligible human residues covered by matches to those proteins at the indicated core identity threshold.'` (live renderer value; not authored content)
- `{{population}}` ← `total && recs ? nf(recs)+' human records of at least '+MIN_LENGTH_AA+' residues ('+nf(total)+' residues in total)' : 'the full eligible human population'` (live renderer value; not authored content)
- `{{coreRule}}` ← `COLLECTION_METRIC === 'reach' ? '' : 'Overlapping cores count once, including mismatching positions; context flanks are excluded. '` (live renderer value; not authored content)

## atlas-figures.chromosome-scientific-legend

**Used in:** `frontend/atlas-figures.js` · Scientific figure legend

```text
Each mark represents a human target, positioned by its {{assembly}} genomic coordinate. The {{thresholds}} tracks show human target coverage at the indicated core identity thresholds on the same 0–100% scale. {{scope}}Overlapping cores count once, including mismatching positions; context flanks are excluded. {{population}}Track counts report the number of human targets matched at least once. Coordinates come from UniProt.
```

**Edit in:** `docs/public/figure-legends.json`

- `{{population}}` ← `u ? 'All '+nf(u.records)+' eligible human targets remain included. ' : ''` (live renderer value; not authored content)
- `{{assembly}}` ← `ASSEMBLY` (live renderer value; not authored content)
- `{{thresholds}}` ← `TRACKS.length` (live renderer value; not authored content)
- `{{scope}}` ← `selectedSourceLabel() ? 'Coverage is from '+selectedSourceLabel()+' alone, within '+PROTEOME+'. ' : 'Coverage pools matches across all viral parents in '+PROTEOME+'. '` (live renderer value; not authored content)

## atlas-figures.ladder-scientific-legend

**Used in:** `frontend/atlas-figures.js` · Scientific figure legend

```text
Each row summarizes matches to {{proteome}} at one core identity threshold. Human targets reached counts eligible human targets matched at least once; human residues covered reports pooled coverage across the full eligible human population. Median coverage among reached is the median human target coverage among targets with a match. Median reach per viral parent is the median human protein reach across all viral parents. Viral parents with matches is shown as the contributing count followed by the total. Overlapping cores count once, including mismatching positions; context flanks are excluded.
```

**Edit in:** `docs/public/figure-legends.json`

- `{{proteome}}` ← `PROTEOME` (live renderer value; not authored content)

## atlas-figures.spread-scientific-legend

**Used in:** `frontend/atlas-figures.js` · Scientific figure legend

```text
Each dot represents one {{proteome}} protein. {{definition}} Bars show the range; green marks the median. The right-hand columns report the median and highest {{measure}}. {{axis}}
```

**Edit in:** `docs/public/figure-legends.json`

- `{{definition}}` ← `SPREAD_METRIC === 'coverage' ? 'The X-axis shows the percentage of all eligible human residues covered by that protein’s qualifying cores at the indicated core identity threshold.' : 'The X-axis shows human protein reach: the percentage of eligible human targets matched at least once at the indicated core identity threshold.'` (live renderer value; not authored content)
- `{{axis}}` ← `SPREAD_METRIC === 'coverage' ? 'All threshold rows share the range stated above the plot. Overlapping cores count once, including mismatching positions; context flanks are excluded.' : ''` (live renderer value; not authored content)
- `{{proteome}}` ← `PROTEOME` (live renderer value; not authored content)
- `{{measure}}` ← `SPREAD_METRIC === 'coverage' ? 'coverage' : 'reach'` (live renderer value; not authored content)

## atlas-figures.sources-scientific-legend

**Used in:** `frontend/atlas-figures.js` · Scientific figure legend

```text
Each row is a {{proteome}} protein; each threshold column reports how many eligible human targets it matches at least once. A human target counts once if it has any qualifying match to that viral parent. Rows rank by reach at ≥{{floor}}/9; shorter proteins break ties. Ranking is not adjusted for protein length.
```

**Edit in:** `docs/public/figure-legends.json`

- `{{proteome}}` ← `PROTEOME` (live renderer value; not authored content)
- `{{floor}}` ← `floorForKey('sources')` (live renderer value; not authored content)

## atlas-figures.targets-scientific-legend

**Used in:** `frontend/atlas-figures.js` · Scientific figure legend

```text
Each row pairs a human target with the {{proteome}} protein covering the greatest fraction of that target at the retained ≥{{baked}}/9 selection threshold. That viral partner stays fixed across all threshold columns. Coverage uses the full human target length. Overlapping cores count once, including mismatching positions; context flanks are excluded. Rows are ranked by coverage at ≥{{rank}}/9, with longer human targets first when values tie. {{limit}}{{population}}
```

**Edit in:** `docs/public/figure-legends.json`

- `{{proteome}}` ← `PROTEOME` (live renderer value; not authored content)
- `{{baked}}` ← `bakedRankFloor()` (live renderer value; not authored content)
- `{{rank}}` ← `floorForKey('targets')` (live renderer value; not authored content)
- `{{limit}}` ← `pairRankingExact(String(floorForKey('targets'))) ? '' : 'The stored candidate set is selected by pooled coverage; the global top pairs are not guaranteed at this threshold. '` (live renderer value; not authored content)
- `{{population}}` ← `u ? 'The eligible population contains '+nf(u.records)+' human targets.' : ''` (live renderer value; not authored content)

## result-extent.view-label

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
Sequence map ({{view}}{{mode}})
```

**Edit in:** `docs/public/figure-legends.json`

- `{{view}}` ← `view.exported?'Compact and Full exports':({player:'Preview',explorer:'Compact',residues:'Full'}[view.view]||view.view)` (live renderer value; not authored content)
- `{{mode}}` ← `!view.exported&&view.view==='player'?' – '+(view.mode==='site'?'Window':'Overall'):''` (live renderer value; not authored content)

## result-extent.variants-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
Variant markers show UniProt HumSAVAR missense classifications: (likely) pathogenic, uncertain significance, or (likely) benign.
```

**Edit in:** `docs/public/figure-legends.json`


## result-extent.modifications-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
Modification symbols show annotated modification sites.
```

**Edit in:** `docs/public/figure-legends.json`


## result-extent.surface-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
The surface track marks exposed residues (rSASA ≥0.25) in the {{assembly}} model.
```

**Edit in:** `docs/public/figure-legends.json`

- `{{assembly}}` ← `view.assembly_context` (live renderer value; not authored content)

## result-extent.rsasa-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
rSASA shows relative solvent-accessible surface area calculated with FreeSASA in the {{assembly}} model (color scale 0–1; higher values share the maximum color).
```

**Edit in:** `docs/public/figure-legends.json`

- `{{assembly}}` ← `view.assembly_context` (live renderer value; not authored content)

## result-extent.plddt-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
pLDDT shows AlphaFold’s per-residue structural confidence (0–100).
```

**Edit in:** `docs/public/figure-legends.json`


## result-extent.cleavage-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
The cleavage track shows pepsickle epitope-model proteasomal cleavage probabilities (0–1).
```

**Edit in:** `docs/public/figure-legends.json`


## result-extent.topology-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
Topology marks UniProt-annotated extracellular, transmembrane, and intracellular regions.
```

**Edit in:** `docs/public/figure-legends.json`


## result-extent.parent-lanes-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
Parent tracks show matching positions, with opacity indicating core identity from 5/9 to 9/9. {{reveal}}
```

**Edit in:** `docs/public/figure-legends.json`

- `{{reveal}}` ← `(view.mode==='site'?'The tracks refer to the selected target window.':'Blocks show sites revealed by the scanner; the coverage summary uses the complete result.')+(!view.exported&&view.view==='player'&&view.mode!=='site'?' Preview shows up to eight parents from up to 50 candidates, in fixed alphabetical order.':'')` (live renderer value; not authored content)

## result-extent.sequence-map-method

**Used in:** `frontend/result-extent.js` · Adaptive scientific figure legend

```text
Shows where qualifying molecular mimicry matches occur along {{target}} ({{length}} residues). Color shows the number of window pairs at each target start; each residue takes the highest value among overlapping cores (0–{{maximum}}, {{direction}}). Highlights mark the selected core and its surrounding context. Target coverage is the percentage of the full target sequence covered across the selected parent library. {{coverage}} {{lanes}}{{tracks}}
```

**Edit in:** `docs/public/figure-legends.json`

- `{{target}}` ← `s.target_label` (live renderer value; not authored content)
- `{{length}}` ← `length.toLocaleString()` (live renderer value; not authored content)
- `{{maximum}}` ← `Number(view.density_max||0).toLocaleString()` (live renderer value; not authored content)
- `{{direction}}` ← `view.density_inverted?'inverted density color scale':'displayed density color scale'` (live renderer value; not authored content)
- `{{lanes}}` ← `lanes?lanes+' ':''` (live renderer value; not authored content)
- `{{tracks}}` ← `annotations.join(' ')` (live renderer value; not authored content)
- `{{coverage}}` ← `coverageNote` (live renderer value; not authored content)

## atlas-figures.ordered-coverage-scientific-legend

**Used in:** `frontend/atlas-figures.js` · Scientific figure legend

```text
{{arrangement}} The {{thresholds}} tracks show human target coverage at the indicated core identity thresholds on the same 0–100% scale. {{scope}}Overlapping cores count once, including mismatching positions; context flanks are excluded. {{population}}Track counts report the number of human targets matched at least once.
```

**Edit in:** `docs/public/figure-legends.json`

- `{{population}}` ← `u ? 'All '+nf(u.records)+' eligible human targets remain included. ' : ''` (live renderer value; not authored content)
- `{{thresholds}}` ← `TRACKS.length` (live renderer value; not authored content)
- `{{scope}}` ← `selectedSourceLabel() ? 'Coverage is from '+selectedSourceLabel()+' alone, within '+PROTEOME+'. ' : 'Coverage pools matches across all viral parents in '+PROTEOME+'. '` (live renderer value; not authored content)
- `{{arrangement}}` ← `arrangementNote()` (live renderer value; not authored content)

## result-extent.coverage-method

**Used in:** `frontend/result-extent.js` · Shared covered-residue counting rule within sequence-map and standalone scatter captions

```text
Coverage counts every position in a qualifying nine-residue core, including mismatches. Overlaps count once; context flanks are excluded.
```

**Edit in:** `docs/public/figure-legends.json`


## result-extent.scatter-heading

**Used in:** `frontend/result-extent.js` · Bold lead-in for the parent-versus-target scatter caption

```text
Parent versus target mimicry scatter
```

**Edit in:** `docs/public/figure-legends.json`


## atlas-figures.collection-parent-scientific-legend

**Used in:** `frontend/atlas-figures.js` · Collection scatter display unit and highlighting

```text
Each point represents one viral parent in {{proteome}}. {{highlight}} The X-axis shows protein length. {{measure}} The denominator includes {{records}} human records of at least {{minimum}} residues ({{residues}} residues in total). {{overlaps}}Each threshold panel has its own Y-axis range.
```

**Edit in:** `docs/public/figure-legends.json`

- `{{proteome}}` ← `PROTEOME` (live renderer value; not authored content)
- `{{highlight}}` ← `highlight` (live renderer value; not authored content)
- `{{measure}}` ← `measure` (live renderer value; not authored content)
- `{{records}}` ← `nf(PROTEIN_INDEX && PROTEIN_INDEX.eligible_human_records)` (live renderer value; not authored content)
- `{{minimum}}` ← `MIN_LENGTH_AA` (live renderer value; not authored content)
- `{{residues}}` ← `nf(PROTEIN_INDEX && PROTEIN_INDEX.eligible_human_residues)` (live renderer value; not authored content)
- `{{overlaps}}` ← `overlaps` (live renderer value; not authored content)

## Methods Diagram Copy

Edit `docs/public/method-copy.json`. Numbered placeholders are supplied by the corresponding diagram call in `frontend/method-figure.js`; this section includes titles, captions, equations and diagram labels.

### panel0.title

```text
Select Records and Comparison Scope
```

### panel0.equation

```text

```

### panel0.caption

```text
<p>To start, select a sequence you care about or one recognized by an experimentally identified antibody. This sequence is the <strong>antigen target</strong>. Next, you select a pool of sequences to look for molecular mimicry from; these are its potential <strong>mimicry parents</strong>. A minimum identity threshold setting defines how broad the search is.</p><p>In our example, scientists have discovered a monoclonal antibody which bound the human protein HEPACAM (GlialCAM; Q14CZ8). They suspected this antibody might have origins in a natural immune response to a virus with sequence similarity to it. HEPACAM is thus the <strong>antigen target</strong> and 'possible culprit virus proteomes' are the <strong>mimicry parents</strong>. They wish for this search to be very broad and have selected an identity threshold of 5/9.</p>
```

### choice.target

```text
Antigen Target
```

### choice.parent

```text
Mimicry Parent Scope
```

### choice.one

```text
One FASTA Record
```

### choice.many

```text
Curated Viral Proteomes (120)
```

### choice.record-field

```text
Each Bar Represents One Record
```

### choice.pair

```text
Target Windows × Included Parent Windows
```

### choice.threshold

```text
Identity ≥: {0} identical positions out of 9
```

### panel1.title

```text
Inspect and Summarize Results
```

### panel1.equation

```text

```

### panel1.caption

```text
<p>MimicryMap produces individual sequence matches and summaries that compile those matches for reuse. The full data viewer locates qualifying nine-residue core pairs in the target and parent sequences. At a selected site, matches can be ranked by core identity (e.g., 8/9 outranking 5/9), context identity (e.g., 20/27 outranking 6/27), or BLOSUM62 score. Individual alignments and their coordinates can be inspected and exported.</p><p>To summarize all matching events between two records, MimicryMap calculates target and parent coverage. This combines qualifying nine-residue cores into independent residue unions on each sequence. Overlapping residues count once; the entire qualifying core contributes, including mismatched positions, while context flanks are excluded. These same coverage values appear in the viewer and exported summaries:</p><div class="method-equation"><div><strong>Target Coverage</strong> = 100 × <span class="method-fraction"><span>covered target residues</span><span>target length</span></span></div><div><strong>Parent Coverage</strong> = 100 × <span class="method-fraction"><span>covered parent residues</span><span>parent length</span></span></div></div><p>For the case of HEPACAM and EBNA1, several additional matching sites at 5/9 identity increase the total target and parent coverage to 13.2% and 10.1%, respectively. All matching 9-mers and coverage scores are shown in the accompanying figure. Each is another qualifying molecular mimicry event, alongside <span class="method-inline-mask" aria-label="XSPPRXPXX"><span class="method-aa-mismatch" aria-hidden="true">X</span><span class="method-aa-match" aria-hidden="true">S</span><span class="method-aa-match" aria-hidden="true">P</span><span class="method-aa-match" aria-hidden="true">P</span><span class="method-aa-match" aria-hidden="true">R</span><span class="method-aa-mismatch" aria-hidden="true">X</span><span class="method-aa-match" aria-hidden="true">P</span><span class="method-aa-mismatch" aria-hidden="true">X</span><span class="method-aa-mismatch" aria-hidden="true">X</span></span>.</p><p>Across the rest of Epstein-Barr virus, there are numerous other matches to HEPACAM at 5/9 identity. Not only do many proteins mimic HEPACAM more often than EBNA1 at 5/9, at the specific HEPACAM 376–384 9-mer core alone there are 27 pairs of 5/9 identity between it and the EBV proteome. There are even more matches occurring across the full viral proteome search space, including two strong matches at 7/9 identity occurring in non-EBV proteins.</p><table class="method-scope-summary"><caption>Saved window pairs at HEPACAM 376–384</caption><thead><tr><th scope="col">Parent Scope</th><th scope="col">Identity ≥</th><th scope="col">Pairs</th></tr></thead><tbody><tr><th scope="row">Curated EBV B95-8 proteome</th><td>5/9</td><td>27</td></tr><tr><th scope="row">Curated Viral Proteomes (120)</th><td>5/9</td><td>293</td></tr><tr><th scope="row">Curated Viral Proteomes (120)</th><td>7/9</td><td>2</td></tr></tbody></table><p id="proteomeReactivity">These numerous matches illustrate why experimental evidence is essential for identifying biologically relevant mimicry. For broader comparisons, the same coverage calculations scale from individual record pairs to entire libraries. The <a href="sources.html" data-site-nav>Downloads page</a> provides premade summary CSVs for mappings within and between canonical human and exposure proteomes, curated viral proteomes and assay libraries. These portable files retain identifiers, sequences, coverage values and matched residue ranges at 7/9, 8/9 and 9/9. The <a href="pan-viral.html" data-site-nav>Pan-Viral Atlas</a> explores the human–viral comparison from these downloads in detail, with figures extending down to 5/9.</p><p>The summaries offer a quick way to explore broader patterns of sequence mimicry, but their 7/9 minimum excludes the illustrated 5/9 HEPACAM–EBNA1 match. Focused searches at lower identity thresholds therefore remain valuable for investigating individual targets alongside experimental evidence.</p>
```

### input.scale

```text
Selected Pair in Full Records · Common Residue Scale
```

### input.target

```text
Antigen Target · {0} · {1} AA
```

### input.parent

```text
Mimicry Parent · {0} · {1} AA
```

### input.context

```text
{0}–{1} · 27-Position Context
```

### panel2.title

```text
Extract Window Pairs
```

### panel2.equation

```text

```

### panel2.caption

```text
<p>The algorithm begins by deconstructing both the antigen target and mimicry parent sequences into all-possible overlapping 9-mer windows. Each 9-mer must be complete, so the number of total windows per sequence record is its length minus 8 residues. A protein of 9 amino acids thus has one window, a protein of 10 amino acids two, and so on. In our example, HEPACAM is 416 amino acids long and thus has 408 unique 9-mer core windows. Shown is one piece of this process occurring from positions 367 to 393.</p><div class="method-equation"><div><strong>Windows per record</strong> = max(0, record length − 8)</div><div><strong>HEPACAM:</strong> 416 − 8 = 408 windows</div></div><p>An identical process is done across the entire mimicry parent library. Across the 120 included viral proteomes, there are 2,222 proteins and polyproteins, with 961,063 possible mimicry windows.</p><p>Each target window is paired with every parent window, giving the total search space for this experiment:</p><div class="method-equation"><div><strong>Possible Window Pairs</strong> = 408 × 961,063</div><div>= 392,113,704 ≈ 3.92 × 10<sup>8</sup> possible pairs</div></div>
```

### windows.range

```text
{0}–{1}
```

### windows.excerpt

```text
HEPACAM 367–393 · 27-Residue Excerpt
```

### windows.walk

```text
Overlapping 9-mer Windows
```

### windows.core-start

```text
Start
```

### windows.core-end

```text
End
```

### windows.step

```text
19 Complete 9-mers · Advance 1 Residue
```

### motif.title

```text
Example 5/9 Patterns
```

### panel3.title

```text
Map Context
```

### panel3.equation

```text

```

### panel3.caption

```text
<p>Each qualifying core pair is located in the original records and extended by up to nine residues on either side. The aligned context contains up to 27 residues and allows for observation and ranking of higher-quality matches; any additional matches here are counted towards the total context identity. The aligned contexts are scored using BLOSUM62, which assigns a similarity score to each aligned amino-acid pair.</p><p>Our example of HEPACAM and EBNA1 is not unusual. Matches of this quality occur within most target parent pairings. The extended context adds one additional match for a total context identity of 6/27 and produces a poor BLOSUM62 score of 12 across the aligned 27mers.</p>
```

### panel4.title

```text
Apply Core Threshold
```

### panel4.equation

```text

```

### panel4.caption

```text
<p>Within each of the window pairs the target positions are aligned with the parent positions and checked for identical amino acids. At a minimum identity of 5/9, any five or more positions must match and up to four may differ. All-possible 9-mer pairings between the antigen target and mimicry parents are compared; this is often many millions of comparisons.</p><p>The illustrated patterns show this process. Five positions require exact matches; each wildcard (*) leaves a position unrestricted. Pairs with motifs like this pass and are called as mimicry events at the 5/9 threshold. At this threshold individual target sites often have multiple matches in the parent library. Non-matching pairs are discarded.</p><p>For the selected HEPACAM–EBNA1 pair, <span class="method-inline-mask" aria-label="XSPPRXPXX"><span class="method-aa-mismatch" aria-hidden="true">X</span><span class="method-aa-match" aria-hidden="true">S</span><span class="method-aa-match" aria-hidden="true">P</span><span class="method-aa-match" aria-hidden="true">P</span><span class="method-aa-match" aria-hidden="true">R</span><span class="method-aa-mismatch" aria-hidden="true">X</span><span class="method-aa-match" aria-hidden="true">P</span><span class="method-aa-mismatch" aria-hidden="true">X</span><span class="method-aa-mismatch" aria-hidden="true">X</span></span> shows five identical positions and four differences. This pair qualifies at 5/9 but is just one of many possible ways mimicry may occur at this site.</p>
```

### library.title

```text
One Target Window, Many Mimicry Parents
```

### library.site-count

```text
One Core Can Match Several Parent Sites
```

### library.selected-pair

```text
Selected: EBNA1 · P03211
```

### library.other-parents

```text
Other Matching Parent Records
```

### library.scope

```text
Curated Viral Proteomes (120)
```

### library.target

```text
HEPACAM · Core 376–384
```

### field.target-title

```text
Antigen Target Core Windows
```

### field.target-range

```text
HEPACAM · {0}–{1}
```

### coverage.full-title

```text
All Aligned HEPACAM and EBNA1 9-mer Cores at ≥5/9 Core Identity
```

### coverage.full-pairs

```text
{0} Window Pairs at ≥5/9
```

### coverage.target-fraction

```text
Target % = 100 × {0} ÷ {1} = {2}%
```

### coverage.parent-fraction

```text
Parent % = 100 × {0} ÷ {1} = {2}%
```

### choice.target-name

```text
HEPACAM
```
