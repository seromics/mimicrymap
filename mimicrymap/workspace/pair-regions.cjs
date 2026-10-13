'use strict';
// Independent residue unions on each sequence, not window correspondences.
const coverage=require('../frontend/reproduce/residue-coverage.js');
const FORMAT='merged-residue-ranges/1';
function fromHits(hits,targetLength,parentLength,floor){
 const selected=hits.filter(h=>h[2]>=floor);
 return {target:coverage.measure(selected.map(h=>h[0]),targetLength),parent:coverage.measure(selected.map(h=>h[1]),parentLength)};
}
function pack(target,parent){
 const out=[];
 const put=n=>{if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)throw Error('Invalid range integer');do{const rest=Math.floor(n/128);out.push(n%128+(rest?128:0));n=rest;}while(n)};
 for(const ranges of [target,parent]){put(ranges.length);let end=0;for(const [a,b]of ranges){if(a<=end||b<a)throw Error('Invalid merged range');put(a-end);put(b-a);end=b;}}
 return Buffer.from(out);
}
function unpack(bytes,reverse=false){
 let pos=0;
 const get=()=>{let n=0,scale=1,b;do{if(pos>=bytes.length||scale>0x10000000)throw Error('Invalid range payload');b=bytes[pos++];n+=(b&127)*scale;scale*=128;}while(b&128);if(n>0xffffffff)throw Error('Invalid range integer');return n;};
 const lists=[];for(let side=0;side<2;side++){const n=get(),ranges=[];let end=0;if(n>bytes.length)throw Error('Invalid range count');for(let i=0;i<n;i++){const a=end+get(),b=a+get();if(a<=end)throw Error('Invalid range order');ranges.push([a,b]);end=b;}lists.push(ranges);}
 if(pos!==bytes.length)throw Error('Trailing range data');
 return {target_ranges:lists[reverse?1:0],parent_ranges:lists[reverse?0:1]};
}
const text=ranges=>ranges.map(([a,b])=>a+'..'+b).join(',');
module.exports={FORMAT,fromHits,pack,unpack,text};
