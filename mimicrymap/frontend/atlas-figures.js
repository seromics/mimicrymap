/* Atlas-scale figures for MimicryMap.
 * Corpus figures use page theme tokens and load independently of the selected result.
 * This module owns figure geometry; reproduce/export-core.js owns shared CSV identities
 * and percentage formatting. See ../docs/wiki/development.md#atlas-display-and-csv-contracts. */
(function atlasFigures() {
  "use strict";

  // Shared client CSV identity contract; figure labels retain their own layout.
  function exportRecordColumns(role) {
    return window.MimicryExportCore.recordIdentityColumns(role).map(function (label) { return {key: label, label: label}; });
  }
  function exportRecord(record, role) {
    return window.MimicryExportCore.recordIdentity({gene: record.gene || "", source_accession: record.accession || "",
      protein_name: record.description || record.name || ""}, role);
  }
  // Definitions use the actual public CSV headings: short internal keys such as
  // c7 or s7 have different meanings on different atlas surfaces.
  function exportColumnDefinitions(columns) {
    return columns.map(function (column) {
      var label = column.label, meaning = label + ".", unit = "text";
      if (/\(%\)/.test(label)) {
        unit = "percent";
        if (/Residue Coverage|Residues Covered|Target Coverage/.test(label)) meaning += " Covered residues are the union of qualifying core positions, counting overlaps once and retaining mismatching positions; context flanks are excluded. The denominator and aggregation are the population named by the heading and methods.";
        else if (/Protein Reach/.test(label)) meaning += " Reached eligible targets divided by all eligible targets, multiplied by 100; median headings aggregate the parent-specific percentages.";
      } else if (/\(AA\)|Residues/.test(label)) unit = "residues";
      else if (/\(bp\)/.test(label)) unit = "base pairs";
      else if (/Minimum Core Identity/.test(label)) { unit = "matches out of 9"; meaning += " Minimum qualifying core identity, recorded in the format supplied by the published summary."; }
      else if (/Drawn in Figure|Has Genome Coordinate|Included in Figure/.test(label)) { unit = "boolean"; meaning += " A display/availability flag, not a missing biological measurement."; }
      else if (/Accession|Taxon ID/.test(label)) unit = "identifier";
      else if (/Gene$|Protein Name$|Organism$/.test(label)) meaning += " Original source-record annotation; it is not inferred from the displayed label.";
      else if (/Targets|Parents|Proteins|Display Order|\(rank\)/.test(label)) unit = "count or rank";
      return { key: column.key, label: label, meaning: meaning, unit: unit,
        missing: "Blank means unavailable in the published source or not applicable. Numeric zero is retained as zero." };
    });
  }

  var SVG = "http://www.w3.org/2000/svg";
  var FONT_UI = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  var T = { tick: 8, row: 9, panel: 10.5 };          /* Shared figure typography in pixels. */
  var ROW_H = 24;                                     /* Shared table row height in pixels. */
  function tokens() {
    const palette=window.SeroMapPlotPalette,role={surface:'surface',border:'line',ink:'ink',body:'body',muted:'muted',faint:'faint',grid:'grid',sel:'mimicryCore',ext:'mimicryContext'};
    return {...Object.fromEntries(Object.entries(role).map(([key,value])=>[key,palette.ref(value)])),dot:'var(--plot-dot)'};
  }

  /* Blend two CSS colors. Only #rgb and #rrggbb are understood, which is what the token set uses;
     anything else falls back to the first color rather than producing a wrong one. */
  function mix(a, b, t) {
    var parse = function (value) {
      var h = String(value || "").trim().replace("#", "");
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (!/^[0-9a-f]{6}$/i.test(h)) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    var from = parse(a), to = parse(b);
    if (!from || !to) return a;
    return "#" + from.map(function (c, i) {
      return Math.round(c * (1 - t) + to[i] * t).toString(16).padStart(2, "0");
    }).join("");
  }

  /* Release-bound corpus data. Each panel reads the active artifacts and declares
     its provenance; historical hard-coded tables are not runtime inputs. */

  /* Per-target percent covered and the per-viral-parent ranking, both baked by
     tools/bake_collection_reach.py against the active release. null until they load. */
  var COVERAGE = null, SURFACES = null;
  var COVERAGE_STATE = "idle", SURFACES_STATE = "idle";
  var ACTIVE_RELEASE_META = null;

  /* The three corpus counts in the page header, read from whatever release is answering rather
     than written into the markup. Each is left as an em dash until its source arrives, because a
     placeholder that looks like a number is the failure this replaces: the header claimed 20,876
     human proteins and 119 viral proteomes for as long as it took someone to notice, which was
     longer than it took the corpus to be rebuilt to 20,988 and the collection to reach 120. */
  function syncCorpusCounts() {
    var set = function (id, value) {
      var node = document.getElementById(id);
      if (node && value !== null && value !== undefined) node.textContent = nf(value);
    };
    var libraries = ACTIVE_RELEASE_META && ACTIVE_RELEASE_META.compute_capabilities
      && ACTIVE_RELEASE_META.compute_capabilities.libraries;
    if (libraries) {
      if (libraries.canonical_human) set("corpusHuman", libraries.canonical_human.records);
      if (libraries.canonical_exposure) set("corpusExposures", libraries.canonical_exposure.records);
    }
    if (FLEET && Array.isArray(FLEET.proteomes)) set("corpusProteomes", FLEET.proteomes.length);
  }

  /* Every proteome in the collection is baked the same way against the same release, so the
     section is selectable rather than fixed. The list comes from the bake's own index, which
     means a proteome appears here only if its payloads were actually written: a failed bake is
     absent from the index and therefore absent from the menu, instead of offering a choice that
     resolves to a missing file. */
  var FLEET = null, PROTEOME_SLUG = "";
  var PROTEOME = "Epstein-Barr virus";
  var DEFAULT_SLUG = "epstein_barr_virus";
  var INDEX_URL = "/data/collection-coverage/index.json";
  var COVERAGE_URL = "/data/collection-coverage/" + DEFAULT_SLUG + ".json.gz";
  var SURFACES_URL = "/data/collection-coverage/" + DEFAULT_SLUG + ".surfaces.json.gz";
  /* Per-viral-protein surfaces. The coverage payload above is the whole proteome pooled; this
     tree carries the same measurement decomposed, one file per viral protein, over the same
     human records in the same order. Reach is deliberately not offered per protein: against a
     single protein a human record is reached or it is not, so a reach track would be a row of
     noughts and ones rather than a measurement. Coverage stays a percentage either way. */
  var PROTEIN_INDEX_URL = "/data/collection-protein-surfaces/" + DEFAULT_SLUG + "/index.json";
  var PROTEIN_INDEX = null, PROTEIN_INDEX_STATE = "loading";
  var PROTEIN_SOURCE = null, PROTEIN_SURFACE = null, PROTEIN_SURFACE_STATE = "";
  var PROTEOME_REQUEST = 0, SOURCE_REQUEST = 0;
  /* Every human record's closest viral partner, pooled coverage and partner count, staged for the
     whole library rather than the few hundred the served payload retains. Loaded only when an
     export asks for it: the figure draws a ranked top slice and most readers never need the rest,
     so this is not part of the page's own weight. */
  var ALL_RECORDS = null, ALL_RECORDS_SLUG = "", ALL_RECORDS_PENDING = null;
  /* The staged source sequences, one FASTA per proteome. Collection-wide and small, so the index
     is fetched once and only tells the control which proteomes have a file and how big it is; the
     file itself is never loaded here, the browser fetches it when the reader asks for it. */
  var SEQUENCES = null, SEQUENCE_DOWNLOADS = null;

  /* Export filenames carry the proteome, so a harvest of the whole collection does not land
     120 files that all claim to be the same virus. */
  /* Read at click time, not at spec-build time: the figure specs are constructed once,
     so an eagerly evaluated name would label every proteome's export as the first one. */
  function exportName(suffix) { return ((PROTEOME_SLUG || DEFAULT_SLUG) + "_" + suffix).replace(/_+/g, "_"); }

  /* The collection index stores protein reach and pooled residue coverage separately. */
  var FLEET_STATE = "loading";
  var COLLECTION_METRIC = "coverage";
  // Scatter highlighting is independent of the genome figure's selected parent.
  var COLLECTION_UNIT = "proteomes", COLLECTION_SOURCE = null;
  /* The spread figure's own measure, independent of the collection scatter's. Reach is the share
     of eligible human proteins one viral protein reaches; residue coverage is the share of all
     eligible human residues that same protein covers. A protein can be high on one and low on
     the other, which is the comparison the toggle exists to make. */
  var SPREAD_METRIC = "reach";
  var COLLECTION_FLOORS = ["5", "7"];
  var COLLECTION_EXPORT_FLOORS = ["5", "6", "7", "8", "9"];
  function collectionTitle() {
    if (COLLECTION_UNIT === "parents") return COLLECTION_METRIC === "reach"
      ? (/*@copy atlas-figures.collection-parent-reach-title*/`Human Protein Reach vs Viral Parent Length`/*@endcopy*/) : (/*@copy atlas-figures.collection-parent-coverage-title*/`Human Residue Coverage vs Viral Parent Length`/*@endcopy*/);
    return COLLECTION_METRIC === "reach" ? (/*@copy atlas-figures.title-collection-reach*/`Human Protein Reach vs Viral Proteome Length`/*@endcopy*/) : (/*@copy atlas-figures.title-collection*/`Human Residue Coverage vs Viral Proteome Length`/*@endcopy*/);
  }
  function collectionAxis() {
    return COLLECTION_METRIC === "reach" ? (/*@copy atlas-figures.collection-reach-axis*/`Human Protein Reach`/*@endcopy*/) : (/*@copy atlas-figures.collection-coverage-axis*/`Human Residue Coverage`/*@endcopy*/);
  }
  // The small roster already carries both measures and their full-human denominators.
  // Reading it neither fetches detailed positions nor adds percentages to simulate pooling.
  function collectionParentRows() {
    if (!PROTEIN_INDEX) return [];
    return PROTEIN_INDEX.sources.map(function (source, index) {
      var row = { sourceIndex: index, antigenId: source.antigen_id,
        gene: source.gene || source.accession || String(source.antigen_id),
        accession: source.accession || "", name: source.description || "", len: source.length_aa,
        eligible: PROTEIN_INDEX.eligible_human_records, residues: PROTEIN_INDEX.eligible_human_residues };
      (source.summary || []).forEach(function (entry) {
        var floor = String(entry.floor);
        row["r" + floor] = entry.human_records_reached;
        row["rp" + floor] = entry.human_protein_reach_percent;
        row["c" + floor] = entry.human_residues_covered;
        row["cp" + floor] = entry.human_library_residue_coverage_percent;
      });
      return Object.assign(row, exportRecord(source, "Mimicry Parent"));
    });
  }

  function collectionSelectedLabel() {
    var source = PROTEIN_INDEX && COLLECTION_SOURCE != null && PROTEIN_INDEX.sources[COLLECTION_SOURCE];
    if (!source) return "";
    return [source.gene || source.accession || String(source.antigen_id), source.accession]
      .filter(function (value, i, values) { return value && values.indexOf(value) === i; }).join(" · ");
  }

  function highlightCollectionSource(index) {
    if (index != null && (!PROTEIN_INDEX || !PROTEIN_INDEX.sources[index])) return;
    var focused = document.activeElement;
    var floor = focused && focused.getAttribute("data-collection-floor");
    COLLECTION_SOURCE = index;
    renderCollection();
    if (floor && index != null) {
      var dot = document.querySelector('#atlasCollection [data-collection-floor="' + floor + '"][data-source-index="' + index + '"]');
      if (dot) dot.focus({ preventScroll: true });
    }
  }

  function collectionFilename(data) {
    var name = data ? "human_protein_reach_and_residue_coverage" : COLLECTION_METRIC === "reach"
      ? "human_protein_reach" : "human_residue_coverage";
    if (COLLECTION_UNIT === "proteomes") return name + "_vs_viral_proteome_length";
    name = exportName(name + "_vs_viral_parent_length");
    // The CSV contains every component; an image also records its highlighted component.
    if (!data && COLLECTION_SOURCE != null) name += "_highlight_" + String(COLLECTION_SOURCE + 1).padStart(4, "0")
      + "_" + safeName(collectionSelectedLabel());
    return name;
  }

  function collectionRows(floor, metric) {
    var selected = metric || COLLECTION_METRIC;
    if (COLLECTION_UNIT === "parents") {
      return collectionParentRows().filter(function (row) {
        var value = row[(selected === "reach" ? "rp" : "cp") + floor];
        return Number(row.len) > 0 && value != null && Number.isFinite(Number(value));
      }).map(function (row) {
        return { slug: PROTEOME_SLUG, label: row.gene, accession: row.accession, name: row.name,
          sourceIndex: row.sourceIndex, eligible: row.eligible, total: row.residues, covered: row["c" + floor],
          reach: row["rp" + floor], coverage: row["cp" + floor], x: Number(row.len),
          y: Number(row[(selected === "reach" ? "rp" : "cp") + floor]) };
      });
    }
    if (!FLEET) return [];
    return FLEET.proteomes.filter(function (entry) {
      var values = (selected === "reach" ? entry.reach : entry.pooled_covered_percent) || {};
      return Number(entry.proteome_length_aa) > 0 && values[floor] != null && Number.isFinite(Number(values[floor]));
    }).map(function (entry) {
      var reach = (entry.reach || {})[floor], coverage = (entry.pooled_covered_percent || {})[floor];
      return { slug: entry.slug, label: entry.label, organism: entry.organism,
        taxon: entry.taxon_id, records: entry.source_records, eligible: entry.eligible_records,
        covered: (entry.residues_covered || {})[floor], total: entry.residues_total,
        reach: reach, coverage: coverage,
        x: Number(entry.proteome_length_aa), y: Number(selected === "reach" ? reach : coverage) };
    });
  }

  function collectionFigure(C) {
    /* Sized like the other half-width panels in this section rather than to its own taste. */
    var parents = COLLECTION_UNIT === "parents";
    if (parents && !PROTEIN_INDEX) return loadingFrame(C, 720, "Viral parents", PROTEIN_INDEX_STATE);
    if (!parents && (!FLEET || !collectionRows("5").length)) return loadingFrame(C, 720, "Collection", FLEET_STATE);
    var W = 720, PAD = 12, AXIS = 44, GAP = 34;
    var PLOT = Math.round((W - 2 * PAD - 2 * AXIS - GAP) / 2);
    var TOP = 46, H = TOP + PLOT + 52;
    var svg = frame(W, H, collectionTitle());
    svg.setAttribute("data-metric", COLLECTION_METRIC);
    svg.setAttribute("data-unit", COLLECTION_UNIT);
    if (parents) svg.setAttribute("data-proteome", PROTEOME_SLUG);
    COLLECTION_FLOORS.forEach(function (floor, column) {
      var rows = collectionRows(floor);
      var x0 = PAD + AXIS + column * (AXIS + PLOT + GAP), x1 = x0 + PLOT;
      var y0 = TOP, y1 = TOP + PLOT;
      /* Each plot is scaled to the range its own floor reaches, and says so in its heading.
         Pooled coverage runs to 99.9% at 5/9 but under 6% at 7/9, so one shared axis would draw
         the strict plot as a line along the baseline. The cost is that heights are not
         comparable between the two plots, which is why each states its maximum. */
      var reach = Math.max.apply(null, rows.map(function (r) { return r.y; }).concat([1]));
      var top = reach > 50 ? 100 : Math.ceil(reach);
      /* Linear in residues, from zero so a length reads as a length. Most of the collection
         is small, so most points sit in the left of the plot; that crowding is the shape of the
         corpus - a few herpes and pox proteomes carry an order of magnitude more protein than
         the rest - rather than something the axis should hide. */
      var lo = 0;
      /* The axis ends on a round multiple of four rather than on the longest proteome, so it
         carries the same five ticks as the coverage axis - zero, quarters, midpoint, end - and
         the two axes read as one grid instead of four marks against five. */
      var reachX = Math.max.apply(null, rows.map(function (r) { return r.x; }));
      var hi = Math.ceil(reachX / 4000) * 4000;
      if (parents) {
        var quarter = Math.max(reachX / 4, 1), power = Math.pow(10, Math.floor(Math.log10(quarter)));
        var step = [1, 2, 5, 10].find(function (value) { return value * power >= quarter; }) * power;
        hi = 4 * step;
      }
      var sx = function (v) { return x0 + (v - lo) / (hi - lo) * PLOT; };
      var sy = function (v) { return y1 - (v / top) * PLOT; };

      /* Each plot carries the heading and rule figureHeading draws for a full-width figure,
         scoped to this column. */
      var left = x0 - AXIS;
      /* Both plots are titled, each with its own threshold, because they are two answers to the
         same question and a reader looking at one should not have to find the other's header to
         learn which threshold it is. The range follows at the right edge; the two are scaled
         separately and their heights are not comparable. */
      var range = "0–" + top + "%";
      svg.appendChild(txFit(left, TOP - 24, plotTitle() + HEAD_DIV + "≥" + floor + "/9",
        (x1 - left) - range.length * T.tick * 0.53 - 6, { weight: 600, fill: C.ink }));
      svg.appendChild(tx(x1, TOP - 24, range, { fill: C.ink, anchor: "end", size: T.tick }));
      svg.appendChild(el("line", { x1: left, x2: x1, y1: TOP - 16, y2: TOP - 16,
        stroke: C.ink, "stroke-width": 1 }));

      /* Same treatment as every other plot in the section: tick labels are ink, gridlines are
         the grid gray. This figure kept body-gray numbers over border-gray rules on a sand
         ground, which read as washed out in light mode and was the one panel whose axis did not
         match the ones beneath it. */
      [0, hi / 4, hi / 2, 3 * hi / 4, hi].forEach(function (tick) {
        svg.appendChild(el("line", { x1: sx(tick), x2: sx(tick), y1: y0, y2: y1,
          stroke: C.grid, "stroke-opacity": 0.7 }));
        svg.appendChild(tx(sx(tick), y1 + 14, parents ? nf(tick) : tick ? (tick / 1000) + "k" : "0",
          { size: T.tick, fill: C.ink, anchor: "middle" }));
      });
      [0, top / 4, top / 2, 3 * top / 4, top].forEach(function (tick) {
        svg.appendChild(el("line", { x1: x0, x2: x1, y1: sy(tick), y2: sy(tick),
          stroke: C.grid, "stroke-opacity": 0.7 }));
        svg.appendChild(tx(x0 - 5, sy(tick) + 3, (Math.round(tick * 10) / 10) + "%",
          { size: T.tick, fill: C.ink, anchor: "end" }));
      });

      // Draw the selected component last so coincident points cannot hide its highlight.
      if (parents) rows.sort(function (a, b) { return (a.sourceIndex === COLLECTION_SOURCE ? 1 : 0) - (b.sourceIndex === COLLECTION_SOURCE ? 1 : 0); });
      if (parents) svg.appendChild(txFit((x0 + x1) / 2, TOP - 4, PROTEOME, PLOT,
        { size: T.tick, fill: C.ink, anchor: "middle" }));
      rows.forEach(function (r) {
        var here = parents ? r.sourceIndex === COLLECTION_SOURCE : r.slug === PROTEOME_SLUG;
        /* A point is a proteome, so clicking one opens it: the figure is a way into the
           collection rather than a picture of it. */
        var dot = el("circle", { cx: sx(r.x), cy: sy(r.y), r: here ? 4.4 : 2.6,
          /* The cloud is the same near-white the chromosome tracks alternate against. The faint
             gray it used measured about 1.9:1 against this ground -- points a reader has to hunt
             for. The selected proteome keeps the accent so it still separates from the cloud. */
          fill: here ? C.sel : C.ink, "fill-opacity": here ? 1 : 0.65,
          stroke: here ? C.ink : "none", "stroke-width": here ? 1 : 0,
          tabindex: 0, role: "button", cursor: "pointer",
          "aria-label": parents ? (/*@copy atlas-figures.collection-highlight-parent*/`Highlight ${[r.label, r.accession].filter(Boolean).join(" · ")}`/*@endcopy*/) : "Show " + r.label,
          "aria-pressed": String(here), "data-collection-floor": floor,
          "data-source-index": parents ? r.sourceIndex : "", "data-selected": String(here),
          "data-tooltip": r.label + (parents ? " · " + r.accession + "\n" + r.name : r.taxon ? " \u00b7 NCBI taxon " + r.taxon : "")
            + "\n" + (parents ? "" : nf(r.records) + " proteins \u00b7 ") + nf(r.x) + " AA"
            + "\n" + (/*@copy atlas-figures.collection-point-measures*/`At ≥${floor}/9: human protein reach ${pct(r.reach)}%; human residue coverage ${pct(r.coverage)}%.`/*@endcopy*/)
            + "\n" + (/*@copy atlas-figures.collection-point-denominators*/`${nf(r.eligible)} eligible human proteins · ${nf(r.total)} human residues`/*@endcopy*/)
            + (r.covered != null && r.total ? "\n" + nf(r.covered) + " of " + nf(r.total) + " residues covered" : "")
            + "\n" + (parents ? (/*@copy atlas-figures.collection-click-parent*/`Click to highlight this viral parent`/*@endcopy*/) : (/*@copy atlas-figures.collection-click-proteome*/`Click to open this proteome`/*@endcopy*/)) });
        function chooseDot() { if (parents) highlightCollectionSource(r.sourceIndex); else selectProteome(r.slug); }
        dot.addEventListener("click", chooseDot);
        dot.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault(); chooseDot();
          }
        });
        svg.appendChild(dot);
        if (here) {
          var right = sx(r.x) < (x0 + x1) / 2;
          svg.appendChild(txFit(sx(r.x) + (right ? 8 : -8), Math.max(y0 + 12, sy(r.y) - 8),
            parents ? collectionSelectedLabel() : r.label,
            Math.max(40, right ? x1 - sx(r.x) - 10 : sx(r.x) - x0 - 10),
            { size: T.tick, weight: 600, fill: C.ink, anchor: right ? "start" : "end" }));
        }
      });
      svg.appendChild(tx((x0 + x1) / 2, y1 + 32, parents ? (/*@copy atlas-figures.collection-parent-length-axis*/`Viral Parent Length (AA)`/*@endcopy*/) : (/*@copy atlas-figures.proteome-length-axis*/`Viral Proteome Length (AA)`/*@endcopy*/),
        { size: T.tick, weight: 600, fill: C.ink, anchor: "middle" }));
    });
    var across = el("text", { x: PAD + 2, y: TOP + PLOT / 2, fill: C.ink,
      "font-size": T.tick, "font-weight": 600, "text-anchor": "middle",
      transform: "rotate(-90 " + (PAD + 2) + " " + (TOP + PLOT / 2) + ")" },
      collectionAxis());
    svg.appendChild(across);
    return svg;
  }

  /* Declared the same way as the five panels below, so buildPanel gives it the same box. */
  var COLLECTION_FIG = {
    key: "collection",
    topic: collectionTitle,
    metric: { label: (/*@copy atlas-figures.collection-metric-control*/`Collection Plot Measure`/*@endcopy*/),
      get: function () { return COLLECTION_METRIC; },
      set: function (value) { COLLECTION_METRIC = value; },
      options: [["reach", (/*@copy atlas-figures.collection-reach-button*/`Reach`/*@endcopy*/)],
        ["coverage", (/*@copy atlas-figures.collection-coverage-button*/`Residue Coverage`/*@endcopy*/)]] },
    controls: buildCollectionControls,
    selection: function () { return [COLLECTION_UNIT, COLLECTION_SOURCE]; },
    build: function (C) { return collectionFigure(C); },
    file: function () { return collectionFilename(false); },
    dataFile: function () { return collectionFilename(true); },
legend: function () {
      if (COLLECTION_UNIT === "parents") {
        var highlight = COLLECTION_SOURCE == null ? (/*@copy atlas-figures.collection-parent-all-legend*/`All component proteins are shown.`/*@endcopy*/) : (/*@copy atlas-figures.collection-parent-highlight-legend*/`The highlighted point is ${collectionSelectedLabel()}.`/*@endcopy*/);
        var measure = COLLECTION_METRIC === "reach" ? (/*@copy atlas-figures.collection-parent-reach-legend*/`The Y-axis shows human protein reach: the percentage of eligible human proteins matched at least once by that viral protein at the indicated core identity threshold.`/*@endcopy*/) : (/*@copy atlas-figures.collection-parent-coverage-legend*/`The Y-axis shows the percentage of eligible human residues covered by that viral protein’s matches at the indicated core identity threshold.`/*@endcopy*/);
        var overlaps = COLLECTION_METRIC === "reach" ? "" : (/*@copy atlas-figures.collection-parent-overlaps-legend*/`Overlapping cores count once, including mismatching positions; context flanks are excluded. `/*@endcopy*/);
        return (/*@copy atlas-figures.collection-parent-scientific-legend*/`Each point represents one viral parent in ${PROTEOME}. ${highlight} The X-axis shows protein length. ${measure} The denominator includes ${nf(PROTEIN_INDEX && PROTEIN_INDEX.eligible_human_records)} human records of at least ${MIN_LENGTH_AA} residues (${nf(PROTEIN_INDEX && PROTEIN_INDEX.eligible_human_residues)} residues in total). ${overlaps}Each threshold panel has its own Y-axis range.`/*@endcopy*/);
      }
      var first=FLEET && FLEET.proteomes[0]||{}, total=first.residues_total, recs=first.eligible_records;
      return (/*@copy atlas-figures.collection-scientific-legend*/`Each point represents one viral proteome; the highlighted point is the selected proteome. The X-axis shows the total length of its protein sequences. ${COLLECTION_METRIC === 'reach' ? 'The Y-axis shows human protein reach: the percentage of eligible human targets matched at least once by any protein in that proteome at the indicated core identity threshold.' : 'The Y-axis shows the percentage of all eligible human residues covered by matches to those proteins at the indicated core identity threshold.'} The denominator includes ${total && recs ? nf(recs)+' human records of at least '+MIN_LENGTH_AA+' residues ('+nf(total)+' residues in total)' : 'the full eligible human population'}. ${COLLECTION_METRIC === 'reach' ? '' : 'Overlapping cores count once, including mismatching positions; context flanks are excluded. '}Each threshold panel has its own Y-axis range.`/*@endcopy*/);
    },
    columns: function () {
      if (COLLECTION_UNIT === "parents") return sourceProteinColumns();
      return [{ key: "label", label: (/*@copy atlas-figures.proteome.2eb24d2*/`Viral Proteome`/*@endcopy*/) },
      { key: "organism", label: (/*@copy atlas-figures.source-organism.8c45e53*/`Viral Parent Organism`/*@endcopy*/) }, { key: "taxon", label: (/*@copy atlas-figures.ncbi-taxon-id.cea1e3f*/`NCBI Taxon ID`/*@endcopy*/) },
      { key: "records", label: (/*@copy atlas-figures.source-proteins.e7e0813*/`Viral Parents`/*@endcopy*/) },
      { key: "len", label: (/*@copy atlas-figures.proteome-length-aa.8bd38c2*/`Viral Proteome Length (AA)`/*@endcopy*/) },
      { key: "total", label: (/*@copy atlas-figures.human-residues-in-analysis-universe.6bf9e5b*/`Antigen Target Eligible Residues`/*@endcopy*/) },
      { key: "eligible", label: (/*@copy atlas-figures.collection-human-proteins-denominator*/`Eligible Antigen Targets`/*@endcopy*/) }]
      /* Export every threshold carried by the payload, with headers derived from those
         thresholds. The selected figure thresholds do not limit the CSV columns. */
      .concat(COLLECTION_EXPORT_FLOORS.reduce(function (cols, floor) {
        return cols.concat([
          { key: "c" + floor, label: (/*@copy atlas-figures.human-residues-covered-at.44ae243*/`Antigen Target Covered Residues at ≥${floor}/9`/*@endcopy*/) },
          { key: "m" + floor, label: (/*@copy atlas-figures.percent-of-human-proteome-covered.6bf9121*/`Human Residue Coverage (%) at ≥${floor}/9`/*@endcopy*/) },
          { key: "r" + floor, label: (/*@copy atlas-figures.collection-reach-csv*/`Human Protein Reach (%) at ≥${floor}/9`/*@endcopy*/) }]);
      }, []));
    },
    rows: function () {
      if (COLLECTION_UNIT === "parents") return collectionParentRows();
      var bySlug = {};
      COLLECTION_EXPORT_FLOORS.forEach(function (floor) {
        collectionRows(floor, "coverage").forEach(function (r) {
          if (!bySlug[r.slug]) {
            bySlug[r.slug] = { slug: r.slug, label: r.label, organism: r.organism,
              taxon: r.taxon, records: r.records, len: r.x, total: r.total, eligible: r.eligible };
          }
          bySlug[r.slug]["m" + floor] = r.coverage;
          bySlug[r.slug]["r" + floor] = r.reach;
          bySlug[r.slug]["c" + floor] = r.covered;
        });
      });
      return Object.keys(bySlug).map(function (slug) { return bySlug[slug]; });
    },
  };

  function buildCollectionControls() {
    var row = document.createElement("div"); row.className = "af-collection-controls";
    function field(text, control) {
      var wrapper = document.createElement("div"); wrapper.className = "af-sourcepick";
      var label = document.createElement("span"); label.className = "af-sourcepick-label"; label.textContent = text;
      wrapper.append(label, control); row.appendChild(wrapper);
    }
    var unitLabel = (/*@copy atlas-figures.collection-unit-control*/`Plot Unit`/*@endcopy*/);
    var unit = searchSelect({ id: "atlasCollectionUnit", searchable: false, label: unitLabel,
      value: function () { return COLLECTION_UNIT; },
      items: function () { return [
        { value: "proteomes", label: (/*@copy atlas-figures.collection-unit-proteomes*/`Viral Proteomes`/*@endcopy*/) },
        { value: "parents", label: (/*@copy atlas-figures.collection-unit-parents*/`Individual Viral Parents`/*@endcopy*/) }]; },
      onChange: function (value) { COLLECTION_UNIT = value; renderCollection(); }
    });
    field(unitLabel, unit);
    var parent = searchSelect({ id: "atlasCollectionParent", label: (/*@copy atlas-figures.collection-highlight-control*/`Highlight Viral Parent`/*@endcopy*/),
      searchLabel: (/*@copy atlas-figures.parent-search*/`Search Viral Parents…`/*@endcopy*/),
      empty: (/*@copy atlas-figures.parent-no-results*/`No viral parents match your search.`/*@endcopy*/),
      count: function () { return (/*@copy atlas-figures.parent-option-count*/`${PROTEIN_INDEX ? PROTEIN_INDEX.sources.length : 0} viral parents in this proteome`/*@endcopy*/); },
      disabled: function () { return COLLECTION_UNIT !== "parents" || !PROTEIN_INDEX; },
      value: function () { return COLLECTION_SOURCE == null ? "" : String(COLLECTION_SOURCE); },
      items: function () {
        return [{ value: "", label: (/*@copy atlas-figures.collection-highlight-all*/`All Viral Parents`/*@endcopy*/) }].concat(PROTEIN_INDEX ? PROTEIN_INDEX.sources.map(function (source, index) {
          return { value: String(index), label: source.gene || source.accession || String(source.antigen_id),
            detail: [source.accession, source.description].filter(Boolean).join(" · ") };
        }) : []);
      },
      onChange: function (value) { highlightCollectionSource(value === "" ? null : Number(value)); }
    });
    field((/*@copy atlas-figures.coverage-source-label*/`Viral Parent`/*@endcopy*/), parent);
    return { host: row, update: function () { unit.update(); parent.update(); } };
  }

  function renderCollection() {
    var host = document.getElementById("atlasCollection");
    if (!host) return;
    var panel = host.querySelector(".af-panel");
    if (panel) panel.refresh(tokens());
    else host.appendChild(buildPanel(COLLECTION_FIG, tokens()));
  }


  /* ---- one record universe, used by every figure in this section ----
     The chromosome plot, the individual-records table and the collection scatter above all
     use the same eligible human records. Reach counts records; coverage counts residues.
     Their shared population does not make the two percentages interchangeable.

     A record is in the universe when it carries at least one nine-residue window and is at
     least MIN_LENGTH_AA long. The window rule is what makes a record evaluable at all: nothing
     shorter than nine residues has a window to match, and such a record is null rather than
     zero. The length rule is what makes one record's percentage comparable to another's: a
     15 aa fragment is spanned by seven windows, so a single match moves it 60 points and it
     crowds the top of every ranking on an artifact of its length rather than on resemblance.

     A missing genome coordinate is deliberately NOT part of the universe. Being unplaceable on
     a chromosome axis is a limit of one figure's cartography, not a property of the record, so
     those records stay in every statistic and are missing only from the plot - which states how
     many, while the table marks the rows it lists that the plot cannot show. Gating a coverage
     statistic on a coordinate would have dropped 1,310 real human records from a number that
     claims to describe the human proteome. */
  var MIN_LENGTH_AA = 50;

  /* Measured from the payload rather than written down beside it, so the counts in the text
     cannot drift away from the records the figures actually use. */
  function universe() {
    if (!COVERAGE) return null;
    var records = 0, residues = 0, noWindow = 0, tooShort = 0;
    COVERAGE.points.forEach(function (p) {
      if (p.covered[String(TRACKS[0].floor)] === null) { noWindow += 1; return; }
      if (p.length_aa < MIN_LENGTH_AA) { tooShort += 1; return; }
      records += 1;
      residues += p.length_aa;
    });
    return { records: records, residues: residues, noWindow: noWindow, tooShort: tooShort,
      total: COVERAGE.points.length };
  }

  /* Which universe members the genome axis could place at a real coordinate. Every record is
     drawn now, so this is no longer "is it in the figure" - it is "is it on the genome or in
     NA", which is what the export column reports. */
  function placedIds() {
    var set = {}, na = CHROMS.indexOf(NA_BAND);
    coveragePoints().points.forEach(function (p) { if (p.ci !== na) set[p.id] = true; });
    return set;
  }

  /* Every floor, loosest first: the whole identity ladder on one genome axis. 5 of 9 saturates,
     nearly every human record covered end to end, so that track reads as a band pinned to the
     ceiling. That is the finding, not a failed plot, and carrying all five floors is what lets a
     reader watch the band come apart rather than take one floor's picture on trust.
     A saturated track gets no leader labels: when the median record is already covered end to
     end, "the top five" names whichever records happen to round highest, not records that stand
     out from anything. Naming them would read as a finding. */
  var TRACKS = [{ floor: 5, label: (/*@copy atlas-figures.of.da80b9c*/`5 of 9`/*@endcopy*/), leaders: false },
    { floor: 6, label: (/*@copy atlas-figures.of.6092a62*/`6 of 9`/*@endcopy*/), leaders: true },
    { floor: 7, label: (/*@copy atlas-figures.of.818258b*/`7 of 9`/*@endcopy*/), leaders: true },
    { floor: 8, label: (/*@copy atlas-figures.of.f246de7*/`8 of 9`/*@endcopy*/), leaders: true },
    { floor: 9, label: (/*@copy atlas-figures.of.f68e1a6*/`9 of 9`/*@endcopy*/), leaders: true }];
  /* One track's drawing height. The frame grows with the number of tracks rather than dividing a
     fixed height between them, so a track never silently shrinks when a floor is added. 120 is the
     height at which five tracks still fit a screen; a 0-to-100 axis stays legible well below it. */
  var TRACK_H = 120, TRACK_GAP = 26, FRAME_HEAD = 44, FRAME_FOOT = 40;

  /* The left gutter holds the floor name ("7 of 9") at x=12 and the axis numbers immediately
     left of the plot. At the old 54 the two overlapped: "100" ended at x=48, straight through
     the floor name. The gutter is now wide enough to seat both without either moving. */
  var PLOT_LEFT = 112, PLOT_RIGHT = 14;

  /* Leader-label nudging. A label may step this far to clear a neighbor and no further; past
     that it is dropped, because a name floating well above its dot mislabels the figure. */
  var LABEL_GAP = 9, LABEL_MAX_STEPS = 2;

  /* Radius of one viral parent in the spread panel; vertical dodging separates
     overlapping points within the available row height. */
  var DOT_R = 2;

  /* The floor a single-threshold panel reports at, and the one the source ranking is ordered by.
     Held separately from TRACKS: reading it as "the first track" silently reported 5 of 9 counts
     under a 7 of 9 heading the moment 5 of 9 was added to the front of the track list. */
  var WORKING_FLOOR = 7;
  /* Per-figure identity floor, for the figures that offer the control. Keyed by figure, because
     the choice belongs to the figure being read rather than to the page: two ranked tables are
     often worth reading at two different thresholds at once. Absent means the shared default. */
  var FIGURE_FLOOR = {};
  function floorForKey(key) {
    var chosen = FIGURE_FLOOR[key];
    return chosen === undefined ? WORKING_FLOOR : chosen;
  }
  function figureFloor(f) { return floorForKey(f.key); }
  function workingLabel() {
    var t = TRACKS.filter(function (x) { return x.floor === WORKING_FLOOR; })[0];
    return t ? t.label : WORKING_FLOOR + " of 9";
  }

  function series(parts) {
    return parts.join(", ").replace(/, ([^,]*)$/, " and $1");
  }

  /* Absent counts print as 0. The distinction this used to draw - "no data" for an absent value,
     so it could not be read as a measured zero - is real in general but not here: every count in
     this section is over a population the figure has in hand, so a floor with no entry is a floor
     nothing reached. "no data" said the measurement was missing when the measurement is zero,
     which is the less honest of the two readings and the harder one to scan in a table. */
  var nf = function (v) {
    return (v === null || v === undefined) ? "0" : Number(v).toLocaleString("en-US");
  };

  /* A share short of the whole must never round up to 100, nor a real one down to 0. At 5 of 9,
     20,860 of 20,869 records match: printing "100.0" there erases the nine that do not. */
  function pct(value) {
    if (value === null || value === undefined) return "";
    /* A true zero is 0, not 0.0. The decimal is there to separate values that differ in the
       tenths; nothing differs from zero in the tenths, and "0.0" reads as a rounded small
       number rather than as none. */
    if (value === 0) return "0";
    if (value > 0 && value < 0.05) return "<0.1";
    if (value < 100 && value >= 99.95) return ">99.9";
    return value.toFixed(1);
  }

  function el(tag, a, t) {
    var n = document.createElementNS(SVG, tag);
    for (var k in a) if (a[k] !== undefined && a[k] !== null) n.setAttribute(k, a[k]);
    if (t !== undefined) n.textContent = t;
    return n;
  }
  function tx(x, y, s, o) {
    o = o || {};
    return el("text", { x: x, y: y, "font-size": o.size || T.row, "font-weight": o.weight || 400,
      fill: o.fill, "text-anchor": o.anchor || "start" }, s);
  }
  /* ~0.55em per character at the weights used here, minus the 8px cell padding. */
  function ellipsise(text, widthPx, size, weight) {
    var per = (size || T.row) * (weight >= 600 ? 0.58 : 0.53);
    var budget = Math.max(3, Math.floor((widthPx - 10) / per));
    return text.length <= budget ? text : text.slice(0, budget - 1).trim() + "…";
  }

  /* tx() with the shared styled tooltip carrying the untruncated string. */
  function txFit(x, y, text, widthPx, o) {
    o = o || {};
    var node = tx(x, y, ellipsise(text, widthPx, o.size || T.row, o.weight || 400), o);
    if (node.textContent !== text) node.setAttribute("data-tooltip", text);
    return node;
  }

  function frame(W, H, title) {
    var s = el("svg", { viewBox: "0 0 " + W + " " + H, class: "af-svg", role: "img",
      "aria-label": title, "data-tooltip": title,
      preserveAspectRatio: "xMidYMid meet",
      style: "max-width:" + W + "px" });
    return s;
  }

  /* The composed on-plot name of the figure being built: its own title and the scope it is drawn
     over. buildFigure sets it immediately before handing off to f.build, so one place decides the
     wording and every figure prints the same thing its panel heading and filename carry instead of
     each re-deriving it. A single variable is safe because building is synchronous. */
  var PLOT_TITLE = "";
  function plotTitle() { return PLOT_TITLE; }

  /* ---- release identity ---- */
  function metadataFingerprint(metadata) {
    if (!metadata || typeof metadata !== "object") return "";
    var value = String(metadata.analysis_release_fingerprint
      || metadata.release_fingerprint || "").trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(value) ? value : "";
  }

  /* Which release-bound artifact each panel's numbers come from. A panel absent from this map
     reports no artifact identity and is labeled historical, which is the safe default. */
  var FIGURE_ARTIFACT = {
    /* The fleet index is the collection figure's artifact: it carries the release every payload
       summarized in it was baked from. The library pair is the same for all 120 and is read off
       the loaded payload rather than restated here, so the two cannot drift apart; if that
       payload is from a different release than the index, the figure claims nothing. */
    collection: function () {
      if (!FLEET || !COVERAGE) return null;
      if (COVERAGE.release_fingerprint !== FLEET.release_fingerprint) return null;
      return { release_fingerprint: FLEET.release_fingerprint,
        target_library: COVERAGE.target_library, source_library: COVERAGE.source_library };
    },
    coverage: function () { return COVERAGE; },
    sources: function () { return SURFACES; },
    targets: function () { return COVERAGE; },
    ladder: function () { return SURFACES; },
    spread: function () { return SURFACES; },
  };

  function figureArtifactMetadata(fig) {
    if (!fig || !FIGURE_ARTIFACT[fig.key]) return null;
    return FIGURE_ARTIFACT[fig.key]();
  }

  /* The runtime is composite: /api/analysis/meta reports a fingerprint hashed over every
     component, which no single component's artifact can ever equal. Comparing against it would
     mark a current artifact historical forever. Resolve the component that actually owns the
     libraries this figure was built from, and compare against that component's release. */
  function componentFingerprint(meta, libraries) {
    if (!meta || !Array.isArray(meta.component_releases) || !Array.isArray(meta.libraries)) return "";
    var keys = [];
    libraries.forEach(function (library) {
      var row = meta.libraries.filter(function (l) { return l.key === library; })[0];
      if (row && keys.indexOf(row.component_key) < 0) keys.push(row.component_key);
    });
    /* A figure spanning two components has no single release identity to claim. */
    if (keys.length !== 1) return "";
    var component = meta.component_releases.filter(function (c) { return c.key === keys[0]; })[0];
    return component ? metadataFingerprint(component) : "";
  }

  function figureLibraries(fig) {
    var artifact = figureArtifactMetadata(fig);
    if (!artifact) return [];
    return [artifact.target_library, artifact.source_library].filter(Boolean);
  }

  /* An older plot remains useful when its source artifact is not release-bound, but it must
     not silently inherit the active player's identity. A future artifact becomes current only
     when its own 64-hex fingerprint matches the release of the component it was built from. */
  function figureProvenanceStatus(fig) {
    var active = componentFingerprint(ACTIVE_RELEASE_META, figureLibraries(fig))
      || metadataFingerprint(ACTIVE_RELEASE_META);
    var artifact = metadataFingerprint(figureArtifactMetadata(fig));
    if (!artifact) return {
      current: false,
      label: (/*@copy atlas-figures.historical-reference.c1b7f5e*/`historical reference`/*@endcopy*/),
      detail: "Historical reference: the source artifact has no release fingerprint, so compatibility "
        + "with " + (active ? "the active analysis release" : "the active analysis release (not available)")
        + " cannot be verified."
    };
    if (!active) return {
      current: false,
      label: (/*@copy atlas-figures.release-unverified.264d192*/`release unverified`/*@endcopy*/),
      detail: "Release unverified: the figure artifact is fingerprinted, but the active analysis release "
        + "could not be read for comparison."
    };
    if (artifact !== active) return {
      current: false,
      label: (/*@copy atlas-figures.historical-reference.baa5bb3*/`historical reference`/*@endcopy*/),
      detail: "Historical reference: this figure belongs to a different analysis release and is not a "
        + "current-release completeness statement."
    };
    return {
      current: true,
      label: (/*@copy atlas-figures.current-release-verified.7916e0a*/`current release verified`/*@endcopy*/),
      detail: "Current release verified: the figure artifact fingerprint matches the active analysis release."
    };
  }

  /* ---- payload loading ----
     Both artifacts are release-bound and are served pre-gzipped, so the browser decompresses
     them in the network layer and this code only ever sees JSON. */
  function loadPayload(url, onDone) {
    return fetch(url, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error((/*@copy atlas-figures.http.7559a77*/`HTTP ${r.status}`/*@endcopy*/))); })
      .then(function (d) { onDone(d, "ready"); })
      .catch(function () { onDone(null, "missing"); });
  }

  /* The heading sits as plain text above the rules rather than inside a box of its own, and both
     of its parts are set at one size so their baselines line up across the figure. */
  var HEAD_TEXT = 16, HEAD_LINE = 26, HEAD_COLS = 40, HEAD_TICKS = 51, HEAD_RULE = 58;
  var TABLE_WIDTH = 752;
  /* One divider for every figure header, so the name, the population and the threshold read as
     parts of one label rather than as a sentence. A pipe rather than a middle dot: the dot is used
     inside a scope to join a proteome to a protein, and reusing it between the parts of the header
     made a three-part header ambiguous about which pairing was which. */
  var HEAD_DIV = " | ";

  function figureHeading(s, C, W, heading, unit) {
    /* One header line, the one this section has always had: the figure's own name and the
       population it is drawn over, with the unit opposite. The name used to live only in the HTML
       heading above the card, so an exported PNG or SVG arrived without it and a reader holding
       the file could not tell which figure it was. It is fitted to the width the unit leaves
       rather than to the whole panel, because the two share the line. */
    var unitWidth = unit ? ellipsise(unit, 1e4, T.row, 400).length * T.row * 0.53 : 0;
    s.appendChild(txFit(12, HEAD_TEXT, heading, W - 24 - unitWidth - 12,
      { weight: 600, fill: C.ink }));
    if (unit) {
      s.appendChild(tx(W - 12, HEAD_TEXT, unit, { fill: C.ink, anchor: "end" }));
    }
    s.appendChild(el("line", { x1: 12, x2: W - 12, y1: HEAD_LINE, y2: HEAD_LINE,
      stroke: C.ink, "stroke-width": 1 }));
  }

  /* A panel with no payload says which state it is in. "Missing" and "still loading" are
     different answers and a reader must not have to guess which one an empty panel means. */
  function loadingFrame(C, W, name, state) {
    var s = frame(W, 120, name + ", " + (state === "missing" ? "unavailable" : "loading"));
    s.dataset.loadState = state === "missing" ? "missing" : "loading";
    s.appendChild(tx(W / 2, 62, state === "missing"
      ? "The " + name.toLowerCase() + " artifact for " + PROTEOME + " is unavailable."
      : "Loading " + name.toLowerCase() + " for " + PROTEOME + "…",
      { fill: C.muted, anchor: "middle" }));
    return s;
  }

  /* Chromosome order for the x axis, and one band past Y for everything the genome axis
     cannot place. Those records used to be counted and dropped, which meant the figure claiming
     to show each human record was quietly missing 1,300 of them, all of them real and some of
     them the most covered records in the library. They are now drawn in a band named Other and
     spread evenly across it, so the plot holds the whole analysis universe and the reader can
     see how much coverage sits outside the coordinate system rather than reading a number about
     it in the caption.

     Mitochondrial records get a band of their own rather than being filed with these. Their
     position is known exactly; it is the chromosome that is the problem, at 16,569 bp against a
     3.1 Gb axis - five thousandths of a pixel, so a band drawn to scale could never be seen or
     labeled. Mit. is drawn wider than that and its records sit at their true position scaled
     into it, so their order and spacing relative to each other are real. Filing them under a
     heading that means "we do not know where this is" would have been the one wrong answer. */
  /* Mit. sits last, after NA. Both are off-scale bands, and putting the narrow one between the
     two wide ones (X and NA) crowded three labels into the space of one; at the end it has the
     plot edge on one side and only NA's label to clear. */
  var CHROMS = ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17",
    "18","19","20","21","22","X","Y","NA","Mit."];
  var NA_BAND = "NA";
  var MITO_BAND = "Mit.";
  var MITO_BP = 16569;

  /* GRCh38 chromosome lengths in base pairs. Two reasons to carry them rather than infer the
     axis from the data. A band sized by its largest observed coordinate is only as correct as
     its worst record: one mislabeled position stretched chromosome 17 to 226 Mb, nearly three
     times its true length, and left the right two thirds of that band empty. And a chromosome
     whose genes stop early is drawn too narrow, which put Y at 44% of its real width. Sizing
     from the assembly makes the x axis a genome axis instead of a summary of the input.
     The declared assembly is also what makes an impossible coordinate detectable at all. */
  var ASSEMBLY = "GRCh38";
  var CHROM_BP = {
    "1": 248956422, "2": 242193529, "3": 198295559, "4": 190214555, "5": 181538259,
    "6": 170805979, "7": 159345973, "8": 145138636, "9": 138394717, "10": 133797422,
    "11": 135086622, "12": 133275309, "13": 114364328, "14": 107043718, "15": 101991189,
    "16": 90338345, "17": 83257441, "18": 80373285, "19": 58617616, "20": 64444167,
    "21": 46709983, "22": 50818468, "X": 156040895, "Y": 57227415,
    /* Neither of these is a chromosome length. Mit. is the mitochondrial chromosome drawn far
       wider than 16,569 bp so it can be seen at all - positions inside it are real and to scale
       with each other, just not with the nuclear bands. NA has no genomic size whatever: it
       is given a width that holds its records at about the density of the nuclear bands, and a
       position inside it carries no meaning at all, which is why those records are spread
       evenly rather than ordered by anything. The caption says both. */
    "Mit.": 34000000,
    "NA": 150000000,
  };

  /* Y is drawn at the mitochondrial band's width rather than at its assembly length. Like Mit.
     it carries very few records, and at 57.2 Mb it claimed more of the axis than it had anything
     to put on it while crowding its own label against Mit.'s. This is a width only: Y's assembly
     length above is still what decides whether a coordinate is possible, and still what positions
     a record inside the band, so spacing within Y remains the genome's. Only the band's width
     relative to the nuclear ones is the display choice - the same trade Mit. and NA already make,
     and the reason those three are the bands the caption explains. */
  var COMPACT_BANDS = { "Y": 34000000 };
  function bandWidth(name) {
    return COMPACT_BANDS[name] || CHROM_BP[name];
  }

  /* Every record in the analysis universe reaches the plot. A record the genome axis can place
     is drawn at its position; one it cannot is drawn in the NA band. The reasons a record ends
     up there stay distinct and separately counted, because "no coordinate" is not "no coverage"
     and an impossible coordinate is not a missing one - but none of them is a reason to leave a
     measured record out of the figure. */
  /* The viral protein the chromosome figure is currently drawn for, or null for the pooled
     proteome. Read through a function so every caller agrees on what "selected" means even
     while the protein's file is still arriving. */
  function selectedSource() {
    if (PROTEIN_SOURCE == null || !PROTEIN_INDEX) return null;
    return PROTEIN_INDEX.sources[PROTEIN_SOURCE] || null;
  }

  function selectedSourceLabel() {
    var source = selectedSource();
    return source ? (source.gene || source.accession || String(source.antigen_id)) : "";
  }

  /* Turn one viral protein's saved residue counts into the same per-record percentages the
     pooled payload carries, so every reader below is unchanged by the switch. The reducer wrote
     these in the coverage payload's own record order and the audit checks it, so the join is by
     position; a payload of the wrong length is refused rather than silently misaligned. */
  function proteinSurfaceCovered(payload) {
    if (!COVERAGE || !payload || !Array.isArray(payload.covered_residues)) return null;
    var floors = payload.floors || [], rows = payload.covered_residues;
    if (rows.length !== floors.length) return null;
    for (var f = 0; f < rows.length; f++) {
      if (!Array.isArray(rows[f]) || rows[f].length !== COVERAGE.points.length) return null;
    }
    return COVERAGE.points.map(function (p, i) {
      var covered = {};
      floors.forEach(function (floor, fi) {
        var n = rows[fi][i];
        /* -1 is "no nine-residue window to evaluate", which is the payload's null, not a zero. */
        covered[String(floor)] = n < 0 || !p.length_aa
          ? null : Math.round(1e4 * 100 * n / p.length_aa) / 1e4;
      });
      return covered;
    });
  }

  /* Resolves once the staged all-record table for the current proteome is in hand, or once it is
     known to be unavailable. Never rejects: an export falls back to the retained slice rather
     than failing, and says which it carried. */
  function loadAllRecords() {
    if (ALL_RECORDS_SLUG === PROTEOME_SLUG && (ALL_RECORDS || ALL_RECORDS_PENDING === false)) {
      return Promise.resolve(ALL_RECORDS);
    }
    if (ALL_RECORDS_PENDING && ALL_RECORDS_SLUG === PROTEOME_SLUG) return ALL_RECORDS_PENDING;
    var wanted = PROTEOME_SLUG, request = PROTEOME_REQUEST;
    ALL_RECORDS_SLUG = wanted;
    ALL_RECORDS_PENDING = new Promise(function (resolve) {
      loadPayload("/data/collection-protein-surfaces/" + wanted + "/all-records.json.gz",
        function (d) {
          if (request !== PROTEOME_REQUEST || wanted !== PROTEOME_SLUG) { resolve(null); return; }
          var ok = d && Array.isArray(d.closest_source_index)
            && Array.isArray(d.pooled_covered_residues)
            && COVERAGE && d.closest_source_index.length === COVERAGE.points.length;
          ALL_RECORDS = ok ? d : null;
          ALL_RECORDS_PENDING = ok ? null : false;
          resolve(ALL_RECORDS);
        });
    });
    return ALL_RECORDS_PENDING;
  }


  // Arrangement changes presentation only. The retained coordinate resolver still owns eligibility.
  var COVERAGE_ARRANGEMENT = "position";
  var LOCALIZATION = null, LOCALIZATION_STATE = "loading", LOCALIZATION_CHECKED = null;
  var LOCALIZATION_VALID = false;
  var LOCATION_GROUPS = [(/*@copy atlas-figures.location-cell-surface*/`Cell Surface`/*@endcopy*/), (/*@copy atlas-figures.location-secreted*/`Secreted`/*@endcopy*/), (/*@copy atlas-figures.location-other-membrane*/`Other Membrane`/*@endcopy*/), (/*@copy atlas-figures.location-intracellular*/`Intracellular`/*@endcopy*/), (/*@copy atlas-figures.location-not-annotated*/`Unclassified`/*@endcopy*/)];
  function arrangementOptions() {
    return [{ value: "position", label: (/*@copy atlas-figures.arrangement-position*/`Genome Position`/*@endcopy*/) },
      { value: "length", label: (/*@copy atlas-figures.arrangement-length*/`Human Target Length`/*@endcopy*/) }, { value: "location", label: (/*@copy atlas-figures.arrangement-location*/`Subcellular Location`/*@endcopy*/) }];
  }
  function arrangementLabel() {
    return arrangementOptions().find(function (o) { return o.value === COVERAGE_ARRANGEMENT; }).label;
  }
  function coverageTopic() {
    if (COVERAGE_ARRANGEMENT === "length") return (/*@copy atlas-figures.title-coverage-length*/`Human Target Coverage by Human Target Length`/*@endcopy*/);
    if (COVERAGE_ARRANGEMENT === "location") return (/*@copy atlas-figures.title-coverage-location*/`Human Target Coverage by Subcellular Location`/*@endcopy*/);
    return (/*@copy atlas-figures.title-coverage*/`Human Target Coverage by Genome Position`/*@endcopy*/);
  }
  function lengthAxisLabel() { return (/*@copy atlas-figures.arrangement-length-axis*/`Human Target Length (Log Scale)`/*@endcopy*/); }
  function arrangementNote() {
    return COVERAGE_ARRANGEMENT === "length" ? (/*@copy atlas-figures.arrangement-length-note*/`Each mark represents a human target. Horizontal position shows target length on a logarithmic scale; targets longer than 5,000 residues share the >5,000 edge. Equal lengths share a horizontal position.`/*@endcopy*/) : (/*@copy atlas-figures.arrangement-location-note*/`Human targets are grouped by assigned subcellular location and ordered from shortest to longest within each group. Group width reflects the number of targets. Location assignments use UniProt annotations, with GO cellular-component annotations as a fallback when UniProt provides no classifiable location. Each target occupies one display group; this does not establish a dominant biological location. Unclassified means no display group was assigned.`/*@endcopy*/);
  }
  function localizationReady() {
    if (!LOCALIZATION || !COVERAGE) return false;
    if (LOCALIZATION_CHECKED !== COVERAGE) {
      LOCALIZATION_CHECKED = COVERAGE;
      LOCALIZATION_VALID = LOCALIZATION.schema === "mimicryone/atlas-localization/1"
        && LOCALIZATION.release_fingerprint === COVERAGE.release_fingerprint
        && LOCALIZATION.records && Array.isArray(LOCALIZATION.sources)
        && LOCALIZATION.records_total === COVERAGE.points.length
        && COVERAGE.points.every(function (p) {
          var row = LOCALIZATION.records[p.accession];
          return row && row[0] === p.length_aa && Number.isInteger(row[1]) && row[1] >= 0 && row[1] < LOCATION_GROUPS.length
            && Number.isInteger(row[2]) && row[2] >= 0 && row[2] < LOCALIZATION.sources.length;
        });
    }
    return LOCALIZATION_VALID;
  }
  function locationRecord(accession) {
    return localizationReady() ? LOCALIZATION.records[accession] : null;
  }
  function coverageLayout(points) {
    if (COVERAGE_ARRANGEMENT === "position") {
      return { points: points, bands: CHROMS, spans: CHROMS.map(bandWidth), ordered: false };
    }
    var grouped = COVERAGE_ARRANGEMENT === "location";
    var bands = grouped ? LOCATION_GROUPS : [arrangementLabel()];
    var spans = bands.map(function () { return 0; });
    var ordered = points.map(function (p) {
      var annotation = locationRecord(p.accession);
      return Object.assign({}, p, { ci: grouped && annotation ? annotation[1] : (grouped ? LOCATION_GROUPS.length - 1 : 0) });
    }).sort(function (a, b) {
      return a.ci - b.ci || a.len - b.len || (a.accession < b.accession ? -1 : a.accession > b.accession ? 1 : a.id - b.id);
    });
    ordered.forEach(function (p, i) {
      p.bandrank = ++spans[p.ci]; p.displayOrder = i + 1;
      p.bp = grouped ? p.bandrank - 0.5 : p.len;
    });
    // A shared log10 length axis preserves all records while spreading the long-tailed lengths.
    var lengthMin = MIN_LENGTH_AA;
    var lengthMax = grouped ? null : 5000;
    var lengthTicks = [];
    if (!grouped) {
      spans[0] = Math.log10(lengthMax / lengthMin);
      ordered.forEach(function (p) { p.bp = Math.log10(Math.min(p.len, lengthMax) / lengthMin); });
      for (var power = Math.floor(Math.log10(lengthMin)); power <= Math.ceil(Math.log10(lengthMax)); power++) {
        [1, 2.5, 5].forEach(function (factor) {
          var tick = factor * Math.pow(10, power);
          if (tick >= lengthMin && tick <= lengthMax) lengthTicks.push(tick);
        });
      }
    }
    return { points: ordered, bands: bands, spans: spans, ordered: true,
      lengthMax: lengthMax, lengthMin: lengthMin, lengthTicks: lengthTicks };
  }

  function coveragePoints() {
    var out = [], unplaced = [], noCoordinate = 0, tooShort = 0, noWindow = 0;
    var mitochondrial = 0, outOfRange = [];
    if (!COVERAGE) {
      return { points: out, noCoordinate: 0, tooShort: 0, noWindow: 0, mitochondrial: 0,
        outOfRange: outOfRange, unplaced: 0 };
    }
    var na = CHROMS.indexOf(NA_BAND);
    /* Which surface supplies the heights. Eligibility is deliberately still read from the pooled
       payload below: whether a human record has a nine-residue window and clears the length gate
       is a property of that record, not of the viral protein being asked about. Gating on the
       selected protein instead would shrink the population every time a reader picked a protein,
       and the reach count beside each threshold would stop being comparable between selections. */
    var surface = PROTEIN_SURFACE;
    COVERAGE.points.forEach(function (p, i) {
      if (p.covered[String(TRACKS[0].floor)] === null) { noWindow += 1; return; }
      if (p.length_aa < MIN_LENGTH_AA) { tooShort += 1; return; }
      var row = { ci: na, bp: 0, id: p.antigen_id,
        gene: p.gene || p.accession || String(p.antigen_id),
        covered: surface ? surface[i] : p.covered,
        accession: p.accession || "", len: p.length_aa };
      var name = String(p.chromosome || "").replace(/^chr/i, "");
      var start = parseInt(String(p.position || "").split("-")[0], 10);
      if (name === "MT" || name === "M" || name === "Mitochondrion") {
        mitochondrial += 1;
        /* A real position, scaled into a band wide enough to see. Their spacing relative to one
           another is the genome's; only the band's width relative to the nuclear ones is not. */
        row.ci = CHROMS.indexOf(MITO_BAND);
        row.bp = isFinite(start) ? Math.min(start, MITO_BP) / MITO_BP * CHROM_BP[MITO_BAND] : 0;
        out.push(row);
        return;
      }
      var ci = CHROMS.indexOf(name);
      if (ci < 0 || ci === na || ci === CHROMS.indexOf(MITO_BAND) || !isFinite(start)) {
        noCoordinate += 1; unplaced.push(row); return;
      }
      /* A start past the end of its own chromosome cannot be right. Drawing it at that position
         would place the record where the genome does not reach and stretch the band to meet it,
         so it goes to NA with the rest of what cannot be placed - and is still named below, since
         an impossible coordinate is an upstream error somebody should fix. */
      if (start > CHROM_BP[name]) {
        outOfRange.push({ gene: p.gene || p.accession, chromosome: name, position: p.position });
        unplaced.push(row);
        return;
      }
      row.ci = ci;
      /* A band drawn narrower than its assembly length carries its records in proportion, so
         their spacing relative to one another stays the genome's. Bands drawn at their true
         length keep the coordinate itself, unscaled. */
      row.bp = COMPACT_BANDS[name]
        ? start / CHROM_BP[name] * COMPACT_BANDS[name]
        : start;
      out.push(row);
    });
    /* Spread evenly, ordered by accession rather than by payload order: position in this band
       means nothing, so the one thing it must be is stable, or the same record would move
       between two renderings of the same data and two exports would not match. */
    unplaced.sort(function (a, b) { return a.accession < b.accession ? -1
      : (a.accession > b.accession ? 1 : a.id - b.id); });
    unplaced.forEach(function (row, i) {
      row.bp = (i + 0.5) / unplaced.length * CHROM_BP[NA_BAND];
      out.push(row);
    });
    out.sort(function (a, b) { return a.ci - b.ci || a.bp - b.bp; });
    return { points: out, noCoordinate: noCoordinate, tooShort: tooShort, noWindow: noWindow,
      mitochondrial: mitochondrial, outOfRange: outOfRange, unplaced: unplaced.length };
  }

  /* Quoted in the methods note. Measured from the plotted points rather than written down beside
     them, so the figures in the text cannot drift away from the figure itself. */
  function statsCovered(points, floor) {
    var values = points.map(function (p) { return p.covered[String(floor)]; })
      .filter(function (v) { return v !== null && v !== undefined; })
      .sort(function (a, b) { return a - b; });
    if (!values.length) return null;
    var n = values.length, mid = Math.floor(n / 2);
    var median = n % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    var mean = values.reduce(function (a, b) { return a + b; }, 0) / n;
    var variance = values.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / n;
    return { median: median, sd: Math.sqrt(variance), n: n };
  }

  /* Median and standard deviation are reported side by side, not as median plus or minus a
     spread: these distributions are strongly skewed and the deviation is not symmetric about
     the median. */
  function spreadPhrase(points) {
    return TRACKS.map(function (t) {
      var v = statsCovered(points, t.floor);
      return t.label + ", median " + (v === null ? "no data" : pct(v.median) + "%")
        + (v === null ? "" : " and standard deviation " + v.sd.toFixed(1));
    }).join("; ");
  }

  /* ---- Figure 1: percent of each human record covered, positioned along the genome ----
     The chromosome bands, paired tracks, point labels and overall proportions are the ones this
     section has always used. What changed is the quantity on y: it was a model-dependent
     log2 observed-over-expected ratio, and it is now the measured percentage of the record
     covered, on a fixed 0 to 100 axis that needs no null model to read. */
  function coveragePlot(C) {
    var W = 1100;
    var H = FRAME_HEAD + TRACKS.length * TRACK_H
      + (TRACKS.length - 1) * TRACK_GAP + FRAME_FOOT;
    if (!COVERAGE) return loadingFrame(C, W, "Coverage", COVERAGE_STATE);
    /* A protein has been chosen but its residue counts are not here yet. Drawing the pooled
       surface under that protein's name would be the worst of the three states, so the figure
       says which one it is in instead. */
    if (PROTEIN_SOURCE != null && !PROTEIN_SURFACE) {
      return loadingFrame(C, W, "Coverage for " + selectedSourceLabel(), PROTEIN_SURFACE_STATE);
    }
    if (COVERAGE_ARRANGEMENT === "location" && !localizationReady()) {
      return loadingFrame(C, W, (/*@copy atlas-figures.arrangement-location*/`Subcellular Location`/*@endcopy*/), LOCALIZATION_STATE === "loading" ? "loading" : "missing");
    }
    var resolved = coveragePoints(), layout = coverageLayout(resolved.points), pts = layout.points;
    var L = PLOT_LEFT, R = PLOT_RIGHT;
    var x0 = L, x1 = W - R;

    /* Cumulative genome coordinate: chromosomes laid end to end at their assembly lengths, so
       band width is proportional to real chromosome size and a gap inside a band is a real gap
       in the data rather than an artifact of the widest record on it. A chromosome contributing
       no drawn record is left out entirely instead of appearing as an empty band. */
    var present = {};
    pts.forEach(function (p) { present[p.ci] = true; });
    var span = {}, offset = {}, total = 0;
    layout.bands.forEach(function (c, i) {
      if (!(i in present)) return;
      span[i] = layout.spans[i];
      offset[i] = total;
      total += span[i] * (layout.lengthMax ? 1 : 1.02);
    });
    var sx = function (p) { return x0 + (offset[p.ci] + p.bp) / total * (x1 - x0); };

    var scope = selectedSourceLabel() ? PROTEOME + " · " + selectedSourceLabel() : PROTEOME;
    var s = frame(W, H, "Percent of each human record covered by " + scope
      + " at " + series(TRACKS.map(function (t) { return t.label; })));
    s.setAttribute("data-arrangement", COVERAGE_ARRANGEMENT);
    s.setAttribute("data-proteome", PROTEOME_SLUG);
    s.setAttribute("data-source-index", PROTEIN_SOURCE == null ? "-1" : String(PROTEIN_SOURCE));
    s.setAttribute("data-record-count", pts.length);
    figureHeading(s, C, W, plotTitle(), (/*@copy atlas-figures.human-target-coverage-label*/`Human Target Coverage`/*@endcopy*/) + HEAD_DIV + "0–100");

    TRACKS.forEach(function (track, ti) {
      var key = String(track.floor);
      var yTop = FRAME_HEAD + ti * (TRACK_H + TRACK_GAP), yBot = yTop + TRACK_H;
      /* A fixed 0-100 axis: the quantity is a percentage, so the scale is not free to move
         with the data and the two tracks stay directly comparable. */
      var sy = function (v) { return yBot - (v / 100) * (yBot - yTop); };

      /* alternating chromosome bands, the standard Manhattan cue */
      layout.bands.forEach(function (c, i) {
        if (!(i in offset)) return;
        var a = x0 + offset[i] / total * (x1 - x0);
        var b = x0 + (offset[i] + span[i]) / total * (x1 - x0);
        if (i % 2 === 0) s.appendChild(el("rect", { x: a, y: yTop, width: Math.max(0, b - a),
          height: yBot - yTop, fill: C.border, opacity: 0.10 }));
        /* A rule where the genome ends. Without it NA reads as one more chromosome, and its
           width - which is a display choice, not a length - would be taken for one. */
        /* Bands narrowed by choice are always labeled. The width test exists so a sliver of a
           chromosome does not carry an unreadable number, but a band that is narrow because we
           made it narrow must still be named - otherwise Y, having just been given Mit.'s width,
           falls under the test and silently loses its label, which reads as the chromosome
           being absent rather than compact. */
        if (layout.lengthMax) return;
        if (b - a > 14 || c === MITO_BAND || c === NA_BAND || COMPACT_BANDS[c] || layout.ordered) {
          var bandLabelStyle = { size: T.tick, fill: C.ink, anchor: "middle" };
          // Compact chromosome bands have room in the frame for their full short labels.
          s.appendChild(layout.ordered
            ? txFit((a + b) / 2, yBot + 11, c, Math.max(12, b - a - 2), bandLabelStyle)
            : tx((a + b) / 2, yBot + 11, c, bandLabelStyle));
        }
      });
      if (layout.lengthMax) {
        layout.lengthTicks.forEach(function (length) {
          var fraction = Math.log10(length / layout.lengthMin) / Math.log10(layout.lengthMax / layout.lengthMin);
          var x = x0 + fraction * (x1 - x0);
          s.appendChild(el("line", { x1: x, x2: x, y1: yBot, y2: yBot + 4, stroke: C.grid, "stroke-width": 1 }));
          s.appendChild(tx(x, yBot + 13, length === layout.lengthMax ? (/*@copy atlas-figures.length-overflow-tick*/`>${nf(length)}`/*@endcopy*/) : nf(length),
            { size: T.tick, fill: C.ink, anchor: "middle" }));
        });
        if (ti === TRACKS.length - 1) s.appendChild(tx((x0 + x1) / 2, yBot + 30, lengthAxisLabel(),
          { size: T.tick, fill: C.ink, anchor: "middle" }));
      }
      [0, 25, 50, 75, 100].forEach(function (v) {
        s.appendChild(el("line", { x1: x0, x2: x1, y1: sy(v), y2: sy(v), stroke: C.grid,
          "stroke-width": 1, opacity: v === 0 ? 1 : 0.7 }));
        s.appendChild(tx(x0 - 6, sy(v) + 3, String(v), { size: T.tick, fill: C.ink, anchor: "end" }));
      });
      /* Centered on the track, level with the 50 gridline, so the floor reads as the name of the
         whole band rather than of the region near its ceiling. */
      s.appendChild(tx(12, yTop + TRACK_H / 2 - 10, track.label,
        { size: T.panel, weight: 600, fill: C.ink }));
      var reached = pts.reduce(function (count, p) { return count + (p.covered[key] > 0 ? 1 : 0); }, 0);
      var reachLabel = tx(12, yTop + TRACK_H / 2 + 5, (/*@copy atlas-figures.chromosome-reach-count*/`${nf(reached)} Reached`/*@endcopy*/),
        { size: T.tick, fill: C.ink });
      reachLabel.setAttribute("data-reach-floor", key);
      reachLabel.setAttribute("data-reached", reached);
      reachLabel.setAttribute("data-tooltip", (/*@copy atlas-figures.chromosome-reach-tooltip*/`Human Protein Reach: ${nf(reached)} of ${nf(pts.length)} human targets (${pct(pts.length ? 100 * reached / pts.length : 0)}%) at ≥${key}/9. Track height shows human target coverage.`/*@endcopy*/));
      s.appendChild(reachLabel);
      s.appendChild(tx(12, yTop + TRACK_H / 2 + 18, pct(pts.length ? 100 * reached / pts.length : 0) + "%",
        { size: T.tick, fill: C.ink }));

      /* Zero is a measured value here, not a missing one, so uncovered records are drawn on the
         baseline rather than dropped. That is the whole point of the fixed axis.

         One path per alternating-chromosome color, not one node per record. As a circle each,
         five tracks built about 96,000 DOM nodes and blocked the main thread for two seconds on
         the scroll that reveals the section. A zero-length segment under a round linecap paints
         the identical dot, and the same 19,000 records cost one node. */
      var dots = [[], []];
      pts.forEach(function (p) {
        var v = p.covered[key];
        if (v === null || v === undefined) return;
        dots[p.ci % 2].push("M" + sx(p).toFixed(1) + " " + sy(v).toFixed(1) + "h.01");
      });
      dots.forEach(function (d, parity) {
        if (!d.length) return;
        /* Alternating chromosomes are told apart by color, so both members of the pair have to be
           legible against the band behind them: measured, these are about 5.6:1 and 6.8:1 where
           the previous blue-on-gray pair was 1.75:1 and 2.66:1. */
        s.appendChild(el("path", { d: d.join(""), fill: "none",
          stroke: parity === 0 ? C.dot : C.ink, "stroke-width": 2.2,
          "stroke-linecap": "round", opacity: parity === 0 ? 1 : 0.65 }));
      });
      /* Label the leaders, except where the track is saturated and a ranking means nothing.
         Nudging is minimal and bounded: a label may step at most LABEL_MAX_STEPS to clear a
         neighbor, and is dropped rather than drawn further from the dot it names. */
      if (!track.leaders) return;
      var top = pts.filter(function (p) { return p.covered[key] > 0; })
        .sort(function (a, b) { return b.covered[key] - a.covered[key]; }).slice(0, 5);
      /* A label only has to clear other labels and the marked dots. Sitting over the background
         point cloud costs nothing, so collision is tested as real overlapping boxes rather than
         by vertical distance alone, and a label stays beside its own dot in almost every case. */
      var marks = top.map(function (p) {
        var mx = sx(p), my = sy(p.covered[key]);
        return { x0: mx - 3.4, x1: mx + 3.4, y0: my - 3.4, y1: my + 3.4 };
      });
      var boxes = [];
      top.forEach(function (p) {
        var mx = sx(p), anchor = sy(p.covered[key]);
        // Keep label ink clear of the bottom axis; the data point stays at its true height.
        var labelBottom = yBot - 8, labelAnchor = Math.min(anchor, labelBottom);
        var width = p.gene.length * T.tick * 0.58;
        var lx = Math.min(mx + 5, W - R - width - 2);
        var placed = null;
        for (var step = 0; step <= LABEL_MAX_STEPS && !placed; step++) {
          var tries = step === 0 ? [labelAnchor]
            : [labelAnchor - step * LABEL_GAP, labelAnchor + step * LABEL_GAP];
          for (var t = 0; t < tries.length; t++) {
            if (tries[t] < yTop || tries[t] > labelBottom) continue;
            var box = { x0: lx - 1, x1: lx + width + 1, y0: tries[t] - 5, y1: tries[t] + 4 };
            if (boxes.concat(marks).some(function (b) {
              return box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1;
            })) continue;
            placed = { cy: tries[t], box: box };
            break;
          }
        }
        s.appendChild(el("circle", { cx: mx, cy: anchor, r: 2.6, fill: C.sel }));
        /* Unlabeled beats labeled in the wrong place; the dot is still marked. */
        if (!placed) return;
        boxes.push(placed.box);
        s.appendChild(tx(lx, placed.cy + 3, p.gene,
          { size: T.tick, fill: C.ink, weight: 600 }));
      });
    });
    return s;
  }

  /* ---- Figure 2: which viral parents reach the most human records ----
     The table-with-inline-bar form this section already used for a ranked comparison. The
     counting unit changed: it was the share of one protein's matched-window total sitting on
     its single best human target, which needed a window tally and a best target chosen from the
     data. It is now distinct human records reached, which is exact and needs neither. */
  function sourceRows() {
    if (!SURFACES) return [];
    var key = String(WORKING_FLOOR);
    return SURFACES.sources.map(function (e) {
      var byFloor = {};
      TRACKS.forEach(function (t) {
        byFloor[String(t.floor)] = e.targets[String(t.floor)].records_matched;
      });
      return { rank: e.rank, gene: e.gene || e.accession || String(e.antigen_id),
        accession: e.accession,
        name: e.description || "", len: e.length_aa, byFloor: byFloor,
        records: e.targets[key].records_matched, pct: e.targets[key].percent_of_library,
        exact: e.targets["9"] ? e.targets["9"].records_matched : null };
    });
  }

  var SOURCE_ROWS_DRAWN = 10;

  /* The selected threshold sorts by coverage or reach. Length breaks equal scores:
     longer human targets first, shorter viral parents first. These are deterministic
     presentation tie-breakers, not likelihood estimates or significance tests. */
  function longestBreaksTies(key) {
    return function (a, b) {
      return (b.covered[key] || 0) - (a.covered[key] || 0) || (b.len || 0) - (a.len || 0);
    };
  }
  function shortestBreaksTies(key) {
    return function (a, b) {
      return (b.byFloor[key] || 0) - (a.byFloor[key] || 0) || (a.len || 0) - (b.len || 0);
    };
  }

  /* One builder for both directions of the same table, so the pair stays visually identical
     without the two being kept in step by hand. */
  /* A panel with nothing to list says so. An empty frame under a heading reads as a failure to
     load rather than as a real, informative zero, which some smaller proteomes will produce. */
  function emptyFrame(C, W, heading, unit, message) {
    var s = frame(W, HEAD_RULE + 46, message);
    figureHeading(s, C, W, heading, unit);
    s.appendChild(tx(W / 2, HEAD_RULE + 24, message, { fill: C.muted, anchor: "middle" }));
    return s;
  }

  function styledTable(C, o) {
    /* Shared natural width keeps the summary, distribution and ranked tables aligned.
       Bar columns divide the remaining room after the fixed identity columns. */
    var W = o.width || TABLE_WIDTH;
    if (!o.rows.length) return emptyFrame(C, W, o.heading, o.unit, o.empty || "No rows.");
    /* The panel says what it is and in what unit, in the figure itself and in the same two-part
       form the chromosome plot uses. Values are centered under their headings, so a column reads
       as a column rather than as a ragged right edge. */
    var GUT = o.gutter, head = HEAD_COLS;
    var headerLines = Math.max.apply(null, o.cols.map(function (c) { return String(c.t).split("\n").length; })
      .concat([String(o.gutterTitle).split("\n").length]));
    // Center single-line headings in the same two-line band used by other tables.
    headerLines = Math.max(2, headerLines);
    // HEAD_RULE already includes two header lines, as in the distribution plot.
    var top = HEAD_RULE + Math.max(0, headerLines - 2) * 11;
    var H = top + o.rows.length * ROW_H + 10;
    var s = frame(W, H, o.title);
    /* Columns are laid out across the full width rather than packed left with one bar stranded
       on the right. Any column carrying a bar shares the space left over once the fixed columns
       have taken theirs, which is what makes room for a bar inside each of them. */
    var bars = o.cols.filter(function (c) { return typeof c.bar === "function"; });
    /* Bar columns take the leftover width because a bar needs room to be read. A table with no
       bars can still ask to fill the panel, which is what `spread` is for: without it the last
       column ended mid-panel and left a band of empty card to its right, so the table read as
       having been cut off rather than as having said everything it had to say. */
    var flexible = bars.length ? bars : (o.spread ? o.cols.slice() : []);
    if (flexible.length) {
      var fixed = o.cols.reduce(function (a, c) {
        return a + (flexible.indexOf(c) >= 0 ? 0 : c.w);
      }, 0);
      var share = Math.max(48, Math.floor((W - 24 - GUT - fixed) / flexible.length));
      flexible.forEach(function (c) { c.w = share; });
    }
    var showBar = typeof o.bar === "function";
    var barX = 12 + GUT + o.cols.reduce(function (a, c) { return a + c.w; }, 0) + 10;
    var barMax = showBar ? Math.max(0, W - 12 - barX) : 0;
    var most = showBar
      ? (o.rows.reduce(function (m, r) { return Math.max(m, o.bar(r)); }, 0) || 1) : 1;

    figureHeading(s, C, W, o.heading, o.unit);
    function header(x, text, width, anchor) {
      var lines = String(text).split("\n");
      lines.forEach(function (line, i) {
        s.appendChild(txFit(x, head + (headerLines - lines.length) * 5.5 + i * 11, line, width,
          { weight: 600, fill: C.ink, anchor: anchor }));
      });
    }
    header(12, o.gutterTitle, GUT - 8, "start");
    var x = 12 + GUT;
    o.cols.forEach(function (c) {
      /* A bar grows from the left of its cell, so its heading sits there too; a centred heading
         over a left-aligned bar reads as belonging to neither. */
      var bar = typeof c.bar === "function";
      header(bar ? x + 4 : x + c.w / 2, c.t, c.w, bar ? "start" : "middle");
      x += c.w;
    });
    /* The bars carry a scale rather than being read against each other by eye: a labeled axis
       with the same tick treatment the other panels use, and gridlines carried down the rows. */
    var scale = 0;
    if (barMax > 20) {
      scale = o.barScale || Math.max(most, 1);
      if (o.barTitle) {
        s.appendChild(txFit(barX, head, o.barTitle, barMax, { weight: 600, fill: C.ink }));
      }
      [0, 0.5, 1].forEach(function (fraction) {
        var gx = barX + fraction * barMax;
        s.appendChild(tx(gx, HEAD_TICKS, o.barTick ? o.barTick(scale * fraction) : nf(scale * fraction),
          { size: T.tick, fill: C.ink,
            anchor: fraction === 0 ? "start" : (fraction === 1 ? "end" : "middle") }));
        s.appendChild(el("line", { x1: gx, x2: gx, y1: top, y2: top + o.rows.length * ROW_H,
          stroke: C.grid, "stroke-width": 1, opacity: 0.7 }));
      });
    }
    s.appendChild(el("line", { x1: 12, x2: W - 12, y1: top, y2: top, stroke: C.ink, "stroke-width": 1 }));
    o.rows.forEach(function (r, i) {
      var y = top + i * ROW_H + ROW_H / 2 + 3;
      if (i) s.appendChild(el("line", { x1: 12, x2: W - 12, y1: top + i * ROW_H, y2: top + i * ROW_H,
        stroke: C.grid, "stroke-width": 1, opacity: 0.7 }));
      var label = txFit(12, y, o.label(r), GUT - 8, { fill: C.ink, weight: 500 });
      if (o.tooltip && o.tooltip(r)) label.setAttribute("data-tooltip", o.tooltip(r));
      s.appendChild(label);
      var cx = 12 + GUT;
      o.cols.forEach(function (c) {
        var text = c.f(r);
        if (typeof c.bar === "function") {
          /* Bar first, then the number over it where the bar is wide enough to hold it and
             just past its end where it is not. Small values keep a readable number instead of
             losing it inside a two-pixel bar, and the number never drifts away from its bar. */
          var pad = 8, room = c.w - pad;
          var value = Number(c.bar(r)) || 0;
          var scale = Number(c.scale) || 1;
          var width = Math.max(0, Math.min(1, value / scale)) * room;
          var bx = cx + pad / 2;
          /* Center the bar on the digits, not on the text baseline. y is a baseline, and the
             visual middle of a row of numerals sits about a third of the type size above it;
             hanging the bar off y left the number riding low inside it. */
          var mid = y - T.tick * 0.34, barH = 11;
          if (width > 0.5) {
            s.appendChild(el("rect", { x: bx, y: mid - barH / 2, rx: 1.5,
              width: width, height: barH, fill: C.sel, opacity: 0.65 }));
          }
          var glyphs = String(text).length;
          var inside = width >= glyphs * 5.2 + 8;
          s.appendChild(tx(inside ? bx + width - 4 : bx + width + 3, y, text,
            { size: T.tick, anchor: inside ? "end" : "start",
              fill: C.ink, weight: 500 }));
        } else {
          // accent still emphasises a column by weight for the tables that ask for it; the two
          // ranked tables no longer do, because there the accent marked the selected threshold
          // and that is now said in the heading, the caption and the control.
          var cell = txFit(cx + c.w / 2, y, text, c.w,
            { anchor: "middle", fill: C.ink, weight: c.accent ? 600 : 400 });
          if (c.tooltip) {
            cell.setAttribute("data-tooltip", c.tooltip(r));
            cell.setAttribute("tabindex", "0");
            cell.setAttribute("aria-label", c.tooltip(r));
            cell.appendChild(el("title", {}, c.tooltip(r)));
          }
          s.appendChild(cell);
        }
        cx += c.w;
      });
      if (barMax > 20) {
        s.appendChild(el("rect", { x: barX, y: y - 8, rx: 1.5,
          width: Math.max(0.6, Math.min(1, o.bar(r) / scale) * barMax), height: 10,
          fill: C.sel, opacity: 0.75 }));
      }
    });
    return s;
  }

  /* Every floor as its own column, so a row can be read across instead of against a single
     chosen threshold. */
  /* Every floor gets its own bar, drawn in its own column and scaled the same way, so magnitude
     across the thresholds reads at a glance instead of having to be assembled from five numbers.
     No column is accented: the selected floor decides the sort and is named in the heading and
     the caption, and emphasising its column as well suggested the other four were secondary
     readings of it rather than the same measurement at a different threshold. */
  function floorColumns(width, value, scale, barValue) {
    return TRACKS.map(function (t) {
      var key = String(t.floor);
      return { t: t.label, w: width, scale: scale,
        f: function (r) { return value(r, key); },
        bar: function (r) { return barValue(r, key); } };
    });
  }

  function sourceTable(C, floor) {
    if (!SURFACES) return loadingFrame(C, TABLE_WIDTH, (/*@copy atlas-figures.viral-parents-loading*/`Viral Parents`/*@endcopy*/), SURFACES_STATE);
    var rank = String(floor === undefined ? WORKING_FLOOR : floor);
    var label = rank + " of 9";
    /* Ranked here, not taken in the order the bake wrote. The payload is ordered by one floor;
       reading the table at another and drawing that order would put the heading's threshold
       over rows chosen by a different one. */
    var rows = sourceRows().slice().sort(shortestBreaksTies(rank))
      .slice(0, SOURCE_ROWS_DRAWN);
    return styledTable(C, {
      title: (/*@copy atlas-figures.source-proteins-of-ranked-by.012f336*/`Viral Parents Ranked by Human Protein Reach · ${PROTEOME}`/*@endcopy*/),
      heading: plotTitle(),
      unit: (/*@copy atlas-figures.human-protein-reach-label*/`Human Protein Reach`/*@endcopy*/) + HEAD_DIV + "ranked at " + label,
      gutter: 96, gutterTitle: (/*@copy atlas-figures.viral-parent-column*/`Viral Parent`/*@endcopy*/),
      empty: "No Viral Parent reaches a Human Target at " + label + ".",
      cols: [{ t: (/*@copy atlas-figures.viral-parent-length-column*/`Viral Parent
Length`/*@endcopy*/), w: 96, f: function (r) { return nf(r.len); } }]
        .concat(floorColumns(56, function (r, key) { return nf(r.byFloor[key]); },
          SURFACES.eligible_records, function (r, key) { return r.byFloor[key] || 0; })),
      rows: rows,
      label: function (r) { return r.gene; },
      tooltip: function (r) { return r.name ? r.gene + " · " + r.name : null; },
    });
  }

  /* The mirror: the same table read from the human side, so a target and the viral parent
     that actually reaches it appear on one row instead of in two separate figures. */
  function targetRows() {
    if (!COVERAGE || !COVERAGE.top_targets) return [];
    return COVERAGE.top_targets.map(function (e) {
      return {
        gene: e.gene || e.accession || String(e.antigen_id), export_gene: e.gene || "",
        id: e.antigen_id, accession: e.accession, name: e.name, len: e.length_aa,
        covered: e.covered, sources: e.sources_reaching,
        closest: e.closest_source || "",
        /* This record's coverage by that one protein, not the pooled figure over all of them. */
        byClosest: e.closest_covered || {},
        /* Present once the bake carries a closest match per floor. Keyed by floor. */
        closestByFloor: e.closest_by_floor || null,
      };
    });
  }

  /* The pair this record's row is about: the single viral parent covering most of it, and that
     one protein's coverage of it at each threshold. Which protein is chosen is decided once, at
     the floor the payload was baked at, and the caption says which. It is deliberately not
     withheld at other thresholds - a column that empties itself when the reader moves a control
     is worse than one that names the floor it was computed at, which is what the caption does. */
  function closestAtFloor(r) {
    return r.closestByFloor && r.closestByFloor[String(bakedRankFloor())]
      ? r.closestByFloor[String(bakedRankFloor())]
      : { source: r.closest, covered: r.byClosest || {} };
  }
  function closestLabel(r) {
    var hit = closestAtFloor(r);
    return hit.source || "—";
  }
  function closestCovered(r, floor) {
    var hit = closestAtFloor(r);
    var value = hit.covered ? hit.covered[String(floor)] : null;
    return value === undefined ? null : value;
  }
  function bakedRankFloor() {
    return COVERAGE && COVERAGE.top_targets_rank_floor
      ? COVERAGE.top_targets_rank_floor : WORKING_FLOOR;
  }
  /* Whether ranking on the pair is exact against what the payload carries.
     The payload holds the records with the highest POOLED coverage. Pooled is coverage by all
     viral parents together and the pair is coverage by one of them, so pooled >= pair for
     every record, always. That gives a sufficient test: if the tenth pair value drawn is at
     least the weakest pooled value carried, no uncarried record can have a pair value that
     would have displaced it, because its pooled value would have earned it a place in the pool
     first. Where that fails, a record outside the pool could belong in the table and the
     caption says so - measured across the collection it fails somewhere for 17 of 121
     proteomes, human herpesvirus 2 at 7 of 9 among them. */
  function pairRankingExact(rank) {
    var carried = COVERAGE && COVERAGE.top_targets;
    if (!carried || !carried.length) return true;
    var weakestPooled = Infinity, drawn = [];
    carried.forEach(function (t) {
      weakestPooled = Math.min(weakestPooled, (t.covered || {})[rank] || 0);
      drawn.push(((t.closest_covered || {})[rank]) || 0);
    });
    drawn.sort(function (a, b) { return b - a; });
    var tenth = drawn.length >= SOURCE_ROWS_DRAWN ? drawn[SOURCE_ROWS_DRAWN - 1] : 0;
    return tenth >= weakestPooled;
  }

  /* True when every drawn threshold can be answered from what the bake carries. */
  function closestCoversAllFloors() {
    var rows = COVERAGE && COVERAGE.top_targets;
    if (!rows || !rows.length) return false;
    return rows.every(function (e) {
      return e.closest_by_floor && TRACKS.every(function (t) {
        return e.closest_by_floor[String(t.floor)];
      });
    });
  }

  /* Ranked, barred and labeled on pooled coverage - the same quantity the chromosome plot
     draws and the collection scatter above summarizes. A row here and a point up there are then
     the same number for the same record, which is what lets the two figures be read against
     each other at all.

     Ranking on that quantity is also what makes the ranking exact instead of conditionally
     exact. The payload carries the records most covered at the ranking floor, chosen by pooled
     coverage, so taking the top of that list by pooled coverage is the true top by construction,
     for every proteome and every future one. Ranking instead by the closest single match - a
     different quantity - was correct only while the last displayed closest value exceeded the
     last pooled value the payload carried. That held for 120 of the 121 baked proteomes and
     failed for human herpesvirus 2, where the tenth displayed closest value is 21.97 against a
     last pooled value of 25.99: a record outside the payload could outrank a displayed row, and
     nothing in the payload could reveal it. The closest match keeps its own name and its own
     column, so the ranking changed and no information was lost. */
  function targetRank() {
    return String(COVERAGE && COVERAGE.top_targets_rank_floor
      ? COVERAGE.top_targets_rank_floor : WORKING_FLOOR);
  }

  function targetTable(C, floor) {
    if (!COVERAGE) return loadingFrame(C, TABLE_WIDTH, (/*@copy atlas-figures.human-targets-loading*/`Human Targets`/*@endcopy*/), COVERAGE_STATE);
    if (!COVERAGE.top_targets) return loadingFrame(C, TABLE_WIDTH, (/*@copy atlas-figures.human-targets-loading*/`Human Targets`/*@endcopy*/), "missing");
    var rank = String(floor === undefined ? targetRank() : floor), rankLabel = rank + " of 9";
    /* One question per row, asked of one pair. Every column - the sort, the bars, the numbers -
       is this record against the single viral parent that covers most of it, so there is no
       second quantity in the table and nothing to label "Alone": every figure here is the alone
       figure. Pooled coverage over all viral parents is the chromosome plot's question and is
       still carried in the CSV; mixing the two in one table meant every row held two different
       answers and a column whose job was to say which was which. */
    var rows = targetRows().sort(function (a, b) {
      return (closestCovered(b, rank) || 0) - (closestCovered(a, rank) || 0)
        || (b.len || 0) - (a.len || 0);
    }).slice(0, SOURCE_ROWS_DRAWN);
    return styledTable(C, {
      title: (/*@copy atlas-figures.human-records-and-the-single.3077515*/`Human target–viral parent Pairs Ranked by target Residue Coverage · ${PROTEOME}`/*@endcopy*/),
      heading: plotTitle(),
      unit: (/*@copy atlas-figures.human-target-coverage-label*/`Human Target Coverage`/*@endcopy*/) + HEAD_DIV + "0–100",
      gutter: 88, gutterTitle: (/*@copy atlas-figures.human-target-column*/`Human Target`/*@endcopy*/),
      empty: "No Human Target of " + MIN_LENGTH_AA + " AA or more is covered at " + rankLabel + ".",
      cols: [{ t: (/*@copy atlas-figures.viral-parent-column*/`Viral Parent`/*@endcopy*/), w: 96, f: function (r) { return closestLabel(r); } },
        { t: (/*@copy atlas-figures.human-target-length-column*/`Human Target
Length`/*@endcopy*/), w: 104, f: function (r) { return nf(r.len); } }]
        .concat(floorColumns(44, function (r, key) { return pct(closestCovered(r, key)) + "%"; },
          100, function (r, key) { return closestCovered(r, key) || 0; })),
      rows: rows,
      label: function (r) { return r.gene; },
      tooltip: function (r) {
        return (r.name ? r.gene + " · " + r.name : r.gene) + " — " + closestLabel(r)
          + " covers " + pct(closestCovered(r, rank)) + "% of it at " + rankLabel
          + "; all " + (r.sources[rank] || 0) + " Viral Parents that reach it cover "
          + pct(r.covered[rank]) + "% between them";
      },
    });
  }

  /* Figure image and CSV export helpers. */
  function safeName(s) {
    return String(s).replace(/[,\s]+/g, "_").replace(/[\/\\:*?"<>|]+/g, "_")
      .replace(/_+/g, "_").replace(/^_|_$/g, "");
  }
  function esc(v) {
    v = v === undefined || v === null ? "" : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function save(name, body, mime) {
    var url = URL.createObjectURL(new Blob([body], { type: mime })), a = document.createElement("a");
    a.href = url; a.download = String(name).replace(/_+/g, "_"); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  /* A column header row and the data, and nothing else. This used to open with a dozen commented
     lines restating the figure's title, caption, provenance and release status - a file talking
     about itself before saying anything, and the first thing every spreadsheet has to be told to
     skip. The column names carry what a reader needs; the release identity travels in the export
     bundle's provenance.json, which is where a machine looks for it. */
  function csv(name, columns, rows) {
    var head = columns.map(function (c) { return esc(c.label); }).join(",");
    var body = rows.map(function (r) {
      return columns.map(function (c) { var value = c.label.includes("(%)") ? window.MimicryExportCore.exportPercent(r[c.key]) : r[c.key]; return esc(window.MimicryOneIdentity.publicText(value)); }).join(",");
    });
    save(safeName(name) + ".csv",
      "\ufeff" + [head].concat(body).join("\r\n") + "\r\n",
      "text/csv;charset=utf-8");
  }
  function svgString(svg, C) {
    var c = svg.cloneNode(true);
    c.setAttribute("xmlns", SVG);
    c.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    var vb = (c.getAttribute("viewBox") || "0 0 720 460").split(/\s+/);
    c.setAttribute("width", vb[2]); c.setAttribute("height", vb[3]);
    c.removeAttribute("class");
    /* Publication exports have a transparent canvas and no enclosing card or border.
       Keep plot-local bands, rules and data marks exactly as the figure drew them. */
    var st = document.createElementNS(SVG, "style");
    st.textContent = (/*@copy atlas-figures.text-tspan-font-family.9d0063b*/`text,tspan{font-family:${FONT_UI}}`/*@endcopy*/);
    c.insertBefore(st, c.firstChild);
    window.MimicryPlotPalette.freezeSVG(c);
    return { str: c.outerHTML, w: +vb[2], h: +vb[3] };
  }

  function exportSvg(svg, name, C, caption) {
    if (typeof window.SeroMapFigureExport === "function") {
      var node = new DOMParser().parseFromString(svgString(svg, C).str, "image/svg+xml").documentElement;
      return window.SeroMapFigureExport("svg", node, safeName(name)).then(function () {
        if (caption) save(safeName(name) + "-legend.txt", caption, "text/plain;charset=utf-8");
      });
    }
    save(safeName(name) + ".svg", svgString(svg, C).str, "image/svg+xml;charset=utf-8");
    if (caption) save(safeName(name) + "-legend.txt", caption, "text/plain;charset=utf-8");
  }
  function exportPng(svg, name, C, caption) {
    if (typeof window.SeroMapFigureExport === "function") {
      var node = new DOMParser().parseFromString(svgString(svg, C).str, "image/svg+xml").documentElement;
      return window.SeroMapFigureExport("png", node, safeName(name)).then(function () {
        if (caption) save(safeName(name) + "-legend.txt", caption, "text/plain;charset=utf-8");
      });
    }
    var o = svgString(svg, C), img = new Image();
    img.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = o.w * 2; cv.height = o.h * 2;
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(function (b) {
        var url = URL.createObjectURL(b), a = document.createElement("a");
        a.href = url; a.download = safeName(name) + ".png";
        document.body.appendChild(a); a.click(); a.remove();
        if (caption) save(safeName(name) + "-legend.txt", caption, "text/plain;charset=utf-8");
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(o.str);
  }

  /* Shared presentation API: all atlas tables use the same geometry and exporters. */
  window.MimicryAtlasTable = {
    picker: searchSelect,
    columnDefinitions: exportColumnDefinitions,
    exportNode: function (svg) {
      return new DOMParser().parseFromString(svgString(svg, tokens()).str, "image/svg+xml").documentElement;
    },
    render: function (options) {
      return styledTable(tokens(), options);
    },
    export: function (svg, filename, kind) {
      var palette = tokens();
      if (kind === "svg") return exportSvg(svg, filename, palette);
      else if (kind === "png") return exportPng(svg, filename, palette);
      else throw new Error("Unsupported figure format");
    }
  };

  /* ---- assembly ---- */

  /* Per-proteome panels use the selected release-bound parent population.
     Summary counts and denominators come from its payload, not a fixed example size. */

  /* Per floor, how far the individual viral parents spread. The leader is carried with the row
     because it is not the same protein at every floor, and that turnover is the point. */
  /* Per-viral-protein residue coverage, keyed by the antigen id both payloads carry. The reach
     half comes from the surfaces payload that has always been served; the coverage half comes
     from the per-protein surfaces published beside it, which is why this figure could only show
     reach before those existed. Returns null when that tree has not loaded, so the caller can
     say "loading" instead of drawing a flat row of zeros. */
  function sourceCoverageByAntigen() {
    if (!PROTEIN_INDEX) return null;
    var out = {};
    PROTEIN_INDEX.sources.forEach(function (source) {
      var byFloor = {};
      (source.summary || []).forEach(function (entry) {
        byFloor[String(entry.floor)] = entry.human_library_residue_coverage_percent;
      });
      out[String(source.antigen_id)] = byFloor;
    });
    return out;
  }

  /* One row per viral parent, shared by distribution and ranked-table CSVs.
     Export identity uses the original record metadata; the internal gene field may
     hold a display fallback and must not supply the exported Gene column.
     Coverage is blank when the per-parent surface is unavailable. */
  function sourceProteinRows() {
    if (!SURFACES) return [];
    var coverageById = {};
    if (PROTEIN_INDEX) {
      PROTEIN_INDEX.sources.forEach(function (source) {
        var byFloor = {};
        (source.summary || []).forEach(function (entry) { byFloor[String(entry.floor)] = entry; });
        coverageById[String(source.antigen_id)] = byFloor;
      });
    }
    return SURFACES.sources.map(function (e) {
      var row = { gene: e.gene || e.accession || String(e.antigen_id),
        accession: e.accession || "", name: e.description || "", len: e.length_aa,
        eligible: SURFACES.eligible_records,
        residues: PROTEIN_INDEX ? PROTEIN_INDEX.eligible_human_residues : "" };
      var byFloor = coverageById[String(e.antigen_id)] || {};
      TRACKS.forEach(function (t) {
        var key = String(t.floor), reach = e.targets[key] || {}, cover = byFloor[key];
        row["r" + key] = reach.records_matched;
        row["rp" + key] = reach.percent_of_library;
        row["c" + key] = cover ? cover.human_residues_covered : "";
        row["cp" + key] = cover ? cover.human_library_residue_coverage_percent : "";
      });
      return Object.assign(row, exportRecord(e, "Mimicry Parent"));
    });
  }

  /* Identity, length and both denominators, then both measures at every threshold. Shared by the
     spread figure and the ranked source table. */
  function sourceProteinColumns() {
    var columns = exportRecordColumns("Mimicry Parent").concat([
      { key: "len", label: (/*@copy atlas-figures.source-protein-length-csv*/`Mimicry Parent Length (AA)`/*@endcopy*/) },
      { key: "eligible", label: (/*@copy atlas-figures.source-eligible-proteins-csv*/`Eligible Antigen Targets`/*@endcopy*/) },
      { key: "residues", label: (/*@copy atlas-figures.source-eligible-residues-csv*/`Antigen Target Eligible Residues`/*@endcopy*/) }]);
    TRACKS.forEach(function (t) {
      var key = String(t.floor);
      columns.push({ key: "r" + key, label: (/*@copy atlas-figures.source-reached-count-csv*/`Antigen Targets Reached at ≥${key}/9`/*@endcopy*/) });
      columns.push({ key: "rp" + key, label: (/*@copy atlas-figures.source-reached-percent-csv*/`Human Protein Reach (%) at ≥${key}/9`/*@endcopy*/) });
      columns.push({ key: "c" + key, label: (/*@copy atlas-figures.source-covered-count-csv*/`Antigen Target Covered Residues at ≥${key}/9`/*@endcopy*/) });
      columns.push({ key: "cp" + key, label: (/*@copy atlas-figures.source-covered-percent-csv*/`Human Residue Coverage (%) at ≥${key}/9`/*@endcopy*/) });
    });
    return columns;
  }

  function sourceSpread(metric) {
    if (!SURFACES) return [];
    var wantCoverage = (metric || SPREAD_METRIC) === "coverage";
    var coverage = wantCoverage ? sourceCoverageByAntigen() : null;
    if (wantCoverage && !coverage) return [];
    return TRACKS.map(function (t) {
      var key = String(t.floor);
      var rows = SURFACES.sources.map(function (e) {
        var value = wantCoverage
          ? (coverage[String(e.antigen_id)] || {})[key]
          : e.targets[key].percent_of_library;
        return { pct: Number(value) || 0,
          gene: e.gene || e.accession || String(e.antigen_id) };
      }).sort(function (a, b) { return a.pct - b.pct; });
      var mid = Math.floor(rows.length / 2);
      return {
        floor: t.floor, label: t.label, n: rows.length,
        min: rows[0].pct, max: rows[rows.length - 1].pct,
        median: rows.length % 2 ? rows[mid].pct : (rows[mid - 1].pct + rows[mid].pct) / 2,
        leader: rows[rows.length - 1].gene,
        /* Ascending, so the figure can draw every protein rather than three statistics of them. */
        values: rows,
      };
    });
  }

  /* ---- Restored: the ladder, StatsTableFigure geometry ---- */
  function thresholdSummaryRows() {
    if (!SURFACES || !COVERAGE) return [];
    var perProtein = {};
    sourceSpread("reach").forEach(function (s) { perProtein[String(s.floor)] = s.median; });
    var points = COVERAGE.points.filter(function (p) {
      return p.covered[String(TRACKS[0].floor)] !== null && p.length_aa >= MIN_LENGTH_AA;
    });
    return SURFACES.ladder.map(function (r) {
      var key = String(r.floor), burden = COVERAGE.burden && COVERAGE.burden.floors[key] || {};
      var values = points.map(function (p) { return p.covered[key]; })
        .filter(function (v) { return v != null && v > 0; }).sort(function (a, b) { return a - b; });
      var mid = Math.floor(values.length / 2);
      return { floor: r.floor + " of 9", records: r.records_matched,
        eligible: r.eligible_records, pct: r.percent_of_library,
        coverage_pct: burden.pooled_percent, covered: burden.residues_covered,
        residues: COVERAGE.burden && COVERAGE.burden.residues_total,
        median_matched_coverage: values.length ? (values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2) : null,
        sources: r.source_proteins_contributing,
        viral_total: SURFACES.sources.length,
        median: r.median_source_proteins_per_matched_record,
        max: r.max_source_proteins_per_matched_record, median_pct: perProtein[key] };
    });
  }

  function ladderTable(C) {
    if (!SURFACES || !COVERAGE) return loadingFrame(C, TABLE_WIDTH, "Reach and coverage", !SURFACES ? SURFACES_STATE : COVERAGE_STATE);
    /* Keep the distinct denominators visible: reach counts targets; pooled coverage counts
       residues. The medians describe reached targets and individual parents, respectively. */
    var table = styledTable(C, {
      width: TABLE_WIDTH,
      title: (/*@copy atlas-figures.summary-svg-title*/`Human Protein Reach and Residue Coverage | ${PROTEOME}`/*@endcopy*/),
      heading: plotTitle(),
      unit: (/*@copy atlas-figures.summary-universe*/`${nf(SURFACES.eligible_records)} Eligible Human Targets`/*@endcopy*/),
      gutter: 110, gutterTitle: (/*@copy atlas-figures.summary-threshold*/`Core Identity
Threshold`/*@endcopy*/), spread: true,
      cols: [
        /* The unit lives with the value, not in the heading: every column here is a count or a
           percentage and saying so twice cost a heading line each. Five columns rather than six --
           median viral proteins per matched human protein said less than the space it took, and is
           still in the data file. */
        { t: (/*@copy atlas-figures.summary-reached*/`Human Targets
Reached`/*@endcopy*/), w: 130,
          f: function (r) { return nf(r.records) + " (" + pct(r.pct) + "%)"; } },
        { t: (/*@copy atlas-figures.summary-covered*/`Human Residues
Covered`/*@endcopy*/), w: 130,
          f: function (r) { return pct(r.coverage_pct) + "%"; },
          tooltip: function (r) { return (/*@copy atlas-figures.summary-coverage-tooltip*/`Human residues covered: ${nf(r.covered)} / ${nf(r.residues)} (${pct(r.coverage_pct)}%). Median coverage among reached human proteins: ${r.median_matched_coverage == null ? "not applicable (no proteins reached)" : pct(r.median_matched_coverage) + "%"}.`/*@endcopy*/); } },
        { t: (/*@copy atlas-figures.summary-median-matched*/`Median Coverage
Among Reached`/*@endcopy*/), w: 130,
          f: function (r) { return r.median_matched_coverage == null ? "—" : pct(r.median_matched_coverage) + "%"; } },
        { t: (/*@copy atlas-figures.summary-median-reach*/`Median Reach per
Viral Parent`/*@endcopy*/), w: 130,
          f: function (r) { return pct(r.median_pct) + "%"; } },
        /* How many of the virus's proteins carry any mimicry at this floor, against how many it
           has. The bare count said 85 at four floors running and 24 at the fifth without saying
           what either was out of; the denominator is small enough to print, so it is printed
           rather than turned into a percentage. */
        { t: (/*@copy atlas-figures.summary-source-proteins*/`Viral Parents
with Matches`/*@endcopy*/), w: 130,
          f: function (r) {
            /* Not "24/85": a spreadsheet reads that as a date and silently rewrites the cell. */
            return nf(r.sources) + " | " + nf(SURFACES.sources.length);
          } }
      ], rows: thresholdSummaryRows(), label: function (r) { return r.floor; }
    });
    table.setAttribute("data-summary", "reach-coverage");
    return table;
  }

  /* Reach distribution across the selected proteome's viral parents.
     The range and plotted points use that parent population at each threshold. */
  /* A round upper bound at or above the largest value, so the axis carries five even ticks
     instead of ending on whatever the widest-reaching protein happens to measure. */
  function niceCeil(value) {
    var ladder = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 75, 100];
    for (var i = 0; i < ladder.length; i++) if (value <= ladder[i]) return ladder[i];
    return 100;
  }

  function spreadRange(C) {
    var W = TABLE_WIDTH;
    if (!SURFACES) return loadingFrame(C, W, "Spread", SURFACES_STATE);
    /* Coverage per viral protein lives in the per-protein surfaces tree. Until it has loaded the
       figure cannot answer the question that was asked of it, and says so. */
    if (SPREAD_METRIC === "coverage" && !PROTEIN_INDEX) {
      return loadingFrame(C, W, "Per-protein residue coverage", PROTEIN_INDEX_STATE);
    }
    var rows = sourceSpread();
    var coverageMode = SPREAD_METRIC === "coverage";
    /* Reach keeps the fixed 0-100 axis: it is a share of the human population and the whole range
       is meaningful. Residue coverage is a share of all human residues and runs from tens of
       percent at the loosest threshold to thousandths at the strictest, so a fixed axis would draw
       every strict row on the baseline. It is scaled to the collection of rows together - not per
       row - because comparing the thresholds to each other is the figure's point, and the bound is
       stated in the heading. */
    var axisMax = coverageMode
      ? niceCeil(rows.reduce(function (m, r) { return Math.max(m, r.max); }, 0))
      : 100;
    var GUT = 132, VAL = 76, top = HEAD_RULE + 20, H = top + rows.length * ROW_H + 16;
    var x0 = 12 + GUT, x1 = W - 12 - VAL * 2;
    var sx = function (v) { return x0 + (v / axisMax) * (x1 - x0); };
    var measure = coverageMode
      ? "Share of all eligible human residues covered by one " + PROTEOME + " protein"
      : "Percentage of the human library reached by a single " + PROTEOME + " protein";
    var s = frame(W, H, measure + ", across identity floors");
    figureHeading(s, C, W, plotTitle(), (coverageMode
      ? (/*@copy atlas-figures.spread-coverage-unit*/`Human Residue Coverage`/*@endcopy*/) : (/*@copy atlas-figures.spread-reach-unit*/`Human Protein Reach`/*@endcopy*/))
      + HEAD_DIV + "0–" + axisMax);
    function columnHeading(x, label, anchor) {
      label.split("\n").forEach(function (line, i) {
        s.appendChild(tx(x, HEAD_COLS + i * 11, line, { weight: 600, fill: C.ink, anchor: anchor || "start" }));
      });
    }
    columnHeading(12, (/*@copy atlas-figures.spread-identity-column*/`Core Identity
Threshold`/*@endcopy*/));
    columnHeading(W - 12 - VAL, coverageMode ? (/*@copy atlas-figures.spread-median-coverage*/`Median
Coverage`/*@endcopy*/) : (/*@copy atlas-figures.spread-median-reach*/`Median
Reach`/*@endcopy*/), "end");
    columnHeading(W - 12, coverageMode ? (/*@copy atlas-figures.spread-highest-coverage*/`Highest
Coverage`/*@endcopy*/) : (/*@copy atlas-figures.spread-highest-reach*/`Highest
Reach`/*@endcopy*/), "end");
    s.appendChild(el("line", { x1: 12, x2: W - 12, y1: HEAD_RULE, y2: HEAD_RULE,
      stroke: C.ink, "stroke-width": 1 }));
    [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
      var v = axisMax * fraction;
      s.appendChild(tx(sx(v), top - 6, String(Math.round(v * 1000) / 1000),
        { size: T.tick, fill: C.ink, anchor: "middle" }));
      s.appendChild(el("line", { x1: sx(v), x2: sx(v), y1: top, y2: top + rows.length * ROW_H,
        stroke: C.grid, "stroke-width": 1, opacity: 0.7 }));
    });
    s.appendChild(el("line", { x1: x0, x2: x1, y1: top, y2: top, stroke: C.grid, "stroke-width": 1 }));
    rows.forEach(function (r, i) {
      var y = top + i * ROW_H + ROW_H / 2;
      s.appendChild(tx(12, y + 3, r.label, { fill: C.ink, weight: 500 }));
      s.appendChild(tx(12 + GUT - 12, y + 3, "n = " + r.n,
        { size: T.tick, fill: C.ink, anchor: "end" }));
      s.appendChild(el("line", { x1: sx(r.min), x2: sx(r.max), y1: y, y2: y,
        stroke: C.dot, "stroke-width": 1, opacity: 0.5 }));
      [r.min, r.max].forEach(function (v) {
        s.appendChild(el("line", { x1: sx(v), x2: sx(v), y1: y - 3.5, y2: y + 3.5,
          stroke: C.dot, "stroke-width": 1.5, opacity: 0.8 }));
      });
      /* Every viral parent, not a three-number summary of them. Points crowding the same x are
         dodged off the row line in alternating steps, so a cluster reads as a cluster instead of
         one dark dot; the dodge is vertical only and carries no meaning of its own. */
      var lastX = -99, depth = 0;
      r.values.forEach(function (v) {
        var vx = sx(v.pct);
        if (vx - lastX < DOT_R * 2) { depth += 1; } else { depth = 0; }
        lastX = vx;
        var step = Math.ceil(depth / 2) * (DOT_R * 2 + 0.4);
        var vy = y + (depth % 2 ? step : -step);
        if (Math.abs(vy - y) > ROW_H / 2 - DOT_R) { vy = y; }
        var dot = el("circle", { cx: vx, cy: vy, r: DOT_R, fill: C.dot, opacity: 0.9 });
        dot.setAttribute("data-tooltip", (/*@copy atlas-figures.at.8cc396d*/`${v.gene} · ${pct(v.pct)}% ${SPREAD_METRIC === 'coverage' ? 'human residues covered' : 'human proteins reached'} at ${r.label}`/*@endcopy*/));
        s.appendChild(dot);
      });
      /* Only the median carries a mark. The highest is already the rightmost point on the row,
         so a second mark would restate its position; the name is what the row is missing. */
      var median = el("line", { x1: sx(r.median), x2: sx(r.median), y1: y - 7, y2: y + 7,
        stroke: C.sel, "stroke-width": 2 });
      median.setAttribute("data-tooltip", (/*@copy atlas-figures.median-source-protein-at.d884adf*/`Median viral parent · ${pct(r.median)}% ${SPREAD_METRIC === 'coverage' ? 'human residues covered' : 'human proteins reached'} at ${r.label}`/*@endcopy*/));
      s.appendChild(median);
      s.appendChild(txFit(sx(r.max) + 7, y + 3, r.leader, 78,
        { size: T.tick, fill: C.ink, weight: 600 }));
      s.appendChild(tx(W - 12, y + 3, pct(r.max) + "%", { fill: C.ink, weight: 600, anchor: "end" }));
      s.appendChild(tx(W - 12 - VAL, y + 3, pct(r.median) + "%", { fill: C.ink, anchor: "end" }));
    });
    return s;
  }

  var FIGS = [
    {
      key: "coverage", topic: coverageTopic,

      span: true, sources: true, arrangement: true,
      available: function () {
        return !!COVERAGE && (PROTEIN_SOURCE == null || !!PROTEIN_SURFACE)
          && (COVERAGE_ARRANGEMENT !== "location" || localizationReady());
      },
      build: coveragePlot,
      scope: function () {
        return selectedSourceLabel() ? PROTEOME + HEAD_DIV + selectedSourceLabel() : PROTEOME;
      },

legend: function () {
        var r=COVERAGE?coveragePoints():null, u=COVERAGE?universe():null;
        if (COVERAGE_ARRANGEMENT !== "position") return (/*@copy atlas-figures.ordered-coverage-scientific-legend*/`${arrangementNote()} The ${TRACKS.length} tracks show human target coverage at the indicated core identity thresholds on the same 0–100% scale. ${selectedSourceLabel() ? 'Coverage is from '+selectedSourceLabel()+' alone, within '+PROTEOME+'. ' : 'Coverage pools matches across all viral parents in '+PROTEOME+'. '}Overlapping cores count once, including mismatching positions; context flanks are excluded. ${u ? 'All '+nf(u.records)+' eligible human targets remain included. ' : ''}Track counts report the number of human targets matched at least once.`/*@endcopy*/);
        return (/*@copy atlas-figures.chromosome-scientific-legend*/`Each mark represents a human target, positioned by its ${ASSEMBLY} genomic coordinate. The ${TRACKS.length} tracks show human target coverage at the indicated core identity thresholds on the same 0–100% scale. ${selectedSourceLabel() ? 'Coverage is from '+selectedSourceLabel()+' alone, within '+PROTEOME+'. ' : 'Coverage pools matches across all viral parents in '+PROTEOME+'. '}Overlapping cores count once, including mismatching positions; context flanks are excluded. ${u ? 'All '+nf(u.records)+' eligible human targets remain included. ' : ''}Track counts report the number of human targets matched at least once. Coordinates come from UniProt.`/*@endcopy*/);
      },


      file: function () {
        return exportName(({ position: "human_target_coverage_by_chromosomal_position", length: "human_target_coverage_by_human_target_length_log_scale_capped_5000", location: "human_target_coverage_by_subcellular_location" })[COVERAGE_ARRANGEMENT]
          + (selectedSourceLabel() ? "_" + safeName(selectedSourceLabel()) + "_" + safeName(PROTEIN_INDEX.sources[PROTEIN_SOURCE].accession || String(PROTEIN_INDEX.sources[PROTEIN_SOURCE].antigen_id)) : ""));
      },
      columns: function () { return exportRecordColumns("Antigen Target").concat([
        { key: "len", label: (/*@copy atlas-figures.length-aa.a7cfdb0*/`Antigen Target Length (AA)`/*@endcopy*/) },
        { key: "chr", label: (/*@copy atlas-figures.chromosome.ca24604*/`Chromosome`/*@endcopy*/) },
        { key: "pos", label: (/*@copy atlas-figures.genome-position.ef102c2*/`Genome Position (bp)`/*@endcopy*/) },
        /* Enough to redraw the figure from the file alone: which band the record went in, and
           where along the axis it was drawn. Without these a reader can see the chromosome a
           record claims but not where the plot actually put it, which is the one thing the
           mitochondrial and NA bands make non-obvious. */
        { key: "band", label: (/*@copy atlas-figures.drawn-in-band.e96dc07*/`Display Band`/*@endcopy*/) },
        { key: "bandpos", label: (/*@copy atlas-figures.position-within-band-bp.0bcb67e*/`Position Within Display Band (bp)`/*@endcopy*/) },
        { key: "plotted", label: (/*@copy atlas-figures.drawn-in-figure.d4e6194*/`Drawn in Figure`/*@endcopy*/) },
        /* Which surface the percentages came from. Without it a per-protein export and a pooled
           one are the same columns with different numbers and nothing in the file says why. */
        { key: "scope", label: (/*@copy atlas-figures.coverage-scope-csv*/`Mimicry Parent Scope`/*@endcopy*/) }])
        /* The pooled surface is always exported, because it is the measurement the figure is about
           and a reader should not have to clear a filter to get it back. When a viral protein is
           selected its own percentages are exported beside the pooled ones rather than instead of
           them, so one file answers both "how much of this human protein does the virus cover"
           and "how much does this one viral protein account for". */
        .concat(TRACKS.map(function (t) {
          return { key: "p" + t.floor,
            label: (/*@copy atlas-figures.coverage-pooled-percent-csv*/`Antigen Target Residues Covered (%) Across All Mimicry Parents at ≥${t.floor}/9`/*@endcopy*/) };
        }))
        .concat(selectedSourceLabel() ? TRACKS.map(function (t) {
          return { key: "s" + t.floor,
            label: (/*@copy atlas-figures.coverage-selected-percent-csv*/`Antigen Target Residues Covered (%) by Selected Mimicry Parent at ≥${t.floor}/9`/*@endcopy*/) };
        }) : [])
        .concat([{ key: "arrangement", label: (/*@copy atlas-figures.arrangement-csv*/`Antigen Target Arrangement`/*@endcopy*/) },
          { key: "order", label: (/*@copy atlas-figures.display-order-csv*/`Display Order`/*@endcopy*/) },
          { key: "bandrank", label: (/*@copy atlas-figures.band-rank-csv*/`Position Within Display Band (rank)`/*@endcopy*/) },
          { key: "location", label: (/*@copy atlas-figures.location-csv*/`Subcellular Location`/*@endcopy*/) },
          { key: "locationSource", label: (/*@copy atlas-figures.location-source-csv*/`Subcellular Location Source`/*@endcopy*/) }]); },
      rows: function () {
        if (!COVERAGE) return [];
        /* Read the drawn set from the figure rather than re-deriving the gate here. The two
           drifted apart the moment a rejection rule was added in one place only, and a column
           claiming a record is in the figure when it is not is worse than no column. */
        var drawn = {};
        var layout = coverageLayout(coveragePoints().points);
        layout.points.forEach(function (p, i) {
          drawn[p.id] = { band: layout.bands[p.ci], bp: layout.ordered ? "" : Math.round(p.bp),
            rank: layout.ordered ? p.bandrank : "", order: i + 1 };
        });
        /* Always export pooled coverage. A selected parent adds its own coverage columns;
           scope identifies that selection without replacing the pooled values. */
        var surface = PROTEIN_SURFACE;
        var scope = selectedSourceLabel() || (/*@copy atlas-figures.coverage-scope-pooled-csv*/`All Viral Parents (Pooled)`/*@endcopy*/);
        return COVERAGE.points.map(function (p, i) {
          var d = drawn[p.antigen_id], annotation = locationRecord(p.accession);
          var row = { accession: p.accession || "", gene: p.gene || "", len: p.length_aa,
            chr: p.chromosome || "", pos: p.position || "", name: p.name || "",
            band: d ? d.band : "", bandpos: d ? d.bp : "",
            plotted: d ? "yes" : "no", scope: scope, arrangement: COVERAGE_ARRANGEMENT === "length" ? lengthAxisLabel() : arrangementLabel(),
            order: d ? d.order : "", bandrank: d ? d.rank : "",
            location: annotation ? LOCATION_GROUPS[annotation[1]] : "",
            locationSource: annotation ? LOCALIZATION.sources[annotation[2]] : "" };
          TRACKS.forEach(function (t) {
            row["p" + t.floor] = p.covered[String(t.floor)];
            if (surface) row["s" + t.floor] = surface[i][String(t.floor)];
          });
          return Object.assign(row, exportRecord(p, "Antigen Target"));
        });
      },
    },
    {
      key: "ladder", topic: (/*@copy atlas-figures.title-ladder*/`Human Protein Reach and Residue Coverage`/*@endcopy*/),

      build: ladderTable,

legend: function () {

        return (/*@copy atlas-figures.ladder-scientific-legend*/`Each row summarizes matches to ${PROTEOME} at one core identity threshold. Human targets reached counts eligible human targets matched at least once; human residues covered reports pooled coverage across the full eligible human population. Median coverage among reached is the median human target coverage among targets with a match. Median reach per viral parent is the median human protein reach across all viral parents. Viral parents with matches is shown as the contributing count followed by the total. Overlapping cores count once, including mismatching positions; context flanks are excluded.`/*@endcopy*/);
      },


      file: function () { return exportName("human_protein_reach_and_residue_coverage_by_identity_threshold"); },
      columns: [{ key: "floor", label: (/*@copy atlas-figures.identity-floor.3f829cf*/`Minimum Core Identity`/*@endcopy*/) },
        { key: "records", label: (/*@copy atlas-figures.human-records-reached.5a811eb*/`Antigen Targets Reached`/*@endcopy*/) },
        { key: "eligible", label: (/*@copy atlas-figures.human-records-in-proteome.2d2ab20*/`Eligible Antigen Targets`/*@endcopy*/) },
        { key: "pct", label: (/*@copy atlas-figures.percent-of-proteome.2002732*/`Human Protein Reach (%)`/*@endcopy*/) },
        { key: "sources", label: (/*@copy atlas-figures.source-proteins-contributing.6f871f1*/`Mimicry Parents with Matches`/*@endcopy*/) },
        { key: "viral_total", label: (/*@copy atlas-figures.summary-viral-total-csv*/`Mimicry Parents in Proteome`/*@endcopy*/) },
        { key: "median", label: (/*@copy atlas-figures.median-source-proteins-per-matched.df744b3*/`Median Mimicry Parents per Reached Antigen Target`/*@endcopy*/) },
        { key: "max", label: (/*@copy atlas-figures.max-source-proteins-per-matched.5eefe85*/`Maximum Mimicry Parents per Reached Antigen Target`/*@endcopy*/) },
        { key: "median_pct", label: (/*@copy atlas-figures.median-percent-of-proteome-per.6afbcd9*/`Median Human Protein Reach per Mimicry Parent (%)`/*@endcopy*/) },
        { key: "covered", label: (/*@copy atlas-figures.summary-covered-count-csv*/`Antigen Target Covered Residues`/*@endcopy*/) },
        { key: "residues", label: (/*@copy atlas-figures.summary-residue-denominator-csv*/`Antigen Target Eligible Residues`/*@endcopy*/) },
        { key: "coverage_pct", label: (/*@copy atlas-figures.summary-coverage-percent-csv*/`Human Residue Coverage (%)`/*@endcopy*/) },
        { key: "median_matched_coverage", label: (/*@copy atlas-figures.summary-matched-median-csv*/`Median Antigen Target Coverage Among Reached Antigen Targets (%)`/*@endcopy*/) }],
      rows: thresholdSummaryRows,
    },
    {
      key: "spread",
      topic: function () {
        return SPREAD_METRIC === "coverage"
          ? (/*@copy atlas-figures.title-spread-coverage*/`Human Residue Coverage by Individual Viral Parents`/*@endcopy*/)
          : (/*@copy atlas-figures.title-spread*/`Human Protein Reach by Individual Viral Parents`/*@endcopy*/);
      },

      build: spreadRange,
      metric: { label: (/*@copy atlas-figures.spread-metric-control*/`Individual Viral Parent Measure`/*@endcopy*/),
        get: function () { return SPREAD_METRIC; },
        set: function (value) { SPREAD_METRIC = value; },
        options: [["reach", (/*@copy atlas-figures.spread-reach-button*/`Reach`/*@endcopy*/)],
          ["coverage", (/*@copy atlas-figures.spread-coverage-button*/`Residue Coverage`/*@endcopy*/)]] },

legend: function () {

        return (/*@copy atlas-figures.spread-scientific-legend*/`Each dot represents one ${PROTEOME} protein. ${SPREAD_METRIC === 'coverage' ? 'The X-axis shows the percentage of all eligible human residues covered by that protein’s qualifying cores at the indicated core identity threshold.' : 'The X-axis shows human protein reach: the percentage of eligible human targets matched at least once at the indicated core identity threshold.'} Bars show the range; green marks the median. The right-hand columns report the median and highest ${SPREAD_METRIC === 'coverage' ? 'coverage' : 'reach'}. ${SPREAD_METRIC === 'coverage' ? 'All threshold rows share the range stated above the plot. Overlapping cores count once, including mismatching positions; context flanks are excluded.' : ''}`/*@endcopy*/);
      },


      file: function () {
        return exportName(SPREAD_METRIC === "coverage"
          ? "human_residue_coverage_by_individual_viral_parents"
          : "human_protein_reach_by_individual_viral_parents");
      },
      /* One data file whichever measure is on screen: both are columns in it. */
      dataFile: function () {
        return exportName("human_protein_reach_and_residue_coverage_by_individual_viral_parents");
      },
      /* Every protein the figure plots, not the five-number summary of them. The whiskers, the
         median mark and the leader label are all statistics of these rows, so the file reproduces
         the picture exactly and carries the identities and lengths the picture has no room for. */
      columns: sourceProteinColumns,
      rows: sourceProteinRows,
    },
    {
      key: "sources", topic: (/*@copy atlas-figures.title-sources*/`Viral Parents Ranked by Human Protein Reach`/*@endcopy*/), floors: true,

      build: sourceTable,

legend: function () {

        return (/*@copy atlas-figures.sources-scientific-legend*/`Each row is a ${PROTEOME} protein; each threshold column reports how many eligible human targets it matches at least once. A human target counts once if it has any qualifying match to that viral parent. Rows rank by reach at ≥${floorForKey('sources')}/9; shorter proteins break ties. Ranking is not adjusted for protein length.`/*@endcopy*/);
      },


      file: function () {
        return exportName("viral_parents_ranked_by_human_protein_reach_m" + floorForKey("sources"));
      },
      /* The data file is the whole table and does not move with the threshold control: every
         floor is already a column, so re-sorting it would only decide which identical rows come
         first, and a rank or drawn-in-figure column would be a fact about the picture rather
         than about the proteome. The picture is what the threshold changes, so the PNG and SVG
         keep it in their names and this does not. */
      dataFile: function () { return exportName("viral_parents_ranked_by_human_protein_reach"); },
      /* The same per-protein rows the distribution figure exports: this table ranks them and
         draws the top slice, so its file is the whole population with both measures rather than
         the bars that happened to fit. */
      columns: sourceProteinColumns,
      rows: function () {
        if (!SURFACES) return [];
        /* Every viral parent, in the payload's own order. */
        return sourceProteinRows();
      },
    },
    {
      key: "targets", topic: (/*@copy atlas-figures.title-targets*/`Human Target–Viral Parent Pairs Ranked by Target Residue Coverage`/*@endcopy*/), floors: true,

      build: targetTable,

legend: function () {
        var u=universe();
        return (/*@copy atlas-figures.targets-scientific-legend*/`Each row pairs a human target with the ${PROTEOME} protein covering the greatest fraction of that target at the retained ≥${bakedRankFloor()}/9 selection threshold. That viral partner stays fixed across all threshold columns. Coverage uses the full human target length. Overlapping cores count once, including mismatching positions; context flanks are excluded. Rows are ranked by coverage at ≥${floorForKey('targets')}/9, with longer human targets first when values tie. ${pairRankingExact(String(floorForKey('targets'))) ? '' : 'The stored candidate set is selected by pooled coverage; the global top pairs are not guaranteed at this threshold. '}${u ? 'The eligible population contains '+nf(u.records)+' human targets.' : ''}`/*@endcopy*/);
      },


      file: function () {
        return exportName("human_target_viral_parent_pairs_ranked_by_target_residue_coverage_m"
          + floorForKey("targets"));
      },
      /* As with the source table: the data file is every carried record in the payload's order,
         the same file whatever the threshold control says, because every floor is a column. */
      dataFile: function () { return exportName("human_target_viral_parent_pairs_ranked_by_target_residue_coverage"); },
      columns: function () { return exportRecordColumns("Antigen Target").concat([
        { key: "len", label: (/*@copy atlas-figures.length-aa.5814df1*/`Antigen Target Length (AA)`/*@endcopy*/) },
        { key: "on_plot", label: (/*@copy atlas-figures.has-genome-coordinate.d4a9bda*/`Has Genome Coordinate`/*@endcopy*/) },
        ]).concat(exportRecordColumns("Mimicry Parent")).concat([
        { key: "closest_len", label: (/*@copy atlas-figures.targets-closest-length-csv*/`Mimicry Parent Length (AA)`/*@endcopy*/) },
        /* Which rows the served payload retains. The export covers the whole eligible library,
           while the artifact the figure ranks carries a top slice, so this is the column that lets
           a reader cross-check the expanded table against the payload it was derived from. It is a
           fact about the artifact, not about what the picture happened to draw. */
        { key: "retained", label: (/*@copy atlas-figures.targets-retained-csv*/`Included in Figure Candidate Set`/*@endcopy*/) },
        { key: "k5", label: (/*@copy atlas-figures.percent-of-record-covered-by.c4eb958*/`Antigen Target Residues Covered (%) at ≥5/9`/*@endcopy*/) },
        { key: "k6", label: (/*@copy atlas-figures.percent-of-record-covered-by.e888e01*/`Antigen Target Residues Covered (%) at ≥6/9`/*@endcopy*/) },
        { key: "k7", label: (/*@copy atlas-figures.percent-of-record-covered-by.a4368ae*/`Antigen Target Residues Covered (%) at ≥7/9`/*@endcopy*/) },
        { key: "k8", label: (/*@copy atlas-figures.percent-of-record-covered-by.121826f*/`Antigen Target Residues Covered (%) at ≥8/9`/*@endcopy*/) },
        { key: "k9", label: (/*@copy atlas-figures.percent-of-record-covered-by.bb7eebf*/`Antigen Target Residues Covered (%) at ≥9/9`/*@endcopy*/) },
        { key: "c5", label: (/*@copy atlas-figures.percent-covered-all-sources-m.20b2f4b*/`Antigen Target Residues Covered (%) Across All Mimicry Parents at ≥5/9`/*@endcopy*/) },
        { key: "c6", label: (/*@copy atlas-figures.percent-covered-all-sources-m.66c316f*/`Antigen Target Residues Covered (%) Across All Mimicry Parents at ≥6/9`/*@endcopy*/) },
        { key: "c7", label: (/*@copy atlas-figures.percent-covered-all-sources-m.92aac00*/`Antigen Target Residues Covered (%) Across All Mimicry Parents at ≥7/9`/*@endcopy*/) },
        { key: "c8", label: (/*@copy atlas-figures.percent-covered-all-sources-m.5b77c46*/`Antigen Target Residues Covered (%) Across All Mimicry Parents at ≥8/9`/*@endcopy*/) },
        { key: "c9", label: (/*@copy atlas-figures.percent-covered-all-sources-m.5c0ea89*/`Antigen Target Residues Covered (%) Across All Mimicry Parents at ≥9/9`/*@endcopy*/) },
        { key: "s5", label: (/*@copy atlas-figures.source-proteins-reaching-m.b562237*/`Mimicry Parents Reaching Antigen Target at ≥5/9`/*@endcopy*/) },
        { key: "s6", label: (/*@copy atlas-figures.source-proteins-reaching-m.8f60874*/`Mimicry Parents Reaching Antigen Target at ≥6/9`/*@endcopy*/) },
        { key: "s7", label: (/*@copy atlas-figures.source-proteins-reaching-m.2391245*/`Mimicry Parents Reaching Antigen Target at ≥7/9`/*@endcopy*/) },
        { key: "s8", label: (/*@copy atlas-figures.source-proteins-reaching-m.20ba00b*/`Mimicry Parents Reaching Antigen Target at ≥8/9`/*@endcopy*/) },
        { key: "s9", label: (/*@copy atlas-figures.source-proteins-reaching-m.dba6b40*/`Mimicry Parents Reaching Antigen Target at ≥9/9`/*@endcopy*/) }]); },
      prepare: loadAllRecords,
      rows: function () {
        var placed = placedIds();
        /* Use the complete staged table when available; otherwise export the retained
           candidate records. Included in Figure Candidate Set describes each row's
           candidate membership, not a successful full-population load or Drawn in Figure. */
        if (ALL_RECORDS && COVERAGE) {
          var labels = PROTEIN_INDEX ? PROTEIN_INDEX.sources : [];
          var retained = {};
          (COVERAGE.top_targets || []).forEach(function (r) { retained[r.antigen_id] = true; });
          var floorIndex = {};
          ALL_RECORDS.floors.forEach(function (floor, i) { floorIndex[String(floor)] = i; });
          return COVERAGE.points.map(function (p, i) {
            var at = ALL_RECORDS.closest_source_index[i];
            var partner = at >= 0 ? (labels[at] || {}) : {};
            var row = { gene: p.gene || "", accession: p.accession || "", name: p.name || "",
              len: p.length_aa, on_plot: placed[p.antigen_id] ? "yes" : "no",
              closest: at >= 0 ? (partner.gene || partner.accession || "") : "",
              closest_accession: at >= 0 ? (partner.accession || "") : "",
              closest_len: at >= 0 ? (partner.length_aa || "") : "",
              retained: retained[p.antigen_id] ? "yes" : "no" };
            TRACKS.forEach(function (t) {
              var fi = floorIndex[String(t.floor)], key = String(t.floor);
              var closestCount = fi === undefined ? -1 : ALL_RECORDS.closest_covered_residues[fi][i];
              var pooledCount = fi === undefined ? -1 : ALL_RECORDS.pooled_covered_residues[fi][i];
              row["k" + key] = closestCount < 0 || !p.length_aa
                ? "" : Math.round(1e4 * 100 * closestCount / p.length_aa) / 1e4;
              row["c" + key] = pooledCount < 0 || !p.length_aa
                ? "" : Math.round(1e4 * 100 * pooledCount / p.length_aa) / 1e4;
              row["s" + key] = fi === undefined ? "" : ALL_RECORDS.sources_reaching[fi][i];
            });
            return Object.assign(row, exportRecord(p, "Antigen Target"), at >= 0 ? exportRecord(partner, "Mimicry Parent") : {});
          });
        }
        // Every carried record, in the payload's own order.
        /* The legacy closest field is a display label. Enrich it only when the label maps
           to one parent; repeated labels keep accession and description empty.
           The complete staged table above uses the exact parent roster index. */
        var byLabel = {};
        if (SURFACES) SURFACES.sources.forEach(function (e) {
          var key = e.gene || e.accession || String(e.antigen_id);
          byLabel[key] = Object.prototype.hasOwnProperty.call(byLabel, key) ? null :
            { gene: e.gene || "", accession: e.accession || "", description: e.description || "", len: e.length_aa };
        });
        return targetRows().map(function (r) {
          var partner = byLabel[r.closest] || {};
          return Object.assign({ gene: r.gene, accession: r.accession, name: r.name, len: r.len,
            on_plot: placed[r.id] ? "yes" : "no", closest: r.closest,
            closest_accession: partner.accession || "", closest_len: partner.len || "",
            retained: "yes",
            /* The protein named in `closest` and its coverage of this record at each floor.
               One protein per row: the per-floor closest can be a different protein at each
               threshold, and five proteins' numbers under one name is not a row. */
            k5: r.byClosest["5"], k6: r.byClosest["6"], k7: r.byClosest["7"],
            k8: r.byClosest["8"], k9: r.byClosest["9"],
            c5: r.covered["5"], c6: r.covered["6"], c7: r.covered["7"],
            c8: r.covered["8"], c9: r.covered["9"],
            s5: r.sources["5"], s6: r.sources["6"], s7: r.sources["7"],
            s8: r.sources["8"], s9: r.sources["9"] },
            exportRecord({gene: r.export_gene, accession: r.accession, name: r.name}, "Antigen Target"),
            byLabel[r.closest] ? exportRecord(partner, "Mimicry Parent") : {"Mimicry Parent": r.closest});
        });
      },
    },
  ];

  /* One panel shape for every figure in this section: heading with its rule, the export bar on
     that same line, then a card holding the plot and its caption. Extracted so the collection
     summary is the same object as the five panels below it rather than a lookalike that drifts. */
  function buildFigure(f, C) {
    var topic = typeof f.topic === "function" ? f.topic() : f.topic;
    /* The figure's name and the population it is drawn over, joined by the header divider, because
       they share one header line. The collection scatter is the one figure not drawn over a single
       proteome; it appends its threshold per plot instead and names its highlighted point there.
       The drawn header and the accessible name are the same string, so a reader and a screen
       reader are told the same thing. */
    PLOT_TITLE = f.key === "collection" ? topic
      : topic + HEAD_DIV + (typeof f.scope === "function" ? f.scope() : PROTEOME);
    var svg = f.build(C, f.floors ? figureFloor(f) : undefined);
    svg.setAttribute("aria-label", PLOT_TITLE);
    svg.setAttribute("data-tooltip", PLOT_TITLE);
    if (f.legend) svg.appendChild(el("desc", {}, typeof f.legend === "function" ? f.legend() : f.legend));
    return svg;
  }

  /* Keeps the accessible name on the exported copy. It used to graft a title line on top as well,
     because the figures themselves carried none; they do now, so grafting one would print the name
     twice. The signature is unchanged so the export buttons read the same. */
  function titledExport(svg, title, C) {
    var copy = svg.cloneNode(true);
    copy.appendChild(el("title", {}, svg.getAttribute("aria-label") || title));
    return copy;
  }

  /* The protein list arrives after the panel is built, so the options are (re)filled on every
     redraw rather than once at construction. Each option carries the protein's own reach and
     coverage at the working threshold, so the choice is informed before it is made. */
  /* Shared presentation-only picker. Values still flow through the existing selection routes. */
  var activeAtlasPicker = null;
  document.addEventListener("pointerdown", function (event) {
    if (activeAtlasPicker && !activeAtlasPicker.host.contains(event.target)) activeAtlasPicker.close(false);
  });
  function searchSelect(config) {
    var searchable = config.searchable !== false;
    var host = document.createElement("div");
    host.className = "af-search-select";
    var trigger = document.createElement("button");
    trigger.type = "button"; trigger.id = config.id + "Trigger";
    trigger.className = "af-picker-trigger";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", config.id + "Popup");
    var value = document.createElement("span"); value.className = "af-picker-value";
    var arrow = document.createElement("span"); arrow.className = "af-picker-arrow";
    arrow.textContent = "⌄"; arrow.setAttribute("aria-hidden", "true");
    trigger.append(value, arrow);
    var popup = document.createElement("div"); popup.className = "af-picker-popup";
    popup.id = config.id + "Popup"; popup.hidden = true;
    popup.setAttribute("role", "dialog"); popup.setAttribute("aria-label", config.label);
    var search = document.createElement("input");
    search.type = "search"; search.id = config.searchId || config.id + "Search";
    search.className = "af-picker-search"; search.placeholder = config.searchLabel;
    search.setAttribute("aria-label", config.searchLabel); search.setAttribute("role", "combobox");
    search.setAttribute("aria-autocomplete", "list"); search.setAttribute("aria-expanded", "false");
    var results = document.createElement("div"); results.className = "af-picker-options";
    results.id = config.resultsId || config.id + "Results";
    results.setAttribute("role", "listbox"); results.setAttribute("aria-label", config.label);
    search.setAttribute("aria-controls", results.id);
    var count = document.createElement("p"); count.className = "af-picker-count";
    count.setAttribute("role", "status"); count.setAttribute("aria-live", "polite");
    if (searchable) popup.appendChild(search);
    if (config.count) popup.appendChild(count);
    popup.appendChild(results); host.append(trigger, popup);
    var keyboard = searchable ? search : results;
    if (!searchable) results.tabIndex = 0;
    var matches = [], options = [], active = -1;
    function highlight(index, scroll) {
      active = index;
      options.forEach(function (option, i) { option.classList.toggle("is-active", i === active); });
      if (options[active]) {
        keyboard.setAttribute("aria-activedescendant", options[active].id);
        if (scroll) options[active].scrollIntoView({ block: "nearest" });
      } else keyboard.removeAttribute("aria-activedescendant");
    }
    function close(focus) {
      popup.hidden = true; host.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false"); search.setAttribute("aria-expanded", "false");
      keyboard.removeAttribute("aria-activedescendant");
      if (activeAtlasPicker && activeAtlasPicker.host === host) activeAtlasPicker = null;
      if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
    }
    function choose(item) {
      close(false);
      config.onChange(item.value);
      update();
      // Parent selection redraws its figure. Restore focus to the replacement trigger.
      var current = document.getElementById(trigger.id);
      if (current) current.focus({ preventScroll: true });
    }
    function populate() {
      var term = search.value.trim().toLowerCase();
      if (config.alias) term = config.alias(term);
      matches = config.items().filter(function (item) {
        return !term || [item.label, item.detail, item.search].join(" ").toLowerCase().indexOf(term) >= 0;
      });
      results.replaceChildren(); options = [];
      if (config.count) count.textContent = config.count(matches);
      matches.forEach(function (item, i) {
        var option = document.createElement("div");
        option.className = "af-picker-option"; option.id = config.id + "Option" + i;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", item.value === config.value() ? "true" : "false");
        var label = document.createElement("span"); label.className = "af-option-label"; label.textContent = item.label;
        var check = document.createElement("span"); check.className = "af-option-check";
        check.textContent = item.value === config.value() ? "✓" : ""; check.setAttribute("aria-hidden", "true");
        option.append(label, check);
        if (item.detail) {
          var detail = document.createElement("span"); detail.className = "af-option-detail";
          detail.textContent = item.detail; option.append(detail);
        }
        option.addEventListener("pointerdown", function (event) { event.preventDefault(); });
        option.addEventListener("click", function () { choose(item); });
        option.addEventListener("pointermove", function () { highlight(i, false); });
        results.appendChild(option); options.push(option);
      });
      if (!matches.length) {
        var empty = document.createElement("p"); empty.className = "af-picker-empty";
        empty.textContent = config.empty; results.appendChild(empty);
      }
      var selected = matches.findIndex(function (item) { return item.value === config.value(); });
      highlight(selected >= 0 ? selected : (matches.length ? 0 : -1), false);
    }
    function open() {
      if (trigger.disabled) return;
      if (activeAtlasPicker) activeAtlasPicker.close(false);
      activeAtlasPicker = { host: host, close: close };
      search.value = ""; populate(); popup.hidden = false; host.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true"); search.setAttribute("aria-expanded", "true");
      keyboard.focus({ preventScroll: true }); highlight(active, true);
    }
    function update() {
      var items = config.items(), selected = items.find(function (item) { return item.value === config.value(); });
      value.textContent = selected ? selected.label : config.label;
      trigger.title = selected ? [selected.label, selected.detail].filter(Boolean).join(" · ") : config.label;
      trigger.setAttribute("aria-label", config.label + ": " + value.textContent);
      trigger.disabled = config.disabled ? config.disabled() : !items.length;
      if (!popup.hidden) {
        var activeValue = matches[active] && matches[active].value, scrollTop = results.scrollTop;
        populate();
        var restored = matches.findIndex(function (item) { return item.value === activeValue; });
        if (restored >= 0) highlight(restored, false);
        results.scrollTop = scrollTop;
      }
    }
    trigger.addEventListener("click", function () { if (popup.hidden) open(); else close(true); });
    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open(); }
    });
    search.addEventListener("input", populate);
    keyboard.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (matches.length) highlight((active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length, true);
      } else if ((event.key === "Enter" || (!searchable && event.key === " ")) && matches[active]) { event.preventDefault(); choose(matches[active]); }
      else if (!searchable && (event.key === "Home" || event.key === "End")) {
        event.preventDefault(); highlight(event.key === "Home" ? 0 : matches.length - 1, true);
      } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    });
    host.addEventListener("focusout", function (event) { if (!host.contains(event.relatedTarget)) close(false); });
    host.update = update; host.close = close; update();
    return host;
  }

  function syncSourcePicker(picker) {
    if (picker) picker.update();
  }

  function panelFrame(f) {
    if (f.key === "coverage") return [1100, FRAME_HEAD + TRACKS.length * TRACK_H + (TRACKS.length - 1) * TRACK_GAP + FRAME_FOOT];
    if (f.key === "collection") return [720, 385];
    if (f.key === "ladder") return [TABLE_WIDTH, HEAD_RULE + TRACKS.length * ROW_H + 10];
    if (f.key === "spread") return [TABLE_WIDTH, HEAD_RULE + 20 + TRACKS.length * ROW_H + 16];
    return [TABLE_WIDTH, HEAD_RULE + SOURCE_ROWS_DRAWN * ROW_H + 10];
  }

  // Freeze text block heights while a replacement is pending. Width changes reset the
  // minimum so the existing responsive layout can reflow normally.
  function retainBlockHeight(node) {
    var width = node.clientWidth;
    if (node._stableWidth !== width) {
      node.style.minHeight = "";
      node._stableWidth = width;
      // Dynamic counts and names can wrap a loading caption onto another line.
      // Reserve two lines at this width before the payload arrives.
      if (node.classList.contains("af-cap")) {
        var lineHeight = parseFloat(getComputedStyle(node).lineHeight) || 20;
        node.style.minHeight = (node.getBoundingClientRect().height + 2 * lineHeight) + "px";
      }
    }
    node.style.minHeight = node.getBoundingClientRect().height + "px";
  }

  function buildPanel(f, C) {
    var val = function (x) { return typeof x === "function" ? x() : x; };
    var sec = document.createElement("section");
    sec.className = f.span ? "af-panel af-span" : "af-panel";
    sec.dataset.figure = f.key;

    var head = document.createElement("div");
    head.className = "af-panel-head";
    var h3 = document.createElement("h3");
    h3.innerHTML = (/*@copy atlas-figures.text.cd5a6b2*/`<span class="af-topic"></span>`/*@endcopy*/);
    h3.children[0].textContent = val(f.topic) || "";
    head.appendChild(h3);

    /* A figure read at a threshold the reader picks owns that choice, rather than following a
       page-wide one: the threshold decides the sort, the numbers, the caption and what the
       export contains, and two tables side by side are often worth reading at two different
       ones. Both open at the same 7/9 the rest of the section defaults to. */
    var svg = null, ready = false, exportPending = false;
    if (f.floors) {
      var picker = document.createElement("div");
      picker.className = "af-floorpick";
      picker.setAttribute("role", "group");
      picker.setAttribute("aria-label", (/*@copy atlas-figures.minimum-identity-for-this-figure.846b3e8*/`Minimum Core Identity for This Figure`/*@endcopy*/));
      var pickLabel = document.createElement("span");
      pickLabel.className = "af-floorpick-label";
      pickLabel.textContent = (/*@copy atlas-figures.min-identity.a7f02f5*/`Identity ≥`/*@endcopy*/);
      picker.appendChild(pickLabel);
      TRACKS.forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = t.label.replace(" of ", "/");
        b.setAttribute("aria-pressed", String(t.floor === figureFloor(f)));
        b.addEventListener("click", function () {
          if (t.floor === figureFloor(f)) return;
          FIGURE_FLOOR[f.key] = t.floor;
          refresh();
        });
        picker.appendChild(b);
      });
      head.appendChild(picker);
    }
    /* One viral protein at a time, or all of them pooled. A select rather than buttons: a
       proteome can carry 217 proteins, which is a list to search, not a row to click along. */
    var sourcePicker;
    if (f.sources) {
      sourcePicker = document.createElement("div");
      sourcePicker.className = "af-sourcepick";
      var sourceLabel = document.createElement("span");
      sourceLabel.className = "af-sourcepick-label";
      sourceLabel.textContent = (/*@copy atlas-figures.coverage-source-label*/`Viral Parent`/*@endcopy*/);
      var sourceSelect = searchSelect({
        id: "atlasParent",
        label: (/*@copy atlas-figures.coverage-source-control*/`Viral Parent for This Figure`/*@endcopy*/),
        searchLabel: (/*@copy atlas-figures.parent-search*/`Search Viral Parents…`/*@endcopy*/),
        empty: (/*@copy atlas-figures.parent-no-results*/`No viral parents match your search.`/*@endcopy*/),
        count: function () { return (/*@copy atlas-figures.parent-option-count*/`${PROTEIN_INDEX ? PROTEIN_INDEX.sources.length : 0} viral parents in this proteome`/*@endcopy*/); },
        disabled: function () { return !PROTEIN_INDEX || !COVERAGE; },
        value: function () { return PROTEIN_SOURCE == null ? "" : String(PROTEIN_SOURCE); },
        items: function () {
          var items = [{ value: "", label: (/*@copy atlas-figures.coverage-source-pooled*/`All Viral Parents (Pooled)`/*@endcopy*/) }];
          return items.concat(PROTEIN_INDEX ? PROTEIN_INDEX.sources.map(function (source, i) {
            return { value: String(i), label: source.gene || source.accession || String(source.antigen_id),
              detail: [source.accession, source.description].filter(Boolean).join(" · ") };
          }) : []);
        },
        onChange: function (value) { selectProteinSource(value === "" ? null : Number(value)); }
      });
      sourcePicker.append(sourceLabel, sourceSelect);
      head.appendChild(sourcePicker);
    }
    if (f.arrangement) {
      var arrangementPicker = document.createElement("div");
      arrangementPicker.className = "af-sourcepick af-arrangementpick";
      var arrangementControl = searchSelect({ id: "atlasArrangement", searchable: false,
        label: (/*@copy atlas-figures.arrangement-control*/`Arrange Human Targets`/*@endcopy*/), value: function () { return COVERAGE_ARRANGEMENT; },
        items: arrangementOptions,
        onChange: function (value) { COVERAGE_ARRANGEMENT = value; refresh(); }
      });
      arrangementPicker.appendChild(arrangementControl); head.appendChild(arrangementPicker);
    }
    /* Reach and residue coverage are two measurements of the same matches, and a figure that can
       show either says which one it is showing in its axis, title, caption and filename. The
       control is a per-figure descriptor rather than one shared page-wide variable: two figures
       can be read at two different measures at once, the same way two tables can be read at two
       different thresholds. */
    var metricPicker;
    if (f.metric) {
      metricPicker = document.createElement("div");
      metricPicker.className = "af-floorpick af-metricpick";
      metricPicker.setAttribute("role", "group");
      metricPicker.setAttribute("aria-label", val(f.metric.label));
      f.metric.options.forEach(function (option) {
        var button = document.createElement("button");
        button.type = "button"; button.textContent = option[1]; button.dataset.metric = option[0];
        button.setAttribute("aria-pressed", String(f.metric.get() === option[0]));
        button.addEventListener("click", function () {
          if (f.metric.get() === option[0]) return;
          f.metric.set(option[0]); refresh();
        });
        metricPicker.appendChild(button);
      });
      head.appendChild(metricPicker);
    }
    var bar = document.createElement("div");
    bar.className = "af-exportbar";
    [["CSV", "csv"], ["PNG", "png"], ["SVG", "svg"], ["Code", "code"]].forEach(function (kv) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "af-exportbtn"; b.textContent = kv[0];
      b.dataset.exportKind = kv[1];
      b.hidden = kv[1] === "code" && typeof window.SeroMapCodeExport !== "function";
      b.disabled = true;
      b.addEventListener("click", function () {
        if (!ready || exportPending) return;
        // The picture follows the threshold it is being read at, name included, so two captures
        // at two thresholds do not land on top of each other. The data file does not: it is the
        // whole table with every floor already in it, so it is one file however the figure is
        // being read, and it says so by not carrying a threshold in its name.
        /* A figure whose export covers more than it draws loads that material on demand, so the
           page stays light for readers who never export. */
        if (kv[1] === "csv") {
          var revision = exportSelection();
          exportPending = true; syncExports();
          Promise.resolve(f.prepare ? f.prepare() : null).then(function () {
            if (ready && revision === exportSelection()) csv(val(f.dataFile || f.file), val(f.columns), val(f.rows));
          }).finally(function () { exportPending = false; syncExports(); });
        }
        if (kv[1] === "code") {
          if (typeof window.SeroMapCodeExport !== "function") return;
          var codeRevision = exportSelection();
          exportPending = true; syncExports();
          Promise.resolve(f.prepare ? f.prepare() : null).then(function () {
            if (!ready || codeRevision !== exportSelection()) throw new Error("The figure selection changed while preparing Code. Export the current selection again.");
            var columns = val(f.columns), rows = val(f.rows);
            // The same public labels and percent formatting as the native CSV.
            var csvRows = rows.map(function (row) {
              return Object.fromEntries(columns.map(function (column) {
                var value = column.label.includes("(%)") ? window.MimicryExportCore.exportPercent(row[column.key]) : row[column.key];
                return [column.key, window.MimicryOneIdentity.publicText(value)];
              }));
            });
            return window.SeroMapCodeExport({
              filename: val(f.file), csv: { rows: csvRows, columns: columns },
              svg: window.MimicryAtlasTable.exportNode(titledExport(svg, val(f.topic), C)),
              reproduction: {
                id: "mimicry-atlas-" + f.key, title: val(f.topic),
                methods: val(f.legend) + " This package replays published numeric results and the captured figure. Sequence matching and library-wide calculation are not performed.",
                settings: { proteome: PROTEOME, selection: JSON.parse(codeRevision), release: ACTIVE_RELEASE_META },
                data: { rows: rows },
                columnDefinitions: exportColumnDefinitions(columns),
                scope: { mode: "frozen-result-replay", upstreamRecomputed: false, table: "The same available data population as this surface's CSV", figure: "Current figure selection", sequenceMatching: "Not executed or packaged" },
                sources: ["mimicrymap/atlas-figures.js"]
              }
            });
          }).catch(function (error) {
            if (error.name !== "AbortError") { status.hidden = false; statusText.textContent = "Code export failed: " + error.message; }
          }).finally(function () { exportPending = false; syncExports(); });
        }
        var caption = val(f.topic) + "\n\n" + val(f.legend) + "\n";
        if (kv[1] === "svg" || kv[1] === "png") {
          exportPending = true; syncExports();
          Promise.resolve().then(function () {
            var figure = titledExport(svg, val(f.topic), C);
            return kv[1] === "svg" ? exportSvg(figure, val(f.file), C, caption) : exportPng(figure, val(f.file), C, caption);
          }).catch(function (error) {
            if (error.name !== "AbortError") { status.hidden = false; statusText.textContent = "Figure export failed: " + error.message; }
          }).finally(function () { exportPending = false; syncExports(); });
        }
      });
      bar.appendChild(b);
    });
    head.appendChild(bar);
    sec.appendChild(head);
    var extraControls = f.controls ? f.controls() : null;
    if (extraControls) sec.appendChild(extraControls.host);

    if (sourcePicker) syncSourcePicker(sourcePicker.querySelector(".af-search-select"));
    var card = document.createElement("div");
    card.className = "af-card";
    var scroll = document.createElement("div");
    scroll.className = "af-scroll";
    var dimensions = panelFrame(f);
    scroll.style.setProperty("--af-frame-width", dimensions[0] + "px");
    scroll.style.setProperty("--af-frame-ratio", dimensions[0] + " / " + dimensions[1]);
    var plot = document.createElement("div"); plot.className = "af-plot";
    scroll.appendChild(plot);
    var status = document.createElement("div");
    status.className = "af-update-status"; status.setAttribute("role", "status");
    status.hidden = true;
    var statusText = document.createElement("span"); status.appendChild(statusText);
    scroll.appendChild(status);
    card.appendChild(scroll);
    var cap = document.createElement("p");
    cap.className = "af-cap";
    cap.textContent = val(f.legend);
    card.appendChild(cap);
    sec.appendChild(card);

    /* Redraw this figure alone. The caption is rebuilt with it because it names the threshold
       the rows are sorted on, and a caption describing the previous one is worse than none. */
    function exportSelection() {
      return JSON.stringify([PROTEOME_REQUEST, SOURCE_REQUEST, COVERAGE_ARRANGEMENT,
        f.floors ? figureFloor(f) : null, f.metric ? f.metric.get() : null, f.selection ? f.selection() : null]);
    }
    function syncExports() {
      bar.querySelectorAll("button").forEach(function (button) {
        var unavailable = button.dataset.exportKind === "code" && typeof window.SeroMapCodeExport !== "function";
        button.hidden = unavailable;
        button.disabled = !ready || exportPending || unavailable;
      });
    }
    window.addEventListener("seromap:code-export-ready", syncExports);
    function refresh(nextTokens) {
      if (nextTokens) C = nextTokens;
      var next = buildFigure(f, C), state = next.dataset.loadState || "ready";
      ready = state === "ready" && (!f.available || f.available());
      if (sec.isConnected) { retainBlockHeight(head); retainBlockHeight(cap); }
      sec.dataset.loadState = state;
      sec.setAttribute("aria-busy", String(state === "loading"));
      status.hidden = ready;
      if (!ready) {
        statusText.textContent = next.querySelector("text") ? next.querySelector("text").textContent : "";
        // Keep the last complete SVG and its matching caption until a full replacement exists.
        // On first load the reserved frame supplies the same space, without fictional data.
        if (svg) svg.setAttribute("aria-hidden", "true");
        plot.inert = true;
      } else {
        statusText.textContent = "";
        plot.inert = false;
        if (!svg || !svg.isEqualNode(next)) {
          if (svg) svg.replaceWith(next);
          else plot.appendChild(next);
          svg = next;
        }
        svg.removeAttribute("aria-hidden");
        cap.textContent = val(f.legend);
      }
      syncExports();
      h3.children[0].textContent = val(f.topic) || "";
      if (sourcePicker) syncSourcePicker(sourcePicker.querySelector(".af-search-select"));
      if (arrangementControl) arrangementControl.update();
      if (extraControls) extraControls.update();
      if (metricPicker) metricPicker.querySelectorAll("button").forEach(function (button) {
        button.setAttribute("aria-pressed", String(button.dataset.metric === f.metric.get()));
      });
      if (picker) {
        Array.prototype.forEach.call(picker.querySelectorAll("button"), function (b, i) {
          b.setAttribute("aria-pressed", String(TRACKS[i].floor === figureFloor(f)));
        });
      }
    }

    sec.refresh = refresh;
    refresh();
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(function () {
        [head, cap].forEach(function (node) {
          if (node._stableWidth !== node.clientWidth) {
            retainBlockHeight(node);
          }
        });
      }).observe(sec);
    }

    /* No release-verification line under the figure. Whether an artifact's fingerprint matches
       the running release is a build-time fact about this deployment, not something the figure
       asserts to a reader. The check still runs; it no longer rides in the CSV, which now
       carries a column header and data and nothing else, so release identity lives in the
       export bundle's provenance.json instead. Everything a reader needs to read the figure --
       counting rule, denominator, exclusions, axis -- is in the caption. */
    return sec;
  }

  function render() {
    var host = document.getElementById("atlasScaleFigures");
    if (!host) return;
    var C = tokens(), panels = host.querySelectorAll(".af-panel");
    if (panels.length) {
      panels.forEach(function (panel) { panel.refresh(C); });
      return;
    }
    var grid = null, column = 0;
    FIGS.forEach(function (f) {
      if (column === 0 || (f.span && column !== 0)) {
        grid = document.createElement("div"); grid.className = "af-grid";
        host.appendChild(grid); column = 0;
      }
      column = f.span ? 0 : (column + 1) % 2;
      var sec = buildPanel(f, C);
      grid.appendChild(sec);
    });
  }

  function wireTheme(onTheme) {
    // Shared site chrome owns persistence and controls on every page.
    window.addEventListener("mimicryone:theme", onTheme);
    onTheme();
  }

  /* The per-result figures are left exactly as their own code renders them. An earlier
     attempt here to cap and center them collapsed them from 0.60 to 0.09 scale, because
     their parent is a grid cell and a centering flex wrapper shrinks a width:100% svg to its
     content. Shrink-to-fit inside a narrow column is allowed by the house rule; only
     scaling ABOVE natural width is not, and that was this module's own bug. */

  /* Epstein-Barr virus opens the section when it is present, because it is the proteome the
     surrounding prose walks through; otherwise the first entry, so the section is never empty. */
  function defaultSlug() {
    if (!FLEET) return DEFAULT_SLUG;
    var names = FLEET.proteomes.map(function (p) { return p.slug; });
    return names.indexOf(DEFAULT_SLUG) >= 0 ? DEFAULT_SLUG : (names[0] || DEFAULT_SLUG);
  }

  function proteomeEntry(slug) {
    if (!FLEET) return null;
    return FLEET.proteomes.filter(function (p) { return p.slug === slug; })[0] || null;
  }

  /* One place decides which proteome the whole section is describing: the payload URLs, the
     name every panel prints, and the heading above them. Loading is restarted from "loading"
     rather than left holding the previous proteome's numbers under a new name. */
  function selectProteome(slug) {
    var entry = proteomeEntry(slug), request = ++PROTEOME_REQUEST;
    SOURCE_REQUEST++;
    PROTEOME_SLUG = slug;
    PROTEOME = (entry && entry.label) || PROTEOME;
    COVERAGE_URL = "/data/collection-coverage/" + slug + ".json.gz";
    SURFACES_URL = "/data/collection-coverage/" + slug + ".surfaces.json.gz";
    PROTEIN_INDEX_URL = "/data/collection-protein-surfaces/" + slug + "/index.json";
    COVERAGE = SURFACES = null;
    COVERAGE_STATE = SURFACES_STATE = "loading";
    /* A new proteome's proteins are not the previous one's, so the selection returns to the
       pooled surface rather than to whatever position the old protein happened to occupy. */
    PROTEIN_INDEX = PROTEIN_SURFACE = null;
    PROTEIN_SOURCE = null;
    COLLECTION_SOURCE = null;
    ALL_RECORDS = null; ALL_RECORDS_SLUG = ""; ALL_RECORDS_PENDING = null;
    PROTEIN_INDEX_STATE = "loading";
    PROTEIN_SURFACE_STATE = "";
    syncProteomeHeading(entry);
    syncSequenceDownload(entry);
    var picker = document.querySelector("#atlasProteomePicker .af-search-select");
    if (picker) picker.update();
    renderCollection();
    render();
    var wanted = slug;
    loadPayload(COVERAGE_URL, function (d, state) {
      if (request !== PROTEOME_REQUEST || wanted !== PROTEOME_SLUG) return;   /* a later choice already replaced this one */
      var ok = d && Array.isArray(d.points);
      COVERAGE = ok ? d : null;
      COVERAGE_STATE = ok ? state : "missing";
      render();
    });
    loadPayload(SURFACES_URL, function (d, state) {
      if (request !== PROTEOME_REQUEST || wanted !== PROTEOME_SLUG) return;
      var ok = d && Array.isArray(d.sources) && Array.isArray(d.ladder);
      SURFACES = ok ? d : null;
      SURFACES_STATE = ok ? state : "missing";
      render();
    });
    /* Load the parent roster first. Fetch a parent's residue-coverage file only when
       selected, rather than loading all per-parent files with the page. */
    loadPayload(PROTEIN_INDEX_URL, function (d, state) {
      if (request !== PROTEOME_REQUEST || wanted !== PROTEOME_SLUG) return;
      var ok = d && Array.isArray(d.sources) && d.sources.length;
      PROTEIN_INDEX = ok ? d : null;
      PROTEIN_INDEX_STATE = ok ? state : "missing";
      renderCollection();
      render();
    });
  }

  /* Choose a viral protein, or null for the pooled proteome. The figure redraws immediately in
     its loading state and again when the protein's residue counts arrive, so a slow file never
     leaves the previous protein's heights sitting under a new protein's name. */
  function selectProteinSource(index) {
    var request = ++SOURCE_REQUEST;
    if (index == null || !PROTEIN_INDEX) {
      PROTEIN_SOURCE = null; PROTEIN_SURFACE = null; PROTEIN_SURFACE_STATE = "";
      render();
      return;
    }
    var source = PROTEIN_INDEX.sources[index];
    if (!source) return;
    PROTEIN_SOURCE = index;
    PROTEIN_SURFACE = null;
    PROTEIN_SURFACE_STATE = "loading";
    render();
    var wantedSlug = PROTEOME_SLUG, wantedIndex = index;
    loadPayload("/data/collection-protein-surfaces/" + PROTEOME_SLUG + "/" + source.file,
      function (d, state) {
        if (request !== SOURCE_REQUEST || wantedSlug !== PROTEOME_SLUG || wantedIndex !== PROTEIN_SOURCE) return;
        var covered = state === "ready" ? proteinSurfaceCovered(d) : null;
        PROTEIN_SURFACE = covered;
        /* A payload that arrived but does not line up with this proteome's records is a
           mismatch, not a slow load, and must not be drawn. */
        PROTEIN_SURFACE_STATE = covered ? "ready" : "missing";
        render();
      });
  }

  /* The kicker names the proteome on screen. The full organism string, strain and all, is the
     option's title and the kicker's tooltip: the label is what a reader scans, the organism and
     its taxon id are what identify it when two labels differ only by a dropped strain suffix. */
  /* The download for the selected proteome. Hidden rather than disabled when the staged set does
     not carry it: an offer that fails on click is worse than no offer. */
  function syncSequenceDownload(entry) {
    var coverageHost = document.getElementById("atlasSelectedCoverageDownloads");
    if (coverageHost) {
      var catalog = window.MimicrySelectedVirusSummaries;
      var selectedSlug = (entry && entry.slug) || PROTEOME_SLUG;
      var downloads = catalog && FLEET && catalog.release_fingerprint === FLEET.release_fingerprint
        && catalog.proteomes[selectedSlug];
      coverageHost.hidden = !downloads;
      [["atlasHumanToSelectedVirus", "human_to_virus"], ["atlasSelectedVirusToHuman", "virus_to_human"]].forEach(function (pair) {
        var anchor = document.getElementById(pair[0]);
        if (!anchor) return;
        if (!downloads) { anchor.removeAttribute("href"); anchor.removeAttribute("download"); return; }
        anchor.href = downloads[pair[1]];
        anchor.setAttribute("download", downloads[pair[1]].split("/").pop());
        anchor.title = entry.organism;
      });
    }
    /* Keep selected-virus links dynamic inside the authored atlas download area. */
    var selection = document.getElementById("atlasSequenceDownloadsSlot") || document.querySelector(".atlas-live-selection");
    if (!selection) return;
    var host = document.getElementById("atlasSequenceDownload");
    if (!host) {
      host = document.createElement("p");
      host.className = "atlas-sequence-download";
      host.id = "atlasSequenceDownload";
      var anchor = document.createElement("a");
      anchor.id = "atlasSequenceLink";
      anchor.setAttribute("download", "");
      anchor.textContent = (/*@copy atlas-figures.sequence-download-label*/`Selected virus FASTA`/*@endcopy*/);
      host.appendChild(anchor);
      var humanLink = document.createElement("a");
      humanLink.id = "atlasHumanSequenceLink";
      humanLink.textContent = (/*@copy atlas-figures.human-sequence-download-label*/`Human Swiss-Prot FASTA`/*@endcopy*/);
      humanLink.hidden = true;
      host.appendChild(humanLink);
      var allLink = document.createElement("a");
      allLink.id = "atlasAllSequencesLink";
      allLink.textContent = (/*@copy atlas-figures.all-sequences-download-label*/`All viruses FASTA`/*@endcopy*/);
      allLink.hidden = true;
      host.appendChild(allLink);
      selection.appendChild(host);
    }
    var link = document.getElementById("atlasSequenceLink");
    if (!link) return;
    var slug = (entry && entry.slug) || PROTEOME_SLUG;
    var staged = SEQUENCES && SEQUENCES.sequences
      && SEQUENCES.sequences.filter(function (s) { return s.slug === slug; })[0];
    var bundles = SEQUENCE_DOWNLOADS && SEQUENCES
      && SEQUENCE_DOWNLOADS.release_fingerprint === SEQUENCES.release_fingerprint
      && SEQUENCE_DOWNLOADS.release_id === SEQUENCES.release_id ? SEQUENCE_DOWNLOADS : null;
    var humanLink = document.getElementById("atlasHumanSequenceLink");
    var allLink = document.getElementById("atlasAllSequencesLink");
    function setBundle(anchor, item, filename) {
      var available = item && typeof item.file === "string" && /^[a-z0-9_]+\.fasta$/.test(item.file);
      anchor.hidden = !available;
      if (!available) { anchor.removeAttribute("href"); anchor.removeAttribute("download"); return; }
      anchor.href = "/data/collection-sequences/" + item.file;
      anchor.setAttribute("download", filename);
    }
    var publicHuman = window.MimicryPublicSequences && window.MimicryPublicSequences.human_swissprot;
    if (publicHuman && typeof publicHuman.url === "string") {
      humanLink.hidden = false;
      humanLink.href = publicHuman.url;
      humanLink.setAttribute("download", "human_swissprot.fasta");
    } else { humanLink.hidden = true; humanLink.removeAttribute("href"); humanLink.removeAttribute("download"); }

    setBundle(allLink, bundles && bundles.all_viruses, "all_viruses.fasta");
    if (publicHuman) humanLink.dataset.tooltip = (/*@copy atlas-figures.human-sequence-download-tooltip*/`All ${nf(publicHuman.records)} human Swiss-Prot records, including short proteins excluded from plots; ${nf(publicHuman.residues)} residues. Uses public accession, gene and protein-description headers.`/*@endcopy*/);
    if (bundles && bundles.all_viruses) allLink.dataset.tooltip = (/*@copy atlas-figures.all-sequences-download-tooltip*/`All ${nf(bundles.all_viruses.proteomes)} viral proteomes in this atlas: ${nf(bundles.all_viruses.records)} protein records and ${nf(bundles.all_viruses.residues)} residues in one FASTA. Preserves each proteome's records and headers, including shared sequences.`/*@endcopy*/);
    link.hidden = !staged;
    host.hidden = !staged && humanLink.hidden && allLink.hidden;
    if (!staged) { link.removeAttribute("href"); return; }
    link.href = "/data/collection-sequences/" + staged.file;
    link.setAttribute("download", slug + "_source_proteins.fasta");
    link.dataset.tooltip = (/*@copy atlas-figures.sequence-download-tooltip*/`The ${nf(staged.proteins)} ${staged.label} proteins these figures were computed from, ${nf(staged.residues)} residues, as FASTA from release ${SEQUENCES.release_id}.`/*@endcopy*/);
  }

  function syncProteomeHeading(entry) {
    var kicker = document.getElementById("atlasProteomeKicker");
    if (!kicker) return;
    /* Names the proteome and its two sizes, which are the numbers the panels below are scaled
       against; "current release" said nothing a reader could act on. */
    var parts = [(entry && entry.label) || PROTEOME];
    if (entry && entry.source_records) {
      parts.push(Number(entry.source_records).toLocaleString() +
        (Number(entry.source_records) === 1 ? " protein" : " proteins"));
    }
    if (entry && entry.proteome_length_aa) {
      parts.push(Number(entry.proteome_length_aa).toLocaleString() + " AA");
    }
    var nameLine = document.createElement("span");
    nameLine.textContent = parts[0];
    var countsLine = document.createElement("span");
    countsLine.className = "atlas-proteome-counts";
    countsLine.textContent = parts.slice(1).join(" · ");
    kicker.replaceChildren(nameLine, countsLine);
    var detail = entry && entry.organism
      ? entry.organism + (entry.taxon_id ? " · NCBI taxon " + entry.taxon_id : "")
      : "";
    if (detail) kicker.dataset.tooltip = detail;
    else kicker.removeAttribute("data-tooltip");
  }

  /* Alphabetical order is the order a reader steps through, so it is computed once and shared
     by the search results and the previous/next controls. */
  function orderedProteomes() {
    if (!FLEET) return [];
    return FLEET.proteomes.slice().sort(function (a, b) {
      return String(a.label).localeCompare(String(b.label));
    });
  }

  function proteomeCount(entry) {
    var count = Number(entry.source_records || 0);
    return count.toLocaleString() + (count === 1 ? " protein" : " proteins");
  }

  /* 120 proteomes is too many to scan in a dropdown, so this mirrors the organism scope picker
     used above: type to narrow, or step through in alphabetical order without typing at all. */
  function buildProteomeSelect() {
    var host = document.getElementById("atlasProteomePicker");
    if (!host) return;
    host.replaceChildren();
    if (!orderedProteomes().length) { host.hidden = true; return; }
    host.hidden = false;
    var row = document.createElement("div"); row.className = "atlas-proteome-row";
    var previous = document.createElement("button"), next = document.createElement("button");
    previous.type = next.type = "button";
    previous.className = next.className = "btn ghost atlas-proteome-step";
    previous.textContent = "‹"; next.textContent = "›";
    previous.setAttribute("aria-label", (/*@copy atlas-figures.previous-proteome-alphabetically.f96afa6*/`Previous proteome, alphabetically`/*@endcopy*/));
    next.setAttribute("aria-label", (/*@copy atlas-figures.next-proteome-alphabetically.12e0030*/`Next proteome, alphabetically`/*@endcopy*/));
    function step(delta) {
      var order = orderedProteomes();
      var at = order.map(function (p) { return p.slug; }).indexOf(PROTEOME_SLUG);
      selectProteome(order[((at < 0 ? 0 : at) + delta + order.length) % order.length].slug);
    }
    previous.addEventListener("click", function () { step(-1); });
    next.addEventListener("click", function () { step(1); });
    var picker = searchSelect({
      id: "atlasProteome", searchId: "atlasProteomeSearch", resultsId: "atlasProteomeResults",
      label: (/*@copy atlas-figures.matching-viral-proteomes.f3a64a3*/`Viral Proteome`/*@endcopy*/),
      searchLabel: (/*@copy atlas-figures.find-a-viral-proteome.59ba495*/`Search Viral Proteomes`/*@endcopy*/),
      empty: (/*@copy atlas-figures.no-proteome-in-this-collection.49d8dda*/`No proteome in this collection matches that.`/*@endcopy*/),
      count: function (matches) { return (/*@copy atlas-figures.keep-typing-to-narrow-matches.c32c42a*/`${matches.length} Matching Viral Proteomes`/*@endcopy*/); },
      value: function () { return PROTEOME_SLUG; },
      alias: function (term) { return term === "ebv" ? "epstein" : term; },
      items: function () { return orderedProteomes().map(function (entry) {
        return { value: entry.slug, label: (/*@copy atlas-figures.text.83f747f*/`${entry.label} · ${proteomeCount(entry)}`/*@endcopy*/),
          detail: entry.organism || "", search: entry.taxon_id || "" };
      }); },
      onChange: selectProteome
    });
    // The existing placeholder key remains the authored search prompt.
    picker.querySelector("input").placeholder = (/*@copy atlas-figures.choose-another-virus.f46fcba*/`Search Viral Proteomes…`/*@endcopy*/);
    row.append(previous, picker, next); host.appendChild(row);
  }


  function boot() {
    var started = false;
    /* Both hosts, not one. The panels live in #atlasScaleFigures and the collection scatter in
       #atlasCollection, and only the first was redrawn on a theme change - so that figure kept
       whichever palette it was first built with. Switching to light left it holding dark-mode
       ink, which is near-white, and its labels went pale on a cream ground while every other
       plot on the page changed correctly. An SVG reads its colors once, at draw time. */
    wireTheme(function () { if (started) { renderCollection(); render(); } });
    // Load when the reader reaches the section, so a 1.2 MB coverage payload and 20,000-odd
    // circles do not compete with the initial player for network and rendering work.
    var publicationHost = document.getElementById("atlasScale");
    if (!publicationHost || publicationHost.hidden) return;
    // Mount the lightweight frames before scrolling can expose the section. Payloads and
    // data-heavy SVGs remain deferred; empty hosts must not expand by several screens.
    renderCollection();
    render();
    syncSequenceDownload(proteomeEntry(PROTEOME_SLUG));
    function startFigures() {
    if (started) return;
    started = true;
    fetch("/reference/atlas-human-localization.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("Annotation asset unavailable"); return r.json(); })
      .then(function (d) { LOCALIZATION = d; LOCALIZATION_CHECKED = null; LOCALIZATION_STATE = "ready"; render(); })
      .catch(function () { LOCALIZATION = null; LOCALIZATION_STATE = "missing"; render(); });
    renderCollection();
    render();
    fetch("/api/analysis/meta", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { ACTIVE_RELEASE_META = d; syncCorpusCounts(); render(); })
      .catch(function () { ACTIVE_RELEASE_META = null; render(); });
    /* A payload that parses but has the wrong shape must read as missing. Accepting it
       would draw an empty figure under a "current release verified" heading. */
    loadPayload("/data/collection-sequences/downloads.json", function (d) {
      SEQUENCE_DOWNLOADS = d && d.schema === "mimicryone/atlas-sequence-downloads/1" ? d : null;
      syncSequenceDownload(proteomeEntry(PROTEOME_SLUG));
    });
    loadPayload("/data/collection-sequences/index.json", function (d) {
      SEQUENCES = d && Array.isArray(d.sequences) ? d : null;
      syncSequenceDownload(proteomeEntry(PROTEOME_SLUG));
    });
    fetch(INDEX_URL, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        FLEET = d && Array.isArray(d.proteomes) ? d : null;
        FLEET_STATE = FLEET ? "ready" : "missing";
        syncCorpusCounts();
        buildProteomeSelect();
        selectProteome(defaultSlug());
      })
      .catch(function () { FLEET = null; FLEET_STATE = "missing"; buildProteomeSelect(); selectProteome(DEFAULT_SLUG); });
    }

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
        observer.disconnect();
        startFigures();
      }, { rootMargin: "0px" });
      observer.observe(publicationHost);
    } else startFigures();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
