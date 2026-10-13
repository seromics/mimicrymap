'use strict';
const {inflateSync}=require('node:zlib');
const regions=require('./pair-regions.cjs');
function overview(db,side,id,identity){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='region_lists'").get())return {};
 const row=db.prepare('SELECT reference_ranges FROM region_lists WHERE side=? AND id=? AND identity=?').get(side,id,identity);
 return row?{reference_ranges:JSON.parse(row.reference_ranges)}:{};
}
// Indexed by source record and threshold. Only the requested neighbour list is
// decompressed; full databases and window-position data never enter the page.
function rows(db,side,id,identity,{offset=0,limit=Infinity}={}){
 const item=db.prepare('SELECT count,payload FROM neighbours WHERE side=? AND id=? AND identity=?').get(side,id,identity);
 if(!item)return [];
 const data=inflateSync(item.payload);
 if(data.length!==item.count*20)throw Error('Invalid record-match payload');
 const out=[];
 for(let i=offset*20;i<Math.min(data.length,(offset+limit)*20);i+=20)out.push({id:data.readUInt32LE(i),reference_coverage:data.readDoubleLE(i+4),match_coverage:data.readDoubleLE(i+12)});
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='region_lists'").get()){
  const row=db.prepare('SELECT payload FROM region_lists WHERE side=? AND id=? AND identity=?').get(side,id,identity);
  if(row){
   const bytes=inflateSync(row.payload),selected=new Map(out.map(r=>[r.id,r]));let count=0;
   for(let p=0;p<bytes.length;){
    if(p+8>bytes.length)throw Error('Invalid range list');
    const other=bytes.readUInt32LE(p),size=bytes.readUInt32LE(p+4);p+=8;
    if(p+size>bytes.length)throw Error('Incomplete range list');
    const match=selected.get(other);
    if(match){const r=regions.unpack(bytes.subarray(p,p+size));match.reference_ranges=r.target_ranges;match.match_ranges=r.parent_ranges;}
    p+=size;count++;
   }
   if(count!==item.count||out.some(r=>!r.reference_ranges))throw Error('Range list differs from record neighbours');
  }
 }
 return out;
}
module.exports={rows,overview};
