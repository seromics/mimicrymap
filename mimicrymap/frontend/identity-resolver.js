/* One lossless identity contract for search, player rows, history, and exports. */
(function installMimicryOneIdentity(root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MimicryOneIdentity = api;
})(typeof window !== "undefined" ? window : globalThis, function identityFactory() {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function first(values) {
    for (var index = 0; index < values.length; index += 1) {
      var value = text(values[index]);
      if (value) return value;
    }
    return "";
  }

  function comparisonKey(value) {
    return text(value)
      .replace(/^>+/, "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
  }

  function distinct(values, excluded) {
    var seen = new Set((excluded || []).map(comparisonKey).filter(Boolean));
    var output = [];
    (values || []).forEach(function retain(raw) {
      var value = text(raw);
      var key = comparisonKey(value);
      if (!value || !key || seen.has(key)) return;
      seen.add(key);
      output.push(value);
    });
    return output;
  }

  function exposureRecord(record, options) {
    if (options && typeof options.exposure === "boolean") return options.exposure;
    var tokens = [
      record.source_partition,
      record.class,
      record.parent_class,
      record.library,
      record.library_id,
      options && options.recordClass,
      options && options.library
    ].map(text).join(" ").toLocaleLowerCase();
    return /exposure|non[-_ ]?human|virscan/.test(tokens);
  }

  function headerValue(record) {
    var header = first([
      record.full_source_header,
      record.source_header,
      record.original_header,
      record.header,
      record.raw_header,
      record.seqid,
      record.mimic_header,
      record.companion_header,
      record.canonical_header
    ]);
    return header.replace(/^>+/, "");
  }

  function parsedHeader(record, exposure) {
    var header = headerValue(record);
    var fields = header.split("|");
    var nativeId = text(fields[0]);
    var authored = /^(?:JHU|CDI)[A-Za-z0-9._-]+$/i.test(nativeId);
    var parsed = {
      platform_id: authored ? nativeId : "",
      gene: "",
      protein_name: "",
      accession: "",
      organism: "",
      tile: ""
    };
    if (authored) {
      var authoredName = text(fields[1]).replace(/_/g, " ");
      if (exposure) parsed.protein_name = authoredName;
      else parsed.gene = authoredName;
      if (/^JHU/i.test(nativeId)) {
        fields.some(function findUniProt(field) {
          var match = text(field).match(/^UniProt=(.+)$/i);
          if (!match) return false;
          parsed.accession = text(match[1]);
          return true;
        });
      } else if (fields[2] && text(fields[2]).indexOf("=") < 0) {
        parsed.accession = text(fields[2]);
      }
      if (fields[3] && text(fields[3]).indexOf("=") < 0 &&
          !/^(?:humsavar|tumou?r|l1base|dark)$/i.test(text(fields[3]))) {
        parsed.organism = text(fields[3]).replace(/_/g, " ");
      }
      var tail = text(fields[fields.length - 1]);
      if (/^(?:Seq[_-]?\d+|\d+-\d+|(?:FUS|VAR|WT|MUT)[_-].+)$/i.test(tail)) {
        parsed.tile = tail;
      }
      return parsed;
    }

    var uniprot = header.match(/^(?:sp|tr)\|([^|]+)\|([^|\s]+)(?:\s+(.*))?$/i);
    if (uniprot) {
      var description = text(uniprot[3]);
      var geneMatch = description.match(/(?:^|\s)GN=([^\s]+)/);
      var organismMatch = description.match(/(?:^|\s)OS=(.+?)(?=\s(?:OX|GN|PE|SV)=|$)/);
      parsed.accession = text(uniprot[1]);
      parsed.gene = geneMatch ? text(geneMatch[1]) : "";
      parsed.organism = organismMatch ? text(organismMatch[1]) : "";
      parsed.protein_name = text(description.split(/\sOS=/, 1)[0]);
    }
    return parsed;
  }

  function resolve(record, options) {
    record = record && typeof record === "object" ? record : {};
    options = options && typeof options === "object" ? options : {};
    var exposure = exposureRecord(record, options);
    var parsed = parsedHeader(record, exposure);
    var platformId = first([record.platform_id, record.mimic_platform_id, record.native_id, parsed.platform_id]);
    var accession = first([
      record.accession,
      record.source_accession,
      record.display_accession,
      record.mimic_accession,
      record.acc,
      parsed.accession,
      platformId && comparisonKey(record.display_id) !== comparisonKey(platformId)
        ? record.display_id : ""
    ]);
    var gene = first([
      record.display_gene,
      record.primary_gene,
      record.canonical_gene,
      record.gene,
      record.mimic_gene,
      parsed.gene
    ]);
    var organism = first([record.organism, record.mimic_organism, record.org, parsed.organism]);
    var proteinName = first([
      record.protein_name,
      record.display_protein_name,
      record.mimic_name,
      parsed.protein_name,
      record.display_name,
      record.name
    ]);
    if ([accession, platformId, organism, headerValue(record)].some(function duplicate(value) {
      return comparisonKey(value) && comparisonKey(value) === comparisonKey(proteinName);
    })) proteinName = "";

    var immutableId = first([
      record.immutable_id,
      record.parent_key,
      record.mimic_parent_key,
      record.portable_id,
      record.antigen_id != null ? "antigen #" + record.antigen_id : "",
      record.protein_id,
      record.mimic_id,
      options.immutableId
    ]);
    var explicitPrimary = first([record.display_primary, record.primary]);
    var candidates = exposure
      ? [proteinName, organism, gene, explicitPrimary, accession, platformId, immutableId]
      : [gene, proteinName, explicitPrimary, accession, platformId, immutableId];
    var primary = first(candidates) || "unknown";
    var hasBiologicalIdentity = !!first([gene, proteinName, accession, organism]);
    var secondaryCandidates = exposure
      ? [accession, organism]
      : [accession, proteinName];
    if (!hasBiologicalIdentity) secondaryCandidates.push(platformId, immutableId);
    var secondaryParts = distinct(secondaryCandidates, [primary]);
    var metaParts = distinct([organism, parsed.tile], [primary].concat(secondaryParts));
    var header = headerValue(record);
    var seqid = first([record.seqid, record.raw_header, header]);

    return {
      primary: primary,
      secondary: secondaryParts.join(" · "),
      secondary_parts: secondaryParts,
      meta: metaParts.join(" · "),
      meta_parts: metaParts,
      gene: gene,
      protein_name: proteinName,
      accession: accession,
      platform_id: platformId,
      immutable_id: immutableId,
      organism: organism,
      tile: parsed.tile,
      header: header,
      seqid: seqid,
      exposure: exposure
    };
  }

  return Object.freeze({
    schema: "mimicryone/frontend-identity/1",
    resolve: resolve,
    distinct: distinct
  });
});
