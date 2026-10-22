'use strict';
// Shared sink for native matches, portable matches and existing developer data.
// Callers supply exact pair unions; CSV display rounding never enters this path.
const unified=require('./unified-mapping.cjs'),coverage=require('./residue-coverage.js'),regions=require('./pair-regions.cjs');
const identity=require('../mimicryone-identity.js');
// One bit per residue retains all-match unions without saving subthreshold pairs.
// Buffers are allocated once per side/floor, not once per matching pair.
function unionCollector(db){
 const sides=[0,1].map(side=>{
  const rows=db.prepare('SELECT id,length FROM sequence_records WHERE side=? ORDER BY id').all(side);
  const ids=Int32Array.from(rows,r=>r.id),lengths=Uint32Array.from(rows,r=>r.length),offsets=new Uint32Array(rows.length);
  const max=ids.at(-1)||0,dense=max<=rows.length*4+100000,lookup=dense?new Int32Array(max+1).fill(-1):new Map();let bytes=0;
  for(let i=0;i<rows.length;i++){offsets[i]=bytes;bytes+=Math.ceil(lengths[i]/8);if(dense)lookup[ids[i]]=i;else lookup.set(ids[i],i);}
  if(bytes>0xffffffff)throw Error('Library union buffer exceeds supported size');
  return {ids,lengths,offsets,bytes,index:id=>dense?lookup[id]:lookup.get(id)};
 });
 const floors=new Map(),evaluated=new Set();
 function add(side,id,floor,runs){
  const layout=sides[side],index=layout.index(id);
  if(index===undefined||index<0)throw Error('Unknown union record');
  let buffers=floors.get(floor);if(!buffers){buffers=sides.map(s=>({bits:new Uint8Array(s.bytes),seen:new Uint8Array(s.ids.length)}));floors.set(floor,buffers);}
  const {bits,seen}=buffers[side],offset=layout.offsets[index],length=layout.lengths[index];
  for(const [a,b]of runs){
   if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>length)throw Error('Invalid library union interval');
   const lo=(a-1)>>>3,hi=(b-1)>>>3,left=(255<<((a-1)&7))&255,right=255>>>(7-((b-1)&7));
   if(lo===hi)bits[offset+lo]|=left&right;
   else{bits[offset+lo]|=left;bits.fill(255,offset+lo+1,offset+hi);bits[offset+hi]|=right;}
   seen[index]=1;
  }
 }
 function ranges(side,index,floor){
  const buffer=floors.get(floor)?.[side];if(!buffer?.seen[index])return [];
  const layout=sides[side],offset=layout.offsets[index],out=[];let start=0;
  for(let i=0;i<layout.lengths[index];i++){
   const set=buffer.bits[offset+(i>>>3)]&(1<<(i&7));
   if(set&&!start)start=i+1;else if(!set&&start){out.push([start,i]);start=0;}
  }
  if(start)out.push([start,layout.lengths[index]]);return out;
 }
 return {add,evaluated,finish(identities){
  const all=evaluated.size===sides[0].ids.length;
  const put=db.prepare('INSERT INTO library_unions VALUES(?,?,?,?,?)'),scope=db.prepare('INSERT INTO library_union_scopes VALUES(?,?,?)');
  db.exec('BEGIN');
  try{for(const side of [0,1])for(const identity of identities){
   if(side&&!all)continue;
   const layout=sides[side];
   for(let i=0;i<layout.ids.length;i++){
    if(!side&&!evaluated.has(layout.ids[i]))continue;
    const runs=ranges(side,i,identity);if(runs.length||!all)put.run(side,layout.ids[i],identity,'',JSON.stringify(runs));
   }
   if(all)scope.run(side,identity,'');
  }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  floors.clear();
 }};
}
function create(db,{collectLibraryUnions=false}={}){
 unified.create(db);
 const record=db.prepare('INSERT INTO sequence_records VALUES(?,?,?,?,?,?,?,?)');
 const alias=db.prepare('INSERT OR IGNORE INTO record_aliases VALUES(?,?,?)');
 const pair=db.prepare('INSERT INTO mapping_pairs VALUES(?,?,?,?,?,?,?,?,?)');
 let pairs=0,unions;
 const collect=()=>unions||(unions=unionCollector(db));
 return {
  record(r,group){
   identity.validateRecord(r.metadata,{source:r.source});
   const metadata={...r.metadata,...(r.normalizedSha256?{normalized_sequence_sha256:r.normalizedSha256}:{}),...(group!==undefined?{membership_group:group}:{})};
   record.run(r.side,r.id,r.source,JSON.stringify(metadata),r.length,r.sha256,r.token,metadata.gene||metadata.name||metadata.protein_id||r.source);
   for(const value of new Set(r.aliases))alias.run(r.side,String(value),r.id);
  },
  pair({a,b,identity,ac,bc,stats_ac=ac,stats_bc=bc,windows=null,targetRanges,parentRanges,ranges}){
   if(collectLibraryUnions){
    if(!targetRanges||!parentRanges){const decoded=regions.unpack(ranges);targetRanges=decoded.target_ranges;parentRanges=decoded.parent_ranges;}
    collect().add(0,a,identity,targetRanges);collect().add(1,b,identity,parentRanges);
   }
   if(ac<10&&bc<10)return false;
   pair.run(a,b,identity,ac,bc,stats_ac,stats_bc,windows,ranges||regions.pack(targetRanges,parentRanges));pairs++;return true;
  },
  completeTarget(id){if(collectLibraryUnions)collect().evaluated.add(id);},
  libraryUnion(side,id,identity,ranges,scope=''){
   const row=db.prepare('SELECT length FROM sequence_records WHERE side=? AND id=?').get(side,id);
   if(!row)throw Error('Unknown union record');
   db.prepare('INSERT INTO library_unions VALUES(?,?,?,?,?)').run(side,id,identity,scope,JSON.stringify(coverage.union(ranges,row.length)));
  },
  get pairs(){return pairs;},
  finish({floors,prepareIndexes=true,overviews=true},report=()=>{}){
   if(collectLibraryUnions){report({phase:'Saving complete library coverage',done:0,total:0});collect().finish(floors);}
   if(prepareIndexes){report({phase:'Preparing mapping lookups',done:0,total:0});unified.prepare(db);}
   if(!overviews)return;
   const put=db.prepare('INSERT INTO overviews VALUES(?,?,?,?,?)');
   const length=db.prepare('SELECT length FROM sequence_records WHERE side=? AND id=?');
   for(const side of [0,1])for(const identity of floors){
    const {own,other}=unified.columns(side);let id,runs=[],count=0;
    const flush=()=>{if(count)put.run(side,id,identity,JSON.stringify(coverage.union(runs,length.get(side,id).length)),count);runs=[];count=0;};
    db.exec('BEGIN');
    try{
     for(const row of db.prepare(`SELECT ${own} id,ranges FROM mapping_pairs WHERE identity=? ORDER BY ${own},${other}`).iterate(identity)){
      if(id!==row.id){flush();id=row.id;}runs.push(...regions.unpack(row.ranges,!!side).target_ranges);count++;
     }
     flush();db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    report({phase:'Preparing mapping overview',done:side*floors.length+floors.indexOf(identity)+1,total:2*floors.length});
   }
  },
 };
}
module.exports={create};
