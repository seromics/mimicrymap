/* Descriptive presentation of an existing complete result. No sequence matching. */
(function (root) {
  "use strict";
  const exportCore=typeof module!=="undefined"&&module.exports?require('./reproduce/export-core.js'):root.MimicryExportCore;
  const coverageCore=typeof module!=="undefined"&&module.exports?require('./reproduce/residue-coverage.js'):root.MimicryResidueCoverage;
  const identityLabels=typeof module!=="undefined"&&module.exports?require('./mimicryone-identity.js'):root.MimicryOneIdentity;
  const coverageNames=typeof module!=="undefined"&&module.exports?require('./coverage-gene-names.js'):root.MimicryCoverageGeneNames;
  function coveragePointIdentity(source, releaseFingerprint) {
    const identity=identityLabels.resolve(source), parsed=identityLabels.parseHeader(source);
    // UniProt entry names (the third pipe field) are not gene symbols. Prefer
    // explicit gene metadata or GN=; never infer a gene from a protein name.
    const explicit=source.primary_gene||source.gene_symbol||source.gene;
    const fasta=/^>?(?:sp|tr)\|/i.test(parsed.fullHeader);
    const gn=fasta&&parsed.fullHeader.match(/\bGN=([^\s]+)/);
    const candidateGene=fasta&&!explicit?(gn?gn[1]:''):identity.gene;
    let gene=candidateGene && !/[|()\s]/.test(candidateGene)?candidateGene:'';
    const accession=identity.accession||[source.display_id,source.protein_id].find(v=>/^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/.test(v||''));
    const fingerprint=releaseFingerprint || source.record_identity?.analysis_release_fingerprint;
    const named=coverageNames && (source.library_id||source.library||source.library_key)===coverageNames.library
      && (!fingerprint||fingerprint===coverageNames.release_fingerprint)
      && coverageNames.records[String(source.antigen_id)];
    // Same curated gene field as the atlas's Closest match column. Match both
    // record and accession; never borrow a label from an unrelated record.
    if((!gene||gene===accession)&&named&&named[0]===accession)gene=named[1];
    const tooltip=gene&&gene!==identity.gene?'Gene: '+gene+'\n'+identity.tooltip:identity.tooltip;
    return {label:identityLabels.publicText(gene||accession||parsed.assayId||''),accession:identityLabels.publicText(accession||parsed.assayId||''),tooltip};
  }
  function unionSize(starts, length) {
    const sorted = [...starts].sort((a, b) => a - b);
    let total = 0, end = 0;
    for (const start of sorted) {
      const right = Math.min(length, start + 8);
      total += Math.max(0, right - Math.max(end, start - 1));
      end = Math.max(end, right);
    }
    return total;
  }
  function summarize(result, selectedFloor) {
    if (!result || result.schema !== "mimicryone/result/1" || result.complete_in_memory !== true || result.presentation_only)
      throw new Error((/*@copy result-extent.a-complete-native-result-is.d48e716*/`A complete native result is required; a presentation subset cannot supply these figures.`/*@endcopy*/));
    const length = Number(result.protein.length);
    if (!Number.isInteger(length) || length < 9) throw new Error((/*@copy result-extent.target-window-coverage-is-unavailable.104fa75*/`Target window coverage is unavailable for this record.`/*@endcopy*/));
    const available = result.available_floors || [];
    // The selected view can change parameters.floor without changing loaded data.
    if (!Array.isArray(available) || !available.length || available.some(h => !Number.isInteger(h) || h < 5 || h > 9))
      throw new Error((/*@copy result-extent.invalid-complete-threshold-declaration.4f53e16*/`Invalid complete-threshold declaration.`/*@endcopy*/));
    const loadedFloor = Math.min(...available);
    if (!available.includes(selectedFloor)) throw new Error((/*@copy result-extent.the-selected-threshold-is-not.a65b781*/`The selected threshold is not complete in this result.`/*@endcopy*/));
    const catalog = new Map();
    for (const row of result.source_catalog) {
      if (catalog.has(Number(row.protein_idx))) throw new Error((/*@copy result-extent.duplicate-source-catalog-identity.80ad5a1*/`Duplicate source catalog identity.`/*@endcopy*/));
      catalog.set(Number(row.protein_idx), row);
    }
    const records = new Map();
    let duplicateRows = 0;
    for (const row of result.positional_matches) {
      const key = Number(row.protein_idx), source = catalog.get(key);
      if (!source || !Number.isInteger(Number(source.length)) || Number(source.length) < 9)
        throw new Error((/*@copy result-extent.missing-parent-identity-or-denominator.e629308*/`Missing parent identity or denominator.`/*@endcopy*/));
      if (!Array.isArray(row.hits)) throw new Error((/*@copy result-extent.complete-positional-columns-are-required.4583aed*/`Complete positional columns are required.`/*@endcopy*/));
      const columns=row.hits_columns||["target_start","source_start","identity","source_9mer"];
      const qi = columns.indexOf("target_start"), pi = columns.indexOf("source_start"), hi = columns.indexOf("identity");
      if (Math.min(qi, pi, hi) < 0) throw new Error((/*@copy result-extent.unrecognized-positional-column-schema.02c84aa*/`Unrecognized positional column schema.`/*@endcopy*/));
      if (!records.has(key)) records.set(key, {source, events: new Map()});
      const events = records.get(key).events;
      for (const hit of row.hits) {
        const q = Number(hit[qi]), p = Number(hit[pi]), h = Number(hit[hi]);
        if (![q,p,h].every(Number.isInteger) || q < 1 || q > length - 8 || p < 1 || p > Number(source.length) - 8 || h < loadedFloor || h > 9)
          throw new Error((/*@copy result-extent.invalid-positional-event-no-summary.0d3c4a2*/`Invalid positional event; no summary was published.`/*@endcopy*/));
        const id = q + ":" + p;
        if (events.has(id)) {
          if (events.get(id)[2] !== h) throw new Error((/*@copy result-extent.conflicting-duplicate-event.fde8766*/`Conflicting duplicate event.`/*@endcopy*/));
          duplicateRows++;
        } else events.set(id, [q,p,h]);
      }
    }
    const floors = [], parents = [];
    for (let h = 5; h <= 9; h++) {
      if (!available.includes(h)) { floors.push({floor:h, state:"not_computed"}); continue; }
      // Reuse the exact coverage implementation used by public CSV exports.
      const coverage=coverageCore.summarize(result,h),perParent=new Map(coverage.parents.map(p=>[p.proteinIndex,p]));
      const starts = new Set();
      let pairs = 0, bearing = 0;
      for (const [key, record] of records) {
        const qs = new Set(), ps = new Set();
        let n = 0;
        for (const [q,p,identity] of record.events.values()) if (identity >= h) { qs.add(q); ps.add(p); starts.add(q); n++; }
        if (!n) continue;
        pairs += n; bearing++;
        if (h === selectedFloor) {
          const source = record.source, parentLength = Number(source.length);
          const pointIdentity=coveragePointIdentity(source,result.inputs?.analysis_scan?.release_fingerprint||result.provenance?.release_fingerprint);
          parents.push({export_identity:exportCore.recordIdentity(source,"Mimicry Parent"),parent_index:key, parent_id:source.record_identity && source.record_identity.portable_id || source.portable_id || source.protein_id || String(key),
            record_identity:source.record_identity || null,
            parent_unit:source.record_identity && source.record_identity.unit || result.parameters.source_entity_level || "parent_record",
            label:source.gene || source.display_id || source.name || String(key),
            plot_label:pointIdentity.label, public_id:pointIdentity.accession||pointIdentity.label, identity_tooltip:pointIdentity.tooltip,
            header:source.raw_header || source.header || source.seqid || "", parent_length:parentLength,
            pairs:n, target_windows:qs.size, parent_windows:ps.size,
            target_window_positions:length-8, parent_window_positions:parentLength-8,
            target_window_percent:100*qs.size/(length-8), parent_window_percent:100*ps.size/(parentLength-8),
            target_covered_residues:perParent.get(key).target.coveredResidues,target_eligible_residues:perParent.get(key).target.eligibleResidues,
            target_residue_percent:perParent.get(key).target.percent,
            parent_covered_residues:perParent.get(key).parent.coveredResidues,parent_eligible_residues:perParent.get(key).parent.eligibleResidues,
            parent_residue_percent:perParent.get(key).parent.percent});
        }
      }
      const residues = coverage.target.coveredResidues;
      floors.push({floor:h,state:"complete",pairs,matched_parents:bearing,target_windows:starts.size,
        target_window_positions:length-8,target_window_percent:100*starts.size/(length-8),
        covered_residues:residues,target_length:length,residue_percent:100*residues/length});
    }
    parents.sort((a,b)=>String(a.parent_id).localeCompare(String(b.parent_id)));
    return {schema:"mimicryone/extent-summary/1",result_id:result.result_id,
      target_export_identity:exportCore.recordIdentity(result.protein,"Antigen Target"),target_id:result.protein.protein_id,target_label:result.protein.gene || result.protein.protein_id,
      target_record_identity:result.protein.record_identity || null,
      target_header:result.protein.raw_header || result.protein.header || result.protein.seqid || "",
      parent_scope:identityLabels.libraryLabel(result.parameters.source_scope_label || result.parameters.source_scope),
      parent_entity:result.parameters.source_entity_label || "parent records",floor:selectedFloor,
      denominator_policy:"Residue coverage: union of qualifying 9-mer cores / residues participating in evaluated sliding windows. Mismatch positions included; context excluded. Window coverage remains a separate measure. No inferred filtered-library denominator.",
      duplicate_rows_removed:duplicateRows,floors,parents,parameters:result.parameters,
      provenance:result.provenance || null,inputs:result.inputs || null};
  }
  function isCanonicalShowcase(result) {
    const q = result && result.protein, p = result && result.parameters;
    const representation = p && p.source_record_representation;
    if (representation) {
      const fp = result.inputs && result.inputs.analysis_scan && result.inputs.analysis_scan.release_fingerprint;
      const validIdentity = record => {
        const id = record && record.record_identity;
        return !!(id && id.schema === "mimicryone/record-identity/1" &&
          id.analysis_release_fingerprint === fp && id.verification_method === "source_row+exact_sequence_sha256" &&
          id.library === record.library_id && id.antigen_id === record.antigen_id &&
          /^(?:M1E|P9P)[0-9]{9}$/.test(id.portable_id) &&
          (!record.portable_id || record.portable_id === id.portable_id) &&
          ["biological_parent", "exact_sequence_group"].includes(id.unit));
      };
      // Current canonical collections use a release-verified native record
      // crosswalk, not the older tile-projection namespace. Sequence groups
      // remain explicitly secondary units, never biological-parent counts.
      return !!(typeof fp === "string" && /^[a-f0-9]{64}$/.test(fp) &&
        representation.schema === "mimicryone/library-representation/1" &&
        representation.analysis_release_fingerprint === fp && representation.library === p.source_scope &&
        validIdentity(q) && Array.isArray(result.source_catalog) &&
        ["biological_parent", "exact_sequence_group"].includes(representation.unit) &&
        result.source_catalog.every(source => validIdentity(source) && source.record_identity.library === representation.library && source.record_identity.unit === representation.unit));
    }
    // Use explicit entity metadata, never an assay's label or accession alone.
    return !!(q && q.parent_key && q.parent_key === q.portable_id && q.parent_key === q.protein_id &&
      p && p.source_entity_level === "canonical_parent" && Array.isArray(result.source_catalog) &&
      result.source_catalog.every(source => source.parent_key && source.parent_key === source.portable_id));
  }
  function isFigureResult(result) {
    // The counting method is shared by canonical, assay-library and custom results.
    // Representation labels remain those supplied by the native result contract.
    return !!(result && result.schema === "mimicryone/result/1" &&
      result.complete_in_memory === true && !result.presentation_only);
  }
  // Presentation only: prioritize high coverage on both axes, then either axis.
  // This is not an unusualness score and does not change point or table ordering.
  function coverageLabelCandidates(parents) {
    const valid=parents.filter(p=>Number.isFinite(p.target_residue_percent)&&Number.isFinite(p.parent_residue_percent));
    const joint=p=>Math.min(p.target_residue_percent,p.parent_residue_percent);
    const tie=(a,b)=>String(a.parent_id).localeCompare(String(b.parent_id));
    const both=[...valid].sort((a,b)=>joint(b)-joint(a)||b.target_residue_percent-a.target_residue_percent||tie(a,b));
    const x=[...valid].sort((a,b)=>b.target_residue_percent-a.target_residue_percent||joint(b)-joint(a)||tie(a,b));
    const y=[...valid].sort((a,b)=>b.parent_residue_percent-a.parent_residue_percent||joint(b)-joint(a)||tie(a,b));
    return [...new Set([...both.slice(0,3),...x.slice(0,1),...y.slice(0,1),...both])].slice(0,12);
  }
  function coverageLabelBox(x,y,width,occupied,bounds) {
    const height=12;
    for(const dy of [-16,6,-30,20,-44,34]) for(const side of [1,-1]) {
      const left=Math.max(bounds.left+2,Math.min(bounds.right-width-2,side>0?x+6:x-width-6));
      const top=y+dy;
      const box={left,top,right:left+width,bottom:top+height};
      if(top<bounds.top+2||box.bottom>bounds.bottom-2)continue;
      if(occupied.some(b=>box.left<b.right+3&&box.right>b.left-3&&box.top<b.bottom+2&&box.bottom>b.top-2))continue;
      return box;
    }
    return null;
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = {summarize,unionSize,isCanonicalShowcase,isFigureResult,coverageLabelCandidates,coverageLabelBox,coveragePointIdentity}; return; }
  const host = document.getElementById("resultExtent");
  if (!host) return;
  let visible = false, cachedKey = "", legendKey = "", current = null, summary = null, scheduled = false;
  const charts = document.getElementById("extentCharts"), note = document.getElementById("extentStatus");
  const statsHost = document.getElementById("extentStats");
  const ns = "http://www.w3.org/2000/svg";
  function node(tag, attrs, value) {
    const n = document.createElementNS(ns, tag);
    for (const [k,v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (value != null) n.textContent = value;
    return n;
  }
  /* The same type scale the proteome panels use, so these figures sit beside them
     without reading a size larger. */
  const type = {tick:8, label:9, title:10.5};
  function text(svg,x,y,value,attrs) { svg.append(node("text",Object.assign({x,y,fill:"var(--mm-ink)","font-size":type.label},attrs),value)); }
  /* ---- two panels, side by side ----
     The scatter is square by construction: both axes are the same quantity, a percentage of
     residues covered, so they get the same length and the same scale and the dashed diagonal is a
     true 45 degrees. The selected-result numbers sit in their own table panel beside it rather
     than inside the plot, so neither is cramped by the other. */
  const PAD = 12, AXIS = 48, PLOT = 255;
  const PX0 = PAD + AXIS, PX1 = PX0 + PLOT, PY0 = 38, PY1 = PY0 + PLOT;
  const FIG_W = PX1 + PAD, FIG_H = PY1 + 34;
  const HEAD_TEXT = 15, HEAD_LINE = 25;

  function figure(width, height, title) {
    const svg = node("svg", {viewBox:"0 0 "+width+" "+height, class:"af-svg", role:"img",
      "aria-label":title, preserveAspectRatio:"xMidYMid meet", style:"max-width:"+width+"px"});
    svg.append(node("title",{},title));
    return svg;
  }

  /* The same two-part heading the proteome panels carry: what it is, and in what unit. */
  /* ~0.53em per character at this weight; the heading is trimmed rather than allowed to run
     under the figure's own edge. */
  function fit(value, width) {
    const budget = Math.max(4, Math.floor(width / (type.label * 0.53)));
    return value.length <= budget ? value : value.slice(0, budget - 1).trim() + "…";
  }
  function heading(svg, width, left) {
    const node_ = text(svg, PAD, HEAD_TEXT, fit(left, width - PAD * 2), {"font-weight":600});
    svg.append(node("line",{x1:PAD, x2:width - PAD, y1:HEAD_LINE, y2:HEAD_LINE,
      stroke:"var(--mm-ink)","stroke-width":1}));
    return node_;
  }

  function statRows(s, selected) {
    return [
      {measure:(/*@copy result-extent.target-residues-covered*/`Target coverage`/*@endcopy*/), value:selected.residue_percent.toFixed(1) + "%",
       of:"("+selected.covered_residues.toLocaleString()+"/"+selected.target_length.toLocaleString()+")"},
      {measure:"Matched parents", value:s.parents.length.toLocaleString(), of:s.parent_entity},
    ];
  }

  /* The unboxed summary keeps coverage and the matching-parent count beside the figure. */
  function statPanel(s, selected) {
    const box = document.createElement("div");
    box.className = "extent-stats";
    const list = document.createElement("dl");
    for (const row of statRows(s, selected)) {
      const item = document.createElement("div");
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      const of = document.createElement("small");
      dt.textContent = row.measure; dd.textContent = row.value; of.textContent = row.of;
      dd.append(document.createTextNode(" "),of); item.append(dt, dd); list.append(item);
    }
    box.append(list);
    return box;
  }

  function directionPlot(s) {
    const svg = figure(FIG_W, FIG_H, "Residue coverage of " + s.target_label
      + " and of each matching Mimicry Parent, at ≥" + s.floor + "/9");
    const sx = v => PX0 + (v / 100) * PLOT;
    const sy = v => PY1 - (v / 100) * PLOT;
    heading(svg, FIG_W, (/*@copy result-extent.against.bbf1e44*/`${s.target_label} vs ${s.parent_scope} · Matching Parents`/*@endcopy*/));

    for (let tick = 0; tick <= 100; tick += 25) {
      svg.append(node("line",{x1:sx(tick), x2:sx(tick), y1:PY0, y2:PY1,
        stroke:"var(--mm-border)","stroke-opacity":0.35}));
      svg.append(node("line",{x1:PX0, x2:PX1, y1:sy(tick), y2:sy(tick),
        stroke:"var(--mm-border)","stroke-opacity":0.35}));
      text(svg, sx(tick), PY1 + 12, tick + "%",
        {"text-anchor":"middle","font-size":type.tick, fill:"var(--mm-body)"});
      text(svg, PX0 - 5, sy(tick) + 3, tick + "%",
        {"text-anchor":"end","font-size":type.tick, fill:"var(--mm-body)"});
    }
    /* Equal coverage, unlabeled: at equal axis scales a corner-to-corner dashed line reads as
       itself, and a label on it would only crowd the plot. The caption says what it is. */
    svg.append(node("line",{x1:PX0, y1:PY1, x2:PX1, y2:PY0,
      stroke:"var(--mm-muted)","stroke-dasharray":"4 4"}));

    text(svg, (PX0 + PX1) / 2, PY1 + 27, (/*@copy result-extent.target-coverage-axis*/`Antigen Target Coverage (%)`/*@endcopy*/),
      {"text-anchor":"middle","font-weight":600,"font-size":type.tick});
    const across = node("text",{x:PAD + 6, y:(PY0 + PY1) / 2, fill:"var(--mm-ink)",
      "font-size":type.tick, "font-weight":600, "text-anchor":"middle",
      transform:"rotate(-90 " + (PAD + 6) + " " + ((PY0 + PY1) / 2) + ")"});
    across.textContent = (/*@copy result-extent.mimicry-parent-residues-covered.cb5aa06*/`Mimicry Parent Coverage (%)`/*@endcopy*/);
    svg.append(across);

    for (const p of s.parents) {
      svg.append(node("circle",{cx:sx(p.target_residue_percent), cy:sy(p.parent_residue_percent),
        r:2.8, fill:"var(--hl-sel)", "fill-opacity":0.6, tabindex:0,
        "data-tooltip":(p.identity_tooltip || identityLabels.publicText(p.label))
          + "\nAntigen Target: " + p.target_covered_residues + " / " + p.target_eligible_residues
          + " residues (" + p.target_residue_percent.toFixed(2) + "%)"
          + "\nMimicry Parent: " + p.parent_covered_residues + " / " + p.parent_eligible_residues
          + " residues (" + p.parent_residue_percent.toFixed(2) + "%)"
          + (/*@copy result-extent.window-pair-count*/`
${p.pairs} Window Pair${p.pairs === 1 ? "" : "s"}`/*@endcopy*/)}));
    }
    const labelBoxes=[];
    for(const p of coverageLabelCandidates(s.parents)) {
      if(labelBoxes.length>=6)break;
      const full=String(p.plot_label??p.label??'');
      if(!full)continue;
      const label=full.length>21?full.slice(0,20)+'…':full;
      const x=sx(p.target_residue_percent),y=sy(p.parent_residue_percent);
      const box=coverageLabelBox(x,y,label.length*5.8+4,labelBoxes,{left:PX0,right:PX1,top:PY0,bottom:PY1});
      if(!box)continue;
      labelBoxes.push(box);
      const g=node('g',{'class':'coverage-point-label','pointer-events':'none'});
      g.append(node('title',{},p.identity_tooltip||full));
      g.append(node('line',{x1:x,y1:y,x2:Math.max(box.left,Math.min(box.right,x)),y2:box.top+6,stroke:'var(--mm-ink)','stroke-width':0.6,'stroke-opacity':0.65}));
      g.append(node('text',{x:box.left+2,y:box.top+9,fill:'var(--mm-ink)','font-size':9,'font-weight':600},label));
      svg.append(g);
    }
    if (!s.parents.length) {
      text(svg, (PX0 + PX1) / 2, (PY0 + PY1) / 2, "No matching parent at this threshold",
        {"text-anchor":"middle", fill:"var(--mm-muted)"});
    }
    return svg;
  }

  /* Export one row per plotted parent with the shared target/parent identity blocks,
     coverage values, threshold and scope. Complete event tables remain separate exports. */
  function plottedCsv(s) {
    const columns = [...exportCore.recordIdentityColumns("Antigen Target"),...exportCore.recordIdentityColumns("Mimicry Parent"),
      "Mimicry Parent Record Unit", "Antigen Target Residues Covered (%)", "Mimicry Parent Residues Covered (%)",
      "Antigen Target Covered Residues", "Antigen Target Eligible Residues", "Mimicry Parent Covered Residues",
      "Mimicry Parent Eligible Residues", "Window Pairs", "Minimum Core Identity", "Mimicry Parent Scope"];
    const units={parent_record:"Record",biological_parent:"Biological Parent",exact_sequence_group:"Exact-Sequence Group"};
    const rows=s.parents.map(p=>({...s.target_export_identity,...p.export_identity,
      "Mimicry Parent Record Unit":units[p.parent_unit]||p.parent_unit||"",
      "Antigen Target Residues Covered (%)":p.target_residue_percent,"Mimicry Parent Residues Covered (%)":p.parent_residue_percent,
      "Antigen Target Covered Residues":p.target_covered_residues,"Antigen Target Eligible Residues":p.target_eligible_residues,
      "Mimicry Parent Covered Residues":p.parent_covered_residues,"Mimicry Parent Eligible Residues":p.parent_eligible_residues,
      "Window Pairs":p.pairs,"Minimum Core Identity":s.floor+"|9","Mimicry Parent Scope":s.parent_scope}));
    return exportCore.csv(columns,rows);
  }

  function coverageCaption() {
    return (/*@copy result-extent.coverage-method*/`Coverage counts every position in a qualifying nine-residue core, including mismatches. Overlaps count once; context flanks are excluded.`/*@endcopy*/);
  }

  function sequenceMapHeading(view) {
    return (/*@copy result-extent.view-label*/`Sequence map (${view.exported?'Compact and Full exports':({player:'Preview',explorer:'Compact',residues:'Full'}[view.view]||view.view)}${!view.exported&&view.view==='player'?' – '+(view.mode==='site'?'Window':'Overall'):''})`/*@endcopy*/);
  }

  function sequenceMapCaption(s, selected, view) {
    if (!view) return "";
    const length=selected.target_length;
    const coverageNote=coverageCaption();
    const trackMethods={
      variants: (/*@copy result-extent.variants-method*/`Variant markers show UniProt HumSAVAR missense classifications: (likely) pathogenic, uncertain significance, or (likely) benign.`/*@endcopy*/),
      modifications: (/*@copy result-extent.modifications-method*/`Modification symbols show annotated modification sites.`/*@endcopy*/),
      surface: (/*@copy result-extent.surface-method*/`The surface track marks exposed residues (rSASA ≥0.25) in the ${view.assembly_context} model.`/*@endcopy*/),
      rsasa: (/*@copy result-extent.rsasa-method*/`rSASA shows relative solvent-accessible surface area calculated with FreeSASA in the ${view.assembly_context} model (color scale 0–1; higher values share the maximum color).`/*@endcopy*/),
      plddt: (/*@copy result-extent.plddt-method*/`pLDDT shows AlphaFold’s per-residue structural confidence (0–100).`/*@endcopy*/),
      cleavage_epitope: (/*@copy result-extent.cleavage-method*/`The cleavage track shows pepsickle epitope-model proteasomal cleavage probabilities (0–1).`/*@endcopy*/),
      topology: (/*@copy result-extent.topology-method*/`Topology marks UniProt-annotated extracellular, transmembrane, and intracellular regions.`/*@endcopy*/),
    };
    const annotations=(view.active_tracks||[]).map(key=>trackMethods[key]).filter(Boolean);
    const lanes=view.exported||view.view!=='residues'?(/*@copy result-extent.parent-lanes-method*/`Parent tracks show matching positions, with opacity indicating core identity from 5/9 to 9/9. ${(view.mode==='site'?'The tracks refer to the selected target window.':'Blocks show sites revealed by the scanner; the coverage summary uses the complete result.')+(!view.exported&&view.view==='player'&&view.mode!=='site'?' Preview shows up to eight parents from up to 50 candidates, in fixed alphabetical order.':'')}`/*@endcopy*/):'';
    return (/*@copy result-extent.sequence-map-method*/`Shows where qualifying molecular mimicry matches occur along ${s.target_label} (${length.toLocaleString()} residues). Color shows the number of window pairs at each target start; each residue takes the highest value among overlapping cores (0–${Number(view.density_max||0).toLocaleString()}, ${view.density_inverted?'inverted density color scale':'displayed density color scale'}). Highlights mark the selected core and its surrounding context. Target coverage is the percentage of the full target sequence covered across the selected parent library. ${coverageNote} ${lanes?lanes+' ':''}${annotations.join(' ')}`/*@endcopy*/);
  }

  function scatterCaption(s) {
    const groups=s.parents.some(p=>p.parent_unit === "exact_sequence_group");
    return (/*@copy result-extent.caption-scientific-legend*/`Each point pairs ${s.target_label} with ${groups?'one distinct parent sequence':'one parent record'} in ${s.parent_scope} at ≥${s.floor}/9 core identity; all ${s.parents.length.toLocaleString()} matching ${groups?'sequences':'records'} are shown. The axes show covered residues as a percentage of full sequence length: ${s.target_label} on the X-axis and its paired parent on the Y-axis.`/*@endcopy*/);
  }

  // Share caption sections between plain-text exports and safe, formatted DOM text.
  function captionParts(s, selected, view) {
    const parts=[];
    if(view)parts.push({kind:'sequence',label:sequenceMapHeading(view),text:sequenceMapCaption(s,selected,view)});
    parts.push({kind:'scatter',label:(/*@copy result-extent.scatter-heading*/`Parent versus target mimicry scatter`/*@endcopy*/),text:scatterCaption(s)+(view?'':' '+coverageCaption())});
    return parts;
  }
  function captionText(parts) {
    return parts.map(part=>(part.label?part.label+": ":"")+part.text).join("\n\n");
  }
  function caption(s, selected, view) {
    return captionText(captionParts(s,selected,view));
  }
  function renderCaption(element, parts) {
    const content=document.createDocumentFragment();
    parts.forEach((part,index)=>{
      const section=document.createElement('span');section.className='extent-caption-part';section.dataset.captionKind=part.kind;
      if(index)section.append(document.createElement("br"),document.createElement("br"));
      if(part.label){
        const label=document.createElement("strong");
        label.textContent=part.label+": ";
        section.append(label);
      }
      section.append(document.createTextNode(part.text));content.append(section);
    });
    element.replaceChildren(content);
  }

  function panel(svg, legend) {
    const box=document.createElement("div");box.className="extent-scroll";
    svg.setAttribute("aria-describedby","extentLegend");
    svg.append(node("desc",{},legend));box.append(svg);return box;
  }
  function captured(result, floor, scope, viewState) {
    const s=summarize(result,floor);if(scope)s.parent_scope=scope;
    const selected=s.floors.find(row=>row.floor===s.floor),legend=caption(s,selected,viewState?{...viewState,exported:true}:null);
    const svg=directionPlot(s);svg.setAttribute('xmlns',ns);svg.setAttribute('width',FIG_W);svg.setAttribute('height',FIG_H);
    svg.setAttribute('font-family','Inter, Arial, sans-serif');svg.removeAttribute('style');svg.removeAttribute('class');
    svg.append(node('desc',{},legend));
    window.MimicryPlotPalette.freezeSVG(svg,{print:true});
    return {svg:new XMLSerializer().serializeToString(svg),csv:plottedCsv(s),legend};
  }
  function update() {
    scheduled=false;
    const api=window.MimicryOne,state=api&&api.getState(),stage=document.querySelector(".stage");
    const pending=stage&&stage.dataset.playerState==="loading";
    if(pending){cachedKey="";legendKey="";host.setAttribute("aria-busy","true");host.dataset.updateMessage=(/*@copy result-extent.updating-target-summary.630bbf4*/`Updating target summary…`/*@endcopy*/);return;}
    host.removeAttribute("aria-busy");
    delete host.dataset.updateMessage;
    if(!state||!state.result_id){
      // A legacy/display-only target cannot inherit the previous analysis summary.
      host.hidden=true;current=null;summary=null;cachedKey="";legendKey="";
      delete host.dataset.resultId;
      return;
    }
    if(!visible){host.hidden=false;return;}
    const key=state.result_id+":"+state.similarity_floor;
    const view=api.getFigureState?.();
    // Playback position belongs to the sequence readout, not this explanatory legend.
    const legendView=view?{view:view.view,mode:view.mode,active_tracks:view.active_tracks,
      density_max:view.density_max,density_inverted:view.density_inverted,assembly_context:view.assembly_context}:{};
    const nextLegendKey=key+":"+JSON.stringify(legendView);
    if(key===cachedKey&&summary&&nextLegendKey===legendKey)return;
    try {
      if(key!==cachedKey||!summary){
        const snapshot=api.getResult();
        host.hidden=!isFigureResult(snapshot);
        if(host.hidden){current=null;summary=null;cachedKey="";legendKey="";charts.replaceChildren();statsHost.replaceChildren();document.getElementById('extentLegend').replaceChildren();delete host.dataset.resultId;return;}
        const s=summarize(snapshot,Number(state.similarity_floor));
        s.parent_scope=window.MimicryOneAnalysisRouting?.exportScopeLabel(snapshot)||s.parent_scope;
        const selected=s.floors.find(row=>row.floor===s.floor);
        statsHost.replaceChildren(statPanel(s,selected));
        charts.replaceChildren();charts.append(panel(directionPlot(s),''));
        current=snapshot;summary=s;cachedKey=key;host.dataset.resultId=s.result_id;
      }
      const selected=summary.floors.find(row=>row.floor===summary.floor);
      const parts=captionParts(summary,selected,view),legend=captionText(parts);
      renderCaption(document.getElementById('extentLegend'),parts);
      charts.querySelector('desc').textContent=legend;
      legendKey=nextLegendKey;
      note.textContent=(/*@copy result-extent.matched-complete-current-target-result.f6ce301*/`${summary.target_label} → ${summary.parent_scope} · ≥${summary.floor}/9`/*@endcopy*/);
    }catch(error){delete host.dataset.resultId;note.textContent=error.message;}
  }

  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(update);}}
  // Re-render saved descriptive summaries with the same live figure implementation.
  root.MimicryExtentFigures={coverage:directionPlot,legend:caption,pointIdentity:coveragePointIdentity,capture:captured};
  new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);if(visible)schedule();},{rootMargin:"0px"}).observe(host);
  for(const selector of ["#ftitle","#thbtns","#rankmode","#viewmode","#trackmode","#dimerctx","#invertMain","#windowSort",".legend"]){const n=document.querySelector(selector);if(n)new MutationObserver(schedule).observe(n,{subtree:true,childList:true,attributes:true,characterData:true});}
  const stage=document.querySelector(".stage");if(stage)new MutationObserver(schedule).observe(stage,{attributes:true,attributeFilter:["data-player-state"]});
  window.addEventListener("mimicryone:theme",schedule);
})(typeof window!=="undefined"?window:globalThis);
