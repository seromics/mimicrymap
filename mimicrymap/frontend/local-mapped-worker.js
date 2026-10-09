/* Existing matching and mapping modules, isolated from the page's rendering thread. */
'use strict';
importScripts('/custom-worker.js','/reproduce/projected-events.js','/reproduce/residue-coverage.js');
const scanMessage=self.onmessage,send=self.postMessage.bind(self);
self.onmessage=({data})=>{
 try{
  const plan=data.selection,floor=Number(data.floor);let queryIndex=0;
  const groups=MimicryProjectedEvents.compute(plan,(query,parents,minimum)=>{
   if(Array.isArray(data.summaries)){
    if(plan.query_children.length!==1)throw Error('Prepared summaries require a single native query.');
    return data.summaries;
   }
   let summaries;
   self.postMessage=message=>{
    if(message.type==='complete')summaries=message.summaries;
    else if(message.type==='progress')send({type:'progress',fraction:(queryIndex+message.completed/Math.max(1,message.total))/plan.query_children.length});
   };
   try{scanMessage({data:{type:'scan',query:{sequence:query.sequence},targets:parents.map(r=>({protein_id:r.protein_id,sequence:r.sequence})),floor:minimum,chunkOffset:0}});}
   finally{self.postMessage=send;}
   if(!summaries)throw Error('The local comparison did not complete.');queryIndex++;return summaries;
  },floor);
  const source_catalog=[],results=[],interned=new Map();
  for(const source of plan.parent_entities){
   const events=groups.get(String(source.protein_idx))||[];if(!events.length)continue;
   const hits=events.map(e=>[e.hit[0],e.hit[1],e.hit[2],plan.query.sequence.slice(e.hit[0]-1,e.hit[0]+8),e.hit[3]]),floors={};
   for(let f=floor;f<=9;f++){
    const kept=hits.filter(h=>h[2]>=f),q=new Set(kept.map(h=>h[0])),p=new Set(kept.map(h=>h[1]));
    floors['m'+f]={pairs:kept.length,query_windows:q.size,source_windows:p.size,query_loci:MimicryResidueCoverage.overlapGroups(q),source_loci:MimicryResidueCoverage.overlapGroups(p)};
   }
   const provenance=events.map((e,index)=>({hit_index:index,contributions:[...e.contributions.values()].map(c=>{
    const key=JSON.stringify(c);if(!interned.has(key))interned.set(key,c);return interned.get(key);
   })}));
   source_catalog.push(source);results.push({query:plan.query,source,best_identity:hits.reduce((n,h)=>Math.max(n,h[2]),0),floors,
    positions:'included',hits_schema:['query_start','source_start','identity','query_9mer','source_9mer'],hits,hit_provenance:provenance});
  }
  results.sort((a,b)=>b.best_identity-a.best_identity||String(a.source.seqid).localeCompare(String(b.source.seqid)));
  source_catalog.sort((a,b)=>Number(a.protein_idx)-Number(b.protein_idx));
  send({type:'complete',payload:{schema:'mimicryone/analysis-scan/1',job_id:'local-mapped-'+Date.now(),
   release_fingerprint:data.release,component_key:data.component,request:data.request,query_records:[plan.query],
   target:{...data.request.target,entity_level:'analysis_catalog_antigen',entity_label:'assay antigens',comparison:plan.comparison},
   source_catalog,results,result_count:results.length,execution:{mode:'browser_local_mapped',complete:true,positional_hits_included:true,aggregate_counts_exact:true},
   contract:{positions_complete:true,truncation:false,event_semantics:'unique_query_start_source_start_coordinate_pairs'}}});
 }catch(error){send({type:'error',message:error.message});}
};
