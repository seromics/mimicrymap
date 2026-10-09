/* Coordinate mapping of locally computed child-record hits. No matching implementation. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.MimicryProjectedEvents=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const cdi=header=>{const id=String(header||'').split('|')[0];return /^CDI9[A-Z]\d{7}$/.test(id)?id:null;};
 function* steps(plan,floor){
  if(plan.schema!=='mimicryone/reproduction-projections/1'||plan.complete!==true||
     plan.selection_basis!=='complete_selected_input_page_not_hit_candidates'||
     plan.pair_policy!=='exclude_identical_native_record')throw Error('Complete selected input mappings are required');
  const entities=new Map(plan.parent_entities.map(r=>[String(r.protein_idx),r]));
  if(entities.size!==plan.parent_entities.length)throw Error('Duplicate output record mapping');
  const groups=new Map();
  function validate(child,mapping,parent){
   if(!parent||!Number.isSafeInteger(mapping.start0)||!Number.isSafeInteger(mapping.end0)||
      mapping.start0<0||mapping.end0>parent.sequence.length||mapping.end0-mapping.start0!==child.sequence.length||
      parent.sequence.slice(mapping.start0,mapping.end0)!==child.sequence)throw Error('Input tile does not match its declared protein coordinates');
  }
  if(plan.query_portable_id){
   const covered=new Set();
   for(const query of plan.query_children)for(const mapping of query.mappings){
    validate(query.record,mapping,plan.query);
    for(let start=mapping.start0;start<=mapping.end0-9;start++)covered.add(start);
   }
   if(covered.size!==Math.max(0,plan.query.sequence.length-8))throw Error('Portable target input tiles do not cover every searchable core');
  }
  for(const query of plan.query_children){
   for(const qm of query.mappings)validate(query.record,qm,plan.query);
   const parents=plan.parent_children.filter(p=>p.mappings.length && p.record.antigen_id!==query.record.antigen_id);
   for(const p of parents)for(const m of p.mappings)validate(p.record,m,entities.get(String(m.output_key)));
   const summaries=yield [query.record,parents.map(p=>({...p.record,protein_id:String(p.record.antigen_id)})),floor];
   for(const summary of summaries){
    const parent=parents[summary.protein_index];
    if(!parent)throw Error('Local hit references an absent input record');
    for(const qm of query.mappings)for(const pm of parent.mappings){
     const key=String(pm.output_key),group=groups.get(key)||new Map();groups.set(key,group);
     for(const hit of summary.hits){
      const qs=qm.start0+hit[0],ps=pm.start0+hit[1];
      const qa=query.record.sequence.slice(hit[0]-1,hit[0]+8),pa=parent.record.sequence.slice(hit[1]-1,hit[1]+8);
      if(qa.length!==9||pa.length!==9||plan.query.sequence.slice(qs-1,qs+8)!==qa||entities.get(key).sequence.slice(ps-1,ps+8)!==pa)throw Error('Mapped event does not match its output coordinates');
      const eventKey=qs+':'+ps,item=group.get(eventKey)||{hit:[qs,ps,hit[2],pa],contributions:new Map()};
      if(item.hit[2]!==hit[2])throw Error('Conflicting duplicate mapped event');
      const contribution={query_child:{antigen_id:query.record.antigen_id,seqid:query.record.seqid,
       raw_header:query.record.raw_header,cdi_accession:cdi(query.record.seqid),target_start0:qm.start0,
       target_end0:qm.end0,portable_id:plan.query_portable_id||null},
       source_child:{antigen_id:parent.record.antigen_id,seqid:parent.record.seqid,
        raw_header:parent.record.raw_header,cdi_accession:cdi(parent.record.seqid),
        portable_id:pm.projection?.portable_id||null,target_start0:pm.start0,
        target_end0:pm.projection?.target_end0??parent.record.sequence.length,mapping_status:pm.mapping_status},
       static_edge:{comparison:plan.comparison,query_child_antigen_id:query.record.antigen_id,
        source_child_antigen_id:parent.record.antigen_id,best_identity:summary.best_identity}};
      const ck=JSON.stringify([query.record.antigen_id,qm.start0,parent.record.antigen_id,contribution.source_child.portable_id,pm.start0]);
      item.contributions.set(ck,contribution);group.set(eventKey,item);
     }
    }
   }
  }
  return new Map([...groups].map(([key,events])=>[key,[...events.values()].sort((a,b)=>a.hit[0]-b.hit[0]||a.hit[1]-b.hit[1])]));
 }
 function compute(plan,scan,floor){
  const iterator=steps(plan,floor);let step=iterator.next();
  while(!step.done)step=iterator.next(scan(...step.value));
  return step.value;
 }
 async function computeAsync(plan,scan,floor){
  const iterator=steps(plan,floor);let step=iterator.next();
  while(!step.done)step=iterator.next(await scan(...step.value));
  return step.value;
 }
 return {compute,computeAsync};
});
