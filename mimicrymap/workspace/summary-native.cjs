'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const pkg=require('../frontend/reproduce/summary-package.cjs'),indexer=require('../frontend/reproduce/summary-index.cjs');
const metadata=require('./metadata.cjs'),core=require('../frontend/reproduce/export-core.js');
function start(db,{targetDirectory,parentDirectory,targetAnnotations,parentAnnotations,target,parent}){
 const writer=require('../frontend/reproduce/mapping-writer.cjs').create(db);
 for(const [side,folder,annotation,library]of [[0,targetDirectory,targetAnnotations,target],[1,parentDirectory,parentAnnotations,parent]]){
  const source=new DatabaseSync(path.join(folder,'library.sqlite'),{readOnly:true}),overlay=metadata.open(annotation);
  try{
   db.exec('BEGIN');let n=0;
   for(const row of source.prepare('SELECT * FROM records ORDER BY id').iterate()){
    const value=overlay.apply({...JSON.parse(row.metadata),record_id:row.id,sequence:row.sequence});
    writer.record(pkg.record(side,row,value),library.name);
    if(++n%10000===0)db.exec('COMMIT;BEGIN');
   }
   db.exec('COMMIT');
  }finally{source.close();overlay.close();}
 }
 return writer;
}
async function writeSource({manifest,directory,targetDirectory,parentDirectory,targetAnnotations,parentAnnotations,previousRecords}){
 directory=path.resolve(directory);
 const recordsFile='summary-records.jsonl',keysFile='summary-keys.jsonl',fd=fs.openSync(path.join(directory,recordsFile),'w');
 const previous=previousRecords?pkg.jsonLines(previousRecords)[Symbol.asyncIterator]():null;
 try{
  for(const [side,folder,annotation]of [[0,targetDirectory,targetAnnotations],[1,parentDirectory,parentAnnotations]]){
   const db=new DatabaseSync(path.join(folder,'library.sqlite'),{readOnly:true}),overlay=metadata.open(annotation);let buffer='';
   try{for(const row of db.prepare('SELECT * FROM records ORDER BY id').iterate()){
    const prior=previous?(await previous.next()).value:null;
    if(previous&&(!prior||prior.side!==side||prior.id!==row.id))throw Error('Previous summary roster differs from the library');
    const value=overlay.apply({...prior?.metadata,...JSON.parse(row.metadata),record_id:row.id,sequence:row.sequence}),r=pkg.record(side,row,value);
    if(prior){
     if((prior.normalizedSha256||prior.sha256)!==r.sha256)throw Error('Annotation update changed a summary sequence');
     r.normalizedSha256=r.sha256;r.sha256=prior.sha256;
     r.aliases=[...new Set([...prior.aliases,...r.aliases])];
    }
    if(side===1)r.label=core.summaryParentLabel(value);
    buffer+=JSON.stringify(r)+'\n';if(buffer.length>1048576){fs.writeSync(fd,buffer);buffer='';}
   }if(buffer)fs.writeSync(fd,buffer);}finally{db.close();overlay.close();}
  }
  if(previous&&!(await previous.next()).done)throw Error('Previous summary roster has extra records');
 }finally{fs.closeSync(fd);}
 const floors=manifest.floors||Array.from({length:10-manifest.floor},(_,i)=>manifest.floor+i),inputs={target:'inputs/targets.fasta',parent:'inputs/parents.fasta'};
 if(targetAnnotations)inputs.targetAnnotations='inputs/targets.annotations.csv';if(parentAnnotations)inputs.parentAnnotations='inputs/parents.annotations.csv';
 await pkg.seal(directory,{id:manifest.id,name:manifest.name,csv:'library_summary.csv',recordsFile,keysFile,inputs,floors,target:manifest.target,parent:manifest.parent,rows:manifest.targets,complete:manifest.complete,targetId:manifest.targetId});
 return [recordsFile,keysFile];
}
async function finalize(options,report=()=>{}){
 const {manifest}=options,directory=path.resolve(options.directory);
 // Newly built comparisons already contain the final mapping database. The
 // CSV compiler below only resumes older completed positional checkpoints.
 if(manifest.mappingStorage==='unified-mapping/1')return [manifest.candidateFile||'comparison.sqlite'];
 report({phase:'Preparing mapping records',done:0,total:0});
 const [recordsFile,keysFile]=await writeSource({...options,directory});
 const pending=path.join(directory,'.summary-indexes');
 const derived=await indexer.build({source:directory,directory:pending,linkInputs:true},report);
 report({phase:'Finalizing mapping database',done:0,total:0});
 const original=new DatabaseSync(path.join(directory,'comparison.sqlite'),{readOnly:true});
 try{
  original.prepare('ATTACH DATABASE ? AS rebuilt').run(path.join(pending,'comparison.sqlite'));
  // Verify the exact numeric rows at the supported listing floor before using
  // a derived index. No rounding, sequence lookup or approximate ID join.
  const fields='target,source,parent,protein,organism,identity,tc,pc,pairs';
  if(original.prepare(`SELECT EXISTS(SELECT ${fields} FROM pairs WHERE tc>=10 OR pc>=10 EXCEPT SELECT ${fields} FROM rebuilt.pairs) bad`).get().bad||original.prepare(`SELECT EXISTS(SELECT ${fields} FROM rebuilt.pairs EXCEPT SELECT ${fields} FROM pairs WHERE tc>=10 OR pc>=10) bad`).get().bad)throw Error('CSV-derived memberships differ from matched results; original files retained');
  // A one-target result keeps the complete input roster in the mapping index,
  // while its positional database contains only the selected target's aliases.
  const rebuiltAliases='SELECT alias,target FROM rebuilt.aliases WHERE target IN (SELECT id FROM main.results)';
  if(original.prepare('SELECT EXISTS(SELECT alias,target FROM aliases EXCEPT '+rebuiltAliases+') bad').get().bad||original.prepare('SELECT EXISTS('+rebuiltAliases+' EXCEPT SELECT alias,target FROM aliases) bad').get().bad)throw Error('CSV-derived record aliases differ');
 }finally{original.close();}
 const candidateFile=manifest.retainsPositions?'membership-index.sqlite':'comparison.sqlite';
 if(!manifest.retainsPositions)fs.renameSync(path.join(directory,'comparison.sqlite'),path.join(pending,'matched-verification.sqlite'));
 fs.renameSync(path.join(pending,'comparison.sqlite'),path.join(directory,candidateFile));
 // Only this owned derivation folder is discarded after equivalence succeeds.
 if(path.dirname(pending)!==path.resolve(directory)||path.basename(pending)!=='.summary-indexes')throw Error('Invalid derivation folder');
 fs.rmSync(pending,{recursive:true,force:true});
 if(manifest.retainsPositions)manifest.candidateFile=candidateFile;
 else {manifest.pairs=derived.pairs;}
 manifest.candidateCoverageFloor=10;manifest.floors=derived.floors;manifest.mappingStorage=derived.storage;
 if(!manifest.retainsPositions){manifest.coverageFloor=10;manifest.storage=derived.storage;manifest.relationshipsOnly=true;manifest.featureOnly=false;}
 manifest.derivedMembershipPairs=derived.pairs;
 // These files are compiler intermediates, not a second downloadable record store.
 for(const file of ['summary.json',recordsFile,keysFile])fs.unlinkSync(path.join(directory,file));
 return [candidateFile];
}
module.exports={start,finalize,writeSource};
