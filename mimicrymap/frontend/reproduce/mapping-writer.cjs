'use strict';
// Shared sink for native matches, portable matches and existing developer data.
// Callers supply exact pair unions; CSV display rounding never enters this path.
const unified=require('./unified-mapping.cjs'),coverage=require('./residue-coverage.js'),regions=require('./pair-regions.cjs');
function create(db){
 unified.create(db);
 const record=db.prepare('INSERT INTO sequence_records VALUES(?,?,?,?,?,?,?,?)');
 const alias=db.prepare('INSERT OR IGNORE INTO record_aliases VALUES(?,?,?)');
 const pair=db.prepare('INSERT INTO mapping_pairs VALUES(?,?,?,?,?,?,?,?,?)');
 let pairs=0;
 return {
  record(r,group){
   const metadata={...r.metadata,...(r.normalizedSha256?{normalized_sequence_sha256:r.normalizedSha256}:{}),...(group!==undefined?{membership_group:group}:{})};
   record.run(r.side,r.id,r.source,JSON.stringify(metadata),r.length,r.sha256,r.token,metadata.gene||metadata.name||metadata.protein_id||r.source);
   for(const value of new Set(r.aliases))alias.run(r.side,String(value),r.id);
  },
  pair({a,b,identity,ac,bc,stats_ac=ac,stats_bc=bc,windows=null,targetRanges,parentRanges,ranges}){
   if(ac<10&&bc<10)return false;
   pair.run(a,b,identity,ac,bc,stats_ac,stats_bc,windows,ranges||regions.pack(targetRanges,parentRanges));pairs++;return true;
  },
  get pairs(){return pairs;},
  finish({floors,prepareIndexes=true,overviews=true},report=()=>{}){
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
