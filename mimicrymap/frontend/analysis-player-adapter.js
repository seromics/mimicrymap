/* Bridge from a complete positional analysis response to the native player; supports the execution modes checked in adapt(). */
(function analysisPlayerAdapter() {
  "use strict";

  var SCAN_SCHEMA = "mimicryone/analysis-scan/1";
  var RESULT_SCHEMA = "mimicryone/result/1";

  function fail(message) { throw new Error(message); }

  function number(value, label) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) fail("Analysis player adapter: missing " + label + ".");
    return parsed;
  }

  function text(value, fallback) {
    var normalized = String(value == null ? "" : value);
    return normalized || String(fallback == null ? "" : fallback);
  }

  function compactToken(value, fallback) {
    var token = text(value, fallback).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
    return (token || text(fallback, "record")).slice(0, 64);
  }

  function compactProteinId(record, role, fallback, displayHint) {
    var display = compactToken(displayHint || record.short_id || record.portable_id, role);
    var disambiguator = record.antigen_id != null ? record.antigen_id
      : (record.protein_idx != null ? record.protein_idx : fallback);
    return display + "#" + compactToken(disambiguator, role);
  }

  function sharedIdentity(record, seqid, options) {
    var resolver = window.MimicryOneIdentity;
    if (!resolver || typeof resolver.resolve !== "function") {
      fail("Analysis player adapter: shared identity resolver is unavailable.");
    }
    var identityRecord = Object.assign({}, record || {});
    if (!identityRecord.raw_header && !identityRecord.header && seqid) identityRecord.raw_header = seqid;
    return resolver.resolve(identityRecord, options || {});
  }

  function sourceDisplayIdentity(record, seqid) {
    var identity = sharedIdentity(record, seqid);
    return {
      display_id: identity.accession || identity.assayId || identity.primaryLine,
      gene: identity.gene || identity.primaryLine,
      organism: identity.organism,
      source_accession: identity.accession,
      identity: identity
    };
  }

  function queryDisplayIdentity(record, seqid) {
    return sourceDisplayIdentity(record, seqid);
  }

  function normalizeSource(record, sourceScopeLabel) {
    if (!record || typeof record !== "object") fail("Analysis player adapter: invalid source catalog record.");
    var proteinIndex = number(record.protein_idx != null ? record.protein_idx : record.antigen_id, "source protein_idx");
    var sequence = text(record.sequence).toUpperCase();
    var seqid = text(record.seqid, record.raw_header);
    var rawHeader = text(record.raw_header, seqid);
    var declaredLength = number(record.length != null ? record.length : sequence.length, "source length");
    if (!seqid || !sequence) fail("Analysis player adapter: source_catalog must retain full SeqID and sequence.");
    if (sequence.length !== declaredLength) fail("Analysis player adapter: source sequence length does not match its catalog length.");
    var displayIdentity = sourceDisplayIdentity(record, seqid);
    var identity = displayIdentity.identity;
    var normalized = {
      protein_idx: proteinIndex,
      protein_id: compactProteinId(record, "source", proteinIndex, displayIdentity.display_id),
      display_id: displayIdentity.display_id,
      gene: displayIdentity.gene,
      name: text(identity.proteinName, text(record.display_name, rawHeader)),
      protein_name: identity.proteinName,
      header: rawHeader,
      seqid: seqid,
      raw_header: rawHeader,
      source_fasta_header: window.MimicryOneIdentity.fastaHeader(record),
      library_id: text(record.library_id, text(record.library, record.library_key || "analysis")),
      organism: displayIdentity.organism,
      assay_id: identity.assayId,
      coordinates: identity.coordinates,
      variant_hgvs: identity.variant,
      variant_significance: identity.significance,
      collection: identity.collection,
      identity_provenance: identity.provenance,
      identity: identity,
      length: declaredLength,
      sequence: sequence,
      antigen_id: record.antigen_id == null ? null : Number(record.antigen_id)
    };
    if (record.portable_id) normalized.portable_id = text(record.portable_id);
    if (record.record_identity) normalized.record_identity = Object.assign({}, record.record_identity);
    if (record.parent_key) {
      var parentKey = text(record.parent_key);
      var parentMatch = parentKey.match(/^(P9P|M1E)([0-9]{9})$/);
      if (!parentMatch) fail("Analysis player adapter: invalid canonical source parent_key.");
      if (record.portable_id && text(record.portable_id) !== parentKey) {
        fail("Analysis player adapter: canonical source parent_key differs from portable_id.");
      }
      var expectedProteinIndex = (parentMatch[1] === "P9P" ? 10000000000 : 20000000000) + Number(parentMatch[2]);
      if (proteinIndex !== expectedProteinIndex) {
        fail("Analysis player adapter: canonical source protein_idx differs from its immutable namespace.");
      }
      normalized.parent_key = parentKey;
      normalized.portable_id = parentKey;
      normalized.id_namespace = text(record.id_namespace);
      if (normalized.id_namespace !== parentMatch[1]) {
        fail("Analysis player adapter: canonical source id_namespace differs from parent_key.");
      }
      normalized.parent_class = text(record.parent_class);
      ["include_default", "optional_receptor_germline", "assay_interference_prone"].forEach(function retainBoolean(name) {
        if (record[name] !== 0 && record[name] !== 1) {
          fail("Analysis player adapter: canonical source " + name + " is not a frozen 0/1 value.");
        }
        normalized[name] = record[name];
      });
      var mappedTileCount = number(record.mapped_tile_count, "canonical source mapped_tile_count");
      if (!Number.isInteger(mappedTileCount) || mappedTileCount < 0) {
        fail("Analysis player adapter: canonical source mapped_tile_count is invalid.");
      }
      normalized.mapped_tile_count = mappedTileCount;
      normalized.interference_flag = text(record.interference_flag);
      normalized.interference_note = text(record.interference_note);
      normalized.original_header = text(record.original_header, rawHeader);
      normalized.canonical_header = text(record.canonical_header, record.companion_header);
      normalized.source_header = text(record.source_header, rawHeader);
      normalized.companion_header = text(record.companion_header, record.canonical_header);
    }
    if (displayIdentity.source_accession) normalized.source_accession = displayIdentity.source_accession;
    if (Array.isArray(record.child_antigen_ids)) normalized.child_antigen_ids = record.child_antigen_ids.slice();
    if (Array.isArray(record.child_seqids)) normalized.child_seqids = record.child_seqids.slice();
    if (record.projection_provenance && typeof record.projection_provenance === "object") normalized.projection_provenance = record.projection_provenance;
    return normalized;
  }

  function positionsForSchema(row, compact) {
    var schema = Array.isArray(row.hits_schema) ? row.hits_schema : [];
    var positions = {};
    schema.forEach(function index(name, position) { positions[name] = position; });
    (compact ? ["query_start", "source_start", "identity"]
      : ["query_start", "source_start", "identity", "query_9mer", "source_9mer"]).forEach(function required(name) {
      if (positions[name] == null) fail("Analysis player adapter: hits_schema lacks " + name + ".");
    });
    return positions;
  }

  var CORE_HIT_FIELDS = ["query_start", "source_start", "identity", "query_9mer", "source_9mer"];

  function nativeHits(row, query, source, floor, compact) {
    if (row.positions !== "included" || !Array.isArray(row.hits)) {
      fail("Analysis player requires complete positional hits; rerun with include_hits=true.");
    }
    var positions = positionsForSchema(row, compact);
    var extraFields = Object.keys(positions).filter(function extra(name) { return CORE_HIT_FIELDS.indexOf(name) < 0; });
    var provenance = [];
    var hits = row.hits.map(function normalizeHit(hit, hitIndex) {
      var queryStart = number(hit[positions.query_start], "query_start");
      var sourceStart = number(hit[positions.source_start], "source_start");
      var identity = number(hit[positions.identity], "identity");
      var query9mer = compact ? query.sequence.slice(queryStart - 1, queryStart + 8) : text(hit[positions.query_9mer]).toUpperCase();
      var source9mer = compact ? source.sequence.slice(sourceStart - 1, sourceStart + 8) : text(hit[positions.source_9mer]).toUpperCase();
      if (!Number.isInteger(queryStart) || queryStart < 1 || queryStart > query.length - 8) fail("Analysis player adapter: query coordinate is outside the sequence.");
      if (!Number.isInteger(sourceStart) || sourceStart < 1 || sourceStart > source.length - 8) fail("Analysis player adapter: source coordinate is outside the sequence.");
      if (!Number.isInteger(identity) || identity < floor || identity > 9) fail("Analysis player adapter: identity is outside the requested 5..9 range.");
      if (query9mer.length !== 9 || query.sequence.slice(queryStart - 1, queryStart + 8) !== query9mer) fail("Analysis player adapter: query 9-mer does not match its coordinate.");
      if (source9mer.length !== 9 || source.sequence.slice(sourceStart - 1, sourceStart + 8) !== source9mer) fail("Analysis player adapter: source 9-mer does not match its coordinate.");
      var extra = {};
      extraFields.forEach(function retain(name) { extra[name] = hit[positions[name]]; });
      if (Array.isArray(row.hit_provenance) && row.hit_provenance[hitIndex] != null) extra.projection = row.hit_provenance[hitIndex];
      provenance.push(extra);
      return [queryStart, sourceStart, identity, source9mer];
    });
    return { hits: hits, provenance: provenance, hasProvenance: provenance.some(function present(item) { return Object.keys(item).length > 0; }) };
  }

  function nativeFloors(floors, floor) {
    var output = {};
    for (var candidate = floor; candidate <= 9; candidate += 1) {
      var key = "m" + candidate;
      var stats = floors && floors[key];
      if (!stats) fail("Analysis player adapter: result lacks " + key + " aggregate statistics.");
      output[key] = {
        target_windows: number(stats.query_windows, key + " query_windows"),
        source_windows: number(stats.source_windows, key + " source_windows"),
        pairs: number(stats.pairs, key + " pairs"),
        target_loci: number(stats.query_loci, key + " query_loci"),
        source_loci: number(stats.source_loci, key + " source_loci")
      };
    }
    return output;
  }

  function validateAssetAliases(context, portableId) {
    var track = text(context.native_track_accession);
    var structure = text(context.structure_accession);
    if (!track && !structure) return;
    var crosswalk = context.native_asset_crosswalk;
    var exact = crosswalk && typeof crosswalk === "object" &&
      text(crosswalk.portable_id) === portableId &&
      crosswalk.mapping_basis === "exact_unique_source_accession_and_full_sequence" &&
      crosswalk.sequence_identity_status === "full_sequence_exact" &&
      crosswalk.coordinate_status === "coordinate_identity_exact" &&
      crosswalk.conflict_status === "consistent";
    if (!exact) fail("Analysis player adapter: portable native assets lack an exact coordinate-safe crosswalk.");
    if (track && (
      text(crosswalk.native_track_accession) !== track ||
      text(crosswalk.legacy_protein_id) !== track ||
      Number(crosswalk.annotation_asset_available) !== 1
    )) {
      fail("Analysis player adapter: native track alias does not match its exact crosswalk.");
    }
    if (structure && (
      text(crosswalk.structure_accession) !== structure ||
      text(crosswalk.legacy_protein_id) !== structure ||
      (Number(crosswalk.monomer_structure_available) !== 1 && Number(crosswalk.dimer_structure_available) !== 1)
    )) {
      fail("Analysis player adapter: structure alias does not match its exact crosswalk.");
    }
  }

  function adapt(payload, options) {
    options = options || {};
    if (!payload || payload.schema !== SCAN_SCHEMA) fail("Analysis player requires a " + SCAN_SCHEMA + " response.");
    var viewerTransport = payload.viewer_transport || null;
    var compact = !!viewerTransport;
    if (compact && (viewerTransport.schema !== "mimicryone/player-view/1" ||
        viewerTransport.coordinates_complete !== true || viewerTransport.export_details_deferred !== true ||
        !viewerTransport.download_request || !payload.release_fingerprint || !payload.component_key)) {
      fail("Analysis player adapter: invalid viewer transport contract.");
    }
    var executionMode = text(payload.execution && payload.execution.mode);
    var localMapped = executionMode === "browser_local_mapped";
    var canonicalLive7 = executionMode === "canonical_parent_live7";
    var canonicalProteomeIndex = executionMode === "canonical_proteome_index";
    if (["live", "precomputed_player", "canonical_parent_live7", "canonical_proteome_index", "browser_local_mapped"].indexOf(executionMode) < 0 || payload.execution.complete !== true || payload.execution.positional_hits_included !== true) {
      fail("Analysis player requires one complete positional player response.");
    }
    var floor = number(payload.request && payload.request.floor, "request floor");
    if (!Number.isInteger(floor) || floor < 5 || floor > 9) fail("Analysis player adapter: player floor must be between 5 and 9.");
    if (executionMode === "live" && [5, 6].indexOf(floor) < 0) fail("Analysis player adapter: live player responses must start at 5/9 or 6/9.");
    if (canonicalLive7 && floor !== 7) fail("Analysis player adapter: canonical-parent indexed fallback must be exactly 7/9.");
    if (canonicalProteomeIndex && [5, 6, 7].indexOf(floor) < 0) fail("Analysis player adapter: canonical-proteome index responses must start at 5/9, 6/9, or 7/9.");
    if (executionMode === "precomputed_player" && floor < 7) fail("Analysis player adapter: precomputed player responses must start between 7/9 and 9/9.");
    if ((executionMode === "precomputed_player" || localMapped) && payload.execution.aggregate_counts_exact !== true) {
      fail("Analysis player adapter: precomputed player aggregates must be exact.");
    }
    if ((executionMode === "precomputed_player" || localMapped) && (!payload.target || !text(payload.target.entity_level) || !text(payload.target.entity_label))) {
      fail("Analysis player adapter: precomputed player target entity semantics are required.");
    }
    var targetKind = text(payload.target && payload.target.kind, "library");
    var canonicalTarget = targetKind === "canonical_proteome";
    if (["library", "canonical_proteome"].indexOf(targetKind) < 0) {
      fail("Analysis player adapter: unsupported target kind.");
    }
    if (canonicalProteomeIndex && !canonicalTarget) {
      fail("Analysis player adapter: canonical-proteome index execution requires a canonical-proteome target.");
    }
    var canonicalDefaultCount = null;
    if (canonicalTarget) {
      canonicalDefaultCount = number(
        payload.target && payload.target.canonical_default_count,
        "canonical_default_count"
      );
      if (!Number.isInteger(canonicalDefaultCount) || canonicalDefaultCount < 1) {
        fail("Analysis player adapter: canonical_default_count must be a positive integer.");
      }
      if (payload.target.canonical_complete !== true) {
        fail("Analysis player adapter: a canonical-proteome target must be explicitly complete.");
      }
    }
    var queries = Array.isArray(payload.query_records) ? payload.query_records : [];
    if (queries.length !== 1) fail("Open one query at a time in the MimicryMap player.");
    var queryRecord = queries[0];
    var querySequence = text(queryRecord.sequence).toUpperCase();
    var querySeqid = text(queryRecord.seqid, queryRecord.raw_header);
    var queryRawHeader = text(queryRecord.raw_header, querySeqid);
    var queryLength = number(queryRecord.length != null ? queryRecord.length : querySequence.length, "query length");
    if (!querySeqid || !querySequence) fail("Analysis player adapter: the query must retain full SeqID and sequence.");
    if (querySequence.length !== queryLength) fail("Analysis player adapter: query sequence length does not match its record length.");
    var queryDisplay = queryDisplayIdentity(queryRecord, querySeqid);
    var query = {
      protein_id: compactProteinId(queryRecord, "query", text(payload.job_id, "job").slice(0, 12), queryDisplay.display_id),
      display_id: queryDisplay.display_id,
      display_accession: queryDisplay.display_id,
      gene: queryDisplay.gene,
      name: queryDisplay.identity.proteinName || queryRawHeader,
      protein_name: queryDisplay.identity.proteinName,
      header: queryRawHeader,
      seqid: querySeqid,
      raw_header: queryRawHeader,
      source_fasta_header: window.MimicryOneIdentity.fastaHeader(queryRecord),
      library_id: text(queryRecord.library, "__custom_query__"),
      organism: queryDisplay.organism,
      assay_id: queryDisplay.identity.assayId,
      coordinates: queryDisplay.identity.coordinates,
      variant_hgvs: queryDisplay.identity.variant,
      variant_significance: queryDisplay.identity.significance,
      collection: queryDisplay.identity.collection,
      identity_provenance: queryDisplay.identity.provenance,
      identity: queryDisplay.identity,
      length: queryLength,
      sequence: querySequence,
      antigen_id: queryRecord.antigen_id == null ? null : Number(queryRecord.antigen_id)
    };
    if (queryDisplay.source_accession) query.source_accession = queryDisplay.source_accession;
    if (queryRecord.record_identity) query.record_identity = Object.assign({}, queryRecord.record_identity);
    var queryContext = options.queryContext;
    if (queryContext) {
      var portableId = text(queryContext.parent_key, queryContext.portable_id);
      if (!/^(?:P9P|M1E)[0-9]{9}$/.test(portableId)) fail("Analysis player adapter: invalid trusted canonical query identity.");
      if (text(queryContext.sequence).toUpperCase() !== querySequence) fail("Analysis player adapter: trusted portable query sequence differs from the scan query.");
      validateAssetAliases(queryContext, portableId);
      query.protein_id = portableId;
      query.portable_id = portableId;
      query.parent_key = portableId;
      if (/^(?:P9P|M1E)[0-9]{9}$/.test(portableId)) query.annotation_portable_id = portableId;
      query.display_accession = text(queryContext.source_accession, portableId);
      query.source_accession = text(queryContext.source_accession);
      query.gene = text(queryContext.primary_gene, query.display_accession);
      query.name = text(queryContext.display_name, queryContext.source_description || queryRawHeader);
      query.protein_name = text(queryContext.protein_name, queryContext.display_name);
      query.source_description = text(queryContext.source_description);
      query.organism = text(queryContext.organism);
      query.parent_class = text(queryContext.parent_class, queryContext.class);
      query.sequence_sha256 = text(queryContext.sequence_sha256);
      query.source_header = text(queryContext.source_header, queryRawHeader);
      query.source_fasta_header = window.MimicryOneIdentity.fastaHeader(Object.assign({}, queryContext, {
        library_id: queryContext.projection_library || query.library_id,
      })) || query.source_fasta_header;
      query.companion_header = text(queryContext.companion_header);
      if (queryContext.projection_library) query.projection_library = text(queryContext.projection_library);
      if (queryContext.native_track_accession) {
        query.native_track_accession = text(queryContext.native_track_accession);
      }
      if (queryContext.structure_accession) {
        query.structure_accession = text(queryContext.structure_accession);
      }
      if (queryContext.native_asset_crosswalk && typeof queryContext.native_asset_crosswalk === "object") {
        query.native_asset_crosswalk = queryContext.native_asset_crosswalk;
      }
      var contextualIdentity = sharedIdentity(query, queryRawHeader, {
        activeLibrary: query.library_id,
        activeContext: options.queryLibraryLabel
      });
      query.identity = contextualIdentity;
      query.display_accession = contextualIdentity.accession || query.display_accession;
      query.gene = contextualIdentity.gene || contextualIdentity.primaryLine;
      query.protein_name = contextualIdentity.proteinName;
      query.organism = contextualIdentity.organism;
      query.assay_id = contextualIdentity.assayId;
      query.coordinates = contextualIdentity.coordinates;
      query.variant_hgvs = contextualIdentity.variant;
      query.variant_significance = contextualIdentity.significance;
      query.collection = contextualIdentity.collection;
      query.identity_provenance = contextualIdentity.provenance;
    }
    if (canonicalLive7) {
      var requestQuery = payload.request && payload.request.query || {};
      var responseParentKey = text(queryRecord.parent_key, queryRecord.portable_id);
      var contextParentKey = text(queryContext && queryContext.parent_key, queryContext && queryContext.portable_id);
      if (requestQuery.kind !== "canonical_parent" ||
          text(requestQuery.parent_key) !== responseParentKey ||
          responseParentKey !== contextParentKey ||
          queryRecord.record_space !== "canonical_parent") {
        fail("Analysis player adapter: canonical-parent live7 identity is not authoritative end to end.");
      }
      var recordDefault = queryRecord.include_default === 1;
      var contextDefault = queryContext.include_default === 1;
      if (!recordDefault ||
          queryRecord.mapped_tile_count !== 0 ||
          !contextDefault ||
          queryContext.mapped_tile_count !== 0) {
        fail("Analysis player adapter: canonical-parent live7 eligibility markers are missing or inconsistent.");
      }
    }

    var sourceCatalog = (payload.source_catalog || []).map(function normalize(record) {
      return normalizeSource(record, options.sourceScopeLabel);
    });
    var sourceByIndex = new Map(sourceCatalog.map(function indexSource(source) { return [source.protein_idx, source]; }));
    if (sourceByIndex.size !== sourceCatalog.length) fail("Analysis player adapter: source_catalog protein_idx values are not unique.");
    var referenced = new Set();
    var positional = [];
    var ranked = [];
    var rows = Array.isArray(payload.results) ? payload.results : [];
    if (payload.result_count != null && Number(payload.result_count) !== rows.length) fail("Analysis player adapter: result_count does not match results.");
    rows.forEach(function normalizeResult(row) {
      var sourceRecord = row.source || {};
      var proteinIndex = number(sourceRecord.protein_idx != null ? sourceRecord.protein_idx : sourceRecord.antigen_id, "result source protein_idx");
      var source = sourceByIndex.get(proteinIndex);
      if (!source) fail("Analysis player adapter: result source is absent from source_catalog.");
      referenced.add(proteinIndex);
      if (row.query && queryRecord.antigen_id != null && Number(row.query.antigen_id) !== Number(queryRecord.antigen_id)) {
        fail("Analysis player adapter: response contains a different query antigen.");
      }
      if (canonicalLive7 && text(row.query && row.query.parent_key) !== text(queryRecord.parent_key)) {
        fail("Analysis player adapter: response contains a different canonical parent query.");
      }
      var bestIdentity = number(row.best_identity, "best_identity");
      if (!Number.isInteger(bestIdentity) || bestIdentity < floor || bestIdentity > 9) fail("Analysis player adapter: best_identity is outside the requested range.");
      var normalizedHits = nativeHits(row, query, source, floor, compact);
      var positionalRow = {
        protein_idx: proteinIndex,
        protein_id: source.protein_id,
        best_identity: bestIdentity,
        hits_columns: ["target_start", "source_start", "identity", "source_9mer"],
        hits: normalizedHits.hits
      };
      if (normalizedHits.hasProvenance) positionalRow.hit_provenance = normalizedHits.provenance;
      if (row.projection_provenance && typeof row.projection_provenance === "object") positionalRow.projection_provenance = row.projection_provenance;
      positional.push(positionalRow);
      var rankedRow = {
        protein_index: proteinIndex,
        protein_id: source.protein_id,
        display_id: source.display_id,
        gene: source.gene,
        name: source.name,
        protein_name: source.protein_name,
        source_accession: source.source_accession,
        assay_id: source.assay_id,
        coordinates: source.coordinates,
        variant_hgvs: source.variant_hgvs,
        variant_significance: source.variant_significance,
        collection: source.collection,
        identity_provenance: source.identity_provenance,
        identity: source.identity,
        header: source.header,
        seqid: source.seqid,
        raw_header: source.raw_header,
        antigen_id: source.antigen_id,
        library_id: source.library_id,
        organism: source.organism,
        length: source.length,
        best_identity: bestIdentity,
        floors: nativeFloors(row.floors, floor)
      };
      if (row.projection_provenance && typeof row.projection_provenance === "object") rankedRow.projection_provenance = row.projection_provenance;
      ranked.push(rankedRow);
    });
    if (referenced.size !== sourceCatalog.length || sourceCatalog.some(function unreferenced(source) { return !referenced.has(source.protein_idx); })) {
      fail("Analysis player adapter: source_catalog must contain exactly the referenced result sources.");
    }

    var availableFloors = [];
    for (var candidate = floor; candidate <= 9; candidate += 1) availableFloors.push(candidate);
    var sourceLibraryRecords = Number(options.sourceLibraryRecords);
    if (!Number.isFinite(sourceLibraryRecords) || sourceLibraryRecords < 0) sourceLibraryRecords = 0;
    if (canonicalTarget) sourceLibraryRecords = canonicalDefaultCount;
    return {
      schema: RESULT_SCHEMA,
      origin: localMapped ? "local_mapped_library" : executionMode === "precomputed_player"
        ? "analysis_precomputed_player"
        : (canonicalLive7
          ? "analysis_canonical_parent_live7"
          : canonicalProteomeIndex
            ? "analysis_canonical_proteome_index"
            : "analysis_indexed_live"),
      complete_in_memory: true,
      export_details_deferred: compact,
      result_id: "analysis:" + text(payload.job_id, Date.now()) + ":" + text(queryRecord.antigen_id, queryRecord.short_id),
      protein: query,
      parameters: {
        floor: floor,
        source_kind: targetKind,
        source_scope: text(payload.target && payload.target.library, options.sourceScope),
        source_scope_label: text(options.sourceScopeLabel, payload.target && payload.target.library),
        source_entity_label: text(payload.target && payload.target.record_representation && payload.target.record_representation.label,
          text(options.sourceEntityLabel, text(payload.target && payload.target.entity_label, "assay antigens"))),
        source_entity_level: text(payload.target && payload.target.entity_level, "assay_antigen"),
        source_record_representation: payload.target && payload.target.record_representation || null,
        source_library_records: sourceLibraryRecords,
        canonical_default_count: canonicalDefaultCount,
        canonical_complete: canonicalTarget ? true : null,
        source_library_entry_level: text(options.sourceLibraryEntityLevel, payload.target && payload.target.entity_level),
        source_library_class: text(options.sourceLibraryClass),
        window: 9,
        coordinates: "1-based window starts, inclusive interval ends"
      },
      available_floors: availableFloors,
      source_catalog: sourceCatalog,
      ranked_matches: ranked,
      positional_matches: positional,
      inputs: {
        original_query_fasta: payload.reproduction_inputs && payload.reproduction_inputs.original_query_fasta || null,
        analysis_scan: {
          completeness_contract: payload.contract || null,
          execution_counts: payload.execution || null,
          schema: payload.schema,
          release_fingerprint: payload.release_fingerprint || null,
          job_id: payload.job_id,
          request: payload.request,
          execution_mode: executionMode,
          component_key: payload.component_key || null,
          viewer_transport: compact ? JSON.parse(JSON.stringify(viewerTransport)) : null,
          viewer_options: compact ? JSON.parse(JSON.stringify(options)) : null,
          target: payload.target,
          projection: payload.projection || payload.projection_provenance || null,
          query_window_coverage: payload.projection_audit?.query ? {coverage_complete:payload.projection_audit.query.coverage_complete===true,searchable_windows:payload.projection_audit.query.searchable_windows,covered_windows:payload.projection_audit.query.covered_windows} : null,
          query_identity: {
            record_space: queryRecord.record_space,
            antigen_id: queryRecord.antigen_id,
            library: queryRecord.library,
            seqid: queryRecord.seqid,
            raw_header: queryRecord.raw_header
          }
        }
      },
      provenance: {
        adapter: "mimicryone/analysis-player-adapter/1",
        execution: localMapped ? "complete browser-local comparison with retained record mappings" : executionMode === "precomputed_player"
          ? (canonicalTarget
            ? "precomputed " + floor + "/9 positional player lookup plus exact no-projection canonical-parent overlay"
            : "precomputed " + floor + "/9 positional player lookup")
          : (canonicalLive7
            ? "bounded exact 7/9 scan of one release-authorized no-projection canonical parent"
            : canonicalProteomeIndex
              ? "bounded exact scan of the complete canonical Human/Exposure parent index"
              : "bounded positional scan of the prebuilt MimicryMap index"),
        generated_utc: new Date().toISOString(),
        analysis_job_id: payload.job_id,
        aggregate_counts_exact: payload.execution.aggregate_counts_exact === true,
        positional_hits_complete: true
      },
      statistics_status: {
        state: "descriptive_only",
        p_values: false,
        q_values: false,
        reason: "No inferential null model is applied to this exact sequence lookup."
      }
    };
  }

  function open(payload, options) {
    if (!window.MimicryOne || typeof window.MimicryOne.openResult !== "function") fail("The native MimicryMap player bridge is unavailable.");
    var result = adapt(payload, options);
    var preferredView = options && options.preferredView === "player" ? "player" : "explorer";
    return window.MimicryOne.openResult(result, result.source_catalog, preferredView);
  }

  // Hydration belongs to the captured result, never to the current selector state.
  // Cache only successful completions; canceled/failed exports can be retried.
  var completeExports = new WeakMap();
  async function complete(result, options) {
    if (!result || !result.export_details_deferred) return result;
    var signal = options && options.signal;
    if (signal && signal.aborted) throw new DOMException("Canceled", "AbortError");
    if (completeExports.has(result)) return completeExports.get(result);
    var scan = result.inputs && result.inputs.analysis_scan;
    var transport = scan && scan.viewer_transport;
    if (!transport || transport.schema !== "mimicryone/player-view/1") fail("Export details are unavailable for this result.");
    var response = await fetch("/api/analysis/player?component=" + encodeURIComponent(scan.component_key), {
      method: "POST", signal: signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(transport.download_request)
    });
    if (!response.ok) fail("Complete export data could not be loaded (HTTP " + response.status + ").");
    var payload = await response.json();
    if (signal && signal.aborted) throw new DOMException("Canceled", "AbortError");
    if (payload.viewer_transport || payload.release_fingerprint !== scan.release_fingerprint ||
        payload.component_key !== scan.component_key) fail("Export data no longer match the displayed release. Reload the comparison before exporting.");
    var full = adapt(payload, scan.viewer_options);
    if (JSON.stringify(full.source_catalog) !== JSON.stringify(result.source_catalog) ||
        JSON.stringify(full.protein) !== JSON.stringify(result.protein) ||
        JSON.stringify(full.ranked_matches) !== JSON.stringify(result.ranked_matches) ||
        JSON.stringify(payload.request) !== JSON.stringify(scan.request) ||
        full.positional_matches.length !== result.positional_matches.length) {
      fail("Complete export data differ from the displayed comparison.");
    }
    full.positional_matches.forEach(function verify(row, index) {
      var visible = result.positional_matches[index];
      if (row.protein_idx !== visible.protein_idx || row.hits.length !== visible.hits.length ||
          row.hits.some(function differs(hit, hitIndex) {
            return hit.some(function field(value, column) { return value !== visible.hits[hitIndex][column]; });
          })) fail("Complete export positions differ from the displayed comparison.");
    });
    var completedScan = Object.assign({}, scan, { viewer_transport: null, viewer_options: null });
    var completed = Object.assign({}, result, {
      export_details_deferred: false, positional_matches: full.positional_matches,
      inputs: Object.assign({}, result.inputs, { analysis_scan: completedScan })
    });
    completeExports.set(result, completed);
    return completed;
  }

  window.MimicryOneAnalysisPlayer = { schema: RESULT_SCHEMA, adapt: adapt, open: open, complete: complete };
})();
