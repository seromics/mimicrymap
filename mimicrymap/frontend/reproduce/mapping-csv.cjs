'use strict';
// Human-readable exports from saved pairs. Original FASTAs provide sequences;
// record IDs and the database provide labels, exact coverage and residue ranges.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {DatabaseSync}=require('node:sqlite'),core=require('./export-core.js'),regions=require('./pair-regions.cjs');
const unified=require('./unified-mapping.cjs'),input=require('./fasta-input.js');
async function* sequences(file){
 let header='',sequence='';
 const parse=()=>{const r=input.parse('>'+header+'\n'+sequence,'query',1);if(r.errors.length)throw Error(r.errors.join(' '));return r.records[0].sequence;};
 for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){
  const value=line.trim();if(!value)continue;
  if(value.startsWith('>')){if(header)yield parse();header=value.slice(1);sequence='';}else sequence+=value;
 }
 if(header)yield parse();
}
async function write({database,directory,manifest,inputs,forwardFile='library_summary.csv',reverseFile='reverse_summary.csv'},report=()=>{}){
 fs.mkdirSync(directory,{recursive:true});const db=new DatabaseSync(database,{readOnly:true}),files=[];
 const floors=manifest.floors||Array.from({length:10-manifest.floor},(_,i)=>manifest.floor+i);
 try{
  if(!unified.isUnified(db))throw Error('Summary export requires the saved mapping database');
  const fullUnion=unified.libraryUnionReader(db);
  for(const side of [0,1]){
   if(side&&manifest.target.sha256===manifest.parent.sha256)continue;
   const name=side?reverseFile:forwardFile,fd=fs.openSync(path.join(directory,name),'wx');let buffer='',first=true,done=0;
   const records=db.prepare('SELECT * FROM sequence_records WHERE side=? ORDER BY id').iterate(side),seq=sequences(inputs[side])[Symbol.asyncIterator]();
   const parents=new Map(),parentQuery=db.prepare('SELECT * FROM sequence_records WHERE side=? AND id=?');
   const {own,other}=unified.columns(side),pairQuery=db.prepare(`SELECT ${other} id,identity,windows,ranges FROM mapping_pairs WHERE ${own}=? ORDER BY ${other},identity`);
   try{
    for(const r of records){
     const next=await seq.next();if(next.done||next.value.length!==r.length)throw Error('Mapping records do not match their FASTA');
     if(!side&&manifest.targetId!=null&&r.id!==manifest.targetId)continue;
     const groups=floors.map(floor=>({floor,pairs:[],libraryRanges:fullUnion(side,r.id,floor)})),byFloor=new Map(groups.map(g=>[g.floor,g]));
     for(const pair of pairQuery.iterate(r.id)){
      if(!parents.has(pair.id)){if(parents.size>=4096)parents.delete(parents.keys().next().value);const p=parentQuery.get(1-side,pair.id);parents.set(pair.id,{...JSON.parse(p.metadata),length:p.length});}
      const ranges=regions.unpack(pair.ranges,!!side);
      byFloor.get(pair.identity)?.pairs.push({id:pair.id,record:parents.get(pair.id),windowPairs:pair.windows,targetRanges:ranges.target_ranges,parentRanges:ranges.parent_ranges});
     }
     const table=core.summaryFromPairRegions({protein:{...JSON.parse(r.metadata),sequence:next.value,length:r.length},scope:manifest[side?'target':'parent'].name,groups,listedPairPopulation:true});
     buffer+=first?table.csv:table.serialize([table.row]).slice(table.serialize([]).length);first=false;
     if(buffer.length>=1048576){fs.writeSync(fd,buffer);buffer='';}
     if(++done%1000===0)report({phase:side?'Exporting reverse summaries':'Exporting summaries',done,total:manifest[side?'parent':'target'].records});
    }
    if(!(await seq.next()).done)throw Error('FASTA contains records absent from mapping database');
    if(buffer)fs.writeSync(fd,buffer);files.push(name);
   }finally{records.return?.();await seq.return?.();fs.closeSync(fd);}
  }
 }finally{db.close();}
 return files;
}
module.exports={write,sequences};
