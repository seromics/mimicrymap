/* Continue a selected library request on this device, using prepared inputs and metadata references. */
(function(root){
 'use strict';
 function supported(plan,parent){
  const query=plan&&plan.staticQuery;
  return !!(root.Worker&&root.MimicryOne?.loadCachedInputs&&parent?.kind==='library'&&
   parent.library&&query&&(query.kind==='portable_protein'||
    query.kind==='library'&&query.library&&query.antigen_ids?.length===1));
 }
 const canceled=signal=>{if(signal?.aborted)throw new DOMException('Canceled','AbortError');};
 async function mappedInputs(options,bundle){
  const {plan,parent,floor,filters,signal,report}=options;
  canceled(signal);
  const query=plan.staticQuery;
  const expected=bundle.records.filter(r=>!(query.kind==='library'&&Number(r.antigen_id)===Number(query.antigen_ids[0])));
  const byId=new Map(bundle.records.map(r=>[Number(r.antigen_id),r]));
  // The page-wide release identifies the composite deployment. Mapping pages
  // and the resulting export must use the prepared library component's release.
  const params=new URLSearchParams({library:parent.library,filters:JSON.stringify(filters||{}),floor:String(floor),
   population_only:'true',projection_inputs:'true',shape:'projection_refs',fields:'lean',limit:'1000',
   release:bundle.manifest.release_fingerprint});
  if(plan.componentKey)params.set('component',plan.componentKey);
  if(query.kind==='library'){params.set('query_id',query.antigen_ids[0]);params.set('query_library',query.library);}
  else{params.set('query_portable_id',query.portable_id);params.set('query_projection_library',query.projection_library);}
  let cursor=null,scope=null,selection=null,queryIdentity=null;const seen=new Set(),entities=new Map();
  function record(r){
   if(r.sequence_ref===undefined)return r;
   const input=byId.get(Number(r.sequence_ref));
   if(!input||Number(r.length)!==input.sequence.length)throw Error('Mapping metadata does not match the prepared inputs.');
   const output={...r,sequence:input.sequence};delete output.sequence_ref;return output;
  }
  do{
   canceled(signal);if(cursor!==null)params.set('after_id',cursor);
   const response=await fetch('/api/analysis/local-inputs?'+params,{signal});
   if(!response.ok)throw Error('The selected record mappings could not be loaded (HTTP '+response.status+').');
   const page=await response.json(),p=page.projection_inputs;canceled(signal);
   if(page.shape!=='projection_refs'||p?.transport!=='prepared-input-references/1'||
      page.manifest?.mode!=='full_selected_library'||page.release_fingerprint!==bundle.manifest.release_fingerprint||
      p.selection_basis!=='complete_selected_input_page_not_hit_candidates')throw Error('Complete matching input metadata is required.');
   if(scope&&scope!==page.scope_hash)throw Error('The selected scope changed while loading mappings.');scope=page.scope_hash;
   const identity=JSON.stringify([p.query,p.query_children,p.comparison,p.query_portable_id]);
   if(queryIdentity&&queryIdentity!==identity)throw Error('The selected target mapping changed.');queryIdentity=identity;
   if(!selection)selection={...p,parent_children:[],parent_entities:[],complete:false};
   for(const child of p.parent_children){
    const id=Number(child.record.antigen_id);if(seen.has(id)||!byId.has(id))throw Error('Mapping inputs differ from the prepared population.');
    seen.add(id);selection.parent_children.push({...child,record:record(child.record)});
   }
   for(const item of p.parent_entities){const e=record(item),key=String(e.protein_idx);
    if(entities.has(key)&&JSON.stringify(entities.get(key))!==JSON.stringify(e))throw Error('Conflicting output record mappings.');entities.set(key,e);}
   if(page.next_after_id!==null&&page.next_after_id!==undefined&&Number(page.next_after_id)<=Number(cursor||0))throw Error('Mapping pagination did not advance.');
   cursor=page.next_after_id??null;
   if(Number(page.manifest.download_records)!==expected.length)throw Error('Mapping population differs from the prepared selection.');
   report('Preparing record mappings · '+seen.size.toLocaleString()+' / '+expected.length.toLocaleString());
  }while(cursor!==null);
  if(seen.size!==expected.length||expected.some(r=>!seen.has(Number(r.antigen_id))))throw Error('Record mappings are incomplete.');
  selection.parent_entities=[...entities.values()];selection.complete=true;
  return {selection,bundle};
 }
 async function nativeInputs(options,bundle){
  const {plan,parent,floor,filters,signal}=options,query=plan.staticQuery;
  const params=new URLSearchParams({library:parent.library,query_library:query.library,
   query_id:String(query.antigen_ids[0]),filters:JSON.stringify(filters||{}),floor:String(floor),
   population_only:'true',projection_inputs:'true',shape:'native_contract',fields:'lean',
   release:bundle.manifest.release_fingerprint});
  if(plan.componentKey)params.set('component',plan.componentKey);
  const response=await fetch('/api/analysis/local-inputs?'+params,{signal});
  if(!response.ok)throw Error('The selected record metadata could not be loaded (HTTP '+response.status+').');
  const page=await response.json(),selection=page.projection_inputs;canceled(signal);
  if(page.shape!=='native_contract'||page.release_fingerprint!==bundle.manifest.release_fingerprint||
     selection?.transport!=='prepared-native-records/1'||selection.parent_mapping!=='identity'||
     selection.pair_policy!=='exclude_identical_native_record'||selection.complete!==true||
     selection.query_portable_id||selection.query_children.length!==1||
     Number(selection.query.antigen_id)!==Number(query.antigen_ids[0])||selection.query.library!==query.library)
   throw Error('Native record metadata does not match the prepared selection.');
  const child=selection.query_children[0],span=child.mappings[0];
  if(child.mappings.length!==1||span.start0!==0||span.end0!==selection.query.sequence.length||child.record.sequence!==selection.query.sequence)
   throw Error('This target requires coordinate mapping.');
  const records=bundle.records.filter(r=>Number(r.antigen_id)!==Number(query.antigen_ids[0]));
  const selected=root.MimicryLocalInputRecords.scopeMask({membershipMask:page.membership_mask,
   manifest:page.manifest,release:page.release_fingerprint,scopeHash:page.scope_hash,
   populationRecords:records.length},parent.library);
  const ids=new Set();
  for(const r of records){
   const id=Number(r.antigen_id);
   if(!selected||!selected(id)||ids.has(id)||r.native.library!==parent.library||r.sequence.length!==Number(r.length))
    throw Error('Native record scope does not match the prepared inputs.');
   ids.add(id);
  }
  if(Number(page.manifest.download_records)!==records.length)throw Error('Native record population is incomplete.');
  return {selection,bundle,nativeRecords:records};
 }
 async function inputs(options){
  const {plan,parent,floor,filters,signal,report}=options;
  report('Loading prepared inputs for this device…');
  const bundle=await root.MimicryOne.loadCachedInputs({library:parent.library,floor,filters:filters||{},
   component:plan.componentKey||null,release:options.release||null,signal},()=>{});
  canceled(signal);
  if(plan.staticQuery.kind==='library'&&root.MimicryOne.scanPreparedRecords&&
     root.MimicryLocalInputRecords?.scopeMask&&bundle.records.every(r=>r.native))return nativeInputs(options,bundle);
  return mappedInputs(options,bundle);
 }
 let lastTimings=null;
 async function run(options){
  if(!supported(options.plan,options.parent))throw Error('This selection is not available for local continuation.');
  const started=performance.now(),timings={};
  let {selection,bundle,nativeRecords}=await inputs(options);canceled(options.signal);
  timings.inputs_ms=performance.now()-started;
  let summaries;
  if(nativeRecords){
   const rows=nativeRecords.filter(r=>r.sequence.length>=9),scanStarted=performance.now();
   summaries=await root.MimicryOne.scanPreparedRecords({query:selection.query,records:rows,
    floor:options.floor,signal:options.signal,timings,
    progress:f=>options.report('Computing '+options.floor+'/9 in this browser · '+Math.round(f*100)+'% · Cancel is safe.')});
   timings.scan_ms=performance.now()-scanStarted;canceled(options.signal);
   // Only matching records and summaries cross to the result-assembly worker.
   // It uses the unchanged coordinate/provenance formatter, without rescanning.
   const children=[],entities=[];
   summaries=summaries.map((summary,index)=>{
    const r=rows[summary.protein_index];
    if(!r)throw Error('Prepared summary references an absent record.');
    const record={...r.native,sequence:r.sequence,length:r.sequence.length};
    children.push({record,mappings:[{output_key:String(r.antigen_id),start0:0,end0:r.sequence.length,mapping_status:'not_applicable'}]});
    entities.push({...record,protein_idx:r.antigen_id,entity_level:'analysis_catalog_antigen',mapping_status:'not_applicable'});
    return {...summary,protein_index:index};
   });
   selection={...selection,parent_children:children,parent_entities:entities};
  }
  const assemblyStarted=performance.now();
  options.report('Computing the complete '+options.floor+'/9 result on this device…');
  return new Promise((resolve,reject)=>{
   let worker;const signal=options.signal;
   const done=(error,value)=>{if(worker)worker.terminate();signal?.removeEventListener('abort',abort);timings.assembly_ms=performance.now()-assemblyStarted;timings.total_ms=performance.now()-started;lastTimings={...timings,native:!!nativeRecords};error?reject(error):resolve(value);};
   const abort=()=>done(new DOMException('Canceled','AbortError'));
   try{
    canceled(signal);worker=new Worker('/local-mapped-worker.js');signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=e=>done(Error(e.message||'The local worker stopped.'));
    worker.onmessage=({data})=>{
     if(signal?.aborted)return;
     if(data.type==='progress')options.report('Computing '+options.floor+'/9 on this device · '+Math.round(data.fraction*100)+'% · Cancel is safe.');
     else if(data.type==='complete')done(null,data.payload);
     else if(data.type==='error')done(Error(data.message));
    };
    worker.postMessage({selection,summaries,floor:options.floor,release:bundle.manifest.release_fingerprint,component:options.plan.componentKey||null,
     request:{floor:options.floor,query:options.plan.staticQuery,target:{kind:'library',library:options.parent.library,filters:options.filters||{}},include_hits:true}});
   }catch(error){done(error);}
  });
 }
 function isSizeFailure(error){
  return error?.code==='positions_incomplete'&&Number(error.details?.maximum)>0||
   ['returned_hit_limit_exceeded','reconstruction_limit_exceeded','projection_provenance_limit_exceeded','result_limit_exceeded'].includes(error?.code)||
   error?.code==='async_required'&&['returned_positional_hits','verified_window_pairs','response_bytes','estimated_resident_bytes'].includes(error.details?.guard);
 }
 function isRecoverableFailure(error){
  return error?.code==='saved_positions_unavailable'||isSizeFailure(error);
 }
 root.MimicryLocalMappedResult={supported,inputs,run,isSizeFailure,isRecoverableFailure,diagnostics:()=>lastTimings&&{...lastTimings}};
})(typeof globalThis!=='undefined'?globalThis:this);
