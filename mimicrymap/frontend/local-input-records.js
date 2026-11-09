/* Shared record identity and package membership conversion. */
(function(root){
 "use strict";
 const identityFor=(record,options)=>root.MimicryOneIdentity.resolve(record,options);
  function localInputRow(record) {
    const sequence = String(record.sequence || "");
    const exactHeader = String(record.raw_header || record.seqid || record.short_id || record.antigen_id);
    const libraryId = record.library || record.library_key || "unknown";
    const identity = identityFor({
      protein_id: record.seqid || record.short_id || String(record.antigen_id),
      raw_header: exactHeader,
      gene: record.display_gene || record.primary_gene || record.gene,
      protein_name: record.protein_name,
      name: record.display_name,
      description: record.description,
      source_accession: record.display_accession || record.accession || record.source_accession,
      organism: record.organism,
      library_id: libraryId,
    }, { activeLibrary: libraryId });
    const native = {};
    // Preserve the original display inputs, without duplicating sequences or
    // hydration diagnostics. Both calculation routes can use the same records.
    for (const key of ['antigen_id','library','seqid','short_id','raw_header','length',
      'display_accession','accession','source_accession','display_gene','primary_gene',
      'gene','display_name','protein_name','description','organism','entity_level',
      'record_identity','source_header','source_fasta_header','full_source_header','source_description','companion_header','coordinates','variant_hgvs',
      'variant_significance','provenance','strain']) {
      if (record[key] !== undefined) native[key] = record[key];
    }
    return {
      native,
      protein_id: record.seqid || record.short_id || String(record.antigen_id),
      antigen_id: record.antigen_id,
      display_id: identity.accession || identity.assayId || identity.primaryLine,
      display_accession: identity.accession || identity.assayId || identity.primaryLine,
      source_accession: identity.accession || undefined,
      gene: identity.gene || identity.primaryLine,
      protein_name: identity.proteinName,
      name: identity.proteinName || record.display_name || exactHeader,
      header: exactHeader,
      seqid: exactHeader,
      raw_header: exactHeader,
      short_id: record.short_id,
      source_fasta_header: root.MimicryOneIdentity.fastaHeader(record),
      library_id: libraryId,
      organism: identity.organism,
      assay_id: identity.assayId,
      coordinates: identity.coordinates,
      variant_hgvs: identity.variant,
      variant_significance: identity.significance,
      collection: identity.collection,
      identity_provenance: identity.provenance,
      identity: identity,
      length: Number(record.length) || sequence.length,
      sequence: sequence,
      sequence_status: record.sequence_status,
      window_count: record.window_count,
    };
  }
  function scopeIsAnswerableLocally(filters, columns, carried) {
    if (!filters) return true;
    for (const field in filters) {
      if (!Object.prototype.hasOwnProperty.call(filters, field)) continue;
      if (field === "include_controls") continue;
      const column = columns && columns[field];
      if (!column || !carried.has(column)) return false;
    }
    return true;
  }

  function membershipMatches(record, filters, columns) {
    if (!filters) return true;
    for (const field in filters) {
      if (!Object.prototype.hasOwnProperty.call(filters, field)) continue;
      const wanted = filters[field];
      if (field === "include_controls") {
        if (!wanted && Number(record.is_control) === 1) return false;
        continue;
      }
      const column = columns && columns[field];
      if (!column) return false;
      const held = record[column];
      if (Array.isArray(wanted)) { if (!wanted.length) continue; if (wanted.indexOf(held) < 0) return false; }
      else if (typeof wanted === "boolean") { if (wanted && !held) return false; }
      else if (wanted != null && held !== wanted) return false;
    }
    return true;
  }

 function scopeMask(scope, library) {
  if (!scope.membershipMask) return null;
  const mask = scope.membershipMask, manifest = scope.manifest;
  const width = mask.end_id - mask.start_id + 1;
  if (mask.schema !== 'mimicryone/input-scope-mask/1' || !manifest || manifest.library !== library ||
      manifest.release_fingerprint !== scope.release || !/^[0-9a-f]{64}$/.test(scope.scopeHash || '') ||
      !Number.isSafeInteger(mask.start_id) || !Number.isSafeInteger(mask.end_id) || mask.start_id < 0 ||
      width < 0 || width > 128 * 1024 * 1024 || typeof mask.bits !== 'string' ||
      mask.bits.length !== 4 * Math.ceil(Math.ceil(width / 8) / 3) ||
      mask.count !== scope.populationRecords || mask.count !== manifest.download_records ||
      mask.count !== manifest.population_records || !Number.isSafeInteger(mask.count) || mask.count < 0)
    throw Error('Input scope metadata disagrees');
  const decoded = root.atob(mask.bits), bits = Uint8Array.from(decoded, char => char.charCodeAt(0));
  if (bits.length !== Math.ceil(width / 8)) throw Error('Input scope mask is truncated');
  let count = 0;
  for (const byte of bits) { let value = byte; while (value) { value &= value - 1; count++; } }
  if (count !== mask.count || (width % 8 && bits.length && (bits[bits.length - 1] >> (width % 8))))
    throw Error('Input scope mask count disagrees');
  return id => {
    if (!Number.isSafeInteger(id)) throw Error('Input package identity is invalid');
    const offset = id - mask.start_id;
    return offset >= 0 && offset < width && !!(bits[offset >> 3] & (1 << (offset & 7)));
  };
 }

 function pack(record) {
  const compact = {};
  for (const key of ['protein_id','antigen_id','raw_header','short_id','library_id','length',
   'sequence','sequence_status','window_count','name','identity','native','source_fasta_header']) compact[key] = record[key];
  return compact;
 }
 function unpack(record) {
  const identity = record.identity;
  return {
   native:record.native, protein_id:record.protein_id, antigen_id:record.antigen_id,
   display_id:identity.accession || identity.assayId || identity.primaryLine,
   display_accession:identity.accession || identity.assayId || identity.primaryLine,
   source_accession:identity.accession || undefined, gene:identity.gene || identity.primaryLine,
   protein_name:identity.proteinName, name:record.name,
   header:record.raw_header, seqid:record.raw_header, raw_header:record.raw_header,
   source_fasta_header:record.source_fasta_header || root.MimicryOneIdentity.fastaHeader({...record,library_id:record.library_id}),
   short_id:record.short_id, library_id:record.library_id, organism:identity.organism,
   assay_id:identity.assayId, coordinates:identity.coordinates, variant_hgvs:identity.variant,
   variant_significance:identity.significance, collection:identity.collection,
   identity_provenance:identity.provenance, identity:identity, length:record.length,
   sequence:record.sequence, sequence_status:record.sequence_status, window_count:record.window_count
  };
 }
 root.MimicryLocalInputRecords={row:localInputRow,pack:pack,unpack:unpack,scopeMask:scopeMask,answerable:scopeIsAnswerableLocally,matches:membershipMatches};
})(typeof globalThis!=="undefined"?globalThis:this);
