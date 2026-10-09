/* The browser Custom FASTA parser, shared verbatim with the offline pipeline. */
(function(root){
  'use strict';
  const K=9;
  const identity=typeof module==='object'&&module.exports?require(typeof __dirname==='string'&&require('node:fs').existsSync(require('node:path').join(__dirname,'mimicryone-identity.js'))?'./mimicryone-identity.js':'../mimicryone-identity.js'):root.MimicryOneIdentity;
  const identityFor=(record,options)=>identity.resolve(record||{},options||{});
  function parseFastaStrict(text, defaultId, minimumLength = K) {
    const input = String(text || "").trim();
    if (!input) return { records: [], errors: ["No sequence was supplied."] };
    const records = [];
    const errors = [];
    let current = null;
    const lines = input.split(/\r?\n/);
    if (input.charAt(0) !== ">") current = { id: defaultId || "query", header: defaultId || "query", raw: "" };
    lines.forEach(function parseLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.charAt(0) === ">") {
        if (current) records.push(current);
        const header = trimmed.slice(1).trim();
        const id = header.split(/\s+/)[0] || `sequence_${records.length + 1}`;
        current = { id, header: header || id, raw: "" };
      } else {
        if (!current) current = { id: defaultId || "query", header: defaultId || "query", raw: "" };
        current.raw += trimmed.replace(/[\s\d._-]/g, "");
      }
    });
    if (current) records.push(current);

    const normalized = records.reduce(function validate(output, record) {
      const original = record.raw.toUpperCase();
      const invalid = Array.from(new Set((original.match(/[^ACDEFGHIKLMNPQRSTVWYBXZJUO*]/g) || [])));
      if (invalid.length) {
        errors.push(`${record.id}: unsupported characters ${invalid.join(" ")}.`);
        return output;
      }
      const replacements = [];
      const sequence = original
        .replace(/[BXZJUO]/g, function normalize(residue) {
          replacements.push(residue);
          return "X";
        })
        .replace(/\*/g, "");
      if (sequence.length < minimumLength) {
        errors.push(`${record.id}: ${sequence.length} residues; at least ${minimumLength} are required.`);
        return output;
      }
      const identity = identityFor({
        protein_id: record.id,
        raw_header: record.header,
        short_id: record.id,
        library_id: "__custom_query__",
      });
      const displayId = identity.accession || identity.assayId || record.id;
      output.push({
        protein_id: displayId,
        display_id: displayId,
        display_accession: identity.accession || "",
        source_accession: identity.accession || undefined,
        gene: identity.gene || "",
        protein_name: identity.proteinName,
        name: identity.proteinName || "",
        header: record.header,
        seqid: record.header,
        raw_header: record.header,
        library_id: "__custom_query__",
        organism: identity.organism,
        assay_id: identity.assayId,
        identity: identity,
        sequence,
        length: sequence.length,
        normalization: replacements.length ? `${replacements.length} ambiguous residue(s) represented as X` : "none",
      });
      return output;
    }, []);
    const idCounts = new Map();
    normalized.forEach(function makeSourceIdUnique(record) {
      const originalId = record.protein_id;
      const occurrence = (idCounts.get(originalId) || 0) + 1;
      idCounts.set(originalId, occurrence);
      record.original_id = originalId;
      if (occurrence > 1) record.protein_id = `${originalId}__${occurrence}`;
    });
    return { records: normalized, errors };
  }

  // Browser selection only. The offline parser still processes every record.
  // Select the first raw record before validation: an invalid first record must
  // fail, and unused later records must never become the analyzed target.
  function firstTarget(text) {
    const input=String(text || "");
    const headers=[...input.matchAll(/^[^\S\r\n]*>/gm)];
    const leading=headers.length ? input.slice(0,headers[0].index).trim().length>0 : input.trim().length>0;
    const count=headers.length+(leading?1:0);
    const next=headers[leading?0:1];
    const fasta=next ? input.slice(0,next.index) : input;
    return {...parseFastaStrict(fasta,"query"),fasta,submittedRecords:count,ignoredRecords:Math.max(0,count-1)};
  }

  // Carry parsed identity through role conversion. A source label remains a label;
  // unknown gene, accession and organism metadata stay empty.
  function targetRecord(query){ return {
        protein_id: query.protein_id,
        display_id: query.display_id || query.display_accession || query.protein_id,
        display_accession: query.display_accession || query.source_accession || "",
        source_accession: query.source_accession,
        gene: query.gene,
        name: query.name,
        protein_name: query.protein_name,
        identity: query.identity,
        header: query.header,
        seqid: query.seqid || query.header,
        raw_header: query.raw_header || query.header,
        library_id: "__custom_query__",
        organism: query.organism || "",
        length: query.length,
        sequence: query.sequence,
      }; }
  function parentRecord(record){return {...record,library_id:'__custom_target__',organism:record.organism||''};}
  // A complete parent population may contain nonempty records with no 9-mer.
  // Retain their identity and sequence; they contribute zero searchable windows.
  const parseParents=text=>parseFastaStrict(text,"target",1);
  const api={parse:parseFastaStrict,parseParents,firstTarget,targetRecord,parentRecord};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimicryFastaInput=api;
})(typeof globalThis!=='undefined'?globalThis:this);
