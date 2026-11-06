'use strict';
// Reference membership is independent of assay calls and of display filters.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION=2;
const MANIFEST_FIELDS=['reference_id','reference_name','source_taxid','source_accession','requested_taxid','source_files','protein_count','family','genus','species','status'];
function taxonomyFile(root){return root?path.join(root,'reference','taxonomy','uniprot-taxonomy.sqlite'):null;}
function lineageReader(db){
 const get=db.prepare('SELECT tax_id,parent_tax_id,rank,scientific_name FROM taxa WHERE tax_id=?');
 const retired=db.prepare('SELECT merged_to FROM inactive_taxa WHERE tax_id=?');
 const cache=new Map();
 return taxid=>{
  if(cache.has(taxid))return cache.get(taxid);
  const seen=new Set(),lineage=[];let id=Number(taxid);
  while(id&&!seen.has(id)){
   seen.add(id);const row=get.get(id);
   if(!row){const next=retired.get(id)?.merged_to;if(next){id=Number(next);continue;}break;}
   lineage.push({id:String(row.tax_id),name:row.scientific_name,rank:row.rank});id=row.parent_tax_id;
  }
  cache.set(taxid,lineage);return lineage;
 };
}
function referenceInventory(rows,resolve=()=>[],name='Reference Collection',assignments={},recordSets={}){
 const sets=new Map(),records={},unresolved=new Set();let missingTaxids=0;
 for(const row of rows){
  const original=String(row.taxid||''),originalLineage=original?resolve(original):[],originalTaxon=originalLineage[0];
  const key=recordSets[row.id]||row.reference_set|| (original?`${originalTaxon?.name||row.organism||'Taxon'} [TaxID: ${originalTaxon?.id||original}]`:row.organism||name);
  const assignment=assignments[key],taxid=assignment?.source_taxid||original,lineage=taxid?resolve(taxid):[],taxon=lineage[0];
  let set=sets.get(key);
  if(!set){set={id:key,name:assignment?.reference_name||row.reference_set||originalTaxon?.name||row.organism||key,taxids:new Set(),records:0,lineages:[],files:new Set(),accessions:new Set(),originalTaxids:new Set()};sets.set(key,set);}
  set.taxids.add(taxon?.id||taxid);set.records++;set.lineages.push(lineage);records[row.id]=key;
  set.originalTaxids.add(original);if(row.source_file)set.files.add(row.source_file);
  for(const match of String(row.raw_header||'').matchAll(/\bUP\d{9}\b/g))set.accessions.add(match[0]);
  for(const match of String(row.source_file||'').matchAll(/UP\d{9}/g))set.accessions.add(match[0]);
  if(!taxid)missingTaxids++;else if(!taxon)unresolved.add(taxid);
 }
 const references={};
 for(const set of sets.values()){
  // A named set may span taxa. Only a rank shared by every record is asserted.
  const assignment=assignments[set.id]||{};
  const nodes={member:{id:set.id,name:set.name},records:set.records,taxids:[...set.taxids].filter(Boolean),
    sourceTaxids:[...set.originalTaxids].filter(Boolean),sourceFiles:assignment.source_files?[assignment.source_files]:[...set.files],
    sourceAccession:assignment.source_accession||[...set.accessions].join('; '),requestedTaxid:assignment.requested_taxid||''};
  for(const rank of ['family','genus','species']){
   const found=set.lineages.map(l=>l.find(n=>n.rank===rank)),first=found[0];
   nodes[rank]=first&&found.every(n=>n?.id===first.id)?{id:first.id,name:first.name}:null;
  }
  references[set.id]=nodes;
 }
 return {version:VERSION,name,references,records,assignments,summary:{sets:sets.size,records:Object.keys(records).length,missingTaxids,unresolvedTaxids:[...unresolved]}};
}
function manifestRows(inventory){
 return Object.entries(inventory.references).map(([id,r])=>({reference_id:id,reference_name:r.member.name,
  source_taxid:r.taxids.length===1?r.taxids[0]:'',source_accession:r.sourceAccession||'',requested_taxid:r.requestedTaxid||'',source_files:(r.sourceFiles||[]).join('; '),
  protein_count:r.records,family:r.family?.name||'',genus:r.genus?.name||'',species:r.species?.name||'',
  status:!r.taxids.length?'Missing TaxID':!r.species&&!r.genus&&!r.family?'Unresolved TaxID':r.taxids.length>1?'Multiple TaxIDs':!r.genus?'Genus Unassigned':'Resolved'}));
}
function manifestCsv(inventory){const {csvLine}=require('./metadata.cjs');return '\uFEFF'+csvLine(MANIFEST_FIELDS)+manifestRows(inventory).map(r=>csvLine(MANIFEST_FIELDS.map(k=>r[k]))).join('');}
async function readManifest(file){
 const {csvRows}=require('./metadata.cjs');const rows=[];let headers;
 for await(const row of csvRows(file)){
  if(!headers){headers=row.map(v=>v.trim().toLowerCase());if(!headers.includes('reference_id')||new Set(headers).size!==headers.length||headers.some(k=>!MANIFEST_FIELDS.includes(k)))throw Error('Use the Reference Manifest CSV exported by this library.');continue;}
  if(row.length!==headers.length)throw Error('A reference manifest row has the wrong number of columns.');
  rows.push(Object.fromEntries(headers.map((k,i)=>[k,row[i].trim()])));
 }
 if(!rows.length)throw Error('The reference manifest is empty.');return rows;
}
function validateAssignments(rows,inventory,resolve){
 if(!Array.isArray(rows)||!rows.length||rows.length>Object.keys(inventory.references).length)throw Error('Choose reference manifest rows from this library.');
 const assignments={...inventory.assignments},seen=new Set();
 for(const row of rows){
  const id=row.reference_id;if(!Object.hasOwn(inventory.references,id)||seen.has(id))throw Error('Unknown or repeated Reference ID: '+id);seen.add(id);
  const next={...assignments[id]};
  for(const key of ['reference_name','source_taxid','source_accession','requested_taxid','source_files']){
   if(!Object.hasOwn(row,key))continue;
   const value=String(row[key]??'').trim();if(value.length>1000||/[\x00-\x1f]/.test(value))throw Error('Invalid '+key+' for '+id);
   if(key==='reference_name'&&!value)throw Error('Enter a reference name for '+id);
   if(key.endsWith('taxid')&&value&&!/^[1-9]\d*$/.test(value))throw Error('Enter one positive Source TaxID for '+id);
   next[key]=value;
  }
  assignments[id]=next;
 }
 return assignments;
}
function prepareReferenceTaxonomy({directory,annotations,moduleRoot,name,revision,previous,rows}){
 const {DatabaseSync}=require('node:sqlite');
 const file=taxonomyFile(moduleRoot),tax=file&&fs.existsSync(file)?new DatabaseSync(file,{readOnly:true}):null;
 const input=new DatabaseSync(annotations,{readOnly:true});
 try{
  const prior=previous&&fs.existsSync(previous)?JSON.parse(fs.readFileSync(previous,'utf8')):null;
  const resolve=tax?lineageReader(tax):undefined;
  const assignments=rows?validateAssignments(rows,prior,resolve):prior?.assignments||{};
  input.prepare('ATTACH DATABASE ? AS sequences').run(path.join(directory,'library.sqlite'));
  const records=input.prepare("SELECT r.id,r.organism,r.taxid,r.reference_set,json_extract(s.metadata,'$.source_file') source_file,json_extract(s.metadata,'$.raw_header') raw_header FROM records r JOIN sequences.records s USING(id) ORDER BY r.id").iterate();
  const inventory=referenceInventory(records,resolve,name,assignments,prior?.annotationRevision===revision?prior.records:{});
  inventory.source=tax?JSON.parse(tax.prepare("SELECT value FROM meta WHERE key='source'").get()?.value||'{}'):null;
  inventory.annotationRevision=revision;
  const content=JSON.stringify(inventory),digest=crypto.createHash('sha256').update(content).digest('hex');
  const relative=path.join('ReferenceSets',digest+'.json'),output=path.join(directory,relative);
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,content+'\n');
  fs.writeFileSync(output.replace(/\.json$/,'.csv'),manifestCsv(inventory));
  return {version:VERSION,file:relative,revision:digest,annotationRevision:revision,taxonomyFile:file,taxonomyMtime:tax?fs.statSync(file).mtimeMs:null,taxonomyAvailable:!!tax,...inventory.summary,preview:manifestRows(inventory).slice(0,100)};
 }finally{input.close();tax?.close();}
}
module.exports={VERSION,MANIFEST_FIELDS,taxonomyFile,lineageReader,referenceInventory,prepareReferenceTaxonomy,manifestRows,manifestCsv,readManifest,validateAssignments};
