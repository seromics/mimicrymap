/* Coordinate aggregation only. Inclusive, 1-based intervals; no sequence matching. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.MimicryResidueCoverage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function union(intervals,length){
  if(!Number.isSafeInteger(length)||length<0)throw Error('Invalid record length');
  const sorted=intervals.map(([a,b])=>{
   if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<1||b<a||b>length)throw Error('Invalid coverage interval');
   return [a,b];
  }).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),merged=[];
  for(const interval of sorted){
   const last=merged[merged.length-1];
   if(last&&interval[0]<=last[1]+1)last[1]=Math.max(last[1],interval[1]);
   else merged.push(interval);
  }
  return merged;
 }
 const size=intervals=>intervals.reduce((sum,[a,b])=>sum+b-a+1,0);
 function complement(intervals,length){
  const out=[];let next=1;
  for(const [a,b]of union(intervals,length)){if(a>next)out.push([next,a-1]);next=b+1;}
  if(next<=length)out.push([next,length]);return out;
 }
 // Legacy summary field: overlap-connected cores, matching server _loci_count.
 // Touching intervals have the same residue union but remain separate groups.
 function overlapGroups(starts){
  const sorted=[...new Set(starts)].sort((a,b)=>a-b);let count=0,end=-Infinity;
  for(const start of sorted){
   if(!Number.isSafeInteger(start)||start<1)throw Error('Invalid core start');
   if(start>end)count++;end=Math.max(end,start+8);
  }
  return count;
 }
 function measure(starts,length){
  const intervals=union(Array.from(starts,start=>[start,start+8]),length);
  // Current native/local scanners evaluate every sliding window, including X.
  // Short records have no eligible core; do not assign them 0% coverage.
  const eligibleResidues=length>=9?length:0,coveredResidues=size(intervals);
  return {intervals,coveredResidues,eligibleResidues,percent:eligibleResidues?100*coveredResidues/eligibleResidues:null};
 }
 function summarize(result,floor){
  if(!Number.isInteger(floor)||floor<5||floor>9)throw Error('Invalid coverage threshold');
  if(result.presentation_only||!result.available_floors?.includes(floor))throw Error('Complete selected-threshold coordinates are required');
  const contract=result.inputs?.analysis_scan?.completeness_contract;
  if(result.complete_in_memory===false||contract?.truncation||contract?.positions_complete===false)throw Error('Incomplete coverage result');
  const targetLength=Number(result.protein.length??result.protein.sequence.length);
  const catalog=new Map(result.source_catalog.map(p=>[Number(p.protein_idx),p]));
  const targets=[],parents=[],seenSources=new Set();
  for(const row of result.positional_matches){
   const key=Number(row.protein_idx),source=catalog.get(key);
   if(!source||seenSources.has(key))throw Error('Missing or duplicate coverage parent');
   seenSources.add(key);
   const columns=row.hits_columns||['target_start','source_start','identity'];
   const qi=columns.indexOf('target_start'),pi=columns.indexOf('source_start'),hi=columns.indexOf('identity');
   if(Math.min(qi,pi,hi)<0)throw Error('Unrecognized coordinate columns');
   const qs=new Set(),ps=new Set(),pairs=new Map();
   for(const h of row.hits){
    if(!Number.isInteger(h[hi])||h[hi]<5||h[hi]>9)throw Error('Invalid event identity');
    if(h[hi]<floor)continue;
    const pair=h[qi]+':'+h[pi];
    if(pairs.has(pair)&&pairs.get(pair)!==h[hi])throw Error('Conflicting duplicate event');
    qs.add(h[qi]);ps.add(h[pi]);pairs.set(pair,h[hi]);
   }
   const target=measure(qs,targetLength),parent=measure(ps,Number(source.length));
   targets.push(...target.intervals);
   parents.push({proteinIndex:key,proteinId:source.protein_id,target,parent,coordinatePairs:pairs.size});
  }
  const intervals=union(targets,targetLength),eligibleResidues=targetLength>=9?targetLength:0;
  return {schema:'mimicryone/residue-coverage/1',floor,
   target:{intervals,coveredResidues:size(intervals),eligibleResidues,percent:eligibleResidues?100*size(intervals)/eligibleResidues:null},
   parents,
   // The catalog can contain hit-bearing records only. Never fabricate a library denominator.
   parentLibrary:{coveredResidues:parents.reduce((n,p)=>n+p.parent.coveredResidues,0),eligibleResidues:null,percent:null,state:'requires_complete_population'},
   policy:'Union of qualifying 9-mer cores, including mismatch positions; overlapping residues count once. All evaluated sliding-window positions are eligible. Not statistical significance.'};
 }
 return {union,complement,size,measure,summarize,overlapGroups};
});
