/* MimicryMap artifact and Custom FASTA runtime.
   Loaded after the page renderer to connect results and custom inputs to the player. */

(function mimicryOneRuntime() {
  "use strict";

  const RUNTIME_VERSION = "mimicryone-runtime/3";
  const RESULT_SCHEMA = "mimicryone/result/1";
  let PAGE_SIZE = window.MimicryMapViewer?.options.pageSize || 10;
  const HUMAN_LIBRARIES = new Set(["human_swissprot", "human_hormone"]);
  const artifactCache = new Map();
  const artifactPartsCache = new Map();
  const presentationCache = new Map();
  const sequencePackCache = new Map();
  const customResults = [];
  let viewIntentRevision = 0;
  let customRunSession = null;
  const state = {
    result: null,
    rankPage: 0,
    customTargets: null,
    activeRun: null,
    sciencePairId: null,
  };

  function html(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function identityCellHtml(identity) {
    return '<span class="identity-primary">' + html(identity.displayLine || identity.primaryLine) + "</span>" +
      '<span class="identity-secondary">' + (html(identity.secondary) || "&nbsp;") + "</span>";
  }

  function csv(value) {
    const text = window.MimicryOneIdentity.publicText(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  const IDENTITY_EXPORT_FIELDS = [
    "identity_primary", "identity_secondary", "protein_name", "accession", "organism",
    "strain", "assay_platform_id", "coordinates", "variant_hgvs",
    "variant_significance", "collection", "identity_provenance",
  ];

  function identityExportHeaders(prefix) {
    return IDENTITY_EXPORT_FIELDS.map(function prefixed(name) { return prefix + name; });
  }

  function identityExportValues(identity) {
    return [
      identity.primaryLine, identity.secondary, identity.proteinName, identity.accession,
      identity.organism, identity.strain, identity.assayId, identity.coordinates,
      identity.variant, identity.significance, identity.collection, identity.provenance,
    ];
  }

  function download(name, value, type) {
    const blob = value instanceof Blob ? value : new Blob([value], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = String(name).replace(/virscan_exposome_current/g, "virscan_exposome").replace(/human_current/g, "huscan").replace(/_+/g, "_");
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function release() {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 0);
  }

  function fileStem(value) {
    return String(value || "protein").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "protein";
  }

  function stableSourceKey(source) {
    return `${source.library_id || source.library || "unknown"}\u0000${source.protein_id}`;
  }

  function identityFor(record, options) {
    const resolver = window.MimicryOneIdentity;
    if (!resolver || typeof resolver.resolve !== "function") {
      throw new Error((/*@copy mimicryone-runtime.mimicryone-shared-protein-identity-resolver.523496f*/`MimicryMap shared protein identity resolver is unavailable.`/*@endcopy*/));
    }
    return resolver.resolve(record || {}, options || {});
  }

  function currentRuntimeView() {
    return isFull() ? "residues" : (EXPANDED ? "explorer" : "player");
  }

  function completionView(requestRevision, requestedView) {
    return requestRevision === viewIntentRevision ? requestedView : currentRuntimeView();
  }

  function replaceInteractive(id) {
    const current = document.getElementById(id);
    if (!current) return null;
    const replacement = current.cloneNode(true);
    current.replaceWith(replacement);
    return replacement;
  }

  function mergeStarts(starts, length) {
    const unique = Array.from(new Set(starts)).sort(function ascending(a, b) { return a - b; });
    const intervals = [];
    unique.forEach(function add(start) {
      const end = Math.min(length, start + K - 1);
      const last = intervals[intervals.length - 1];
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
      else intervals.push([start, end]);
    });
    return intervals;
  }

  function addIntervals(diff, intervals) {
    intervals.forEach(function add(interval) {
      const start = Math.max(0, interval[0] - 1);
      const endExclusive = Math.min(diff.length - 1, interval[1]);
      if (start >= endExclusive) return;
      diff[start] += 1;
      diff[endExclusive] -= 1;
    });
  }

  function finishDiff(diff) {
    let running = 0;
    return diff.slice(0, -1).map(function accumulate(delta) {
      running += delta;
      return running;
    });
  }

  function computeCoverage(length, nestedMatches, catalogByIndex) {
    const measures = { pairs: {}, source_proteins: {}, source_libraries: {} };
    for (let floor = 5; floor <= 9; floor += 1) {
      const pairDiff = new Array(length + 1).fill(0);
      const proteinDiff = new Array(length + 1).fill(0);
      const libraryDiff = new Array(length + 1).fill(0);
      const libraryStarts = new Map();

      nestedMatches.forEach(function sourceCoverage(source) {
        const starts = [];
        source.hits.forEach(function pairCoverage(hit) {
          if (hit[2] < floor) return;
          const interval = [[hit[0], Math.min(length, hit[0] + K - 1)]];
          addIntervals(pairDiff, interval);
          starts.push(hit[0]);
        });
        if (!starts.length) return;
        addIntervals(proteinDiff, mergeStarts(starts, length));
        const metadata = catalogByIndex.get(source.protein_idx) || {};
        const library = metadata.library_id || "unknown";
        if (!libraryStarts.has(library)) libraryStarts.set(library, []);
        libraryStarts.get(library).push.apply(libraryStarts.get(library), starts);
      });

      libraryStarts.forEach(function libraryCoverage(starts) {
        addIntervals(libraryDiff, mergeStarts(starts, length));
      });
      measures.pairs[`m${floor}`] = finishDiff(pairDiff);
      measures.source_proteins[`m${floor}`] = finishDiff(proteinDiff);
      measures.source_libraries[`m${floor}`] = finishDiff(libraryDiff);
    }
    return measures;
  }

  function floorStatsFromHits(hits, targetLength, sourceLength, floor) {
    const selected = hits.filter(function atFloor(hit) { return hit[2] >= floor; });
    const targetStarts = selected.map(function targetStart(hit) { return hit[0]; });
    const sourceStarts = selected.map(function sourceStart(hit) { return hit[1]; });
    return {
      target_windows: new Set(targetStarts).size,
      source_windows: new Set(sourceStarts).size,
      pairs: selected.length,
      target_loci: window.MimicryResidueCoverage.overlapGroups(targetStarts),
      source_loci: window.MimicryResidueCoverage.overlapGroups(sourceStarts),
    };
  }

  function parseCompactRows(head, indexByNumeric, sourceFilter) {
    const columns = head.mimics_columns;
    const positions = {};
    columns.forEach(function position(name, index) { positions[name] = index; });
    return head.mimics.reduce(function collect(output, row) {
      const source = indexByNumeric.get(row[0]);
      if (!source || !sourceFilter(source)) return output;
      const floors = {};
      for (let floor = 5; floor <= 9; floor += 1) {
        floors[`m${floor}`] = {
          target_windows: row[positions[`m${floor}_target_windows`]],
          source_windows: row[positions[`m${floor}_source_windows`]],
          pairs: row[positions[`m${floor}_pairs`]],
          target_loci: row[positions[`m${floor}_target_loci`]],
          source_loci: row[positions[`m${floor}_source_loci`]],
        };
      }
      output.push({
        protein_index: row[0],
        protein_id: source.protein_id,
        gene: source.gene,
        name: source.name,
        library_id: source.library_id,
        organism: source.organism,
        length: source.length,
        best_identity: row[1],
        floors,
      });
      return output;
    }, []);
  }

  function sourceScopeForProtein(protein) {
    if (protein && !HUMAN_LIBRARIES.has(protein.library_id || protein.library)) return "human";
    if (MIMIC_MODE === "human") return "human";
    if (MIMIC_MODE === "one") {
      const select = document.getElementById("libsel");
      return select && select.value ? select.value : "nonhuman";
    }
    if (MIMIC_MODE === "custom") return "custom";
    return "nonhuman";
  }

  function filterForScope(scope) {
    return function sourceInScope(source) {
      if (scope === "human") return HUMAN_LIBRARIES.has(source.library_id);
      if (scope === "nonhuman") return !HUMAN_LIBRARIES.has(source.library_id);
      if (scope === "custom") return source.library_id === "__custom_target__";
      return source.library_id === scope;
    };
  }

  function scopeLabel(scope) {
    const active = T && T.result && T.result.parameters;
    const display = value => {
      const key=String(value||'').replace(/^library:/,'');
      return ({canonical_human:'Canonical Human',canonical_exposure:'Canonical Exposure'})[key] || window.MimicryOneIdentity?.libraryLabel?.(key) || value;
    };
    if (active && active.source_scope === scope && active.source_scope_label) return display(active.source_scope_label);
    if (scope === "human") return "Human Proteome";
    if (scope === "nonhuman") return "Non-human Indexed Sources";
    if (scope === "custom" || scope === "__custom_fasta__") return "Custom Mimicry Parent FASTA";
    const option = Array.from(document.querySelectorAll("#libsel option")).find(function match(item) {
      return item.value === scope;
    });
    return display(option ? option.textContent.replace(/\s*\([0-9,]+\)\s*$/, "") : scope);
  }

  async function fetchJson(path, options) {
    const response = await fetch(path, Object.assign({ cache: "no-store" }, options || {}));
    if (!response.ok) throw new Error((/*@copy mimicryone-runtime.http.9f505cb*/`HTTP ${response.status}`/*@endcopy*/));
    return response.json();
  }

  function rowsFromSequencePack(payload) {
    const positions = {};
    payload.columns.forEach(function locate(name, index) { positions[name] = index; });
    return payload.rows.map(function rowToObject(row) {
      const proteinId = row[positions.protein_id];
      const exactHeader = String(
        (positions.seqid != null && row[positions.seqid]) ||
        (positions.raw_header != null && row[positions.raw_header]) ||
        (positions.header != null && row[positions.header]) ||
        row[positions.name] || proteinId
      );
      const libraryId = row[positions.library_id] || "unknown";
      const identity = identityFor({
        protein_id: proteinId,
        raw_header: exactHeader,
        gene: row[positions.gene],
        protein_name: row[positions.protein_name],
        name: row[positions.name],
        source_accession: row[positions.source_accession],
        organism: row[positions.organism],
        library_id: libraryId,
      });
      return {
        protein_id: proteinId,
        display_id: identity.accession || identity.assayId || identity.primaryLine,
        display_accession: identity.accession || identity.assayId || identity.primaryLine,
        source_accession: identity.accession || undefined,
        gene: identity.gene || identity.primaryLine,
        protein_name: identity.proteinName,
        name: identity.proteinName || row[positions.name] || exactHeader,
        header: exactHeader,
        seqid: exactHeader,
        raw_header: exactHeader,
        library_id: libraryId,
        organism: identity.organism,
        assay_id: identity.assayId,
        coordinates: identity.coordinates,
        variant_hgvs: identity.variant,
        variant_significance: identity.significance,
        collection: identity.collection,
        identity_provenance: identity.provenance,
        identity: identity,
        length: Number(row[positions.length]) || String(row[positions.sequence] || "").length,
        sequence: String(row[positions.sequence] || ""),
      };
    });
  }

  async function loadSequencePack(scope) {
    const packScope = scope === "human" ? "human" : "nonhuman";
    if (sequencePackCache.has(packScope)) return sequencePackCache.get(packScope);
    const promise = fetchJson(`/data/sequences.${packScope}.json.gz`).then(function prepare(payload) {
      return {
        schema: payload.schema,
        generated_utc: payload.generated_utc,
        scope: payload.scope,
        window_count: payload.window_count,
        rows: rowsFromSequencePack(payload),
      };
    });
    sequencePackCache.set(packScope, promise);
    return promise;
  }

  function fullMatchesToUi(result, sequenceByKey) {
    const matches = [];
    result.positional_matches.forEach(function sourceMatches(source) {
      const metadata = result.source_catalog_by_index.get(source.protein_idx) || {};
      const sourceIdentity = metadata.identity || identityFor(metadata, {
        activeLibrary: result.parameters && result.parameters.source_scope,
      });
      const fullSequence = sequenceByKey.get(stableSourceKey(metadata)) || "";
      // Shared record labels plus a reference to the existing coordinate tuple.
      // Context strings are derived only when a renderer actually reads them.
      const shared = {
        parent_id: result.protein.protein_id,
        mimic_id: source.protein_id,
        mimic_gene: sourceIdentity.gene || sourceIdentity.primaryLine,
        mimic_name: sourceIdentity.proteinName || metadata.name || metadata.header || source.protein_id,
        mimic_protein_name: sourceIdentity.proteinName,
        mimic_source_accession: sourceIdentity.accession,
        mimic_assay_id: sourceIdentity.assayId,
        mimic_coordinates: sourceIdentity.coordinates,
        mimic_variant_hgvs: sourceIdentity.variant,
        mimic_variant_significance: sourceIdentity.significance,
        mimic_collection: sourceIdentity.collection,
        mimic_identity_provenance: sourceIdentity.provenance,
        mimic_identity: sourceIdentity,
        mimic_organism: sourceIdentity.organism,
        mimic_header: metadata.header || metadata.raw_header || metadata.name || source.protein_id,
        mimic_seqid: metadata.seqid || metadata.raw_header || source.protein_id,
        mimic_library: metadata.library_id || "unknown",
        chain_blosum62: 0,
        get parent_position() { return this._hit[0]; },
        get mimic_position() { return this._hit[1]; },
        get identity() { return this._hit[2] + "|9"; },
        get mimic_9mer() { return this._hit[3]; },
        get parent_9mer() { return result.protein.sequence.slice(this._hit[0] - 1, this._hit[0] - 1 + K); },
        get mimic_length() { return metadata.length || fullSequence.length || (this._hit[1] + K - 1); },
        get ext_parent() {
          const start = this._hit[0] - 1;
          return result.protein.sequence.slice(Math.max(0, start - FLANK), Math.min(result.protein.length, start + K + FLANK));
        },
        get ext_mimic() {
          const start = this._hit[1] - 1;
          return fullSequence ? fullSequence.slice(Math.max(0, start - FLANK), Math.min(fullSequence.length, start + K + FLANK)) : this._hit[3];
        },
        get core_offset() { return Math.min(this._hit[1] - 1, FLANK); },
      };
      source.hits.forEach(function addMatch(hit) {
        const match = Object.create(shared);
        match._hit = hit;
        matches.push(match);
      });
    });
    return matches;
  }

  function completeMotifEventData(result, matches) {
    const windowCount = Math.max(0, result.protein.length - K + 1);
    const byPosition = Array.from({ length: windowCount }, function emptyWindow() { return []; });
    matches.forEach(function indexEvent(match) {
      const targetStart = Number(match.parent_position);
      const targetIndex = targetStart - 1;
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= windowCount) return;
      byPosition[targetIndex].push(match);
    });
    const rankedByProtein = Object.create(null);
    result.ranked_matches.forEach(function indexRanked(row) {
      if (!Object.prototype.hasOwnProperty.call(rankedByProtein, row.protein_id)) {
        rankedByProtein[row.protein_id] = row;
      }
    });
    return {
      byPosition: byPosition,
      rankedByProtein: rankedByProtein,
      complete: result.presentation_only !== true,
    };
  }

  let targetTransition = null;
  let targetTransitionSequence = 0;

  function restoreAttribute(node, name, value) {
    if (!node) return;
    if (value == null) node.removeAttribute(name);
    else node.setAttribute(name, value);
  }

  function finishTargetTransition(token, committed, failureMessage) {
    if (!targetTransition || targetTransition.token !== token) return false;
    const transition = targetTransition;
    targetTransition = null;
    const stage = transition.stage;
    if (stage) {
      stage.removeAttribute("aria-busy");
      if (!committed && failureMessage) {
        stage.dataset.playerState = "error";
        stage.dataset.playerError = String(failureMessage);
        stage.setAttribute("aria-label", (/*@copy mimicryone-runtime.previous-result-remains-visible.403abac*/`Previous result remains visible. ${String(failureMessage)}`/*@endcopy*/));
      } else {
        delete stage.dataset.playerState;
        delete stage.dataset.playerError;
        restoreAttribute(stage, "aria-label", transition.stageAriaLabel);
      }
    }
    transition.controls.forEach(function unlock(node) {
      if (!Object.prototype.hasOwnProperty.call(node.dataset, "targetTransitionWasDisabled")) return;
      node.disabled = node.dataset.targetTransitionWasDisabled === "true";
      delete node.dataset.targetTransitionWasDisabled;
    });
    if (!committed && transition.title) {
      transition.title.replaceChildren.apply(
        transition.title,
        transition.titleNodes.map(function clone(node) { return node.cloneNode(true); })
      );
      restoreAttribute(transition.title, "data-tooltip", transition.titleTooltip);
      restoreAttribute(transition.title, "data-tooltip-mono", transition.titleTooltipMono);
      restoreAttribute(transition.title, "aria-label", transition.titleAriaLabel);
    }
    if (!committed && transition.subtitle) {
      transition.subtitle.replaceChildren.apply(
        transition.subtitle,
        transition.subtitleNodes.map(function clone(node) { return node.cloneNode(true); })
      );
      restoreAttribute(transition.subtitle, "data-tooltip", transition.subtitleTooltip);
      restoreAttribute(transition.subtitle, "data-tooltip-mono", transition.subtitleTooltipMono);
      restoreAttribute(transition.subtitle, "aria-label", transition.subtitleAriaLabel);
    }
    if (!committed && typeof setView === "function") setView(transition.view);
    if (typeof setPaused === "function") setPaused(transition.wasPaused);
    return true;
  }

  function writeTransitionTopline(node, identity, meta, tooltipText) {
    if (!node) return;
    let identityNode = node.querySelector(".figline-id");
    let metaNode = node.querySelector(".figline-meta");
    if (!identityNode || !metaNode) {
      const targetSide = node.id === "ftitle";
      identityNode = document.createElement("span");
      identityNode.className = "figline-id " + (targetSide ? "figttl-id" : "figsub-id");
      metaNode = document.createElement("span");
      metaNode.className = "figline-meta " + (targetSide ? "figttl-meta" : "figsub-meta");
      node.replaceChildren(identityNode, metaNode);
    }
    identityNode.textContent = identity;
    metaNode.textContent = meta;
    node.setAttribute("data-tooltip", tooltipText);
    node.removeAttribute("data-tooltip-mono");
    node.setAttribute("aria-label", tooltipText);
  }

  function pausePlayback() {
    // A new search also owns the pause state of a pending selection, so its
    // completion or cancellation cannot restore the old animation.
    if (targetTransition) targetTransition.wasPaused = true;
    if (typeof setPaused === "function" &&
        (typeof userPaused !== "boolean" || !userPaused)) setPaused(true);
  }

  function beginTargetTransition(descriptor) {
    cancelCustomRun("Replaced by a new selection.");
    if (targetTransition) finishTargetTransition(targetTransition.token, false);
    if (state.activeRun) terminateRun("Replaced by a new selection.");
    // Routed Explorer selections own the next player result. Invalidate any
    // slower baked/startup request so it cannot repaint the previous release
    // over a canonical component response when it eventually completes.
    loadSeq += 1;
    const stage = document.querySelector(".stage");
    const title = document.getElementById("ftitle");
    const subtitle = document.getElementById("fsub");
    const wasPaused = typeof userPaused === "boolean" ? userPaused : true;
    const view = currentRuntimeView();
    const label = String(descriptor && (descriptor.label || descriptor.gene || descriptor.accession) || "Target")
      .trim() || "Target";
    const accession = String(descriptor && descriptor.accession || "").trim();
    const parentLabel = String(descriptor && (
      descriptor.mimicryParentLabel ||
      descriptor.sourceScopeLabel ||
      descriptor.source_scope_label ||
      descriptor.sourceScope ||
      descriptor.source_scope
    ) || "Selected library").trim() || "Selected library";
    const requestedFloor = Number(descriptor && descriptor.floor);
    const floorLabel = Number.isInteger(requestedFloor) && requestedFloor >= 5 && requestedFloor <= 9
      ? "≥" + requestedFloor + "/9"
      : "";
    const token = "target-transition-" + (++targetTransitionSequence);
    const controls = Array.from(document.querySelectorAll(".controls button,.stage button,#expWin,#expRank,#reproBtn,#expSvg,#expPng"));
    targetTransition = {
      token: token,
      stage: stage,
      stageAriaLabel: stage && stage.getAttribute("aria-label"),
      title: title,
      titleNodes: title ? Array.from(title.childNodes).map(function clone(node) { return node.cloneNode(true); }) : [],
      titleTooltip: title && title.getAttribute("data-tooltip"),
      titleTooltipMono: title && title.getAttribute("data-tooltip-mono"),
      titleAriaLabel: title && title.getAttribute("aria-label"),
      subtitle: subtitle,
      subtitleNodes: subtitle ? Array.from(subtitle.childNodes).map(function clone(node) { return node.cloneNode(true); }) : [],
      subtitleTooltip: subtitle && subtitle.getAttribute("data-tooltip"),
      subtitleTooltipMono: subtitle && subtitle.getAttribute("data-tooltip-mono"),
      subtitleAriaLabel: subtitle && subtitle.getAttribute("aria-label"),
      controls: controls,
      wasPaused: wasPaused,
      view: view,
    };
    if (typeof setPaused === "function") setPaused(true);
    controls.forEach(function lock(node) {
      if (!Object.prototype.hasOwnProperty.call(node.dataset, "targetTransitionWasDisabled")) {
        node.dataset.targetTransitionWasDisabled = node.disabled ? "true" : "false";
      }
      node.disabled = true;
    });
    if (stage) {
      stage.setAttribute("aria-busy", "true");
      stage.dataset.playerState = "loading";
      delete stage.dataset.playerError;
      stage.removeAttribute("aria-label");
    }
    if (title) {
      const identity = "Antigen Target · " + label;
      const meta = (accession && accession !== label ? accession + " · " : "") + "loading…";
      writeTransitionTopline(title, identity, meta, "Loading " + identity + (accession ? " · " + accession : ""));
    }
    if (subtitle) {
      const identity = "→ Mimicry Parents · " + parentLabel;
      const meta = [floorLabel, "loading…"].filter(Boolean).join(" · ");
      writeTransitionTopline(subtitle, identity, meta, identity + " · " + meta);
    }
    return token;
  }

  function openRuntimeResult(result, sequenceRows, preferredView) {
    // Native workers and saved JSON carry the complete catalogue, not its
    // derived Map. Restore it once before any viewer hook or match conversion.
    if (typeof result.source_catalog_by_index?.get !== "function") {
      result.source_catalog_by_index = new Map(result.source_catalog.map(source => [source.protein_idx, source]));
    }
    const playerStage = document.querySelector(".stage");
    if (playerStage) {
      delete playerStage.dataset.playerState;
      delete playerStage.dataset.playerError;
      playerStage.removeAttribute("aria-busy");
      playerStage.removeAttribute("aria-label");
    }
    const sameProtein = !!(T && T.acc === result.protein.protein_id);
    const priorStart = sameProtein ? Math.floor(scan) : 0;
    const priorAssembly = sameProtein ? S3ASM : "monomer";
    const playerRows = result.complete_in_memory && result.source_catalog.every(row => typeof row.sequence === "string")
      ? result.source_catalog : (sequenceRows || []);
    const sequenceByKey = new Map(playerRows.map(function index(row) {
      return [stableSourceKey(row), row.sequence];
    }));
    window.MimicryMapViewer?.hooks.sources?.(result,sequenceByKey);
    const matches = fullMatchesToUi(result, sequenceByKey);
    const targetIdentity = result.protein.identity || identityFor(result.protein, {
      activeLibrary: result.protein.library_id,
    });
    const meta = {
      acc: result.protein.protein_id,
      gene: targetIdentity.gene || targetIdentity.primaryLine,
      protein_name: targetIdentity.proteinName,
      source_accession: targetIdentity.accession,
      organism: targetIdentity.organism,
      assay_id: targetIdentity.assayId,
      coordinates: targetIdentity.coordinates,
      variant_hgvs: targetIdentity.variant,
      variant_significance: targetIdentity.significance,
      collection: targetIdentity.collection,
      identity_provenance: targetIdentity.provenance,
      identity: targetIdentity,
      header: targetIdentity.fullHeader,
      len: result.protein.length,
      seq: result.protein.sequence,
      lib: result.protein.library_id,
    };
    const viewTarget = buildTargetFromMatches(meta, matches, result.parameters.floor, result.parameters.source_scope);
    // A sequence the reader supplied, whichever parent population it was compared against.
    // Only the two-FASTA route used to be marked here, so a pasted target compared with a
    // library we serve kept the reference tracks and the assembly control - and when the
    // sequence happened to match a catalog entry, it silently borrowed that entry's
    // variants, modifications, structure and surface. Those describe the catalog record,
    // not the thing that was uploaded, and the match may be partial or coincidental.
    // original_query_fasta is written only when the query came from the textarea; a catalog
    // antigen is addressed by id and never sets it.
    viewTarget.custom = result.origin === "custom" ||
      !!(result.inputs && typeof result.inputs.original_query_fasta === "string");
    viewTarget.bundled = false;
    viewTarget.result = result;
    viewTarget.stats = {};
    viewTarget.allRank = result.ranked_matches;
    viewTarget.completeMotifEvents = completeMotifEventData(result, matches);
    viewTarget.header = result.protein.header || result.protein.raw_header || result.protein.seqid || result.protein.name || result.protein.protein_id;
    viewTarget.seqid = result.protein.seqid || result.protein.header || result.protein.protein_id;
    viewTarget.completeInMemory = result.complete_in_memory === true;
    viewTarget.identity = targetIdentity;
    viewTarget.displayAccession = targetIdentity.accession || result.protein.display_accession || result.protein.protein_id;
    viewTarget.portableId = result.protein.portable_id || null;
    viewTarget.annotationPortableId = result.protein.annotation_portable_id || null;
    viewTarget.nativeTrackAccession = result.protein.native_track_accession || null;
    viewTarget.structureAccession = result.protein.structure_accession || null;
    viewTarget.nativeAssetCrosswalk = result.protein.native_asset_crosswalk || null;
    // Complete result sources already contain every sequence required by the Player.
    viewTarget.historySequenceRows = playerRows;

    let index = DATA.findIndex(function sameTarget(existing) { return existing.acc === viewTarget.acc; });
    if (index < 0) {
      DATA.push(viewTarget);
      index = DATA.length - 1;
      buildChips();
    } else {
      DATA[index] = viewTarget;
    }
    TH = result.parameters.floor;
    state.result = result;
    syncFloorControls(result);
    state.rankPage = 0;
    state.sciencePairId = null;
    select(index);
    const playerTitle = document.getElementById("ftitle");
    if (playerTitle && targetIdentity.tooltip) {
      playerTitle.dataset.tooltip = targetIdentity.tooltip;
      playerTitle.dataset.tooltipMono = "true";
      playerTitle.setAttribute("aria-label", targetIdentity.ariaLabel);
    }
    if (sameProtein) {
      scan = Math.min(priorStart, Math.max(0, N - 1));
      lastCol = -1;
      const cachedStructure = S3cache[viewTarget.acc];
      if (cachedStructure && cachedStructure.m) {
        S3ASM = priorAssembly === "dimer" && cachedStructure.d ? "dimer" : "monomer";
        S3 = S3ASM === "dimer" ? cachedStructure.d : cachedStructure.m;
        applyStructure(viewTarget.acc);
      }
    }
    setView(preferredView || "explorer");
    buildMatchBox();
    window.dispatchEvent(new CustomEvent("mimicryone:navigation-state"));
  }

  function syncFloorControls(result) {
    const floorButtons = document.getElementById("thbtns").children;
    const available = new Set(result.available_floors || []);
    let routed = [];
    const bridge = window.MimicryOneAnalysisRouting;
    if (bridge && typeof bridge.routableFloors === "function") {
      try { routed = bridge.routableFloors(result.protein && result.protein.protein_id, result.result_id) || []; }
      catch (_error) { routed = []; }
    }
    routed.forEach(function add(floor) { available.add(Number(floor)); });
    for (let buttonIndex = 0; buttonIndex < floorButtons.length; buttonIndex += 1) {
      const floor = buttonIndex + 5;
      const direct = result.available_floors.indexOf(floor) >= 0;
      floorButtons[buttonIndex].disabled = !available.has(floor);
      floorButtons[buttonIndex].setAttribute("aria-pressed", floor === TH ? "true" : "false");
      const floorTooltip = direct
        ? "Filter this complete result at " + floor + "/9."
        : (available.has(floor) ? "Run exact " + floor + "/9 indexed analysis; larger requests exceed this deployment's live limit." : "");
      if (floorTooltip) floorButtons[buttonIndex].dataset.tooltip = floorTooltip;
      else floorButtons[buttonIndex].removeAttribute("data-tooltip");
    }
  }

  async function buildPlayerPresentation(accession) {
    let partsPromise = presentationCache.get(accession);
    if (!partsPromise) {
      partsPromise = Promise.all([
        fetchJson(`/data/${encodeURIComponent(accession)}.head.json.gz`),
        fetchJson(`/data/${encodeURIComponent(accession)}.player.json.gz`),
      ]);
      presentationCache.set(accession, partsPromise);
    }
    const parts = await partsPromise;
    const head = parts[0];
    const player = parts[1];
    const protein = {
      protein_id: head.protein.protein_id,
      gene: head.protein.gene,
      name: head.protein.name,
      library_id: head.protein.library,
      organism: head.protein.organism,
      length: head.protein.length,
      sequence: head.protein.sequence,
    };
    const scope = sourceScopeForProtein(protein);
    if ((scope !== "human" && scope !== "nonhuman") || !player.scopes || !player.scopes[scope]) {
      return buildBakedResult(accession, scope, TH);
    }
    const sourceFilter = filterForScope(scope);
    const ranked = parseCompactRows(head, runtimeIndexByNumeric, sourceFilter);
    const sourceCatalog = ranked.map(function sourceRecord(row) {
      return runtimeIndexByNumeric.get(row.protein_index);
    }).filter(Boolean);
    const sourceCatalogByIndex = new Map(sourceCatalog.map(function index(source) {
      return [source.protein_idx, source];
    }));
    const scopeBlock = player.scopes[scope];
    const sourceProteinsBearingHitByFloor = {};
    Object.keys(scopeBlock.floors || {}).forEach(function collectExactCount(floorKey) {
      const count = Number(scopeBlock.floors[floorKey].eligible_source_proteins);
      if (Number.isFinite(count) && count >= 0) sourceProteinsBearingHitByFloor[floorKey] = count;
    });
    const positional = scopeBlock.floors[`m${TH}`].lanes;
    const result = {
      schema: "mimicryone/presentation/1",
      origin: "baked",
      presentation_only: true,
      complete_result_files: player.complete_result_files,
      result_id: `presentation:${accession}:${scope}`,
      protein,
      parameters: {
        floor: TH,
        source_scope: scope,
        window: K,
        coordinates: "1-based window starts, inclusive interval ends",
      },
      available_floors: [5, 6, 7, 8, 9],
      source_catalog: sourceCatalog,
      source_catalog_by_index: sourceCatalogByIndex,
      exact_counts: {
        source_proteins_bearing_hit_by_floor: sourceProteinsBearingHitByFloor,
      },
      coverage: scopeBlock.coverage,
      ranked_matches: ranked,
      positional_matches: positional,
      inputs: {
        presentation_artifact: `${accession}.player.json.gz`,
        complete_result_files: player.complete_result_files,
        source_catalog: "_index.json.gz",
      },
      provenance: {
        runtime: RUNTIME_VERSION,
        artifact_schema: player.schema,
        source: "bounded Player presentation cache",
      },
      statistics_status: head.statistics_status,
    };
    const pack = await loadSequencePack(scope);
    return { result, sequenceRows: pack.rows };
  }

  function normalizedResultScope(scope) {
    const value = String(scope || "").trim();
    return value.indexOf("library:") === 0 ? value.slice("library:".length) : value;
  }

  function bakedArtifactParts(accession) {
    if (artifactPartsCache.has(accession)) return artifactPartsCache.get(accession);
    const promise = Promise.all([
      fetchJson(`/data/${encodeURIComponent(accession)}.head.json.gz`),
      fetchJson(`/data/${encodeURIComponent(accession)}.full.json.gz`),
    ]);
    artifactPartsCache.set(accession, promise);
    return promise;
  }

  function invalidateBakedResults(accession) {
    const prefix = String(accession) + "|";
    Array.from(artifactCache.keys()).forEach(function removeScope(key) {
      if (String(key).indexOf(prefix) === 0) artifactCache.delete(key);
    });
  }

  async function buildBakedResult(accession, requestedScope, requestedFloor) {
    const floor = Number.isInteger(Number(requestedFloor)) ? Number(requestedFloor) : TH;
    const parts = await bakedArtifactParts(accession);
    const head = parts[0];
    const protein = {
      protein_id: head.protein.protein_id,
      gene: head.protein.gene,
      name: head.protein.name,
      library_id: head.protein.library,
      organism: head.protein.organism,
      length: head.protein.length,
      sequence: head.protein.sequence,
    };
    const scope = normalizedResultScope(requestedScope) || sourceScopeForProtein(protein);
    const cacheKey = String(accession) + "|" + scope;
    if (artifactCache.has(cacheKey)) return artifactCache.get(cacheKey);
    const promise = Promise.resolve(parts).then(async function adapt(loadedParts) {
      const full = loadedParts[1];
      const sourceFilter = filterForScope(scope);
      const positional = full.mimics.filter(function include(row) {
        const source = runtimeIndexByNumeric.get(row.protein_idx);
        return source && sourceFilter(source);
      });
      const sourceCatalog = positional.map(function sourceRecord(row) {
        return runtimeIndexByNumeric.get(row.protein_idx);
      }).filter(Boolean);
      const sourceCatalogByIndex = new Map(sourceCatalog.map(function index(source) {
        return [source.protein_idx, source];
      }));
      const ranked = parseCompactRows(head, runtimeIndexByNumeric, sourceFilter);
      const result = {
        schema: RESULT_SCHEMA,
        origin: "baked",
        result_id: `baked:${accession}:${scope}`,
        protein,
        parameters: {
          floor: floor,
          source_scope: scope,
          window: K,
          coordinates: "1-based window starts, inclusive interval ends",
        },
        available_floors: [5, 6, 7, 8, 9],
        source_catalog: sourceCatalog,
        source_catalog_by_index: sourceCatalogByIndex,
        coverage: computeCoverage(protein.length, positional, sourceCatalogByIndex),
        ranked_matches: ranked,
        positional_matches: positional,
        inputs: {
          query_artifacts: [`${accession}.head.json.gz`, `${accession}.full.json.gz`],
          source_catalog: "_index.json.gz",
          source_sequence_pack: scope === "human" ? "sequences.human.json.gz" : "sequences.nonhuman.json.gz",
        },
        provenance: {
          runtime: RUNTIME_VERSION,
          artifact_schema: head.schema,
          source: "versioned MimicryMap baked artifact",
        },
        statistics_status: head.statistics_status,
      };
      const pack = await loadSequencePack(scope);
      return { result, sequenceRows: pack.rows };
    });
    artifactCache.set(cacheKey, promise);
    return promise;
  }

  async function loadStaticProtein(accession) {
    cancelCustomRun("Replaced by a new atlas selection.");
    const requestToken = ++loadSeq;
    const viewRequest = viewIntentRevision;
    const preferredView = currentRuntimeView();
    if (state.activeRun) terminateRun("Replaced by a new atlas selection.");
    note(loadnote, `Loading ${accession} from its versioned artifact...`);
    try {
      const adapted = await buildPlayerPresentation(accession);
      if (requestToken !== loadSeq) return;
      adapted.result.parameters.floor = TH;
      openRuntimeResult(adapted.result, adapted.sequenceRows, completionView(viewRequest, preferredView));
      const count = adapted.result.ranked_matches.filter(function atFloor(row) {
        return row.floors[`m${TH}`].pairs > 0;
      }).length;
      note(loadnote, `${adapted.result.protein.gene || accession} · ${nf(count)} source proteins at ≥${TH}/9 · ${scopeLabel(adapted.result.parameters.source_scope)}`);
    } catch (error) {
      if (requestToken !== loadSeq) return;
      note(loadnote, `${accession} could not be opened (${error.message}). No alternate dataset or result was substituted.`, true);
    }
  }

  const parseFastaStrict = window.MimicryFastaInput.parse;

  function currentCustomFloor() {
    const select = document.getElementById("customFloor");
    return select ? Number(select.value) : 7;
  }

  async function customTargetSet() {
    if (MIMIC_MODE === "custom") {
      const parsed = parseFastaStrict(document.getElementById("mimicfa").value, "target");
      if (parsed.errors.length || !parsed.records.length) throw new Error(parsed.errors[0] || "No Mimicry Parent FASTA was supplied.");
      return {
        scope: "custom",
        pack: { schema: "user-fasta/1", generated_utc: new Date().toISOString(), window_count: parsed.records.reduce(function windows(total, row) { return total + row.length - K + 1; }, 0) },
        rows: parsed.records.map(function customTarget(record) {
          return Object.assign({}, record, { library_id: "__custom_target__", organism: "user supplied" });
        }),
      };
    }
    const scope = MIMIC_MODE === "human" ? "human" : "nonhuman";
    const pack = await loadSequencePack(scope);
    let rows = pack.rows;
    if (MIMIC_MODE === "one") {
      const selected = document.getElementById("libsel").value;
      rows = rows.filter(function oneLibrary(row) { return row.library_id === selected; });
      return { scope: selected, pack, rows };
    }
    return { scope, pack, rows };
  }

  function formatWork(queryWindows, targetWindows) {
    const comparisons = queryWindows * targetWindows;
    if (comparisons < 1e6) return `${nf(comparisons)} window pairs`;
    if (comparisons < 1e9) return `${(comparisons / 1e6).toFixed(1)} million window pairs`;
    return `${(comparisons / 1e9).toFixed(2)} billion window pairs`;
  }

  function terminateRun(message) {
    const run = state.activeRun;
    if (!run) return;
    run.cancelled = true;
    run.workers.forEach(function terminate(worker) { worker.terminate(); });
    run.reject(new Error(message || "Canceled."));
    state.activeRun = null;
  }

  function scanOneQuery(query, targets, floor, progress, timings) {
    if (!targets.length) return Promise.resolve([]);
    if (state.activeRun) return Promise.reject(new Error((/*@copy mimicryone-runtime.a-local-worker-request-is.eb30b1a*/`A local worker request is already running.`/*@endcopy*/)));
    const workerCount = Math.max(1, Math.min(8, Math.floor(0.75 * (navigator.hardwareConcurrency || 4)), targets.length));
    const chunkSize = Math.ceil(targets.length / workerCount);
    const chunks = [];
    for (let start = 0; start < targets.length; start += chunkSize) {
      chunks.push({ start, targets: targets.slice(start, start + chunkSize) });
    }
    if (timings) {
      timings.worker_count = chunks.length;
      timings.hardware_threads = navigator.hardwareConcurrency || null;
    }
    return new Promise(function runWorkers(resolve, reject) {
      const run = { workers: [], reject, cancelled: false };
      state.activeRun = run;
      const progressByChunk = new Array(chunks.length).fill(0);
      const results = new Array(chunks.length);
      let complete = 0;
      try { chunks.forEach(function launch(chunk, chunkIndex) {
        const worker = new Worker("/custom-worker.js");
        run.workers.push(worker);
        worker.onerror = function workerError(event) {
          if (run.cancelled || state.activeRun !== run) return;
          terminateRun(event.message || "The local worker stopped.");
        };
        worker.onmessage = function workerMessage(event) {
          if (run.cancelled || state.activeRun !== run) return;
          if (event.data.type === "progress") {
            progressByChunk[chunkIndex] = event.data.completed / Math.max(1, event.data.total);
            progress(progressByChunk.reduce(function sum(total, value) { return total + value; }, 0) / chunks.length);
            return;
          }
          if (event.data.type === "complete") {
            if (results[chunkIndex] !== undefined) return;
            results[chunkIndex] = event.data.summaries;
            complete += 1;
            worker.terminate();
            if (complete === chunks.length) {
              state.activeRun = null;
              resolve(results.flat());
            }
          }
        };
        worker.postMessage({
          type: "scan",
          query: {sequence:query.sequence},
          targets: chunk.targets.map(row => ({protein_id:row.protein_id,sequence:row.sequence})),
          floor,
          chunkOffset: chunk.start,
        });
      }); } catch (error) { terminateRun(error.message || "The local worker could not start."); }
    });
  }

  async function scanPreparedRecords(options) {
    const {query,records,floor,signal,timings} = options;
    if (signal && signal.aborted) throw new DOMException("Canceled", "AbortError");
    // The existing pool owns concurrency, ordering and worker cleanup for every
    // caller. A rejected concurrent request must never cancel someone else's run.
    if (state.activeRun) return scanOneQuery(query, records, floor, options.progress || function(){}, timings);
    const pending = scanOneQuery(query, records, floor, options.progress || function(){}, timings);
    const owned = state.activeRun;
    const abort = function(){ if (owned && state.activeRun === owned) terminateRun("Canceled."); };
    if (signal) signal.addEventListener("abort", abort, {once:true});
    try {
      const result = await pending;
      if (signal && signal.aborted) throw new DOMException("Canceled", "AbortError");
      return result;
    } catch (error) {
      if (signal && signal.aborted) throw new DOMException("Canceled", "AbortError");
      throw error;
    } finally { if (signal) signal.removeEventListener("abort", abort); }
  }

  function customResult(query, targetSet, summaries, floor) {
    const sourceCatalog = summaries.map(function source(summary) {
      return Object.assign({}, targetSet.rows[summary.protein_index], {
        protein_idx: summary.protein_index,
      });
    });
    const sourceCatalogByIndex = new Map(sourceCatalog.map(function index(source) {
      return [source.protein_idx, source];
    }));
    const positional = summaries.map(function nested(summary) {
      return {
        protein_idx: summary.protein_index,
        protein_id: summary.protein_id,
        best_identity: summary.best_identity,
        hits_columns: ["target_start", "source_start", "identity", "source_9mer"],
        hits: summary.hits,
      };
    });
    const ranked = positional.map(function rankedRow(source) {
      const metadata = sourceCatalogByIndex.get(source.protein_idx);
      const floors = {};
      for (let candidateFloor = 5; candidateFloor <= 9; candidateFloor += 1) {
        floors[`m${candidateFloor}`] = candidateFloor < floor
          ? { unavailable: true, target_windows: 0, source_windows: 0, pairs: 0, target_loci: 0, source_loci: 0 }
          : floorStatsFromHits(source.hits, query.length, metadata.length, candidateFloor);
      }
      return {
        protein_index: source.protein_idx,
        protein_id: source.protein_id,
        display_id: metadata.display_id || metadata.display_accession || metadata.protein_id,
        source_accession: metadata.source_accession,
        gene: metadata.gene,
        name: metadata.name,
        header: metadata.header,
        seqid: metadata.seqid,
        raw_header: metadata.raw_header,
        library_id: metadata.library_id,
        organism: metadata.organism,
        length: metadata.length,
        best_identity: source.best_identity,
        floors,
      };
    });
    return {
      schema: RESULT_SCHEMA,
      origin: "custom",
      result_id: `custom:${Date.now()}:${query.protein_id}`,
      protein: window.MimicryFastaInput.targetRecord(query),
      parameters: {
        floor,
        source_scope: targetSet.scope,
        window: K,
        coordinates: "1-based window starts, inclusive interval ends",
      },
      available_floors: Array.from({ length: 10 - floor }, function floorList(_, index) { return floor + index; }),
      source_catalog: sourceCatalog,
      source_catalog_by_index: sourceCatalogByIndex,
      coverage: computeCoverage(query.length, positional, sourceCatalogByIndex),
      ranked_matches: ranked,
      positional_matches: positional,
      inputs: {
        reproduction_parents: targetSet.rows,
        original_query_fasta: query.original_id !== undefined ? window.MimicryFastaInput.firstTarget(document.getElementById("fasta")?.value).fasta : null,
        original_parent_fasta: targetSet.scope === "custom" ? document.getElementById("mimicfa")?.value : null,
        query_fasta: [{
          source_id: query.protein_id,
          header: query.header,
          seqid: query.seqid || query.header,
          raw_header: query.raw_header || query.header,
          sequence: query.sequence,
          normalization: query.normalization,
        }],
        comparison_fasta: targetSet.scope === "custom" ? targetSet.rows.map(function retain(record) {
          return {
            source_id: record.protein_id,
            header: record.header,
            seqid: record.seqid || record.header,
            raw_header: record.raw_header || record.header,
            sequence: record.sequence,
            normalization: record.normalization,
          };
        }) : null,
        comparison_pack: targetSet.scope === "custom" ? null : {
          schema: targetSet.pack.schema,
          generated_utc: targetSet.pack.generated_utc,
          scope: targetSet.scope,
          protein_count: targetSet.rows.length,
          window_count: targetSet.rows.reduce(function windows(total, row) {
            return total + Math.max(0, row.length - K + 1);
          }, 0),
        },
      },
      provenance: {
        runtime: RUNTIME_VERSION,
        generated_utc: new Date().toISOString(),
        execution: "browser-local Web Workers",
        query_header: query.header,
        query_normalization: query.normalization,
        target_pack_schema: targetSet.pack.schema,
        target_pack_generated_utc: targetSet.pack.generated_utc,
        target_protein_count: targetSet.rows.length,
        target_window_count: targetSet.rows.reduce(function targetWindows(total, row) { return total + Math.max(0, row.length - K + 1); }, 0),
      },
      statistics_status: {
        state: "descriptive_only",
        p_values: false,
        q_values: false,
        reason: "The composition-aware null model has not yet been frozen.",
      },
    };
  }


  async function scanCatalogueProtein(metadata, requestToken, viewRequest, preferredView) {
    const cancel = document.getElementById("catalogCancel");
    try {
      const queryPackScope = HUMAN_LIBRARIES.has(metadata.lib) ? "human" : "nonhuman";
      note(loadnote, `Reading ${metadata.gene || metadata.acc} from the indexed catalog...`);
      const queryPack = await loadSequencePack(queryPackScope);
      if (requestToken !== loadSeq) return;
      const indexed = queryPack.rows.find(function sameProtein(row) { return row.protein_id === metadata.acc; });
      if (!indexed) throw new Error((/*@copy mimicryone-runtime.the-indexed-sequence-is-unavailable.3019fde*/`The indexed sequence is unavailable.`/*@endcopy*/));
      const query = Object.assign({}, indexed, {
        protein_id: metadata.acc,
        gene: metadata.gene || indexed.gene || metadata.acc,
        name: metadata.name || indexed.name || metadata.acc,
        header: metadata.name || indexed.name || metadata.acc,
        normalization: "indexed sequence used as supplied",
      });
      const scope = sourceScopeForProtein(query);
      let targetSet;
      if (scope === "custom") {
        targetSet = await customTargetSet();
      } else {
        const targetPack = await loadSequencePack(scope === "human" ? "human" : "nonhuman");
        const targets = targetPack.rows.filter(filterForScope(scope));
        targetSet = { scope, pack: targetPack, rows: targets };
      }
      if (requestToken !== loadSeq) return;
      if (!targetSet.rows.length) throw new Error((/*@copy mimicryone-runtime.the-selected-mimicry-parent-source.816b9be*/`The selected mimicry parent source contains no sequences.`/*@endcopy*/));
      const queryWindows = Math.max(0, query.length - K + 1);
      const targetWindows = targetSet.rows.reduce(function totalWindows(total, row) {
        return total + Math.max(0, row.length - K + 1);
      }, 0);
      cancel.hidden = false;
      note(loadnote, `${query.gene || query.protein_id} · browser-local catalog scan at ≥${TH}/9 · ${formatWork(queryWindows, targetWindows)}. This can take substantial time; Cancel is safe.`);
      const summaries = await scanOneQuery(query, targetSet.rows, TH, function progress(fraction) {
        if (requestToken !== loadSeq) return;
        note(loadnote, `Scanning ${query.gene || query.protein_id} locally · ${Math.round(fraction * 100)}% · Cancel is safe.`);
      });
      if (requestToken !== loadSeq) return;
      const result = customResult(query, targetSet, summaries, TH);
      result.origin = "catalogue";
      result.result_id = `catalogue:${query.protein_id}:${targetSet.scope}:m${TH}`;
      result.protein.library_id = query.library_id;
      result.protein.organism = query.organism;
      result.inputs.query_catalogue = {
        source_id: query.protein_id,
        library_id: query.library_id,
        sequence: query.sequence,
      };
      delete result.inputs.query_fasta;
      result.provenance.execution = "browser-local catalog scan";
      openRuntimeResult(result, targetSet.rows, completionView(viewRequest, preferredView || "explorer"));
      note(loadnote, `${query.gene || query.protein_id} · ${nf(result.ranked_matches.length)} matched source proteins retained locally at ≥${TH}/9 · ${scopeLabel(targetSet.scope)}`);
    } catch (error) {
      if (requestToken !== loadSeq) return;
      note(loadnote, error.message || "The catalog scan stopped.", true);
    } finally {
      if (requestToken === loadSeq) cancel.hidden = true;
    }
  }

  // ---- On-demand browser-local scan for a selected built-in library target ----
  // Release-bound scope metadata selects records from a verified static package.
  // Browser workers receive the complete selected population at every local threshold.
  const LOCAL_INPUTS_SCHEMA = "mimicryone/local-inputs/1";

  // Build the same row shape rowsFromSequencePack() produces, resolved through the
  // shared identity resolver, so a locally computed result carries exactly the
  // annotations, display accessions, genes, protein names and organisms the stored
  // 7/9 route already renders. Raw catalog ids are keys, never display labels.
  function localInputRow(record) { return window.MimicryLocalInputRecords.row(record); }

  // Immutable input packages are cached by release/library/scope identity and NOT by
  // threshold, so a 5/9 run and a later 6/9 run of the same scope download once.
  // Identical pending downloads are coalesced; a canceled consumer must not corrupt
  // a shared load. Preparation stops when its last consumer detaches.
  const localInputCache = new Map();
  const LOCAL_INPUT_CACHE_LIMIT = 3;
  const LOCAL_INPUT_MEMORY_BUDGET = 512 * 1024 * 1024;

  // Persistent packages are release-derived reference records only. A user's own
  // pasted or uploaded FASTA is never written to disk; it stays in memory.
  const INPUT_DB_NAME = "mimicryone-local-inputs";
  const INPUT_DB_STORE = "packages";
  // One small row per stored package: key, library, release, bytes, records, storedAt. Eviction
  // and the stored-input listing need those numbers and nothing else, and reading them out of
  // the packages themselves meant deserializing the entire cache - up to the byte limit below -
  // into memory on every write and every listing.
  const INPUT_DB_META_STORE = "package_meta";
  const INPUT_DB_VERSION = 3;
  const INPUT_CACHE_BYTE_LIMIT = 64 * 1024 * 1024;
  // A ceiling on any single package, separate from the whole-cache one above. Storing a package
  // means cloning every record and pushing the copy through a structured clone, and on the tile
  // libraries that is hundreds of megabytes of synchronous main-thread work: the tab froze on
  // the status line and could run out of memory. The largest library claimed 755 MB, over the
  // cache limit, so the clone was built and then refused - the entire cost, none of the benefit.
  // Above this, skip persistence. The in-memory cache still serves repeat runs in this session,
  // and the price of missing the stored one is a re-download, which is far cheaper than the write.
  const INPUT_CACHE_PACKAGE_LIMIT = 64 * 1024 * 1024;
  // Approximate stored size per record. Deliberately computed from the record count alone so it
  // can be known before anything is copied.
  const STORED_BYTES_PER_RECORD = 600;

  function estimateStoredBytes(bundle) {
    return (bundle && bundle.records ? bundle.records.length : 0) * STORED_BYTES_PER_RECORD;
  }

  function localInputCacheKey(options) {
    return JSON.stringify({
      library: options.library,
      filters: options.filters || {},
      component: options.component || null,
      // A different release is a different population, never a cache hit.
      release: options.release || null,
    });
  }

  // The stored identity pins the release: a new release never reuses an old package.
  // Stored populations are keyed by how the scope that produced them was decided, not only by
  // the scope itself. Packages built before the scope was resolved server-side hold whatever
  // the old client-side membership test admitted - for a provenance filter, nothing at all -
  // and a stored empty population is indistinguishable from a real one at read time. It would
  // be returned instantly, reporting a complete run with no matches. Bumping this retires
  // those entries; it is not the wire schema, which still validates server responses.
  const SCOPE_RESOLUTION = "server-resolved-ids/4-package-scope-mask";

  function persistentInputKey(options, releaseFingerprint) {
    return JSON.stringify({
      release: releaseFingerprint || null,
      library: options.library,
      filters: options.filters || {},
      component: options.component || null,
      schema: LOCAL_INPUTS_SCHEMA,
      scope: SCOPE_RESOLUTION,
    });
  }

  function openInputDb() {
    return new Promise(function open(resolve) {
      let request;
      try {
        request = indexedDB.open(INPUT_DB_NAME, INPUT_DB_VERSION);
      } catch (error) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = function upgrade(event) {
        const db = request.result;
        if (!db.objectStoreNames.contains(INPUT_DB_STORE)) {
          db.createObjectStore(INPUT_DB_STORE, { keyPath: "key" }).createIndex("storedAt", "storedAt");
        }
        if (!db.objectStoreNames.contains(INPUT_DB_META_STORE)) {
          db.createObjectStore(INPUT_DB_META_STORE, { keyPath: "key" });
        }
        // Entries written before version 2 have no meta row, so eviction could not account for
        // them, and some were written by a scope test that admitted nothing - a stored empty
        // population is indistinguishable from a real one at read time. This is a cache and the
        // packages are re-downloadable, so drop them rather than migrate a wrong answer forward.
        if (event.oldVersion < 3 && db.objectStoreNames.contains(INPUT_DB_STORE)) {
          request.transaction.objectStore(INPUT_DB_STORE).clear();
          request.transaction.objectStore(INPUT_DB_META_STORE).clear();
        }
      };
      // Storage may be unavailable (private mode, blocked, quota). Never fail the run.
      request.onsuccess = function ready() { resolve(request.result); };
      request.onerror = function failed() { resolve(null); };
      request.onblocked = function blocked() { resolve(null); };
    });
  }

  function inputDbRequest(store, action) {
    return new Promise(function run(resolve) {
      let request;
      try { request = action(store); } catch (error) { resolve(null); return; }
      request.onsuccess = function ok() { resolve(request.result); };
      request.onerror = function failed() { resolve(null); };
    });
  }

  async function readPersistentPackage(key) {
    const db = await openInputDb();
    if (!db) return null;
    try {
      const store = db.transaction(INPUT_DB_STORE, "readonly").objectStore(INPUT_DB_STORE);
      const stored = await inputDbRequest(store, function get(target) { return target.get(key); });
      return stored && stored.compact && stored.compact.records && stored.compact.records.every(row => row.native) ? stored : null;
    } catch (error) {
      return null;
    } finally {
      db.close();
    }
  }

  async function writePersistentPackage(key, payload) {
    // Refuse before doing any work. This test used to sit after the accounting read, so a
    // package too large to store still paid for the whole cache being loaded to measure it.
    if (payload.bytes > INPUT_CACHE_BYTE_LIMIT) return false;
    const db = await openInputDb();
    if (!db) return false;
    try {
      const transaction = db.transaction([INPUT_DB_STORE, INPUT_DB_META_STORE], "readwrite");
      const store = transaction.objectStore(INPUT_DB_STORE);
      const meta = transaction.objectStore(INPUT_DB_META_STORE);
      // Accounting reads the meta rows, not the packages.
      const existing = await inputDbRequest(meta, function all(target) { return target.getAll(); });
      // Bounded cache: evict least recently stored packages before adding a new one.
      let used = (existing || []).reduce(function total(sum, row) { return sum + (row.bytes || 0); }, 0);
      const ordered = (existing || []).slice().sort(function oldest(a, b) { return (a.storedAt || 0) - (b.storedAt || 0); });
      while (used + payload.bytes > INPUT_CACHE_BYTE_LIMIT && ordered.length) {
        const victim = ordered.shift();
        if (victim.key === key) continue;
        await inputDbRequest(store, function drop(target) { return target.delete(victim.key); });
        await inputDbRequest(meta, function dropMeta(target) { return target.delete(victim.key); });
        used -= victim.bytes || 0;
      }
      await inputDbRequest(store, function put(target) { return target.put(payload); });
      await inputDbRequest(meta, function putMeta(target) {
        return target.put({ key: key, library: payload.library, release: payload.release,
                            bytes: payload.bytes, storedAt: payload.storedAt,
                            records: payload.compact && payload.compact.records
                              ? payload.compact.records.length : 0 });
      });
      return true;
    } catch (error) {
      return false;
    } finally {
      db.close();
    }
  }

  // Persist a loaded population, or decline without copying it. The size is derived from the
  // record count so the decision happens before packForStorage, which is where the cost is:
  // it copies every record, and on the tile libraries that copy was the freeze.
  function persistPackage(key, release, library, bundle) {
    const bytes = estimateStoredBytes(bundle);
    if (bytes > INPUT_CACHE_PACKAGE_LIMIT) return false;
    writePersistentPackage(key, {
      key: key, release: release, library: library,
      compact: packForStorage(bundle), bytes: bytes, storedAt: Date.now(),
    });
    return true;
  }

  function trimLocalInputs(keepKey, incomingBytes) {
    const settled = Array.from(localInputCache.entries()).filter(([key, entry]) => key !== keepKey && entry.settled);
    let used = incomingBytes + settled.reduce((total, [, entry]) => total + estimateStoredBytes(entry.bundle), 0);
    for (const [key, entry] of settled) {
      if (used <= LOCAL_INPUT_MEMORY_BUDGET && localInputCache.size <= LOCAL_INPUT_CACHE_LIMIT) break;
      used -= estimateStoredBytes(entry.bundle);
      localInputCache.delete(key);
    }
  }

  function rememberLocalInputs(key, entry) {
    localInputCache.delete(key);
    localInputCache.set(key, entry);
    trimLocalInputs(key, entry.bundle ? estimateStoredBytes(entry.bundle) : 0);
  }

  // Stored packages keep only release-derived values; the resolved identity object is
  // re-derived on read so the cache stays small and never freezes a stale resolver.
  function packForStorage(bundle) {
    return {
      manifest: bundle.manifest,
      scopeHash: bundle.scopeHash,
      // No query record. This artifact is the parent population, which several targets share;
      // the record being compared belongs to one request and is fetched per run.
      records: bundle.records.map(function strip(row) {
        const copy = Object.assign({}, row);
        delete copy.identity;
        delete copy.identity_provenance;
        return copy;
      }),
    };
  }

  function unpackStored(stored) {
    const records = stored.compact.records.map(function rehydrate(row) {
      const identity = identityFor(row, { activeLibrary: row.library_id });
      return Object.assign({}, row, { identity: identity, identity_provenance: identity.provenance });
    });
    return { records: records, manifest: stored.compact.manifest,
             scopeHash: stored.compact.scopeHash, queryRecord: null };
  }

  // Resolve exact scope membership once, including filters on correlated provenance rows.
  // Sequences and annotations always come from the verified static package.
  async function resolveScopeContext(options, signal) {
    const params = new URLSearchParams({
      library: options.library, floor: String(options.floor), population_only: "true",
      filters: JSON.stringify(options.filters || {}), shape: "scope",
    });
    if (options.component) params.set("component", options.component);
    const response = await fetch("/api/analysis/local-inputs?" + params.toString(), {signal});
    if (!response.ok) return null;
    const page = await response.json(), manifest = page.manifest || {};
    if (page.schema !== LOCAL_INPUTS_SCHEMA || page.shape !== "scope" || !page.membership_mask ||
        !page.release_fingerprint || manifest.library !== options.library) return null;
    const scope = {release:page.release_fingerprint, filterColumns:page.row_filter_columns || {},
      effectiveFilters:manifest.filters || {}, populationRecords:manifest.population_records,
      membershipMask:page.membership_mask, manifest:manifest, scopeHash:page.scope_hash, inputPackage:page.input_package};
    window.MimicryLocalInputRecords.scopeMask(scope, options.library);
    return scope;
  }

  const LOCAL_PACKAGE_SCHEMA = "mimicryone/local-input-package/1";

  function scopeIsAnswerableLocally(filters, columns, carried) {
    return window.MimicryLocalInputRecords.answerable(filters, columns, carried);
  }

  function membershipMatches(record, filters, columns) {
    return window.MimicryLocalInputRecords.matches(record, filters, columns);
  }

  // A baked package holds the parent population only. When the query is a catalog
  // antigen rather than pasted FASTA, its record still has to come from the release,
  // so ask for exactly that one record.
  async function fetchQueryRecord(options) {
    if (!options.queryId || !options.queryLibrary) return null;
    // A target in another component cannot be requested through the parent's
    // population endpoint. Read its exact catalog identity independently.
    if (options.queryComponent) {
      const params = new URLSearchParams({
        component: options.queryComponent, library: options.queryLibrary,
        antigen_id: String(options.queryId), include_sequence: "true", limit: "1",
      });
      try {
        const response = await fetch("/api/analysis/antigens?" + params.toString(), {signal:options.signal});
        if (!response.ok) return null;
        const page = await response.json(), records = page.antigens || [];
        const record = records.length === 1 ? records[0] : null;
        if (page.component_key !== options.queryComponent || !record ||
            Number(record.antigen_id) !== Number(options.queryId) || record.library !== options.queryLibrary) return null;
        return record;
      } catch (error) {
        if (options.signal && options.signal.aborted) throw error;
        return null;
      }
    }
    const params = new URLSearchParams({
      library: options.library, floor: String(options.floor), population_only: "true",
      filters: JSON.stringify(options.filters || {}), limit: "1",
      query_id: String(options.queryId), query_library: options.queryLibrary,
    });
    if (options.component) params.set("component", options.component);
    try {
      const response = await fetch("/api/analysis/local-inputs?" + params.toString());
      if (!response.ok) return null;
      const page = await response.json();
      return (page.query_records || [])[0] || null;
    } catch (error) {
      return null;
    }
  }

  async function loadBakedPackage(options, scope, onProgress, signal, fullFallback) {
    if (!scope || !scope.release || typeof DecompressionStream === "undefined") return null;
    options = Object.assign({}, options, {filters:scope.effectiveFilters || options.filters || {}});
    const base = "/data/local-inputs/" + encodeURIComponent(scope.release) + "/" + encodeURIComponent(options.library);
    let metadata, packageUrl;
    const scoped = !fullFallback && scope.inputPackage;
    try {
      if (scoped) {
        metadata = scoped.metadata;
        packageUrl = scoped.url;
        if (!metadata || packageUrl !== "/data/scoped-inputs/" + metadata.sha256 + ".json.gz?raw=1" ||
            metadata.manifest?.download_records !== scope.populationRecords) return null;
      } else {
        const response = await fetch(base + ".meta.json", {cache:"no-store",signal});
        if (!response.ok) return null;
        metadata = await response.json();
        packageUrl = base + '.json.gz?sha256=' + metadata.sha256 + '&raw=1';
      }
      if (metadata.schema !== "mimicryone/local-input-metadata/1" ||
          metadata.release_fingerprint !== scope.release || metadata.library !== options.library ||
          !/^[0-9a-f]{64}$/.test(metadata.sha256) || !metadata.manifest || !Array.isArray(metadata.row_columns)) return null;
      if (!window.MimicryLocalInputRecords.scopeMask(scope, options.library) &&
          !scopeIsAnswerableLocally(options.filters, scope.filterColumns, new Set(metadata.membership_fields || []))) return null;
    } catch (error) { if (signal && signal.aborted) throw error; return null; }
    if (signal && signal.aborted) throw new DOMException("Canceled.", "AbortError");
    trimLocalInputs(localInputCacheKey(options), (scope.populationRecords || metadata.manifest.download_records) * STORED_BYTES_PER_RECORD);
    if (onProgress) onProgress(-4, 0);
    const prepared = await new Promise(function prepare(resolve, reject) {
      let worker;
      const records = [];
      function finish(value, error) {
        if (worker) worker.terminate();
        if (signal) signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      }
      function abort() { finish(null, new DOMException("Canceled.", "AbortError")); }
      if (signal) signal.addEventListener('abort', abort, {once:true});
      if (signal && signal.aborted) { abort(); return; }
      try {
        worker = new Worker('/local-input-worker.js');
        worker.onerror = worker.onmessageerror = function failed() { finish(null); };
        worker.onmessage = function message(event) {
          const data = event.data;
          if (data.type === 'batch') {
            for (const row of data.records) records.push(data.compact ? window.MimicryLocalInputRecords.unpack(row) : row);
            worker.postMessage({type:'ack'});
          } else if (data.type === 'progress') {
            if (onProgress) onProgress(data.stage === 'cached' ? -1 : (data.stage === 'download' ? -5 : (data.stage === 'prepare_progress' ? -6 : -2)), data.completed || data.bytes || data.total || 0);
          } else if (data.type === 'complete') {
            finish({records:records,manifest:data.manifest,scopeHash:data.scopeHash,queryRecord:null,
                    source:'baked_package',timings:data.timings});
          } else if (data.type === 'error') finish(null);
        };
        worker.postMessage({type:'load',compactRecords:true,url:packageUrl,metadata:metadata,scope:scope,
          options:{library:options.library,filters:options.filters||{}}});
      } catch (error) { finish(null); }
    });
    // A removed/corrupt derived cache entry must not break an otherwise valid selection.
    if (!prepared && scoped && !(signal && signal.aborted))
      return loadBakedPackage(options, scope, onProgress, signal, true);
    return prepared;
  }

  async function loadLocalInputs(options, onProgress, signal) {
    const scope = await resolveScopeContext(options, signal);
    if (signal && signal.aborted) throw new DOMException("Canceled.", "AbortError");
    const baked = await loadBakedPackage(options, scope, onProgress, signal);
    if (baked) return baked;
    throw new Error((/*@copy mimicryone-runtime.input-package-unavailable*/`The prepared inputs for this selection are unavailable or incompatible. Please refresh and try again; if this continues, the site needs its input packages updated.`/*@endcopy*/));
  }

  function cachedLocalInputs(options, onProgress, signal) {
    if (signal && signal.aborted) return Promise.reject(new DOMException("Canceled.", "AbortError"));
    const key = localInputCacheKey(options);
    let entry = localInputCache.get(key);
    if (!entry) {
      entry = {settled:false, total:0, promise:null, listeners:new Set(), progress:null, controller:new AbortController()};
      entry.promise = loadLocalInputs(options, function progress(done, total) {
        entry.progress = [done, total];
        entry.listeners.forEach(listener => listener(done, total));
      }, entry.controller.signal).then(function settle(bundle) {
        entry.settled = true;
        entry.total = bundle.records.length;
        entry.bundle = bundle;
        if (localInputCache.get(key) === entry) trimLocalInputs(key, estimateStoredBytes(bundle));
        return bundle;
      }).catch(function forget(error) {
        if (localInputCache.get(key) === entry) localInputCache.delete(key);
        throw error;
      });
    }
    rememberLocalInputs(key, entry);
    return new Promise(function subscribe(resolve, reject) {
      let finished = false;
      function cleanup() {
        finished = true;
        entry.listeners.delete(progress);
        if (signal) signal.removeEventListener('abort', abort);
      }
      function progress(done, total) { if (!finished && onProgress) onProgress(done, total); }
      function abort() {
        cleanup();
        reject(new DOMException("Canceled.", "AbortError"));
        if (!entry.settled && !entry.listeners.size) {
          if (localInputCache.get(key) === entry) localInputCache.delete(key);
          entry.controller.abort();
        }
      }
      entry.listeners.add(progress);
      if (signal) signal.addEventListener('abort', abort, {once:true});
      if (entry.settled) progress(-1, entry.total);
      else if (entry.progress) progress(...entry.progress);
      else progress(-3, 0);
      entry.promise.then(bundle => { if (!finished) { cleanup(); resolve(bundle); } },
        error => { if (!finished) { cleanup(); reject(error); } });
    });
  }

  // Rebuild full records from a compact page: each row carries its own identity and
  // geometry plus an index into the page's shared annotation table.
  function expandCompactPage(page) {
    const columns = page.row_columns || [];
    const annotations = page.annotations || [];
    const rows = page.rows || [];
    const annotationAt = columns.indexOf("annotation");
    const expanded = new Array(rows.length);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const record = {};
      for (let column = 0; column < columns.length; column += 1) {
        if (column === annotationAt) continue;
        record[columns[column]] = row[column];
      }
      const shared = annotations[row[annotationAt]];
      if (!shared) throw new Error((/*@copy mimicryone-runtime.compact-input-page-references-a.b724c77*/`Compact input page references a missing annotation.`/*@endcopy*/));
      for (const name in shared) if (Object.prototype.hasOwnProperty.call(shared, name)) record[name] = shared[name];
      expanded[index] = record;
    }
    return expanded;
  }

  async function downloadLocalInputs(options, onProgress, signal) {
    const params = new URLSearchParams({
      library: options.library,
      floor: String(options.floor),
      population_only: "true",
      filters: JSON.stringify(options.filters || {}),
      // Hydrated records are the default: the player, tracks, tables and exports read
      // the same annotation fields (display_accession, display_gene, protein_name,
      // organism, description) that the stored 7/9 route already supplies. Requesting
      // "lean" here would strip those and fall the viewer back to raw catalog ids.
      fields: options.fields === "lean" ? "lean" : "full",
      limit: String(options.pageLimit || 2000),
      // Compact pages carry the same hydrated values but send each shared annotation
      // once instead of once per tile: ~10x less memory on assay libraries.
      shape: "compact",
    });
    // The caller's fingerprint may belong to a different component of a composite
    // runtime, so the release is learned from the first page and then pinned; the
    // server still rejects a release that changes mid-download.
    if (options.component) params.set("component", options.component);
    const records = [];
    const seen = new Set();
    let cursor = null;
    let scopeHash = null;
    let manifest = null;
    let queryRecord = null;
    do {
      if (signal && signal.aborted) throw new Error((/*@copy mimicryone-runtime.canceled.cb3705c*/`Canceled.`/*@endcopy*/));
      if (cursor != null) params.set("after_id", String(cursor));
      let response = await fetch("/api/analysis/local-inputs?" + params.toString(), { signal });
      // A server predating the lean/limit transport options rejects them outright.
      // Retry once with the portable parameter set; the population is identical.
      if (response.status === 400 && params.has("fields")) {
        params.delete("fields");
        params.delete("limit");
        params.delete("shape");
        response = await fetch("/api/analysis/local-inputs?" + params.toString(), { signal });
      }
      if (!response.ok) throw new Error((/*@copy mimicryone-runtime.input-download-stopped-http-no.bae0e1f*/`Input download stopped (HTTP ${response.status}). No partial result was produced.`/*@endcopy*/));
      const page = await response.json();
      if (page.schema !== LOCAL_INPUTS_SCHEMA) throw new Error((/*@copy mimicryone-runtime.unexpected-local-input-schema.f82fb9f*/`Unexpected local-input schema.`/*@endcopy*/));
      if (!page.manifest || page.manifest.mode !== "full_selected_library") {
        throw new Error((/*@copy mimicryone-runtime.the-input-endpoint-returned-a.5b580ff*/`The input endpoint returned a candidate shortlist, not the complete selected population. A complete lower-threshold result requires the full population.`/*@endcopy*/));
      }
      if (scopeHash && scopeHash !== page.scope_hash) throw new Error((/*@copy mimicryone-runtime.the-input-scope-changed-while.bf60c1b*/`The input scope changed while downloading. Restart the request.`/*@endcopy*/));
      scopeHash = page.scope_hash;
      manifest = page.manifest;
      if (!queryRecord && page.query_records && page.query_records.length) queryRecord = page.query_records[0];
      const catalog = page.shape === "compact" ? expandCompactPage(page) : (page.source_catalog || []);
      for (let index = 0; index < catalog.length; index += 1) {
        const record = catalog[index];
        if (seen.has(record.antigen_id)) throw new Error((/*@copy mimicryone-runtime.duplicate-record-in-the-input.feafa30*/`Duplicate record in the input population download.`/*@endcopy*/));
        seen.add(record.antigen_id);
        records.push(localInputRow(record));
      }
      if (page.next_after_id != null && Number(page.next_after_id) <= Number(cursor || 0)) {
        throw new Error((/*@copy mimicryone-runtime.input-pagination-did-not-advance.be822be*/`Input pagination did not advance.`/*@endcopy*/));
      }
      // Pin the release only after the first page has declared it, so a composite
      // runtime's per-component fingerprint cannot reject the request up front.
      if (page.release_fingerprint) params.set("release", page.release_fingerprint);
      cursor = page.next_after_id;
      if (onProgress) onProgress(records.length, Number(manifest.download_records) || 0);
    } while (cursor != null);
    if (records.length !== Number(manifest.download_records)) {
      throw new Error((/*@copy mimicryone-runtime.the-input-population-download-is.f50d92a*/`The input population download is incomplete; no partial result was produced.`/*@endcopy*/));
    }
    // queryRecord is deliberately dropped: this bundle is cached by library and scope, which
    // several targets share, so anything target-specific in it becomes the next target's answer.
    // The scan fetches the record it is actually about.
    return { records: records, manifest: manifest, scopeHash: scopeHash, queryRecord: null };
  }

  async function runLocalLibraryScan(options) {
    const floor = Number(options.floor);
    if (!(floor >= 5 && floor <= 9)) throw new Error((/*@copy mimicryone-runtime.unsupported-threshold-for-a-browser.a633781*/`Unsupported threshold for a browser-local run.`/*@endcopy*/));
    const runStarted = performance.now();
    const timing = {};
    const signal = options.signal;
    const report = typeof options.onStatus === "function" ? options.onStatus : function noop() {};
    let abortHook = null;
    if (signal) {
      abortHook = function onAbort() { terminateRun("Canceled."); };
      signal.addEventListener("abort", abortHook);
    }
    try {
      // A caller may supply the parent population itself - the user's own FASTA. Nothing is
      // downloaded and nothing is uploaded: the rows are already in this browser, so the
      // manifest describes that local input instead of a release-bound download. Everything
      // after this point is identical for a supplied and a downloaded population, which is
      // what makes "our library" and "their library" one route rather than two.
      const supplied = Array.isArray(options.rows) ? options.rows : null;
      report(supplied
        ? "Preparing your own parent sequences for a browser-local " + floor + "/9 run…"
        : "Preparing release-bound inputs for a browser-local " + floor + "/9 run…");
      let bundle = supplied ? {
        records: supplied,
        queryRecord: null,
        scopeHash: options.rowsScopeHash || null,
        manifest: {
          mode: "full_selected_library",
          source: "user_supplied_fasta",
          release_fingerprint: null,
          library: options.library,
          identity_policy: "user supplied; no catalog identity was resolved",
          self_policy: "none; a supplied population is not de-duplicated against the query",
          population_records: supplied.length,
          eligible_records: supplied.filter(function eligible(row) { return row.length >= K; }).length,
        },
      } : await cachedLocalInputs(options, function progress(done, total) {
        report(done === -1
          ? "Reusing the cached input package for this scope · no re-download needed."
          : done === -3
            ? "Waiting for an input download already running for this scope · Cancel is safe."
            : done === -4
              ? "Fetching the prepared package for this release · Cancel is safe."
              : done === -5
                ? "Unpacking the prepared package" +
                  (total ? " · " + (total / (1024 * 1024)).toFixed(0) + " MB compressed" : "") +
                  " · the largest libraries take a moment here."
                : done === -6
                  ? (/*@copy mimicryone-runtime.input-records-prepared*/`Loading records in this browser · ${nf(total)} ready · Cancel is safe.`/*@endcopy*/)
                : done === -2
                  ? "Reading the prepared " + nf(total) + "-record package for this release…"
                  : "Downloading inputs · " + nf(done) + (total ? " / " + nf(total) : "") +
                    " records · no prepared package for this scope · Cancel is safe.");
      }, signal);
      // A canceled request must not adopt a completed shared download.
      if (signal && signal.aborted) throw new Error((/*@copy mimicryone-runtime.canceled.3d2e54b*/`Canceled.`/*@endcopy*/));
      // The query record is fetched for THIS request and never read off the bundle.
      //
      // The bundle is the parent population, which is genuinely shared: it is keyed by library,
      // scope, component and release, and two different targets compared against the same
      // library get the same one, which is the point of caching it. The query record is not
      // shared - it is the one record being compared - but it was being carried inside that
      // bundle and taken from it here. So the second target to use a library inherited the
      // first target's sequence: HEPACAM scanned at 5/9 after IL10 reported IL10's length, IL10's
      // windows and IL10's 1,683 matches under HEPACAM's name, in the figures and in the export.
      // Nothing was wrong with the data; the run was answering about the wrong protein.
      timing.inputs_ms = performance.now() - runStarted;
      if (bundle.timings) timing.package = bundle.timings;
      const queryStarted = performance.now();
      const fetched = options.queryId && !options.queryRow ? await fetchQueryRecord(options) : null;
      if (options.queryId && !options.queryRow && !fetched) {
        throw new Error((/*@copy mimicryone-runtime.the-selected-target-record-could.884c942*/`The selected target record could not be read from this release.`/*@endcopy*/));
      }
      const queryRow = options.queryRow || (fetched ? localInputRow(fetched) : null);
      // Belt and braces: whatever supplied it must be the record that was asked for.
      if (options.queryId && queryRow && Number(queryRow.antigen_id) !== Number(options.queryId)) {
        throw new Error((/*@copy mimicryone-runtime.the-input-endpoint-returned-a.f4aa379*/`The input endpoint returned a different record than the one selected.`/*@endcopy*/));
      }
      if (!queryRow || !queryRow.sequence) throw new Error((/*@copy mimicryone-runtime.the-selected-target-sequence-was.444b922*/`The selected target sequence was not supplied by the input endpoint.`/*@endcopy*/));
      if (!supplied && options.queryId && options.queryLibrary === options.library) {
        const self = bundle.records.find(row => Number(row.antigen_id) === Number(options.queryId));
        if (self) bundle = Object.assign({}, bundle, {manifest:Object.assign({}, bundle.manifest, {
          population_records:bundle.manifest.population_records-1,
          population_windows:Math.max(0, (bundle.manifest.population_windows||0)-Math.max(0,self.length-8)),
          eligible_records:bundle.manifest.eligible_records-(self.length>=K?1:0),
          download_records:bundle.records.length-1
        })});
      }
      timing.query_ms = performance.now() - queryStarted;
      const rows = bundle.records.filter(function eligible(row) {
        return row.length >= K && !(options.queryId && options.queryLibrary === options.library && Number(row.antigen_id) === Number(options.queryId));
      });
      const targetSet = {
        scope: options.library,
        pack: {
          schema: LOCAL_INPUTS_SCHEMA,
          generated_utc: new Date().toISOString(),
          window_count: rows.reduce(function total(sum, row) { return sum + Math.max(0, row.length - K + 1); }, 0),
        },
        rows: rows,
      };
      const queryWindows = Math.max(0, queryRow.length - K + 1);
      report((queryRow.gene || queryRow.protein_id) + " · browser-local " + floor + "/9 · " +
        formatWork(queryWindows, targetSet.pack.window_count) + " across " + nf(rows.length) +
        " eligible records. This can take substantial time; Cancel is safe.");
      const scanStarted = performance.now();
      const scanPromise = rows.length
        ? scanOneQuery(queryRow, rows, floor, function progress(fraction) {
            report("Computing " + floor + "/9 in this browser · " + Math.round(fraction * 100) + "% · Cancel is safe.");
          }, timing)
        : Promise.resolve([]);
      timing.scan_dispatch_ms = performance.now() - scanStarted;
      const summaries = await scanPromise;
      if (signal && signal.aborted) throw new Error((/*@copy mimicryone-runtime.canceled.496755b*/`Canceled.`/*@endcopy*/));
      timing.scan_ms = performance.now() - scanStarted;
      const buildStarted = performance.now();
      const result = customResult(queryRow, targetSet, summaries, floor);
      // The complete selected population was downloaded and every window pair was
      // evaluated in this browser, so the result carries full positional detail and
      // is eligible for the figure and complete-export paths.
      result.complete_in_memory = true;
      result.origin = "local_library";
      result.result_id = "local:" + options.library + ":" + queryRow.protein_id + ":m" + floor;
      result.protein.library_id = queryRow.library_id;
      result.protein.organism = queryRow.organism;
      result.inputs = result.inputs || {};
      result.inputs.query_catalogue = {
        source_id: queryRow.protein_id,
        antigen_id: queryRow.antigen_id,
        library_id: queryRow.library_id,
        sequence: queryRow.sequence,
      };
      result.inputs.local_inputs_manifest = bundle.manifest;
      result.inputs.local_inputs_scope_hash = bundle.scopeHash;
      delete result.inputs.query_fasta;
      // customResult reads the query textarea live, which is wrong for anything replayed: a
      // floor switch or a History reopen happens long after that field may have changed. Use
      // the text the request froze, exactly as the server path does.
      if (typeof options.queryFasta === "string") {
        result.inputs.original_query_fasta = options.queryFasta;
      }
      if (supplied) {
        // A downloaded population is reproducible from (library, release); a supplied one is
        // not, so the bundle has to carry the sequences it actually ran against. They are
        // already in this browser, so recording them costs nothing and transmits nothing.
        result.inputs.original_parent_fasta = options.rowsFasta || null;
        result.provenance.parent_population =
          "supplied by the reader in this browser; never transmitted to the server";
      }
      result.provenance = result.provenance || {};
      result.provenance.execution = "browser-local on-demand scan";
      result.provenance.release_fingerprint = bundle.manifest.release_fingerprint;
      result.provenance.input_scope_hash = bundle.scopeHash;
      result.provenance.identity_policy = bundle.manifest.identity_policy;
      result.provenance.self_policy = bundle.manifest.self_policy;
      result.provenance.population_records = bundle.manifest.population_records;
      result.provenance.eligible_records = bundle.manifest.eligible_records;
      result.provenance.evaluated_records = rows.length;
      result.provenance.completeness = "complete";
      timing.prepare_result_ms = performance.now() - buildStarted;
      timing.total_ms = performance.now() - runStarted;
      return { result: result, rows: rows, manifest: bundle.manifest, scopeHash: bundle.scopeHash, timings: timing };
    } finally {
      if (signal && abortHook) signal.removeEventListener("abort", abortHook);
    }
  }

  async function runCustom() {
    if (customRunSession) return;
    const viewRequest = viewIntentRevision;
    const requestToken = ++loadSeq;
    const cancelButton = document.getElementById("cancelFasta");
    const controls = [...document.querySelectorAll("#runFasta,#clearFasta,#fasta,#mimicfa,#fastaFile,#mimicFile,#clearTarget,#clearMimic,#customFloor,#entryCustomTarget,#entryCustomExecution button")];
    const session = {requestToken, cancelButton, controls:controls.map(node => ({node, disabled:node.disabled}))};
    customRunSession = session;
    controls.forEach(node => { node.disabled = true; });
    cancelButton.hidden = false;
    const floor = currentCustomFloor();
    try {
      const validation = window.MimicryOneFastaValidation;
      if (validation) {
        const checked = await validation.validateRequired("custom");
        if (customRunSession !== session || requestToken !== loadSeq) return;
        if (!checked.ok) { note(document.getElementById("mimicnote"), checked.error, true); return; }
      }
      const queryParsed = window.MimicryFastaInput.firstTarget(document.getElementById("fasta").value);
      if (queryParsed.errors.length || !queryParsed.records.length) {
        note(document.getElementById("mimicnote"), queryParsed.errors[0] || (/*@copy mimicryone-runtime.no-antigen-target-input*/`No target sequence was supplied.`/*@endcopy*/), true);
        return;
      }
      const targetSet = await customTargetSet();
      if (requestToken !== loadSeq) return;
      if (!targetSet.rows.length) throw new Error((/*@copy mimicryone-runtime.the-selected-mimicry-parent-set.1f43e23*/`The selected mimicry parent set contains no sequences of at least 9 residues.`/*@endcopy*/));
      const totalQueryWindows = queryParsed.records.reduce(function queryWindows(total, row) { return total + row.length - K + 1; }, 0);
      const totalTargetWindows = targetSet.rows.reduce(function targetWindows(total, row) { return total + row.length - K + 1; }, 0);
      if (!await confirmLocalWork(session, totalQueryWindows, totalTargetWindows)) return;
      if (customRunSession !== session || requestToken !== loadSeq) return;
      note(document.getElementById("mimicnote"), (/*@copy mimicryone-runtime.custom-comparison-progress*/`${queryParsed.records.length} target${queryParsed.records.length === 1 ? "" : "s"} · ${targetSet.rows.length} parent record${targetSet.rows.length === 1 ? "" : "s"} · ${formatWork(totalQueryWindows, totalTargetWindows)}. Running on this device.`/*@endcopy*/));

      const completed = [];
      for (let queryIndex = 0; queryIndex < queryParsed.records.length; queryIndex += 1) {
        const query = queryParsed.records[queryIndex];
        const summaries = await scanOneQuery(query, targetSet.rows, floor, function update(fraction) {
          if (customRunSession !== session || requestToken !== loadSeq) return;
          const overall = (queryIndex + fraction) / queryParsed.records.length;
          note(document.getElementById("mimicnote"), `Scanning ${query.id} · ${Math.round(overall * 100)}% of this local run · Cancel is safe.`);
        });
        if (requestToken !== loadSeq) return;
        const result = customResult(query, targetSet, summaries, floor);
        completed.push(result);
        customResults.push(result);
      }
      if (requestToken !== loadSeq) return;
      openRuntimeResult(completed[0], targetSet.rows, completionView(viewRequest, "explorer"));
      note(document.getElementById("mimicnote"), (/*@copy mimicryone-runtime.custom-comparison-complete*/`${completed.length} target${completed.length === 1 ? "" : "s"} complete · ${completed.reduce(function matches(total, result) { return total + result.positional_matches.reduce(function pairs(subtotal, source) { return subtotal + source.hits.length; }, 0); }, 0).toLocaleString()} window pairs retained locally.`/*@endcopy*/));
    } catch (error) {
      if (customRunSession === session && requestToken === loadSeq)
        note(document.getElementById("mimicnote"), error.message || "The local scan stopped.", true);
    } finally {
      finishCustomRun(session);
    }
  }

  function rankRowsAtFloor(result, floor) {
    const metrics=parentResidueRows(result,floor);
    const sources=new Map(result.source_catalog.map(r=>[Number(r.protein_idx),r]));
    const values=row=>{const r=metrics.get(Number(row.protein_index)),p=sources.get(Number(row.protein_index))||{};
      return {id:row.protein_id,label:p.identity?.primaryLine||p.protein_name||p.gene||p.protein_id,target:r?.target.percent,parent:r?.parent.percent,core:r?.bestCoreIdentity,context:r?.bestContextIdentity};};
    const ordered = result.ranked_matches.filter(function include(row) {
      const stats = row.floors[`m${floor}`];
      if (!stats || stats.unavailable || stats.pairs <= 0) return false;
      return true;
    }).map(row=>({row,sortValues:values(row)})).sort(function ranked(a, b) {
      return window.MimicryRanking.parent(a.sortValues,b.sortValues,window.MimicryRanking.selection);
    }).map(item=>item.row);
    return window.MimicryMapViewer?.hooks.orderOverall?.(ordered,result,floor)||ordered;
  }

  const residueCoverageCache=new WeakMap();
  function parentResidueRows(result,floor) {
    let residueFloors=residueCoverageCache.get(result);
    if(!residueFloors){residueFloors=new Map();residueCoverageCache.set(result,residueFloors);}
    if(!residueFloors.has(floor)){
      const summaries=new Map(window.MimicryResidueCoverage.summarize(result,floor).parents.map(p=>[p.proteinIndex,p]));
      const sources=new Map(result.source_catalog.map(p=>[Number(p.protein_idx),p]));
      for(const row of result.positional_matches){
        let best=null,bestCore=null;
        for(const hit of row.hits)if(hit[2]>=floor){
          bestCore=Math.max(bestCore??0,hit[2]);
          const score=window.MimicryExportCore.contextIdentityAt(result.protein.sequence,sources.get(Number(row.protein_idx))?.sequence,hit[0],hit[1]);
          if(score!=null)best=Math.max(best??0,score);
        }
        const summary=summaries.get(Number(row.protein_idx));
        if(summary){summary.bestContextIdentity=best;summary.bestCoreIdentity=bestCore;}
      }
      residueFloors.set(floor,summaries);
    }
    return residueFloors.get(floor);
  }
  if(window.MimicryMapViewer)window.MimicryMapViewer.hooks.refreshOverall=reset=>{if(reset)state.rankPage=0;renderCompleteRankTable();};
  if(window.MimicryMapViewer)window.MimicryMapViewer.hooks.resizeOverall=(size,previous)=>{
    state.rankPage=Math.floor(state.rankPage*previous/size);PAGE_SIZE=size;
    buildMatchBox();
  };
  function renderCompleteRankTable() {
    const host = document.getElementById("ematches");
    if (!host || !T || !T.result) return;
    const result = T.result;
    const residueRows=parentResidueRows(result,TH);
    const entityLabel = result.parameters.source_entity_label || "records";
    const all = rankRowsAtFloor(result, TH);
    host.dataset.totalRows = all.length;
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.rankPage = Math.min(state.rankPage, pages - 1);
    const start = state.rankPage * PAGE_SIZE;
    const shown = all.slice(start, start + PAGE_SIZE);
    const mixedLibraries = window.MimicryOneIdentity.mixedLibraries(result.source_catalog || all);
    const sort=window.MimicryRanking.selection;
    document.getElementById('ersub').innerHTML=[['protein',(/*@copy mimicryone-runtime.protein.f484089*/`Mimicry Parent`/*@endcopy*/),'enm'],['target',(/*@copy mimicryone-runtime.target.02b6624*/`Target %`/*@endcopy*/),'rank-cov'],['parent',(/*@copy mimicryone-runtime.parent.fe290c2*/`Parent %`/*@endcopy*/),'rank-cov'],['core',(/*@copy mimicryone-runtime.best-core.c3950ee*/`Best Core`/*@endcopy*/),'enum w-q'],['context',(/*@copy mimicryone-runtime.best-context.2e8a23c*/`Best Context`/*@endcopy*/),'enum w-q']].map(([key,label,css])=>
      '<button type="button" class="parent-sort '+css+'" data-parent-sort="'+key+'" aria-label="Sort by '+label+'" aria-pressed="'+(sort.parent===key)+'" data-tooltip="'+html(window.MimicryRanking.describe({...sort,parent:key}).parent_rules)+(key==='core'||key==='context'?'; Best Core and Best Context are separate maxima and may occur at different sites.':'')+'">'+label+(sort.parent===key?(sort.direction==='asc'?' ↑':' ↓'):'')+'</button>').join('<span class="ediv" aria-hidden="true"></span>');
    document.querySelectorAll('#ersub [data-parent-sort]').forEach(button=>button.addEventListener('click',()=>{
      window.MimicryMapViewer?.hooks.nativeSort?.();
      const key=button.dataset.parentSort;
      window.setResultRanking({parent:key,direction:sort.parent===key?(sort.direction==='desc'?'asc':'desc'):(key==='protein'?'asc':'desc')});
    }));
    const controls = '<div class="rank-controls">' +
      `<span class="rank-count" data-tooltip="${html(nf(all.length)+' '+entityLabel+' · '+window.MimicryRanking.describe(sort).parent+'. '+window.MimicryRanking.describe(sort).parent_rules)}">${window.seromapDesktop ? `${shown.length?nf(start+1):0}–${nf(start+shown.length)} of ${nf(all.length)}` : `${nf(all.length)} ${/exact.*sequence.*group/i.test(entityLabel)?'Matching Exact-Sequence Groups':'Matching Records'}`} · ${html({target:'Target %',parent:'Parent %',core:'Best Core',context:'Best Context',protein:window.MimicryRanking.parentLabels.protein}[sort.parent])} ${sort.direction==='asc'?'↑':'↓'}</span>` +
      `<button type="button" id="rankPrev" ${state.rankPage === 0 ? "disabled" : ""}>Previous</button>` +
      `<span>Page ${state.rankPage + 1} of ${pages}</span>` +
      `<button type="button" id="rankNext" ${state.rankPage + 1 >= pages ? "disabled" : ""}>Next</button>` +
      "</div>";
    const body = shown.map(function rankedRow(row) {
      const residues=residueRows.get(Number(row.protein_index));
      const coverage = residues?.target.percent;
      const parentCoverage=residues?.parent.percent;
      const identity = identityFor({...row, ...result.source_catalog_by_index.get(row.protein_index)}, {
        activeLibrary: result.parameters.source_scope,
        activeContext: result.parameters.source_scope_label,
        mixedLibraries,
      });
      return '<div class="erow complete-row" data-protein="' + html(row.protein_id) + '" data-display="' + html(identity.primaryLine) + '" data-tooltip="' + html(identity.tooltip) + '" data-tooltip-mono="true">' +
        '<span class="enm identity-cell">' + identityCellHtml(identity) + "</span> " +
        '<span class="ediv" aria-hidden="true"></span> <span class="ecol"><span class="ebar" aria-hidden="true"><i style="width:' + (coverage==null?0:coverage).toFixed(1) + '%"></i></span><span class="epct">' + (coverage==null?'—':coverage.toFixed(1)) + '</span></span> ' +
        '<span class="ediv" aria-hidden="true"></span> <span class="ecol"><span class="ebar" aria-hidden="true"><i style="width:' + (parentCoverage==null?0:parentCoverage).toFixed(1) + '%"></i></span><span class="epct">' + (parentCoverage==null?'—':parentCoverage.toFixed(1)) + '</span></span> ' +
        '<span class="ediv" aria-hidden="true"></span> <span class="enum w-q" style="color:var(--lj33)">' + (residues?.bestCoreIdentity==null?'—':residues.bestCoreIdentity+'/9') + '</span>' +
        '<span class="ediv" aria-hidden="true"></span> <span class="enum w-q" style="color:var(--lj33)">' + (residues?.bestContextIdentity==null?'—':residues.bestContextIdentity+'/27') + '</span></div>';
    }).join("");
    host.innerHTML = body + controls;
    window.MimicryMapViewer?.hooks.decorateTable?.("overall",shown);
    document.getElementById("ermeta").textContent = (/*@copy mimicryone-runtime.records-at.8438b33*/`${nf(all.length)} ${/exact.*sequence.*group/i.test(entityLabel)?'Matching Exact-Sequence Groups':'Matching Records'} at ≥${TH}/9 · ${scopeLabel(result.parameters.source_scope)}`/*@endcopy*/);
    document.getElementById("ermeta").dataset.tooltip = (/*@copy mimicryone-runtime.bearing-a-hit-at-complete.196d2a1*/`${nf(all.length)} ${entityLabel} bearing a hit at ≥${TH}/9. Complete result; pagination does not change this total.`/*@endcopy*/);
    document.getElementById("rankPrev").addEventListener("click", function previous() {
      state.rankPage -= 1;
      renderCompleteRankTable();
    });
    document.getElementById("rankNext").addEventListener("click", function next() {
      state.rankPage += 1;
      renderCompleteRankTable();
    });
    host.querySelectorAll(".complete-row").forEach(function selectable(rowNode) {
      const selected = rowNode.getAttribute("data-protein") === state.sciencePairId;
      rowNode.classList.toggle("science-selected", selected);
      rowNode.setAttribute("tabindex", "0");
      rowNode.setAttribute("role", "button");
      rowNode.setAttribute("aria-label", (/*@copy mimicryone-runtime.inspect.eb8e002*/`Inspect ${rowNode.getAttribute("data-display") || rowNode.getAttribute("data-protein")}. ${rowNode.getAttribute("data-tooltip") || ""}`/*@endcopy*/));
      function selectPair() {
        state.sciencePairId = rowNode.getAttribute("data-protein");
        renderCompleteRankTable();
      }
      rowNode.addEventListener("click", selectPair);
      rowNode.addEventListener("keydown", function keySelect(event) {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectPair(); }
      });
    });
  }

  /* Compatibility exporters below use hash-prefixed provenance lines.
     Current client CSVs use reproduce/export-core.js and ordinary column headers;
     this preamble is not the current public CSV contract. */
  function provenanceLines(schema, result, extra, floor) {
    const protein = (result && result.protein) || {};
    const parameters = (result && result.parameters) || {};
    const exportFloor = Number.isInteger(Number(floor)) ? Number(floor) : Number(parameters.floor);
    const lines = [
      "MimicryMap export",
      "schema: " + schema,
      "generated_utc: " + new Date().toISOString(),
      "query: " + (protein.protein_id || "?") + (protein.gene ? " (" + protein.gene + ")" : "")
        + (protein.length ? ", " + protein.length + " AA" : ""),
      "source_scope: " + (parameters.source_scope || "?"),
      "identity_floor: " + exportFloor + " of " + K,
      "window: " + K + " residues; coordinates are 1-based with inclusive ends",
      "identity: positions carrying the same residue. X never counts as identical, "
        + "including X against X",
      "result_origin: " + ((result && result.origin) || "?"),
      "statistics_status: descriptive_only. No p-value or q-value is computed for any match.",
    ];
    (extra || []).forEach(function add(line) { lines.push(line); });
    return lines.map(function hash(line) { return "# " + line; });
  }

  /* BOM plus CRLF so the file opens correctly in Excel without mangling UTF-8. */
  function csvDocument(headerLines, rows) {
    return "\ufeff" + headerLines.concat(rows).join("\r\n") + "\r\n";
  }

  function exportMatchesCsv(result, floor) {
    const exportFloor = Number(floor);
    const queryIdentity = result.protein.identity || identityFor(result.protein);
    const rows = [[
      "query_id", "query_seqid", "query_header", "query_start", "query_9mer",
      "source_id", "source_seqid", "source_header", "source_gene", "source_library",
      "source_start", "source_9mer", "identity", "similarity_floor", "source_scope",
    ].concat(identityExportHeaders("query_"), identityExportHeaders("source_"), [
      "source_projection_provenance",
    ])];
    result.positional_matches.forEach(function sourceRows(source) {
      const metadata = result.source_catalog_by_index.get(source.protein_idx) || {};
      const sourceIdentity = metadata.identity || identityFor(metadata);
      source.hits.forEach(function match(hit) {
        if (hit[2] < exportFloor) return;
        rows.push([
          result.protein.protein_id,
          result.protein.seqid || result.protein.header || result.protein.protein_id,
          result.protein.header || result.protein.raw_header || result.protein.name || result.protein.protein_id,
          hit[0],
          result.protein.sequence.slice(hit[0] - 1, hit[0] - 1 + K),
          source.protein_id,
          metadata.seqid || metadata.raw_header || source.protein_id,
          metadata.header || metadata.raw_header || metadata.name || source.protein_id,
          metadata.gene || source.protein_id,
          metadata.library_id || "unknown",
          hit[1],
          hit[3],
          hit[2],
          exportFloor,
          result.parameters.source_scope,
        ].concat(identityExportValues(queryIdentity), identityExportValues(sourceIdentity), [
          source.projection_provenance ? JSON.stringify(source.projection_provenance) : "",
        ]));
      });
    });
    const body = rows.map(function csvRow(row) { return row.map(csv).join(","); });
    return csvDocument(provenanceLines("mimicryone/export/positional-matches/2", result, [
      "one row per aligned window pair. Overlapping windows are listed separately, so a run "
        + "of length R yields R - 8 rows, not one.",
      "rows: " + (body.length - 1) + " (complete, no cap is applied)",
    ], exportFloor), body);
  }

  function finishCustomRun(session) {
    if (customRunSession !== session) return;
    if (session.cancelPrompt) session.cancelPrompt();
    customRunSession = null;
    session.controls.forEach(({node, disabled}) => { node.disabled = disabled; });
    session.cancelButton.hidden = true;
  }

  function confirmLocalWork(session, queryWindows, parentWindows) {
    // Resource warning only: this does not cap work or change matching thresholds.
    if (queryWindows * parentWindows <= 100000000) return Promise.resolve(true);
    if (customRunSession !== session) return Promise.resolve(false);
    const runButton = document.getElementById("runFasta");
    note(document.getElementById("mimicnote"),
      `This comparison spans ${formatWork(queryWindows, parentWindows)} and may use substantial time and memory. Continue locally or Cancel. No sequences are uploaded by the local scanner.`);
    return new Promise(resolve => {
      function finish(accepted) {
        runButton.removeEventListener("click", proceed, true);
        session.cancelPrompt = null;
        runButton.textContent = (/*@copy mimicryone-runtime.run-analysis.8778e7d*/`Run analysis`/*@endcopy*/);
        runButton.disabled = true;
        resolve(accepted);
      }
      function proceed(event) {
        event.preventDefault(); event.stopImmediatePropagation();
        finish(customRunSession === session);
      }
      session.cancelPrompt = () => finish(false);
      runButton.textContent = (/*@copy mimicryone-runtime.continue-locally.afb7421*/`Continue locally`/*@endcopy*/);
      runButton.disabled = false;
      runButton.addEventListener("click", proceed, true);
    });
  }

  function cancelCustomRun(message) {
    const session = customRunSession;
    if (!session) return false;
    if (loadSeq === session.requestToken) loadSeq += 1;
    terminateRun(message || "Canceled.");
    finishCustomRun(session);
    return true;
  }

  function exportRankedCsv(result, floor) {
    const exportFloor = Number(floor);
    const queryIdentity = result.protein.identity || identityFor(result.protein);
    const rows = [[
      "query_id", "query_seqid", "query_header", "source_id", "source_seqid",
      "source_header", "source_gene", "source_library", "organism", "best_identity",
      "target_windows", "source_windows", "matched_pairs", "target_loci", "source_loci",
      "similarity_floor", "source_scope", "statistics_status",
    ].concat(identityExportHeaders("query_"), identityExportHeaders("source_"), [
      "source_projection_provenance",
    ])];
    rankRowsAtFloor(result, exportFloor).forEach(function rankedRow(row) {
      const stats = row.floors[`m${exportFloor}`];
      const sourceIdentity = row.identity || identityFor(row);
      rows.push([
        result.protein.protein_id,
        result.protein.seqid || result.protein.header || result.protein.protein_id,
        result.protein.header || result.protein.raw_header || result.protein.name || result.protein.protein_id,
        row.protein_id,
        row.seqid || row.raw_header || row.protein_id,
        row.header || row.raw_header || row.name || row.protein_id,
        row.gene,
        row.library_id,
        row.organism,
        row.best_identity,
        stats.target_windows,
        stats.source_windows,
        stats.pairs,
        stats.target_loci,
        stats.source_loci,
        exportFloor,
        result.parameters.source_scope,
        "descriptive_only",
      ].concat(identityExportValues(queryIdentity), identityExportValues(sourceIdentity), [
        row.projection_provenance ? JSON.stringify(row.projection_provenance) : "",
      ]));
    });
    const body = rows.map(function csvRow(row) { return row.map(csv).join(","); });
    return csvDocument(provenanceLines("mimicryone/export/ranked-matches/2", result, [
      "one row per source protein reaching the floor, ranked by best_identity then "
        + "target_windows then matched_pairs.",
      "target_windows and source_windows are DEDUPLICATED window counts; matched_pairs is the "
        + "raw pair count and is inflation-prone on repeats. They are different quantities.",
      "target_loci and source_loci are COUNTS of merged adjacent runs. Residue spans are not "
        + "stored.",
      "rows: " + (body.length - 1) + " (complete, no cap is applied)",
    ], exportFloor), body);
  }

  function serializableResult(result, viewState) {
    const copy = Object.assign({}, result);
    delete copy.source_catalog_by_index;
    if (viewState) {
      copy.view_state = Object.assign({}, viewState, {
        active_tracks: Array.isArray(viewState.active_tracks) ? viewState.active_tracks.slice() : [],
      });
    }
    return copy;
  }

  async function completeResultFor(result, floor, requestedScope, signal) {
    if (!result) return result;
    let complete = result.export_details_deferred
      ? await window.MimicryOneAnalysisPlayer.complete(result, { signal: signal }) : result;
    if (result.presentation_only) {
      note(loadnote, `Loading the complete ${result.protein.gene || result.protein.protein_id} result for export...`);
      const adapted = await buildBakedResult(result.protein.protein_id, requestedScope, floor);
      complete = adapted.result;
    }
    const originalParameters = result.parameters || {};
    const parameters = Object.assign({}, complete.parameters || {}, {
      floor: Number(floor),
    });
    const scope = normalizedResultScope(requestedScope);
    if (scope) parameters.source_scope = scope;
    if (originalParameters.source_scope_label) {
      parameters.source_scope_label = originalParameters.source_scope_label;
    }
    return Object.assign({}, complete, { parameters: parameters });
  }

  async function openCompleteExplorer(accession, requestedView) {
    const viewRequest = viewIntentRevision;
    const requestToken = loadSeq;
    const activeResult = T && T.result;
    const requestedScope = normalizedResultScope(activeResult && activeResult.parameters && activeResult.parameters.source_scope);
    const requestedFloor = Number(TH);
    note(loadnote, `Loading the complete ${accession} positional result for Explorer...`);
    try {
      const adapted = await buildBakedResult(accession, requestedScope, requestedFloor);
      if (requestToken !== loadSeq || !T || T.acc !== accession || T.result !== activeResult || Number(TH) !== requestedFloor) return;
      const completedResult = Object.assign({}, adapted.result, {
        parameters: Object.assign({}, adapted.result.parameters, {
          floor: requestedFloor,
          source_scope: requestedScope || adapted.result.parameters.source_scope,
        }),
      });
      openRuntimeResult(completedResult, adapted.sequenceRows, completionView(viewRequest, requestedView || "explorer"));
      note(loadnote, `${adapted.result.protein.gene || accession} complete result loaded.`);
    } catch (error) {
      if (requestToken !== loadSeq || !T || T.acc !== accession || T.result !== activeResult || Number(TH) !== requestedFloor) return;
      note(loadnote, `The complete result could not be loaded (${error.message}).`, true);
    }
  }

  function currentFigureViewState() {
    const tracks = typeof activeTracks === "function" ? activeTracks() : [];
    return Object.freeze({
      selected_start: Math.floor(Number(scan) || 0) + 1,
      floor: Number(TH),
      mode: typeof MODE === "string" ? MODE : "",
      view: currentRuntimeView(),
      zoom: typeof ZOOM === "string" ? ZOOM : "",
      active_tracks: Object.freeze(tracks.map(track => track.key)),
      density_max: Number(maxDens) || 0,
      density_inverted: !!INVERTMAIN,
      assembly_context: DIMERCTX ? "dimer" : "monomer",
      ranking: Object.freeze(window.MimicryRanking.settings(window.MimicryRanking.selection)),
    });
  }

  function captureNavigationView() {
    return Object.assign({}, currentFigureViewState(), {
      rankPage: state.rankPage, selectedParent: state.sciencePairId,
      motifPage: motifPageIndex, paused: !!userPaused, rate: RATE,
      selectedTracks: TRACKS.filter(track => track.on).map(track => track.key),
      structureColor: S3COL, structureShape: S3SHAPE,
      structureYaw: S3yaw, structurePitch: S3pitch
    });
  }

  function restoreNavigationView(saved) {
    if (!saved || !T) return;
    setPaused(true);
    if ([5,6,7,8,9].includes(Number(saved.floor)) &&
        (!T.result || T.result.available_floors.includes(Number(saved.floor)))) {
      TH = Number(saved.floor);
      if (T.result) T.result.parameters.floor = TH;
    }
    if (saved.ranking) window.MimicryRanking.selection = window.MimicryRanking.settings(saved.ranking);
    const selectedTracks = saved.selectedTracks || saved.active_tracks;
    if (Array.isArray(selectedTracks)) TRACKS.forEach(track => { track.on = selectedTracks.includes(track.key); });
    setInvertMain(!!saved.density_inverted);
    setDimerContext(saved.assembly_context === "dimer");
    if (["site", "final"].includes(saved.mode)) MODE = saved.mode;
    if (Number(saved.rate) > 0) RATE = Number(saved.rate);
    if (["motif", "plddt", "rsasa"].includes(saved.structureColor)) { S3COL = saved.structureColor; s3ColCache = null; }
    if (["surface", "ribbon"].includes(saved.structureShape)) S3SHAPE = saved.structureShape;
    if (Number.isFinite(saved.structureYaw)) S3yaw = saved.structureYaw;
    if (Number.isFinite(saved.structurePitch)) S3pitch = saved.structurePitch;
    if (["player", "explorer", "residues"].includes(saved.view)) setView(saved.view);
    rebuild(true);
    seek(Math.max(0, Math.min(N - 1, Number(saved.selected_start || 1) - 1)));
    state.rankPage = Math.max(0, Math.floor(Number(saved.rankPage) || 0));
    state.sciencePairId = saved.selectedParent || null;
    motifPageIndex = Math.max(0, Math.floor(Number(saved.motifPage) || 0));
    buildMotifBox(Math.floor(scan));
    if (T.result) { syncFloorControls(T.result); renderCompleteRankTable(); }
    buildTrackToggles(); buildInvertToggle(); buildDimerToggle();
    document.querySelectorAll('#windowSort button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sort === window.MimicryRanking.selection.window)));
    document.querySelectorAll('#speeds button').forEach((button,index) => button.setAttribute('aria-pressed', String([.25,1,4,16][index] === RATE)));
    window.MimicryMapViewer.node('s3shape')?.querySelectorAll('button').forEach((button,index) => button.setAttribute('aria-pressed', String(['surface','ribbon'][index] === S3SHAPE)));
    buildS3Toggles(); s3Cap(); draw3d();
    setPaused(saved.paused !== false);
  }

  function captureExportSnapshot() {
    if (targetTransition) {
      note(loadnote, "Wait for the selected result to finish, or cancel before exporting.");
      return null;
    }
    const target = T;
    const result = target && target.result;
    if (!target || !result) return null;
    const floor = Number(TH);
    const viewState = currentFigureViewState();
    return Object.freeze({
      result: result,
      floor: floor,
      scope: normalizedResultScope(result.parameters && result.parameters.source_scope),
      scopeLabel: window.MimicryOneAnalysisRouting?.exportScopeLabel?.(result) ||
        result.parameters.source_scope_label || scopeLabel(result.parameters.source_scope),
      fileId: String(target.displayAccession || target.source_accession || target.acc || result.protein.protein_id),
      viewState: viewState,
      annotationOwner: target.acc,
      annotationCustom: !!target.custom,
      annotationDimer: !!DIMERCTX,
      annotationData: annCache[target.acc] === undefined ? undefined : JSON.parse(JSON.stringify(annCache[target.acc])),
    });
  }

  // Read a gradient legend's parts in live DOM order: the bold title, the label
  // immediately before the color bar, and the label immediately after it. The
  // exporter draws title / low / bar / high, so preserving this order keeps the
  // exported scale identical to the on-screen one.
  function legendRange(element) {
    const bar = element.querySelector('.ramp,.legend-scale');
    if (!bar) return null;
    const label = (element.querySelector('b') || {}).textContent || '';
    // Density wraps its endpoints and ramp in .dens-scale. Read siblings at
    // the bar's own level, not the enclosing legend group's level.
    const nodes = Array.from(bar.parentNode.childNodes);
    const barIndex = nodes.indexOf(bar);
    if (barIndex < 0) return null;
    const readable = node => node?.nodeType === 8 ? '' : String(node && node.textContent || '').replace(/\s+/g, ' ').trim();
    const title = readable({ textContent: label });
    let low = '';
    for (let index = barIndex - 1; index >= 0; index -= 1) {
      const value = readable(nodes[index]);
      if (value && value !== title) { low = value; break; }
    }
    let high = '';
    for (let index = barIndex + 1; index < nodes.length; index += 1) {
      const value = readable(nodes[index]);
      if (value) { high = value; break; }
    }
    if (!low && !high) return null;
    return { label: title, low: low, high: high };
  }

  function legendSwatchLabel(swatch) {
    if (swatch.dataset.label) return swatch.dataset.label;
    // Authored copy markers are comments between the swatch and its text.
    // Never export comment contents, including markers around translated copy.
    for (let node = swatch.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 8) continue;
      if (node.nodeType === 1 && node.matches('.legend-dot,.legend-block,.modification-symbol')) break;
      const label = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (label) return label;
    }
    return '';
  }

  async function captureAnnotationMetadata(snapshot,signal) {
    let annotations=snapshot.annotationCustom?null:snapshot.annotationData;
    if(annotations===undefined){
      const started=Date.now();
      while(annCache[snapshot.annotationOwner]===undefined){
        if(signal?.aborted)throw new DOMException('Canceled','AbortError');
        if(!T||T.acc!==snapshot.annotationOwner)throw Error('Target changed before annotation metadata finished loading. Retry the export.');
        if(Date.now()-started>30000)throw Error('Annotation metadata is still loading. Retry the export.');
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      annotations=JSON.parse(JSON.stringify(annCache[snapshot.annotationOwner]));
    }
    // Export only public track fields, independent of lane visibility.
    const retained={};
    for(const key of ['surface','surface_dimer','rsasa','rsasa_dimer','extracellular','transmembrane','intracellular','plddt','cleavage_epitope'])
      if(annotations?.[key]!=null)retained[key]=annotations[key];
    if(Array.isArray(annotations?.variants))retained.variants=annotations.variants.map(v=>Object.fromEntries(['pos','ref','alt','cat','ftid','dbsnp','disease'].filter(k=>v[k]!=null).map(k=>[k,v[k]])));
    return {schema:'mimicryone/residue-annotations/1',sequence:snapshot.result.protein.sequence,
      accession:window.MimicryOneIdentity.publicText(snapshot.fileId),
      surface_context:snapshot.annotationDimer&&retained.surface_dimer&&retained.rsasa_dimer?'dimer':'monomer',
      provenance:{kind:'stored app reference metadata; not computed from FASTA',captured_utc:new Date().toISOString(),release:snapshot.result.inputs?.analysis_scan?.release_fingerprint||null,
        variants:'UniProt/HumSAVAR and retained mapped variants',topology:'UniProt',surface_rsasa:'FreeSASA',plddt:'AlphaFold',cleavage:'pepsickle'},
      annotations:Object.keys(retained).length?retained:null};
  }

  function wireExports() {
    if (window.MimicryPublicationExports) {
      window.MimicryPublicationExports.install({
        captureCsv: captureExportSnapshot,
        annotationMetadata: captureAnnotationMetadata,
        completeCsv: async function(snapshot, signal) {
          const result = await completeResultFor(snapshot.result, snapshot.floor, snapshot.scope, signal);
          const view = {};
          for (const key of ['protein','parameters','result_id','available_floors','complete_in_memory',
            'presentation_only','source_catalog','ranked_matches','positional_matches']) view[key] = result[key];
          view.inputs = {analysis_scan:result.inputs && result.inputs.analysis_scan};
          return {result:view,floor:snapshot.floor,viewState:snapshot.viewState};
        },
        capture: async function capturePublication(options = {}) {
          // Cancellation belongs to the running export, not its cloned figure settings.
          const { signal, ...figureOptions } = options;
          const paletteSnapshot=window.MimicryPlotPalette.snapshot();
          figureOptions.plotPalette=paletteSnapshot;
          const exportOptions={mode:paletteSnapshot.mode,export:true};
          const snap = captureExportSnapshot();
          if (!snap) throw new Error((/*@copy mimicryone-runtime.no-completed-comparison-is-available.bd86ee7*/`No completed comparison is available for export.`/*@endcopy*/));
          // Capture the existing plot renderer; do not substitute export-only tracks.
          const capturePlayer=(highlight=true,range=null)=>{
            if(isFull()){
              // Reuse the native wrapped renderer across its full logical height,
              // independently of the scroll viewport. Small canvas tiles avoid
              // browser canvas-dimension limits while SVG retains every row.
              const saved={context:ctx,height:H,width:W,offset:fullOff,paused:userPaused};
              const width=range?POSW+(range.end0-range.start0)*CELL+Math.max(40,String(T.len).length*9):CW;
              const totalHeight=range?8+STACKH+6:FULLH,parts=[],tileHeight=2048;
              try{
                userPaused=true;
                for(let offset=0;offset<totalHeight;offset+=tileHeight){
                  const height=Math.min(tileHeight,totalHeight-offset),tile=document.createElement('canvas');
                  tile.width=Math.ceil(width*2);tile.height=Math.ceil(height*2);
                  const native=tile.getContext('2d');
                  if(!native)throw Error((/*@copy mimicryone-runtime.unable-to-allocate-full-export.445fa70*/`Unable to allocate Full export canvas`/*@endcopy*/));
                  native.setTransform(2,0,0,2,0,0);
                  ctx=new Proxy(native,{get:(o,k)=>{
                    if(k==='strokeRect'&&!highlight)return (...args)=>{if(![PLOT.raw('mimicryContext'),PLOT.raw('mimicryCore'),String(HL)].map(v=>v.toLowerCase()).includes(String(o.strokeStyle).toLowerCase()))o.strokeRect(...args);};
                    return typeof o[k]==='function'?o[k].bind(o):o[k];
                  },set:(o,k,v)=>{o[k]=k==='shadowBlur'?0:k==='globalAlpha'?1:(k==='strokeStyle'||k==='fillStyle')&&(v===BORDER||v===FAINT)?PLOT.raw('printInk'):v;return true;}});
                  H=height;W=width;fullOff=()=>offset;
                  drawWrapped(range);
                  const image=tile.toDataURL('image/png');
                  if(image==='data:,')throw Error((/*@copy mimicryone-runtime.full-export-canvas-exceeds-browser.86fd281*/`Full export canvas exceeds browser limits`/*@endcopy*/));
                  parts.push(`<image x="0" y="${offset}" width="${width}" height="${height}" href="${image}"/>`);
                  tile.width=tile.height=1;
                }
                return {width,height:totalHeight,content:parts.join(''),residueCount:range?range.end0-range.start0:T.len,bandCount:range?1:BANDS,bandHeight:BANDH,activeTracks:LANES.map(l=>l.key),complete:true,
                  ...(range?{referenceWidth:Math.max(CW,width),range_start:range.start0+1,range_end:range.end0,core_start:snap.viewState.selected_start,core_end:snap.viewState.selected_start+8}: {})};
              }finally{ctx=saved.context;H=saved.height;W=saved.width;fullOff=saved.offset;userPaused=saved.paused;}
            }
            const plot=document.getElementById('fig'),bounds=plot.getBoundingClientRect(),savedContext=ctx;
            const scroll=document.getElementById('cvwrap'),savedScroll=[scroll.scrollLeft,scroll.scrollTop];
            const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
            let elements=[];
            try{
              ctx=new Proxy(savedContext,{get:(o,k)=>{
                if(k==='strokeRect'&&!highlight)return (...args)=>{if(![PLOT.raw('mimicryContext'),PLOT.raw('mimicryCore'),String(HL)].map(v=>v.toLowerCase()).includes(String(o.strokeStyle).toLowerCase()))o.strokeRect(...args);};
                return typeof o[k]==='function'?o[k].bind(o):o[k];
              },set:(o,k,v)=>{o[k]=k==='shadowBlur'?0:k==='globalAlpha'?1:(k==='strokeStyle'||k==='fillStyle')&&(v===BORDER||v===FAINT)?PLOT.raw('printInk'):v;return true;}});
              draw();
              const canvas=document.getElementById('viz'),r=canvas.getBoundingClientRect();
              const viewport=scroll.getBoundingClientRect();
              elements.push(`<defs><clipPath id="playerCanvasClip"><rect x="${viewport.left-bounds.left}" y="${viewport.top-bounds.top}" width="${viewport.width}" height="${viewport.height}"/></clipPath></defs><image clip-path="url(#playerCanvasClip)" x="${r.left-bounds.left}" y="${r.top-bounds.top}" width="${r.width}" height="${r.height}" href="${canvas.toDataURL('image/png')}"/>`);
              for(const column of plot.querySelectorAll('.colL,.colR')){
                const box=column.getBoundingClientRect(),clip='plot-'+column.id;
                elements.push(`<defs><clipPath id="${clip}"><rect x="${box.left-bounds.left}" y="${box.top-bounds.top}" width="${box.width}" height="${box.height}"/></clipPath></defs><g clip-path="url(#${clip})">`);
                const walker=document.createTreeWalker(column,NodeFilter.SHOW_TEXT);let node;
                while(node=walker.nextNode()){
                  if(!node.textContent.trim())continue;
                  const style=getComputedStyle(node.parentElement);
                  if(style.visibility==='hidden'||style.display==='none')continue;
                  const range=document.createRange();range.selectNodeContents(node);
                  if(!range.getClientRects().length)continue;
                  for(let i=0;i<node.textContent.length;i++){
                    range.setStart(node,i);range.setEnd(node,i+1);const char=range.getBoundingClientRect();
                    if(!char.width||!char.height)continue;
                    elements.push(`<text x="${char.left-bounds.left}" y="${char.bottom-bounds.top-parseFloat(style.fontSize)*.19}" fill="${node.parentElement.closest('.mt')?PLOT.raw('sequenceMatchPrint'):node.parentElement.closest('.mm')?PLOT.raw('sequenceMismatchPrint'):PLOT.raw('printInk')}" font-family="${escape(style.fontFamily)}" font-size="${escape(style.fontSize)}" font-weight="${escape(style.fontWeight)}">${escape(node.textContent[i])}</text>`);
                  }
                }
                elements.push('</g>');
              }
              return {width:bounds.width,height:bounds.height,content:elements.join('')};
            }finally{ctx=savedContext;scroll.scrollLeft=savedScroll[0];scroll.scrollTop=savedScroll[1];draw();}
          };
          let playerPlots;
          if(figureOptions.capturePlots){
            const priorView=currentRuntimeView(),priorPaused=userPaused,wrap=document.getElementById('cvwrap'),priorScroll=[wrap.scrollLeft,wrap.scrollTop];
            const wasDark=document.documentElement.classList.contains('dark');
            userPaused=true;
            const restorePalette=PLOT.beginExport(exportOptions);
            try{
              document.documentElement.classList.remove('dark');window.dispatchEvent(new Event('mimicryone:theme'));
              setView('explorer');
              playerPlots={compact:{highlighted:capturePlayer(),plain:capturePlayer(false)}};
              setView('residues');
              playerPlots.full={highlighted:capturePlayer(),plain:capturePlayer(false)};
              const windowRange={start0:Math.max(0,snap.viewState.selected_start-1-FLANK),
                end0:Math.min(T.len,snap.viewState.selected_start-1+K+FLANK)};
              playerPlots['full-window']={highlighted:capturePlayer(true,windowRange),plain:capturePlayer(false,windowRange)};
            }finally{document.documentElement.classList.toggle('dark',wasDark);restorePalette();window.dispatchEvent(new Event('mimicryone:theme'));setView(priorView);userPaused=priorPaused;wrap.scrollLeft=priorScroll[0];wrap.scrollTop=priorScroll[1];draw();}
          }
          const snapshot = PLOT.capture(()=>structuredClone({
            result: serializableResult(snap.result), floor: snap.floor, viewState: snap.viewState,
            figure: figureOptions, captured_utc: new Date().toISOString(),
            playerPlots,
            scope_label:snap.scopeLabel,
            tracks: activeTracks().map(track => ({key:track.key,label:track.label,
              colors:Array.from({length:T.len},(_,i)=>track.key === "variants" ? variantColorAt(i+1) : track.key === "modifications" ? modificationColorAt(i+1) : annColor(track.key,i))})),
            legendFontSize:parseFloat(getComputedStyle(document.querySelector('.legend')).fontSize),
            legends: Array.from(document.querySelectorAll('.legend .lgrp')).filter(el=>
              !el.hidden && (el.querySelector('.ramp,.legend-scale') || el.hasAttribute('data-track-legend'))).map(el=>({
                text:el.innerText.replace(/\s+/g,' ').trim(),
                // Keep the exported scale in the same order the live legend shows:
                // title, low label, color bar, high label. Flattening to innerText
                // drops the bar's position because the ramp element has no text.
                range:legendRange(el),
                swatches:Array.from(el.querySelectorAll('.legend-dot,.legend-block,.modification-symbol')).map(s=>({color:getComputedStyle(s).backgroundColor,label:legendSwatchLabel(s),symbolText:s.dataset.symbol||'',circle:s.classList.contains('legend-dot')})),
                gradient:(getComputedStyle(el.querySelector('.ramp,.legend-scale')||el).backgroundImage.match(/rgba?\([^)]*\)/g)||[])
              })),
            annotation: ANN,
            blosum62: Array.from(BT),
          }),exportOptions);
          const structureAccession=targetHasReferenceStructure(T)?T.structureAccession:null,captureTarget=T;
          let exportStructure=structureAccession?S3:null;
          if(figureOptions.capturePlots&&!exportStructure&&structureAccession){
            const response=await fetch(API+'/data/structures/'+encodeURIComponent(structureAccession)+'.pdb');
            if(response.ok)exportStructure=parsePDB(await response.text());
            else if(response.status!==404)throw new Error((/*@copy mimicryone-runtime.structure-export-could-not-be.944f75d*/`Structure export could not be loaded (HTTP ${response.status}).`/*@endcopy*/));
            if(T!==captureTarget)throw new Error((/*@copy mimicryone-runtime.selection-changed-while-loading-the.eca0356*/`Selection changed while loading the structure; export again.`/*@endcopy*/));
          }
          if (figureOptions.capturePlots && exportStructure && c3) {
            const prior = {x:x3,w:S3w,h:S3h,structure:S3};
            const restorePalette=PLOT.beginExport(exportOptions);
            const canvas=document.createElement("canvas");canvas.width=1400;canvas.height=900;
            try {
              x3=canvas.getContext("2d");S3w=1400;S3h=900;S3=exportStructure;
              const render=col=>{x3.clearRect(0,0,1400,900);if(S3SHAPE==="ribbon")drawRibbon(col);else drawSurface(col);return canvas.toDataURL("image/png");};
              snapshot.structure={highlighted:render(snap.viewState.selected_start-1),plain:render(-100000),
                accession:structureAccession,assembly:prior.structure?S3ASM:'monomer',
                pose:{yaw:S3yaw,pitch:S3pitch,assembly:prior.structure?S3ASM:'monomer',shape:S3SHAPE,color:S3COL},geometry:structuredClone(S3)};
            } finally {x3=prior.x;S3w=prior.w;S3h=prior.h;S3=prior.structure;restorePalette();}
          }
          snapshot.result=structuredClone(serializableResult(figureOptions.capturePlots
            ? await completeResultFor(snapshot.result,snapshot.floor,snap.scope,signal)
            : snapshot.result));
          snapshot.font_css=await figureEmbeddedFontCss();
          if(figureOptions.capturePlots)snapshot.coverageFigure=window.MimicryExtentFigures.capture(snapshot.result,snapshot.floor,snapshot.scope_label,snapshot.viewState);
          return snapshot;
        },
        legacyInputs: async function(result) {
          const pack=await loadSequencePack(result.parameters.source_scope === "human" ? "human" : "nonhuman");
          return pack.rows.filter(filterForScope(result.parameters.source_scope));
        }
      });
      return;
    }
    document.querySelectorAll('.repro button').forEach(button=>{button.disabled=true;});
    const host=document.querySelector('.repro');
    if(host)host.setAttribute('aria-label',(/*@copy mimicryone-runtime.export-module-unavailable-reload-the.acd6483*/`Export module unavailable; reload the page.`/*@endcopy*/));
  }

  function wireCustomUi() {
    const pane = document.getElementById("fastawrap").closest(".pane");
    pane.classList.add("custom-pane");
    const run = replaceInteractive("runFasta");
    const clear = replaceInteractive("clearFasta");
    const clearTarget = replaceInteractive("clearTarget");
    const clearMimic = replaceInteractive("clearMimic");
    run.textContent = (/*@copy mimicryone-runtime.run-analysis.cad093c*/`Run analysis`/*@endcopy*/);
    clear.textContent = (/*@copy mimicryone-runtime.clear-inputs.e3972a3*/`Clear inputs`/*@endcopy*/);
    clear.dataset.tooltip = (/*@copy mimicryone-runtime.clear-the-fasta-inputs-the.661ae39*/`Clear the FASTA inputs; the result currently shown in the main stage is retained.`/*@endcopy*/);
    const cancel = document.createElement("button");
    cancel.className = "btn ghost";
    cancel.id = "cancelFasta";
    cancel.type = "button";
    cancel.textContent = (/*@copy mimicryone-runtime.cancel.32abb4b*/`Cancel`/*@endcopy*/);
    cancel.hidden = true;
    clear.before(cancel);
    run.addEventListener("click", runCustom);
    cancel.addEventListener("click", function cancelRun() {
      const message = "Local analysis canceled. No incomplete result was opened; completed local queries remain available for export.";
      if (cancelCustomRun(message)) note(document.getElementById("mimicnote"), message);
      else terminateRun(message);
    });

    const fieldConfig = {
      target: {
        textarea: document.getElementById("fasta"),
        file: document.getElementById("fastaFile"),
        clear: clearTarget,
        status: document.getElementById("fastaStatus"),
        defaultId: "query",
        label: (/*@copy mimicryone-runtime.antigen-target.20a1587*/`Antigen Target`/*@endcopy*/),
      },
      mimic: {
        textarea: document.getElementById("mimicfa"),
        file: document.getElementById("mimicFile"),
        clear: clearMimic,
        status: document.getElementById("mimicFastaStatus"),
        defaultId: "target",
        label: (/*@copy mimicryone-runtime.mimicry-parent.92a7f56*/`Mimicry Parent`/*@endcopy*/),
      },
    };
    const validationGeneration = { target: 0, mimic: 0 };
    const validationTimer = { target: 0, mimic: 0 };

    function validationMessage(config, parsed, error) {
      if (error) return error;
      if (parsed.ignoredRecords) return (/*@copy mimicryone-runtime.first-target-ready*/`${parsed.records[0].protein_id}: first target ready · ${parsed.ignoredRecords} additional skipped`/*@endcopy*/);
      return `${parsed.records.length} sequence${parsed.records.length === 1 ? "" : "s"} ready`;
    }

    function setFastaState(kind, status, message) {
      const config = fieldConfig[kind];
      const detail = String(message || "");
      config.status.textContent = status === "checking" ? (/*@copy mimicryone-runtime.checking.44bf9fb*/`Checking…`/*@endcopy*/) : detail;
      config.status.setAttribute("aria-busy", status === "checking" ? "true" : "false");
      if (status) config.status.dataset.state = status;
      else delete config.status.dataset.state;
      if (detail) config.status.dataset.tooltip = detail;
      else delete config.status.dataset.tooltip;
    }

    function resetFastaState(kind) {
      validationGeneration[kind] += 1;
      window.clearTimeout(validationTimer[kind]);
      setFastaState(kind, "", "");
    }

    async function validateFasta(kind) {
      const config = fieldConfig[kind];
      const token = ++validationGeneration[kind];
      window.clearTimeout(validationTimer[kind]);
      setFastaState(kind, "checking", `Checking ${config.label} FASTA\u2026`);
      await new Promise(function allowCheckingPaint(resolve) { window.setTimeout(resolve, 16); });
      const parsed = kind === "target" ? window.MimicryFastaInput.firstTarget(config.textarea.value)
        : parseFastaStrict(config.textarea.value, config.defaultId);
      const errors = parsed.errors.slice();
      const error = errors[0] || "";
      if (token === validationGeneration[kind]) {
        setFastaState(kind, error ? "error" : parsed.ignoredRecords ? "notice" : "success", validationMessage(config, parsed, error));
      }
      return { ...parsed, ok: !error && parsed.records.length > 0, errors, error };
    }

    function scheduleValidation(kind) {
      const config = fieldConfig[kind];
      resetFastaState(kind);
      if (!String(config.textarea.value || "").trim()) return;
      validationTimer[kind] = window.setTimeout(function validateAfterInput() {
        validateFasta(kind);
      }, 320);
    }

    async function loadFastaFiles(kind, event) {
      const config = fieldConfig[kind];
      setFastaState(kind, "checking", `Reading and checking ${config.label} FASTA\u2026`);
      try {
        const texts = await Promise.all(Array.from(event.target.files || []).map(function read(file) { return file.text(); }));
        config.textarea.value = texts.join("\n");
        await validateFasta(kind);
      } catch (error) {
        validationGeneration[kind] += 1;
        setFastaState(kind, "error", error && error.message ? error.message : "The FASTA file could not be read.");
      } finally {
        event.target.value = "";
      }
    }

    function clearFastaField(kind) {
      const config = fieldConfig[kind];
      config.textarea.value = "";
      config.file.value = "";
      resetFastaState(kind);
      if (kind === "mimic") state.customTargets = null;
    }

    async function validateRequired(mode) {
      const checks = [validateFasta("target")];
      if (mode === "custom") checks.push(validateFasta("mimic"));
      const results = await Promise.all(checks);
      const failedIndex = results.findIndex(function failed(result) { return !result.ok; });
      if (failedIndex >= 0) {
        const kind = failedIndex === 0 ? "target" : "mimic";
        return { ok: false, error: `${fieldConfig[kind].label}: ${results[failedIndex].error || "FASTA validation failed."}` };
      }
      return { ok: true, target: results[0], mimic: results[1] || null };
    }

    window.MimicryOneFastaValidation = {
      validate: validateFasta,
      validateRequired,
      reset: resetFastaState,
    };

    Object.keys(fieldConfig).forEach(function wireFastaField(kind) {
      const config = fieldConfig[kind];
      config.clear.addEventListener("click", function clearField() { clearFastaField(kind); });
      config.file.addEventListener("change", function filesSelected(event) { loadFastaFiles(kind, event); });
      config.textarea.addEventListener("input", function inputChanged() { scheduleValidation(kind); });
      setFastaState(kind, "", "");
    });

    clear.addEventListener("click", function clearCustom() {
      cancelCustomRun("Canceled safely.");
      if (state.activeRun) terminateRun("Canceled safely.");
      clearFastaField("target");
      clearFastaField("mimic");
      note(document.getElementById("mimicnote"), "");
    });
    const customJump = document.getElementById("customJump");
    customJump.addEventListener("click", function openCustomInput() {
      pane.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("fasta").focus({ preventScroll: true });
    });
  }

  function wireScopeUi(libraries) {
    const original = document.getElementById("mimicmode");
    const group = original.cloneNode(true);
    original.replaceWith(group);
    group.querySelector('[data-m="all"]').textContent = (/*@copy mimicryone-runtime.non-human.54df020*/`Non-human`/*@endcopy*/);
    group.querySelector('[data-m="one"]').textContent = (/*@copy mimicryone-runtime.one-source.aba64b9*/`One source`/*@endcopy*/);
    group.querySelector('[data-m="human"]').textContent = (/*@copy mimicryone-runtime.human.07b646b*/`Human`/*@endcopy*/);
    group.querySelectorAll("button").forEach(function scopeButton(button) {
      button.addEventListener("click", function chooseScope() {
        MIMIC_MODE = button.getAttribute("data-m");
        group.querySelectorAll("button").forEach(function pressed(item) {
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        });
        document.getElementById("onewrap").style.display = MIMIC_MODE === "one" ? "block" : "none";
        document.getElementById("customwrap").style.display = MIMIC_MODE === "custom" ? "flex" : "none";
        document.getElementById("fillrest").style.display = MIMIC_MODE === "custom" ? "none" : "flex";
        if (T && T.result && (T.result.origin === "baked" || T.result.origin === "catalogue")) {
          const accession = T.acc;
          if (EXPANDED) setPaused(true);
          invalidateBakedResults(accession);
          loadStaticProtein(accession);
        }
      });
    });
    const select = replaceInteractive("libsel");
    select.setAttribute("aria-label", (/*@copy mimicryone-runtime.mimicry-parent-source.eda3a8d*/`Mimicry Parent source`/*@endcopy*/));
    select.innerHTML = libraries.map(function option(library) {
      const label = library.organism || library.display_name || library.name || library.library_id;
      return `<option value="${html(library.library_id)}">${html(label)} (${nf(library.protein_count || 0)})</option>`;
    }).join("");
    select.addEventListener("change", function libraryChanged() {
      if (MIMIC_MODE === "one" && T && T.result && (T.result.origin === "baked" || T.result.origin === "catalogue")) {
        const accession = T.acc;
        if (EXPANDED) setPaused(true);
        invalidateBakedResults(accession);
        loadStaticProtein(accession);
      }
    });
    /* The quick-pick strip is built by index.html, but its only call site sits inside the dead
       `if (!MIMICRYONE_STATIC)` branch, so #quickvir stayed empty. libsel is populated above,
       which is the first moment the picks can resolve. */
    if (typeof buildQuickVirus === "function") buildQuickVirus();
  }


  function wireExploreCatalogueSearch() {
    const input = document.getElementById("pexploresearch");
    const results = document.getElementById("pexploreresults");
    if (!input || !results) return;

    function render() {
      const query = input.value.trim().toLowerCase();
      if (!query) {
        results.replaceChildren();
        results.className = "slist";
        return;
      }
      const pool = searchPool();
      const first = [];
      const rest = [];
      pool.forEach(function classify(row) {
        const values = searchValues(row);
        if (!query || values[0].indexOf(query) === 0 || values[1].indexOf(query) === 0 || values[2].indexOf(query) === 0) first.push(row);
        else if (values.some(function contains(value) { return value.indexOf(query) >= 0; })) rest.push(row);
      });
      const hits = first.concat(rest).slice(0, 40);
      const mixedLibraries = window.MimicryOneIdentity.mixedLibraries(hits);
      results.innerHTML = hits.length ? hits.map(function option(row) {
        const kind = searchKind(row);
        const identity = identityFor(Object.assign({ library_id: row.lib }, row), {
          mixedLibraries,
        });
        return '<button type="button" data-acc="' + html(row.acc) + '" data-kind="' + html(kind) +
          '" data-tooltip="' + html(identity.tooltip) + '" data-tooltip-mono="true">' +
          '<span class="result-identity identity-cell"><span class="rg identity-primary">' +
          html(identity.displayLine || identity.primaryLine) + '</span><span class="ra identity-secondary">' +
          html(identity.secondary) + '</span></span>' +
          '<span class="rn">' + html(row.len + " AA") + '</span></button>';
      }).join("") : (/*@copy mimicryone-runtime.no-matching-protein.1bf2e69*/`<div class="catalogue-no-match">No matching protein</div>`/*@endcopy*/);
      results.className = "slist show";
    }

    input.addEventListener("focus", render);
    input.addEventListener("input", render);
    input.addEventListener("keydown", function keyboard(event) {
      if (event.key === "Escape") results.className = "slist";
      if (event.key === "Enter") {
        const first = results.querySelector("button[data-acc]");
        if (first) { event.preventDefault(); first.click(); }
      }
    });
    results.addEventListener("click", function choose(event) {
      const button = event.target.closest("button[data-acc]");
      if (!button) return;
      const accession = button.getAttribute("data-acc");
      input.value = "";
      results.className = "slist";
      setView("explorer");
      /* loadProtein remains the authored DATA loader until the baked index is
         healthy, then points at loadStaticProtein. This preserves both paths. */
      loadProtein(accession);
    });
    document.addEventListener("click", function close(event) {
      if (!event.target.closest(".explore-catalogue")) results.className = "slist";
    });
  }

  function wireAtlasSearch() {
    wireExploreCatalogueSearch();
  }

  function ensureCatalogueCancel() {
    const existing = document.getElementById("catalogCancel");
    if (existing) return existing;
    const cancel = document.createElement("button");
    cancel.id = "catalogCancel";
    cancel.type = "button";
    cancel.className = "btn ghost";
    cancel.textContent = (/*@copy mimicryone-runtime.cancel.3ed2bc7*/`Cancel`/*@endcopy*/);
    cancel.hidden = true;
    loadnote.after(cancel);
    cancel.addEventListener("click", function cancelCatalogueScan() {
      terminateRun("Canceled safely. No partial catalog result was retained.");
    });
    return cancel;
  }

  let runtimeIndexByNumeric = new Map();



  async function initialize() {
    wireExports();
    wireCustomUi();
    /* Wire search before index loading; failures must not substitute bundled results. */
    wireAtlasSearch();
    const bootstrapController = new AbortController();
    const bootstrapTimer = window.setTimeout(function expired() { bootstrapController.abort(); }, 10000);
    try {
      const index = await fetchJson("/data/_index.json.gz", { cache: "no-cache", signal: bootstrapController.signal });
      window.clearTimeout(bootstrapTimer);
      const libraries = new Map(index.libraries.map(function libraryIndex(library) {
        return [library.library_id, library];
      }));
      runtimeIndexByNumeric = new Map(index.proteins.map(function proteinIndex(protein) {
        return [protein.protein_idx, {
          protein_idx: protein.protein_idx,
          protein_id: protein.protein_id,
          gene: protein.gene || protein.protein_id,
          name: protein.name || protein.protein_id,
          library_id: protein.library,
          organism: protein.organism || (libraries.get(protein.library) || {}).organism || "",
          length: protein.length,
        }];
      }));
      apiIndex = Array.from(runtimeIndexByNumeric.values()).map(function searchable(protein) {
        const library = libraries.get(protein.library_id) || {};
        const kind = HUMAN_LIBRARIES.has(protein.library_id) ? "human" : (library.type === "virus" ? "virus" : "exposure");
        return {
          acc: protein.protein_id,
          gene: protein.gene,
          name: protein.name,
          len: protein.length,
          lib: protein.library_id,
          library_name: library.display_name || library.organism || protein.library_id,
          organism: protein.organism,
          type: library.type || "",
          kind,
        };
      });
      apiUp = true;
      wireScopeUi(index.libraries.filter(function nonhuman(library) {
        return !HUMAN_LIBRARIES.has(library.library_id);
      }));
      loadProtein = loadStaticProtein;
      buildChips();
      /* analysis-entry uses #catalogCancel as its readiness marker. Expose it
         only after wireScopeUi has replaced #mimicmode and attached runtime
         listeners, otherwise the analysis controls can be cloned away. */
      ensureCatalogueCancel();
      // The native route owns startup when available. Do not open a legacy
      // baked IL10 result over its release-qualified default selection.
      if (window.MimicryOneAnalysisBootstrap && await window.MimicryOneAnalysisBootstrap) return;
      note(loadnote, "The current-release selection service is unavailable. No legacy startup result was loaded.", true);
    } catch (error) {
      /* Release native-route readiness even when the older index is unavailable. */
      ensureCatalogueCancel();
      if (window.MimicryOneAnalysisBootstrap && await window.MimicryOneAnalysisBootstrap) return;
      note(loadnote, `The index is unavailable (${error.message}). No legacy startup result was loaded.`, true);
    } finally {
      window.clearTimeout(bootstrapTimer);
    }
  }

  const authoredSetView = setView;
  setView = function artifactAwareView(view) {
    viewIntentRevision += 1;
    if (view === "explorer" || view === "residues") {
      authoredSetView(view);
      if (T && T.result && T.result.presentation_only) openCompleteExplorer(T.acc, view);
      return;
    }
    authoredSetView(view);
  };

  const originalBuildMatchBox = buildMatchBox;
  buildMatchBox = function completeMatchBox() {
    if (T && T.result) renderCompleteRankTable();
    else originalBuildMatchBox();
  };

  const originalLoadStructure = loadStructure;
  const originalProbeDimer = probeDimer;
  const originalSetAssembly = setAssembly;
  loadStructure = function coordinateSafeStructure(owner) {
    if (!T || T.acc !== owner) return;
    if (!targetHasReferenceStructure(T)) {
      beginStructureOwner(owner);
      S3 = null; showStructure(false); return;
    }
    if (!T.completeInMemory) {
      originalLoadStructure(owner);
      return;
    }
    const asset = T.structureAccession;
    beginStructureOwner(owner);
    if (!c3 || !asset) { S3 = null; showStructure(false); return; }
    const cached = S3cache[owner];
    if (cached && cached.assetAccession === asset && (cached.m || !window.seromapDesktop)) {
      // The page-wide dimer context decides the assembly, so reopening a protein cannot put
      // the structure in one context while the Surface and rSASA lanes stay in the other.
      if (DIMERCTX && cached.hasD && cached.d) S3ASM = "dimer";
      else if (!DIMERCTX) S3ASM = "monomer";
      S3 = S3ASM === "dimer" && cached.d ? cached.d : cached.m;
      applyStructure(owner);
      probeDimer(owner);
      return;
    }
    S3 = null;
    structurePending(owner);
    const releaseStartup = window.MimicryStartup ? window.MimicryStartup.hold("assets") : function() {};
    fetch(API + "/data/structures/" + encodeURIComponent(asset) + ".pdb", {signal:releaseStartup.signal})
      .then(async function structureText(response) {
        if (response.ok) return {text:await response.text()};
        if (!window.seromapDesktop) return {};
        const payload=await response.json().catch(function(){return {};});
        const code=payload.code || (response.status===404?'structure_unavailable':'structure_load_failed');
        return {status:{code:code,message:code==='structure_pack_required'?'Structure not installed.':code==='structure_unavailable'?STRUCTURE_MISSING:'Structure could not be loaded.'}};
      })
      .then(function storeStructure(result) {
        S3cache[owner] = { m: result.text ? parsePDB(result.text) : null, status:result.status, d: undefined, hasD: undefined, assetAccession: asset };
        if (T && T.acc === owner && T.structureAccession === asset) {
          S3 = S3cache[owner].m;
          applyStructure(owner);
          probeDimer(owner);
        }
      })
      .catch(function structureFailed() {
        S3cache[owner] = { m: null, d: null, hasD: false, assetAccession: asset,
          status:window.seromapDesktop?{code:'structure_load_failed',message:'Structure could not be loaded.'}:undefined };
        if (T && T.acc === owner) applyStructure(owner);
      }).finally(releaseStartup);
  };
  probeDimer = function coordinateSafeDimerProbe(owner) {
    const cached = S3cache[owner];
    if (!cached || !cached.assetAccession) { originalProbeDimer(owner); return; }
    if (!cached.m) { buildAsmToggle(owner); return; }
    if (cached.hasD !== undefined) { if (!defaultDimerIfAvailable(owner)) buildAsmToggle(owner); return; }
    const releaseStartup = window.MimicryStartup ? window.MimicryStartup.hold("assets") : function() {};
    fetch(API + "/data/structures_dimer/" + encodeURIComponent(cached.assetAccession) + ".pdb", { method: "HEAD", signal:releaseStartup.signal })
      .then(function dimerExists(response) { cached.hasD = response.ok; })
      .catch(function noDimer() { cached.hasD = false; })
      .then(function finishProbe() { if (T && T.acc === owner && !defaultDimerIfAvailable(owner)) buildAsmToggle(owner); }).finally(releaseStartup);
  };
  setAssembly = function coordinateSafeAssembly(owner, assembly) {
    const cached = S3cache[owner];
    if (!cached || !cached.assetAccession) { originalSetAssembly(owner, assembly); return; }
    if (assembly === "monomer") { S3ASM = "monomer"; S3 = cached.m; applyStructure(owner); return; }
    if (cached.d) { S3ASM = "dimer"; S3 = cached.d; applyStructure(owner); return; }
    const releaseStartup = window.MimicryStartup ? window.MimicryStartup.hold("assets") : function() {};
    fetch(API + "/data/structures_dimer/" + encodeURIComponent(cached.assetAccession) + ".pdb", {signal:releaseStartup.signal})
      .then(function dimerText(response) { return response.ok ? response.text() : null; })
      .then(function storeDimer(text) {
        cached.d = text ? parsePDB(text) : null;
        if (!cached.d) { cached.hasD = false; if (T && T.acc === owner) buildAsmToggle(owner); return; }
        if (T && T.acc === owner) { S3ASM = "dimer"; S3 = cached.d; applyStructure(owner); }
      })
      .catch(function dimerFailed() { cached.hasD = false; if (T && T.acc === owner) buildAsmToggle(owner); }).finally(releaseStartup);
  };

  function optionalJson(path, signal) {
    return fetch(path, {signal}).then(function parseOptional(response) { return response.ok ? response.json() : null; }).catch(function absent() { return null; });
  }

  const originalLoadAnnots = loadAnnots;
  loadAnnots = function staticAnnotations(accession, done) {
    if (annCache[accession] !== undefined) {
      ANN = annCache[accession];
      indexAnnotationVariants();
      if (done) done();
      return;
    }
    if (T && T.completeInMemory && T.acc === accession && T.annotationPortableId) {
      const owner = accession;
      const portableId = T.annotationPortableId;
      const safeAlias = T.nativeTrackAccession;
      const releaseStartup = window.MimicryStartup ? window.MimicryStartup.hold("assets") : function() {};
      const portablePromise = optionalJson(`/api/explorer/proteins/${encodeURIComponent(portableId)}/annotations`, releaseStartup.signal);
      const legacyPromise = safeAlias
        ? optionalJson(`/data/assets/proteins_catalogue/${encodeURIComponent(safeAlias)}.json`, releaseStartup.signal).then(function legacyFallback(payload) {
            return payload || optionalJson(API + `/data/assets/proteins/${encodeURIComponent(safeAlias)}.json`, releaseStartup.signal);
          })
        : Promise.resolve(null);
      Promise.all([portablePromise, legacyPromise]).then(function mergeAnnotations(payloads) {
        const portable = payloads[0] && payloads[0].annotations ? payloads[0].annotations : null;
        const legacy = payloads[1] && payloads[1].annotations ? payloads[1].annotations : null;
        let merged = legacy ? Object.assign({}, legacy) : {};
        if (portable) {
          Object.keys(portable).forEach(function portableLane(key) { merged[key] = portable[key]; });
        }
        // safeAlias is an exact-sequence-validated asset mapping. The projection
        // collection is additive: empty or partial tile coverage must not erase
        // the existing native HumSAVAR point annotations for that same protein.
        if (legacy && Array.isArray(legacy.variants)) {
          const points = new Map();
          legacy.variants.concat(portable && Array.isArray(portable.variants) ? portable.variants : []).forEach(function retainVariant(point) {
            const key = JSON.stringify([point.pos, point.ref, point.alt, point.cat, point.ftid || "", point.dbsnp || "", point.disease || ""]);
            points.set(key, point);
          });
          merged.variants = Array.from(points.values()).sort((a, b) => Number(a.pos) - Number(b.pos));
        }
        if (!Object.keys(merged).length) merged = null;
        annCache[owner] = merged;
        if (T && T.acc === owner && T.annotationPortableId === portableId) {
          ANN = merged;
          indexAnnotationVariants();
          if (done) done();
        }
      }).catch(function annotationFailure() {
        annCache[owner] = null;
        if (T && T.acc === owner) {
          ANN = null;
          indexAnnotationVariants();
          if (done) done();
        }
      }).finally(releaseStartup);
      return;
    }
    if (T && T.completeInMemory && T.acc === accession) {
      annCache[accession] = null;
      ANN = null;
      indexAnnotationVariants();
      if (done) done();
      return;
    }
    const releaseStartup = window.MimicryStartup ? window.MimicryStartup.hold("assets") : function() {};
    fetch(`/data/assets/proteins_catalogue/${encodeURIComponent(accession)}.json`, {signal:releaseStartup.signal})
      .then(function responseToJson(response) { return response.ok ? response.json() : null; })
      .then(function store(payload) {
        annCache[accession] = payload && payload.annotations ? payload.annotations : null;
        ANN = annCache[accession];
        indexAnnotationVariants();
        if (done) done();
      })
      .catch(function fallback() { originalLoadAnnots(accession, done); }).finally(releaseStartup);
  };


  function validateImportedAssetAliases(protein) {
    const track = protein.native_track_accession || "";
    const structure = protein.structure_accession || "";
    if (!track && !structure) return;
    const crosswalk = protein.native_asset_crosswalk;
    const exact = crosswalk && typeof crosswalk === "object" &&
      crosswalk.portable_id === protein.protein_id &&
      crosswalk.mapping_basis === "exact_unique_source_accession_and_full_sequence" &&
      crosswalk.sequence_identity_status === "full_sequence_exact" &&
      crosswalk.coordinate_status === "coordinate_identity_exact" &&
      crosswalk.conflict_status === "consistent";
    if (!exact) throw new Error((/*@copy mimicryone-runtime.imported-native-assets-lack-an.4f3a1bf*/`Imported native assets lack an exact coordinate-safe crosswalk.`/*@endcopy*/));
    if (track && (
      crosswalk.native_track_accession !== track ||
      crosswalk.legacy_protein_id !== track ||
      Number(crosswalk.annotation_asset_available) !== 1
    )) {
      throw new Error((/*@copy mimicryone-runtime.imported-native-track-alias-does.a1d0ac3*/`Imported native track alias does not match its exact crosswalk.`/*@endcopy*/));
    }
    if (structure && (
      crosswalk.structure_accession !== structure ||
      crosswalk.legacy_protein_id !== structure ||
      (Number(crosswalk.monomer_structure_available) !== 1 && Number(crosswalk.dimer_structure_available) !== 1)
    )) {
      throw new Error((/*@copy mimicryone-runtime.imported-structure-alias-does-not.6245994*/`Imported structure alias does not match its exact crosswalk.`/*@endcopy*/));
    }
  }

  function openSupportedResult(result, sequenceRows, preferredView) {
    if (!result || result.schema !== RESULT_SCHEMA) throw new Error((/*@copy mimicryone-runtime.mimicryone-openresult-requires-schema.e05eb1a*/`Imported results require schema ${RESULT_SCHEMA}.`/*@endcopy*/));
    const protein = result.protein;
    if (!protein || typeof protein.protein_id !== "string" || typeof protein.sequence !== "string") throw new Error((/*@copy mimicryone-runtime.imported-result-lacks-its-query.dc04635*/`Imported result lacks its antigen target identity or sequence.`/*@endcopy*/));
    if (protein.annotation_portable_id && (protein.annotation_portable_id !== protein.protein_id || !/^(?:P9P|M1E)[0-9]{9}$/.test(protein.annotation_portable_id))) {
      throw new Error((/*@copy mimicryone-runtime.imported-portable-annotation-identity-is.30738e5*/`Imported portable annotation identity is inconsistent with protein_id.`/*@endcopy*/));
    }
    validateImportedAssetAliases(protein);
    if (protein.sequence.length !== Number(protein.length)) throw new Error((/*@copy mimicryone-runtime.imported-query-sequence-length-does.40e35ad*/`Imported antigen target sequence length does not match protein.length.`/*@endcopy*/));
    if (!Array.isArray(result.available_floors) || result.available_floors.indexOf(Number(result.parameters && result.parameters.floor)) < 0) throw new Error((/*@copy mimicryone-runtime.imported-result-does-not-expose.6070a05*/`Imported result does not expose its active floor.`/*@endcopy*/));
    if (!Array.isArray(result.source_catalog) || !Array.isArray(result.ranked_matches) || !Array.isArray(result.positional_matches)) throw new Error((/*@copy mimicryone-runtime.imported-result-lacks-native-catalog.f96ba1d*/`Imported result lacks native catalog, ranked, or positional arrays.`/*@endcopy*/));
    const sourceCatalogByIndex = new Map();
    result.source_catalog.forEach(function validateSource(source) {
      const index = Number(source.protein_idx);
      if (!Number.isFinite(index) || sourceCatalogByIndex.has(index)) throw new Error((/*@copy mimicryone-runtime.imported-source-protein-idx-values.a77d49a*/`Imported source protein_idx values must be unique numbers.`/*@endcopy*/));
      if (typeof source.sequence !== "string" || source.sequence.length !== Number(source.length)) throw new Error((/*@copy mimicryone-runtime.imported-source-sequence-length-does.07ed8b1*/`Imported mimicry parent sequence length does not match its catalog length.`/*@endcopy*/));
      if (!source.seqid || !source.raw_header || !source.header) throw new Error((/*@copy mimicryone-runtime.imported-source-catalog-must-retain.4d107ac*/`Imported source catalog must retain full SeqID and header fields.`/*@endcopy*/));
      sourceCatalogByIndex.set(index, source);
    });
    const referenced = new Set();
    result.positional_matches.forEach(function validateSourceMatches(source) {
      const metadata = sourceCatalogByIndex.get(Number(source.protein_idx));
      if (!metadata || !Array.isArray(source.hits)) throw new Error((/*@copy mimicryone-runtime.imported-positional-source-is-absent.f14278a*/`Imported positional source is absent from source_catalog.`/*@endcopy*/));
      referenced.add(Number(source.protein_idx));
      source.hits.forEach(function validateHit(hit) {
        if (!Array.isArray(hit) || hit.length < 4) throw new Error((/*@copy mimicryone-runtime.imported-positional-hit-is-malformed.de5b96f*/`Imported positional hit is malformed.`/*@endcopy*/));
        if (!Number.isInteger(hit[0]) || hit[0] < 1 || hit[0] > protein.length - K + 1) throw new Error((/*@copy mimicryone-runtime.imported-query-coordinate-is-outside.b464289*/`Imported antigen target coordinate is outside the sequence.`/*@endcopy*/));
        if (!Number.isInteger(hit[1]) || hit[1] < 1 || hit[1] > metadata.length - K + 1) throw new Error((/*@copy mimicryone-runtime.imported-source-coordinate-is-outside.739142b*/`Imported mimicry parent coordinate is outside the sequence.`/*@endcopy*/));
        if (!Number.isInteger(hit[2]) || hit[2] < 5 || hit[2] > 9) throw new Error((/*@copy mimicryone-runtime.imported-identity-must-be-between.d5300d4*/`Imported core identity must be between 5 and 9.`/*@endcopy*/));
      });
    });
    if (referenced.size !== result.source_catalog.length) throw new Error((/*@copy mimicryone-runtime.imported-source-catalog-must-contain.c8ee51f*/`Imported source_catalog must contain exactly referenced result sources.`/*@endcopy*/));
    result.ranked_matches.forEach(function validateRank(row) {
      if (!sourceCatalogByIndex.has(Number(row.protein_index))) throw new Error((/*@copy mimicryone-runtime.imported-ranked-source-is-absent.0c4e951*/`Imported ranked source is absent from source_catalog.`/*@endcopy*/));
    });
    const hasHistoryContext = Object.prototype.hasOwnProperty.call(result, "__mimicryoneHistoryContext");
    const historyContext = hasHistoryContext ? result.__mimicryoneHistoryContext : undefined;
    const normalized = Object.assign({}, result, {
      complete_in_memory: true,
      source_catalog_by_index: sourceCatalogByIndex,
    });
    if (hasHistoryContext) {
      Object.defineProperty(normalized, "__mimicryoneHistoryContext", {
        value: historyContext,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    }
    if (!normalized.coverage) normalized.coverage = computeCoverage(protein.length, normalized.positional_matches, sourceCatalogByIndex);
    // A validated analysis/history result is now authoritative. Invalidate any
    // earlier asynchronous demo or catalog load before it can overwrite this
    // complete payload with a bounded presentation result.
    cancelCustomRun("Replaced by a completed result.");
    loadSeq += 1;
    openRuntimeResult(normalized, sequenceRows || normalized.source_catalog, preferredView || "explorer");
    return normalized;
  }

  window.MimicryOne = {
    sortedParentIds: (result,floor)=>rankRowsAtFloor(result,floor).map(row=>row.protein_id),
    resetRankPage: ()=>{state.rankPage=0;},
    version: RUNTIME_VERSION,
    openResult: openSupportedResult,
    getState: function getState() {
      return {
        protein_id: T && T.acc,
        selected_start: Math.floor(scan) + 1,
        similarity_floor: TH,
        source_scope: T && T.result ? T.result.parameters.source_scope : null,
        view: currentRuntimeView(),
        result_id: T && T.result ? T.result.result_id : null,
      };
    },
    getFigureState: currentFigureViewState,
    captureNavigationView: captureNavigationView,
    restoreNavigationView: restoreNavigationView,
    getResult: function getResult() { return T && T.result ? serializableResult(T.result) : null; },
    refreshFloorControls: function refreshFloorControls() {
      if (state.result) syncFloorControls(state.result);
    },
    setHistoryContext: function setHistoryContext(resultId, context) {
      if (typeof window.setPlayerHistoryContext !== "function") return false;
      const saved = window.setPlayerHistoryContext(resultId, context);
      window.dispatchEvent(new CustomEvent("mimicryone:navigation-state"));
      return saved;
    },
    pausePlayback: pausePlayback,
    beginTargetTransition: beginTargetTransition,
    finishTargetTransition: finishTargetTransition,
    parseFasta: parseFastaStrict,
    loadStaticProtein: loadStaticProtein,
    // On-demand browser-local threshold runs (5/9, 6/9 and any supported floor).
    runLocalLibraryScan: runLocalLibraryScan,
    readQueryRecord: async function(options){const row=await fetchQueryRecord(options);if(!row)throw Error('Selected target is unavailable');return localInputRow(row);},
    downloadLocalInputs: downloadLocalInputs,
    openLocalResult: function openLocalResult(result, sequenceRows, preferredView) {
      openRuntimeResult(result, sequenceRows, preferredView || "explorer");
    },
    cancelLocalRun: function cancelLocalRun(message) { terminateRun(message || "Canceled."); },
    // Stored-input controls required alongside persistent browser storage.
    listCachedInputs: async function listCachedInputs() {
      const compressed = await window.MimicryInputTransport.list();
      const db = await openInputDb();
      if (!db) return compressed;
      try {
        // Summaries come from the meta rows. Reading the packages to summarize them loaded
        // every cached population into memory to report its size.
        const store = db.transaction(INPUT_DB_META_STORE, "readonly").objectStore(INPUT_DB_META_STORE);
        const rows = await inputDbRequest(store, function all(target) { return target.getAll(); });
        return compressed.concat((rows || []).map(function summarize(row) {
          return { library: row.library, release: row.release, bytes: row.bytes,
                   records: row.records || 0, storedAt: row.storedAt };
        }));
      } catch (error) { return compressed; } finally { db.close(); }
    },
    clearCachedInputs: async function clearCachedInputs() {
      localInputCache.clear();
      const compressedCleared = await window.MimicryInputTransport.clear();
      const db = await openInputDb();
      if (!db) return compressedCleared;
      try {
        const transaction = db.transaction([INPUT_DB_STORE, INPUT_DB_META_STORE], "readwrite");
        await inputDbRequest(transaction.objectStore(INPUT_DB_STORE), function wipe(target) { return target.clear(); });
        await inputDbRequest(transaction.objectStore(INPUT_DB_META_STORE), function wipeMeta(target) { return target.clear(); });
        return true;
      } catch (error) { return false; } finally { db.close(); }
    },
    cachedInputLimitBytes: INPUT_CACHE_BYTE_LIMIT + window.MimicryInputTransport.limit,
    hasLoadedInputs: function(options) {
      const entry = localInputCache.get(localInputCacheKey(options));
      return !!(entry && entry.settled && entry.bundle && entry.bundle.records.length);
    },
    // Shared release-bound population for consumers that would otherwise repeat the
    // whole download, such as the reproducibility bundle.
    scanPreparedRecords: scanPreparedRecords,
    loadCachedInputs: function loadCachedInputs(options, onProgress) {
      return cachedLocalInputs(options, onProgress || function noop() {}, options.signal || null);
    },
  };

  const releaseStartup = window.MimicryStartup ? window.MimicryStartup.hold("runtime") : function() {};
  initialize().finally(releaseStartup);
})();
