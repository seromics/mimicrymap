# Public Website Drafts

These are the single authored sources for the sections below. They are **drafts**, not finalized publication copy. HTML fragments preserve the existing website layout and diagram hooks; no second Markdown narrative is maintained.

Use MimicryMap for the application in all public-facing prose, documentation and figures. Keep existing repository URLs, filesystem paths and machine identifiers unchanged. The current method reports literal sequence matches and descriptive coverage; historical significance or enrichment language must not be carried into current sequence-match claims. Reactivity Enrichment in SeroMap is a separate downstream test of recorded assay hit calls in sequence-defined antigen sets; its worked examples must distinguish recorded-hit statistics from sequence matching alone.

## Player, Tooltips and Figure Text

Review [Interface Text Catalogue](INTERFACE_TEXT.md); edit [interface-copy.json](interface-copy.json). The catalog records UI text locations across the player, static controls, tooltips, track legends, main figure/export renderers, ranking labels, notices and dynamic captions. Its generated surface index gives current entry counts; do not edit both files.

The [Glossary](GLOSSARY.md) is the single terminology authority, generated from [terminology.json](terminology.json). Its concept families consolidate related definitions; the stable term IDs remain contextual label references, not separate concepts readers must learn. Entries with a `term` reference inherit its label instead of maintaining another editable spelling. An optional `suffix` preserves surrounding whitespace. Define terms in the relevant public explanation, following these meanings and rules; do not add a competing glossary to the page.

Client CSV fields are defined by [export-fields.json](../contracts/export-fields.json) and `frontend/reproduce/export-core.js`. The reviewed contract uses Antigen Target and Mimicry Parent consistently; the shared formatter supplies role label, Gene, Accession and Protein Description in the same order across player, atlas and figure-data CSVs. The registry owns the remaining atlas fields and validates their live placeholders. Schema changes require explicit review. Figure headings in the export module remain UI text, distinct from CSV fields.

Each entry has a stable `key`, `text`, its consuming `file`, a `use` description and any `placeholders`. Edit wording in `text`. Keep `{{placeholder}}` names intact; their `expression` is code-owned and tells reviewers exactly where the live value comes from. The build rejects missing or additional placeholders. Do not edit expressions while copy-editing. Some entries are HTML fragments: preserve tags, control IDs and attributes. Plain labels/tooltips require no HTML knowledge.

From the checkout root, run `python mimicrymap/frontend/public_sections.py` to compile the text into the existing files, update the readable catalogue and regenerate public sections. `--check` verifies that those outputs are current. Portable source packaging is a separate host step, described below. No client-side text download is involved.

Generated `/*@copy ...*/` and `<!--@copy ...-->` regions and `data-copy-*` attributes identify content ownership. Edit surrounding behavior/layout code normally, but edit wording in the catalogue. Public code contains generated text, not internal `use` notes or the expression inventory.

### Live Values and Exported Legends

Main target-summary and pan-viral figure legends are authored in [figure-legends.json](figure-legends.json) and included in the same [Interface Text Catalogue](INTERFACE_TEXT.md), with their source file and live-value expressions. They compile through the same build as controls and tooltips. Edit the JSON, not renderer text or the generated catalog.

Axis references use X and Y: write X-axis and Y-axis in captions and legends. In the target–parent coverage scatter, X is target coverage and Y is the paired parent’s coverage; each percentage uses that sequence’s full length.

Legend style: identify what each point, row, or track represents first, then explain the axes or columns, comparison scope, threshold, essential visual keys, and figure-specific limits. Use sentence case for defined terms in prose; retain the exact capitalization of named controls and labels when explicitly referring to them. Define target and parent once, then use those short forms where clear. Explain reach and coverage in the atlas introduction, and state their denominators and pooling scope in captions. Put motivation and broader interpretation in the surrounding article. Preserve grouping, non-comparable scales, and incomplete-ranking warnings. Avoid repeated export instructions and general cautions under every figure. Each exported figure has a corresponding caption; compact color and symbol keys remain keys.

The homepage target-summary caption starts directly with the bold sequence-map lead-in, with coverage defined inside that paragraph, followed by the bold scatter lead-in. Standalone scatter exports retain the shared covered-residue counting rule. Plain-text exports retain the same sections and labels without HTML markup.

Annotation legends and hover text name the displayed quantity, source, numeric scale and any classification cutoff. Use lowercase common track names in tooltip prose; retain standalone labels and standard abbreviations such as rSASA and pLDDT. Use direct definitions. Keep study-level interpretation in the surrounding article instead of appending immunity or antibody-binding disclaimers to track descriptions.

- Counts, percentages, coordinate ranges, thresholds, selected scope and names are supplied by the original renderer expressions, not frozen into text entries.
- Native plot exports capture the current player legend, including gradient end labels and modification symbols. Table/figure headings compile from the same catalogue into the export code.
- New figure bundles and rebaked figures use compiled wording. Existing PNG/SVG/ZIP examples remain frozen with their original provenance until explicitly regenerated; do not relabel old results as current.
- The generated CPU/export modules are packaged into the public CPU pipeline download and live reproduction bundles. No wiki or content-server dependency is required to run a downloaded bundle.
- Database annotation text, organism/protein descriptions, raw FASTA headers, IDs and machine-facing CSV schema keys are not copy-editing targets. Backend diagnostics, native metadata and conditional text supplied inside code-owned expressions are not an exhaustive editable language inventory. New user-facing strings should be registered here, rather than accumulating inline again.

The preserved pre-migration files support a presentation parity test; see `tools/test_interface_copy.cjs`. Tests also check placeholder integrity, export sorting/table equality and current logo layout.

## Section Documents

| Section | Edit here | Internal notes |
| --- | --- | --- |
| How Mimicry Results Are Calculated | [methods.html](methods.html) | [Calculation contract](../wiki/methods.md) |
| Methods diagram titles and captions | [method-copy.json](method-copy.json) | Renderer supplies numbered placeholder values; no executable code in the content file |
| Target-summary section | [target-summary.html](target-summary.html) | Dynamic result values remain in the renderer |
| Pan-viral section | [pan-viral.html](pan-viral.html) | Dynamic release-bound plots remain in the renderer |
| HEPACAM context and result summaries | [method-copy.json](method-copy.json), within steps 1–5 | [Controls and exports](../wiki/explore.md) |
| How to Use Mimicry Results | [use-results.html](use-results.html) | Four saved examples, including individual and cohort reactivity enrichment; interpretation rather than a second calculation tutorial |
| Verified source versions and counts | [sources.html](sources.html), `frontend/release-provenance.js` | [Installed provenance](../wiki/sources.md) |
| Data Sources, Methods, and Licenses | [sources.html](sources.html) | [Code ownership](../wiki/development.md) |

Run `python mimicrymap/frontend/public_sections.py` from the checkout root after editing. The retained reference-host `frontend/serve.py` invokes content generation on startup; the active SeroMap host serves pages built ahead of deployment and does not rewrite them at runtime. Static deployment must generate the pages before packaging. `python mimicrymap/frontend/public_sections.py --check` rejects stale generated sections.

These six HTML fragments, diagram-copy JSON and registered interface-copy entries are explicit build inputs. Internal wiki pages and this README are not injected into the website. Do not edit generated public pages or the hidden home build slots; the build replaces them. In diagram captions, preserve numbered placeholders such as `{0}`: the renderer supplies calculated values. HTML emphasis and links remain authored in the docs.

For a read-only deployment, build and run `--check` during packaging. Startup does not write an already-current page; stale output requires write access and must not be silently served as current.

The Methods diagram renderer retains geometry, equations and example data; its explanatory captions/titles live only in docs. The interface catalogue additionally owns registered labels and captions in the renderers. Scientific inputs and layout code are not documentation, and remain in their existing implementation files.

Methods follows five steps: Select Records, Extract Windows, Apply Core Identity, Map Pairs, and Inspect and Summarize Results. Step 5 combines the selected sequence map/context/logo, full-record coverage bars with calculations, and a compact grid of all saved 9-mer core logos. Titles, explanations, equations and new diagram labels are authored in `method-copy.json` and included in the shared readable catalog. Existing numeric values are supplied by the renderer. The renderer uses responsive layouts while keeping ordinary diagram type at a fixed screen size. Step 2 tiles all 19 complete windows of the displayed 27-residue segment. Step 5 shows all 21 saved core logos, four across on wide layouts and two across on narrow layouts. Start numbers flank each logo on the left and end numbers on the right, with target above parent. Saved coordinate order is distinct from score ranking.

HEPACAM CSVs supply the Methods illustrations and saved-count checks; the archived figure ZIPs retain the original exports and settings. Ordinary copy or layout edits need only the public build, not an asset import. Refresh these evidence packages only when replacing the supplied saved results, following the [saved-evidence maintenance guidance](../wiki/build.md#saved-hepacam-evidence). The import script’s legacy filename does not imply a separate public article.

The former frontend HEPACAM template is archived with a restoration record under `docs/records/public-content-migration-20260908.json`. Frozen export packages remain unchanged.

The former long HEPACAM article is consolidated into the five Methods steps. `use-results.html` now supplies a separate, compact interpretation section: HEPACAM, Reactivity Enrichment, IL10 and IGHG2. It retains the `hepacamWorkedExample` anchor for compatibility and follows Methods. Do not duplicate the calculation tutorial there.

`release.html` remains a hidden build-compatibility slot. `hepacam.html` is a retained historical empty fragment, no longer a build input. Public source prose, atlas population, and annotation methods belong in `sources.html`. Internal dataset IDs and fingerprints remain in retained provenance; successful verification does not print them on the page.

The example captions, links and prose have one editable source in `use-results.html`. `tools/import_use_results_figures.py` refreshes display SVGs from the renamed September 9 exports into `frontend/examples/use-results/20260909`, with a provenance manifest. Saved coverage summaries pass through the current live/export renderer via `tools/render_saved_coverage.cjs`, which checks all point counts and coordinates, excludes internal IDs, and creates transparent 3x PNGs. No comparisons are rerun. Set `MIMICRY_NODE` to the Node executable and `NODE_PATH` to its Playwright dependencies if not available globally. IGHG2 uses unchanged unhighlighted Full, plain structure and table SVGs from its bundle. Original exports are not overwritten. The September 16 HuProt/VirScan HEPACAM example uses `tools/import_hepacam_assay_example.py` and its separately dated archive and display directory. It retains native JHU/CDI identities, saved scores and all point coordinates; exact-scope CSV downloads are unchanged copies. The Word review remains a separate frozen output and should be refreshed only after the site text and layout are approved.

## Link behavior

Links that navigate away from the current page open in a new tab with `target="_blank"` and `rel="noopener noreferrer"`. Keep same-page section links and downloads in their existing flow. `frontend/page-links.js` applies this rule to static links and to dynamically rendered links when activated, without observing the animated page DOM.

Use AA for abbreviated amino-acid length units in displayed labels, tooltips, and export headings. The approved capitalization update includes the atlas length columns in docs/contracts/export-fields.json; their field keys and values are unchanged. The selected atlas proteome heading places its name on the first line and protein count plus total AA on the second.


## Page layout and navigation

Content generation is the default; `--content-only` remains an equivalent compatibility option. In the SeroMap source checkout, separately run `node desktop/scripts/build-mimicry-export-package.cjs` to refresh the downloadable portable example from shared sources. The normal host build and refresh also run that packaging step. The current player is `frontend/index.html`; the host adds its navigation and layout at request time through `atlas/viewer/server/nativeMimicryPage.js`. The legacy `viewer.html` URL redirects to that player, preserving the selection and section. There is no separate generated player copy.

The build generates independent MimicryMap, Pan-Viral Atlas, How It Works, How to Use, and Data & Licenses pages in that order. Section fragments above remain their editorial sources. `navigation.html` owns the shared nav markup; `frontend/site_pages.py` composes the pages and rewrites chapter links. The home contains only the player and Custom Analysis content; other chapters and their heavy scripts are loaded on their own pages. Navigation and cross-chapter links use the current tab; external references still open separately. Theme controls are shared across pages. Each secondary fragment owns a first-child `.site-page-hero` with a neutral heading and accent-colored span. Shared spacing, navigation and the lightweight animated gradient live in `frontend/site-pages.css`; the main hero remains independent. Run the same public-section build and freshness check after edits.


## Download content

`downloads.html` owns the static summary catalog above source references. `home-downloads.html` is a hidden compatibility slot. Home links to the download catalog; How to Use includes comparison-specific summary rows and exact saved-example downloads. Pan-Viral retains contextual Selected Virus and All Viruses downloads, each with one paired Summary ZIP. `summary-download-guide.md` is the downloadable field/methods guide. The renderer `frontend/summary_downloads.py` fills summary-link, label, count, directional FASTA markers from `frontend/summary-downloads.json`. Stage verified files with `tools/build_summary_downloads.py` before the public-section build. The catalog and sequence headers contain public labels; large payloads live outside Git in `frontend/source-downloads/mimicry-summaries`. Each direction has one comprehensive 16-column Summary CSV: target sequence and metadata, then Unmatched Target Regions, paired parent coverage and per-pair residue ranges at each of the three identity levels. The unmatched regions use complete comparison-population unions before the pair-list cutoff. The separate compact-list column and selectors are removed. The manifest binds each current download to its verified payload. The public-section build synchronizes the authored guide to the served download, and `--check` rejects a stale or missing served copy; guide-only edits do not require restaging the data. See the Build handbook for staging and deployment details.

The summary catalog has separate reference-population and assay-library tables. Row descriptions are authored in `downloads.html`; labels, counts, CSV links and target/comparison FASTA links come from the verified manifest. Shared format, direction, coverage and guide links belong in the introduction; native JHU/CDI joining guidance belongs in the assay introduction. HuScan self comparison remains retained but omitted from the site catalog. Do not duplicate the rows in feature cards or repeat the same guidance below each table.

The Reactivity Enrichment example uses the supplied 2026-10-18 EDGE VirScan exports in `frontend/examples/use-results/20261018`. `source-excerpt.json` records the exact source filenames, selected sample and cohort values, platform-specific 120-test BH families and significance/fold ordering. The latest source figure is `reactivity-enrichment-platforms-3.svg`, with `reactivity-enrichment-platforms-4.csv` and `reactivity-enrichment-sample-details-all-organisms-4.csv`. The displayed SVG preserves exported coordinates, counts, folds and statistics; embedded export metadata is omitted, and the display adapter inherits page fonts and neutral colors. Table values come directly from those saved CSVs, with one-decimal folds and compact scientific notation for display. No recalculation is performed on the displayed subset.

The single-sample RSV A example uses one consistently typed calculation table, including its Fisher p and Sample BH, in the left column; the right column contains the VirScan and HuProt cohort figures with two captions. The HuProt panel, `reactivity-enrichment-huprot-ebv.svg`, crops the header and EBV row from the supplied `reactivity-enrichment-platforms-5.svg`. It preserves the row-specific axis, all 35 sample coordinates and the displayed 441-antigen, 1/35-reactive, sign-p and Group-BH values. Other rows and export metadata are omitted; the original export remains unchanged. Provenance records these rounded SVG labels separately from exact VirScan CSV values. The caption distinguishes human-target reactivity, individual-sample calls and cohort consistency, retaining the full 120-test HuProt IgG correction family.
