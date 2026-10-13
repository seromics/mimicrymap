/* Shared browser/Node export contract. No sequence search or statistical inference. */
(function(root){
 'use strict';
 const version='mimicryone/export/21';
 const plotRegistry=root.SeroMapPlotPalette||(typeof require==='function'?(()=>{try{return require('./plot-palette.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;return require('../../../atlas/viewer/shared/plotPalette.cjs');}})():null);
 const ranking=typeof module==='object'&&module.exports?require('./ranking.js'):root.MimicryRanking;
 const contextScore=typeof module==='object'&&module.exports?require('./context-score.js'):root.MimicryContextScore;
 const lexical=(a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0;
 const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
 const coverageCore=typeof module==='object'&&module.exports?require('./residue-coverage.js'):root.MimicryResidueCoverage;
 const publicText=v=>{const original=String(v==null?'':v),cleaned=original.replace(/\b(?:HUM|EXP)(?:_[a-f0-9_]{16,}|\d{6,9})\b|\b(?:M1E|P9P)\d{9}\b/gi,'');return cleaned===original?original:cleaned.replace(/^\s*[>|;,]+\s*|\s*[|;,]+\s*$/g,'').trim();};
 const cell=v=>'"'+publicText(v).replace(/"/g,'""')+'"';
 // Format only at serialization: preserve exact coverage values for ranking and calculations.
 const exportPercent=value=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(2):value;
 const exportCell=(column,value)=>cell(column.includes('(%)')?exportPercent(value):value);
 const csv=(columns,rows)=>'\ufeff'+[columns.map(cell).join(','),...rows.map(r=>columns.map(c=>exportCell(c,r[c])).join(','))].join('\r\n')+'\r\n';
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function contextIdentity(a,b){
  let matches=0;
  for(let i=0;i<27;i++)if(a[i]===b[i]&&/^[ACDEFGHIKLMNPQRSTVWY]$/.test(a[i]||''))matches++;
  return matches;
 }
 const contextIdentityAt=contextScore.identityAt;
 function identity(record,prefix){
  const i=record.identity||{};
  const fields={id:record.protein_id,record_id:record.antigen_id,seqid:record.seqid,
   full_header:record.raw_header||record.header||i.fullHeader||'',gene:i.gene||record.primary_gene||record.gene_symbol||record.gene||String(record.raw_header||record.header||record.source_header||'').match(/(?:^|\s)GN=([^\s]+)/)?.[1]||'',
   protein_name:i.proteinName||record.protein_name||record.name,accession:i.accession||record.source_accession||record.display_accession||record.accession,
   organism:i.organism||record.organism,library:record.library_id,assay_id:i.assayId||record.assay_id,
   strain:i.strain||record.strain,coordinates:i.coordinates||record.coordinates,
   variant_hgvs:i.variant||record.variant_hgvs,variant_significance:i.significance||record.variant_significance,
   collection:i.collection||record.collection,identity_provenance:i.provenance||record.identity_provenance,
   canonical_source_header:record.source_header,companion_header:record.companion_header};
  return Object.fromEntries(Object.entries(fields).map(([k,v])=>[prefix+k,v??'']));
 }
  const label=(r,p)=>{
   const name=publicText(r[p+'gene'])||publicText(r[p+'protein_name']),accession=publicText(r[p+'accession'])||publicText(r[p+'assay_id']);
   if(/^__custom_(?:query|target)__$/.test(r[p+'library'])&&!r[p+'gene']&&!accession&&publicText(r[p+'id']))return publicText(r[p+'id']);
   const header=publicText(r[p+'canonical_source_header'])||publicText(r[p+'companion_header'])||publicText(r[p+'full_header']);
   return [...new Set([name,accession].filter(Boolean))].join(' | ')||
    (header&&!/^(?:HUM|EXP)_[a-f0-9_]+$/i.test(header)?header:'Unnamed protein');
  };
  const segment=(sequence,start,end)=>{
   const a=Math.max(1,start),b=Math.min(sequence.length,end);
   return a>b?{start:'',end:'',peptide:'',length:0}:{start:a,end:b,peptide:sequence.slice(a-1,b),length:b-a+1};
  };
  const comparison=(a,b,nTerminal=false)=>{
   // Flanks align by offset from the core, never by their clipped string start.
   const q=nTerminal?a.padStart(9,'-'):a.padEnd(9,'-'),p=nTerminal?b.padStart(9,'-'):b.padEnd(9,'-');
   let mask='',matches=0,mismatches=0,unresolved=0,absent=0;
   for(let i=0;i<9;i++){
    if(q[i]==='-'||p[i]==='-'){mask+='-';absent++;}
    else if(!/^[ACDEFGHIKLMNPQRSTVWY]$/.test(q[i])||!/^[ACDEFGHIKLMNPQRSTVWY]$/.test(p[i])){mask+='?';unresolved++;}
    else if(q[i]===p[i]){mask+=q[i];matches++;}else{mask+='X';mismatches++;}
   }
   return {mask,matches,mismatches,unresolved,absent};
  };
 const assayId=publicText;
 const identityColumns=prefix=>['Gene','Accession','Protein Description'].map(field=>prefix+' '+field);
 function readableIdentity(r){
  const out={};
  for(const [label,prefix] of [['Antigen Target','target_'],['Mimicry Parent','parent_']]){
   out[label+' Gene']=publicText(r[prefix+'gene']);
   out[label+' Accession']=publicText(r[prefix+'accession']);
   out[label+' Protein Description']=publicText(r[prefix+'protein_name']);
  }
  return out;
 }
 // Shared client identity block: role label, Gene, Accession, Protein Description.
 // Keep labels and metadata separate; display fallbacks do not establish a gene.
 function recordIdentityColumns(role){return [role,...identityColumns(role)];}
 function recordIdentity(record,role){
  const r=identity(record,'record_');
  return {[role]:label(r,'record_'),[role+' Gene']:publicText(r.record_gene),
   [role+' Accession']:publicText(r.record_accession),[role+' Protein Description']:publicText(r.record_protein_name)};
 }
 function matchFormatter(result,byId){
  const readableMatch=r=>{
   const sequence=byId.get(r.parent_id)?.sequence;
   if(!sequence)throw Error((/*@copy export-core.parent-sequence-is-missing-cannot.be84beb*/`Parent sequence is missing; cannot export the displayed peptide context.`/*@endcopy*/));
   const parentCore=sequence.slice(r.parent_start-1,r.parent_end);
   if(parentCore!==r.parent_9mer)throw Error((/*@copy export-core.mimicry-parent-core-disagrees-with.5869b78*/`Mimicry parent core disagrees with its sequence coordinates.`/*@endcopy*/));
   const row={...readableIdentity(r),'Antigen Target':label(r,'target_'),'Mimicry Parent':label(r,'parent_'),'Mimicry Parent Organism':r.parent_organism};
   const comparisons=[];
   for(const [prefix,seq,start] of [['Antigen Target',result.protein.sequence,r.target_start],['Mimicry Parent',sequence,r.parent_start]]){
    const missingN=Math.max(0,10-start),missingC=Math.max(0,start+17-seq.length);
    row[prefix+' Core Start']=start;row[prefix+' Core End']=start+8;
    const context=segment(seq,start-9,start+17);
    row[prefix+' Context Start']=context.start;row[prefix+' Context End']=context.end;
    row[prefix+' Context Sequence']=context.peptide;
    row[prefix+' Missing Context']=[missingN?'N: '+missingN:'',missingC?'C: '+missingC:''].filter(Boolean).join('; ');
   }
   for(const [name,lo,hi] of [['N-terminal Context',-9,-1],['Core',0,8],['C-terminal Context',9,17]]){
    const q=segment(result.protein.sequence,r.target_start+lo,r.target_start+hi),p=segment(sequence,r.parent_start+lo,r.parent_start+hi);
    comparisons.push(comparison(q.peptide,p.peptide,name==='N-terminal Context'));
   }
   row['Core Identity']=r.identity+'|9';
   row['Context Identity']=comparisons.reduce((sum,c)=>sum+c.matches,0)+'|27';
   row['Context BLOSUM62']=contextScore.at(result.protein.sequence,sequence,r.target_start,r.parent_start);
   row['Antigen Target 9-mer Core']=r.target_9mer;
   row['Mimicry Parent 9-mer Core']=parentCore;
   row['Core Match Mask']='mask: '+comparisons[1].mask;
   row['Context Match Mask']='mask: '+comparisons.map(c=>c.mask).join('');
   row['Core Matches']=comparisons[1].matches;
   row['Core Mismatches']=comparisons[1].mismatches;
   row['Flank Matches']=comparisons[0].matches+comparisons[2].matches;
   row['Flank Mismatches']=comparisons[0].mismatches+comparisons[2].mismatches;
   row['Antigen Target Assay ID']=assayId(r.target_assay_id);row['Mimicry Parent Assay ID']=assayId(r.parent_assay_id);
   const contributions=JSON.parse(r.hit_provenance)?.projection?.contributions||[];
   const assayRecord=record=>({assay_id:publicText(record?.cdi_accession),sequence_id:publicText(record?.seqid),header:publicText(record?.raw_header),
    ...(Number.isInteger(record?.target_start0)?{mapped_record_start:record.target_start0+1}:{}),
    ...(Number.isInteger(record?.target_end0)?{mapped_record_end:record.target_end0}:{}),
    ...(record?.mapping_status?{mapping_status:record.mapping_status}:{})});
   row['Assay Contributions']=contributions.length?JSON.stringify(contributions.map(c=>ordered({
    antigen_target:assayRecord(c.query_child),mimicry_parent:assayRecord(c.source_child),comparison:c.static_edge?.comparison||''
   })).sort((a,b)=>lexical(JSON.stringify(a),JSON.stringify(b)))):'';
   return row;
  };
  return readableMatch;
 }
 function parentFormatter(byId,bestContextByParent){
  const readableParent=r=>({...readableIdentity(r),'Antigen Target':label(r,'target_'),'Mimicry Parent':label(r,'parent_'),'Mimicry Parent Organism':r.parent_organism,
   'Antigen Target Covered Residues':r.target_residue_coverage.coveredResidues,'Antigen Target Eligible Residues':r.target_residue_coverage.eligibleResidues,
   'Antigen Target Residues Covered (%)':r.target_residue_coverage.percent,
   'Mimicry Parent Covered Residues':r.parent_residue_coverage.coveredResidues,'Mimicry Parent Eligible Residues':r.parent_residue_coverage.eligibleResidues,
   'Mimicry Parent Residues Covered (%)':r.parent_residue_coverage.percent,
   'Matched Target Windows':r.target_windows,'Antigen Target Window Coverage (%)':r.target_window_percent,
   'Mimicry Parent Loci':r.parent_loci,'Best Core Identity':r.best_identity+'|9','Best Context Identity':bestContextByParent.get(r.parent_id)+'|27',
   'Mimicry Parent Sequence':byId.get(r.parent_id).sequence,'Mimicry Parent Assay ID':assayId(r.parent_assay_id)});
  return readableParent;
 }
 function tableColumns(targetAssay,parentAssay,contributions){
  const matchColumns=[];
  for(const [prefix,key] of [['Antigen Target','target_assay_id'],['Mimicry Parent','parent_assay_id']]){
   matchColumns.push(prefix,...identityColumns(prefix));
   if(prefix==='Mimicry Parent')matchColumns.push('Mimicry Parent Organism');
   if((key==='target_assay_id'?targetAssay:parentAssay))matchColumns.push(prefix+' Assay ID');
   for(const field of ['Core Start','Core End','9-mer Core','Context Start','Context End','Context Sequence','Missing Context'])matchColumns.push(prefix+' '+field);
  }
  matchColumns.push('Core Match Mask','Context Match Mask','Core Identity','Context Identity','Context BLOSUM62',
   'Core Matches','Core Mismatches','Flank Matches','Flank Mismatches');
  if(contributions)matchColumns.push('Assay Contributions');
  const parentColumns=['Antigen Target',...identityColumns('Antigen Target'),'Mimicry Parent',...identityColumns('Mimicry Parent'),'Mimicry Parent Organism','Antigen Target Covered Residues','Antigen Target Eligible Residues','Antigen Target Residues Covered (%)','Mimicry Parent Covered Residues','Mimicry Parent Eligible Residues','Mimicry Parent Residues Covered (%)','Matched Target Windows','Antigen Target Window Coverage (%)','Mimicry Parent Loci','Best Core Identity','Best Context Identity','Mimicry Parent Sequence'];
  if(parentAssay)parentColumns.push('Mimicry Parent Assay ID');
  return {matchColumns,parentColumns};
 }
 function requireExportDetails(result){
  if(result.export_details_deferred||result.inputs?.analysis_scan?.viewer_transport?.export_details_deferred)
   throw Error('Load the complete export details before creating data files.');
 }
 function tables(result,floor,selectedStart,sortSettings){
  requireExportDetails(result);
  if(result.presentation_only) throw Error((/*@copy export-core.a-presentation-cache-cannot-be.3ca3bd0*/`A presentation cache cannot be exported as complete data.`/*@endcopy*/));
  const contract=result.inputs?.analysis_scan?.completeness_contract;
  if(contract&&(contract.truncation===true||contract.positions_complete===false))throw Error((/*@copy export-core.the-server-did-not-certify.5ec10b7*/`The server did not certify complete positional data.`/*@endcopy*/));
  const declared=result.inputs?.analysis_scan?.execution_counts?.returned_deduplicated_hits;
  if(Number.isInteger(declared)&&declared!==result.positional_matches.reduce((n,r)=>n+r.hits.length,0))throw Error((/*@copy export-core.the-server-event-total-disagrees.0f8dcc9*/`The server event total disagrees with the received payload.`/*@endcopy*/));
  if(!Array.isArray(result.available_floors)||!result.available_floors.includes(floor)) throw Error((/*@copy export-core.the-requested-threshold-is-not.3c667ac*/`The requested threshold is not available in this result.`/*@endcopy*/));
  const catalogue=new Map(result.source_catalog.map(r=>[r.protein_idx,r]));
  const ranked=new Map(result.ranked_matches.map(r=>[r.protein_index,r]));
  const target={...identity(result.protein,'target_'),export_schema:version,result_id:result.result_id,
   release_fingerprint:result.inputs?.analysis_scan?.release_fingerprint||'',
   parent_scope_json:JSON.stringify(result.inputs?.analysis_scan?.request?.target||{scope:result.parameters.source_scope})}, matches=[], parents=[], mappings=[], seenSources=new Set();
  for(const source of result.positional_matches){
   const parent=catalogue.get(source.protein_idx), summary=ranked.get(source.protein_idx);
   if(!parent||!summary||seenSources.has(source.protein_idx)) throw Error((/*@copy export-core.missing-or-duplicate-parent-identity.b5f13e1*/`Missing or duplicate parent identity in export.`/*@endcopy*/));
   seenSources.add(source.protein_idx);
   const values=identity(parent,'parent_'), seen=new Set(), qs=new Set(), ps=new Set(); let count=0,best=0;
   source.hits.forEach((hit,index)=>{
    if(hit[2]<floor)return;
    if(!Number.isInteger(hit[0])||hit[0]<1||hit[0]+8>result.protein.sequence.length||!Number.isInteger(hit[1])||hit[1]<1||hit[1]+8>parent.length)throw Error((/*@copy export-core.invalid-event-coordinates.9f0cfc1*/`Invalid event coordinates.`/*@endcopy*/));
    const key=hit[0]+':'+hit[1];
    if(seen.has(key))throw Error((/*@copy export-core.duplicate-coordinate-pair.8262412*/`Duplicate coordinate pair: ${source.protein_id} ${key}`/*@endcopy*/));
    seen.add(key);qs.add(hit[0]);ps.add(hit[1]);count++;best=Math.max(best,hit[2]);
    matches.push({...target,...values,target_start:hit[0],target_end:hit[0]+8,
     event_key:JSON.stringify([result.protein.protein_id,hit[0],source.protein_id,hit[1]]),
     target_9mer:result.protein.sequence.slice(hit[0]-1,hit[0]+8),parent_start:hit[1],parent_end:hit[1]+8,
     parent_9mer:hit[3],identity:hit[2],threshold:floor,
     hit_provenance:JSON.stringify(source.hit_provenance?.[index]||null),
     parent_projection_provenance:JSON.stringify(source.projection_provenance||null)});
   });
   const expected=summary.floors['m'+floor];
   if(!expected||expected.unavailable||Number(expected.pairs)!==count||Number(expected.target_windows)!==qs.size||Number(expected.source_windows)!==ps.size)
    throw Error((/*@copy export-core.export-completeness-check-failed-for.b8ab989*/`Export completeness check failed for ${source.protein_id}: positional events disagree with summary.`/*@endcopy*/));
   if(count) parents.push({...target,...values,sort_label:parent.identity?.primaryLine||parent.protein_name||parent.gene||parent.protein_id,matched_pairs:count,target_windows:qs.size,parent_windows:ps.size,
    target_window_percent:100*qs.size/Math.max(1,result.protein.sequence.length-8),best_identity:best,
    target_loci:expected.target_loci,parent_loci:expected.source_loci,threshold:floor});
  }
  for(const [idx,row] of ranked)if(row.floors['m'+floor]?.pairs>0&&!seenSources.has(idx))throw Error((/*@copy export-core.a-hit-bearing-parent-has.b524e4a*/`A hit-bearing parent has no positional export data.`/*@endcopy*/));
  matches.sort((a,b)=>a.target_start-b.target_start||lexical(a.parent_id,b.parent_id)||a.parent_start-b.parent_start);
  const byId=new Map(result.source_catalog.map(r=>[r.protein_id,r]));
  const assayId=publicText;
  const readableMatch=matchFormatter(result,byId);
  const readableMatches=matches.map(readableMatch),bestContextByParent=new Map();
  matches.forEach((r,i)=>{
   const score=Number(readableMatches[i]['Context Identity'].split('|')[0]);
   bestContextByParent.set(r.parent_id,Math.max(bestContextByParent.get(r.parent_id)||0,score));
  });
  const coverage=coverageCore.summarize(result,floor),coverageByParent=new Map(coverage.parents.map(p=>[p.proteinId,p]));
  for(const row of parents){
   const c=coverageByParent.get(row.parent_id);
   row.target_residue_coverage=c.target;row.parent_residue_coverage=c.parent;
   row.best_context_identity=bestContextByParent.get(row.parent_id);
  }
  parents.sort((a,b)=>ranking.parent(parentSortValues(a),parentSortValues(b),sortSettings));
  const readableParent=parentFormatter(byId,bestContextByParent);
  const {matchColumns,parentColumns}=tableColumns(matches.some(r=>assayId(r.target_assay_id)),matches.some(r=>assayId(r.parent_assay_id)),readableMatches.some(r=>r['Assay Contributions']));
  const site=matches.filter(r=>r.target_start===selectedStart);
  for(const event of matches){
   const provenance=JSON.parse(event.hit_provenance);
   const contributions=(provenance?.projection?.contributions||[]).map(ordered)
    .sort((a,b)=>lexical(JSON.stringify(a),JSON.stringify(b)));
   for(const contribution of contributions){
    const q=contribution.query_child||{},p=contribution.source_child||{};
    mappings.push({event_key:event.event_key,target_id:event.target_id,target_start:event.target_start,parent_id:event.parent_id,parent_start:event.parent_start,
     target_assay_record_id:q.antigen_id,target_assay_seqid:q.seqid,target_assay_header:q.raw_header,target_assay_cdi_accession:q.cdi_accession,
     parent_assay_record_id:p.antigen_id,parent_assay_seqid:p.seqid,parent_assay_header:p.raw_header,parent_assay_cdi_accession:p.cdi_accession,
     contribution_json:JSON.stringify(contribution)});
   }
  }
  const mappingColumns=['target_id','target_start','parent_id','parent_start','target_assay_seqid','target_assay_header','target_assay_cdi_accession','parent_assay_seqid','parent_assay_header','parent_assay_cdi_accession'];
  const publicParents=new Map(matches.map(r=>[r.parent_id,label(r,'parent_')]));
  const publicMappings=mappings.map(r=>({...r,target_id:label(target,'target_'),parent_id:publicParents.get(r.parent_id)||'Unnamed protein'}));
  return {ranking:ranking.describe(sortSettings),coverage,matches,parents,site,mappings,matchColumns,parentColumns,matchesCsv:csv(matchColumns,readableMatches),siteCsv:csv(matchColumns,readableMatches.filter((r,i)=>matches[i].target_start===selectedStart)),parentsCsv:csv(parentColumns,parents.map(readableParent)),mappingsCsv:csv(mappingColumns,publicMappings)};
 }
 // Chunked standalone CSV export. Existing formatters and ranking remain authoritative.
 function* csvChunks(result,floor,selectedStart,sortSettings,kind='matches'){
  requireExportDetails(result);
  if(result.complete_in_memory===false)throw Error('Incomplete coverage result');
  if(!['matches','site','parents'].includes(kind))throw Error('Unknown CSV table');
  if(result.presentation_only)throw Error('A presentation cache cannot be exported as complete data.');
  const contract=result.inputs?.analysis_scan?.completeness_contract;
  if(contract&&(contract.truncation===true||contract.positions_complete===false))throw Error('The server did not certify complete positional data.');
  if(!result.available_floors?.includes(floor))throw Error('The requested threshold is not available in this result.');
  const sources=result.positional_matches,catalogue=new Map(result.source_catalog.map(r=>[r.protein_idx,r])),ranked=new Map(result.ranked_matches.map(r=>[r.protein_index,r]));
  const byId=new Map(result.source_catalog.map(r=>[r.protein_id,r]));
  const parentsBySource=sources.map(source=>catalogue.get(source.protein_idx));
  const target={...identity(result.protein,'target_'),export_schema:version,result_id:result.result_id,
   release_fingerprint:result.inputs?.analysis_scan?.release_fingerprint||'',
   parent_scope_json:JSON.stringify(result.inputs?.analysis_scan?.request?.target||{scope:result.parameters.source_scope})};
  let total=0,selected=0;
  for(let i=0;i<sources.length;i++){
   total+=sources[i].hits.length;
   if(kind!=='parents')for(const hit of sources[i].hits)if(hit[2]>=floor&&(kind!=='site'||hit[0]===selectedStart))selected++;
   if(i%1024===0)yield {phase:'index',completed:i,total:sources.length};
  }
  const declared=result.inputs?.analysis_scan?.execution_counts?.returned_deduplicated_hits;
  if(Number.isInteger(declared)&&declared!==total)throw Error('The server event total disagrees with the received payload.');
  const sourceIndex=new Uint32Array(selected),hitIndex=new Uint32Array(selected),seenSources=new Set(),metrics=[],bestContextByParent=new Map();
  let at=0,hasMatches=false,parentAssay=false,contributions=false;
  for(let si=0;si<sources.length;si++){
   const source=sources[si],parent=catalogue.get(source.protein_idx),summary=ranked.get(source.protein_idx);
   if(!parent||!summary||seenSources.has(source.protein_idx))throw Error('Missing or duplicate parent identity in export.');
   seenSources.add(source.protein_idx);
   const seen=new Set(),qs=new Set(),ps=new Set();let count=0,best=0,context=0;
   for(let hi=0;hi<source.hits.length;hi++){
    const hit=source.hits[hi];if(!Number.isInteger(hit[2])||hit[2]<5||hit[2]>9)throw Error('Invalid event identity');if(hit[2]<floor)continue;
    if(!Number.isInteger(hit[0])||hit[0]<1||hit[0]+8>result.protein.sequence.length||!Number.isInteger(hit[1])||hit[1]<1||hit[1]+8>parent.length)throw Error('Invalid event coordinates.');
    const key=hit[0]+':'+hit[1];if(seen.has(key))throw Error('Duplicate coordinate pair: '+source.protein_id+' '+key);
    seen.add(key);qs.add(hit[0]);ps.add(hit[1]);count++;best=Math.max(best,hit[2]);
    if(!parent.sequence)throw Error('Parent sequence is missing; cannot export the displayed peptide context.');
    if(parent.sequence.slice(hit[1]-1,hit[1]+8)!==hit[3])throw Error('Mimicry Parent core disagrees with its sequence coordinates.');
    if(kind==='parents')context=Math.max(context,contextIdentityAt(result.protein.sequence,parent.sequence,hit[0],hit[1]));
    if(kind!=='parents'&&(kind!=='site'||hit[0]===selectedStart)){sourceIndex[at]=si;hitIndex[at++]=hi;}
    if(source.hit_provenance?.[hi]?.projection?.contributions?.length)contributions=true;
    if(hi%4096===4095)yield {phase:'validate',completed:si,total:sources.length};
   }
   const expected=summary.floors['m'+floor];
   if(!expected||expected.unavailable||Number(expected.pairs)!==count||Number(expected.target_windows)!==qs.size||Number(expected.source_windows)!==ps.size)throw Error('Export completeness check failed for '+source.protein_id+': positional events disagree with summary.');
   if(count){
    hasMatches=true;parentAssay=parentAssay||!!assayId(identity(parent,'parent_').parent_assay_id);
    if(kind==='parents'){
     const tc=coverageCore.measure(qs,Number(result.protein.length??result.protein.sequence.length)),pc=coverageCore.measure(ps,Number(parent.length));
     metrics.push({source:si,id:parent.protein_id,label:parent.identity?.primaryLine||parent.protein_name||parent.gene||parent.protein_id,
      target:tc.percent,parent:pc.percent,core:best,context,count,windows:qs.size,targetLoci:expected.target_loci,parentLoci:expected.source_loci,
      targetCovered:tc.coveredResidues,targetEligible:tc.eligibleResidues,parentCovered:pc.coveredResidues,parentEligible:pc.eligibleResidues});
     bestContextByParent.set(parent.protein_id,Math.max(bestContextByParent.get(parent.protein_id)||0,context));
    }
   }
   if(si%128===0)yield {phase:'validate',completed:si,total:sources.length};
  }
  for(const [idx,row]of ranked)if(row.floors['m'+floor]?.pairs>0&&!seenSources.has(idx))throw Error('A hit-bearing parent has no positional export data.');
  const {matchColumns,parentColumns}=tableColumns(hasMatches&&!!assayId(target.target_assay_id),parentAssay,contributions);
  const columns=kind==='parents'?parentColumns:matchColumns;
  yield {phase:'order',completed:0,total:kind==='parents'?metrics.length:selected};
  const order=new Uint32Array(kind==='parents'?metrics.length:selected);
  for(let i=0;i<order.length;i++)order[i]=i;
  if(kind==='parents'){
   for(const metric of metrics)metric.context=bestContextByParent.get(metric.id);
   order.sort((a,b)=>ranking.parent(metrics[a],metrics[b],sortSettings));
  }else order.sort((a,b)=>{
   const sa=sources[sourceIndex[a]],sb=sources[sourceIndex[b]],ha=sa.hits[hitIndex[a]],hb=sb.hits[hitIndex[b]];
   return ha[0]-hb[0]||lexical(parentsBySource[sourceIndex[a]].protein_id,parentsBySource[sourceIndex[b]].protein_id)||ha[1]-hb[1];
  });
  const formatMatch=matchFormatter(result,byId),formatParent=parentFormatter(byId,bestContextByParent);
  let text='\ufeff'+columns.map(cell).join(',')+'\r\n',lastSource=-1,values;
  for(let i=0;i<order.length;i++){
   const position=order[i],si=kind==='parents'?metrics[position].source:sourceIndex[position],source=sources[si],parent=catalogue.get(source.protein_idx);
   if(si!==lastSource){values=identity(parent,'parent_');lastSource=si;}
   let row;
   if(kind==='parents'){
    const m=metrics[position];row=formatParent({...target,...values,matched_pairs:m.count,target_windows:m.windows,target_loci:m.targetLoci,parent_loci:m.parentLoci,
     target_window_percent:100*m.windows/Math.max(1,result.protein.sequence.length-8),best_identity:m.core,
     target_residue_coverage:{coveredResidues:m.targetCovered,eligibleResidues:m.targetEligible,percent:m.target},
     parent_residue_coverage:{coveredResidues:m.parentCovered,eligibleResidues:m.parentEligible,percent:m.parent}});
   }else{
    const hi=hitIndex[position],hit=source.hits[hi];
    row=formatMatch({...target,...values,target_start:hit[0],target_end:hit[0]+8,target_9mer:result.protein.sequence.slice(hit[0]-1,hit[0]+8),
     parent_start:hit[1],parent_end:hit[1]+8,parent_9mer:hit[3],identity:hit[2],threshold:floor,hit_provenance:JSON.stringify(source.hit_provenance?.[hi]||null)});
   }
   text+=columns.map(column=>exportCell(column,row[column])).join(',')+'\r\n';
   if(text.length>=262144||i%256===255){yield {text,completed:i+1,total:order.length};text='';}
  }
  if(text)yield {text,completed:order.length,total:order.length};
 }

 function comparisonSummary(result,floor,data){
  const length=Number(result.protein.length??result.protein.sequence.length),windows=Math.max(0,length-8);
  const matched=new Set(data.matches.map(row=>row.target_start)).size;
  const fallbackUnit=result.parameters?.source_entity_level||'parent_record';
  const units=[...new Set(result.source_catalog.length?result.source_catalog.map(row=>row.record_identity?.unit||fallbackUnit):[fallbackUnit])];
  return {schema:'mimicryone/comparison-summary/1',threshold:floor,complete:result.complete_in_memory===true,
   target_length:length,antigen_target_all_matching_records:data.coverage.target,
   target_windows:{matched,eligible:windows,percent:windows?100*matched/windows:null},
   matching_records:data.parents.length,matching_record_units:units,window_pairs:data.matches.length,
   available_thresholds:[...result.available_floors],
   coverage_policy:'Union of qualifying 9-mer cores over each eligible full-record length; overlaps once, mismatching positions included, context flanks excluded.',
   window_policy:'Distinct qualifying Target starts / (full-record length - 8). Uncomputed thresholds are unavailable, not zero.',
   statistics:'Descriptive sequence resemblance; no significance estimate or immune cross-reactivity inference.'};
 }
 function parentSortValues(r){return {id:r.parent_id,label:r.sort_label||r.parent_protein_name||r.parent_gene||r.parent_id,target:r.target_residue_coverage?.percent,parent:r.parent_residue_coverage?.percent,core:r.best_identity,context:r.best_context_identity};}
 function figure(snapshot,data){
  const compactOrganism=value=>{
   const label=String(value||''),open=label.indexOf(' (');
   if(open<0)return label;
   if(!/^(strain|isolate)\b/i.test(label.slice(open+2)))return label.slice(0,open);
   let depth=0;for(let i=open+1;i<label.length;i++){if(label[i]==='(')depth++;if(label[i]===')'&&!--depth)return label.slice(0,i+1);}
   return label;
  };
  const s=snapshot.figure, p=snapshot.result.protein, width=s.width||1000, left=24, span=width-48;
  const colors=s.plotPalette?.colors||plotRegistry.colors({export:true});
  const paletteColor=key=>esc(colors[key]);
  const palette=s.palette||{background:colors.surface,body:colors.body,ink:colors.ink,border:colors.line};
  if(s.panel==='combined'&&s.layout==='full'){
   const render=(panel,w,header)=>figure({...snapshot,figure:{...s,panel,width:w,header,footer:false}},data);
   const target=render('target',2020,true),windowPanel=render('window',1000,false),parents=render('parents',1000,false);
   const height=svg=>Number(svg.match(/height="([\d.]+)"/)[1]);
   const top=height(target)+12,total=top+Math.max(height(windowPanel),height(parents));
   const place=(svg,x,y)=>svg.replace('<svg ',`<svg x="${x}" y="${y}" `);
   return `<svg xmlns="http://www.w3.org/2000/svg" width="2020" height="${total}" viewBox="0 0 2020 ${total}"><title>${esc(p.identity?.primaryLine||p.gene||p.protein_id)} \u2014 Full overview</title><rect width="2020" height="${total}" fill="${esc(s.palette?.background||esc(palette.background))}"/>${place(target,0,0)}${place(windowPanel,0,top)}${place(parents,1020,top)}</svg>`;
  }
  let y=28, parts=[];
  const text=(x,y,t,size=12,fill=esc(palette.body),extra='')=>parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(t)}</text>`);
  const centered=(x,y,t,size=11)=>text(x,y,t,size,esc(palette.body),'text-anchor="middle"');
  const line=(y)=>parts.push(`<path d="M24 ${y}H${width-24}" stroke="${esc(palette.border)}"/>`);
  function wrapped(t,size=12){
   const max=Math.floor(span/(size*.57)); let row='';
   for(const word of String(t).split(/\s+/)){if((row+' '+word).length>max&&row){text(left,y,row,size);y+=size+6;row=word;}else row+=(row?' ':'')+word;}
   if(row){text(left,y,row,size);y+=size+6;}
  }
  if(s.header!==false){
   let title=p.identity?.primaryLine||p.gene||p.protein_id;
   if(s.panel==='structure'){
    const model=snapshot.structure||{};
    const accession=model.accession||p.structure_accession||p.identity?.accession||p.display_accession||p.source_accession||p.protein_id;
    const assembly=model.assembly||model.pose?.assembly;
    if(accession&&!String(title).split(/[\s|\u00b7]+/).includes(accession))title+=' | '+accession;
    if(assembly==='monomer'||assembly==='dimer')title+=' \u00b7 '+(assembly==='dimer'?'Dimer':'Monomer');
   }
   wrapped(title,17);
   const windows=Math.max(0,p.sequence.length-8);
   wrapped((/*@copy export-core.aa-window.e11eeef*/`${p.sequence.length} AA · ${windows} Window${windows===1?'':'s'} · ≥${snapshot.floor}/9 · ${snapshot.scope_label||snapshot.result.parameters.source_scope_label||snapshot.result.parameters.source_scope}`/*@endcopy*/),11);
   if(s.layout==='full-window'){
    const crop=snapshot.playerPlot||snapshot.playerPlotPlain;
    if(crop)wrapped((/*@copy export-core.antigen-target-context-core.23d98fb*/`Antigen Target Context ${crop.range_start}–${crop.range_end} · Core ${crop.core_start}–${crop.core_end}`/*@endcopy*/),11);
   }
  }
  y+=6;
  const nativePlot=s.highlight?snapshot.playerPlot:snapshot.playerPlotPlain;
  if((s.panel==='target'||s.panel==='combined')&&nativePlot){
   const scale=span/(nativePlot.referenceWidth||nativePlot.width),plotWidth=nativePlot.width*scale;
   parts.push(`<svg x="${24+(span-plotWidth)/2}" y="${y}" width="${plotWidth}" height="${nativePlot.height*scale}" viewBox="0 0 ${nativePlot.width} ${nativePlot.height}">${nativePlot.content}</svg>`);
   y+=nativePlot.height*scale+14;
  }
  if(s.panel==='residues'){
   const from=s.residueStart||0,to=Math.min(p.sequence.length,from+600),cell=12,origin=220;
   wrapped((/*@copy export-core.antigen-target-residues-of.0004f63*/`Antigen Target Residues ${from+1}–${to} of ${p.sequence.length}`/*@endcopy*/),12);
   const tracks=snapshot.tracks||[],mimicry=tracks.find(t=>t.key==='mimicry');
   const contrast=color=>{
    const hex=String(color||'').match(/^#([a-f0-9]{6})$/i),rgb=hex?[0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16)):String(color||'').match(/[\d.]+/g)?.slice(0,3).map(Number);
    return rgb&&(.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2])>145?paletteColor('contrastInk'):paletteColor('white');
   };
   for(let begin=from;begin<to;begin+=60){
    const end=Math.min(to,begin+60);
    text(24,y+13,(/*@copy export-core.text.edf9784*/`${begin+1}–${end}`/*@endcopy*/),11);
    for(let i=begin;i<end;i++){
     const x=origin+(i-begin)*cell,color=mimicry?.colors[i]||esc(palette.border);
     parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="20" fill="${esc(color)}"/>`);
     text(x+cell/2,y+14,p.sequence[i],11,contrast(color),'text-anchor="middle" font-family="JetBrains Mono,monospace"');
     const offset=i-(snapshot.viewState.selected_start-1);
     if(s.highlight&&offset>=-9&&offset<=17)parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="20" fill="none" stroke="${offset>=0&&offset<=8?paletteColor('mimicryCore'):paletteColor('mimicryContext')}" stroke-width="1.5"/>`);
    }
    y+=24;
    for(const track of tracks.filter(t=>t.key!=='mimicry')){
     text(24,y+9,track.label,10);
     for(let i=begin;i<end;i++)if(track.colors[i]){
      const x=origin+(i-begin)*cell;
      parts.push(track.key==='variants'?`<circle cx="${x+cell/2}" cy="${y+5}" r="3" fill="${esc(track.colors[i])}"/>`:`<rect x="${x}" y="${y}" width="${cell}" height="10" fill="${esc(track.colors[i])}"/>`);
     }
     y+=15;
    }
    y+=16;
   }
   wrapped((/*@copy export-core.residue-colors-and-active-annotation.46f4721*/`Residue colors and active annotation tracks match the captured player. ${s.highlight?'Outlines mark the selected 9-mer core and flanking context.':''}`/*@endcopy*/),11);
   for(const [index,legend] of (snapshot.legends||[]).entries()){
    if(legend.gradient?.length){
     parts.push(`<defs><linearGradient id="residueLegend${index}">${legend.gradient.map((c,i)=>`<stop offset="${100*i/Math.max(1,legend.gradient.length-1)}%" stop-color="${esc(c)}"/>`).join('')}</linearGradient></defs><rect x="24" y="${y-9}" width="90" height="9" fill="url(#residueLegend${index})"/>`);
     text(126,y,legend.text,11);y+=20;
    }else{
     let x=24;for(const item of legend.swatches||[]){parts.push(`<circle cx="${x+4}" cy="${y-4}" r="4" fill="${esc(item.color)}"/>`);text(x+14,y,item.label,11);x+=Math.max(120,item.label.length*7+28);}y+=20;
    }
   }
  }
  if(s.panel==='combined'||s.panel==='target'){
   if(!nativePlot){
   for(const track of snapshot.tracks||[]){
    text(left,y,track.label,11);y+=8;
    track.colors.forEach((color,i)=>{if(color)parts.push(`<rect x="${left+i*span/p.sequence.length}" y="${y}" width="${span/p.sequence.length+.05}" height="${track.key==='variants'?5:12}" fill="${esc(color)}"/>`);});
    if(s.highlight)parts.push(`<rect x="${left+(snapshot.viewState.selected_start-1)*span/p.sequence.length}" y="${y-2}" width="${9*span/p.sequence.length}" height="16" fill="none" stroke="${paletteColor('mimicryCore')}" stroke-width="1.4"/>`);
    y+=23;
   }
   text(left,y,'1',10);text(width-24,y,p.sequence.length,10,esc(palette.body),'text-anchor="end"');y+=18;
   }
   const scale=nativePlot?span/(nativePlot.referenceWidth||nativePlot.width):1,font=(snapshot.legendFontSize||10.4)*scale;
   const entries=[];
   (snapshot.legends||[]).forEach((legend,index)=>{
    if(legend.gradient.length)entries.push({label:legend.text,range:legend.range,gradient:legend.gradient,id:index,symbol:60*scale});
    else for(const item of legend.swatches)entries.push({...item,symbol:item.symbolText?Math.max(12,item.symbolText.length*6+4)*scale:7*scale});
   });
   let group=[],used=0;
   const drawLegend=()=>{
    if(!group.length)return;let x=(width-used)/2;
    for(const entry of group){
     if(entry.gradient&&entry.range){
      const gap=7*scale,measure=t=>String(t).length*font*.65;
      let cursor=x;
      text(cursor,y,entry.range.label,font,esc(palette.body),'font-weight="600"');cursor+=measure(entry.range.label)+gap;
      text(cursor,y,entry.range.low,font);cursor+=measure(entry.range.low)+gap;
      parts.push(`<defs><linearGradient id="legend${entry.id}">${entry.gradient.map((c,i)=>`<stop offset="${i/Math.max(1,entry.gradient.length-1)*100}%" stop-color="${esc(c)}"/>`).join('')}</linearGradient></defs><rect x="${cursor}" y="${y-font*.7}" width="${entry.symbol}" height="${font*.65}" rx="1" fill="url(#legend${entry.id})"/>`);
      cursor+=entry.symbol+gap;text(cursor,y,entry.range.high,font);x+=entry.width;continue;
     }
     if(entry.gradient){parts.push(`<defs><linearGradient id="legend${entry.id}">${entry.gradient.map((c,i)=>`<stop offset="${i/Math.max(1,entry.gradient.length-1)*100}%" stop-color="${esc(c)}"/>`).join('')}</linearGradient></defs><rect x="${x}" y="${y-font*.7}" width="${entry.symbol}" height="${font*.65}" rx="1" fill="url(#legend${entry.id})"/>`);}
     else if(entry.symbolText){
      parts.push(`<rect x="${x}" y="${y-font}" width="${entry.symbol}" height="${font*1.25}" rx="1" fill="${esc(entry.color)}"/>`);
      text(x+entry.symbol/2,y,entry.symbolText,font,paletteColor('white'),'text-anchor="middle" font-weight="600"');
     }
     else if(entry.circle!==false)parts.push(`<circle cx="${x+entry.symbol/2}" cy="${y-font*.3}" r="${entry.symbol/2}" fill="${esc(entry.color)}"/>`);
     else parts.push(`<rect x="${x}" y="${y-font*.7}" width="${entry.symbol}" height="${font*.65}" rx="1" fill="${esc(entry.color)}"/>`);
     text(x+entry.symbol+5*scale,y,entry.label,font);x+=entry.width;
    }
    y+=font+10*scale;group=[];used=0;
   };
   for(const entry of entries){entry.width=entry.range?entry.symbol+(entry.range.label.length+entry.range.low.length+entry.range.high.length)*font*.65+35*scale:entry.symbol+entry.label.length*font*.65+24*scale;if(used+entry.width>span)drawLegend();group.push(entry);used+=entry.width;}drawLegend();
  }
  if(s.panel==='combined'||s.panel==='window'){
   const context=(seq,start)=>Array.from({length:27},(_,i)=>seq[start-10+i]||'.').join('');
   const sources=new Map(snapshot.result.source_catalog.map(r=>[r.protein_id,r]));
   const ref=context(p.sequence,snapshot.viewState.selected_start);
   const peptide=(seq,x,baseline,reference)=>{
    const step=7.2,gap=7.2;
    if(s.highlight)for(let section=0;section<3;section++){
     const start=x+section*(9*step+gap);
     parts.push(`<path d="M${start} ${baseline+4}h${9*step}" fill="none" stroke="${section===1?paletteColor('mimicryCore'):paletteColor('mimicryContext')}" stroke-width="1.5"/>`);
    }
    Array.from(seq).forEach((aa,i)=>text(x+i*step+Math.floor(i/9)*gap,baseline,aa,12,
     aa==='.'?paletteColor('nativeFaint'):(!reference||aa===reference[i])?paletteColor('sequenceMatchPrint'):paletteColor('sequenceMismatchPrint'),'font-family="JetBrains Mono,monospace"'));
   };
   const score=seq=>contextScore.aligned(ref,seq,snapshot.blosum62);
   const sort=ranking.settings(snapshot.viewState.ranking);
   const site=data.site.map(row=>{const peptide=context(sources.get(row.parent_id)?.sequence||'',row.parent_start);return {...row,context:peptide,sort:{core:row.identity,context:contextIdentity(ref,peptide),blosum:score(peptide),id:row.parent_id,start:row.parent_start,targetStart:row.target_start}};}).sort((a,b)=>ranking.event(a.sort,b.sort,sort.window));
   const offset=s.tableStart||0;
   wrapped((/*@copy export-core.core-window-matches-of.361dae1*/`Core Window Matches · ${snapshot.viewState.selected_start}–${snapshot.viewState.selected_start+8} · ${offset?'Rows '+(offset+1)+'–'+Math.min(offset+s.rows,site.length):'Top '+Math.min(s.rows,site.length)} of ${site.length} ${site.length===1?'Window Pair':'Window Pairs'}`/*@endcopy*/),15);
   const start=Math.max(0,snapshot.viewState.selected_start-10), end=Math.min(p.sequence.length,snapshot.viewState.selected_start+17);
   text(24,y,(/*@copy export-core.antigen-target-context.4d3b42e*/`Antigen Target Context`/*@endcopy*/),11);centered(440,y,start+1);peptide(ref,495,y);centered(765,y,end);y+=17;line(y);y+=23;
   const heading=(x,top,bottom,third)=>{
    const dy=third?0:bottom?7:14;
    text(x,y+dy,top,10,paletteColor('printInk'),'text-anchor="middle" font-weight="600"');
    if(bottom)text(x,y+dy+14,bottom,10,paletteColor('printInk'),'text-anchor="middle" font-weight="600"');
    if(third)text(x,y+28,third,10,paletteColor('printInk'),'text-anchor="middle" font-weight="600"');
   };
   text(24,y+14,(/*@copy export-core.mimicry-parent.0efa6b7*/`Mimicry Parent`/*@endcopy*/),11,paletteColor('printInk'),'font-weight="600"');heading(440,(/*@copy export-core.start.e4a2fd5*/`Start`/*@endcopy*/));
   heading(527.4,(/*@copy export-core.context.e8e0fa1*/`Context`/*@endcopy*/),(/*@copy export-core.n-terminal.7f32ef1*/`N-Terminal`/*@endcopy*/));heading(599.4,(/*@copy export-core.core.6e1abcd*/`Core`/*@endcopy*/),(/*@copy export-core.mer.d7b985b*/`9-mer`/*@endcopy*/));heading(671.4,(/*@copy export-core.context.adb61a2*/`Context`/*@endcopy*/),(/*@copy export-core.c-terminal.c97c523*/`C-Terminal`/*@endcopy*/));
   heading(765,(/*@copy export-core.end.a5519f7*/`End`/*@endcopy*/));heading(825,(/*@copy export-core.core.5250cd7*/`Core`/*@endcopy*/),(/*@copy export-core.identity.d92d3a9*/`Identity`/*@endcopy*/),(/*@copy export-core.mer.58d4200*/`9-mer`/*@endcopy*/));heading(888,(/*@copy export-core.context.73798b4*/`Context`/*@endcopy*/),(/*@copy export-core.identity.d704868*/`Identity`/*@endcopy*/),(/*@copy export-core.mer.03ccde0*/`27-mer`/*@endcopy*/));heading(958,(/*@copy export-core.context.261cea0*/`Context`/*@endcopy*/),(/*@copy export-core.blosum.85331be*/`BLOSUM62`/*@endcopy*/),(/*@copy export-core.mer.cf23f0f*/`27-mer`/*@endcopy*/));
   y+=39;line(y);y+=20;
   for(const row of site.slice(offset,offset+s.rows)){
    const label=[(row.parent_protein_name||row.parent_gene||'').split(' (')[0],row.parent_accession||row.parent_assay_id].filter(Boolean).join(' | ');
    // Wrap labels rather than cutting identifiers or descriptions.
    const chunks=label.match(/.{1,53}(?:\s|$)|.{1,53}/g)||[''];
    const organisms=compactOrganism(row.parent_organism).match(/.{1,58}(?:\s|$)|.{1,58}/g)||[];
    const cy=y+((chunks.length-1)*15+(organisms.length?15+(organisms.length-1)*13:0))/2;
    chunks.forEach((chunk,i)=>text(24,y+i*15,chunk,11));
    centered(440,cy,Math.max(1,row.parent_start-9));peptide(row.context,495,cy,ref);centered(765,cy,Math.min(sources.get(row.parent_id)?.length||row.parent_end,row.parent_start+17));centered(825,cy,(/*@copy export-core.text.acc1f7b*/`${row.identity}/9`/*@endcopy*/));
    const contextMatches=Array.from(row.context).filter((aa,i)=>aa===ref[i]&&/^[ACDEFGHIKLMNPQRSTVWY]$/.test(aa)).length;
    centered(888,cy,(/*@copy export-core.text.5f0727e*/`${contextMatches}/27`/*@endcopy*/));centered(958,cy,score(row.context));
    y+=Math.max(1,chunks.length)*15;
    organisms.forEach((chunk,i)=>text(24,y+i*13,chunk,10));y+=organisms.length*13+8;line(y-8);y+=10;
   }
   if(!site.length){text(24,y,(/*@copy export-core.no-qualifying-events-at-this.fca5427*/`No qualifying events at this window.`/*@endcopy*/));y+=25;}
   y+=4;
  }
  if(s.panel==='combined'||s.panel==='parents'){
   const sources=new Map(snapshot.result.source_catalog.map(r=>[r.protein_id,r.sequence]));
   const bestByParent=new Map();
   const cachedBest=new Set();
   for(const row of data.parents)if(row.best_context_identity!=null){bestByParent.set(row.parent_id,{identity:row.best_context_identity});cachedBest.add(row.parent_id);}
   for(const event of data.matches){
    if(cachedBest.has(event.parent_id))continue;
    const sequence=sources.get(event.parent_id)||'';let identity=0;
    for(let offset=-9;offset<=17;offset++){
     const a=p.sequence[event.target_start-1+offset],b=sequence[event.parent_start-1+offset];
     if(!a||!b)continue;
     if(a===b&&/^[ACDEFGHIKLMNPQRSTVWY]$/.test(a))identity++;
    }
    const best=bestByParent.get(event.parent_id)||{identity:0};
    best.identity=Math.max(best.identity,identity);bestByParent.set(event.parent_id,best);
   }
   const offset=s.tableStart||0;
   const parentRows=data.parents.map(row=>({...row,best_context_identity:bestByParent.get(row.parent_id)?.identity??null})).sort((a,b)=>ranking.parent(parentSortValues(a),parentSortValues(b),snapshot.viewState.ranking));
   wrapped((/*@copy export-core.overall-mimicry-parents-of.6ce2e73*/`Overall Mimicry Parents · ${offset?'Rows '+(offset+1)+'–'+Math.min(offset+s.rows,data.parents.length):'Top '+Math.min(s.rows,data.parents.length)} of ${data.parents.length} ${/exact.*sequence.*group/i.test(snapshot.result.parameters.source_entity_label||'')?(data.parents.length===1?'Matching Exact-Sequence Group':'Matching Exact-Sequence Groups'):(data.parents.length===1?'Matching Record':'Matching Records')}`/*@endcopy*/),15);
   text(24,y+7,(/*@copy export-core.mimicry-parent.10e00b6*/`Mimicry Parent`/*@endcopy*/),11,paletteColor('printInk'),'font-weight="600"');
   for(const [x,a,b] of [[570,(/*@copy export-core.target.6628056*/`Target`/*@endcopy*/),(/*@copy export-core.residues.2ae8324*/`Residues (%)`/*@endcopy*/)],[695,(/*@copy export-core.parent.79bee53*/`Parent`/*@endcopy*/),(/*@copy export-core.residues.39ec345*/`Residues (%)`/*@endcopy*/)],[820,(/*@copy export-core.best-core.d894396*/`Best Core`/*@endcopy*/),(/*@copy export-core.mer-identity.20cc708*/`9-mer Identity`/*@endcopy*/)],[945,(/*@copy export-core.best-context.1dc6863*/`Best Context`/*@endcopy*/),(/*@copy export-core.mer-identity.449a45d*/`27-mer Identity`/*@endcopy*/)]]){
    text(x,y,a,11,paletteColor('printInk'),'text-anchor="middle" font-weight="600"');if(b)text(x,y+14,b,11,paletteColor('printInk'),'text-anchor="middle" font-weight="600"');
   }y+=24;line(y);y+=20;
   // Use the full label lane, stopping before the first numeric column.
   // Ellipsize descriptions, never the reproducible accession/assay identifier.
   const labelWidth=476;
   const labelMeasure=(value,size)=>Array.from(String(value)).reduce((sum,ch)=>sum+
    (/[MW@%]/.test(ch)?.95:/[ilI.,' :|!]/.test(ch)?.28:/[frt]/.test(ch)?.35:
     /[mw]/.test(ch)?.85:/[A-Z]/.test(ch)?.7:.56)*size*1.04,0);
   const ellipsize=(value,size,budget)=>{
    let result=String(value||'').trim();if(labelMeasure(result,size)<=budget)return result;
    while(result&&labelMeasure(result+'...',size)>budget)result=result.slice(0,-1);
    return result.trimEnd()+'...';
   };
   for(const row of parentRows.slice(offset,offset+s.rows)){
    const accession=String(row.parent_accession||row.parent_assay_id||row.parent_id||'');
    const name=(row.parent_protein_name||row.parent_gene||'').split(' (')[0];
    const suffix=accession?(name?' | ':'')+accession:'';
    const label=ellipsize(name,11,Math.max(0,labelWidth-labelMeasure(suffix,11)))+suffix;
    text(24,y,label,11);
    const organism=ellipsize(compactOrganism(row.parent_organism),10,labelWidth);
    const cy=y+(organism?7.5:0);
    const best=bestByParent.get(row.parent_id);
    centered(570,cy,row.target_residue_coverage.percent?.toFixed(1)??'\u2014');
    centered(695,cy,row.parent_residue_coverage.percent?.toFixed(1)??'\u2014');centered(820,cy,(/*@copy export-core.text.14dde21*/`${row.best_identity}/9`/*@endcopy*/));
    centered(945,cy,best?(/*@copy export-core.text.bc716f4*/`${best.identity}/27`/*@endcopy*/):'');
    y+=15;
    if(organism){text(24,y,organism,10);y+=13;}
    y+=8;line(y-8);y+=10;
   } y+=16;
  }
  if(s.panel==='structure'){
   const image=s.highlight?snapshot.structure?.highlighted:snapshot.structure?.plain;
   if(!image)throw Error((/*@copy export-core.a-loaded-structure-is-required.4a89902*/`A loaded structure is required for this panel.`/*@endcopy*/));
   parts.push(`<image x="24" y="${y}" width="952" height="600" href="${image}"/>`);y+=600;
  }
  const content=parts.join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y+12}" viewBox="0 0 ${width} ${y+12}" font-family="Inter,Arial,sans-serif"><title>${esc(p.gene||p.protein_id)} \u2014 MimicryMap</title><style>${snapshot.font_css||''}</style><rect width="100%" height="100%" rx="12" fill="${esc(palette.background)}"/>${content}</svg>`;
 }

 function annotationColumns(sequence,metadata){
  const names=['Variants','Surface','Topology','rSASA','pLDDT','Cleavage'];
  const unavailable=Object.fromEntries(names.map(k=>[k,'Not available']));
  if(!metadata)return unavailable;
  if(metadata.schema!=='mimicryone/residue-annotations/1'||metadata.sequence!==sequence)throw Error('Residue annotation sequence does not match the target.');
  const a=metadata.annotations;if(!a)return unavailable;
  const L=sequence.length,valid=v=>v!=null&&v.length===L;
  const intervals=mask=>{const out=[];let start=null;for(let i=0;i<=L;i++){if(i<L&&mask[i]&&start===null)start=i+1;if((i===L||!mask[i])&&start!==null){out.push(start+'..'+i);start=null;}}return out.join('; ')||'None';};
  const numeric=values=>valid(values)?values.map((v,i)=>Number.isFinite(v)&&v>=0?(i+1)+':'+v:null).filter(Boolean).join('; ')||'Not available':'Not available';
  const dimer=metadata.surface_context==='dimer',surface=dimer?a.surface_dimer:a.surface;
  const row={...unavailable};
  if(Array.isArray(a.variants))row.Variants=a.variants.map(v=>JSON.stringify(v)).join('; ')||'None recorded';
  if(valid(surface))row.Surface=metadata.surface_context+': exposed '+intervals(Array.from(surface,v=>v==='1'||v===1));
  const topology=['extracellular','transmembrane','intracellular'].filter(k=>valid(a[k]));
  if(topology.length)row.Topology=topology.map(k=>k+': '+intervals(Array.from(a[k],v=>v==='1'||v===1))).join('; ');
  row.rSASA=numeric(dimer?a.rsasa_dimer:a.rsasa);row.pLDDT=numeric(a.plddt);row.Cleavage=numeric(a.cleavage_epitope);
  return row;
 }

 function organismTaxonLabel(p){
  if(p.organism_taxon_label)return publicText(p.organism_taxon_label);
  if(/\[TaxID:/.test(p.organism||''))return publicText(p.organism);
  const i=p.identity||{},header=p.raw_header||p.header||p.seqid||i.fullHeader||'';
  const tag=k=>header.match(new RegExp('(?:^|\\s)'+k+'=(.*?)(?=\\s(?:OS|OX|GN|PE|SV)=|$)'))?.[1]||'';
  let organism=i.organism||p.organism||p.species||tag('OS');
  let tax=String(p.taxid||p.organism_taxid||p.taxonomy_id||i.taxid||tag('OX')||'');
  // Bound human libraries are human; arbitrary custom FASTA inputs are not.
  if(['canonical_human','human_swissprot','human_hormone','human_current','huprot4'].includes(p.library_id)){organism=organism||'Homo sapiens';tax=tax||'9606';}
  if(!organism&&/^(?:CDIV|CDIE)/.test(header))organism=header.split('|')[1]||'';
  return publicText((organism||'Organism not supplied').replace(/_/g,' ')+' [TaxID: '+(/^[1-9][0-9]*$/.test(tax)?tax:'not supplied')+']');
 }
 function summaryAssayId(record){
  for(const value of [record.assay_id,record.identity?.assayId,record.raw_header,record.header,record.seqid,record.source_header,record.protein_id]){
   const match=String(value||'').match(/^>?(JHU[A-Za-z0-9._-]+|CDI[A-Za-z0-9._-]+)(?=[|\s]|$)/);
   if(match)return match[1];
  }
  return '';
 }
 function summaryDescription(record,description){
  const id=summaryAssayId(record),text=publicText(description||'');
  return !id||text===id||text.startsWith(id+' / ')?text:[id,text].filter(Boolean).join(' / ');
 }
 function summaryPairPercent(covered,length){
  const cents=Math.floor((20000*covered+length)/(2*length));
  return (Math.floor((cents+5)/10)/10).toFixed(1);
 }
 function summaryIdentity(record){
  const id=identity(record,'q_');
  return {'Antigen Target Gene':id.q_gene,'Antigen Target Accession':id.q_accession,
   'Antigen Target Protein Description':summaryDescription(record,id.q_protein_name),
   'Antigen Target Organism (TaxID)':organismTaxonLabel(record)};
 }
 function summaryParentLabel(parent){
  const i=identity(parent,'p_'),encode=s=>String(s).replace(/[\\;@|]/g,c=>String.fromCharCode(92)+c);
  const display=[publicText(i.p_gene||i.p_organism),publicText(i.p_accession),publicText(summaryAssayId(parent)||parent.assay_id||parent.identity?.assayId||'')].filter(Boolean);
  return [...new Set(display)].map(encode).join('|')||encode(publicText(parent.protein_name||parent.protein_id).replace(/#\d+$/,'')||'Unannotated record');
 }
 function summaryTable(result,floors=[7,8,9],annotationMetadata){
  requireExportDetails(result);
  const contract=result.inputs?.analysis_scan?.completeness_contract;
  if(result.presentation_only||result.complete_in_memory===false||contract?.truncation||contract?.positions_complete===false)throw Error('Complete positional results are required for the summary.');
  if(!floors.length||new Set(floors).size!==floors.length||floors.some(t=>!Number.isInteger(t)||t<5||t>9||!result.available_floors?.includes(t)))throw Error('The requested summary identity threshold is not available.');
  const declared=result.inputs?.analysis_scan?.execution_counts?.returned_deduplicated_hits;
  if(Number.isInteger(declared)&&declared!==result.positional_matches.reduce((n,p)=>n+p.hits.length,0))throw Error('Incomplete summary coordinate payload.');
  const p=result.protein,L=p.sequence.length,byIndex=new Map(result.source_catalog.map(p=>[Number(p.protein_idx),p]));
  const native=r=>publicText(r.assay_id||r.identity?.assayId||r.protein_id||''),groups=[];
  const scope=result.parameters?.source_scope_label||result.parameters?.source_scope||'Selected comparison';
  for(const t of floors){
   const partners=[],seen=new Set();
   for(const source of result.positional_matches){
    const key=Number(source.protein_idx),parent=byIndex.get(key);
    if(!parent||seen.has(key))throw Error('Missing or duplicate summary partner.');seen.add(key);
    const qs=new Set(),ps=new Set(),cols=source.hits_columns||['target_start','source_start','identity'];
    const qi=cols.indexOf('target_start'),pi=cols.indexOf('source_start'),ii=cols.indexOf('identity');
    if(Math.min(qi,pi,ii)<0)throw Error('Unrecognized summary coordinates.');
    for(const h of source.hits){if(!Number.isInteger(h[ii])||h[ii]<5||h[ii]>9)throw Error('Invalid summary identity');if(h[ii]>=t){qs.add(h[qi]);ps.add(h[pi]);}}
    if(!qs.size)continue;
    const a=coverageCore.measure(qs,L),b=coverageCore.measure(ps,parent.sequence?.length??parent.length);
    partners.push({recordId:parent.record_id??parent.summary_record_id??key,windowPairs:source.hits.filter(h=>h[ii]>=t).length,a:a.coveredResidues,b:b.coveredResidues,targetRegions:a.intervals,parentRegions:b.intervals,L:parent.sequence?.length??parent.length,native:native(parent),label:summaryParentLabel(parent)});
   }
   groups.push({floor:t,partners});
  }
  return serializeSummary(p,scope,groups,annotationMetadata);
 }

 // A complete record-pair population can be summarized from residue unions.
 // Coverage-filtered lists alone are insufficient unless completeness is proven
 // independently (e.g. every parent is <=90 aa at the 10%-either listing floor).
 function summaryFromPairRegions({protein,scope,groups,completePairPopulation,annotationMetadata}){
  if(completePairPopulation!==true||!Array.isArray(groups)||!groups.length)throw Error('Complete record-pair population required');
  const L=protein.sequence.length,seenFloors=new Set();
  const prepared=groups.map(({floor,pairs})=>{
   if(!Number.isInteger(floor)||floor<5||floor>9||seenFloors.has(floor))throw Error('Invalid summary threshold');seenFloors.add(floor);
   const seen=new Set(),partners=pairs.map(({id,record,targetRanges,parentRanges})=>{
    if(id==null||seen.has(id))throw Error('Missing or duplicate summary partner');seen.add(id);
    const size=record.sequence?.length??record.length,a=coverageCore.union(targetRanges,L),b=coverageCore.union(parentRanges,size);
    if(!a.length||!b.length)throw Error('Empty matching-pair ranges');
    return {recordId:id,windowPairs:null,a:coverageCore.size(a),b:coverageCore.size(b),L:size,targetRegions:a,parentRegions:b,native:publicText(record.assay_id||record.identity?.assayId||record.protein_id||''),label:summaryParentLabel(record)};
   });
   return {floor,partners};
  });
  return serializeSummary(protein,scope,prepared,annotationMetadata);
 }

 function serializeSummary(p,scope,groups,annotationMetadata){
  const L=p.sequence.length,id=identity(p,'q_');
  const columns=['Antigen Target Gene','Antigen Target Accession','Antigen Target Protein Description','Antigen Target Length (AA)','Antigen Target Full Sequence','Antigen Target Organism (TaxID)','Comparison Library'];
  const scopeLabel=({human_current:'HuScan',virscan_exposome_current:'VirScan/Exposome',huprot4:'HuProt 4.0',__custom_fasta__:'Your own FASTA'})[scope]||scope;
  const row=Object.fromEntries(columns.map((k,i)=>[k,[id.q_gene,id.q_accession,summaryDescription(p,id.q_protein_name),L,p.sequence,organismTaxonLabel(p),scopeLabel][i]]));
  const audit={},pairKeys={};
  for(const {floor:t,partners} of groups){
   const listed=partners.filter(p=>100*p.a>=10*L||100*p.b>=10*p.L).sort((a,b)=>b.a-a.a||(b.b/b.L-a.b/a.L)||lexical(a.native,b.native));
   audit[t]={matchingPairs:partners.length,listedPairs:listed.length};
   // Separate identity metadata follows the exact CSV list order. Labels are
   // deliberately not keys: distinct source records may share an accession.
   pairKeys[t]=listed.map(p=>[p.recordId,p.windowPairs]);
   const pairedName='Mimicry Parents at '+t+'/9 with Coverage (%) Parent|Target (>=10% either)';
   columns.push(pairedName);row[pairedName]=listed.map(p=>p.label+'@'+summaryPairPercent(p.b,p.L)+'|'+summaryPairPercent(p.a,L)).join(';');
   const compactRanges=xs=>xs.map(([a,b])=>a+'..'+b).join(',');
   const regionName='Mimicry Parent Regions at '+t+'/9 Parent|Target (>=10% either)';
   columns.push(regionName);row[regionName]=listed.map(p=>p.label+'@'+compactRanges(p.parentRegions)+'|'+compactRanges(p.targetRegions)).join(';');
  }
  if(annotationMetadata!==undefined){const annotations=annotationColumns(p.sequence,annotationMetadata);columns.push(...Object.keys(annotations));Object.assign(row,annotations);}
  // Coverage display matches detailed CSVs; threshold decisions use integer residue counts.
  const quote=v=>'"'+publicText(v??'').replace(/"/g,'""')+'"';
  const serialize=rows=>'\ufeff'+[columns.map(quote).join(','),...rows.map(r=>columns.map(k=>quote(k.includes('(%)')?exportPercent(r[k]):r[k])).join(','))].join('\r\n')+'\r\n';
  return {schema:'mimicryone/native-summary/7',columns,row,csv:serialize([row]),serialize,audit,pairKeys};
 }

 const api={annotationColumns,summaryTable,summaryFromPairRegions,summaryIdentity,summaryParentLabel,summaryPairPercent,version,exportPercent,recordIdentityColumns,recordIdentity,csv,tables,csvChunks,figure,contextIdentity,contextIdentityAt,comparisonSummary};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MimicryExportCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
