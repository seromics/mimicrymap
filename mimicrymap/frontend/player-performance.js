/* Session-only Player stage timings and conservative, output-verified routing. */
(function(root){
 'use strict';
 const samples=[],localRuns=new Map(),evidence=new Map(),network=new WeakMap();
 const stable=value=>JSON.stringify(value,function(key,item){
  if(item&&typeof item==='object'&&!Array.isArray(item))return Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]]));
  return item;
 });
 function key(plan,parent,filters,release,policy){
  const query=plan&&plan.liveQuery,stored=plan&&plan.staticQuery;
  if(!plan||!query||query.kind!=='library'||parent.kind!=='library'||
     !Array.isArray(query.antigen_ids)||query.antigen_ids.length!==1||
     (stored&&stable(query)!==stable(stored))||plan.canonicalFallback||plan.forceCanonicalIndex)return null;
  return stable({query,parent,filters:filters||{},component:plan.componentKey,release,policy});
 }
 function remember(map,key,value,limit){map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);}
 function eligibleResult(result){
  if(!result||result.export_details_deferred||!result.complete_in_memory||!Array.isArray(result.positional_matches))return false;
  let count=0;
  for(const row of result.positional_matches){
   count+=(row.hits||[]).length;
   if(count>20000||(row.hit_provenance||[]).some(p=>p&&p.projection))return false;
  }
  return (result.source_catalog||[]).length<=20000&&(result.ranked_matches||[]).length<=20000;
 }
 function exportView(result){
  if(!eligibleResult(result))return null;
  // Retain only bounded export fields, never a whole input population or UI history.
  const view={};
  for(const key of ['protein','parameters','result_id','available_floors','complete_in_memory',
   'presentation_only','source_catalog','ranked_matches','positional_matches'])view[key]=result[key];
  view.inputs={analysis_scan:result.inputs&&result.inputs.analysis_scan};
  return view;
 }
 function signature(result,floor){
  if(!eligibleResult(result))return null;
  const data=root.MimicryExportCore.tables(result,floor,null);
  return String(result.protein.sequence)+'\u0000'+data.matchesCsv+'\u0000'+data.parentsCsv;
 }
 function record(info){
  const sample={route:info.route,floor:info.floor,cached:!!info.cached,paint_observed:info.painted!==false,total_ms:info.total_ms,stages:info.stages};
  samples.push(sample);if(samples.length>64)samples.shift();
  if(!info.key||info.painted===false)return;
  if(info.route==='browser'){
   const view=exportView(info.result);
   if(!view){localRuns.delete(info.key);return;}
   remember(localRuns,info.key,{result:view,floor:info.floor,
    milliseconds:info.total_ms-(info.stages.inputs_ms||0),at:Date.now()},3);
  }else if(info.route==='precomputed'&&!info.cached&&info.stages.server_cache==='hit'){
   const local=localRuns.get(info.key);
   if(!local||local.floor>info.floor||Date.now()-local.at>300000)return;
   const start=performance.now();
   try{
    const expected=signature(info.result,info.floor),actual=signature(local.result,info.floor);
    const qualification=performance.now()-start;
    sample.equivalence_check_ms=qualification;
    if(expected!==null&&actual===expected){
     remember(evidence,info.key+'|'+info.floor,{at:Date.now(),
      local_ms:local.milliseconds+qualification,server_ms:info.total_ms},32);
    }else evidence.delete(info.key+'|'+info.floor);
   }catch(error){evidence.delete(info.key+'|'+info.floor);}
  }
 }
 function prefer(key,floor,inputsLoaded,resultCached){
  const known=evidence.get(key+'|'+floor);
  return !!(key&&inputsLoaded&&!resultCached&&known&&Date.now()-known.at<300000&&known.local_ms<known.server_ms*0.8);
 }
 function afterPaint(callback){
  let done=false;const finish=painted=>{if(!done){done=true;callback(painted);}};
  const timer=setTimeout(()=>finish(false),1000);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);finish(true);}));
 }
 root.MimicryPerformance={network,key,record,prefer,afterPaint,
  snapshot:()=>({samples:samples.map(row=>({...row,stages:{...row.stages}})),qualifiedRoutes:evidence.size}),
  clear:()=>{samples.length=0;localRuns.clear();evidence.clear();}};
})(typeof globalThis!=='undefined'?globalThis:this);
