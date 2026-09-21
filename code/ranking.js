/* Presentation ordering of existing results. No search or significance scoring. */
(function(root){
 'use strict';
 const defaults={window:'core',parent:'target',direction:'desc'};
 const eventLabels={core:(/*@copy ranking.core-identity.ea7473a*/`Core Identity`/*@endcopy*/),context:(/*@copy ranking.context-identity.65c0e81*/`Context Identity`/*@endcopy*/),blosum:(/*@copy ranking.context-blosum.809bf49*/`Context BLOSUM62`/*@endcopy*/)};
 const parentLabels={target:(/*@copy ranking.target-coverage.2dd5f17*/`Antigen Target Coverage`/*@endcopy*/),parent:(/*@copy ranking.parent-coverage.6a111c2*/`Mimicry Parent Coverage`/*@endcopy*/),core:(/*@copy ranking.best-core-identity.7f98c94*/`Best Core Identity`/*@endcopy*/),context:(/*@copy ranking.best-context-identity.4d7055a*/`Best Context Identity`/*@endcopy*/),protein:(/*@copy ranking.protein.8b7e452*/`Mimicry Parent`/*@endcopy*/)};
 const lexical=(a,b)=>String(a??'')<String(b??'')?-1:String(a??'')>String(b??'')?1:0;
 function settings(value={}){
  return {window:Object.hasOwn(eventLabels,value.window)?value.window:'core',parent:Object.hasOwn(parentLabels,value.parent)?value.parent:'target',direction:value.direction==='asc'?'asc':'desc'};
 }
 function number(a,b,direction='desc'){
  const valid=x=>x!=null&&Number.isFinite(Number(x));
  if(!valid(a))return valid(b)?1:0;
  if(!valid(b))return -1;
  return direction==='asc'?Number(a)-Number(b):Number(b)-Number(a);
 }
 function event(a,b,mode='core'){
  const keys=mode==='context'?['context','blosum','core']:mode==='blosum'?['blosum','core','context']:['core','blosum','context'];
  for(const key of keys){const n=number(a[key],b[key]);if(n)return n;}
  return lexical(a.id,b.id)||number(a.start,b.start,'asc')||number(a.targetStart,b.targetStart,'asc');
 }
 function parent(a,b,value){
  const s=settings(value);
  const primary=s.parent==='protein'?lexical(a.label,b.label)*(s.direction==='asc'?1:-1):number(a[s.parent],b[s.parent],s.direction);
  if(primary)return primary;
  for(const key of ['target','parent','core','context'])if(key!==s.parent){const n=number(a[key],b[key]);if(n)return n;}
  return lexical(a.id,b.id);
 }
 function describe(value){
  const s=settings(value),windowOrder=s.window==='core'?['Core Identity','Context BLOSUM62','Context Identity']:s.window==='context'?['Context Identity','Context BLOSUM62','Core Identity']:['Context BLOSUM62','Core Identity','Context Identity'];
  const coverageMeaning=(/*@copy ranking.coverage-definition*/`Target % and Parent % are covered-residue percentages in the antigen target and mimicry parent, respectively: union of qualifying core residues divided by eligible record length. Overlaps count once; context flanks are excluded.`/*@endcopy*/);
  return {settings:s,window:'Sorted by '+eventLabels[s.window],parent:'Sorted by '+parentLabels[s.parent]+' ('+(s.direction==='asc'?'ascending':'descending')+')',
   window_rules:windowOrder.join(' → ')+'; descending; final ties: Parent identifier, Parent start, Target start ascending.',
   parent_rules:(/*@copy ranking.parent-order-description*/`${parentLabels[s.parent]} ${s.direction==='asc'?'ascending':'descending'}`/*@endcopy*/)+'; ties: '+['target','parent','core','context'].filter(k=>k!==s.parent).map(k=>parentLabels[k]).join(' → ')+' descending; final tie: Parent identifier ascending. Missing values last.'+(['target','parent'].includes(s.parent)?' '+coverageMeaning:''),
   event_csv_order:'Target start, Parent identifier, Parent start ascending; complete coordinate-ordered tables, independent of display ranking.'};
 }
 const api={defaults,settings,event,parent,describe,eventLabels,parentLabels,selection:{...defaults}};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.MimicryRanking=api;
})(typeof globalThis!=='undefined'?globalThis:this);
