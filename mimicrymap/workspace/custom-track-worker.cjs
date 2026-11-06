'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {csvRows,csvLine}=require('./metadata.cjs'),store=require('./custom-tracks.cjs');
async function customTracks(value){
 process.env.SERO_MIMICRY_WORKSPACE=value.root;if(value.moduleRoot)process.env.SERO_DESKTOP_MODULE_ROOT=value.moduleRoot;
 const server=path.resolve(__dirname,'../../atlas/viewer/server'),shared=path.resolve(server,'../shared');
 const {customTrackSource,customSourceStamp}=await import(pathToFileURL(path.join(server,'customTrackSource.js')));
 const {compileCustomTracks,customTrackColumns,customTrackInstructions}=await import(pathToFileURL(path.join(shared,'customEnrichment.js')));
 if(value.operation==='remove')return store.remove(value.root,value.id);
 const existing=value.id?store.read(value.root,value.id):null,base=existing?.base||value.base;
 if(!base||!['human','viral120','exposure','workspace'].includes(base.mode))throw Error('Choose a reference library.');
 const source=customTrackSource(base);
 if(value.operation==='export'){
  let rows=existing?.rows||source.records;
  if(existing){const assigned=new Set(rows.map(r=>r.reference_id));rows=[...rows,...source.records.filter(r=>!assigned.has(r.reference_id))]}
  if(!existing&&value.seed==='species'){const {referenceSpeciesRows}=await import(pathToFileURL(path.join(server,'customTrackSource.js')));rows=referenceSpeciesRows(source.records,value.moduleRoot)}
  if(!existing&&value.seed&&base.mode==='human'){
   const {humanCategoryCollection}=await import(pathToFileURL(path.join(server,'humanCategoryCatalog.js'))),{humanCategoryDisplayGraph}=await import(pathToFileURL(path.join(server,'humanCategoryHierarchy.js'))),c=humanCategoryCollection({mode:'human',annotation:{ontology:value.seed.ontology,set:value.seed.set},...(value.seed.refine?{refine:value.seed.refine}:{})});
   if(!c)throw Error('Choose an installed category template.');
   const byId=new Map(source.records.map(r=>[r.reference_id,r]));
   const graph=humanCategoryDisplayGraph(c),parents=new Map(),depths=new Map();for(const r of graph.routes)r.path.forEach((id,i)=>{parents.set(id,i?r.path[i-1]:'');depths.set(id,i+1)});
   rows=graph.terms.filter(t=>parents.has(t.id)).flatMap(t=>t.proteins.map(i=>({...byId.get(c.proteins[i]),category_id:t.id,category_name:t.name,parent_id:parents.get(t.id),layer_name:c.elevatedTerms?['Elevated','Enriched','Refined Categories'][depths.get(t.id)-1]:'Category'}))).filter(r=>r.reference_id);
   const assigned=new Set(rows.map(r=>r.reference_id));rows.push(...source.records.filter(r=>!assigned.has(r.reference_id)));
  }
  await fs.writeFile(value.destination,'\uFEFF'+csvLine(customTrackColumns)+rows.map(r=>csvLine(customTrackColumns.map(k=>r[k]||''))).join(''),'utf8');
  await fs.writeFile(value.destination.replace(/\.csv$/i,'')+'-README.txt',customTrackInstructions,'utf8');
  return {manifest:value.destination,proteins:source.records.length};
 }
 const rows=[];let columns;
 for await(const row of csvRows(value.source)){
  if(!columns){columns=row.map(s=>s.trim().toLowerCase());if(new Set(columns).size!==columns.length||!columns.includes('category_id')||columns.some(k=>!customTrackColumns.includes(k)))throw Error('Use the exported custom track manifest columns.');continue}
  if(row.every(v=>!v.trim()))continue;
  if(row.length!==columns.length)throw Error(`Row ${rows.length+2} has an unexpected number of columns.`);
  rows.push(Object.fromEntries(columns.map((k,i)=>[k,row[i].trim()])));
 }
 const name=String(value.name||existing?.name||'').trim();if(!name||name.length>160)throw Error('Enter a collection name (up to 160 characters).');
 const compiled=compileCustomTracks(rows,source.records,{name});
 const saved=store.save(value.root,{...compiled,id:existing?.id,name,base,floor:source.floor,sourceRevision:customSourceStamp(source)});
 return {collection:saved.id,categories:saved.terms.length,proteins:new Set(saved.terms.flatMap(t=>t.proteins)).size};
}
module.exports={customTracks};
