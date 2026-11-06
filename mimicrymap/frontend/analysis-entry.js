// Lite deployment uses the existing browser worker for interactive comparisons.
window.MimicryLite = true;
/* Full-protein and public assay-library entry points for the MimicryMap player. */
(function analysisEntry() {
  "use strict";

  var finishBootstrap;
  window.MimicryOneAnalysisBootstrap = new Promise(function ready(resolve) {
    finishBootstrap = resolve;
  });

  var state = {
    libraries: new Map(),
    internalOnlyLibraries: new Set(),
    live: null,
    canonicalLive7: null,
    canonicalIndex: null,
    staticPlayer: null,
    staticCache: new Map(),
    staticPairs: new Set(),
    explorerMeta: null,
    sourceFilters: null,
    filterState: { query: Object.create(null), target: Object.create(null), custom: Object.create(null) },
    customExecution: "local",
    customFloors: {indexed:7, local:7},
    suggestions: new Map(),
    searchTimer: null,
    searchAbort: null,
    searchCache: new Map(),
    scanAbort: null,
    requestRevision: 0,
    selectionPending: null,
    selectionAbort: null,
    selectionSession: null,
    activeRoute: null,
    pendingRoute: null,
    waitingSingleRoute: null,
    analysisMetaUpdatedAt: 0,
    releaseFingerprint: "",
    filterPolicyFingerprint: "",
    primaryComponentKey: ""
  };

  var singleCopy = {
    mode: (/*@copy analysis-entry.single-parent-mode*/`Mimicry Parent comparison mode`/*@endcopy*/),
    library: (/*@copy analysis-entry.single-parent-library*/`vs library`/*@endcopy*/),
    single: (/*@copy analysis-entry.single-parent-single*/`vs single`/*@endcopy*/),
    placeholder: (/*@copy analysis-entry.single-parent-placeholder*/`Gene, accession, description, etc.`/*@endcopy*/),
    results: (/*@copy analysis-entry.single-parent-results*/`Mimicry Parents in selected scope`/*@endcopy*/),
    clear: (/*@copy analysis-entry.single-parent-clear*/`Clear protein`/*@endcopy*/),
    choose: (/*@copy analysis-entry.single-parent-choose*/`Choose one Mimicry Parent from the selected library and scope.`/*@endcopy*/),
    empty: (/*@copy analysis-entry.single-parent-empty*/`No matching proteins in the selected library and scope.`/*@endcopy*/),
    failed: (/*@copy analysis-entry.single-parent-failed*/`Parent search stopped: `/*@endcopy*/)
  };

  var renderCustomScope = function () {};
  var createScopeSection, changeScopeSelection;

  var STATIC_PLAYER_BUSY_RETRY_DELAYS = [500, 1000, 2000, 4000, 8000, 16000];
  var LIVE_SCAN_BUSY_RETRY_DELAYS = [500, 1000, 2000, 4000, 8000];
  var STATIC_PLAYER_FLOOR = 7;
  var ANALYSIS_META_TTL_MS = 300000;
  // A reader's own parent sequences travel as an ordinary library target under a reserved
  // key, so every existing kind === "library" branch - filters, labels, routing, history,
  // exports - applies to them unchanged. Only the two places that fetch a population need to
  // know the difference: one supplies rows it already has instead of downloading them.
  var CUSTOM_PARENT_LIBRARY = "__custom_fasta__";
  var CUSTOM_PARENT_SET = "library:" + CUSTOM_PARENT_LIBRARY;
  var CUSTOM_PARENT_LABEL = "Your own FASTA";
  var workspaceSnapshot=null;
  var workspaceLookups=null;
  function customWorkspaceParent(library, filters) {
    return workspaceLookups?.nativeParentLibrary(workspaceSnapshot,library,filters) || null;
  }
  function workspaceOptionLabel(option) {
    return option?.dataset.libraryLabel || option?.textContent || '';
  }
  function refreshWorkspaceLookupOptions() {
    if(!workspaceLookups || !workspaceSnapshot)return;
    var targets=byId('entryTargetSet'), parents=byId('entryTargetLibrary');
    if(!targets || !parents)return;
    var targetLibrary=currentTargetSet().library, parentLibrary=parseParentSet(parents.value).library;
    var target=workspaceLookups.lookupTargetLibrary(workspaceSnapshot,targetLibrary,requestFilter('query',targetLibrary));
    var parent=customWorkspaceParent(parentLibrary,requestFilter('target',parentLibrary));
    // Search opens at the standard 7/9 floor; changing the player floor retains
    // that result's saved higher thresholds, without changing the search route.
    for(var [select,side] of [[targets,'query'],[parents,'target']]){
      select.classList.add('mm-lookup-select');
      for(var option of select.options){
        var library=(side==='query'?parseTargetSet(option.value):parseParentSet(option.value)).library;
        var selectedTarget=side==='query'?workspaceLookups.lookupTargetLibrary(workspaceSnapshot,library,requestFilter(side,library)):target;
        var selectedParent=side==='target'?customWorkspaceParent(library,requestFilter(side,library)):parent;
        var status=workspaceLookups.lookupStatus(workspaceSnapshot,{target:selectedTarget.id,targetSubset:selectedTarget.subset,parent:selectedParent,floor:STATIC_PLAYER_FLOOR});
        option.dataset.libraryLabel=workspaceOptionLabel(option);
        option.textContent=option.dataset.libraryLabel+status.suffix;
        option.dataset.lookupKind=status.kind;
        option.dataset.tooltip=status.title;
      }
      select.dataset.tooltip=select.selectedOptions[0]?.dataset.tooltip || '';
      select.dataset.lookupKind=select.selectedOptions[0]?.dataset.lookupKind || 'none';
    }
  }
  function addWorkspaceLibraries(){
    for(var [key,value] of state.libraries){
      if(value.workspace)state.libraries.delete(key);
      else if(value.workspaceOriginalLabel!==undefined)state.libraries.set(key,{...value,label:value.workspaceOriginalLabel});
    }
    var aliases={'builtin-human':['canonical_human','human_swissprot','human_hormone'],'builtin-exposure':['canonical_exposure'],'builtin-viral120':['atlas_120_viruses'],'builtin-nonvertebrate':['canonical_exposure_no_vertebrates'],'builtin-huprot':['huprot4','huprot'],'builtin-huscan':['huscan','human_current'],'builtin-virscan':['virscan_exposome','virscan_exposome_current']};
    window.MimicryWorkspaceDisplayPreferences={};
    for(var item of workspaceSnapshot?.libraries||[])for(var key of [item.id,'workspace-'+item.id,...(aliases[item.id]||[])]){
      window.MimicryWorkspaceDisplayPreferences[key]=item.display;
      if(item.displayName&&state.libraries.has(key)){
        var original=state.libraries.get(key);
        state.libraries.set(key,{...original,workspaceOriginalLabel:original.label,label:item.displayName});
      }
    }
    for(var library of workspaceSnapshot?.libraries||[])state.libraries.set('workspace-'+library.id,{...library,key:'workspace-'+library.id,label:library.name,workspace:true,live_index:{available:true}});
  }
  function workspaceMenuSignature(snapshot){
    return JSON.stringify((snapshot?.libraries||[]).map(l=>[l.id,l.name,l.category,l.visible,l.sha256,l.stale,l.display,l.annotations?.revision]));
  }
  function refreshWorkspaceMenus(){
    addWorkspaceLibraries();
    var targets=byId('entryTargetSet'),parents=byId('entryTargetLibrary'),custom=byId('entryCustomTarget');
    var previous=[targets?.value,parents?.value,custom?.value];
    if(targets)addTargetSetOptions(targets,previous[0]);
    if(parents)rebuildComparisonOptions(parents,currentTargetSet().library,STATIC_PLAYER_FLOOR,previous[1]);
    if(custom){addLibraryOptions(custom,true);if([...custom.options].some(o=>o.value===previous[2]))custom.value=previous[2];}
    clearSuggestions();
    [targets,parents,custom].forEach(function(select,i){if(select&&select.value!==previous[i])select.dispatchEvent(new Event('change'));});
    refreshWorkspaceLookupOptions();
  }
  function workspaceDefaultParentValue(){
    var id=workspaceSnapshot?.defaultParent;
    if(!id)return fullProteinValue('exposure');
    if(id==='builtin-human')return fullProteinValue('human');
    if(['builtin-viral120','builtin-exposure','builtin-nonvertebrate'].includes(id))return fullProteinValue('exposure');
    var assay={'builtin-huprot':'huprot4','builtin-huscan':'huscan','builtin-virscan':'virscan_exposome'}[id];
    return assay?'library:'+assay:'library:workspace-'+id;
  }
  function appendWorkspaceOptions(select,accept){
    var builtinOptions={'builtin-human':[fullProteinValue('human')],'builtin-exposure':[fullProteinValue('exposure')],'builtin-huprot':['library:huprot4'],'builtin-huscan':['library:huscan'],'builtin-virscan':['library:virscan_exposome']};
    for(var builtin of workspaceSnapshot?.libraries||[])if(builtin.builtin&&builtin.displayName)for(var option of select.options)if(builtinOptions[builtin.id]?.includes(option.value))option.textContent=builtin.displayName;
    var groups=new Map(),labels={canonical:'Canonical Libraries',assay:'Assay Libraries',workspace:'Workspace'};
    for(var l of workspaceSnapshot?.libraries||[]){
      if(l.builtin||l.visible===false)continue;
      var value='library:workspace-'+l.id;if(accept&&!accept(value))continue;
      var label=labels[l.category]||l.category||'Workspace';
      if(!groups.has(label))groups.set(label,[]);groups.get(label).push({value:value,name:l.name});
    }
    for(var label of ['Canonical Libraries','Assay Libraries','Workspace',...groups.keys()].filter((v,i,a)=>a.indexOf(v)===i)){
      if(!groups.has(label))continue;
      var group=Array.from(select.children).find(g=>g.tagName==='OPTGROUP'&&g.label===label);
      if(!group){group=element('optgroup',{label:label});select.appendChild(group);}
      for(var item of groups.get(label))group.appendChild(element('option',{value:item.value},item.name));
    }
  }
  function isCustomParentSet(value) {
    return parseParentSet(value).library === CUSTOM_PARENT_LIBRARY;
  }
  var FULL_PROTEIN_ROUTES = [
    {
      role: "human", library: "canonical_human", fallbackLibrary: "panscan9_human",
      label: (/*@copy analysis-entry.human-proteins.0a9ad82*/`Human proteins`/*@endcopy*/), recordClass: "Human"
    },
    {
      role: "exposure", library: "canonical_exposure", fallbackLibrary: "panscan9_exposure",
      label: (/*@copy analysis-entry.non-human-exposures.c05f552*/`Non-human exposures`/*@endcopy*/), recordClass: "Exposure"
    }
  ];
  // A population that is one scope value of an existing canonical library, served from its
  // own small release because the canonical catalog does not carry the assay library it is
  // compared against. The reader selects the canonical library with that scope pinned; the
  // server rewrites the request to the carrier release and maps record ids. Nothing here
  // offers the carrier as a library, so it never reads as a separate surface.
  var PINNED_SUBSETS = [{
    library: "canonical_exposure",
    partner: "huprot4",
    carrier: "atlas_120_viruses",
    field: "source_collections",
    value: "viral_nonhuman"
  }];
  function pinnedSubsetFor(library, partner) {
    if (!library || !partner) return null;
    return PINNED_SUBSETS.find(function match(rule) {
      return (rule.library === library && rule.partner === partner) ||
        (rule.library === partner && rule.partner === library);
    }) || null;
  }
  function carrierLibrary(library, partner) {
    var rule = pinnedSubsetFor(library, partner);
    return rule && rule.library === library ? rule.carrier : library;
  }

  var V4_MULTI_FILTER_FIELDS = [
    "facets", "source_collections", "source_organisms", "domain_groups",
    "domains", "kingdoms", "phyla", "classes", "orders", "families",
    "genera", "species", "locations", "accessibilities", "regions"
  ];
  var V4_TAXONOMY_FILTER_FIELDS = [
    "domain_groups", "domains", "kingdoms", "phyla", "classes",
    "orders", "families", "genera", "species"
  ];
  var V4_ADVANCED_TAXONOMY_FIELDS = [
    { field: "kingdoms", label: (/*@copy analysis-entry.kingdom.9329af1*/`Kingdom`/*@endcopy*/) },
    { field: "phyla", label: (/*@copy analysis-entry.phylum.a02e130*/`Phylum`/*@endcopy*/) },
    { field: "classes", label: (/*@copy analysis-entry.class.ccbad5f*/`Class`/*@endcopy*/) },
    { field: "orders", label: (/*@copy analysis-entry.order.c398950*/`Order`/*@endcopy*/) },
    { field: "families", label: (/*@copy analysis-entry.family.569f43d*/`Family`/*@endcopy*/) },
    { field: "genera", label: (/*@copy analysis-entry.genus.c279908*/`Genus`/*@endcopy*/) },
    { field: "species", label: (/*@copy analysis-entry.species.c974380*/`Species`/*@endcopy*/) }
  ];
  var setExploreTargetSet = null;
  var syncExploreHistorySettings = null;
  var syncCustomHistorySettings = null;
  var refreshCustomNavigationSettings = function () {};

  function byId(id) { return document.getElementById(id); }

  function element(tag, attributes, value) {
    var node = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function setAttribute(name) {
      if (name === "class") node.className = attributes[name];
      else if (name === "dataset") Object.keys(attributes.dataset).forEach(function data(key) { node.dataset[key] = attributes.dataset[key]; });
      else node.setAttribute(name, attributes[name]);
    });
    if (value != null) node.textContent = String(value);
    return node;
  }

  function first(object, names, fallback) {
    if (!object) return fallback;
    for (var index = 0; index < names.length; index += 1) {
      if (object[names[index]] != null) return object[names[index]];
    }
    return fallback;
  }

  function setNote(node, message, error) {
    if (!node) return;
    node.textContent = message || "";
    node.removeAttribute("data-tooltip");
    node.classList.toggle("err", !!error);
    if (error) node.dataset.state = "error";
    else delete node.dataset.state;
  }

  function fitScopePanel(panel) {
    if (!panel || panel.hidden) return;
    var viewport = window.visualViewport;
    var viewTop = viewport ? viewport.offsetTop : 0;
    var viewHeight = viewport ? viewport.height : window.innerHeight;
    var anchor = panel.closest(".entry-explore-step").getBoundingClientRect();
    var below = viewTop + viewHeight - anchor.bottom - 18;
    var above = anchor.top - viewTop - 18;
    var openAbove = below < Math.min(240, viewHeight * .5) && above > below;
    panel.style.top = openAbove ? "auto" : "calc(100% + 6px)";
    panel.style.bottom = openAbove ? "calc(100% + 6px)" : "auto";
    panel.style.maxHeight = Math.max(0, Math.min(viewHeight * .68, openAbove ? above : below)) + "px";
  }

  function requestControlNodes() {
    return Array.from(document.querySelectorAll([
      "#thbtns button",
      "#mimicmode button",
      "#entryCustomExecution button",
      "#customFloor",
      "#entryCustomTarget",
      "#fasta",
      "#fastaFile",
      "#clearTarget",
      "#runFasta",
      "#clearFasta",
      "#mimicfa",
      "#mimicFile",
      "#clearMimic"
    ].join(",")));
  }

  function syncRequestControlsBusy() {
    var busy = !!(state.scanAbort || state.selectionPending);
    requestControlNodes().forEach(function lock(node) {
      if (busy) {
        if (!Object.prototype.hasOwnProperty.call(node.dataset, "requestWasDisabled")) {
          // The player transition may already own the temporary disabled state.
          // Preserve the underlying availability, not that overlapping lock.
          node.dataset.requestWasDisabled = Object.prototype.hasOwnProperty.call(node.dataset, "targetTransitionWasDisabled")
            ? node.dataset.targetTransitionWasDisabled
            : node.disabled ? "true" : "false";
        }
        node.disabled = true;
      } else if (Object.prototype.hasOwnProperty.call(node.dataset, "requestWasDisabled")) {
        node.disabled = node.dataset.requestWasDisabled === "true";
        delete node.dataset.requestWasDisabled;
      }
    });
  }

  async function fetchJson(path, options) {
    var signal = options && options.signal;
    if (signal && signal.aborted) throw cancelledRequestError();
    var timingStart = performance.now();
    var response = await fetch(path, Object.assign({ cache: "no-store", headers: { Accept: "application/json" } }, options || {}));
    if (signal && signal.aborted) throw cancelledRequestError();
    if (!response.ok) {
      var message = "HTTP " + response.status;
      var code = "";
      var details = null;
      try {
        var body = await response.json();
        if (body && body.error && typeof body.error === "object") {
          if (body.error.message) message = body.error.message;
          code = body.error.code || body.code || "";
          details = body.error.details || body.details || body.error;
        }
        else if (body && typeof body.error === "string") message = body.error;
        else if (body && body.detail) message = typeof body.detail === "object" ? (body.detail.message || message) : body.detail;
        else if (body && body.message) message = body.message;
        if (!code && body) code = body.code || "";
        if (!details && body) details = body.details || body;
      } catch (_error) {}
      var requestError = new Error(String(message));
      requestError.status = response.status;
      requestError.code = String(code || "");
      requestError.details = details;
      throw requestError;
    }
    var headersAt = performance.now();
    var text = await response.text();
    var bodyAt = performance.now();
    var payload = JSON.parse(text);
    if (window.MimicryPerformance && payload && typeof payload === 'object') {
      var server = /prepare;dur=([0-9.]+)/.exec(response.headers.get('server-timing') || '');
      window.MimicryPerformance.network.set(payload, {wait_headers_ms:headersAt-timingStart,
        transfer_decode_ms:bodyAt-headersAt,parse_ms:performance.now()-bodyAt,
        server_prepare_ms:server?Number(server[1]):null,server_cache:response.headers.get('x-mimicry-cache')});
    }
    if (signal && signal.aborted) throw cancelledRequestError();
    return payload;
  }

  async function fetchBootstrapJson(path) {
    if (window.MimicryStartup) return window.MimicryStartup.loadJson(path);
    var controller = new AbortController();
    var timer = window.setTimeout(function expired() { controller.abort(); }, 10000);
    try { return await fetchJson(path, { signal: controller.signal }); }
    finally { window.clearTimeout(timer); }
  }

  function cancelledRequestError() {
    if (typeof DOMException === "function") return new DOMException("Player request canceled.", "AbortError");
    var error = new Error((/*@copy analysis-entry.player-request-canceled.223a331*/`Player request canceled.`/*@endcopy*/));
    error.name = "AbortError";
    return error;
  }

  function waitWithAbort(milliseconds, signal) {
    return new Promise(function wait(resolve, reject) {
      if (signal && signal.aborted) { reject(cancelledRequestError()); return; }
      var timeoutId;
      function cleanup() {
        if (signal) signal.removeEventListener("abort", abort);
      }
      function finish() {
        cleanup();
        resolve();
      }
      function abort() {
        window.clearTimeout(timeoutId);
        cleanup();
        reject(cancelledRequestError());
      }
      if (signal) signal.addEventListener("abort", abort, { once: true });
      timeoutId = window.setTimeout(finish, milliseconds);
    });
  }

  function isStaticPlayerBusy(error) {
    return !!(error && error.status === 429 && error.code === "static_player_busy");
  }

  async function fetchStaticPlayerWithRetry(path, options, signal, onRetry) {
    for (var attempt = 0; ; attempt += 1) {
      try {
        return await fetchJson(path, options);
      } catch (error) {
        if (!isStaticPlayerBusy(error) || attempt >= STATIC_PLAYER_BUSY_RETRY_DELAYS.length) throw error;
        if (signal && signal.aborted) throw cancelledRequestError();
        var delay = STATIC_PLAYER_BUSY_RETRY_DELAYS[attempt];
        if (onRetry) onRetry(attempt + 1, STATIC_PLAYER_BUSY_RETRY_DELAYS.length, delay);
        await waitWithAbort(delay, signal);
      }
    }
  }

  function reportStaticPlayerRetry(note, retry, total, delay) {
    setNote(note, "Another precomputed expansion is finishing; retrying in " + (delay / 1000) + " s (" + retry + "/" + total + ")…");
  }

  function isLiveScanBusy(error) {
    return !!(error && error.status === 429 && error.code === "live_slot_busy");
  }

  async function fetchLiveScanWithRetry(path, options, signal, onRetry) {
    for (var attempt = 0; ; attempt += 1) {
      try {
        return await fetchJson(path, options);
      } catch (error) {
        if (!isLiveScanBusy(error) || attempt >= LIVE_SCAN_BUSY_RETRY_DELAYS.length) throw error;
        if (signal && signal.aborted) throw cancelledRequestError();
        var delay = LIVE_SCAN_BUSY_RETRY_DELAYS[attempt];
        if (onRetry) onRetry(attempt + 1, LIVE_SCAN_BUSY_RETRY_DELAYS.length, delay);
        await waitWithAbort(delay, signal);
      }
    }
  }

  function waitFor(test, timeout, signal) {
    return new Promise(function wait(resolve, reject) {
      var started = Date.now();
      var timer = null, settled = false;
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", abort);
        callback(value);
      }
      function abort() { finish(reject, cancelledRequestError()); }
      if (signal && signal.aborted) { abort(); return; }
      if (signal) signal.addEventListener("abort", abort, {once:true});
      (function check() {
        if (settled) return;
        try {
          var value = test();
          if (value) { finish(resolve, value); return; }
          if (Date.now() - started > timeout) { finish(reject, new Error((/*@copy analysis-entry.timed-out-waiting-for-the.d9460af*/`Timed out waiting for the MimicryMap player.`/*@endcopy*/))); return; }
          timer = window.setTimeout(check, 50);
        } catch(error) { finish(reject, error); }
      })();
    });
  }

  function normalizeAnalysisMeta(meta) {
    var fingerprint = first(meta, ["release_fingerprint", "release_id"], "");
    var sourceFilters = meta.source_filters && meta.source_filters.libraries
      ? meta.source_filters : { available: false, libraries: {} };
    var filterPolicyFingerprint = String(sourceFilters.filter_policy_fingerprint || "");
    if ((state.releaseFingerprint && fingerprint && state.releaseFingerprint !== fingerprint) ||
        (state.filterPolicyFingerprint && filterPolicyFingerprint &&
         state.filterPolicyFingerprint !== filterPolicyFingerprint)) {
      var changedNote = byId(state.pendingRoute && state.pendingRoute.noteId ||
        state.selectionSession && state.selectionSession.noteId || "loadnote");
      cancelPendingSelection();
      if (state.searchAbort) state.searchAbort.abort();
      state.searchAbort = null;
      window.clearTimeout(state.searchTimer);
      clearSuggestions();
      state.staticCache.clear();
      state.activeRoute = null;
      state.pendingRoute = null;
      state.searchCache.clear();
      setNote(changedNote, "The library release or scope definitions changed. Select an Antigen Target again to load the current data; the previous result has not been relabeled.", true);
    }
    state.releaseFingerprint = fingerprint;
    state.filterPolicyFingerprint = filterPolicyFingerprint;
    var primaryComponent = (meta.component_releases || []).find(function primary(row) {
      return row && row.primary === true;
    });
    state.primaryComponentKey = String(primaryComponent && primaryComponent.key || "");
    state.libraries.clear();
    (meta.libraries || []).forEach(function add(library) {
      var key = first(library, ["key", "code", "library_id"], "");
      if (key) state.libraries.set(key, library);
    });
    var capabilities = meta.compute_capabilities || {};
    var live = capabilities.modes && capabilities.modes.live;
    var endpoint = capabilities.endpoints && capabilities.endpoints.unified_scan;
    var limits = capabilities.limits || {};
    state.live = live && endpoint ? {
      endpoint: endpoint,
      floors: (live.floors || []).map(Number),
      privacyNotice: live.privacy_notice || "",
      maxQueryWindows: Number(limits.query_windows || 128)
    } : null;
    var canonicalLive7 = capabilities.modes && capabilities.modes.canonical_parent_live7;
    state.canonicalLive7 = canonicalLive7 && canonicalLive7.available === true && endpoint ? {
      endpoint: endpoint,
      floor: Number(canonicalLive7.floor),
      targetLibraries: new Set(canonicalLive7.available_target_libraries || [])
    } : null;
    var canonicalIndex = capabilities.modes && capabilities.modes.canonical_proteome_index;
    state.canonicalIndex = canonicalIndex && endpoint ? {
      endpoint: endpoint,
      available: canonicalIndex.available === true,
      schema: canonicalIndex.schema || "",
      floors: (canonicalIndex.floors || []).map(Number),
      partitions: canonicalIndex.partitions || {},
      reason: canonicalIndex.reason || "canonical parent index unavailable"
    } : null;
    var staticPlayer = meta.static_player || {};
    state.staticPlayer = {
      endpoint: staticPlayer.route || (capabilities.endpoints && capabilities.endpoints.static_player) || "/api/analysis/player",
      available: staticPlayer.available !== false
    };
    state.sourceFilters = sourceFilters;
    state.staticPairs.clear();
    (meta.comparisons || []).forEach(function addComparison(comparison) {
      var libraryA = first(comparison, ["library_a", "a"], "");
      var libraryB = first(comparison, ["library_b", "b"], "");
      if (libraryA && libraryB && comparison.queryable !== false) {
        state.staticPairs.add([libraryA, libraryB].sort().join("\u0000"));
      }
    });
    state.analysisMetaUpdatedAt = Date.now();
    addWorkspaceLibraries();
  }

  function pausePlayerForSelection() {
    if (window.MimicryOne && typeof window.MimicryOne.pausePlayback === "function") {
      window.MimicryOne.pausePlayback();
    }
  }

  function beginSelection(note, identity, descriptor, activeNode) {
    cancelPendingSelection();
    pausePlayerForSelection();
    if (state.searchAbort) state.searchAbort.abort();
    state.searchAbort = null;
    var session = {
      identity: identity || "selection",
      noteId: note && note.id || "loadnote",
      token: {},
      controller: new AbortController(),
      committed: false,
      activeNode: activeNode || null,
      transitionToken: null
    };
    state.selectionSession = session;
    state.selectionPending = session.token;
    state.selectionAbort = session.controller;
    if (activeNode) activeNode.setAttribute("aria-current", "true");
    if (window.MimicryOne && typeof window.MimicryOne.beginTargetTransition === "function") {
      session.transitionToken = window.MimicryOne.beginTargetTransition(descriptor || {});
    }
    syncRequestControlsBusy();
    var cancel = byId(identity === "custom" ? "cancelFasta" : "catalogCancel");
    if (cancel) cancel.hidden = false;
    return session;
  }

  function cancelPendingSelection() {
    state.requestRevision++;
    if (state.selectionAbort) state.selectionAbort.abort();
    if (state.scanAbort) state.scanAbort.abort();
    if (state.selectionSession) endSelection(state.selectionSession);
    state.selectionAbort = null;
    state.selectionPending = null;
    state.selectionSession = null;
    state.scanAbort = null;
    state.pendingRoute = null;
    syncRequestControlsBusy();
    var cancel = byId("catalogCancel");
    if (cancel) cancel.hidden = true;
    var customCancel = byId("cancelFasta");
    if (customCancel) customCancel.hidden = true;
  }

  function selectionIsCurrent(session) {
    return !!session && state.selectionPending === session.token &&
      !session.controller.signal.aborted;
  }

  function endSelection(session) {
    if (!session || state.selectionPending !== session.token) return;
    state.selectionPending = null;
    state.selectionAbort = null;
    state.selectionSession = null;
    syncRequestControlsBusy();
    if (session.activeNode) session.activeNode.removeAttribute("aria-current");
    if (session.transitionToken && window.MimicryOne &&
        typeof window.MimicryOne.finishTargetTransition === "function") {
      window.MimicryOne.finishTargetTransition(
        session.transitionToken,
        session.committed === true,
        session.failureMessage || ""
      );
    }
    var cancel = byId("catalogCancel");
    if (cancel && !state.scanAbort) cancel.hidden = true;
    var customCancel = byId("cancelFasta");
    if (customCancel && !state.scanAbort) customCancel.hidden = true;
  }

  function libraryLabel(key) {
    if (key === CUSTOM_PARENT_LIBRARY) return CUSTOM_PARENT_LABEL;
    return first(state.libraries.get(key), ["label", "name", "title"], key);
  }

  // Visibility is separate from mounted records and full-protein projections.
  // Keep internal metadata available to the existing parent/mapping routes.
  function isPublicAssayLibrary(key) {
    return !key.startsWith('workspace-') && !state.internalOnlyLibraries.has(key);
  }

  function isCanonicalAnalysisLibrary(key) {
    return FULL_PROTEIN_ROUTES.some(function canonical(entry) {
      return entry.library === key;
    });
  }

  function fullProteinOptions() {
    return FULL_PROTEIN_ROUTES.map(function route(entry) {
      if (state.libraries.has(entry.library)) {
        return Object.assign({}, entry, {
          value: "library:" + entry.library,
          componentKey: componentKeyFor(state.libraries.get(entry.library)) || null,
          native: true
        });
      }
      if (state.libraries.has(entry.fallbackLibrary)) {
        return Object.assign({}, entry, {
          value: "protein:" + entry.fallbackLibrary,
          library: entry.fallbackLibrary,
          componentKey: componentKeyFor(state.libraries.get(entry.fallbackLibrary)) || null,
          native: false
        });
      }
      return null;
    }).filter(Boolean);
  }

  function fullProteinOption(value) {
    var normalized = parseParentSet(value).value;
    return fullProteinOptions().find(function matching(entry) {
      return entry.value === normalized;
    }) || null;
  }

  function fullProteinValue(role) {
    var option = fullProteinOptions().find(function matching(entry) {
      return entry.role === role;
    });
    return option ? option.value : "";
  }

  function parseParentSet(value) {
    var normalized = String(value || "");
    var separator = normalized.indexOf(":");
    if (separator < 0) return { kind: "library", library: normalized, value: "library:" + normalized };
    var prefix = normalized.slice(0, separator);
    var library = normalized.slice(separator + 1);
    return {
      kind: prefix === "protein" ? "canonical_proteome" : "library",
      library: library,
      value: (prefix === "protein" ? "protein:" : "library:") + library
    };
  }

  function parentLibrary(value) {
    return parseParentSet(value).library;
  }

  function parentSetLabel(value) {
    var parsed = parseParentSet(value);
    var canonical = fullProteinOption(parsed.value);
    if (canonical) return canonical.label;
    if (parsed.kind === "canonical_proteome") return "Full proteins";
    return libraryLabel(parsed.library);
  }

  function canonicalParentSet(value) {
    return parseParentSet(value).kind === "canonical_proteome";
  }

  function filterOptions(key) {
    return state.sourceFilters && state.sourceFilters.libraries
      ? state.sourceFilters.libraries[key] || null
      : null;
  }

  function isV4FilterOptions(options) {
    return !!(options && (
      options.facets || options.domain_groups || options.min_references ||
      options.exclude_mammals
    ));
  }

  function scopeDependencyEngine() {
    var engine=window.MimicryScopeDependencies;
    return engine && engine.matches(state.filterPolicyFingerprint) ? engine : null;
  }

  function dependentScopeOptions(key, value) {
    var original=filterOptions(key), engine=scopeDependencyEngine();
    if (!engine || !engine.has(key)) return original;
    var options=Object.assign({},original), available=engine.inspect(key,value).available;
    Object.keys(available).forEach(function(field){
      var names=field==="genera"?["top_genera","genera"]:field==="species"?["top_species","species"]:[field];
      var entries=optionEntries(original,names).filter(function(item){ return available[field].indexOf(item.value)>=0; });
      names.forEach(function(name){options[name]=entries;});
    });
    return options;
  }

  function reconcileScope(key, value, changed) {
    var engine=scopeDependencyEngine();
    if (!engine || !engine.has(key)) return;
    var field=changed==="taxonomy_groups" || changed==="taxonomy_all"
      ? (isV4FilterOptions(filterOptions(key))?"domain_groups":"domains")
      : changed==="legacy_collection_modes" ? "legacy_sources" : changed;
    var result=engine.inspect(key,value,field);
    var groups=(value.domain_groups || []).length ? value.domain_groups
      : (value.domains || []).length ? value.domains : result.available.domain_groups || result.available.domains || [];
    if (groups.length && groups.indexOf("Eukaryota")<0) {
      if (value.exclude_mammals) result.cleared.push({value:"Exclude mammals"});
      value.exclude_mammals=false;
      if (value.exclude_vertebrates) result.cleared.push({value:(/*@copy analysis-entry.exclude-vertebrates-label*/`Exclude vertebrates`/*@endcopy*/)});
      value.exclude_vertebrates=false;
    }
    if (isV4FilterOptions(filterOptions(key)) && groups.indexOf("Unclassified")<0) value.include_unclassified=false;
    if (!(value.facets || []).includes("iedb") && !((value.source_collections || []).length===1 && value.source_collections[0]==="iedb_nonhuman")) {
      if (value.min_references!=null) result.cleared.push({value:"IEDB reference threshold"});
      value.min_references=null;
    }
    value.scopeNotice=result.cleared.length ? "Cleared incompatible refinements: "+result.cleared.map(function(item){return item.value;}).join(", ")+"." : "";
  }

  function filterBooleanDefault(options, field) {
    var specification = options && options[field];
    return !!(specification && typeof specification === "object" &&
      specification.default === true);
  }

  function optionEntries(options, names) {
    var raw = null;
    (Array.isArray(names) ? names : [names]).some(function find(name) {
      if (options && options[name] != null) {
        raw = options[name];
        return true;
      }
      return false;
    });
    if (!raw) return [];
    if (!Array.isArray(raw)) {
      return Object.keys(raw).map(function mapOption(value) {
        return { value: value, label: value, count: raw[value] };
      });
    }
    return raw.map(function mapOption(item) {
      if (typeof item === "string") return { value: item, label: item, count: null };
      if (Array.isArray(item)) return { value: String(item[0]), label: String(item[0]), count: item[1] };
      return {
        value: String(item.value || item.name || item.label || ""),
        label: String(item.label || item.value || item.name || ""),
        count: item.count
      };
    }).filter(function valid(item) { return !!item.value; });
  }

  function allOptionValues(options, names) {
    return optionEntries(options, names).map(function value(item) { return item.value; });
  }

  var TAXONOMY_DOMAIN_ORDER = ["Viruses", "Eukaryota", "Bacteria", "Archaea"];

  function taxonomyUnresolvedCount(options) {
    return Number(first(options,
      ["taxonomy_unresolved", "unclassified", "unresolved_taxonomy", "unresolved"], 0));
  }

  function availableTaxonomyDomains(options) {
    var available = new Set(allOptionValues(options, "domains"));
    var ordered = TAXONOMY_DOMAIN_ORDER.filter(function present(item) {
      return available.has(item);
    });
    available.forEach(function appendOther(item) {
      if (ordered.indexOf(item) < 0) ordered.push(item);
    });
    return ordered;
  }

  function migrateTaxonomyState(options, value) {
    var available = availableTaxonomyDomains(options);
    if (!Array.isArray(value.domains)) {
      var legacyModes = {
        viruses: ["Viruses"],
        eukaryotes: ["Eukaryota"],
        bacteria: ["Bacteria"],
        archaea: ["Archaea"],
        non_eukaryotes: ["Viruses", "Bacteria", "Archaea"]
      };
      var legacyMode = value.domain_mode || "all";
      value.domains = legacyMode === "all"
        ? available.slice()
        : (legacyModes[legacyMode] || []).filter(function supported(item) {
          return available.indexOf(item) >= 0;
        });
      if (legacyMode === "all") {
        value.include_unclassified = taxonomyUnresolvedCount(options) > 0;
      }
    }
    value.domains = Array.from(new Set(value.domains)).filter(function supported(item) {
      return available.indexOf(item) >= 0;
    });
    if (!value.domains.length && available.length) value.domains = available.slice();
    if (typeof value.include_unclassified !== "boolean") {
      value.include_unclassified = taxonomyUnresolvedCount(options) > 0;
    }
    value.include_controls = false;
    delete value.domain_mode;
    return value;
  }

  var LEGACY_COLLECTION_LIBRARY = "virscan_exposome_current";
  var LEGACY_COLLECTION_DEFAULTS = ["cdiv2_human", "cdiv2_other", "cdiv3_exposome"];

  function legacyHumanSubsetMetadata() {
    var filters = state.sourceFilters || {};
    var options = filterOptions(LEGACY_COLLECTION_LIBRARY) || {};
    var component = filters.components && filters.components[options.component_key] || {};
    var legacy = component.legacy || filters.legacy || {};
    return legacy.human_subset || {};
  }

  function deriveLegacyCollectionModes(value) {
    var modes;
    if (Array.isArray(value.legacy_collection_modes)) {
      var saved = new Set(value.legacy_collection_modes);
      // A saved full-CDIV2 choice now checks both complementary subsets.
      if (saved.has("cdiv2_all")) {
        saved.add("cdiv2_human");
        saved.add("cdiv2_other");
      }
      modes = LEGACY_COLLECTION_DEFAULTS.filter(function selected(mode) { return saved.has(mode); });
    } else {
      var sources = new Set(value.legacy_sources || []);
      var statuses = new Set(value.human_tropism_statuses || []);
      var subsetStatus = legacyHumanSubsetMetadata().selectable_status || "included";
      modes = [];
      if (!sources.size || sources.has("virscan_legacy")) {
        if (!statuses.size || statuses.has(subsetStatus)) modes.push("cdiv2_human");
        if (!statuses.size || statuses.has("not_included")) modes.push("cdiv2_other");
      }
      if ((!sources.size || sources.has("exposome_legacy")) &&
          (!statuses.size || statuses.has("unlabelled"))) modes.push("cdiv3_exposome");
    }
    value.legacy_collection_modes = modes.length ? modes : LEGACY_COLLECTION_DEFAULTS.slice();
    return value.legacy_collection_modes;
  }

  /* The three disjoint collections compile to the existing source/status
     filters. Selecting both CDIV2 subsets preserves the full-CDIV2 request. */
  function syncLegacyCollectionFilters(value) {
    var modes = new Set(deriveLegacyCollectionModes(value));
    var useHumanCdiv2 = modes.has("cdiv2_human");
    var useOtherCdiv2 = modes.has("cdiv2_other");
    var useCdiv3 = modes.has("cdiv3_exposome");
    value.legacy_sources = [];
    if (useHumanCdiv2 || useOtherCdiv2) value.legacy_sources.push("virscan_legacy");
    if (useCdiv3) value.legacy_sources.push("exposome_legacy");
    value.human_tropism_statuses = [];
    if (useHumanCdiv2 !== useOtherCdiv2) {
      value.human_tropism_statuses.push(useHumanCdiv2
        ? legacyHumanSubsetMetadata().selectable_status || "included" : "not_included");
      if (useCdiv3) value.human_tropism_statuses.push("unlabelled");
    }
  }

  var CANONICAL_HUMAN_FACET_COLLECTION = {
    swissprot: "human_canonical_swissprot",
    hormone: "hormone_fasta"
  };

  function normalizeV4FilterState(options, value, key) {
    V4_MULTI_FILTER_FIELDS.forEach(function normalize(field) {
      var allowed = allOptionValues(options, field);
      value[field] = Array.from(new Set(Array.isArray(value[field]) ? value[field] : []))
        .filter(function supported(item) { return allowed.indexOf(item) >= 0; });
    });
    ["include_unclassified", "exclude_mammals", "exclude_vertebrates"].forEach(function normalize(field) {
      if (typeof value[field] !== "boolean") value[field] = filterBooleanDefault(options, field);
    });
    var thresholds = allOptionValues(options, "min_references").map(Number);
    var threshold = Number(value.min_references);
    value.min_references = thresholds.indexOf(threshold) >= 0 ? threshold : null;
    if (key === "canonical_human") {
      /* Collapse equivalent OR groups only when one contains the other.
         Different provenance rows can belong to one parent: disjoint names
         do NOT prove an empty parent intersection. Preserve that AND clause. */
      var collections = [];
      value.facets.forEach(function promoteDuplicateFacet(facet) {
        var collection = CANONICAL_HUMAN_FACET_COLLECTION[facet];
        if (collection) collections.push(collection);
      });
      if (collections.length === value.facets.length && collections.length) {
        if (!value.source_collections.length || collections.every(function within(collection) {
          return value.source_collections.indexOf(collection) >= 0;
        })) {
          value.source_collections = Array.from(new Set(collections));
          value.facets = [];
        } else if (value.source_collections.every(function within(collection) {
          return collections.indexOf(collection) >= 0;
        })) {
          value.facets = [];
        }
      }
    }
    value.include_controls = false;
    return value;
  }

  function v4TaxonomyNarrowed(value) {
    return V4_TAXONOMY_FILTER_FIELDS.some(function selected(field) {
      return !!(value[field] && value[field].length);
    });
  }

  function v4FieldVisibleForLibrary(field, key) {
    if (key !== "canonical_human") return true;
    return field !== "facets" && field !== "source_organisms" &&
      V4_TAXONOMY_FILTER_FIELDS.indexOf(field) < 0;
  }

  function activeFilter(side, key) {
    var options = filterOptions(key);
    if (!options) {
      if ((side === "custom" || side === "target") && state.libraries.has(key)) return state.filterState[side][key] || (state.filterState[side][key] = {});
      return null;
    }
    var store = state.filterState[side];
    if (!store[key]) {
      store[key] = isV4FilterOptions(options)
        ? normalizeV4FilterState(options, key === "canonical_exposure" ? { source_collections: ["viral_nonhuman"] } : {}, key)
        : {
          sublibraries: allOptionValues(options, "sublibraries"),
          legacy_sources: allOptionValues(options, ["legacy_sources", "legacy_source_libraries"]),
          domains: availableTaxonomyDomains(options),
          include_unclassified: taxonomyUnresolvedCount(options) > 0,
          genera: [],
          species: [],
          human_tropism_statuses: [],
          variant_sources: [],
          include_controls: false
        };
    }
    if (isV4FilterOptions(options)) return normalizeV4FilterState(options, store[key], key);
    migrateTaxonomyState(options, store[key]);
    if (key === LEGACY_COLLECTION_LIBRARY) {
      deriveLegacyCollectionModes(store[key]);
      syncLegacyCollectionFilters(store[key]);
    }
    return store[key];
  }

  // Hold a pinned pairing at its one collection. The state really is pinned rather than the
  // request being doctored later, so the Scope control reports the ordinary filtered state
  // and the value the reader sees is the value that is sent.
  function applyPinnedScope(side, library, partner) {
    var rule = pinnedSubsetFor(library, partner);
    if (!rule || rule.library !== library) return false;
    var options = filterOptions(library);
    if (!options) return false;
    var current = state.filterState[side][library] ||
      normalizeV4FilterState(options, {}, library);
    var pinned = normalizeV4FilterState(options, {
      source_collections: [rule.value],
      species: (current.species || []).slice(),
      source_organisms: (current.source_organisms || []).slice()
    }, library);
    pinned.singleMode = current.singleMode;
    pinned.singleRecord = current.singleRecord;
    state.filterState[side][library] = pinned;
    return true;
  }

  function requestFilter(side, key, excludeSingle) {
    var filters = scopeRequestFilter(side, key);
    var value = activeFilter(side, key);
    if (!excludeSingle && (side === "target" || side === "custom") && value && value.singleMode) {
      filters = Object.assign({}, filters || {}, {
        record_ids: value.singleRecord ? [value.singleRecord.id] : []
      });
    }
    return filters;
  }

  function scopeRequestFilter(side, key) {
    var value = activeFilter(side, key);
    var options = filterOptions(key);
    if (!value || !options) return null;
    if (isV4FilterOptions(options)) {
      var v4Output = { include_controls: false };
      V4_MULTI_FILTER_FIELDS.forEach(function optional(field) {
        if ((field === "domain_groups" || field === "source_collections") && allOptionValues(options, field).length &&
            allOptionValues(options, field).every(function included(group) {
              return (value[field] || []).indexOf(group) >= 0;
            })) return;
        if ((v4FieldVisibleForLibrary(field, key) || (key === "canonical_human" && field === "facets")) &&
            value[field] && value[field].length) {
          v4Output[field] = value[field].slice().sort();
        }
      });
      if (key !== "canonical_human" && value.exclude_vertebrates === true) v4Output.exclude_vertebrates = true;
      if (key !== "canonical_human" && !value.exclude_vertebrates && value.exclude_mammals === true) {
        v4Output.exclude_mammals = true;
      }
      if (key !== "canonical_human" &&
          value.include_unclassified === true && v4TaxonomyNarrowed(v4Output)) {
        v4Output.include_unclassified = true;
      }
      if (((value.facets || []).indexOf("iedb") >= 0 ||
          ((value.source_collections || []).length===1 && value.source_collections[0]==="iedb_nonhuman")) && value.min_references != null) {
        v4Output.min_references = Number(value.min_references);
      }
      return v4Output;
    }
    if (key === LEGACY_COLLECTION_LIBRARY) syncLegacyCollectionFilters(value);
    var output = { include_controls: false };
    var sublibraries = (value.sublibraries || []).slice().sort();
    var legacySources = (value.legacy_sources || []).slice().sort();
    if (legacySources.length) output.legacy_sources = legacySources;
    else if (sublibraries.length) output.sublibraries = sublibraries;
    var availableDomains = availableTaxonomyDomains(filterOptions(key));
    var selectedDomains = (value.domains || []).filter(function supported(item) {
      return availableDomains.indexOf(item) >= 0;
    }).sort();
    var includesEveryDomain = selectedDomains.length === availableDomains.length;
    var includesEveryRow = includesEveryDomain &&
      (taxonomyUnresolvedCount(filterOptions(key)) === 0 || value.include_unclassified === true);
    if (availableDomains.length && !includesEveryRow) {
      output.domains = selectedDomains;
      output.include_unclassified = value.include_unclassified === true;
    }
    ["genera", "species", "human_tropism_statuses"].forEach(function optional(field) {
      if (value[field] && value[field].length) output[field] = value[field].slice().sort();
    });
    if (value.variant_sources && value.variant_sources.length &&
        sublibraries.length === 1 && sublibraries[0] === "Tumor") {
      output.variant_sources = value.variant_sources.slice().sort();
    }
    if (value.humsavar_significance && value.humsavar_significance.length &&
        sublibraries.length === 1 && sublibraries[0] === "humsavar") {
      output.humsavar_significance = value.humsavar_significance.slice().sort();
    }
    return output;
  }

  function filterIsConstrained(side, key) {
    var options = filterOptions(key);
    var value = activeFilter(side, key);
    if (!options || !value) return false;
    if (isV4FilterOptions(options)) {
      var filters = requestFilter(side, key) || {};
      return Object.keys(filters).some(function active(field) {
        return field !== "include_controls" &&
          (Array.isArray(filters[field]) ? filters[field].length > 0 : !!filters[field]);
      });
    }
    var legacyOptionCount =
      optionEntries(options, ["legacy_sources", "legacy_source_libraries"]).length;
    var availableDomains = availableTaxonomyDomains(options);
    var selectedDomains = new Set(value.domains || []);
    var taxonomyConstrained = availableDomains.some(function missing(item) {
      return !selectedDomains.has(item);
    }) || (taxonomyUnresolvedCount(options) > 0 && value.include_unclassified !== true);
    return taxonomyConstrained ||
      !!(value.genera && value.genera.length) ||
      !!(value.species && value.species.length) ||
      !!(value.human_tropism_statuses && value.human_tropism_statuses.length) ||
      (!legacyOptionCount &&
        value.sublibraries.length !== optionEntries(options, "sublibraries").length) ||
      (legacyOptionCount && value.legacy_sources.length !== legacyOptionCount) ||
      !!(value.sublibraries.length === 1 && value.sublibraries[0] === "Tumor" &&
         value.variant_sources &&
         value.variant_sources.length !==
           optionEntries(options, "variant_sources").filter(function tumor(item) {
             return item.value !== "humsavar";
           }).length) ||
      !!(value.humsavar_significance &&
         value.humsavar_significance.length !==
           optionEntries(options, "humsavar_significance").length);
  }

  function stableFilterKey(value) {
    if (!value) return "all";
    return JSON.stringify(value);
  }

  function clonePlain(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_error) { return value; }
  }

  function targetSetForPlan(plan) {
    if (!plan || !plan.builtIn || !plan.sourceLibrary) return null;
    var kind = plan.liveQuery && plan.liveQuery.kind === "library" ? "library" : "protein";
    return targetSetValue(kind,
      plan.sourceLibrary);
  }

  function selectedParentLabel(targetLibrary, builtIn) {
    var parent = parseParentSet(targetLibrary), value = activeFilter(builtIn ? "target" : "custom", parent.library);
    return value && value.singleMode && value.singleRecord ? value.singleRecord.label : parentSetLabel(parent.value);
  }

  function captureHistoryUiContext(plan, targetLibrary, floor) {
    var sourceLibrary = plan && plan.sourceLibrary || null;
    var parentSet = parseParentSet(targetLibrary);
    return {
      origin: plan && plan.builtIn ? "explore" : "custom",
      componentKey: plan && plan.componentKey || null,
      targetSet: targetSetForPlan(plan),
      sourceLibrary: sourceLibrary,
      targetLibrary: parentSet.value,
      targetLibraryLabel: selectedParentLabel(parentSet.value, plan && plan.builtIn),
      floor: Number(floor),
      queryFilterState: sourceLibrary ? clonePlain(state.filterState.query[sourceLibrary] || null) : null,
      targetFilterState: parentSet.kind === "library"
        ? clonePlain(state.filterState[plan && plan.builtIn ? "target" : "custom"][parentSet.library] || null)
        : null
    };
  }

  function historyContextForRoute(route) {
    if (!route) return null;
    var ui = clonePlain(route.historyUiContext || captureHistoryUiContext(
      route.plan, route.targetLibrary,
      route.floor || route.plan && route.plan.floor || STATIC_PLAYER_FLOOR
    ));
    return {
      releaseFingerprint: state.releaseFingerprint,
      filterPolicyFingerprint: state.filterPolicyFingerprint,
      origin: ui.origin,
      componentKey: ui.componentKey || route.plan && route.plan.componentKey || null,
      targetSet: ui.targetSet,
      sourceLibrary: ui.sourceLibrary,
      targetLibrary: ui.targetLibrary,
      targetLibraryLabel: ui.targetLibraryLabel || parentSetLabel(ui.targetLibrary),
      floor: ui.floor,
      queryFilterState: ui.queryFilterState,
      targetFilterState: ui.targetFilterState,
      route: {
        plan: clonePlain(route.plan),
        targetLibrary: route.targetLibrary,
        targetFilters: clonePlain(route.targetFilters),
        queryContext: clonePlain(route.queryContext),
        noteId: route.noteId,
        proteinId: route.proteinId,
        resultId: route.resultId,
        floor: Number(ui.floor),
        historyUiContext: ui,
        releaseFingerprint: route.releaseFingerprint || state.releaseFingerprint,
        filterPolicyFingerprint: route.filterPolicyFingerprint || state.filterPolicyFingerprint
      }
    };
  }

  function restoreHistoryRoute(context) {
    if (!context || !context.route) return false;
    if (context.releaseFingerprint && state.releaseFingerprint &&
        context.releaseFingerprint !== state.releaseFingerprint) {
      setNote(byId("loadnote"), "This History result belongs to a different MimicryMap release.", true);
      return false;
    }
    if (state.filterPolicyFingerprint &&
        context.filterPolicyFingerprint !== state.filterPolicyFingerprint) {
      setNote(byId("loadnote"), "This History result belongs to an older source-filter policy.", true);
      return false;
    }
    cancelPendingSelection();
    if (context.sourceLibrary && context.queryFilterState) {
      state.filterState.query[context.sourceLibrary] = clonePlain(context.queryFilterState);
    }
    if (context.targetLibrary && context.targetFilterState &&
        (context.origin === "custom" || !canonicalParentSet(context.targetLibrary))) {
      state.filterState[context.origin === "custom" ? "custom" : "target"][parentLibrary(context.targetLibrary)] = clonePlain(context.targetFilterState);
    }
    state.pendingRoute = null;
    state.waitingSingleRoute = null;
    state.activeRoute = Object.assign({}, clonePlain(context.route), {
      releaseFingerprint: state.releaseFingerprint || context.releaseFingerprint
    });
    if (context.origin === "custom" && syncCustomHistorySettings) {
      syncCustomHistorySettings(context);
    } else if (syncExploreHistorySettings) {
      syncExploreHistorySettings(context);
    }
    return true;
  }

  // The desktop's browser history owns drafts as well as completed comparisons.
  // Restore controls directly: dispatching change would start a new calculation.
  function captureNavigationInputs() {
    var values = {};
    ["entryTargetSet", "entryTargetLibrary", "entryCustomTarget", "customFloor",
      "pexploresearch", "fasta", "mimicfa", "entryParentProteinSearch",
      "entryCustomParentProteinSearch"].forEach(function (id) {
      if (byId(id)) values[id] = byId(id).value;
    });
    return { values: values, filterState: clonePlain(state.filterState),
      customExecution: state.customExecution, customFloors: clonePlain(state.customFloors),
      mimicMode: window.MIMIC_MODE };
  }

  function restoreNavigationInputs(saved) {
    if (!saved) return;
    cancelPendingSelection();
    state.pendingRoute = null;
    state.waitingSingleRoute = null;
    if (saved.filterState) state.filterState = clonePlain(saved.filterState);
    var values = saved.values || {};
    if (syncExploreHistorySettings) syncExploreHistorySettings({
      targetSet: values.entryTargetSet, targetLibrary: values.entryTargetLibrary
    }, true);
    if (["indexed", "local"].indexOf(saved.customExecution) >= 0) state.customExecution = saved.customExecution;
    if (saved.customFloors) state.customFloors = clonePlain(saved.customFloors);
    if (saved.mimicMode) window.MIMIC_MODE = saved.mimicMode;
    Object.keys(values).forEach(function (id) { if (byId(id)) byId(id).value = values[id]; });
    refreshCustomNavigationSettings();
  }

  function parentClassForSourceLibrary(key) {
    var canonical = FULL_PROTEIN_ROUTES.find(function matching(entry) {
      return entry.library === key || entry.fallbackLibrary === key;
    });
    if (canonical) return canonical.recordClass;
    return "";
  }

  function targetSetValue(kind, library) {
    if (isCanonicalAnalysisLibrary(library)) return "library:" + library;
    return (kind === "library" ? "library:" : "protein:") + library;
  }

  function parseTargetSet(value) {
    var parts = String(value || "").split(":");
    var library = parts.slice(1).join(":") || "panscan9_human";
    return {
      kind: parts[0] === "library" && !isCanonicalAnalysisLibrary(library) ? "library" : "protein",
      library: library
    };
  }

  function currentTargetSet() {
    var select = byId("entryTargetSet");
    return parseTargetSet(select && select.value);
  }

  function addTargetSetOptions(select, preferred) {
    select.replaceChildren();
    var whole = element("optgroup", { label: (/*@copy analysis-entry.full-proteins.97238cb*/`Canonical Libraries`/*@endcopy*/) });
    fullProteinOptions().forEach(function addCanonical(item) {
      whole.appendChild(element("option", { value: item.value }, item.label));
    });
    if (whole.children.length) select.appendChild(whole);

    var nativeEntries = element("optgroup", { label: (/*@copy analysis-entry.assay-tile-libraries.a118897*/`Assay Libraries`/*@endcopy*/) });
    state.libraries.forEach(function add(_library, key) {
      if (isCanonicalAnalysisLibrary(key) || !isPublicAssayLibrary(key)) return;
      nativeEntries.appendChild(element("option", {
        value: "library:" + key
      }, libraryLabel(key)));
    });
    if (nativeEntries.children.length) select.appendChild(nativeEntries);
    appendWorkspaceOptions(select);
    if (preferred && Array.from(select.options).some(function matches(option) {
      return option.value === preferred;
    })) select.value = preferred;
  }

  function liveAvailable(key, floor) {
    var library = state.libraries.get(key) || {};
    return !!(state.live && state.live.floors.indexOf(Number(floor)) >= 0 &&
      library.live_index && library.live_index.available === true);
  }

  function liveReason(key) {
    return first((state.libraries.get(key) || {}).live_index, ["reason"], "indexed library unavailable");
  }

  function canonicalLive7Available(key) {
    var library = state.libraries.get(key) || {};
    return !!(state.canonicalLive7 &&
      state.canonicalLive7.floor === STATIC_PLAYER_FLOOR &&
      state.canonicalLive7.targetLibraries.has(key) &&
      library.live_index && library.live_index.available === true);
  }

  function canonicalIndexAvailable(floor) {
    return !!(state.canonicalIndex && state.canonicalIndex.available === true &&
      state.canonicalIndex.schema === "mimicryone/canonical-parent-live-index/1" &&
      state.canonicalIndex.floors.indexOf(Number(floor)) >= 0);
  }

  function addLibraryOptions(select, browserLocal) {
    select.replaceChildren();
    var canonical = element("optgroup", { label: (/*@copy analysis-entry.full-proteins.6389d79*/`Canonical Libraries`/*@endcopy*/) });
    fullProteinOptions().forEach(function addCanonical(item) {
      canonical.appendChild(element("option", { value: item.value }, item.label));
    });
    if (canonical.children.length) select.appendChild(canonical);
    var nativeEntries = element("optgroup", { label: (/*@copy analysis-entry.assay-tile-libraries.4fc8c12*/`Assay Libraries`/*@endcopy*/) });
    state.libraries.forEach(function add(library, key) {
      if (isCanonicalAnalysisLibrary(key) || !isPublicAssayLibrary(key)) return;
      var suffix = browserLocal || (library.live_index && library.live_index.available) ? "" : " · live index pending";
      nativeEntries.appendChild(element("option", { value: "library:" + key }, libraryLabel(key) + suffix));
    });
    if (nativeEntries.children.length) select.appendChild(nativeEntries);
    appendWorkspaceOptions(select);
  }

  function clearSuggestions() {
    state.suggestions.clear();
    var results = byId("pexploreresults");
    if (results) { results.replaceChildren(); results.className = "slist"; }
  }

  function resultButton(key, primary, secondary, meta) {
    var button = element("button", { type: "button", dataset: { key: key } });
    var identity = element("span", { class: "result-identity identity-cell" });
    identity.append(
      element("span", { class: "rg identity-primary" }, primary),
      element("span", { class: "ra identity-secondary" }, secondary)
    );
    button.append(
      identity,
      element("span", { class: "rn" }, meta)
    );
    return button;
  }

  function displayIdentity(record, options) {
    var resolver = window.MimicryOneIdentity;
    if (!resolver || typeof resolver.resolve !== "function") {
      throw new Error((/*@copy analysis-entry.the-shared-protein-identity-resolver.08d8c41*/`Protein identity information is unavailable.`/*@endcopy*/));
    }
    return resolver.resolve(record || {}, options || {});
  }

  function componentKeyFor(record) {
    return String(record && (record.component_key || record.componentKey) || "").trim();
  }

  function componentQualifiedIdentity(record, identity) {
    var component = componentKeyFor(record);
    return component ? "component:" + component + "|" + identity : identity;
  }

  function suggestionIdentity(record) {
    var recordKey = record && (
      record.portable_id || record.antigen_id || record.source_accession || ""
    );
    return componentQualifiedIdentity(record,
      String(record && record.kind || "record") + ":" + String(recordKey));
  }

  function selectionDescriptor(record) {
    var parentSelect = byId("entryTargetLibrary");
    var selectedParentSet = parentSelect && parentSelect.value;
    var shared = {
      componentKey: componentKeyFor(record) || null,
      mimicryParentLabel: selectedParentSet ? parentSetLabel(selectedParentSet) : "selected parent set",
      floor: STATIC_PLAYER_FLOOR
    };
    if (record.kind === "assay") {
      var assay = displayIdentity(record, { activeLibrary: currentTargetSet().library });
      return Object.assign(shared, {
        label: assay.primaryLine,
        accession: assay.accession || assay.assayId
      });
    }
    var protein = displayIdentity(record, { activeLibrary: currentTargetSet().library });
    return Object.assign(shared, {
      label: protein.primaryLine,
      accession: protein.accession || protein.assayId
    });
  }

  function aliasResolutionLabel(record) {
    var match = record && record.search_match;
    if (!match || match.match_kind !== "canonical_alias") return "";
    var alias = String(match.matched_alias || match.query || "").trim();
    var gene = String(match.canonical_gene || "").trim();
    if (!alias || !gene || alias.toUpperCase() === gene.toUpperCase()) return "";
    return alias + " → " + gene + (match.ambiguous ? " (ambiguous)" : "");
  }

  function paintPendingSelection(session) {
    return new Promise(function nextPaint(resolve, reject) {
      window.requestAnimationFrame(function painted() {
        if (session.controller.signal.aborted) reject(cancelledRequestError());
        else resolve();
      });
    });
  }

  async function searchProteins(query, signal, classOverride) {
    if (!state.explorerMeta) return [];
    var selectedSet = currentTargetSet();
    var recordClass = typeof classOverride === "undefined"
      ? parentClassForSourceLibrary(selectedSet.library)
      : classOverride;
    var params = new URLSearchParams({ q: query, limit: "25" });
    if (recordClass) params.set("class", recordClass);
    var component = componentKeyFor(state.libraries.get(selectedSet.library));
    if (component) params.set("component", component);
    var filters = requestFilter("query", selectedSet.library);
    if (filters) {
      params.set("analysis_library", selectedSet.library);
      params.set("filters", JSON.stringify(filters));
    }
    var payload = await fetchSearchJson("/api/explorer/proteins?" + params.toString(), signal);
    return (payload.proteins || []).filter(function routable(row) {
      // A verified native analysis crosswalk is independently routable and does
      // not need the legacy PanScan projection/include_default fields.
      if (row.analysis_ref && row.analysis_component_key && row.analysis_library_key &&
          row.analysis_antigen_id != null) return true;
      var mapped = row.mapped_tile_count;
      if (mapped == null) mapped = row.projection_count;
      if (!Number.isInteger(mapped) || mapped < 0) return false;
      if (mapped > 0) return true;
      return row.include_default === 1 && mapped === 0;
    }).slice(0, 10).map(function normalize(row) { return Object.assign({ kind: "portable" }, row); });
  }

  async function searchAssays(query, signal) {
    var params = new URLSearchParams({ q: query, limit: "10" });
    var source = currentTargetSet().library;
    if(window.seromapDesktop?.mimicry&&source?.startsWith('workspace-')){
      var found=await window.seromapDesktop.mimicry('search',{id:source.slice(10),search:query});
      return found.rows.map(r=>Object.assign({},r.metadata,{kind:'assay',library:source,library_key:source,antigen_id:r.id}));
    }
    if (source) params.set("library", source);
    var filters = requestFilter("query", source);
    if (filters) params.set("filters", JSON.stringify(filters));
    var payload = await fetchSearchJson("/api/analysis/antigens?" + params.toString(), signal);
    return (payload.antigens || payload.items || []).slice(0, 10).map(function normalize(row) { return Object.assign({ kind: "assay" }, row); });
  }

  function renderSuggestions(records) {
    var results = byId("pexploreresults");
    results.replaceChildren();
    state.suggestions.clear();
    var resolver = window.MimicryOneIdentity;
    var mixedLibraries = !!(resolver && resolver.mixedLibraries(records));
    var activeSet = currentTargetSet();
    var activeContext = libraryLabel(activeSet.library);
    records.forEach(function render(record, index) {
      var key = suggestionIdentity(record);
      if (state.suggestions.has(key)) key += "#" + String(index);
      state.suggestions.set(key, record);
      var identity = displayIdentity(record, {
        activeLibrary: activeSet.library,
        activeContext: activeContext,
        mixedLibraries: mixedLibraries
      });
      var meta = [
        aliasResolutionLabel(record),
        Number(record.length || record.sequence_length || 0).toLocaleString() + " AA"
      ].filter(Boolean).join(" · ");
      var button = resultButton(key, identity.displayLine || identity.primaryLine, identity.secondary, meta);
      button.dataset.tooltip = identity.tooltip;
      button.dataset.tooltipMono = "true";
      button.setAttribute("aria-label", identity.ariaLabel +
        (identity.fullHeader ? "; full FASTA header: " + identity.fullHeader : ""));
      results.appendChild(button);
    });
    if (!records.length) results.appendChild(element("div", { class: "catalogue-no-match" }, "No matching records."));
    results.className = "slist show";
  }

  async function runSearch() {
    pausePlayerForSelection();
    var query = byId("pexploresearch").value.trim();
    if (!query) { clearSuggestions(); return; }
    if (state.searchAbort) state.searchAbort.abort();
    var searchAbort = new AbortController();
    state.searchAbort = searchAbort;
    try {
      var records = currentTargetSet().kind === "library"
        ? await searchAssays(query, searchAbort.signal)
        : await searchProteins(query, searchAbort.signal);
      if (state.searchAbort !== searchAbort || searchAbort.signal.aborted) return;
      renderSuggestions(records);
    } catch (error) {
      if (state.searchAbort === searchAbort && !searchAbort.signal.aborted && error.name !== "AbortError") {
        setNote(byId("loadnote"), "Search stopped: " + error.message, true);
      }
    } finally {
      if (state.searchAbort === searchAbort) state.searchAbort = null;
    }
  }

  // While any search is in flight the stage is about to be replaced, so the player
  // animation is suspended; the runtime's frame loop reads this flag.
  var searchesInFlight = 0;
  function markSearching(active) {
    var stage = document.querySelector(".stage");
    searchesInFlight = Math.max(0, searchesInFlight + (active ? 1 : -1));
    if (!stage) return;
    if (searchesInFlight > 0) stage.dataset.playerSearching = "true";
    else delete stage.dataset.playerSearching;
  }

  async function fetchSearchJson(url, signal) {
    var key = state.releaseFingerprint + "|" + state.filterPolicyFingerprint + "|" + url;
    var cached = state.searchCache.get(key);
    if (signal && signal.aborted) throw cancelledRequestError();
    if (cached && Date.now() - cached.at < ANALYSIS_META_TTL_MS) {
      state.searchCache.delete(key); state.searchCache.set(key, cached);
      return cached.payload;
    }
    var payload;
    markSearching(true);
    try {
      payload = await fetchJson(url, {signal:signal});
    } finally {
      markSearching(false);
    }
    if (signal && signal.aborted) throw cancelledRequestError();
    state.searchCache.set(key, {at:Date.now(),payload:payload});
    while (state.searchCache.size > 40) state.searchCache.delete(state.searchCache.keys().next().value);
    return payload;
  }

  function liveQuerySelector(record) {
    if (record.kind === "assay") {
      return { kind: "library", library: record.library || record.library_key, antigen_ids: [Number(record.antigen_id)] };
    }
    var header = String(record.source_header || record.companion_header || record.display_name || record.portable_id).replace(/^>+/, "");
    return { kind: "fasta", fasta: ">" + header + "\n" + record.sequence };
  }

  function projectionLibraryFor(record) {
    var parentClass = String(record.parent_class || "").toLowerCase();
    var frozenParentLibraries = {
      human_canonical: "panscan9_human",
      immune_constant: "panscan9_human",
      optional_receptor_germline: "panscan9_human",
      exposure_canonical: "panscan9_exposure",
      exposure_supplement: "panscan9_exposure"
    };
    if (Object.prototype.hasOwnProperty.call(frozenParentLibraries, parentClass)) {
      return frozenParentLibraries[parentClass];
    }
    var explorerClass = String(record.class || "").toLowerCase();
    if (!parentClass && explorerClass === "human") return "panscan9_human";
    if (!parentClass && explorerClass === "exposure") return "panscan9_exposure";
    throw new Error((/*@copy analysis-entry.this-portable-protein-has-no.a012862*/`This portable protein has no verified parent projection.`/*@endcopy*/));
  }

  function verifiedAnalysisReference(record) {
    var component = String(record && record.analysis_component_key || "").trim();
    var library = String(record && record.analysis_library_key || "").trim();
    var antigenId = Number(record && record.analysis_antigen_id);
    var reference = String(record && record.analysis_ref || "").trim();
    var hasAny = !!(component || library || reference || record && record.analysis_antigen_id != null);
    if (!hasAny) return null;
    var expected = component + ":" + library + ":" + antigenId;
    if (!component || component !== componentKeyFor(record) || !library ||
        !Number.isSafeInteger(antigenId) || antigenId < 1 || reference !== expected) {
      throw new Error((/*@copy analysis-entry.this-protein-has-an-invalid.1349e45*/`This protein has an invalid Explorer-to-analysis crosswalk.`/*@endcopy*/));
    }
    return { componentKey: component, library: library, antigenId: antigenId, ref: reference };
  }

  function canonicalParentKey(record) {
    var parentKey = String(record.parent_key || record.portable_id || "");
    if (!/^(?:P9P|M1E)[0-9]{9}$/.test(parentKey)) {
      throw new Error((/*@copy analysis-entry.this-canonical-protein-has-no.777a6f3*/`This canonical protein has no valid immutable parent identity.`/*@endcopy*/));
    }
    return parentKey;
  }

  function mappedTileCount(record) {
    var value = record.mapped_tile_count;
    if (value == null) value = record.projection_count;
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function builtInQueryPlan(record) {
    var liveQuery = liveQuerySelector(record);
    if (record.kind === "assay") {
      return {
        builtIn: true,
        componentKey: componentKeyFor(record) || null,
        identity: componentQualifiedIdentity(record,
          "assay:" + liveQuery.library + ":" + liveQuery.antigen_ids[0]),
        sourceLibrary: liveQuery.library,
        liveQuery: liveQuery,
        staticQuery: liveQuery
      };
    }
    var analysisReference = verifiedAnalysisReference(record);
    if (analysisReference) {
      var analysisQuery = {
        kind: "library",
        library: analysisReference.library,
        antigen_ids: [analysisReference.antigenId]
      };
      return {
        builtIn: true,
        componentKey: analysisReference.componentKey,
        identity: "analysis:" + analysisReference.ref,
        sourceLibrary: analysisReference.library,
        liveQuery: analysisQuery,
        staticQuery: analysisQuery
      };
    }
    var portableComponent = componentKeyFor(record);
    if (portableComponent && portableComponent !== (state.primaryComponentKey || "r3")) {
      throw new Error((/*@copy analysis-entry.this-component-protein-has-no.0c8e937*/`This component protein has no verified Explorer-to-analysis crosswalk.`/*@endcopy*/));
    }
    var projectionLibrary = projectionLibraryFor(record);
    var parentKey = canonicalParentKey(record);
    var mapped = mappedTileCount(record);
    if (mapped == null) {
      throw new Error((/*@copy analysis-entry.this-canonical-protein-lacks-a.b39bb63*/`The mapped assay-tile count is unavailable for this canonical protein.`/*@endcopy*/));
    }
    if (mapped === 0) {
      if (record.include_default !== 1) {
        throw new Error((/*@copy analysis-entry.this-no-projection-canonical-protein.b10bdb8*/`This no-projection canonical protein is outside the default analysis index.`/*@endcopy*/));
      }
      return {
        builtIn: true,
        canonicalFallback: true,
        componentKey: componentKeyFor(record) || null,
        identity: componentQualifiedIdentity(record, "canonical:" + parentKey),
        sourceLibrary: projectionLibrary,
        liveQuery: { kind: "canonical_parent", parent_key: parentKey },
        staticQuery: null
      };
    }
    return {
      builtIn: true,
      canonicalFallback: false,
      componentKey: componentKeyFor(record) || null,
      identity: componentQualifiedIdentity(record, "portable:" + parentKey),
      sourceLibrary: projectionLibrary,
      liveQuery: liveQuery,
      canonicalIndexQuery: { kind: "canonical_parent", parent_key: parentKey },
      staticQuery: {
        kind: "portable_protein",
        portable_id: parentKey,
        projection_library: projectionLibrary
      }
    };
  }

  function customQueryPlan(fasta, parentFasta) {
    return {
      builtIn: false,
      identity: null,
      sourceLibrary: null,
      liveQuery: { kind: "fasta", fasta: fasta },
      // A reader's own parent population belongs to the request, not to the page. The plan is
      // cloned into the route and replayed by a floor switch and by History, both of which run
      // long after the textarea may have been edited or cleared; re-reading the DOM there would
      // quietly compare against a different population than the open result reports.
      parentFasta: typeof parentFasta === "string" ? parentFasta : null,
      staticQuery: null
    };
  }

  function staticCacheKey(plan, targetLibrary, floor, targetFilters) {
    return JSON.stringify([
      state.releaseFingerprint || "unversioned", state.filterPolicyFingerprint || "unversioned",
      plan.componentKey || "", plan.identity || "", plan.sourceLibrary || "",
      plan.staticQuery || null, targetLibrary, targetFilters || null, Number(floor)
    ]);
  }

  function cachedStaticPayload(key) {
    if (!state.staticCache.has(key)) return null;
    var payload = state.staticCache.get(key);
    state.staticCache.delete(key);
    state.staticCache.set(key, payload);
    return payload;
  }

  function rememberStaticPayload(key, payload) {
    state.staticCache.delete(key);
    state.staticCache.set(key, payload);
    while (state.staticCache.size > 6) state.staticCache.delete(state.staticCache.keys().next().value);
  }

  function staticPairAvailable(sourceLibrary, targetLibrary) {
    if (!sourceLibrary || !targetLibrary) return false;
    // A pinned subset is served by its carrier, so the canonical library the reader selects
    // is available exactly when the carrier pair is.
    var source = carrierLibrary(sourceLibrary, targetLibrary);
    var target = carrierLibrary(targetLibrary, sourceLibrary);
    return state.staticPairs.has([source, target].sort().join("\u0000"));
  }

  function targetAvailable(plan, targetLibrary, floor) {
    if(window.seromapDesktop?.mimicry&&String(parseParentSet(targetLibrary).library).startsWith('workspace-'))return localFloorAvailable(Number(floor));
    if (window.MimicryMapViewer?.options.embedded && (!window.MimicryMapViewer.options.libraryAllowed(targetLibrary) || (plan?.sourceLibrary && !window.MimicryMapViewer.options.libraryAllowed(plan.sourceLibrary)))) return false;
    var selectedFloor = Number(floor);
    var parentSet = parseParentSet(targetLibrary);
    var library = parentSet.library;
    if (window.MimicryLite && parentSet.kind === "library") {
      return (library === CUSTOM_PARENT_LIBRARY || state.libraries.has(library)) && localFloorAvailable(selectedFloor);
    }
    if (parentSet.kind === "canonical_proteome") {
      if (!state.libraries.has(library) || ["panscan9_human", "panscan9_exposure"].indexOf(library) < 0) return false;
      // This route matches on the server, which means posting the query there. A reader's
      // own sequence is never sent, so a custom upload does not take it - it computes here
      // instead, against the canonical library this deployment serves for local scanning.
      if (plan && !plan.builtIn) return false;
      if (plan && plan.forceCanonicalIndex) return canonicalIndexAvailable(selectedFloor);
      if (plan && plan.builtIn && !staticPairAvailable(plan.sourceLibrary, library)) return false;
      // Mapped 7/9 queries use the static+overlay player. Other shapes retain
      // their canonical identity and reach the explicit full-index-required
      // response; they must never fall through to the raw tile library.
      if (selectedFloor === 7 && plan && plan.builtIn && !plan.canonicalFallback) {
        return !!(state.staticPlayer && state.staticPlayer.available);
      }
      if (selectedFloor === 7 && !(plan && plan.builtIn && plan.canonicalFallback)) {
        return canonicalIndexAvailable(7);
      }
      return [5, 6, 7].indexOf(selectedFloor) >= 0;
    }
    if (plan && plan.builtIn) {
      if (!staticPairAvailable(plan.sourceLibrary, library)) return false;
      if (plan.canonicalFallback && selectedFloor === STATIC_PLAYER_FLOOR) {
        return canonicalLive7Available(library);
      }
      // A canonical parent with no mapped tile has no projection to read above 7/9 (7/9
      // itself is served by the canonical live route, handled just above), so the request is
      // refused downstream and offering the threshold would enable a control that can only
      // produce an error. Test the plan shape, not the presence of staticQuery:
      // rebuildComparisonOptions probes availability with a bare {builtIn, sourceLibrary}
      // plan that carries no staticQuery, and reading that as "no projection" refuses every
      // target at every precomputed floor.
      if (selectedFloor >= 7) {
        if (plan.canonicalFallback) return false;
        return !!(state.staticPlayer && state.staticPlayer.available);
      }
      return [5, 6].indexOf(selectedFloor) >= 0 &&
        (localFloorAvailable(selectedFloor) || liveAvailable(library, selectedFloor));
    }
    // A custom comparison computes in this browser, across the whole range, whether the
    // parent population is one we serve or one the reader supplied. There is deliberately no
    // server fallback here: the indexed route would have to be given the reader's own
    // sequence, and that is never sent. Without the local runtime the comparison is refused,
    // not quietly uploaded.
    return localFloorAvailable(selectedFloor);
  }

  // No floor depends on a server-side live index: each runs in this browser against
  // downloaded release-bound inputs, so all of 5/9-9/9 are offered whenever the local
  // runtime is present. Both layers underneath accept the full range - the engine
  // (runLocalLibraryScan) validates floor >= 5 && floor <= 9, and /api/analysis/local-inputs
  // validates floor in range(5,10) and defaults to 7 - so capping this at 5/6 only
  // recorded which floors were migrated off the server index first, and refused the rest
  // of the range the same code already computes. A missing input endpoint surfaces as an
  // explicit request error.
  function localFloorAvailable(floor) {
    var selected = Number(floor);
    return selected >= 5 && selected <= 9 &&
      !!(window.MimicryOne && typeof window.MimicryOne.runLocalLibraryScan === "function");
  }

  function targetUnavailableReason(plan, targetLibrary, floor) {
    var parentSet = parseParentSet(targetLibrary);
    var library = parentSet.library;
    if (parentSet.kind === "canonical_proteome" && plan && !plan.builtIn) {
      return "Comparing against " + parentSetLabel(parentSet.value) + " this way would have to send your sequences to this server, which this route does not do. Your sequences stay in this browser. Choose a parent library this deployment serves for local scanning, or supply your own FASTA.";
    }
    if (parentSet.kind === "canonical_proteome") {
      return "This request retains the " + parentSetLabel(parentSet.value) + " canonical identity; a separate full-parent index is required, and no tile-only result will be substituted.";
    }
    if (plan && plan.builtIn && !staticPairAvailable(plan.sourceLibrary, library)) {
      return "No planned comparison covers " + libraryLabel(plan.sourceLibrary) + " ↔ " + libraryLabel(library) + ".";
    }
    if (plan && plan.builtIn && Number(floor) >= 7) {
      if (plan.canonicalFallback) {
        return "Exact canonical-parent 7/9 index unavailable: " + liveReason(library);
      }
      if (!state.staticPlayer || !state.staticPlayer.available) return "Precomputed player lookup is unavailable in this deployment.";
      return "No finalized precomputed " + Number(floor) + "/9 comparison covers " + libraryLabel(plan.sourceLibrary) + " ↔ " + libraryLabel(library) + ".";
    }
    // Reached only when the browser-local runtime is missing, since it covers 5/9-9/9.
    // The previous text fired on !plan.builtIn - the custom route - yet called itself
    // "built-in" and told the reader to choose the route they were already on.
    if (plan && !plan.builtIn && !localFloorAvailable(floor)) {
      return "The browser-local compute runtime is not available in this session, so this custom comparison cannot run at " + Number(floor) + "/9. Reload the page to restore it. Your selection has not been downgraded.";
    }
    return "Mimicry Parent index unavailable: " + liveReason(library);
  }

  function applyTargetAvailability(plan, floor, select) {
    if (!select) return;
    Array.from(select.options).forEach(function gate(option) {
      if (!option.value) return;
      option.disabled = plan || Number(floor) < 7
        ? !targetAvailable(plan, option.value, floor)
        : false;
    });
  }

  function firstEnabledTarget(select) {
    var option = Array.from(select.options).find(function enabled(item) { return item.value && !item.disabled; });
    return option ? option.value : "";
  }

  function preferredComparisonTargets(sourceLibrary) {
    if(workspaceSnapshot&&sourceLibrary?.startsWith('workspace-'))return [workspaceDefaultParentValue()];
    var library = state.libraries.get(sourceLibrary) || {};
    return library.class === "nonhuman_exposure"
      ? [fullProteinValue("human"), "library:panscan9_human", "library:human_current", "library:huprot4"].filter(Boolean)
      : [fullProteinValue("exposure"), "library:panscan9_exposure", "library:virscan_exposome_current", fullProteinValue("human"), "library:panscan9_human", "library:human_current", "library:huprot4"].filter(Boolean);
  }

  function rebuildComparisonOptions(select, sourceLibrary, floor, preferred) {
    if (!select) return "";
    var previous = preferred || select.value;
    var plan = { builtIn: true, sourceLibrary: sourceLibrary };
    var validCanonical = [];
    var canonicalOptions = [];
    var canonicalValues = new Set();
    fullProteinOptions().forEach(function collectCanonical(item) {
      canonicalValues.add(item.value);
      var available = targetAvailable(plan, item.value, floor);
      canonicalOptions.push({ item: item, available: available });
      if (available) validCanonical.push(item.value);
    });
    var valid = [];
    state.libraries.forEach(function collect(_library, key) {
      var value = "library:" + key;
      if (canonicalValues.has(value) || !isPublicAssayLibrary(key)) return;
      if (targetAvailable(plan, value, floor)) valid.push(value);
    });
    select.replaceChildren();
    if (canonicalOptions.length) {
      var canonical = element("optgroup", { label: (/*@copy analysis-entry.full-proteins.5dbcec4*/`Canonical Libraries`/*@endcopy*/) });
      canonicalOptions.forEach(function add(entry) {
        var option = element("option", { value: entry.item.value }, entry.item.label);
        option.disabled = !entry.available;
        canonical.appendChild(option);
      });
      select.appendChild(canonical);
    }
    if (valid.length) {
      var nativeEntries = element("optgroup", { label: (/*@copy analysis-entry.assay-tile-libraries.ac0df46*/`Assay Libraries`/*@endcopy*/) });
      valid.forEach(function add(value) {
        nativeEntries.appendChild(element("option", { value: value }, libraryLabel(parentLibrary(value))));
      });
      select.appendChild(nativeEntries);
    }
    appendWorkspaceOptions(select,function(value){if(!targetAvailable(plan,value,floor))return false;valid.push(value);return true;});
    var allValid = validCanonical.concat(valid);
    if (!allValid.length) {
      select.appendChild(element("option", { value: "", disabled: "", selected: "" }, "No comparison available"));
      select.disabled = true;
      return "";
    }
    select.disabled = false;
    var normalizedPrevious = parseParentSet(previous).value;
    if (allValid.indexOf(normalizedPrevious) >= 0) {
      select.value = normalizedPrevious;
    } else {
      var ordered = preferredComparisonTargets(sourceLibrary);
      select.value = ordered.find(function available(value) { return allValid.indexOf(value) >= 0; }) || allValid[0];
    }
    return select.value;
  }

  async function openNativePlayer(payload, targetLibrary, queryContext, signal, onCommit, singleRecord) {
    await waitFor(function ready() {
      return window.MimicryOne && typeof window.MimicryOne.openResult === "function" &&
        window.MimicryOneAnalysisPlayer && typeof window.MimicryOneAnalysisPlayer.open === "function";
    }, 8000, signal);
    if (signal && signal.aborted) throw cancelledRequestError();
    var query = (payload.query_records || [])[0] || {};
    var parentSet = parseParentSet(targetLibrary);
    var sourceLibrary = state.libraries.get(parentSet.library) || {};
    var responseTarget = payload.target || {};
    var canonical = responseTarget.kind === "canonical_proteome";
    var opened = window.MimicryOneAnalysisPlayer.open(payload, {
      sourceScopeLabel: singleRecord ? singleRecord.label : canonical ? parentSetLabel(parentSet.value) : libraryLabel(parentSet.library),
      sourceLibraryRecords: singleRecord ? 1 : canonical
        ? Number(responseTarget.canonical_default_count || 0)
        : Number(sourceLibrary.records || 0),
      sourceLibraryEntityLevel: canonical
        ? "canonical_parent"
        : (responseTarget.record_representation ? responseTarget.record_representation.unit
          : isCanonicalAnalysisLibrary(parentSet.library) ? "canonical_protein_record"
          : first(sourceLibrary, ["entity_level", "entry_level"], "")),
      sourceEntityLabel: isCanonicalAnalysisLibrary(parentSet.library) ? "canonical protein records" : "",
      sourceLibraryClass: first(sourceLibrary, ["class", "library_class"], ""),
      queryLibraryLabel: query.library && state.libraries.has(query.library) ? libraryLabel(query.library) : "Full-protein/custom query",
      queryContext: queryContext || null,
      preferredView: window.MimicryOne.getState().view
    });
    // Commit routing/history in the same task as the synchronous player swap.
    if (onCommit) onCommit(opened);
    return opened;
  }

  function validateOneFasta(query) {
    if (query.kind !== "fasta" || !window.MimicryOne || typeof window.MimicryOne.parseFasta !== "function") return null;
    var parsed = window.MimicryOne.parseFasta(query.fasta, "query");
    if (parsed.errors.length || parsed.records.length !== 1) {
      throw new Error(parsed.errors[0] || (/*@copy analysis-entry.one-antigen-target-input*/`Analyze one Antigen Target at a time in the Player.`/*@endcopy*/));
    }
    return parsed.records[0];
  }

  function preflightLiveQuery(query, floor) {
    var record = validateOneFasta(query);
    if (!record || [5, 6].indexOf(Number(floor)) < 0) return;
    var windows = Math.max(0, Number(record.length || 0) - 8);
    var limit = Number(state.live && state.live.maxQueryWindows || 128);
    if (windows > limit) {
      var error = new Error((/*@copy analysis-entry.this-sequence-is-aa-mer.02e1cfb*/`This sequence is ${Number(record.length).toLocaleString()} AA (${windows.toLocaleString()} 9-mer windows). Live 5/9–6/9 queries above the ${limit.toLocaleString()}-window limit exceed this deployment's live compute limit.`/*@endcopy*/));
      error.code = "async_required";
      error.details = {
        guard: "query_windows",
        observed: windows,
        maximum: limit,
        complete: false,
        async_required: true
      };
      throw error;
    }
  }

  // A requested 5/9 or 6/9 comparison always runs in this browser against the complete
  // release-bound selected population. The server only serves those inputs; it performs
  // no matching for these floors, and there is no size limit that turns a request away.
  function localFloorRunSupported(plan, parentSet, floor) {
    // One source of truth for "this floor can run here", so the dispatch cannot offer a
    // floor the availability gate refuses, or refuse one it offers.
    if (!localFloorAvailable(floor)) return false;
    if (!parentSet || parentSet.kind !== "library" || !parentSet.library) return false;
    var query = plan && plan.liveQuery;
    if (!query) return false;
    if (query.kind === "fasta") return true;
    return query.kind === "library" && !!query.library &&
      Array.isArray(query.antigen_ids) && query.antigen_ids.length === 1;
  }

  function localFloorQueryRow(plan) {
    var query = plan && plan.liveQuery;
    if (!query || query.kind !== "fasta") return null;
    var parsed = window.MimicryOne.parseFasta(query.fasta, "query");
    if (parsed.errors.length || parsed.records.length !== 1) {
      throw new Error(parsed.errors[0] || (/*@copy analysis-entry.one-antigen-target-input*/`Analyze one Antigen Target at a time in the Player.`/*@endcopy*/));
    }
    return parsed.records[0];
  }

  // The reader's own parent sequences. Unlike the query there may be many, and each becomes a
  // mimicry parent, exactly as a served library's records do. The population comes from the
  // plan when the request carries one, so a replay reproduces the run it belongs to.
  function customParentRows(plan) {
    var carried = plan && typeof plan.parentFasta === "string" ? plan.parentFasta : null;
    var fasta = carried !== null ? carried : String((byId("mimicfa") || {}).value || "");
    if (!fasta.trim()) throw new Error((/*@copy analysis-entry.supply-the-mimicry-parent-fasta.92f3261*/`Supply the mimicry parent FASTA to compare against.`/*@endcopy*/));
    var parsed = window.MimicryOne.parseFasta(fasta, "target");
    if (parsed.errors.length) throw new Error(parsed.errors[0]);
    if (!parsed.records.length) throw new Error((/*@copy analysis-entry.no-mimicry-parent-sequence-was.29f0fdb*/`No mimicry parent sequence was supplied.`/*@endcopy*/));
    var rows = parsed.records.filter(function eligible(row) { return row.length >= 9; })
      // The parser labels everything it reads as a query. These are parents, and the runtime
      // identifies a supplied parent population by exactly this label (the "custom" source
      // scope tests library_id === "__custom_target__"), so relabel them as the legacy
      // custom-parent path did or they are filed as queries against themselves.
      .map(function asParent(row) {
        return Object.assign({}, row, { library_id: "__custom_target__", organism: "user supplied" });
      });
    if (!rows.length) {
      throw new Error((/*@copy analysis-entry.the-supplied-mimicry-parent-fasta.0c58085*/`The supplied mimicry parent FASTA has no sequence of at least 9 residues, so it has no comparable window.`/*@endcopy*/));
    }
    return { rows: rows, fasta: fasta };
  }

  // Local engines accept sequences even for catalog selections. Restore the selected
  // record's provenance before presentation; the engine's generic "custom" origin
  // must not turn a reference search into an upload or disable its tracks/structure.
  function applyLocalQueryIdentity(result, plan, queryContext) {
    if (!plan || !plan.builtIn) return;
    var protein = result.protein;
    if (!protein || !plan.sourceLibrary) throw new Error("Selected query record identity is unavailable.");
    if (queryContext && (!queryContext.sequence ||
        String(queryContext.sequence).toUpperCase() !== String(protein.sequence || "").toUpperCase())) {
      throw new Error("Selected reference sequence differs from the comparison target.");
    }
    protein.library_id = plan.sourceLibrary;
    result.origin = "local_library";
    // Catalog sequences are already retained in protein.sequence. A FASTA used
    // internally to submit that record is not a user-uploaded query.
    if (result.inputs) delete result.inputs.original_query_fasta;
    if (!queryContext) return;
    var portableId = String(queryContext.parent_key || queryContext.portable_id || "");
    if (/^(?:P9P|M1E)[0-9]{9}$/.test(portableId)) {
      protein.protein_id = portableId;
      protein.portable_id = portableId;
      protein.parent_key = portableId;
      protein.annotation_portable_id = portableId;
    }
    if (queryContext.source_accession) {
      protein.display_accession = String(queryContext.source_accession);
      protein.source_accession = String(queryContext.source_accession);
    }
    if (queryContext.primary_gene) protein.gene = String(queryContext.primary_gene);
    if (queryContext.display_name) protein.name = String(queryContext.display_name);
    if (queryContext.protein_name) protein.protein_name = String(queryContext.protein_name);
    if (queryContext.organism) protein.organism = String(queryContext.organism);
    if (queryContext.parent_class || queryContext.class) protein.parent_class = String(queryContext.parent_class || queryContext.class);
    if (queryContext.source_header) protein.source_header = String(queryContext.source_header);
    if (queryContext.source_token) protein.source_token = String(queryContext.source_token);
    if (queryContext.projection_library) protein.projection_library = String(queryContext.projection_library);
    if (queryContext.native_track_accession) protein.native_track_accession = String(queryContext.native_track_accession);
    if (queryContext.structure_accession) protein.structure_accession = String(queryContext.structure_accession);
    if (queryContext.native_asset_crosswalk && typeof queryContext.native_asset_crosswalk === "object") {
      protein.native_asset_crosswalk = queryContext.native_asset_crosswalk;
    }
  }

  async function runLocalFloorScan(plan, parentSet, targetFilters, floor, signal, requestNote) {
    var query = plan.liveQuery;
    var nativeParent=customWorkspaceParent(parentSet.library,targetFilters);
    if(window.seromapDesktop?.mimicry&&nativeParent){
      var supplied=query.kind==='fasta'?localFloorQueryRow(plan):null;
      var workspaceQuery=query.kind==='library'&&query.library.startsWith('workspace-');
      if(!workspaceQuery&&!supplied&&query.kind==='library')supplied=await window.MimicryOne.readQueryRecord({queryId:Number(query.antigen_ids[0]),queryLibrary:query.library,library:query.library,floor:Number(floor),queryComponent:plan.componentKey,signal:signal});
      if(!workspaceQuery&&!supplied)throw Error('Choose a sequenced target for this FASTA comparison.');
      requestNote('Loading saved positions or comparing against the workspace FASTA…');
      var cancelWorkspace=function(){window.seromapDesktop.mimicry('cancel')};signal.addEventListener('abort',cancelWorkspace,{once:true});
      var result;try{result=await window.seromapDesktop.mimicry('analyze',{parent:nativeParent,floor:Number(floor),query:supplied,...(workspaceQuery?{queryLibrary:query.library.slice(10),queryId:query.antigen_ids[0]}:{})})}finally{signal.removeEventListener('abort',cancelWorkspace)}
      return {result:result,rows:result.source_catalog,cached:true,timings:{}};
    }
    var options = {
      library: parentSet.library,
      floor: Number(floor),
      filters: targetFilters || {},
      release: state.releaseFingerprint || null,
      // Resolve the parent package by its own library. The selected target may
      // belong to another component, whose identity is used only for its record.
      component: null,
      queryComponent: plan.componentKey || null,
      signal: signal,
      onStatus: function status(message) { requestNote(message); }
    };
    if (query.kind === 'library' && query.library.startsWith('workspace-') && window.seromapDesktop?.mimicry) {
      options.queryRow=await window.seromapDesktop.mimicry('record',{library:query.library.slice(10),id:Number(query.antigen_ids[0])});
      options.queryFasta='>'+options.queryRow.raw_header+'\n'+options.queryRow.sequence;
    } else if (query.kind === "library") {
      options.queryId = Number(query.antigen_ids[0]);
      options.queryLibrary = query.library;
    } else {
      options.queryRow = localFloorQueryRow(plan);
      // The frozen query text, for the same reason the parents are frozen: a replay must
      // record what it ran, not what the textarea holds when it runs. The server path already
      // takes it from the plan this way.
      options.queryFasta = query.fasta;
    }
    // The reader's own parent population is already here. Hand it to the same scanner the
    // served libraries use, so the only thing that differs between the two is where the rows
    // came from - not how they are compared, presented, routed or exported.
    if (parentSet.library === CUSTOM_PARENT_LIBRARY) {
      var supplied = customParentRows(plan);
      options.rows = supplied.rows;
      options.rowsFasta = supplied.fasta;
      options.filters = {};
    }
    if(window.seromapDesktop?.mimicry&&parentSet.library.startsWith('workspace-')&&targetFilters?.record_ids?.length){
      options.rows=await Promise.all(targetFilters.record_ids.map(id=>window.seromapDesktop.mimicry('record',{library:parentSet.library.slice(10),id:Number(id)})));
      options.rowsFasta=options.rows.map(r=>'>'+r.raw_header+'\n'+r.sequence+'\n').join('');
      options.filters={};
    }
    var cache = (window.MimicryLite || window.seromapDesktop) && window.MimicryLiteResultCache;
    if (!cache) return window.MimicryOne.runLocalLibraryScan(options);
    return cache.run({
      version: 1, query: query, parent: parentSet, filters: options.filters,
      floor: options.floor, release: options.release,
      policy: state.filterPolicyFingerprint, component: options.queryComponent,
      queryRow: options.queryRow || null, queryFasta: options.queryFasta || null,
      parentFasta: options.rowsFasta || null, parentRows: options.rows || null
    }, function () { return window.MimicryOne.runLocalLibraryScan(options); }, signal);
  }

  function liveScanRequest(plan, targetLibrary, floor, targetFilters) {
    var parentSet = parseParentSet(targetLibrary);
    if (typeof targetFilters === "undefined") {
      targetFilters = parentSet.kind === "library"
        ? requestFilter("target", parentSet.library)
        : null;
    }
    var target = { kind: parentSet.kind, library: parentSet.library };
    if (parentSet.kind === "library" && targetFilters) target.filters = targetFilters;
    return {
      mode: "live",
      floor: Number(floor),
      query: parentSet.kind === "canonical_proteome" && plan.canonicalIndexQuery
        ? plan.canonicalIndexQuery
        : plan.liveQuery,
      target: target,
      include_hits: true,
      max_results: 10000
    };
  }

  // A pinned subset is served from its carrier release, not from the component the reader
  // picked their antigen in. Pinning the component here would name the pre-rewrite owner and
  // conflict with where the request actually resolves, so it is left for the server to infer.
  function pinnedPlanComponent(plan, parentSet) {
    var partner = parentSet && parentSet.kind === "library" ? parentSet.library : null;
    return pinnedSubsetFor(plan && plan.sourceLibrary, partner) ? null : plan;
  }

  function componentEndpoint(path, plan) {
    var component = String(plan && plan.componentKey || "").trim();
    if (!component) return path;
    var url = new URL(path, window.location.href);
    url.searchParams.set("component", component);
    return url.pathname + url.search + url.hash;
  }

  function reportLocalComputeRequired(floor, note, error, signal) {
    if (signal && signal.aborted) return false;
    var details = error && error.details || {};
    var limit = details.guard && details.observed != null && details.maximum != null
      ? " (" + String(details.guard).replace(/_/g, " ") + " " +
        Number(details.observed).toLocaleString() + " > " + Number(details.maximum).toLocaleString() + ")"
      : "";
    setNote(note, Number(floor) + "/9 exceeds the interactive limit" + limit +
      ". Larger analyses must run on your device using custom FASTA inputs. No background job was submitted; the previous completed result is retained.", true);
    return false;
  }

  async function scanLivePlayer(plan, targetLibrary, floor, signal, onRetry, targetFilters) {
    var parentSet = parseParentSet(targetLibrary);
    var canonicalTarget = parentSet.kind === "canonical_proteome";
    var canonicalLive7 = !window.MimicryLite && !!(plan && plan.canonicalFallback && Number(floor) === STATIC_PLAYER_FLOOR);
    if (!canonicalTarget && !canonicalLive7 && [5, 6].indexOf(Number(floor)) < 0) {
      throw new Error((/*@copy analysis-entry.server-indexed-player-scans-support.c186e2a*/`This comparison supports a minimum identity of 5/9 or 6/9. Choose one of those thresholds to continue.`/*@endcopy*/));
    }
    if (canonicalTarget && [5, 6, 7].indexOf(Number(floor)) < 0) {
      throw new Error((/*@copy analysis-entry.canonical-proteome-indexed-scans-support.db20a1c*/`Canonical-proteome indexed scans support only 5/9, 6/9, or 7/9.`/*@endcopy*/));
    }
    if (!canonicalTarget &&
        (canonicalLive7 ? !canonicalLive7Available(parentSet.library) : !liveAvailable(parentSet.library, floor))) {
      throw new Error((/*@copy analysis-entry.mimicry-parent-index-unavailable.51b1c33*/`Mimicry parent index unavailable: ${liveReason(parentSet.library)}`/*@endcopy*/));
    }
    preflightLiveQuery(plan.liveQuery, floor);
    var endpoint = canonicalTarget && state.canonicalIndex && state.canonicalIndex.endpoint ||
      state.live && state.live.endpoint || "/api/analysis/scan";
    return fetchLiveScanWithRetry(componentEndpoint(endpoint, plan), {
      method: "POST",
      signal: signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(liveScanRequest(plan, targetLibrary, floor, targetFilters))
    }, signal, onRetry);
  }

  async function loadPrecomputedPlayer(plan, targetLibrary, floor, signal, onRetry, targetFilters) {
    if (!state.staticPlayer || !state.staticPlayer.endpoint) throw new Error((/*@copy analysis-entry.precomputed-player-endpoint-unavailable.5a2f080*/`Precomputed player endpoint unavailable.`/*@endcopy*/));
    var key = staticCacheKey(plan, targetLibrary, floor, targetFilters);
    var metaFresh = state.analysisMetaUpdatedAt && Date.now() - state.analysisMetaUpdatedAt < ANALYSIS_META_TTL_MS;
    var cached = metaFresh ? cachedStaticPayload(key) : null;
    if (cached) return { payload: cached, cacheKey: key, cached: true };
    if (!metaFresh) {
      normalizeAnalysisMeta(await fetchJson("/api/analysis/meta", { signal: signal }));
      key = staticCacheKey(plan, targetLibrary, floor, targetFilters);
      cached = cachedStaticPayload(key);
      if (cached) return { payload: cached, cacheKey: key, cached: true };
    }
    if (!targetAvailable(plan, targetLibrary, floor)) throw new Error(targetUnavailableReason(plan, targetLibrary, floor));
    var parentSet = parseParentSet(targetLibrary);
    var requestFilters = parentSet.kind === "library" ? targetFilters : null;
    var payload = await fetchStaticPlayerWithRetry(componentEndpoint(state.staticPlayer.endpoint, pinnedPlanComponent(plan, parentSet)), {
      method: "POST",
      signal: signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Mimicry-View": "coordinates-v1" },
      body: JSON.stringify({
        floor: Number(floor),
        query: plan.staticQuery,
        target: Object.assign(
          { kind: parentSet.kind, library: parentSet.library },
          requestFilters ? { filters: requestFilters } : {}
        ),
        include_hits: true,
        max_results: 10000
      })
    }, signal, onRetry);
    return { payload: payload, cacheKey: key, cached: false };
  }

  async function runPlayerQuery(plan, targetLibrary, floor, note, trigger, queryContext, fixedTargetFilters, fixedHistoryUiContext, allowLocalCompute) {
    // Missing or oversized saved delivery continues locally by default.
    if (typeof allowLocalCompute === "undefined") allowLocalCompute = true;
    if (state.scanAbort) {
      setNote(note, "An analysis request is already running; cancel it before starting another.", true);
      return false;
    }
    // The request owns a snapshot, not objects a selector/history entry can edit.
    plan = clonePlain(plan);
    queryContext = clonePlain(queryContext);
    var parentSet = parseParentSet(targetLibrary);
    var targetFilters = clonePlain(typeof fixedTargetFilters === "undefined"
      ? (parentSet.kind === "library" ? requestFilter("target", parentSet.library) : null)
      : (parentSet.kind === "library" ? fixedTargetFilters : null));
    var workspaceParent = !!window.seromapDesktop?.mimicry && !!customWorkspaceParent(parentSet.library,targetFilters);
    if(workspaceParent && plan.liveQuery?.kind==='canonical_parent' && queryContext?.sequence){
      plan.liveQuery={kind:'fasta',fasta:'>'+String(queryContext.protein_id||queryContext.gene||'Target').replace(/[\r\n]/g,' ')+'\n'+queryContext.sequence};
    }
    var canonicalLive7 = !workspaceParent && !window.MimicryLite && !!(plan && plan.canonicalFallback && Number(floor) === STATIC_PLAYER_FLOOR);
    var precomputed = !workspaceParent && !window.MimicryLite && plan.builtIn && Number(floor) >= 7 && !canonicalLive7 && !plan.forceCanonicalIndex;
    if (targetFilters && Array.isArray(targetFilters.record_ids) && !targetFilters.record_ids.length) {
      if (plan.builtIn) state.waitingSingleRoute = {plan:plan, targetLibrary:targetLibrary, floor:Number(floor), queryContext:queryContext};
      setNote(note, singleCopy.choose);
      return false;
    }
    state.waitingSingleRoute = null;
    var requestStarted = performance.now();
    var perf = window.MimicryPerformance;
    var performanceKey = perf && perf.key(plan, parentSet, targetFilters, state.releaseFingerprint, state.filterPolicyFingerprint);
    var requestRevision = ++state.requestRevision;
    var historyUiContext = clonePlain(fixedHistoryUiContext ||
      captureHistoryUiContext(plan, targetLibrary, floor));
    historyUiContext.floor = Number(floor);
    if (!targetAvailable(plan, targetLibrary, floor)) {
      setNote(note, targetUnavailableReason(plan, targetLibrary, floor), true);
      return false;
    }
    if (precomputed && !plan.staticQuery) {
      setNote(note, "This built-in query has no verified precomputed projection.", true);
      return false;
    }
    var scanAbort = new AbortController();
    var selectionToken = state.selectionPending;
    var pendingRoute = {
      plan: plan,
      targetLibrary: targetLibrary,
      targetFilters: targetFilters,
      queryContext: queryContext || null,
      noteId: note && note.id || "loadnote",
      proteinId: null,
      resultId: null,
      floor: Number(floor),
      historyUiContext: historyUiContext,
      releaseFingerprint: state.releaseFingerprint,
      filterPolicyFingerprint: state.filterPolicyFingerprint
    };
    state.scanAbort = scanAbort;
    state.pendingRoute = pendingRoute;
    function ownsRequest() { return state.scanAbort === scanAbort; }
    function currentRequest() {
      return ownsRequest() && state.requestRevision === requestRevision && !scanAbort.signal.aborted &&
        state.selectionPending === selectionToken &&
        state.releaseFingerprint === pendingRoute.releaseFingerprint &&
        state.filterPolicyFingerprint === pendingRoute.filterPolicyFingerprint;
    }
    function requestNote(message, error) {
      if (currentRequest()) setNote(note, message, error);
    }
    syncRequestControlsBusy();
    var cancel = trigger && trigger.id === "runFasta" ? byId("cancelFasta") : byId("catalogCancel");
    if (cancel) cancel.hidden = false;
    if (trigger) trigger.disabled = true;
    var committed = false;
    var localMappedRun = false;
    requestNote(precomputed
      ? "Loading precomputed " + Number(floor) + "/9 matches…"
      : (canonicalLive7
        ? "Scanning this canonical parent against the prebuilt 7/9 index…"
        : "Computing " + Number(floor) + "/9 matches on demand…"));
    var localFloorRun = !precomputed && !canonicalLive7 && localFloorRunSupported(plan, parentSet, floor);
    try {
      if (localFloorRun) {
        var localOutcome = await runLocalFloorScan(plan, parentSet, targetFilters, floor, scanAbort.signal, requestNote);
        if (!currentRequest()) throw cancelledRequestError();
        var localResult = localOutcome.result;
        applyLocalQueryIdentity(localResult, plan, queryContext);
        if (historyUiContext.targetFilterState && historyUiContext.targetFilterState.singleMode) {
          localResult.parameters.source_scope_label = historyUiContext.targetLibraryLabel;
          localResult.parameters.source_library_records = 1;
        }
        pendingRoute.proteinId = localResult.protein.protein_id;
        pendingRoute.resultId = localResult.result_id;
        state.activeRoute = pendingRoute;
        state.pendingRoute = null;
        var displayStarted = performance.now();
        window.MimicryOne.openLocalResult(localResult, localOutcome.rows, "explorer");
        if (typeof window.MimicryOne.setHistoryContext === "function") {
          window.MimicryOne.setHistoryContext(localResult.result_id, historyContextForRoute(pendingRoute));
        }
        if (typeof window.MimicryOne.refreshFloorControls === "function") {
          window.MimicryOne.refreshFloorControls();
        }
        committed = true;
        if (perf) perf.afterPaint(function(painted){
          perf.record({painted:painted,route:'browser',key:performanceKey,floor:Number(floor),result:localResult,
            total_ms:performance.now()-requestStarted,
            cached:!!localOutcome.cached, stages:Object.assign({},localOutcome.timings,{display_ms:performance.now()-displayStarted})});
        });
        requestNote("Complete " + Number(floor) + "/9 result " + (workspaceParent ? "saved in Workspace" : "computed in this browser") + " · " +
          parentSetLabel(targetLibrary) + " · " + Number(localResult.ranked_matches.length).toLocaleString() +
          " matched parent records. Figures and downloads are available.");
        return true;
      }
      if (!precomputed) preflightLiveQuery(plan.liveQuery, floor);
      var loaded;
      try {
        loaded = precomputed
          ? await loadPrecomputedPlayer(plan, targetLibrary, floor, scanAbort.signal, function retry(retry, total, delay) {
            if (currentRequest()) reportStaticPlayerRetry(note, retry, total, delay);
          }, targetFilters)
          : { payload: await scanLivePlayer(plan, targetLibrary, floor, scanAbort.signal, function retry(retry, total, delay) {
            requestNote("Another indexed scan is finishing; retrying in " + (delay / 1000) + " s (" + retry + "/" + total + ")…");
          }, targetFilters), cached: false };
      } catch (error) {
        if (!currentRequest()) throw error;
        var continuation = window.MimicryLocalMappedResult;
        if (!precomputed || !allowLocalCompute || !continuation || !continuation.isRecoverableFailure(error) || !continuation.supported(plan, parentSet)) throw error;
        localMappedRun = true;
        requestNote(/*@copy analysis-entry.local-large-continuation*/`Computing the complete ${Number(floor)}/9 result on this device. The selected scope is unchanged; Cancel is available.`/*@endcopy*/);
        loaded = { payload: await continuation.run({plan:plan,parent:parentSet,floor:Number(floor),filters:targetFilters,
          release:state.releaseFingerprint,signal:scanAbort.signal,report:requestNote}), cached:false };
      }
      if (!currentRequest()) throw cancelledRequestError();
      var payload = loaded.payload;
      if (!plan.builtIn && plan.liveQuery && plan.liveQuery.kind === "fasta") {
        payload.reproduction_inputs = { original_query_fasta: plan.liveQuery.fasta };
      }
      var queryRecord = (payload.query_records || [])[0] || {};
      var queryLength = Number(queryRecord.length != null ? queryRecord.length : String(queryRecord.sequence || "").length);
      if (queryLength < 9) {
        requestNote("This assay has no 9-mer windows (" + queryLength + " AA). Previous result retained.", true);
        return false;
      }
      var displayStarted = performance.now(), presentedResult;
      await openNativePlayer(payload, targetLibrary, queryContext, scanAbort.signal, function commit(opened) {
        presentedResult = opened;
        if (!currentRequest()) throw cancelledRequestError();
        pendingRoute.proteinId = opened.protein.protein_id;
        pendingRoute.resultId = opened.result_id;
        state.activeRoute = pendingRoute;
        state.pendingRoute = null;
        if (window.MimicryOne && typeof window.MimicryOne.setHistoryContext === "function") {
          window.MimicryOne.setHistoryContext(opened.result_id, historyContextForRoute(pendingRoute));
        }
        if (window.MimicryOne && typeof window.MimicryOne.refreshFloorControls === "function") {
          window.MimicryOne.refreshFloorControls();
        }
        if (precomputed && !localMappedRun && !loaded.cached) rememberStaticPayload(loaded.cacheKey, payload);
        committed = true;
      }, historyUiContext.targetFilterState && historyUiContext.targetFilterState.singleMode ? historyUiContext.targetFilterState.singleRecord : null);
      if (perf) perf.afterPaint(function(painted){
        perf.record({painted:painted,route:localMappedRun?'browser_mapped':precomputed?'precomputed':'server_index',key:performanceKey,floor:Number(floor),result:presentedResult,
          cached:loaded.cached,total_ms:performance.now()-requestStarted,
          stages:Object.assign({},loaded.cached?{}:perf.network.get(payload),{display_ms:performance.now()-displayStarted})});
      });
      requestNote("Complete " + Number(floor) + "/9 result" + (localMappedRun ? " computed on this device" : "") + " · " + historyUiContext.targetLibraryLabel + ". Press Play to animate.");
    } catch (error) {
      // An old request may finish parsing or reject after its replacement starts.
      // It no longer owns status, route, controls, or any fallback.
      if (!ownsRequest()) return false;
      if (!currentRequest()) {
        if (scanAbort.signal.aborted) setNote(note, "Request canceled. Previous completed result retained.");
        return false;
      }
      var localChoice = window.MimicryLocalMappedResult;
      if (precomputed && !allowLocalCompute && note && localChoice &&
          localChoice.isRecoverableFailure(error) && localChoice.supported(plan, parentSet)) {
        requestNote(/*@copy analysis-entry.saved-local-choice*/`This saved result is unavailable or too large to deliver. The previous result is retained. You can choose to compute on this device. `/*@endcopy*/, true);
        var choice = document.createElement("button");
        choice.type = "button"; choice.className = "btn ghost";
        choice.textContent = (/*@copy analysis-entry.compute-on-device*/`Compute on this device`/*@endcopy*/);
        choice.addEventListener("click", function computeByChoice() {
          if (!choice.isConnected || choice.disabled || state.scanAbort || state.selectionPending ||
              scanAbort.signal.aborted || state.requestRevision !== requestRevision ||
              state.releaseFingerprint !== pendingRoute.releaseFingerprint ||
              state.filterPolicyFingerprint !== pendingRoute.filterPolicyFingerprint) return;
          choice.disabled = true;
          // A saved result may have become available since the first attempt.
          return runPlayerQuery(plan, targetLibrary, floor, note, trigger, queryContext,
            targetFilters, historyUiContext, true);
        });
        note.appendChild(choice);
        return false;
      }
      if (error.code === "returned_hit_limit_exceeded" ||
          (error.code === "async_required" && error.details && error.details.guard === "returned_positional_hits")) {
        // The observed count can be an early-stop count, not the complete result total.
        var maximum = Number(error.details && error.details.maximum);
        requestNote(Number.isSafeInteger(maximum) && maximum > 0
          ? (/*@copy analysis-entry.positional-response-limit*/`The server response limit is ${maximum.toLocaleString("en-US")} window pairs. This ${Number(floor)}/9 selection could not continue locally; the previous result remains displayed.`/*@endcopy*/)
          : (/*@copy analysis-entry.positional-response-limit-unknown*/`This ${Number(floor)}/9 selection exceeded the server response limit and could not continue locally; the previous result remains displayed.`/*@endcopy*/), true);
        return false;
      }
      if (error.code === "async_required" || (error.code === "live_timeout" && error.details && error.details.async_required)) {
        reportLocalComputeRequired(floor, note, error, scanAbort.signal);
        return false;
      }
      var projectionUnavailable = ["portable_projection_unavailable", "portable_projection_incomplete", "portable_projection_unsafe"].indexOf(error.code) >= 0;
      var canonicalTargetProjectionUnavailable = precomputed && parentSet.kind === "canonical_proteome" &&
        ["canonical_target_projection_unclassifiable", "canonical_target_unclassifiable_rows"].indexOf(error.code) >= 0;
      if (canonicalTargetProjectionUnavailable || projectionUnavailable) {
        requestNote("The requested " + Number(floor) + "/9 projection is unavailable. Previous result retained; choose a different threshold explicitly to compute a broader comparison.", true);
      } else {
        requestNote(((localMappedRun || localFloorRun) ? "Local calculation stopped: " : precomputed ? "Precomputed request stopped: " : "Index request stopped: ") + error.message, true);
      }
    } finally {
      if (ownsRequest()) {
        if (state.pendingRoute === pendingRoute) state.pendingRoute = null;
        state.scanAbort = null;
        syncRequestControlsBusy();
        if (cancel && !state.selectionPending) cancel.hidden = true;
        if (trigger) trigger.disabled = false;
        updateCustomControls();
      }
    }
    return committed;
  }

  // Native embeddable lifecycle; hosts never rewrite this selection implementation.
  window.MimicryMapViewer?.register({
    cancel:cancelPendingSelection,
    async select(record,settings){
      const allowed=window.MimicryMapViewer.options.libraryAllowed;
      if(!allowed(record.library))throw new Error('This sequence library is unavailable.');
      const prior=byId('entryTargetLibrary')?.value;
      setExploreTargetSet(targetSetValue(record.kind==='portable'?'protein':'library',record.library));
      const select=byId('entryTargetLibrary');
      let pair=settings.parentRecord;
      if(pair?.kind==='portable'){
        const reference=verifiedAnalysisReference(pair);
        if(!reference||reference.library!==pair.library)throw new Error('This exact comparison record is unavailable.');
        pair=Object.assign({},pair,{antigen_id:reference.antigenId});
      }
      if(pair && (!Number.isSafeInteger(Number(pair.antigen_id)) || Number(pair.antigen_id)<1 || !allowed(pair.library)))throw new Error('This exact comparison record is unavailable.');
      const choices=pair ? ['library:'+pair.library] : [settings.parentLibrary,prior,'library:canonical_human','library:canonical_exposure','library:huprot4','library:human_current','library:virscan_exposome_current'];
      const supported=choices.find(value=>value&&allowed(value)&&Array.from(select.options).some(option=>option.value===value&&!option.disabled));
      if(!supported)throw new Error('No supported comparison is available.');
      select.value=supported;
      if(settings.resetParentScope&&!pair)delete state.filterState.target[supported.replace(/^library:/,'')];
      if(settings.viralReferenceOnly){
        state.filterState.target.canonical_exposure=normalizeV4FilterState(filterOptions('canonical_exposure'),{source_collections:['viral_nonhuman']},'canonical_exposure');
      }
      if(pair){
        // Select the existing native catalog record through the ordinary single-parent scope.
        delete state.filterState.target[pair.library];
        const value=activeFilter('target',pair.library);
        if(!value)throw new Error('Single-record scope is unavailable for this library.');
        applyPinnedScope('target',pair.library,record.library);
        const current=activeFilter('target',pair.library);
        current.singleMode=true;
        current.singleRecord={id:Number(pair.antigen_id),
          label:[pair.display_gene||pair.gene,pair.display_accession||pair.accession||pair.platform_id].filter(Boolean).join(' / ')||String(pair.antigen_id),
          scope:JSON.stringify([supported,requestFilter('target',pair.library,true)])};
        syncExploreHistorySettings({targetSet:targetSetValue('library',record.library),targetLibrary:supported},true);
      }
      await chooseSuggestion(Object.assign({kind:'assay'},record),null,null,settings.floor||7);
      if(!state.activeRoute||byId('loadnote').dataset.state==='error')throw new Error(byId('loadnote').textContent||'Selected result unavailable.');
    }
  });
  async function chooseSuggestion(record, statusNote, activeSelection, requestedFloor) {
    var exploreNote = statusNote || byId("loadnote");
    var selection = activeSelection || beginSelection(exploreNote,
      suggestionIdentity(record),
      selectionDescriptor(record));
    if (!selection) return;
    // An authored example opens at the threshold it was authored for; everything else keeps
    // the stored 7/9 baseline. The lower floors are computed on the reader's own device and
    // cost the most, so one is never selected on their behalf except where a caller asks.
    var requested = Number(requestedFloor);
    var floor = requested >= 5 && requested <= 9 ? requested : STATIC_PLAYER_FLOOR;
    try {
      await paintPendingSelection(selection);
      if (!selectionIsCurrent(selection)) return;
      var context = null;
      if (record.kind === "portable") {
        setNote(exploreNote, "Loading " + record.portable_id + " from the read-only portability release…");
        var componentKey = componentKeyFor(record);
        var detailPath = "/api/explorer/proteins/" + encodeURIComponent(record.portable_id);
        if (componentKey) detailPath += "?" + new URLSearchParams({ component: componentKey }).toString();
        var detail = await fetchJson(detailPath, {
          signal: selection.controller.signal
        });
        record = Object.assign({ kind: "portable" }, record, detail.protein);
        if (!record.component_key && detail.component_key) record.component_key = detail.component_key;
        context = {
          component_key: componentKeyFor(record) || null,
          portable_id: record.parent_key || record.portable_id,
          parent_key: record.parent_key || record.portable_id,
          id_namespace: record.id_namespace,
          parent_class: record.parent_class || record.class,
          primary_gene: record.primary_gene,
          display_name: record.display_name,
          protein_name: record.protein_name,
          source_accession: record.source_accession,
          source_token: record.source_token,
          source_description: record.source_description,
          organism: record.organism,
          class: record.class,
          sequence: record.sequence,
          sequence_sha256: record.sequence_sha256,
          source_header: record.source_header,
          companion_header: record.companion_header,
          include_default: record.include_default,
          mapped_tile_count: record.mapped_tile_count,
          native_track_accession: record.native_track_accession,
          structure_accession: record.structure_accession,
          native_asset_crosswalk: record.native_asset_crosswalk
        };
      }
      if (!selectionIsCurrent(selection)) return;
      var plan = builtInQueryPlan(record);
      var selectedSet = currentTargetSet();
      var selectedSource = selectedSet.library;
      if (plan.sourceLibrary !== selectedSource) {
        var expectedClass = parentClassForSourceLibrary(selectedSource);
        var mismatch = record.kind === "portable"
          ? "This protein belongs to " + record.class + " parents; Antigen Target from is set to " + (expectedClass || libraryLabel(selectedSource)) + "."
          : "This Antigen Target is not in the selected target library.";
        setNote(exploreNote, mismatch, true);
        return;
      }
      var targetSelect = byId("entryTargetLibrary");
      var target = rebuildComparisonOptions(targetSelect, plan.sourceLibrary, floor);
      if (!target || !targetAvailable(plan, target, floor)) {
        setNote(exploreNote, "No manifest-authorized comparison is available for " + libraryLabel(plan.sourceLibrary) + " at " + floor + "/9.", true);
        return;
      }
      if (context && floor >= 7 && !plan.canonicalFallback) {
        context.projection_library = plan.sourceLibrary;
      }
      clearSuggestions();
      byId("pexploresearch").value = "";
      selection.committed = await runPlayerQuery(plan, target, floor, exploreNote, null, context);
    } catch (error) {
      if (state.selectionPending !== selection.token) return;
      setNote(exploreNote, error.name === "AbortError"
        ? "Selection canceled safely."
        : "Could not open the selected record: " + error.message, error.name !== "AbortError");
    } finally {
      if (state.selectionPending === selection.token && !selection.committed && exploreNote && exploreNote.dataset.state === "error") {
        selection.failureMessage = exploreNote.textContent || "The selected Antigen Target could not be opened.";
      }
      if (!activeSelection) endSelection(selection);
    }
  }

  function routeForProtein(proteinId, resultId) {
    var route = state.pendingRoute || state.activeRoute;
    if (!route) return null;
    if (route.releaseFingerprint && route.releaseFingerprint !== state.releaseFingerprint) return null;
    if (state.filterPolicyFingerprint &&
        route.filterPolicyFingerprint !== state.filterPolicyFingerprint) return null;
    if (route.proteinId && proteinId && route.proteinId !== proteinId) return null;
    if (route === state.activeRoute && route.resultId !== resultId) return null;
    if (route === state.pendingRoute && route.resultId && resultId && route.resultId !== resultId) return null;
    return route;
  }

  function routablePlayerFloors(proteinId, resultId) {
    var route = routeForProtein(proteinId, resultId);
    if (!route) return [];
    // Additive: a floor is only enabled when targetAvailable agrees, so offering the
    // whole range here enables exactly the floors this route can actually recompute.
    return [5, 6, 7, 8, 9].filter(function available(floor) {
      return targetAvailable(route.plan, route.targetLibrary, floor);
    });
  }

  function routePlayerFloor(floor, proteinId, resultId, awaitCompletion) {
    var selectedFloor = Number(floor);
    var route = routeForProtein(proteinId, resultId);
    // The caller only consults this when the in-memory result is not already complete at
    // the floor, so this intercepts genuine recomputes across the full range.
    if (!route || !(selectedFloor >= 5 && selectedFloor <= 9)) return false;
    var note = byId(route.noteId) || byId("loadnote");
    if (!targetAvailable(route.plan, route.targetLibrary, selectedFloor)) {
      setNote(note, targetUnavailableReason(route.plan, route.targetLibrary, selectedFloor), true);
      return true;
    }
    var title = document.querySelector("#ftitle .figline-id");
    var session = beginSelection(note, "floor:" + resultId + ":" + selectedFloor, {
      label: title && title.textContent.replace(/^Antigen Target\s*·\s*/, "") || "Antigen Target",
      mimicryParentLabel: parentSetLabel(route.targetLibrary),
      floor: selectedFloor
    });
    const completion = runPlayerQuery(
      route.plan, route.targetLibrary, selectedFloor, note, null,
      route.queryContext, route.targetFilters, route.historyUiContext
    ).then(function finished(committed) {
      session.committed = committed;
      return committed;
    }).finally(function finish() {
      if (state.selectionPending !== session.token) return;
      if (!session.committed && note && note.dataset.state === "error") session.failureMessage = note.textContent;
      endSelection(session);
    });
    return awaitCompletion ? completion : true;
  }

  function syncPlayerTarget(proteinId, resultId) {
    var route = routeForProtein(proteinId, resultId);
    if (!route && !state.pendingRoute) state.activeRoute = null;
    return !!route;
  }

  function installPlayerFloorBridge() {
    window.MimicryOneAnalysisRouting = {
      routableFloors: routablePlayerFloors,
      selectFloor: routePlayerFloor,
      syncTarget: syncPlayerTarget,
      openExample: openKnownTarget,
      restoreHistory: restoreHistoryRoute,
      captureNavigationInputs: captureNavigationInputs,
      restoreNavigationInputs: restoreNavigationInputs,
      clearNavigationRoute: function () { cancelPendingSelection(); state.activeRoute = null; state.pendingRoute = null; state.waitingSingleRoute = null; }
    };
  }

  // One lightweight exact-record scope picker, shared by built-in and custom targets.
  function installSingleParentPicker(options) {
    var singleToggle = element("div", {class:"entry-compact-switch entry-parent-mode", role:"group", "aria-label":singleCopy.mode});
    var libraryMode = element("button", {type:"button", id:options.prefix + "VsLibrary", "aria-pressed":"true"}, singleCopy.library);
    var singleMode = element("button", {type:"button", id:options.prefix + "VsSingle", "aria-pressed":"false"}, singleCopy.single);
    singleToggle.append(libraryMode, singleMode);
    options.heading.appendChild(singleToggle);
    var singleSearch = element("div", {class:"entry-single-search", id:options.prefix + "SingleParentSearch"});
    var singleInput = element("input", {type:"search", id:options.prefix + "ParentProteinSearch", placeholder:singleCopy.placeholder,
      autocomplete:"off", role:"combobox", "aria-autocomplete":"list", "aria-expanded":"false", "aria-controls":options.prefix + "ParentProteinResults"});
    var singleResults = element("div", {id:options.prefix + "ParentProteinResults", class:"slist", role:"listbox", "aria-label":singleCopy.results});
    var singleClear = element("button", {type:"button", id:options.prefix + "ClearParentProtein", class:"btn ghost", "aria-label":singleCopy.clear}, singleCopy.clear);
    var singleWrap = element("div", {class:"entry-single-input"});
    singleWrap.append(singleInput, singleClear);
    singleSearch.append(element("label", {for:options.prefix + "ParentProteinSearch"}, singleCopy.placeholder), singleWrap, singleResults);
    singleSearch.hidden = true;
    options.host.appendChild(singleSearch);
    var singleSearchAbort = null, singleSearchTimer = null, singleSearchContext = "", singleModeRequested = false;

    function singleValue() {
      var parent = parseParentSet(options.select.value);
      return parent.kind === "library" ? activeFilter(options.side, parent.library) : null;
    }
    function closeSingleResults() {
      singleResults.replaceChildren();
      singleResults.classList.remove("show");
      singleInput.setAttribute("aria-expanded", "false");
    }
    function stopSingleSearch() {
      clearTimeout(singleSearchTimer);
      if (singleSearchAbort) singleSearchAbort.abort();
      singleSearchAbort = null;
      closeSingleResults();
    }
    function syncSingleParent() {
      var parent = parseParentSet(options.select.value), value = singleValue();
      var context = JSON.stringify([parent.value, requestFilter(options.side, parent.library, true)]);
      if (context !== singleSearchContext) {
        stopSingleSearch();
        // A record chosen in another scope cannot silently survive a scope edit.
        if (value && value.singleRecord && value.singleRecord.scope !== context) value.singleRecord = null;
        singleInput.value = "";
        singleSearchContext = context;
      }
      var enabled = !options.enabled || options.enabled();
      singleToggle.hidden = !enabled;
      if (!enabled) stopSingleSearch();
      var selected = enabled && !!(value && value.singleMode);
      singleModeRequested = !!(value && value.singleMode);
      singleMode.disabled = !value;
      libraryMode.setAttribute("aria-pressed", String(!selected));
      singleMode.setAttribute("aria-pressed", String(selected));
      singleSearch.hidden = !selected;
      if (value && value.singleRecord) singleInput.value = value.singleRecord.label;
      singleClear.hidden = !selected || !(value.singleRecord || singleInput.value);
    }
    async function searchSingleParent() {
      stopSingleSearch();
      var value = singleValue(), query = singleInput.value.trim();
      if (!value || !value.singleMode || !query || (options.enabled && !options.enabled())) return;
      var parent = parseParentSet(options.select.value);
      var context = singleSearchContext, abort = new AbortController();
      singleSearchAbort = abort;
      var params = new URLSearchParams({q:query, limit:"10", library:parent.library});
      var searchScope = requestFilter(options.side, parent.library, true);
      if (searchScope) params.set("filters", JSON.stringify(searchScope));
      try {
        var payload;
        if(window.seromapDesktop?.mimicry&&parent.library.startsWith('workspace-')){
          var found=await window.seromapDesktop.mimicry('search',{id:parent.library.slice(10),search:query});
          payload={antigens:found.rows.map(r=>({...r.metadata,antigen_id:r.id}))};
        }else payload = await fetchSearchJson("/api/analysis/antigens?" + params, abort.signal);
        if (abort.signal.aborted || context !== singleSearchContext || singleSearchAbort !== abort) return;
        var rows = payload.antigens || payload.items || [];
        rows.forEach(function(record) {
          var identity = displayIdentity(Object.assign({kind:"assay"}, record), {activeLibrary:parent.library});
          var label = identity.displayLine || identity.primaryLine;
          var button = resultButton(String(record.antigen_id), label,
            [record.protein_name || record.description, record.organism].filter(Boolean).join(" · "),
            Number(record.length || 0).toLocaleString() + " AA");
          button.setAttribute("role", "option");
          button.dataset.tooltip = [label, record.protein_name || record.description, record.organism].filter(Boolean).join(" · ");
          button.addEventListener("click", function() {
            if (context !== singleSearchContext) return;
            cancelPendingSelection();
            var current = singleValue();
            current.singleRecord = {id:Number(record.antigen_id), label:label, scope:context};
            singleInput.value = label;
            state.requestRevision++;
            stopSingleSearch();
            options.refresh();
            options.onSelect();
          });
          singleResults.appendChild(button);
        });
        if (!rows.length) singleResults.appendChild(element("div", {class:"catalogue-no-match", role:"status"}, singleCopy.empty));
        singleResults.classList.add("show");
        singleInput.setAttribute("aria-expanded", "true");
      } catch(error) {
        if (!abort.signal.aborted && singleSearchAbort === abort) {
          singleResults.replaceChildren(element("div", {role:"status"}, singleCopy.failed + error.message));
          singleResults.classList.add("show");
        }
      }
    }
    function chooseSingleMode(enabled) {
      var value = singleValue();
      if (!value) return;
      cancelPendingSelection();
      pausePlayerForSelection();
      value.singleMode = enabled;
      state.requestRevision++;
      stopSingleSearch();
      options.refresh();
      if (enabled && !value.singleRecord) { setNote(options.note(), singleCopy.choose); singleInput.focus(); }
      else options.onSelect();
    }
    libraryMode.addEventListener("click", function(){chooseSingleMode(false);});
    singleMode.addEventListener("click", function(){chooseSingleMode(true);});
    singleInput.addEventListener("input", function(){
      var value = singleValue();
      cancelPendingSelection();
      pausePlayerForSelection();
      if (value) value.singleRecord = null;
      state.requestRevision++;
      stopSingleSearch();
      singleClear.hidden = !singleInput.value;
      options.refresh();
      setNote(options.note(), singleCopy.choose);
      singleSearchTimer = setTimeout(searchSingleParent, 250);
    });
    singleClear.addEventListener("click", function(){singleInput.value="";singleInput.dispatchEvent(new Event("input"));singleInput.focus();});
    singleInput.addEventListener("keydown", function(event){
      if (event.key === "Escape") stopSingleSearch();
      if (event.key === "ArrowDown") {var first=singleResults.querySelector("button");if(first){event.preventDefault();first.focus();}}
      if (event.key === "Enter") {event.preventDefault();searchSingleParent();}
    });
    singleResults.addEventListener("keydown", function(event){
      var buttons=Array.from(singleResults.querySelectorAll("button")), index=buttons.indexOf(document.activeElement);
      if(event.key === "Escape"){stopSingleSearch();singleInput.focus();}
      if(event.key === "ArrowDown" || event.key === "ArrowUp") {event.preventDefault();var next=buttons[index+(event.key === "ArrowDown" ? 1 : -1)];if(next)next.focus();else singleInput.focus();}
    });
    document.addEventListener("click", function(event){if(!singleSearch.contains(event.target))closeSingleResults();});
    return {
      sync: syncSingleParent,
      clear: function() {stopSingleSearch();var value=singleValue();if(value){value.singleMode=singleModeRequested;value.singleRecord=null;}singleInput.value="";}
    };
  }

  function installExploreControls() {
    var originalInput = byId("pexploresearch");
    var originalResults = byId("pexploreresults");
    if (!originalInput || !originalResults || byId("entryExploreControls")) return;
    var input = originalInput.cloneNode(true);
    var results = originalResults.cloneNode(false);
    originalInput.replaceWith(input);
    originalResults.replaceWith(results);

    var searchWrap = input.closest(".catalogue-search-visible");
    var searchLabel = document.querySelector('.explore-catalogue label[for="pexploresearch"]');
    var controls = element("div", { class: "entry-explore-controls", id: "entryExploreControls" });
    var queryStep = element("section", {
      class: "entry-explore-step entry-explore-query", "aria-labelledby": "entryQueryStepTitle"
    });
    var queryStepTitle = element("h3", { class: "entry-step-heading", id: "entryQueryStepTitle" });
    queryStepTitle.append(
      element("span", { class: "entry-step-number", "aria-hidden": "true" }, "1"),
      element("span", { class: "entry-step-label" }, "Choose Individual Antigen Target:")
    );
    queryStep.appendChild(queryStepTitle);
    var querySelectRow = element("div", { class: "entry-step-select-row" });
    var source = element("label", { class: "entry-mini-field" });
    source.append(
      element("span", { class: "entry-visually-hidden" }, "Antigen Target library"),
      element("select", { id: "entryTargetSet", "aria-label": "Antigen Target library" })
    );
    addTargetSetOptions(source.querySelector("select"), targetSetValue("protein", "panscan9_human"));
    var queryFilterControl = element("div", {
      class: "entry-filter-control entry-query-filter-control", id: "entryQueryFilterControl"
    });
    var queryFilterButton = element("button", {
      type: "button", class: "entry-scope-button", id: "entryQueryScopeButton",
      "data-tooltip": "Filter which records appear in Antigen Target search.",
      "aria-expanded": "false", "aria-controls": "entryQueryFilterPopover"
    }, "Scope");
    var queryFilterPopover = element("div", {
      class: "entry-filter-popover entry-filter-popover-query", id: "entryQueryFilterPopover"
    });
    queryFilterPopover.hidden = true;
    queryFilterControl.append(queryFilterButton, queryFilterPopover);
    querySelectRow.append(source, queryFilterControl);
    queryStep.appendChild(querySelectRow);
    if (!searchLabel) {
      searchLabel = element("label", { for: "pexploresearch" }, "");
    }
    searchLabel.textContent = (/*@copy analysis-entry.find-antigen-target.ed4fc41*/`Gene, accession, description, etc.`/*@endcopy*/);
    queryStep.append(searchLabel, searchWrap);

    var parentStep = element("section", {
      class: "entry-explore-step entry-explore-parent", "aria-labelledby": "entryParentStepTitle"
    });
    var parentStepTitle = element("h3", { class: "entry-step-heading", id: "entryParentStepTitle" });
    parentStepTitle.append(
      element("span", { class: "entry-step-number", "aria-hidden": "true" }, "2"),
      element("span", { class: "entry-step-label" }, (/*@copy analysis-entry.choose-mimicry-parent.step-heading*/`Choose Mimicry Parent:`/*@endcopy*/))
    );
    parentStep.appendChild(parentStepTitle);
    var parentSelectRow = element("div", { class: "entry-step-select-row" });
    var target = element("label", { class: "entry-mini-field" });
    target.append(
      element("span", { class: "entry-visually-hidden" }, "Mimicry Parent library"),
      element("select", { id: "entryTargetLibrary", "aria-label": "Mimicry Parent library" })
    );
    var parentFilterControl = element("div", {
      class: "entry-filter-control entry-parent-filter-control", id: "entryParentFilterControl"
    });
    var parentFilterButton = element("button", {
      type: "button", class: "entry-scope-button", id: "entryParentScopeButton",
      "data-tooltip": "Restrict the comparison library. Apply or close this menu to update the result.",
      "aria-expanded": "false", "aria-controls": "entryParentFilterPopover"
    }, "Scope");
    var parentFilterPopover = element("div", {
      class: "entry-filter-popover entry-filter-popover-parent", id: "entryParentFilterPopover"
    });
    var filterActions = element("div", { class: "entry-filter-actions" });
    var filterActionNote = element("span", {}, "Apply parent scope to the open Antigen Target.");
    var applyScope = element("button", {
      type: "button", id: "entryApplyScope", disabled: "",
      "data-tooltip": "Re-run the open Antigen Target against the selected parent subset."
    }, "Apply scope");
    filterActions.append(filterActionNote, applyScope);
    parentFilterPopover.hidden = true;
    parentFilterControl.append(parentFilterButton, parentFilterPopover);
    parentSelectRow.append(target, parentFilterControl);
    parentStep.appendChild(parentSelectRow);
    var singlePicker = installSingleParentPicker({
      side:"target", prefix:"entry", select:target.querySelector("select"), heading:parentStepTitle, host:parentStep,
      note:function(){return byId("loadnote");}, refresh:updateSourceFilterControl, onSelect:rerunOpenTargetForParent
    });
    var liveParentScope=element("div",{id:"entryLiveParentScope",class:"entry-live-parent-scope","aria-live":"polite"});
    // Scope status aligns below the parent card, beside target request status.
    var direction = element("div", { class: "entry-explore-direction", "aria-hidden": "true" });
    direction.appendChild(element("span", { class: "entry-direction-arrow" }, "→"));
    controls.append(queryStep, direction, parentStep);
    var explore = document.querySelector(".explore-catalogue");
    if (explore) explore.prepend(controls);
    var methodNote = byId("loadnote");
    if (!methodNote) {
      methodNote = element("p", { class: "note", id: "loadnote", role: "status", "aria-live": "polite" }, "Choose an Antigen Target set and where to look for Mimicry Parents, then search.");
      searchWrap.after(methodNote);
    }

    var targetStatus = methodNote.closest(".atlas-status-stack");
    if (!targetStatus) {
      targetStatus = element("div", {class:"atlas-status-stack"});
      var statusLine = element("div", {class:"atlas-status-line"});
      statusLine.appendChild(methodNote);
      targetStatus.appendChild(statusLine);
    }
    var oldStatusRow = targetStatus.closest(".atlas-lower-row");
    targetStatus.classList.add("entry-target-status");
    var liveTargetScope = element("strong", {id:"entryLiveTargetScope", "aria-live":"polite"});
    liveTargetScope.hidden = true;
    var liveTargetHeading = element("div", {class:"entry-live-target-heading"});
    liveTargetHeading.appendChild(liveTargetScope);
    targetStatus.prepend(liveTargetHeading);
    if (byId("catalogCancel")) liveTargetHeading.appendChild(byId("catalogCancel"));
    controls.append(targetStatus, liveParentScope);
    if (oldStatusRow && !oldStatusRow.children.length) oldStatusRow.remove();

    function resetExploreSearch() {
      window.clearTimeout(state.searchTimer);
      if (state.searchAbort) state.searchAbort.abort();
      state.searchAbort = null;
      input.value = "";
      clearSuggestions();
    }

    function compactCount(value) {
      var number = Number(value || 0);
      if (number >= 1000000) return (number / 1000000).toFixed(number >= 10000000 ? 0 : 1) + "m";
      if (number >= 1000) return (number / 1000).toFixed(number >= 100000 ? 0 : 1) + "k";
      return number.toLocaleString();
    }

    function filterLabel(field, name, fallback) {
      var virscanLabel = (/*@copy analysis-entry.virscan-scope-caption*/`VirScan (CDIV2)`/*@endcopy*/);
      var humanSubsetLabel = (/*@copy analysis-entry.virscan-human-subset-caption*/`Curated human-infecting subset`/*@endcopy*/);
      var labels = {
        "facets:iedb": "IEDB",
        "facets:exposome": "Exposome",
        "facets:allergen": "Allergen",
        "facets:virus": "Virus-tagged (all collections)",
        "facets:swissprot": "Swiss-Prot",
        "facets:hormone": "Hormone",
        "source_collections:viral_nonhuman": "Curated Viral Proteomes (120)",
        "source_collections:iedb_nonhuman": "IEDB non-human antigens",
        "source_collections:frozen_r3_exposure": "Core Exposome",
        "source_collections:allergome": (/*@copy analysis-entry.allergome-uniprot-tag*/`Allergome (UniProt tag)`/*@endcopy*/),
        "source_collections:human_canonical_swissprot": "Swiss-Prot",
        "source_collections:panscan9_trembl": (/*@copy analysis-entry.additional-trembl*/`Additional TrEMBL`/*@endcopy*/),
        "source_collections:hormone_fasta": "Peptide hormones",
        "source_collections:current_sequence_overlay": "Supplemental records",
        "sublibraries:Virus": "Virus collection",
        "sublibraries:SwissProt": "Swiss-Prot",
        "sublibraries:HORDB": "Peptide hormones",
        "domain_groups:Eukaryota": "Eukaryotes",
        "domains:Eukaryota": "Eukaryotes",
        "legacy_sources:virscan": virscanLabel,
        "legacy_sources:VirScan": virscanLabel,
        "legacy_sources:virscan_legacy": virscanLabel,
        "legacy_sources:exposome": "Exposome (CDIV3)",
        "legacy_sources:Exposome": "Exposome (CDIV3)",
        "legacy_sources:exposome_legacy": "Exposome (CDIV3)",
        "human_tropism_statuses:confirmed_host_9606": "Confirmed human host",
        "human_tropism_statuses:legacy_human_subset_match": humanSubsetLabel,
        "human_tropism_statuses:legacy_human_subset": humanSubsetLabel,
        "human_tropism_statuses:included": humanSubsetLabel,
        "human_tropism_statuses:not_included": (/*@copy analysis-entry.virscan-other-subset-caption*/`Outside curated human-infecting subset`/*@endcopy*/),
        "human_tropism_statuses:unlabelled": "Host status unlabeled (Exposome)",
        "human_tropism_statuses:curated_gap_supplement": "Curated human-virus supplement"
      };
      return labels[field + ":" + name] || fallback || name;
    }

    function appendCheckboxGroup(section, title, field, entries, selected, limit) {
      if (!entries.length) return;
      var group = element("div", { class: "entry-filter-group" });
      group.appendChild(element("strong", {}, title));
      entries.slice(0, limit || entries.length).forEach(function appendOption(item) {
        var help = filterLabel(field, item.value, item.label);
        if (field === "source_collections" && item.value === "viral_nonhuman")
          help += ". Exact curated-proteome membership, not every record assigned to these species.";
        if (item.count != null)
          help += " · " + Number(item.count).toLocaleString() + " in this metadata category. Categories may overlap.";
        var label = element("label", { dataset: { tooltip: help } });
        var input = element("input", {
          type: "checkbox", value: item.value, dataset: { field: field }
        });
        input.checked = selected.indexOf(item.value) >= 0;
        label.append(
          input,
          element("span", {}, filterLabel(field, item.value, item.label)),
          element("small", {}, item.count == null ? "" : compactCount(item.count))
        );
        group.appendChild(label);
      });
      section.appendChild(group);
    }

    function appendPickerGroup(section, title, field, entries, selected, forcePicker) {
      if (!entries.length) return;
      if (!forcePicker && entries.length <= 8) {
        appendCheckboxGroup(section, title + " · unrestricted if empty", field, entries, selected);
        return;
      }
      var selectedValues = new Set(selected || []);
      var byValue = new Map(entries.map(function pair(item) { return [item.value, item]; }));
      var group = element("div", { class: "entry-filter-group entry-filter-picker" });
      group.appendChild(element("strong", {}, title + " · " +
        (selectedValues.size ? selectedValues.size + " selected" : "any")));
      var picker = element("select", {
        dataset: { filterAdd: field }, "aria-label": "Add " + title.toLowerCase()
      });
      picker.appendChild(element("option", { value: "" }, "Add " + title.toLowerCase() + "…"));
      entries.forEach(function addOption(item) {
        if (selectedValues.has(item.value)) return;
        picker.appendChild(element("option", { value: item.value }, item.label +
          (item.count == null ? "" : " · " + compactCount(item.count))));
      });
      group.appendChild(picker);
      selectedValues.forEach(function showSelected(name) {
        var item = byValue.get(name) || { value: name, label: name, count: null };
        var label = element("label", { dataset: { tooltip: item.label } });
        var input = element("input", {
          type: "checkbox", value: item.value, dataset: { field: field }
        });
        input.checked = true;
        label.append(
          input,
          element("span", {}, item.label),
          element("small", {}, item.count == null ? "" : compactCount(item.count))
        );
        group.appendChild(label);
      });
      section.appendChild(group);
    }

    function appendOrganismPicker(section, options, value, v4, speciesOnly) {
      var original = filterOptions(section.dataset.library) || {};
      var specs=v4 ? V4_ADVANCED_TAXONOMY_FIELDS.concat([{field:"source_organisms",label:(/*@copy analysis-entry.organism.bab9696*/`Organism`/*@endcopy*/)}])
        : [{field:"genera",label:(/*@copy analysis-entry.genus.5e99945*/`Genus`/*@endcopy*/)},{field:"species",label:(/*@copy analysis-entry.species.121ac00*/`Species`/*@endcopy*/)}];
      if (speciesOnly) specs = specs.filter(function(spec) {
        return spec.field === "species" || spec.field === "source_organisms";
      });
      // Top-ranked metadata samples cannot back a complete organism search.
      // Keep previously selected filters visible and removable while search is hidden.
      if (!v4 && ((!Array.isArray(original.genera) && Array.isArray(original.top_genera)) ||
          (!Array.isArray(original.species) && Array.isArray(original.top_species)))) {
        var selectedGroup = element("div", {class:"entry-filter-group"});
        selectedGroup.appendChild(element("strong", {}, (/*@copy analysis-entry.selected-organism-filters*/`Selected organism filters`/*@endcopy*/)));
        specs.forEach(function retainSelected(spec) {
          (value[spec.field] || []).forEach(function appendSelected(name) {
            var label = element("label", {});
            var input = element("input", {type:"checkbox",value:name,dataset:{field:spec.field}});
            input.checked = true;
            label.append(input, element("span", {}, name.replace(/_/g," ") + " · " + spec.label));
            selectedGroup.appendChild(label);
          });
        });
        if (selectedGroup.children.length > 1) section.appendChild(selectedGroup);
        return;
      }
      var choices=[];
      specs.forEach(function(spec){
        var names=spec.field==="genera"?["top_genera","genera"]:spec.field==="species"?["top_species","species"]:[spec.field];
        optionEntries(options,names).forEach(function(item){choices.push({field:spec.field,rank:spec.label,value:item.value,label:item.label});});
      });
      if (!choices.length) return;
      var group=element("div",{class:"entry-filter-group entry-filter-picker"});
      group.appendChild(element("strong",{},"Narrow by organism"));
      var search=element("input",{type:"search",placeholder:"Find an organism or taxonomic group…","aria-label":"Find organism or taxon"});
      var listId="scopeOrganisms-"+section.dataset.side+"-"+section.dataset.library;
      var picker=element("div",{class:"entry-organism-results",id:listId,role:"listbox","aria-label":"Matching organisms and taxa",hidden:""});
      search.setAttribute("aria-controls",listId);
      search.setAttribute("aria-autocomplete","list");
      search.setAttribute("aria-expanded","false");
      function choose(item,event){
        event.preventDefault();event.stopPropagation();
        value[item.field]=Array.from(new Set((value[item.field] || []).concat(item.value)));
        reconcileScope(section.dataset.library,value,item.field);
        var side=section.dataset.side;
        updateSourceFilterControl();
        if(side==="query") refreshScopedTargetSearch();
        var panel=side==="custom"?byId("entryCustomScopePopover"):side==="query"?queryFilterPopover:parentFilterPopover;
        var next=panel.querySelector('input[aria-label="Find organism or taxon"]');
        if(next) next.focus({preventScroll:true});
        fitOpenScopes();
      }
      function populate(){
        picker.replaceChildren();
        var term=search.value.trim().toLowerCase();
        // Search aliases affect discovery only, never membership or taxonomy.
        if(term==="ebv") term="epstein";
        if(/^sars[ -]?cov[ -]?2$/.test(term)) term="severe acute respiratory syndrome coronavirus 2";
        var matches=term ? choices.filter(function(item){return !(value[item.field] || []).includes(item.value) &&
          (item.label+" "+item.value+" "+item.rank).toLowerCase().includes(term);}) : [];
        picker.hidden=!term;search.setAttribute("aria-expanded",term?"true":"false");
        matches.slice(0,60).forEach(function(item){
          var option=element("button",{type:"button",role:"option","aria-selected":"false"},item.label+" · "+item.rank);
          option.addEventListener("click",function(event){choose(item,event);});
          picker.appendChild(option);
        });
        if(term && !matches.length) picker.appendChild(element("p",{role:"status"},(/*@copy analysis-entry.organism-search-empty*/`No matching organisms or taxa in this scope.`/*@endcopy*/)));
        if(matches.length>60) picker.appendChild(element("p",{},(/*@copy analysis-entry.organism-search-narrow*/`Keep typing to narrow ${matches.length} matches.`/*@endcopy*/)));
        fitOpenScopes();
      }
      search.addEventListener("input",populate);
      group.addEventListener("keydown",function(event){
        var buttons=Array.from(picker.querySelectorAll("button")),index=buttons.indexOf(document.activeElement);
        if(event.key==="ArrowDown" && buttons.length){event.preventDefault();buttons[(index+1)%buttons.length].focus();}
        else if(event.key==="ArrowUp" && buttons.length){event.preventDefault();buttons[index<=0?buttons.length-1:index-1].focus();}
        else if(event.key==="Enter" && event.target===search && buttons.length){event.preventDefault();buttons[0].click();}
      });
      populate();group.append(search,picker);
      choices.filter(function(item){return (value[item.field] || []).includes(item.value);}).forEach(function(item){
        var label=element("label",{}),input=element("input",{type:"checkbox",value:item.value,dataset:{field:item.field}});
        input.checked=true;label.append(input,element("span",{},item.label+" · "+item.rank));group.appendChild(label);
      });
      section.appendChild(group);
    }

    function appendV4FilterControls(section, options, value, libraryKey) {
      var fixedCanonicalHuman = libraryKey === "canonical_human";
      var sourceCollections = optionEntries(options, "source_collections").sort(function curatedFirst(a, b) {
        if (a.value === "viral_nonhuman") return -1;
        if (b.value === "viral_nonhuman") return 1;
        return 0;
      });
      appendCheckboxGroup(section, "Source collections", "source_collections",
        sourceCollections, (value.source_collections || []).length ? value.source_collections : sourceCollections.map(function(item){return item.value;}));
      if ((value.facets || []).length) {
        // A restored filter must remain visible/removable; do not silently
        // broaden it or turn a provenance tag into a different collection.
        appendCheckboxGroup(section, "Active filters", "facets",
          optionEntries(options, "facets").filter(function(item){return value.facets.includes(item.value);}), value.facets);
      }
      if (!fixedCanonicalHuman) {
        appendTaxonomyGroup(section, options, value);
        appendOrganismPicker(section, options, value, true);
      }
      appendCheckboxGroup(section, "Subcellular location", "locations",
        optionEntries(options, "locations"), value.locations || []);
      appendCheckboxGroup(section, "Accessibility", "accessibilities",
        optionEntries(options, "accessibilities"), value.accessibilities || []);
      appendCheckboxGroup(section, "Sequence region", "regions",
        optionEntries(options, "regions"), value.regions || []);

      var flags = element("div", { class: "entry-filter-group entry-filter-flags" });
      if (!optionEntries(options, "domain_groups").length && v4TaxonomyNarrowed(value) &&
          (value.domain_groups || []).indexOf("Unclassified") < 0 &&
          Number(options.include_unclassified &&
            options.include_unclassified.distinct_parent_count || 0) > 0) {
        var unclassifiedLabel = element("label", {
          dataset: { tooltip: (/*@copy analysis-entry.also-include-records-whose-taxonomy.1930524*/`Also include records that are unclassified at this taxonomic level.`/*@endcopy*/) }
        });
        var unclassifiedInput = element("input", {
          type: "checkbox", value: "include_unclassified",
          dataset: { field: "include_unclassified" }
        });
        unclassifiedInput.checked = value.include_unclassified === true;
        unclassifiedLabel.append(
          unclassifiedInput,
          element("span", {}, "Also include unclassified"),
          element("small", {}, compactCount(
            options.include_unclassified.distinct_parent_count
          ))
        );
        flags.appendChild(unclassifiedLabel);
      }
      if ((value.facets || []).indexOf("iedb") >= 0 ||
          ((value.source_collections || []).length===1 && value.source_collections[0]==="iedb_nonhuman")) {
        var referenceSelect = element("select", {
          dataset: { filterScalar: "min_references" },
          "aria-label": "Minimum IEDB references"
        });
        referenceSelect.appendChild(element("option", { value: "" }, "Any IEDB reference count"));
        optionEntries(options, "min_references").forEach(function threshold(item) {
          referenceSelect.appendChild(element("option", { value: item.value }, item.label +
            (item.count == null ? "" : " · " + compactCount(item.count))));
        });
        referenceSelect.value = value.min_references == null ? "" : String(value.min_references);
        flags.appendChild(referenceSelect);
      }
      if (flags.children.length) section.appendChild(flags);
    }

    function appendLegacyCollectionGroup(section, options, value) {
      // Show the complete source counts even when organism refinements are active.
      var original = filterOptions(LEGACY_COLLECTION_LIBRARY);
      var sourceCounts = new Map(optionEntries(
        original, ["legacy_sources", "legacy_source_libraries"]
      ).map(function pair(item) { return [item.value, item.count]; }));
      var statusCounts = new Map(optionEntries(original, "human_tropism_statuses")
        .map(function pair(item) { return [item.value, item.count]; }));
      var subset = legacyHumanSubsetMetadata();
      var modes = new Set(deriveLegacyCollectionModes(value));
      var group = element("div", { class: "entry-filter-group entry-filter-legacy-collections" });
      group.appendChild(element("strong", {}, "Source collections"));
      [
        {
          value: "cdiv2_human", label: (/*@copy analysis-entry.human-virus-subset-cdiv.51af5da*/`Human-virus VirScan (CDIV2)`/*@endcopy*/),
          count: statusCounts.get(subset.selectable_status || "included"),
          title: (/*@copy analysis-entry.virscan-human-scope-help*/`VirScan peptides in the curated human-infecting virus subset. Check both VirScan subsets for the full CDIV2 library.`/*@endcopy*/)
        },
        {
          value: "cdiv2_other", label: (/*@copy analysis-entry.virscan-other-scope-label*/`Other VirScan (CDIV2)`/*@endcopy*/),
          count: statusCounts.get("not_included"),
          title: (/*@copy analysis-entry.virscan-other-scope-help*/`VirScan peptides outside the curated human-virus subset, including viruses of nonhuman hosts.`/*@endcopy*/)
        },
        {
          value: "cdiv3_exposome", label: (/*@copy analysis-entry.exposome-scope-label*/`Exposome (CDIV3)`/*@endcopy*/),
          count: sourceCounts.get("exposome_legacy"),
          title: (/*@copy analysis-entry.complete-cdiv-exposome-collection-independent.85f4d3c*/`Complete CDIV3 Exposome add-on; select independently of either VirScan subset.`/*@endcopy*/)
        }
      ].forEach(function appendCollection(item) {
        var count = item.count == null ? "" : Number(item.count).toLocaleString("en-US");
        var label = element("label", { dataset: { tooltip: item.title + (count ? " " + count + " peptides." : "") } });
        var input = element("input", {
          type: "checkbox", value: item.value,
          dataset: { field: "legacy_collection_modes" }
        });
        input.checked = modes.has(item.value);
        label.append(input, element("span", {}, item.label), element("small", {}, count));
        group.appendChild(label);
      });
      section.appendChild(group);
    }

    function appendTaxonomyGroup(section, options, value) {
      var v4 = isV4FilterOptions(options);
      var domains = optionEntries(options, v4 ? "domain_groups" : "domains");
      var domainOrder = TAXONOMY_DOMAIN_ORDER.concat(["Unclassified"]);
      domains.sort(function(a,b){
        var ai=domainOrder.indexOf(a.value), bi=domainOrder.indexOf(b.value);
        return (ai<0?99:ai)-(bi<0?99:bi) || a.label.localeCompare(b.label);
      });
      if (domains.length < 2) return;
      var selected = new Set(v4
        ? ((value.domain_groups || []).length ? value.domain_groups : domains.map(function(item){ return item.value; }))
        : (value.domains || []));
      if (v4 && value.include_unclassified === true) selected.add("Unclassified");
      var unresolved = v4 ? 0 : taxonomyUnresolvedCount(options);
      var allSelected = domains.every(function checked(item) { return selected.has(item.value); });
      var anySelected = domains.some(function checked(item) { return selected.has(item.value); }) ||
        value.include_unclassified === true;
      var group = element("div", { class: "entry-filter-group entry-filter-taxonomy" });
      group.appendChild(element("strong", {}, "Taxonomic group"));
      var allLabel = element("label", {
        dataset: { tooltip: (/*@copy analysis-entry.select-every-classified-domain-and.e2fef1f*/`Select every classified domain and all unclassified records.`/*@endcopy*/) }
      });
      var allInput = element("input", {
        type: "checkbox", value: "all",
        dataset: { field: "taxonomy_all" }
      });
      allInput.checked = allSelected && !value.exclude_vertebrates && !value.exclude_mammals && (unresolved === 0 || value.include_unclassified === true);
      allInput.indeterminate = !allInput.checked && anySelected;
      allLabel.append(allInput, element("span", {}, "All groups"));
      group.appendChild(allLabel);
      domains.forEach(function appendDomain(item) {
        var displayLabel = item.value === "Eukaryota" ? "Eukaryotes" : item.label;
        var label = element("label", { dataset: { tooltip: displayLabel } });
        var input = element("input", {
          type: "checkbox",
          value: item.value,
          dataset: { field: v4 ? "taxonomy_groups" : "domains" }
        });
        input.checked = selected.has(item.value);
        label.append(
          input,
          element("span", {}, displayLabel),
          element("small", {}, item.count == null ? "" : compactCount(item.count))
        );
        group.appendChild(label);
        if (v4 && item.value === "Eukaryota") {
          var baseOptions = filterOptions(section.dataset.library);
          ["vertebrates", "mammals"].forEach(function appendSubgroup(name) {
            var capability = baseOptions["exclude_" + name];
            var count = Number(capability && capability[name === "vertebrates" ? "distinct_vertebrate_parent_count" : "distinct_mammal_parent_count"] || 0);
            if (!count) return;
            var childLabel = element("label", {class: "entry-taxonomy-" + name, dataset: {tooltip: name === "vertebrates"
              ? (/*@copy analysis-entry.exclude-vertebrates-help*/`Uncheck to exclude vertebrates, including mammals. Shared sequences remain when a resolved non-vertebrate source qualifies.`/*@endcopy*/)
              : (/*@copy analysis-entry.exclude-provenance-rows-assigned-to.c843572*/`Uncheck to exclude mammalian sources. Shared sequences remain when a non-mammalian source qualifies.`/*@endcopy*/)}});
            var childInput = element("input", {type: "checkbox", value: name, dataset: {field: "include_" + name}});
            childInput.checked = selected.has("Eukaryota") && !value.exclude_vertebrates && (name !== "mammals" || !value.exclude_mammals);
            childLabel.append(childInput, element("span", {}, name === "vertebrates"
              ? (/*@copy analysis-entry.vertebrates-label*/`Vertebrates`/*@endcopy*/)
              : (/*@copy analysis-entry.mammals-label*/`Mammals`/*@endcopy*/)), element("small", {title: count.toLocaleString()}, compactCount(count)));
            group.appendChild(childLabel);
          });
        }
      });
      if (unresolved > 0) {
        var unresolvedLabel = element("label", {
          class: "entry-filter-unclassified",
          dataset: { tooltip: (/*@copy analysis-entry.records-without-a-resolved-domain.efec5b9*/`Records without a resolved domain assignment.`/*@endcopy*/) }
        });
        var unresolvedInput = element("input", {
          type: "checkbox", value: "unclassified",
          dataset: { field: "include_unclassified" }
        });
        unresolvedInput.checked = value.include_unclassified === true;
        unresolvedLabel.append(
          unresolvedInput,
          element("span", {}, "Unclassified"),
          element("small", {}, compactCount(unresolved))
        );
        group.appendChild(unresolvedLabel);
      }
      section.appendChild(group);
    }

    function isFixedHumanFacet(options) {
      var domains = optionEntries(options, "domains");
      var species = optionEntries(options, ["top_species", "species"]);
      var biologicalRows = Number(options.row_count || 0) - Number(options.controls || 0);
      return taxonomyUnresolvedCount(options) === 0 &&
        domains.length === 1 && domains[0].value === "Eukaryota" &&
        species.length === 1 && species[0].value === "Homo sapiens" &&
        Number(species[0].count || 0) === biologicalRows;
    }

    function filterSection(side, key, heading, pinnedRule) {
      pinnedRule = pinnedRule && pinnedRule.library === key ? pinnedRule : null;
      if (pinnedRule) applyPinnedScope(side, key, pinnedRule.partner);
      var options = filterOptions(key);
      if (!options) return null;
      var value = activeFilter(side, key);
      options = dependentScopeOptions(key,value);
      var section = element("fieldset", {
        class: "entry-filter-section", dataset: { side: side, library: key }
      });
      section.appendChild(element("legend", {}, heading + " · " + libraryLabel(key)));
      var resetScope = element("button", { type: "button", class: "btn ghost",
        dataset: { tooltip: (/*@copy analysis-entry.clear-narrowing-filters-and-restore.368b6f1*/`Clear narrowing filters and restore every available group, including unclassified records.`/*@endcopy*/) } }, "Reset scope");
      resetScope.addEventListener("click", function resetLibraryScope(event) {
        event.stopPropagation();
        state.requestRevision++;
        var wasSingle = (side === "target" || side === "custom") && activeFilter(side, key).singleMode;
        delete state.filterState[side][key];
        if (isV4FilterOptions(options)) {
          state.filterState[side][key] = normalizeV4FilterState(options,
            {include_unclassified: true, exclude_mammals: false, exclude_vertebrates: false}, key);
        }
        if (wasSingle) activeFilter(side, key).singleMode = true;
        updateSourceFilterControl();
        if (side === "query") refreshScopedTargetSearch();
        fitOpenScopes();
      });
      section.appendChild(resetScope);
      section.appendChild(element("p", { class: "entry-method-note scope-selection-note", role: "status" },value.scopeNotice || ""));
      function appendScopeSummary() {
        if (side==="query") return;
        var filters=requestFilter(side,key) || {}, parts=[];
        Object.keys(filters).forEach(function(field){
          if (field === "record_ids") return;
          if (Array.isArray(filters[field])) filters[field].forEach(function(item){parts.push(filterLabel(field,item,item));});
          else if (field==="exclude_mammals" && filters[field]) parts.push("No mammals");
          else if (field==="exclude_vertebrates" && filters[field]) parts.push((/*@copy analysis-entry.no-vertebrates-label*/`No vertebrates`/*@endcopy*/));
          else if (field==="min_references") parts.push("IEDB references ≥"+filters[field]);
        });
        section.appendChild(element("p",{class:"entry-scope-summary"},"Scope: "+(parts.length ? parts.join(" · ") : "All available records")));
      }
      if (pinnedRule) {
        section.dataset.pinnedCollection = pinnedRule.value;
        resetScope.dataset.tooltip = (/*@copy analysis-entry.pinned-virus-reset*/`Clear virus selections within Curated Viral Proteomes (120).`/*@endcopy*/);
        section.appendChild(element("p", {class:"entry-method-note"},
          (/*@copy analysis-entry.pinned-virus-scope*/`Curated Viral Proteomes (120) is fixed for this comparison. Select species or organisms to narrow it.`/*@endcopy*/)));
        appendOrganismPicker(section, options, value, true, true);
        appendScopeSummary();
        return section;
      }
      if (isV4FilterOptions(options)) {
        section.appendChild(element("p", { class: "entry-method-note" },
          "Checked collections and taxonomic groups are included. Refinements narrow that selection. Counts describe library metadata categories and may overlap."));
        appendV4FilterControls(section, options, value, key);
        appendScopeSummary();
        return section;
      }
      var legacyOptions = optionEntries(options, ["legacy_sources", "legacy_source_libraries"]);
      if (legacyOptions.length) {
        if (key === LEGACY_COLLECTION_LIBRARY) {
          appendLegacyCollectionGroup(section, options, value);
        } else {
          appendCheckboxGroup(section, "Source collections", "legacy_sources",
            legacyOptions, value.legacy_sources || []);
        }
      } else {
        appendCheckboxGroup(section, "Source collections", "sublibraries",
          optionEntries(options, "sublibraries"), value.sublibraries || []);
      }
      appendTaxonomyGroup(section, options, value);
      if (!isFixedHumanFacet(options)) {
        appendOrganismPicker(section,options,value,false);
      }
      if (key !== LEGACY_COLLECTION_LIBRARY) {
        appendCheckboxGroup(section, (/*@copy analysis-entry.curated-host-list-label*/`Curated host list`/*@endcopy*/), "human_tropism_statuses",
          optionEntries(options, ["human_tropism_statuses", "human_tropism"]),
          value.human_tropism_statuses || [], 4);
      }
      if (key === "panscan9_variant" &&
          value.sublibraries.length === 1 && value.sublibraries[0] === "humsavar") {
        var clinicalOptions = optionEntries(options, "humsavar_significance");
        if (!value.humsavar_significance || !value.humsavar_significance.length) {
          value.humsavar_significance = clinicalOptions.map(function clinicalValue(item) {
            return item.value;
          });
        }
        var nested = element("div", { class: "entry-filter-nested" });
        nested.appendChild(element("strong", {}, "HumSaVar clinical"));
        var clinicalLabels = { "LB/B": "Benign", "LP/P": "Pathogenic", "US": "Uncertain" };
        clinicalOptions.forEach(function addClinical(item) {
          var label = element("label", {});
          var input = element("input", {
            type: "checkbox", value: item.value, dataset: { field: "humsavar_significance" }
          });
          input.checked = value.humsavar_significance.indexOf(item.value) >= 0;
          label.append(
            input,
            element("span", {}, clinicalLabels[item.value] || item.label),
            element("small", {}, compactCount(item.count))
          );
          nested.appendChild(label);
        });
        section.appendChild(nested);
      }
      if (key === "panscan9_variant" &&
          value.sublibraries.length === 1 && value.sublibraries[0] === "Tumor") {
        var tumorSources = optionEntries(options, "variant_sources").filter(function tumorOnly(item) {
          return item.value !== "humsavar";
        });
        if (!value.variant_sources || value.variant_sources.length === 0) {
          value.variant_sources = tumorSources.map(function sourceValue(item) { return item.value; });
        }
        appendCheckboxGroup(section, "Tumor source", "variant_sources",
          tumorSources, value.variant_sources);
      }
      appendScopeSummary();
      return section;
    }

    function parentScopeNeedsApply() {
      var route = state.waitingSingleRoute || state.pendingRoute || state.activeRoute;
      var selectedSet = currentTargetSet();
      if (!route || !route.plan || route.plan.sourceLibrary !== selectedSet.library) return false;
      var selectedTarget = parseParentSet(byId("entryTargetLibrary").value);
      var routedTarget = parseParentSet(route.targetLibrary);
      if (selectedTarget.value !== routedTarget.value) return true;
      var filters = selectedTarget.kind === "library"
        ? requestFilter("target", selectedTarget.library)
        : null;
      return stableFilterKey(filters) !== stableFilterKey(route.targetFilters);
    }

    function updateApplyScopeControl() {
      refreshWorkspaceLookupOptions();
      var pending = parentScopeNeedsApply();
      applyScope.disabled = false;
      applyScope.classList.toggle("is-pending", pending);
      filterActionNote.textContent = pending
        ? (/*@copy analysis-entry.parent-scope-changed-apply-or.0ce0cd3*/`Parent scope changed; apply or close this menu to update the result.`/*@endcopy*/)
        : (/*@copy analysis-entry.this-parent-scope-is-active.71c1fcd*/`This parent scope is active in the open Player.`/*@endcopy*/);
      updateLiveParentScope();
    }

    function committedScopeFilterLabels(filters) {
      var labels=[];
      Object.keys(filters || {}).forEach(function(field){
        if(field === "record_ids") return;
        if(Array.isArray(filters[field])) filters[field].forEach(function(item){labels.push(filterLabel(field,item,item));});
        else if(field==="exclude_mammals" && filters[field]) labels.push("No mammals");
        else if(field==="min_references") labels.push("IEDB references ≥"+filters[field]);
      });
      return labels;
    }
    // Exports use the completed result's route, independent of either input panel's state.
    window.MimicryOneAnalysisRouting.exportScopeLabel = function(result) {
      var context=result && result.__mimicryoneHistoryContext;
      var route=context && context.route ||
        (result && state.activeRoute && state.activeRoute.resultId===result.result_id ? state.activeRoute : null);
      if(!route) return null;
      var selected=route.historyUiContext && route.historyUiContext.targetFilterState;
      var single=selected && selected.singleMode && selected.singleRecord;
      return [single ? single.label : "", committedScopeFilterLabels(route.targetFilters).join(" · ")].filter(Boolean).join(" · ") || parentSetLabel(route.targetLibrary);
    };

    var scopeCountCache = new Map();
    function updateLiveParentScope() {
      var cancelButton = byId("catalogCancel");
      if (cancelButton && cancelButton.parentNode !== liveTargetHeading) liveTargetHeading.appendChild(cancelButton);
      var route=state.activeRoute, runtime=window.MimicryOne;
      var loaded=runtime && runtime.getState ? runtime.getState() : null;
      if (!route || !loaded || route.resultId!==loaded.result_id) {
        liveTargetScope.hidden = true;
        liveTargetScope.textContent = "";
        liveParentScope.textContent=(/*@copy analysis-entry.choose-an-antigen-to-open.af874ee*/`Choose an antigen to open a comparison.`/*@endcopy*/);
        return;
      }
      var result = runtime.getResult ? runtime.getResult() : null;
      var protein = result && result.protein || {};
      var targetLabel = [protein.gene, protein.display_accession || protein.source_accession || protein.display_id || protein.protein_id]
        .filter(function(value, index, values) { return value && values.indexOf(value) === index; }).join(" · ");
      liveTargetScope.hidden = !targetLabel;
      liveTargetScope.textContent = (/*@copy analysis-entry.live-target-prefix*/`Live · `/*@endcopy*/) + targetLabel;
      var parent=parseParentSet(route.targetLibrary), library=state.libraries.get(parent.library) || {};
      var filters=route.targetFilters || {}, labels=committedScopeFilterLabels(filters);
      liveParentScope.replaceChildren(element("strong",{},"Live · "+parentSetLabel(route.targetLibrary)),
        element("span",{},labels.length?labels.join(" · "):"All available records"));
      var selected=route.historyUiContext && route.historyUiContext.targetFilterState;
      if(filters.record_ids && selected && selected.singleRecord) {
        liveParentScope.children[0].textContent = "Live · " + selected.singleRecord.label;
      }
      // A population the reader supplied has no server-side scope to count. Asking for one
      // would request a library this server does not have, and report the failure as an
      // unavailable count for a set that is in fact fully known here.
      if (parent.library.startsWith('workspace-')) {
        liveParentScope.appendChild(element('span',{},library.records?library.records.toLocaleString()+' FASTA records':'Complete workspace FASTA'));return;
      }
      if (isCustomParentSet(route.targetLibrary)) {
        liveParentScope.appendChild(element("span",{},"Every record you supplied · held in this browser"));
        return;
      }
      var countKey=JSON.stringify([state.releaseFingerprint,state.filterPolicyFingerprint,parent.library,filters]);
      var count=scopeCountCache.get(countKey);
      // Exactly three lines, always. An unapplied scope replaces the count on the third
      // line rather than adding a fourth, and an in-flight request is not repeated here
      // because the status note below the panel already reports it.
      var countLine = typeof count === "number"
        ? count.toLocaleString()+(count === 1 ? " record in the selected scope" : " records in the selected scope")
        : count === "error" ? "Selected record count unavailable" : "Counting selected records…";
      if(!state.pendingRoute && parentScopeNeedsApply()) countLine = "Scope changes not yet applied";
      liveParentScope.appendChild(element("span",{},countLine));
      if(!scopeCountCache.has(countKey)) {
        scopeCountCache.set(countKey,"pending");
        fetchJson("/api/analysis/scope-count?library="+encodeURIComponent(parent.library)+"&filters="+encodeURIComponent(JSON.stringify(filters)))
          .then(function(payload){
            if(!Number.isInteger(payload.records) || payload.records<0) throw new Error((/*@copy analysis-entry.invalid-scope-count.37fbe61*/`Invalid scope count`/*@endcopy*/));
            scopeCountCache.set(countKey,payload.records);
          }).catch(function(){scopeCountCache.set(countKey,"error");})
          .finally(updateLiveParentScope);
      }
    }
    new MutationObserver(updateLiveParentScope).observe(methodNote,{childList:true,subtree:true,characterData:true});

    function updateSourceFilterControl() {
      singlePicker.sync();
      renderCustomScope();
      queryFilterPopover.replaceChildren();
      parentFilterPopover.replaceChildren();
      var selectedSet = currentTargetSet();
      var queryLibrary = selectedSet.library;
      var targetSet = parseParentSet(byId("entryTargetLibrary").value);
      var pinnedRule = pinnedSubsetFor(queryLibrary, targetSet.kind === "library" ? targetSet.library : null);
      var querySection = null;
      if (filterOptions(queryLibrary)) {
        querySection = filterSection("query", queryLibrary, "Antigen Target", pinnedRule);
        if (querySection) queryFilterPopover.appendChild(querySection);
      }
      var targetSection = null;
      if (targetSet.kind === "library") {
        targetSection = filterSection("target", targetSet.library, "Mimicry Parent", pinnedRule);
        if (targetSection) {
          parentFilterPopover.append(targetSection, filterActions);
        }
      }
      queryFilterButton.disabled = !querySection;
      var queryConstrained = !!querySection &&
        filterIsConstrained(querySection.dataset.side, querySection.dataset.library);
      queryFilterButton.textContent = queryConstrained ? (/*@copy analysis-entry.scope-filtered.474bb16*/`Scope · filtered`/*@endcopy*/) : (/*@copy analysis-entry.scope.9d7f150*/`Scope`/*@endcopy*/);
      queryFilterButton.classList.toggle("is-filtered", queryConstrained);
      // Pinned collections expose only their species/organism refinements.
      parentFilterButton.disabled = !targetSection;
      var targetConstrained = !!targetSection &&
        filterIsConstrained(targetSection.dataset.side, targetSection.dataset.library);
      parentFilterButton.textContent = targetConstrained ? (/*@copy analysis-entry.scope-filtered.5bbc69a*/`Scope · filtered`/*@endcopy*/) : (/*@copy analysis-entry.scope.f5622cb*/`Scope`/*@endcopy*/);
      parentFilterButton.classList.toggle("is-filtered", targetConstrained);
      updateApplyScopeControl();
      if (!querySection || queryFilterButton.disabled) {
        queryFilterPopover.hidden = true;
        queryFilterButton.setAttribute("aria-expanded", "false");
      }
      if (!targetSection || parentFilterButton.disabled) {
        parentFilterPopover.hidden = true;
        parentFilterButton.setAttribute("aria-expanded", "false");
      }
    }

    function refreshScopedTargetSearch() {
      window.clearTimeout(state.searchTimer);
      if (!input.value.trim()) {
        clearSuggestions();
        return;
      }
      state.searchTimer = window.setTimeout(runSearch, 0);
    }

    function clearPlayerSelectionNotice() {
      var stage = document.querySelector(".stage");
      if (!stage || stage.dataset.playerState !== "stale") return;
      delete stage.dataset.playerState;
      delete stage.dataset.playerHint;
      stage.removeAttribute("aria-label");
    }

    function requireNewTargetSelection(sourceLibrary) {
      cancelPendingSelection();
      pausePlayerForSelection();
      state.activeRoute = null;
      state.pendingRoute = null;
      state.waitingSingleRoute = null;
      var stage = document.querySelector(".stage");
      var message = "Select an Antigen Target from " + libraryLabel(sourceLibrary) +
        " to replace the previous result.";
      if (stage) {
        stage.dataset.playerState = "stale";
        stage.dataset.playerHint = message;
        stage.setAttribute("aria-label", message);
      }
      setNote(methodNote, message);
      updateApplyScopeControl();
    }

    function activeTargetDescriptor(route, targetLibrary) {
      var context = route && route.queryContext || {};
      var title = document.querySelector("#ftitle .figline-id");
      var visibleLabel = String(title && title.textContent || "")
        .replace(/^Antigen Target\s*·\s*/, "").trim();
      return {
        label: context.primary_gene || context.display_name || context.protein_name ||
          visibleLabel || context.source_accession || "Antigen Target",
        accession: context.source_accession || context.portable_id || "",
        mimicryParentLabel: parentSetLabel(targetLibrary),
        floor: Number(route && route.floor || STATIC_PLAYER_FLOOR)
      };
    }

    async function rerunOpenTargetForParent() {
      if (state.selectionPending && !state.pendingRoute &&
          !/^parent:/.test(state.selectionSession && state.selectionSession.identity || "")) {
        setNote(methodNote, "The pending Antigen Target will use the selected Mimicry Parent library.");
        return false;
      }
      var route = state.waitingSingleRoute || state.pendingRoute || state.activeRoute;
      var selectedSet = currentTargetSet();
      var targetLibrary = byId("entryTargetLibrary").value;
      if (!route || !route.plan) {
        setNote(methodNote, "Select an Antigen Target, then this Mimicry Parent library will run automatically.");
        return false;
      }
      if (route.plan.sourceLibrary !== selectedSet.library) {
        requireNewTargetSelection(selectedSet.library);
        return false;
      }
      if (!parentScopeNeedsApply()) {
        clearPlayerSelectionNotice();
        setNote(methodNote, "The open Antigen Target already uses " +
          parentSetLabel(targetLibrary) + ".");
        return true;
      }
      var floor = Number(route.floor || STATIC_PLAYER_FLOOR);
      if (!targetAvailable(route.plan, targetLibrary, floor)) {
        setNote(methodNote, targetUnavailableReason(route.plan, targetLibrary, floor), true);
        return false;
      }
      var session = beginSelection(
        methodNote,
        "parent:" + String(route.plan.identity || route.proteinId || "target") +
          ":" + targetLibrary,
        activeTargetDescriptor(route, targetLibrary)
      );
      if (!session) return false;
      try {
        await paintPendingSelection(session);
        if (!selectionIsCurrent(session)) return false;
        session.committed = await runPlayerQuery(
          route.plan,
          targetLibrary,
          floor,
          methodNote,
          null,
          route.queryContext
        );
        if (!session.committed && methodNote.dataset.state === "error") {
          session.failureMessage = methodNote.textContent ||
            "The selected Mimicry Parent comparison could not be opened.";
        }
        return session.committed;
      } catch (error) {
        if (state.selectionPending !== session.token) return false;
        setNote(methodNote, error.name === "AbortError"
          ? "Parent-library change canceled safely."
          : "Could not update the Mimicry Parent comparison: " + error.message,
        error.name !== "AbortError");
        session.failureMessage = methodNote.textContent;
        return false;
      } finally {
        if (state.selectionPending === session.token) {
          endSelection(session);
          updateSourceFilterControl();
        }
      }
    }

    function updateExploreComparison() {
      var selectedSet = currentTargetSet();
      var sourceLibrary = selectedSet.library;
      var selectedFloor = STATIC_PLAYER_FLOOR;
      var selectedTarget = rebuildComparisonOptions(byId("entryTargetLibrary"), sourceLibrary, selectedFloor);
      input.disabled = !selectedTarget;
      if (!selectedTarget) {
        updateSourceFilterControl();
        setNote(methodNote, "No manifest-authorized comparison is available for " + libraryLabel(sourceLibrary) + " at " + selectedFloor + "/9.", true);
        return;
      }
      var targetParent = parseParentSet(selectedTarget);
      if (targetParent.kind === "library") {
        applyPinnedScope("target", targetParent.library, sourceLibrary);
        applyPinnedScope("query", sourceLibrary, targetParent.library);
      }
      var targetSetSelect = byId("entryTargetSet");
      var targetSetOption = targetSetSelect && targetSetSelect.selectedOptions[0];
      var queryLabel = selectedSet.kind === "protein"
        ? (targetSetOption ? workspaceOptionLabel(targetSetOption) : "Full proteins")
        : libraryLabel(sourceLibrary);
      setNote(methodNote, "Find Antigen Targets in " + queryLabel + " · Mimicry Parents in " + parentSetLabel(selectedTarget) + " · static ≥" + selectedFloor + "/9.");
      updateSourceFilterControl();
    }

    function configureTargetSet(value) {
      var select = byId("entryTargetSet");
      if (value && Array.from(select.options).some(function matching(option) {
        return option.value === value;
      })) select.value = value;
      var selectedSet = currentTargetSet();
      if (selectedSet.kind === "library") {
        input.placeholder = (/*@copy analysis-entry.gene-accession-protein-name-description.7d012db*/`Gene, accession, description, etc.`/*@endcopy*/);
      } else {
        input.placeholder = (/*@copy analysis-entry.gene-accession-protein-name-description.d19214f*/`Gene, accession, description, etc.`/*@endcopy*/);
      }
      resetExploreSearch();
      updateExploreComparison();
    }

    setExploreTargetSet = configureTargetSet;
    syncExploreHistorySettings = function restoreExploreSettings(context, silent) {
      var desiredSet = context && context.targetSet;
      if (desiredSet) configureTargetSet(desiredSet);
      var parentSelect = byId("entryTargetLibrary");
      var desiredParent = context && context.targetLibrary
        ? parseParentSet(context.targetLibrary).value
        : "";
      var desiredOption = parentSelect && Array.from(parentSelect.options).find(function matching(option) {
        return option.value === desiredParent && !option.disabled;
      });
      if (desiredOption) parentSelect.value = desiredParent;
      updateExploreComparison();
      if (!silent) {
        setNote(methodNote, "History restored · Antigen Target from " +
          (workspaceOptionLabel(byId("entryTargetSet").selectedOptions[0]) || "selected set") +
          " · Mimicry Parents in " + parentSetLabel(parentSelect.value) + " · Scope restored.");
      }
    };

    byId("entryTargetSet").addEventListener("change", function targetSetChanged() {
      pausePlayerForSelection();
      var route = state.waitingSingleRoute || state.pendingRoute || state.activeRoute;
      var wasPending = !!state.selectionPending;
      configureTargetSet();
      if (!route) {
        if (wasPending) requireNewTargetSelection(currentTargetSet().library);
        return;
      }
      if (!route.plan || route.plan.sourceLibrary !== currentTargetSet().library) {
        requireNewTargetSelection(currentTargetSet().library);
      } else if (parentScopeNeedsApply()) {
        rerunOpenTargetForParent();
      }
    });
    byId("entryTargetLibrary").addEventListener("change", function parentLibraryChanged() {
      pausePlayerForSelection();
      singlePicker.clear();
      updateExploreComparison();
      rerunOpenTargetForParent();
    });
    function fitOpenScopes() {
      [queryFilterPopover, parentFilterPopover, byId("entryCustomScopePopover")].forEach(fitScopePanel);
    }
    window.addEventListener("resize", fitOpenScopes);
    window.addEventListener("scroll", fitOpenScopes, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", fitOpenScopes);
      window.visualViewport.addEventListener("scroll", fitOpenScopes);
    }
    document.addEventListener("keydown", function closeScope(event) {
      if (event.key !== "Escape") return;
      var button = !queryFilterPopover.hidden ? queryFilterButton
        : !parentFilterPopover.hidden ? parentFilterButton : null;
      if (!button) return;
      queryFilterPopover.hidden = true;
      closeParentScope();
      queryFilterButton.setAttribute("aria-expanded", "false");
      parentFilterButton.setAttribute("aria-expanded", "false");
      button.focus({ preventScroll: true });
    });
    queryFilterButton.addEventListener("click", function toggleQueryFilters() {
      closeParentScope();
      updateSourceFilterControl();
      queryFilterPopover.hidden = !queryFilterPopover.hidden;
      parentFilterPopover.hidden = true;
      queryFilterButton.setAttribute("aria-expanded", queryFilterPopover.hidden ? "false" : "true");
      parentFilterButton.setAttribute("aria-expanded", "false");
      fitOpenScopes();
    });
    parentFilterButton.addEventListener("click", function toggleParentFilters() {
      if (!parentFilterPopover.hidden) { closeParentScope(); return; }
      updateSourceFilterControl();
      parentFilterPopover.hidden = !parentFilterPopover.hidden;
      queryFilterPopover.hidden = true;
      parentFilterButton.setAttribute("aria-expanded", parentFilterPopover.hidden ? "false" : "true");
      queryFilterButton.setAttribute("aria-expanded", "false");
      fitOpenScopes();
    });
    function changeFilter(popover, event) {
      state.requestRevision++;
      var methodNote = popover.id === "entryCustomScopePopover" ? byId("entryCustomMethod") : byId("loadnote");
      var addSelect = event.target.closest("select[data-filter-add]");
      var scalarSelect = event.target.closest("select[data-filter-scalar]");
      var selectSection = event.target.closest(".entry-filter-section");
      if ((addSelect || scalarSelect) && selectSection) {
        var selectValue = activeFilter(selectSection.dataset.side, selectSection.dataset.library);
        var changedField=addSelect ? addSelect.dataset.filterAdd : scalarSelect.dataset.filterScalar;
        if (addSelect && addSelect.value) {
          var selectedValue=addSelect.value;
          if (changedField==="organism_choice") {
            var selection=JSON.parse(selectedValue);changedField=selection[0];selectedValue=selection[1];
          }
          selectValue[changedField] = Array.from(new Set(
            (selectValue[changedField] || []).concat(selectedValue)
          ));
        } else if (scalarSelect) {
          selectValue[scalarSelect.dataset.filterScalar] = scalarSelect.value
            ? Number(scalarSelect.value) : null;
        }
        reconcileScope(selectSection.dataset.library,selectValue,changedField);
        updateSourceFilterControl();
        if (selectSection.dataset.side === "query") refreshScopedTargetSearch();
        setNote(methodNote, selectSection.dataset.side === "target" && parentScopeNeedsApply()
          ? "Parent scope changed. Apply or close this menu to update the result."
          : "Target search scope updated.");
        return;
      }
      var input = event.target.closest("input[data-field]");
      var section = input && input.closest(".entry-filter-section");
      if (!input || !section) return;
      var scrollTop = popover.scrollTop;
      var scrollLeft = popover.scrollLeft;
      var focusIdentity = {
        side: section.dataset.side,
        library: section.dataset.library,
        field: input.dataset.field,
        value: input.value,
        type: input.type
      };
      var value = activeFilter(section.dataset.side, section.dataset.library);
      var options = dependentScopeOptions(section.dataset.library,value);
      var field = input.dataset.field;
      if (field === "include_vertebrates" || field === "include_mammals") {
        if (input.checked) {
          var includedGroups = new Set((value.domain_groups || []).length ? value.domain_groups : allOptionValues(filterOptions(section.dataset.library), "domain_groups"));
          includedGroups.add("Eukaryota");
          value.domain_groups = Array.from(includedGroups);
          value.exclude_vertebrates = false;
          value.exclude_mammals = false;
        } else if (field === "include_vertebrates") {
          value.exclude_vertebrates = true;
          value.exclude_mammals = false;
        } else {
          value.exclude_mammals = true;
        }
      } else if (field === "include_unclassified") {
        value[field] = input.checked;
      } else if (field === "taxonomy_all" || field === "taxonomy_groups") {
        if (field === "taxonomy_all" && !input.checked) {
          input.checked = true;
          section.querySelector(".scope-selection-note").textContent = (/*@copy analysis-entry.keep-at-least-one-group.1a77a06*/`Keep at least one group selected. Uncheck individual groups to narrow the scope.`/*@endcopy*/);
          setNote(methodNote, "Keep at least one taxonomic group selected. Uncheck individual groups to narrow the scope; Reset scope restores all groups.", true);
          return;
        }
        if (isV4FilterOptions(options)) {
          var allGroups = allOptionValues(options, "domain_groups");
          var groups = new Set((value.domain_groups || []).length ? value.domain_groups : allGroups);
          if (value.include_unclassified) groups.add("Unclassified");
          if (field === "taxonomy_all") {
            groups = new Set(allGroups);
            value.exclude_vertebrates = false;
            value.exclude_mammals = false;
          }
          else if (input.checked) groups.add(input.value);
          else groups.delete(input.value);
          if (!groups.size) {
            input.checked = true;
            section.querySelector(".scope-selection-note").textContent = (/*@copy analysis-entry.keep-at-least-one-taxonomic.3a31b49*/`Keep at least one taxonomic group selected.`/*@endcopy*/);
            setNote(methodNote, "Keep at least one taxonomic group selected.", true);
            return;
          }
          value.domain_groups = Array.from(groups);
          value.include_unclassified = groups.has("Unclassified");
        } else {
          value.domains = availableTaxonomyDomains(options);
          value.include_unclassified = taxonomyUnresolvedCount(options) > 0;
        }
      } else {
        var selected = new Set(field === "source_collections" && !(value[field] || []).length
          ? allOptionValues(options, field) : (value[field] || []));
        if (input.checked) selected.add(input.value);
        else selected.delete(input.value);
        if ((field === "source_collections" || field === "domains" || field === "sublibraries" || field === "legacy_sources" ||
             field === "legacy_collection_modes" ||
             field === "variant_sources" || field === "humsavar_significance") &&
            selected.size === 0) {
          selected.add(input.value);
          input.checked = true;
          section.querySelector(".scope-selection-note").textContent = (/*@copy analysis-entry.keep-at-least-one-option.cc2dca9*/`Keep at least one option selected in this group.`/*@endcopy*/);
          setNote(methodNote, "Keep at least one option selected in this group.", true);
        }
        value[field] = Array.from(selected);
        if (field === "legacy_collection_modes") syncLegacyCollectionFilters(value);
      }
      reconcileScope(section.dataset.library,value,field);
      updateSourceFilterControl();
      if (section.dataset.side === "query") refreshScopedTargetSearch();
      popover.scrollTop = scrollTop;
      popover.scrollLeft = scrollLeft;
      var replacementSection = Array.from(
        popover.querySelectorAll(".entry-filter-section")
      ).find(function sameSection(item) {
        return item.dataset.side === focusIdentity.side &&
          item.dataset.library === focusIdentity.library;
      });
      var replacement = replacementSection && Array.from(
        replacementSection.querySelectorAll("input[data-field]")
      ).find(function sameInput(item) {
        return item.dataset.field === focusIdentity.field &&
          item.value === focusIdentity.value && item.type === focusIdentity.type;
      });
      if (replacement) replacement.focus({ preventScroll: true });
      setNote(methodNote, section.dataset.side === "target" && parentScopeNeedsApply()
        ? "Parent scope changed. Apply or close this menu to update the result."
        : "Target search scope updated.");
    }
    queryFilterPopover.addEventListener("change", function changeQueryFilter(event) {
      changeFilter(queryFilterPopover, event);
    });
    createScopeSection = filterSection;
    changeScopeSelection = changeFilter;
    parentFilterPopover.addEventListener("change", function changeParentFilter(event) {
      changeFilter(parentFilterPopover, event);
    });
    function closeParentScope() {
      if (parentFilterPopover.hidden) return;
      parentFilterPopover.hidden=true;
      parentFilterButton.setAttribute("aria-expanded","false");
      if (parentScopeNeedsApply()) {
        rerunOpenTargetForParent().catch(function(error){
          setNote(methodNote,"Could not apply parent scope: "+error.message,true);
        }).finally(updateApplyScopeControl);
      }
    }
    applyScope.addEventListener("click", function applyParentScope(event) {
      event.stopPropagation();
      closeParentScope();
    });
    input.addEventListener("input", function searchInput() {
      pausePlayerForSelection();
      window.clearTimeout(state.searchTimer);
      // Invalidate immediately, not after debounce: old responses and Enter
      // must not select an antigen from the previous input during this gap.
      if (state.searchAbort) state.searchAbort.abort();
      state.searchAbort = null;
      clearSuggestions();
      state.searchTimer = window.setTimeout(runSearch, 100);
    });
    input.addEventListener("keydown", function keyboard(event) {
      if (event.key === "Escape") {
        window.clearTimeout(state.searchTimer);
        if (state.searchAbort) state.searchAbort.abort();
        state.searchAbort = null;
        clearSuggestions();
      }
      if (event.key === "Enter") {
        var firstResult = results.querySelector("button[data-key]");
        if (firstResult) { event.preventDefault(); firstResult.click(); }
      }
    });
    results.addEventListener("click", function choose(event) {
      var button = event.target.closest("button[data-key]");
      var record = button && state.suggestions.get(button.dataset.key);
      if (record) {
        results.querySelectorAll("button[aria-current]").forEach(function clearCurrent(item) {
          item.removeAttribute("aria-current");
        });
        var selection = beginSelection(byId("loadnote"),
          suggestionIdentity(record),
          selectionDescriptor(record), button);
        if (selection) chooseSuggestion(record, byId("loadnote"), selection).finally(function finish() {
          endSelection(selection);
        });
      }
    });
    document.addEventListener("click", function close(event) {
      if (!event.target.closest(".explore-catalogue")) clearSuggestions();
      if (!event.target.closest("#entryQueryFilterControl")) {
        queryFilterPopover.hidden = true;
        queryFilterButton.setAttribute("aria-expanded", "false");
      }
      if (!event.target.closest("#entryParentFilterControl")) {
        closeParentScope();
      }
    });
    var label = document.querySelector('.explore-catalogue label[for="pexploresearch"]');
    if (label) label.textContent = (/*@copy analysis-entry.find-antigen-target.a79bef7*/`Gene, accession, description, etc.`/*@endcopy*/);
    var scope = document.querySelector(".explore-catalogue .atlas-scope");
    if (scope) scope.remove();
    var cancel = byId("catalogCancel");
    if (cancel) {
      methodNote.after(cancel);
      cancel.addEventListener("click", function cancelExplore(event) {
        var activeAbort = state.scanAbort || state.selectionAbort;
        if (!activeAbort) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelPendingSelection();
        setNote(methodNote, "Request canceled. Previous completed result retained.");
      }, true);
    }
    configureTargetSet(fullProteinValue("human") || targetSetValue("protein", "panscan9_human"));
  }

  async function openKnownTarget(accession, label, activeNode, comparisonContext) {
    var note = byId("loadnote");
    if (comparisonContext && syncExploreHistorySettings) {
      syncExploreHistorySettings(comparisonContext, true);
    } else if (setExploreTargetSet) {
      setExploreTargetSet(fullProteinValue("human") || targetSetValue("protein", "panscan9_human"));
      var requestedParent = comparisonContext && comparisonContext.targetLibrary
        ? parseParentSet(comparisonContext.targetLibrary).value
        : "";
      var parentSelect = byId("entryTargetLibrary");
      var requestedOption = parentSelect && Array.from(parentSelect.options).find(function matching(option) {
        return option.value === requestedParent && !option.disabled;
      });
      if (requestedOption) parentSelect.value = requestedParent;
    }
    var parentLibrary = byId("entryTargetLibrary") && byId("entryTargetLibrary").value;
    // Callers may supply a threshold in comparisonContext. Otherwise use the static
    // player floor, including the default HEPACAM bootstrap; routing is resolved below.
    var requestedFloor = Number(comparisonContext && comparisonContext.floor);
    var exampleFloor = requestedFloor >= 5 && requestedFloor <= 9 ? requestedFloor : STATIC_PLAYER_FLOOR;
    var selection = beginSelection(note, "example:" + accession, {
      label: label || accession,
      accession: accession,
      mimicryParentLabel: parentLibrary ? parentSetLabel(parentLibrary) : "selected library",
      floor: exampleFloor
    }, activeNode || null);
    if (!selection) return false;
    try {
      setNote(note, "Resolving " + accession + " in the full-protein catalog…");
      var records = await searchProteins(accession, selection.controller.signal, "Human");
      if (!selectionIsCurrent(selection)) return false;
      var exact = records.find(function sameAccession(record) {
        return record.source_accession === accession || record.portable_id === accession;
      });
      if (!exact) throw new Error((/*@copy analysis-entry.is-not-available-in-the.6d99ef7*/`${accession} is not available in the current canonical catalog.`/*@endcopy*/));
      await chooseSuggestion(exact, note, selection, exampleFloor);
      return selection.committed === true;
    } catch (error) {
      if (state.selectionPending !== selection.token) return false;
      setNote(note, error.name === "AbortError"
        ? "Selection canceled safely."
        : "Could not open the example through the selected analysis route: " + error.message, error.name !== "AbortError");
      if (error.name !== "AbortError") {
        selection.failureMessage = note && note.textContent || "The selected example could not be opened.";
      }
      return false;
    } finally {
      endSelection(selection);
    }
  }

  function installKnownTargetRouting() {
    var host = byId("knownTargets");
    if (!host || host.dataset.analysisRouting === "true") return;
    host.dataset.analysisRouting = "true";
    host.addEventListener("click", function routeKnownTarget(event) {
      var button = event.target.closest("button[data-acc]");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openKnownTarget(button.getAttribute("data-acc"), button.textContent, button);
    }, true);
  }

  function currentAnalysisMode() {
    var execution = byId("entryCustomExecution");
    return !!execution && state.customExecution === "indexed";
  }

  function updateCustomControls() {
    var target = byId("entryCustomTarget");
    if (!target) return;
    var analysis = currentAnalysisMode();
    var group = byId("mimicmode");
    var execution = byId("entryCustomExecution");
    var floorSelect = byId("customFloor");
    var comparisonSide = document.querySelector(".custom-comparison-side");
    if (comparisonSide) comparisonSide.dataset.sourceMode = analysis ? "indexed" : "custom";
    var comparisonTitle = byId("customComparisonTitle");
    if (comparisonTitle) comparisonTitle.querySelector(".entry-step-label").textContent = (/*@copy analysis-entry.choose-mimicry-parent-library.044f892*/`Choose Mimicry Parent:`/*@endcopy*/);
    // The parent actually selected decides which thresholds are offered. A fixed cap here
    // outlived the reason it was chosen and disabled 8/9 on a route that computes them.
    var plan = customQueryPlan("");
    var selectedParent = analysis ? target.value : CUSTOM_PARENT_SET;
    Array.from(floorSelect.options).forEach(function floorAvailability(option) {
      option.disabled = !targetAvailable(plan, selectedParent, Number(option.value));
    });
    var floor = Number(floorSelect.value);
    byId("entryCustomTargetLabel").hidden = !analysis;
    if (execution) execution.querySelectorAll("button[data-execution]").forEach(function press(item) {
      item.setAttribute("aria-pressed", item.dataset.execution === state.customExecution ? "true" : "false");
    });
    if (group) group.hidden = true;
    if (analysis) {
      if (byId("onewrap")) byId("onewrap").style.display = "none";
      if (byId("customwrap")) byId("customwrap").style.display = "none";
      if (byId("fillrest")) byId("fillrest").style.display = "none";
    } else {
      window.MIMIC_MODE = "custom";
      if (byId("onewrap")) byId("onewrap").style.display = "none";
      if (byId("customwrap")) byId("customwrap").style.display = "flex";
      if (byId("fillrest")) byId("fillrest").style.display = "none";
    }
    var run = byId("runFasta");
    // Preserve explicit parent and threshold choices. Report unsupported routes
    // at Run instead of silently replacing the library or lowering the floor.
    Array.from(target.options).forEach(function selectable(option) { option.disabled = false; });
    if (!state.scanAbort) run.disabled = !targetAvailable(plan, selectedParent, floor);
    run.textContent = (/*@copy analysis-entry.run-analysis.f1464c1*/`Run analysis`/*@endcopy*/);
    var paragraph = byId("customAnalysisGuidance");
    if (paragraph) paragraph.textContent = window.seromapDesktop?.mimicry
      ? 'Compare one antigen target with an installed library or your own parent FASTA, on demand on this computer.'
      : (/*@copy analysis-entry.compare-your-antigen-target-sequences.41da1ec*/`Compare one antigen target with a reference library or your own parent FASTA. The analysis runs in this browser.`/*@endcopy*/);
    var note = byId("entryCustomMethod");
    if (!targetAvailable(plan, selectedParent, floor)) {
      setNote(note, targetUnavailableReason(plan, selectedParent, floor), true);
    } else if (analysis) {
      var selection = activeFilter("custom", parentLibrary(selectedParent));
      if(selection && selection.singleMode && !selection.singleRecord) setNote(note, singleCopy.choose);
      else setNote(note, (/*@copy analysis-entry.custom-selected-parent-note*/`The ${selectedParentLabel(selectedParent, false)} ${selection && selection.singleMode ? "record is" : "records are"} compared in this browser at ${floor}/9. Your sequences stay on this device.`/*@endcopy*/));
    } else {
      setNote(note, "Both FASTA inputs are compared in this browser at " + floor + "/9. Neither is uploaded.");
    }
    renderCustomScope();
  }

  function installCustomControls() {
    var group = byId("mimicmode");
    var helper = document.querySelector(".custom-helper");
    var run = byId("runFasta");
    if (!group || !helper || !run || byId("entryCustomTarget")) return;
    // Always open a session on the stored 7/9 baseline. Every custom threshold computes on
    // this device and the lower ones cost the most, so a broad floor is never inherited from a
    // previous session or restored by the browser; the reader selects it deliberately.
    var initialFloor = byId("customFloor");
    if (initialFloor && Number(initialFloor.value) < STATIC_PLAYER_FLOOR) {
      initialFloor.value = String(STATIC_PLAYER_FLOOR);
      state.customFloors.indexed = STATIC_PLAYER_FLOOR;
      state.customFloors.local = STATIC_PLAYER_FLOOR;
    }
    // One stable action row for the two inputs, independent of parent mode.
    var customGrid = document.querySelector("#customAnalysis .custom-analysis-grid");
    var customFooter = document.querySelector("#customAnalysis .custom-run-footer");
    if (customGrid && customFooter) customGrid.after(customFooter);
    if(window.seromapDesktop?.mimicry){
      // Workspace owns library installation and complete comparisons. Custom
      // remains one target per run, with no installation or input handoff.
      var workspaceNote=element('div',{id:'entryCustomWorkspace',class:'custom-workspace-link'});
      workspaceNote.append(
        element('span',{},'Install reusable FASTA libraries and compare all targets against all parents in Workspace.'),
        element('a',{href:'/?tab=home&workspace=mimicry',target:'_top',class:'btn ghost'},'MimicryMap Libraries →')
      );
      byId('customLocalDownloads')?.remove();
      if(customFooter)customFooter.after(workspaceNote);
      else byId('customAnalysis')?.appendChild(workspaceNote);
    }
    var executionField = element("div", { class: "entry-custom-source" });
    var execution = element("div", {
      class: "entry-compact-switch", id: "entryCustomExecution", role: "group",
      "aria-label": (/*@copy analysis-entry.custom-parent-input-label*/`Mimicry Parent input`/*@endcopy*/)
    });
    execution.append(
      element("button", { type: "button", dataset: { execution: "indexed" }, "aria-pressed": "true", "data-tooltip": "Compare against a library we serve. Its records are downloaded to this browser and compared here; your sequences are not uploaded." }, "Built-in library"),
      element("button", { type: "button", dataset: { execution: "local" }, "aria-pressed": "false", "data-tooltip": "Compare against a second FASTA of your own. Both inputs stay in this browser." }, "Custom FASTA")
    );
    executionField.appendChild(execution);
    group.before(executionField);
    var targetLabel = element("label", { class: "entry-mini-field", id: "entryCustomTargetLabel", hidden: "" });
    targetLabel.append(
      element("span", {class:"entry-visually-hidden"}, "Mimicry Parent Library"),
      element("select", { id: "entryCustomTarget", "aria-label": (/*@copy analysis-entry.custom-parent-library-label*/`Mimicry Parent library`/*@endcopy*/) })
    );
    var comparisonHost = byId("customComparisonControls");
    var customMethod = element("p", { class: "entry-method-note", id: "entryCustomMethod" });
    var scopeControl = element("div", {class:"entry-filter-control",id:"entryCustomScopeControl"});
    var scopeButton = element("button", {type:"button",class:"entry-scope-button",id:"entryCustomScopeButton","aria-expanded":"false","aria-controls":"entryCustomScopePopover"}, "Scope");
    var scopePanel = element("div", {class:"entry-filter-popover",id:"entryCustomScopePopover",hidden:""});
    scopeControl.append(scopeButton,scopePanel);
    var selectRow = element("div", {class:"entry-step-select-row"});
    selectRow.append(targetLabel,scopeControl);
    var summary = element("div", {class:"entry-scope-summary",id:"entryCustomScopeSummary"});
    if (comparisonHost) comparisonHost.append(selectRow,summary);
    else {
      helper.append(targetLabel);
      helper.after(customMethod);
    }
    byId("customExecutionHost").appendChild(customMethod);
    var customSinglePicker = installSingleParentPicker({
      side:"custom", prefix:"entryCustom", select:byId("entryCustomTarget"),
      heading:byId("customComparisonTitle"), host:comparisonHost || helper,
      enabled:currentAnalysisMode, note:function(){return byId("entryCustomMethod");},
      refresh:updateCustomControls, onSelect:updateCustomControls
    });
    function closeCustomScope(){scopePanel.hidden=true;scopeButton.setAttribute("aria-expanded","false");}
    renderCustomScope = function () {
      customSinglePicker.sync();
      var key=parentLibrary(byId("entryCustomTarget").value);
      var section=currentAnalysisMode() && createScopeSection && createScopeSection("custom",key,"Mimicry Parent");
      scopePanel.replaceChildren();
      scopeControl.hidden=!section;
      summary.hidden=!section;
      if(!section){closeCustomScope();return;}
      var done=element("button",{type:"button",class:"entry-scope-button"},"Apply scope");
      done.addEventListener("click",closeCustomScope);
      scopePanel.append(section,done);
      scopeButton.textContent=filterIsConstrained("custom",key)?(/*@copy analysis-entry.scope-filtered.b15bb4b*/`Scope · filtered`/*@endcopy*/):(/*@copy analysis-entry.scope.f3dd6f6*/`Scope`/*@endcopy*/);
      summary.textContent=section.querySelector(".entry-scope-summary")?.textContent || "All available records";
      var selection=activeFilter("custom",key);
      if(selection && selection.singleMode && selection.singleRecord) summary.textContent += " · " + selection.singleRecord.label;
      fitScopePanel(scopePanel);
    };
    scopeButton.addEventListener("click",function(){
      if(!scopePanel.hidden){closeCustomScope();return;}
      renderCustomScope();scopePanel.hidden=false;scopeButton.setAttribute("aria-expanded","true");
    });
    function fitCustomScope() { fitScopePanel(scopePanel); }
    scopeButton.addEventListener("click", fitCustomScope);
    window.addEventListener("resize", fitCustomScope);
    window.addEventListener("scroll", fitCustomScope, {passive:true});
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", fitCustomScope);
      window.visualViewport.addEventListener("scroll", fitCustomScope);
    }
    scopePanel.addEventListener("change",function(event){
      changeScopeSelection(scopePanel,event);
      setNote(customMethod,"Parent scope saved. The scoped records are downloaded to this browser and compared here; your sequences stay on this device.");
    });
    document.addEventListener("click",function(event){if(!scopeControl.contains(event.target))closeCustomScope();});
    document.addEventListener("keydown",function(event){if(event.key==="Escape" && !scopePanel.hidden){closeCustomScope();scopeButton.focus();}});
    addLibraryOptions(byId("entryCustomTarget"), true);
    var defaultParent = fullProteinValue("exposure");
    if (defaultParent) byId("entryCustomTarget").value = defaultParent;
    syncCustomHistorySettings = function restoreCustomSettings(context) {
      // Restore the parent source the entry was actually run with. Forcing "indexed" here
      // reopened a run against the reader's own FASTA as a served-library run.
      var ownParent = isCustomParentSet(context.targetLibrary);
      state.customExecution = ownParent ? "local" : "indexed";
      var floorSelect = byId("customFloor");
      var targetSelect = byId("entryCustomTarget");
      if (!ownParent && targetSelect && Array.from(targetSelect.options).some(function matching(option) {
        return option.value === context.targetLibrary;
      })) targetSelect.value = context.targetLibrary;
      if (floorSelect && Number(context.floor) >= 5 && Number(context.floor) <= 9) {
        floorSelect.value = String(Number(context.floor));
      }
      var routePlan = context.route && context.route.plan;
      var fasta = routePlan && routePlan.liveQuery && routePlan.liveQuery.fasta;
      if (typeof fasta === "string") byId("fasta").value = fasta;
      // Put the parents back in the page too, so what the reader sees is what the restored
      // entry ran against rather than whatever happened to be left in the textarea.
      if (ownParent && routePlan && typeof routePlan.parentFasta === "string") {
        byId("mimicfa").value = routePlan.parentFasta;
      }
      updateCustomControls();
      setNote(byId("entryCustomMethod"), "History restored · Antigen Target · Mimicry Parents in " +
        parentSetLabel(ownParent ? CUSTOM_PARENT_SET : targetSelect.value) + " · " + Number(floorSelect.value) + "/9.");
    };

    execution.addEventListener("click", function executionChanged(event) {
      var button = event.target.closest("button[data-execution]");
      if (!button) return;
      if (button.dataset.execution === state.customExecution) return;
      state.customFloors[state.customExecution] = Number(byId("customFloor").value);
      state.customExecution = button.dataset.execution === "indexed" ? "indexed" : "local";
      byId("customFloor").value = String(state.customFloors[state.customExecution]);
      if (state.customExecution === "local") window.MIMIC_MODE = "custom";
      updateCustomControls();
    });
    group.addEventListener("click", function localScopeChanged(event) {
      if (event.target.closest("button[data-m]")) updateCustomControls();
    });
    byId("entryCustomTarget").addEventListener("change", function(){customSinglePicker.clear();updateCustomControls();});
    byId("customFloor").addEventListener("change", updateCustomControls);
    run.addEventListener("click", async function route(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var fasta = byId("fasta").value;
      if (!String(fasta || "").trim()) { setNote(byId("mimicnote"), "Supply an Antigen Target FASTA first.", true); return; }
      // Both parent sources take this one route. A served library and the reader's own FASTA
      // differ only in where the parent records come from; everything downstream - the
      // scanner, the player, the figures, the history entry and the exports - is the same.
      var ownParent = !currentAnalysisMode();
      var parent = ownParent ? CUSTOM_PARENT_SET : byId("entryCustomTarget").value;
      var floor = Number(byId("customFloor").value);
      var note = byId("mimicnote");
      var session = beginSelection(note, "custom", {
        label: (/*@copy analysis-entry.custom-antigen-target.43a43c6*/`Custom Antigen Target`/*@endcopy*/), mimicryParentLabel: parentSetLabel(parent), floor: floor
      });
      try {
        var validator = window.MimicryOneFastaValidation;
        if (validator) {
          var checked = await validator.validateRequired("indexed");
          if (!selectionIsCurrent(session)) return;
          if (!checked.ok) { setNote(note, checked.error, true); return; }
          if (ownParent) {
            var parentChecked = await validator.validate("mimic");
            if (!selectionIsCurrent(session)) return;
            if (!parentChecked.ok) { setNote(note, "Mimicry Parent FASTA: " + (parentChecked.error || "FASTA validation failed."), true); return; }
          }
        }
        if (!selectionIsCurrent(session)) return;
        // Freeze only the first target into the request, History, and exports.
        // Parent records are retained in full in either comparison mode.
        fasta = window.MimicryFastaInput.firstTarget(fasta).fasta;
        session.committed = await runPlayerQuery(
          customQueryPlan(fasta, ownParent ? byId("mimicfa").value : null),
          parent, floor, note, run, null,
          ownParent ? null : requestFilter("custom", parentLibrary(parent)));
      } catch (error) {
        if (selectionIsCurrent(session)) setNote(note, "Custom request stopped: " + error.message, true);
      } finally {
        if (state.selectionPending === session.token) {
          if (!session.committed && note.dataset.state === "error") session.failureMessage = note.textContent;
          endSelection(session);
        }
      }
    }, true);
    var cancel = byId("cancelFasta");
    if (cancel) cancel.addEventListener("click", function cancelScan(event) {
      var activeAbort = state.scanAbort || state.selectionAbort;
      if (!activeAbort) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelPendingSelection();
      setNote(byId("mimicnote"), "Request canceled. Previous completed result retained.");
    }, true);
    updateCustomControls();
    refreshCustomNavigationSettings = updateCustomControls;
  }

  function explorerCount(meta) {
    var counts = meta && meta.counts || {};
    var count = Number(counts.proteins || counts.full_proteins || 0);
    if (count) return count;
    return Object.keys(meta && meta.class_counts || {}).reduce(function sum(total, key) { return total + Number(meta.class_counts[key] || 0); }, 0);
  }

  async function initialize() {
    try {
      var bootstrap = await Promise.all([
        fetchBootstrapJson("/api/analysis/meta"),
        fetchBootstrapJson("/api/explorer/meta").catch(function unavailable() { return null; }),
        fetchBootstrapJson("/scope-dependencies.json").catch(function unavailable() { return null; }),
        fetchBootstrapJson("/public-library-policy.json")
      ]);
      var publicPolicy = bootstrap[3];
      if (!publicPolicy || publicPolicy.schema !== "mimicryone/public-library-policy/1" ||
          !Array.isArray(publicPolicy.internal_only_libraries)) {
        throw new Error((/*@copy analysis-entry.public-library-policy-unavailable*/`Library availability settings could not be loaded.`/*@endcopy*/));
      }
      state.internalOnlyLibraries = new Set(publicPolicy.internal_only_libraries);
      normalizeAnalysisMeta(bootstrap[0]);
      if(window.seromapDesktop?.mimicry){
        workspaceLookups=await import('./workspace-lookups.mjs');
        workspaceSnapshot=await window.seromapDesktop.mimicry('snapshot');addWorkspaceLibraries();
        var workspaceRefreshTimer;
        window.seromapDesktop.onMimicryChanged?.(function(){
          clearTimeout(workspaceRefreshTimer);
          workspaceRefreshTimer=setTimeout(async function(){
            try{
              var next=await window.seromapDesktop.mimicry('snapshot');
              var changed=workspaceMenuSignature(next)!==workspaceMenuSignature(workspaceSnapshot);
              workspaceSnapshot=next;
              if(changed)refreshWorkspaceMenus();else refreshWorkspaceLookupOptions();
            }catch(error){console.warn('Could not refresh workspace libraries',error);}
          },750);
        });
      }
      if (bootstrap[2] && window.MimicryScopeDependencies) window.MimicryScopeDependencies.install(bootstrap[2]);
      state.explorerMeta = bootstrap[1];
    } catch (error) {
      setNote(byId("loadnote"), "Analysis libraries unavailable; legacy presentation remains active (" + error.message + ").", true);
      finishBootstrap(false);
      return;
    }
    installPlayerFloorBridge();
    try { await waitFor(function ready() { return byId("catalogCancel") && byId("customFloor") && byId("mimicmode"); }, 15000); } catch (_error) {}
    if (state.explorerMeta) {
      installExploreControls();
      installKnownTargetRouting();
    }
    installCustomControls();
    if(workspaceSnapshot&&workspaceSnapshot.defaultParent!=='builtin-viral120'){
      var workspaceChoice=workspaceDefaultParentValue();
      if(['builtin-exposure','builtin-nonvertebrate'].includes(workspaceSnapshot.defaultParent)){
        for(var side of ['target','custom'])state.filterState[side].canonical_exposure=normalizeV4FilterState(filterOptions('canonical_exposure'),{source_collections:[],exclude_vertebrates:workspaceSnapshot.defaultParent==='builtin-nonvertebrate'},'canonical_exposure');
      }
      for(var selectId of ['entryTargetLibrary','entryCustomTarget']){var workspaceSelect=byId(selectId);if(workspaceSelect&&[...workspaceSelect.options].some(o=>o.value===workspaceChoice)){workspaceSelect.value=workspaceChoice;workspaceSelect.dispatchEvent(new Event('change'));}}
    }
    var count = explorerCount(state.explorerMeta);
    setNote(byId("loadnote"), count
      ? count.toLocaleString() + " read-only Human + Exposure parent proteins are search-ready; no catalog is loaded until you type."
      : "Full-protein portability API unavailable; baked catalog search and authored examples remain active.", !state.explorerMeta);
    finishBootstrap(!!state.explorerMeta);
    // Desktop Workspace owns the input files and saved positions; use the
    // existing player and export contracts without starting a second scan.
    var workspaceArrival=new URLSearchParams(location.search);
    if(window.seromapDesktop?.mimicry&&workspaceArrival.has('workspace_comparison')){
      var saved=await window.seromapDesktop.mimicry('result',{comparison:workspaceArrival.get('workspace_comparison'),targetId:Number(workspaceArrival.get('workspace_target')),floor:Number(workspaceArrival.get('workspace_floor'))||undefined});
      await waitFor(function(){return window.MimicryOne?.openResult},15000);
      window.MimicryOne.openResult(saved,saved.source_catalog,'explorer');
      setNote(byId('loadnote'),'Complete saved comparison · '+saved.inputs.input_source);
      return;
    }
    // A standalone hosted player needs the same reference-resolution route as
    // a History click. An assay handoff or saved comparison owns its own arrival.
    var standaloneDefault = window.MimicryMapViewer?.options.standalone &&
      !window.AtlasMimicryHandoff && !window.AtlasMimicryRestore;
    if ((!window.MimicryMapViewer?.options.embedded || standaloneDefault) && state.explorerMeta && !state.selectionPending && !state.activeRoute) {
      await openKnownTarget(standaloneDefault ? "P22301" : "Q14CZ8", standaloneDefault ? "IL10" : "HEPACAM", null, {
        targetSet: fullProteinValue("human"),
        targetLibrary: workspaceSnapshot?workspaceDefaultParentValue():fullProteinValue("exposure"),
        floor: STATIC_PLAYER_FLOOR
      });
    }
  }

  function start() {
    var releaseStartup = window.MimicryStartup ? window.MimicryStartup.hold("analysis") : function() {};
    initialize().catch(function failed(error) {
      finishBootstrap(false);
      setNote(byId("loadnote"), "Explorer initialization stopped: " + error.message, true);
    }).finally(releaseStartup);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
