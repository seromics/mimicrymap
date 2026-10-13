'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const pkg=require('../frontend/reproduce/summary-package.cjs'),indexer=require('../frontend/reproduce/summary-index.cjs');
const metadata=require('./metadata.cjs'),core=require('../frontend/reproduce/export-core.js');
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
 const [recordsFile,keysFile]=await writeSource({...options,directory});
 const pending=path.join(directory,'.summary-indexes');
 const derived=await indexer.build({source:directory,directory:pending,linkInputs:true},report);
 const original=new DatabaseSync(path.join(directory,'comparison.sqlite'),{readOnly:true});
 try{
  original.prepare('ATTACH DATABASE ? AS rebuilt').run(path.join(pending,'comparison.sqlite'));
  // Verify the exact numeric rows at the supported listing floor before using
  // a derived index. No rounding, sequence lookup or approximate ID join.
  const fields='target,source,parent,protein,organism,identity,tc,pc,pairs';
  if(original.prepare(`SELECT EXISTS(SELECT ${fields} FROM pairs WHERE tc>=10 OR pc>=10 EXCEPT SELECT ${fields} FROM rebuilt.pairs) bad`).get().bad||original.prepare(`SELECT EXISTS(SELECT ${fields} FROM rebuilt.pairs EXCEPT SELECT ${fields} FROM pairs WHERE tc>=10 OR pc>=10) bad`).get().bad)throw Error('CSV-derived memberships differ from matched results; original files retained');
  if(original.prepare('SELECT EXISTS(SELECT alias,target FROM aliases EXCEPT SELECT alias,target FROM rebuilt.aliases) bad').get().bad||original.prepare('SELECT EXISTS(SELECT alias,target FROM rebuilt.aliases EXCEPT SELECT alias,target FROM aliases) bad').get().bad)throw Error('CSV-derived record aliases differ');
 }finally{original.close();}
 const candidateFile=manifest.retainsPositions?'membership-index.sqlite':'comparison.sqlite';
 if(!manifest.retainsPositions)fs.renameSync(path.join(directory,'comparison.sqlite'),path.join(pending,'matched-verification.sqlite'));
 fs.renameSync(path.join(pending,'comparison.sqlite'),path.join(directory,candidateFile));
 fs.renameSync(path.join(pending,'record-matches'),path.join(directory,'record-matches'));
 // Only this owned derivation folder is discarded after equivalence succeeds.
 if(path.dirname(pending)!==path.resolve(directory)||path.basename(pending)!=='.summary-indexes')throw Error('Invalid derivation folder');
 fs.rmSync(pending,{recursive:true,force:true});
 if(manifest.retainsPositions)manifest.candidateFile=candidateFile;
 else {manifest.pairs=derived.pairs;manifest.derivedFromSummary=true;}
 manifest.coverageFloor=10;manifest.floors=derived.floors;
 manifest.summarySource=true;manifest.derivedMembershipPairs=derived.pairs;
 manifest.summaryDerivation={schema:pkg.SCHEMA,sha256:await pkg.hash(path.join(directory,'summary.json')),equivalence:'Exact pair values and record aliases at >=10% either side'};
 return ['summary.json',recordsFile,keysFile,candidateFile,'record-matches/comparison.sqlite','record-matches/comparison.json'];
}
module.exports={finalize,writeSource};
