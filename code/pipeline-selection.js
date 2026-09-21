/* Optional, signature-bound metadata for a selected-comparison pipeline bundle.
 * FASTA files own sequences; this sidecar stores metadata deltas, grouping and
 * coordinate references needed to reconstruct the selected record units. */
(function(root,factory){
 const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MimicryPipelineSelection=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value));
 const internal=/\b(?:HUM|EXP)(?:_[a-f0-9_]{16,}|\d{6,9})\b|\b(?:M1E|P9P)\d{9}\b/i;
 const parser=()=>typeof module==='object'&&module.exports?require('./fasta-input.js'):root.MimicryFastaInput;
 const fields=['protein_id','display_id','display_accession','source_accession','antigen_id','primary_gene','gene_symbol','gene','protein_name','name','raw_header','seqid','library_id','organism','taxid','organism_taxid','taxonomy_id','organism_taxon_label','assay_id','source_header','companion_header','record_identity'];
 function metadata(record){
  const out=Object.fromEntries(fields.filter(k=>record[k]!==undefined&&record[k]!==null).map(k=>[k,clone(record[k])]));
  out.raw_header=record.raw_header||record.header||record.seqid||record.identity?.fullHeader||'';
  if(out.seqid===out.raw_header)delete out.seqid;
  if(record.identity)out.identity=Object.fromEntries(['gene','proteinName','accession','organism','taxid','assayId','primaryLine'].filter(k=>record.identity[k]!==undefined).map(k=>[k,record.identity[k]]));
  return out;
 }
 const delta=(wanted,base)=>Object.fromEntries([...new Set([...Object.keys(wanted),...Object.keys(base)])].filter(k=>JSON.stringify(wanted[k])!==JSON.stringify(base[k])).map(k=>[k,wanted[k]===undefined?null:wanted[k]]));
 function apply(base,overrides={}){
  const record=metadata(base);for(const [key,value]of Object.entries(overrides)){if(value===null)delete record[key];else record[key]=clone(value);}
  return {...record,header:record.raw_header,seqid:record.seqid||record.raw_header,sequence:base.sequence,length:base.sequence.length};
 }
 const fasta=(rows,headers)=>rows.map((r,i)=>'>'+headers[i]+'\n'+r.sequence+'\n').join('');
 function parse(text,role){const value=role==='target'?parser().parseParents(text):parser().parse(text,role);if(value.errors.length)throw Error(value.errors.join(' '));return value.records;}
 // Hash ordered raw headers and normalized sequences, not display labels or settings.
 async function signature(records){
  const bytes=new TextEncoder().encode(JSON.stringify(records.map(r=>[r.raw_header,r.sequence])));
  const crypto=root.crypto?.subtle?root.crypto:require('node:crypto').webcrypto;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 }
 function mapping(m){return {output_key:m.output_key,start0:m.start0,end0:m.end0,
  ...(m.mapping_status!==undefined?{mapping_status:m.mapping_status}:{}),
  ...(m.projection?{projection:Object.fromEntries(['portable_id','target_end0'].filter(k=>m.projection[k]!==undefined).map(k=>[k,m.projection[k]]))}:{})};}
 function entityIdentity(record,identity){
  if(record.protein_id)return record;
  const i=identity.resolve(record),display=i.accession||i.assayId||i.primaryLine;
  const token=v=>String(v).replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);
  return {...record,protein_id:token(display||record.short_id||record.portable_id||'source')+'#'+token(record.antigen_id??record.protein_idx),
   display_id:display,gene:i.gene||i.primaryLine,name:i.proteinName||record.display_name||record.raw_header,
   protein_name:i.proteinName,library_id:record.library_id||record.library||record.library_key||'analysis',organism:i.organism,assay_id:i.assayId,identity:i};
 }
 function header(record,index,identity){
  const raw=String(record.raw_header||record.header||record.seqid||'').replace(/^>+/,'').replace(/[\r\n]+/g,' ').trim();
  if(raw&&!internal.test(raw))return raw;
  const resolved=identity.resolve(record),clean=value=>identity.publicText(value||'').replace(/[\r\n]+/g,' ').trim();
  const accession=clean(resolved.assayId)||clean(resolved.accession)||clean(record.display_accession)||clean(record.protein_id)||'record_'+(index+1);
  const name=clean(resolved.proteinName)||clean(resolved.gene)||clean(resolved.primaryLine);
  return [accession.replace(/\s+/g,'_'),name&&name!==accession?name:'',resolved.organism?'OS='+clean(resolved.organism):'',resolved.taxid?'OX='+clean(resolved.taxid):'',resolved.gene?'GN='+clean(resolved.gene):''].filter(Boolean).join(' ');
 }

 async function prepare(snapshot,population,identity){
  const result=snapshot.result,records=population.records,query=result.protein,original=result.inputs||{};
  if(!Array.isArray(records)||!records.length)throw Error('The selected parent population is unavailable.');
  const supplied=(text,fallback)=>typeof text==='string'&&text.trim()&&!internal.test(text)?text:fallback;
  const targetFasta=supplied(original.original_query_fasta,fasta([query],[header(query,0,identity)]));
  const parentFasta=supplied(original.original_parent_fasta,fasta(records,records.map((r,i)=>header(r,i,identity))));
  const parsedTarget=parse(targetFasta,'query'),parsedParents=parse(parentFasta,'target').map(parser().parentRecord);
  if(parsedTarget.length!==1||parsedParents.length!==records.length)throw Error('FASTA records do not match the selected population.');
  const targetBase=parser().targetRecord(parsedTarget[0]);
  const visibleById=new Map((result.source_catalog||[]).map(r=>[String(r.antigen_id??r.protein_id),r]));
  const sourceRecords=records.map(r=>population.projectionPlan?r:{...r,...visibleById.get(String(r.antigen_id??r.protein_id))});
  const selection={schema:'mimicryone/pipeline-selection/2',
   input_signatures:{target:await signature(parsedTarget),parents:await signature(parsedParents)},
   target:delta(metadata(query),metadata(targetBase)),parents:sourceRecords.map((r,i)=>delta(metadata(r),metadata(parsedParents[i]))),
   parameters:Object.fromEntries(['source_scope','source_scope_label','source_entity_level','source_entity_label'].filter(k=>result.parameters?.[k]!==undefined).map(k=>[k,result.parameters[k]])),
   ranking:clone(snapshot.viewState?.ranking||{}),scope_label:snapshot.scope_label||result.parameters?.source_scope_label||'Selected parent population'};
  const restoredQuery=apply(targetBase,selection.target),restoredParents=parsedParents.map((r,i)=>apply(r,selection.parents[i]));
  const extra=[],extraHeaders=[],extraParsed=[],refs=new Map([[parsedTarget[0].sequence,'t']]);
  parsedParents.forEach((r,i)=>{if(!refs.has(r.sequence))refs.set(r.sequence,'p'+i);});
  function reference(record,queryMapping){
   const known=refs.get(record.sequence);if(known!==undefined)return known;
   if(queryMapping&&query.sequence.slice(queryMapping.start0,queryMapping.end0)===record.sequence)return ['t',queryMapping.start0,queryMapping.end0];
   const i=extra.length,h=header(record,i,identity);extra.push(record);extraHeaders.push(h);extraParsed.push(parser().parentRecord(parse(fasta([record],[h]),'target')[0]));refs.set(record.sequence,'r'+i);return 'r'+i;
  }
  const baseFor=ref=>Array.isArray(ref)?{...parsedTarget[0],sequence:parsedTarget[0].sequence.slice(ref[1],ref[2])}:ref==='t'?parsedTarget[0]:ref[0]==='p'?parsedParents[Number(ref.slice(1))]:extraParsed[Number(ref.slice(1))];
  const plan=population.projectionPlan;
  if(plan){
   if(plan.schema!=='mimicryone/reproduction-projections/1'||plan.complete!==true||plan.pair_policy!=='exclude_identical_native_record'||plan.selection_basis!=='complete_selected_input_page_not_hit_candidates')throw Error('Complete selected input mappings are required.');
   if(plan.query.sequence!==query.sequence)throw Error('The mapped target differs from the selected FASTA.');
   const displayed=new Map((result.source_catalog||[]).map(r=>[String(r.protein_idx),r]));
   const entities=plan.parent_entities.map(r=>({...entityIdentity(r,identity),...(displayed.has(String(r.protein_idx))?metadata(displayed.get(String(r.protein_idx))):{}),protein_idx:r.protein_idx,sequence:r.sequence}));
   const byIndex=new Map(entities.map(r=>[String(r.protein_idx),r]));
   const byNativeId=new Map(plan.parent_children.map(r=>[String(r.record.antigen_id),r]));
   const children=records.map(r=>byNativeId.get(String(r.antigen_id)));
   if(children.some(r=>!r)||children.length!==plan.parent_children.length)throw Error('Mapped inputs do not cover the selected parent population.');
   const fullQuery=plan.query_children.length===1&&plan.query_children[0].record.sequence===query.sequence&&plan.query_children[0].mappings.length===1&&plan.query_children[0].mappings[0].start0===0&&plan.query_children[0].mappings[0].end0===query.sequence.length;
   const fullParents=entities.length===children.length&&new Set(children.flatMap(c=>c.mappings.map(m=>String(m.output_key)))).size===children.length&&children.every(c=>c.mappings.length===1&&c.mappings[0].start0===0&&c.mappings[0].end0===c.record.sequence.length&&!c.mappings[0].projection&&byIndex.get(String(c.mappings[0].output_key))?.sequence===c.record.sequence);
   const projection={mode:fullQuery&&fullParents?'identity':'mapped',comparison:plan.comparison,...(plan.query_portable_id?{query_portable_id:plan.query_portable_id}:{})};
   if(projection.mode==='identity'){
    projection.query=delta(metadata(plan.query_children[0].record),metadata(restoredQuery));
    projection.entities=children.map((c,i)=>{const e=byIndex.get(String(c.mappings[0].output_key));return [e.protein_idx,delta(metadata(e),metadata(restoredParents[i]))];});
    const statuses=children.map(c=>c.mappings[0].mapping_status??null);
    projection.status= new Set(statuses).size===1?statuses[0]:statuses;
   }else{
    projection.entities=entities.map(e=>{const ref=reference(e);return {index:e.protein_idx,ref,meta:delta(metadata(e),metadata(baseFor(ref)))};});
    projection.query_children=plan.query_children.map(c=>{const ref=reference(c.record,c.mappings[0]);return {ref,meta:delta(metadata(c.record),metadata(baseFor(ref))),mappings:c.mappings.map(m=>({start0:m.start0,end0:m.end0}))};});
    projection.parent_mappings=children.map(c=>c.mappings.map(mapping));
   }
   selection.projection=projection;
  }
  const settings={schema:'mimicryone/pipeline-settings/1',antigen_target_fasta:'inputs/antigen-target.fasta',mimicry_parents_fasta:'inputs/mimicry-parents.fasta',min_identity:snapshot.floor,selected_target_start:snapshot.viewState?.selected_start??null,output_directory:'outputs'};
  const targetName=identity.resolve(query).primaryLine;
  const guide=['# Current Comparison','',targetName+' against '+selection.scope_label+'.','',
   'The input FASTAs and settings.json are ready to run. Start with README.md.','',
   'See [Table Guide](TABLES.md) for local outputs and [Summary Download Guide](SUMMARY-DOWNLOADS.md) for the site CSV/FASTA populations. The local summary outputs include 7/9, 8/9 and 9/9 column groups; detailed tables use the threshold below.','',
   '- Target: '+targetName,'- Parent input records: '+records.length.toLocaleString()+' (including records without matches)','- Core identity threshold: '+snapshot.floor+'/9',
   '- Selected target start: '+(settings.selected_target_start??'not selected'),'',
   'Compact selection metadata preserves record names, grouping, and coordinate mappings automatically. Without it, or after replacing the inputs, the pipeline runs a user-supplied FASTA comparison.',''].join('\n');
  const files={'inputs/antigen-target.fasta':targetFasta,'inputs/mimicry-parents.fasta':parentFasta,'settings.json':JSON.stringify(settings,null,2)+'\n','docs/COMPARISON.md':guide};
  if(extra.length){files['inputs/mapped-records.fasta']=fasta(extra,extraHeaders);selection.input_signatures.references=await signature(extraParsed);}
  files['inputs/selection.json']=JSON.stringify(selection)+'\n';
  return files;
 }
 // Changed target/parent inputs discard all prior overrides and use raw FASTA metadata.
 // A missing or changed required reference FASTA is an error; it must not silently
 // remove mappings from an otherwise matching selected-comparison bundle.
 async function restore(selection,queries,parents,references=[]){
  if(!selection)return null;
  if(selection.schema!=='mimicryone/pipeline-selection/2')throw Error('Unsupported selection metadata.');
  parents=parents.map(parser().parentRecord);references=references.map(parser().parentRecord);
  if(queries.length!==1||selection.parents.length!==parents.length||selection.input_signatures.target!==await signature(queries)||selection.input_signatures.parents!==await signature(parents))return null;
  if(selection.input_signatures.references&&selection.input_signatures.references!==await signature(references))throw Error('The mapped reference FASTA is missing or has changed. Restore it, or remove selection.json to run the input FASTAs without library mappings.');
  const query=apply(parser().targetRecord(queries[0]),selection.target),records=parents.map((r,i)=>apply(r,selection.parents[i]));
  let projection=null;const p=selection.projection;
  if(p){
   projection={schema:'mimicryone/reproduction-projections/1',complete:true,selection_basis:'complete_selected_input_page_not_hit_candidates',pair_policy:'exclude_identical_native_record',comparison:p.comparison,query,query_portable_id:p.query_portable_id||null};
   if(p.mode==='identity'){
    if(p.entities.length!==records.length)throw Error('Mapped record count differs from the input population.');
    projection.query_children=[{record:apply(query,p.query),mappings:[{start0:0,end0:query.length}]}];
    projection.parent_entities=p.entities.map(([index,meta],i)=>({...apply(records[i],meta),protein_idx:index}));
    projection.parent_children=records.map((record,i)=>({record,mappings:[{output_key:String(p.entities[i][0]),start0:0,end0:record.length,mapping_status:Array.isArray(p.status)?p.status[i]:p.status}]}));
   }else if(p.mode==='mapped'){
    const resolve=ref=>{
     let value;if(Array.isArray(ref)){
      if(ref[0]!=='t'||!Number.isInteger(ref[1])||!Number.isInteger(ref[2])||ref[1]<0||ref[2]>queries[0].length||ref[2]<=ref[1])throw Error('Invalid mapped sequence range.');
      value={...queries[0],sequence:queries[0].sequence.slice(ref[1],ref[2])};
     }else if(ref==='t')value=queries[0];else if(/^p\d+$/.test(ref))value=parents[Number(ref.slice(1))];else if(/^r\d+$/.test(ref))value=references[Number(ref.slice(1))];
     if(!value)throw Error('Mapped sequence reference is absent.');return value;
    };
    projection.parent_entities=p.entities.map(e=>({...apply(resolve(e.ref),e.meta),protein_idx:e.index}));
    projection.query_children=p.query_children.map(c=>({record:apply(resolve(c.ref),c.meta),mappings:clone(c.mappings)}));
    if(p.parent_mappings.length!==records.length)throw Error('Mapped record count differs from the input population.');
    projection.parent_children=records.map((record,i)=>({record,mappings:clone(p.parent_mappings[i])}));
   }else throw Error('Unsupported mapping mode.');
  }
  return {query,parents:records,projection,parameters:selection.parameters||{},ranking:selection.ranking,scope_label:selection.scope_label};
 }
 function resultFromEvents(query,catalog,rows,floor,parameters,coverage){
  const source_catalog=[],positional_matches=[],ranked_matches=[];
  for(const source of catalog){
   const events=rows.get(String(source.protein_idx))||[];if(!events.length)continue;
   const hits=events.map(e=>e.hit),best=hits.reduce((n,h)=>Math.max(n,h[2]),0),qs=new Set(hits.map(h=>h[0])),ps=new Set(hits.map(h=>h[1]));
   source_catalog.push(source);
   positional_matches.push({protein_idx:source.protein_idx,protein_id:source.protein_id,best_identity:best,hits_columns:['target_start','source_start','identity','source_9mer'],hits,
    hit_provenance:events.map((e,i)=>({projection:{hit_index:i,contributions:[...e.contributions.values()]}}))});
   ranked_matches.push({protein_index:source.protein_idx,protein_id:source.protein_id,best_identity:best,floors:{['m'+floor]:{pairs:hits.length,target_windows:qs.size,source_windows:ps.size,target_loci:coverage.overlapGroups(qs),source_loci:coverage.overlapGroups(ps)}}});
  }
  return {schema:'mimicryone/result/1',origin:'custom',complete_in_memory:true,protein:query,source_catalog,positional_matches,ranked_matches,available_floors:[floor],
   parameters:{...parameters,floor,window:9,coordinates:'1-based starts and inclusive ends'},result_id:'local-selection',statistics_status:{state:'descriptive_only',p_values:false,q_values:false}};
 }
 return {prepare,restore,resultFromEvents,header};
});
