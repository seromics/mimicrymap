/* Shared, lossless protein identity resolver for every MimicryMap presentation surface. */
(function installMimicryOneIdentity(root) {
  "use strict";

  var LIBRARY_LABELS = {
    human_current: "HuScan",
    huscan: "HuScan",
    huprot4: "HuProt",
    huprot: "HuProt",
    panscan9_human: "Human assay records",
    canonical_human: "Canonical Human",
    panscan9_variant: "Variant assay records",
    panscan9_dark: "Additional assay records",
    panscan9_exposure: "Exposure assay records",
    canonical_exposure: "Canonical Exposure",
    virscan_exposome_current: "VirScan Exposome",
    virscan_exposome: "VirScan Exposome",
    human_swissprot: "Canonical Human",
    human_hormone: "Canonical Human"
  };

  function exact(value) {
    return value == null ? "" : String(value);
  }

  // Remove generated storage identities only at presentation boundaries.
  // Native accessions, assay IDs and original records remain intact.
  function publicText(value) {
    var original=exact(value),cleaned=original.replace(/\b(?:HUM|EXP)(?:_[a-f0-9_]{16,}|\d{6,9})\b|\b(?:M1E|P9P)\d{9}\b/gi, '');
    return cleaned===original?original:cleaned.replace(/^\s*[>|;,]+\s*|\s*[|;,]+\s*$/g, '').trim();
  }

  function clean(value) {
    var text = exact(value).trim();
    if (!text || /^(?:\?|n\/?a|na|none|null|undefined|unknown)$/i.test(text)) return "";
    return text;
  }

  function humanize(value) {
    return clean(value).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  }

  function key(value) {
    return humanize(value).toLocaleLowerCase().replace(/[\s·|:;,/\\()[\]{}_-]+/g, " ").trim();
  }

  function first(record, names) {
    for (var index = 0; index < names.length; index += 1) {
      var value = clean(record && record[names[index]]);
      if (value) return value;
    }
    return "";
  }

  function headerValue(record) {
    return first(record || {}, ["raw_header", "header", "seqid", "source_header", "short_id"]);
  }

  // Keep storage keys for joins. Public FASTAs use the retained source header;
  // canonical catalogue records use the same accession/gene/description label
  // as the reference FASTA downloads, without display-name shortening.
  function fastaHeader(record) {
    record = record || {};
    var internal = /\b(?:HUM|EXP)(?:_[a-f0-9_]{16,}|\d{6,9})\b|\b(?:M1E|P9P)\d{9}\b/i;
    var native = record.native || record;
    for (var candidate of [record.source_fasta_header, native.source_fasta_header,
      record.raw_header, record.header, native.raw_header, native.full_source_header,
      record.full_source_header, record.original_header, record.source_header,
      record.companion_header, record.identity && record.identity.fullHeader]) {
      var header = exact(candidate).replace(/^>+/, '').replace(/[\r\n]+/g, ' ').trim();
      if (header && !internal.test(header)) return header;
    }
    var library = record.library_id || record.library || native.library || native.library_key || '';
    if (!/^(?:canonical_human|canonical_exposure|human_swissprot|atlas_120_viruses|builtin-human|builtin-viral120|builtin-exposure)$/.test(library)) return '';
    var accession = first(native, ['source_accession','accession','display_accession']) || first(record, ['source_accession','accession','display_accession']);
    var gene = first(native, ['primary_gene','gene_symbol','gene']);
    if (!record.native && record.identity && !record.identity.gene && gene === record.identity.primaryLine) gene = '';
    // Human input packages retain the full source name in description; their
    // protein_name is normalized for compact labels. Exposure descriptions may
    // instead hold taxonomy, so retain the source protein_name on that route.
    var human = /^(?:canonical_human|human_swissprot|builtin-human)$/.test(library);
    var description = first(native, ['protein_name','source_description','description']) || first(record, ['protein_name','source_description']);
    var detail = first(native, ['source_description','description']);
    if (human && detail && (!description || detail.startsWith(description))) description = detail;
    if (!accession || internal.test(accession)) return '';
    return [...new Set([accession,gene,description].filter(Boolean))].join(' | ');
  }

  function parseHeader(record) {
    record = record || {};
    var fullHeader = headerValue(record);
    var header = fullHeader.replace(/^>+/, "");
    var token = clean(record.short_id) || header.split(/\s+/, 1)[0] || "";
    var fields = (/^(?:JHU|CDI)[A-Za-z0-9._-]+(?:\||$)/i.test(header) ? header : token).split("|");
    var assayId = clean(fields[0]);
    var nativeHeader = /^(?:JHU|CDI)[A-Za-z0-9._-]+$/i.test(assayId);
    var uniprot = "";
    var refseq = "";
    fields.some(function findUniProt(field) {
      var match = exact(field).match(/^UniProt=(.+)$/i);
      if (!match) return false;
      uniprot = clean(match[1]);
      return true;
    });
    fields.some(function findRefSeq(field) {
      var match = exact(field).match(/^RefSeq=(.+)$/i);
      if (!match) return false;
      refseq = clean(match[1]);
      return true;
    });
    var fasta = token.match(/^(?:sp|tr)\|([^|]+)\|([^|\s]+)/i);
    // Standard UniProt fields and the same named fields in our readable exports.
    var description = header.slice(header.indexOf(" ") + 1);
    if (header.indexOf(" ") < 0 || nativeHeader) description = "";
    var tagged = /(?:^|\s)(?:OS|OX|GN|PE|SV)=/.test(description);
    function tag(name) {
      var match = description.match(new RegExp("(?:^|\\s)" + name + "=(.*?)(?=\\s(?:OS|OX|GN|PE|SV)=|$)"));
      return match ? humanize(match[1]) : "";
    }
    var customInput = /^__custom_(?:query|target)__$/.test(rawLibrary(record));
    // The readable starter format is explicit: gene, recognized accession,
    // description, organism. Arbitrary labels are never gene/accession claims.
    var readable = customInput ? header.match(/^(\S+)\s+(\S+)\s+\|\s+(.+?)\s+\|\s+(.+)$/) : null;
    if (readable && !/^(?:(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?|[A-Z]{2,4}_[0-9]+(?:\.[0-9]+)?)$/.test(readable[2])) readable = null;
    var accessionToken = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/.test(token);
    var refseqToken = /^(?:[A-Z]{2,4}_)[0-9]+(?:\.[0-9]+)?$/.test(token);
    // Round-trip the accession-first headers written by fastaHeader(), while
    // preserving the original header verbatim and leaving taxonomy unknown.
    var publicFields = customInput && accessionToken ? header.split(/\s+\|\s+/) : [];
    var publicGene = publicFields.length === 3 && /^[A-Za-z0-9_.\/-]+$/.test(publicFields[1]) ? publicFields[1] : '';
    var publicDescription = publicFields.length === 2 ? publicFields[1] : publicGene ? publicFields[2] : '';
    return {
      description: publicDescription || (readable ? clean(readable[3]) : fasta || tagged || customInput ? humanize(description.split(/\s(?:OS|OX|GN|PE|SV)=/)[0]) : ""),
      organism: readable ? clean(readable[4]) : tag("OS"),
      taxid: tag("OX"),
      gene: publicGene || (readable ? clean(readable[1]) : tag("GN")),
      fullHeader: fullHeader,
      header: header,
      token: token,
      fields: fields,
      assayId: nativeHeader ? assayId : "",
      nativeHeader: nativeHeader,
      uniprot: uniprot || (readable && !/^[A-Z]{2,4}_/.test(readable[2]) ? readable[2] : fasta ? clean(fasta[1]) : accessionToken ? token : ""),
      fastaGene: fasta ? humanize(fasta[2]) : "",
      refseq: refseq || (readable && /^[A-Z]{2,4}_/.test(readable[2]) ? readable[2] : refseqToken ? token : "")
    };
  }

  function rawLibrary(record) {
    return first(record || {}, ["library_id", "library", "library_key", "source_library", "projection_library", "lib"]);
  }

  function normalizedLibrary(value) {
    return clean(value).toLocaleLowerCase().replace(/[\s-]+/g, "_");
  }

  function familyFor(record, parsed) {
    var library = normalizedLibrary(rawLibrary(record));
    var assay = parsed.assayId.toLocaleUpperCase();
    var parentClass = key(first(record || {}, ["parent_class", "class"]));
    if (library === "human_current" || library === "huscan" || /^CDIH/.test(assay)) return "huscan";
    if (library === "huprot4" || library === "huprot" || /^JHU/.test(assay)) return "huprot";
    if (library === "panscan9_variant" || /^CDI9V/.test(assay)) return "variant";
    if (library === "panscan9_dark" || /^CDI9D/.test(assay)) return "dark";
    if (library === "virscan_exposome_current" || library === "virscan_exposome" || /^CDIV/.test(assay)) return "virscan";
    if (library === "panscan9_exposure" || library === "canonical_exposure" || /^CDI9E/.test(assay) || parentClass.indexOf("exposure") >= 0) return "exposure";
    if (library === "panscan9_human" || library === "canonical_human" || library === "human_swissprot" || library === "human_hormone" || /^CDI9H/.test(assay) || parentClass.indexOf("human") >= 0) return "human";
    return "generic";
  }

  function usefulName(value, parsed) {
    var name = humanize(value);
    if (!name) return "";
    if (key(name) === key(parsed.fullHeader) || key(name) === key(parsed.header)) return "";
    if (/^(?:JHU|CDI)[A-Za-z0-9._-]+(?:\||$)/i.test(name)) return "";
    return name;
  }

  function visibleAssayFallback(record) {
    var antigen = first(record || {}, ["antigen_id", "platform_id"]);
    return antigen ? "antigen #" + antigen : "protein";
  }

  function joinUnique(parts, suppressed, separator) {
    var seen = Object.create(null);
    (suppressed || []).forEach(function remember(value) {
      var normalized = key(value);
      if (normalized) seen[normalized] = true;
    });
    var kept = [];
    parts.forEach(function retain(value) {
      var text = clean(value).replace(/\s+/g, " ").trim();
      var normalized = key(text);
      if (!text || !normalized || seen[normalized]) return;
      seen[normalized] = true;
      kept.push(text);
    });
    return kept.join(separator || " | ");
  }

  function tooltipLines(identity) {
    var lines = [];
    var visible = " " + key(identity.primaryLine + " " + identity.secondary) + " ";
    function add(label, value) {
      var text = clean(value);
      if (!text) return;
      lines.push(label ? label + ": " + text : text);
    }
    function addSemantic(label, value) {
      var normalized = key(value);
      if (!normalized || visible.indexOf(" " + normalized + " ") >= 0) return;
      add(label, value);
    }
    add("", identity.primaryLine);
    if (identity.secondary) add("", identity.secondary);
    addSemantic("Gene", identity.gene);
    addSemantic("Protein", identity.proteinName);
    addSemantic("Accession", identity.accession);
    addSemantic("Organism/strain", identity.organism);
    addSemantic("Variant", identity.variant);
    addSemantic("Significance", identity.significance);
    addSemantic("Collection", identity.collection);
    add("Assay/platform ID", identity.assayId);
    add("Library", identity.libraryLabel || identity.libraryId);
    add("Coordinates", identity.coordinates);
    add("Provenance", identity.provenance);
    add("Full FASTA header", identity.fullHeader);
    var unique = [];
    var seen = Object.create(null);
    lines.forEach(function deduplicate(line) {
      var normalized = key(line);
      if (normalized && !seen[normalized]) {
        seen[normalized] = true;
        unique.push(line);
      }
    });
    return unique.join("\n");
  }

  function recordedSource(record) {
    record = record || {};
    var fields = headerValue(record).replace(/^>/, '').split('|');
    if (fields.length !== 5 || !/^CDI[HVE]\w+$/i.test(fields[0]) || !/^Seq[_ -]?\d+$/i.test(fields[4])) return record;
    var id = first(record, ['assay_id', 'source_id']);
    if (id && /^CDI/i.test(id) && id !== fields[0]) return record;
    var human = /^CDIH/i.test(fields[0]);
    var organism = humanize(fields[human ? 3 : 1]);
    var previous = humanize(first(record, ['organism', 'species']));
    var agrees = !previous || previous === organism;
    var tax = human ? '9606' : agrees ? first(record, ['taxid', 'organism_taxid', 'taxonomy_id']) : '';
    var taxonomy = human ? '' : fields[3], split = taxonomy.indexOf('_');
    return Object.assign({}, record, {
      accession:fields[2], source_accession:fields[2], organism:organism, species:organism,
      taxid:tax, organism_taxid:tax, taxonomy_id:tax,
      family_genus:taxonomy, family:split < 0 ? taxonomy : taxonomy.slice(0, split), genus:split < 0 ? '' : taxonomy.slice(split + 1),
      organism_taxon_label:organism+' [TaxID: '+(tax || 'not supplied')+']',
      reference_set:organism+' [TaxID: '+(tax || 'not supplied')+']'
    });
  }

  function validateRecord(record, options) {
    options = options || {};
    var header = String(record.raw_header || record.header || record.seqid || record.source_header || record.short_id || '').replace(/^>+/, '').trim();
    var id = options.source || record.assay_id || record.protein_id || '';
    function fail(field) { throw Error('Sequence record identity conflict ('+field+'): '+id); }
    if (options.header !== undefined && header !== String(options.header).replace(/^>+/, '').trim()) fail('FASTA header');
    var aliases = {'builtin-human':'human_swissprot',canonical_human:'human_swissprot','builtin-viral120':'atlas_120_viruses','builtin-virscan':'virscan_exposome_current','builtin-huscan':'human_current','builtin-huprot':'huprot4','builtin-exposure':'canonical_exposure','builtin-nonvertebrate':'canonical_exposure_no_vertebrates'};
    var library = record.library_id || record.library_key;
    if (options.library && library && (aliases[library] || library) !== (aliases[options.library] || options.library)) fail('library');
    var fields = header.split('|');
    var accessionPattern = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/;
    var statedAccession = header.match(/^(?:sp|tr)\|([^|]+)\|/)?.[1] || header.match(/(?:^|\|)UniProt=([^|]+)/)?.[1] || '';
    if (!statedAccession && accessionPattern.test(fields[0].trim().split(/\s/)[0])) statedAccession = fields[0].trim().split(/\s/)[0];
    if (/^JHU[A-Za-z0-9._-]+$/.test(fields[0])) {
      for (var source of [options.source, record.assay_id, record.source_id].filter(Boolean)) if (String(source).split('|')[0] !== fields[0]) fail('source ID');
      if (!statedAccession && accessionPattern.test(fields[2] || '')) statedAccession = fields[2];
    }
    if (accessionPattern.test(statedAccession)) for (var field of ['source_accession','accession']) if (record[field] && record[field] !== statedAccession) fail(field);
    if (fields.length !== 5 || !/^CDI[HVE]\w+$/i.test(fields[0]) || !/^Seq[_ -]?\d+$/i.test(fields[4])) return record;
    for (var source of [options.source, record.assay_id, record.source_id].filter(Boolean)) {
      if (String(source).split('|')[0] !== fields[0]) fail('source ID');
    }
    var human = /^CDIH/i.test(fields[0]), organism = humanize(fields[human ? 3 : 1]);
    for (var field of ['source_accession','accession']) if (record[field] && record[field] !== fields[2]) fail(field);
    for (var field of ['organism','species']) if (record[field] && humanize(record[field]) !== organism) fail(field);
    return record;
  }

  function resolve(record, options) {
    record = recordedSource(record);
    options = options || {};
    var parsed = parseHeader(record);
    var fields = parsed.fields;
    var family = familyFor(record, parsed);
    var libraryId = rawLibrary(record);
    var libraryLabel = LIBRARY_LABELS[normalizedLibrary(libraryId)] || humanize(libraryId);
    var explicitGene = humanize(first(record, ["primary_gene", "gene_symbol", "gene"]));
    var explicitProtein = usefulName(first(record, ["protein_name", "display_name", "source_description", "antigen_description", "description", "name"]), parsed);
    var explicitAccession = clean(first(record, ["source_accession", "accession", "uniprot_accession", "refseq_accession", "display_accession", "acc"]));
    var explicitOrganism = humanize(first(record, ["species", "organism", "org", "strain", "organism_strain", "taxonomy_label"]));
    var gene = explicitGene;
    var proteinName = explicitProtein;
    var accession = explicitAccession || parsed.uniprot || parsed.refseq;
    var organism = explicitOrganism;
    var variant = humanize(first(record, ["variant_hgvs", "hgvs", "variant"]));
    var significance = clean(first(record, ["variant_significance", "humsavar_significance", "clinical_significance", "significance"]));
    var collection = clean(first(record, ["collection", "transcript", "orf_transcript", "source_collection"]));
    var provenance = humanize(first(record, ["provenance", "source_detail", "variant_source", "taxonomy_provenance", "tropism_provenance"]));
    var coordinates = clean(first(record, ["coordinates", "tile_coordinates", "tile_kind", "source_coordinates"]));
    // Storage keys identify records, not assay platforms. Keep them as the last
    // display fallback for sparse/custom records without inventing assay metadata.
    var recordId = clean(first(record, ["portable_id", "parent_key", "protein_id"]));
    var assayId = parsed.assayId || clean(first(record, ["assay_id", "cdi_id", "jhu_id", "platform_id"]));
    var fieldOne = humanize(fields[1]);
    var fieldTwo = clean(fields[2]);
    var fieldThree = humanize(fields[3]);
    var fieldFour = humanize(fields[4]);

    if (parsed.nativeHeader) {
      if (family === "huprot") {
        gene = gene || fieldOne;
        accession = accession || parsed.uniprot;
      } else if (family === "huscan" || family === "human") {
        gene = gene || fieldOne;
        accession = accession || fieldTwo;
        organism = organism || fieldThree;
        coordinates = coordinates || clean(fields[4]);
      } else if (family === "variant") {
        var variantMatch = fieldOne.match(/^(.+?)[ _]+((?:p|c)\..+)$/i);
        if (variantMatch) {
          gene = gene || humanize(variantMatch[1]);
          variant = variant || humanize(variantMatch[2]);
        } else {
          variant = variant || fieldOne;
        }
        accession = accession || fieldTwo;
        provenance = provenance || fieldThree;
        coordinates = coordinates || clean(fields[4]);
      } else if (family === "dark") {
        proteinName = proteinName || fieldOne;
        accession = accession || fieldTwo;
        collection = collection || clean(fields[3]);
        coordinates = coordinates || clean(fields[4]);
      } else if (family === "exposure" || family === "virscan") {
        /* Sparse exposure headers contain an organism/antigen description in field 1,
           not a gene. It is the honest temporary primary until richer names hydrate. */
        proteinName = proteinName || fieldOne;
        accession = accession || fieldTwo;
        if (!organism || /^(?:human|exposure|homo sapiens)$/i.test(organism)) organism = fieldThree || fieldOne;
        coordinates = coordinates || clean(fields[4]);
      }
    } else {
      gene = gene || parsed.gene || (/^__custom_(?:query|target)__$/.test(libraryId) ? "" : parsed.fastaGene);
      proteinName = proteinName || parsed.description;
      organism = organism || parsed.organism;
      accession = accession || parsed.uniprot || parsed.refseq;
    }

    var primary = "";
    var primaryLine = "";
    var topParts = [];
    var secondaryParts = [];
    if (family === "variant") {
      primary = gene || variant || accession || assayId || recordId || visibleAssayFallback(record);
      topParts = [gene || variant, accession, gene ? variant : ""];
      secondaryParts = [significance, provenance];
    } else if (family === "dark") {
      primary = proteinName || gene || accession || assayId || recordId || visibleAssayFallback(record);
      topParts = [primary, accession];
      secondaryParts = [collection];
    } else if (family === "exposure" || family === "virscan") {
      primary = proteinName || gene || organism || accession || assayId || recordId || visibleAssayFallback(record);
      topParts = [primary, accession];
      secondaryParts = [organism, humanize(record.family_genus), first(record, ["strain", "source_strain"])];
    } else if (family === "human" || family === "huscan" || family === "huprot") {
      primary = gene || proteinName || accession || organism || assayId || recordId || visibleAssayFallback(record);
      topParts = [gene || proteinName, accession];
      secondaryParts = gene ? [proteinName] : [];
    } else {
      primary = gene || proteinName || accession || organism || assayId || recordId || visibleAssayFallback(record);
      topParts = [primary, accession];
      secondaryParts = [gene ? proteinName : "", organism, first(record, ["strain", "source_strain"])];
    }

    primaryLine = joinUnique(topParts, [], " | ") || primary;
    var contexts = [primaryLine, primary, options.activeLibrary, options.activeContext, options.parentContext];
    if (options.suppressLibraryContext !== false) contexts.push(libraryId, libraryLabel);
    var secondary = joinUnique(secondaryParts, contexts, " | ");
    primaryLine=publicText(primaryLine)||publicText(proteinName)||publicText(gene)||publicText(accession)||visibleAssayFallback(record);
    primary=publicText(primary)||primaryLine;
    secondary=publicText(secondary);
    var identity = {
      family: family,
      primary: primary,
      primaryLine: primaryLine,
      secondary: secondary,
      gene: gene,
      proteinName: proteinName,
      accession: accession,
      organism: organism,
      taxid: first(record, ["taxid", "organism_taxid", "taxonomy_id"]) || parsed.taxid,
      strain: humanize(first(record, ["strain", "source_strain"])),
      assayId: assayId,
      libraryId: libraryId,
      libraryLabel: libraryLabel,
      fullHeader: fastaHeader(record) || parsed.fullHeader,
      coordinates: coordinates,
      variant: variant,
      significance: significance,
      collection: collection,
      provenance: provenance,
      badge: ""
    };
    const publicIdentity=Object.fromEntries(Object.entries(identity).map(([k,v])=>[k,typeof v==='string'?publicText(v):v]));
    identity.tooltip = tooltipLines(publicIdentity);
    identity.ariaLabel = [identity.primaryLine, identity.secondary].filter(Boolean).join("; ");
    identity.export = {
      identity_primary: identity.primaryLine,
      identity_secondary: identity.secondary,
      gene: identity.gene,
      protein_name: identity.proteinName,
      accession: identity.accession,
      organism: identity.organism,
      strain: identity.strain,
      assay_platform_id: identity.assayId,
      library: identity.libraryId,
      full_fasta_header: fastaHeader(record),
      coordinates: identity.coordinates,
      variant_hgvs: identity.variant,
      variant_significance: identity.significance,
      collection: identity.collection,
      provenance: identity.provenance
    };
    Object.keys(identity.export).forEach(k=>{identity.export[k]=publicText(identity.export[k]);});
    // Workspace preferences affect visible labels only. Full identity, tooltip,
    // scientific exports and record matching keep the original parsed fields.
    var display = root.MimicryWorkspaceDisplayPreferences?.[record.workspace_library_id || libraryId] ||
      root.MimicryWorkspaceDisplayPreferences?.[options.activeLibrary] || record.workspace_display;
    var line = ({accession: identity.accession || identity.assayId, gene: identity.gene,
      description: identity.proteinName, header: identity.fullHeader})[display?.primary] || identity.primaryLine;
    identity.displayLine = display?.limit && line.length > display.limit ? line.slice(0,display.limit-1).trimEnd() + '…' : line;
    return identity;
  }

  function mixedLibraries(records) {
    var seen = Object.create(null);
    (records || []).forEach(function add(record) {
      var library = normalizedLibrary(rawLibrary(record || {}));
      if (library) seen[library] = true;
    });
    return Object.keys(seen).length > 1;
  }

  var api = {
    version: "mimicryone/identity-resolver/4",
    validateRecord: validateRecord,
    recordedSource: recordedSource,
    fastaHeader: fastaHeader,
    resolve: resolve,
    parseHeader: parseHeader,
    publicText: publicText,
    mixedLibraries: mixedLibraries,
    libraryLabel: function libraryLabel(value) {
      return LIBRARY_LABELS[normalizedLibrary(value)] || humanize(value);
    }
  };

  root.MimicryOneIdentity = api;
  if (typeof module === "object" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
