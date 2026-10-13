/* Shared complete 9-residue matching primitives for indexed CPU scans. */
'use strict';
function blocks(floor) {
  if(!Number.isInteger(floor)||floor<5||floor>9)throw Error('Identity must be 5/9–9/9.');
  const n=10-floor;
  return Array.from({length:n},(_,i)=>[Math.floor(9*i/n),Math.floor(9*(i+1)/n)]);
}
function identityAt(a,q,b,p,floor) {
  let n=0;
  for(let i=0;i<9;i++){
    if(a[q+i]===b[p+i]&&/^[ACDEFGHIKLMNPQRSTVWY]$/.test(a[q+i]))n++;
    if(n+8-i<floor)return 0;
  }
  return n;
}
// Index the selected target once; stream candidate sequences without building
// a retained library index. A qualifying window must share one exact seed.
function queryScanner(query,floor) {
  const partition=blocks(floor),indexes=partition.map(()=>new Map());
  for(let q=0;q+9<=query.length;q++)for(let b=0;b<partition.length;b++){
    const [lo,hi]=partition[b],seed=query.slice(q+lo,q+hi);
    if(!/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(seed))continue;
    const positions=indexes[b].get(seed)||[];positions.push(q);indexes[b].set(seed,positions);
  }
  return (parent,onMatch,checkpoint=()=>{})=>{
    for(let p=0;p+9<=parent.length;p++){
      if((p&255)===0)checkpoint();
      const seen=new Set();
      for(let b=0;b<partition.length;b++){
        const [lo,hi]=partition[b];
        for(const q of indexes[b].get(parent.slice(p+lo,p+hi))||[]){
          if(seen.has(q))continue;seen.add(q);
          const identity=identityAt(query,q,parent,p,floor);
          if(identity)onMatch(q+1,p+1,identity);
        }
      }
    }
  };
}
module.exports={blocks,identityAt,queryScanner};
