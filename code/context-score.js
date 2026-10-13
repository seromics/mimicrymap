/* Shared Player/export context score. No search or match inclusion logic. */
(function(root){
 'use strict';
/* BLOSUM62, ported verbatim from frontend/src/workers/motifWorker.js */
var B62={
  A:{A:4,C:0,D:-2,E:-1,F:-2,G:0,H:-2,I:-1,K:-1,L:-1,M:-1,N:-2,P:-1,Q:-1,R:-1,S:1,T:0,V:0,W:-3,Y:-2},
  C:{C:9,D:-3,E:-4,F:-2,G:-3,H:-3,I:-1,K:-3,L:-1,M:-1,N:-3,P:-3,Q:-3,R:-3,S:-1,T:-1,V:-1,W:-2,Y:-2},
  D:{D:6,E:2,F:-3,G:-1,H:-1,I:-3,K:-1,L:-4,M:-3,N:1,P:-1,Q:0,R:-2,S:0,T:-1,V:-3,W:-4,Y:-3},
  E:{E:5,F:-3,G:-2,H:0,I:-3,K:1,L:-3,M:-2,N:0,P:-1,Q:2,R:0,S:0,T:-1,V:-2,W:-3,Y:-2},
  F:{F:6,G:-3,H:-1,I:0,K:-3,L:0,M:0,N:-3,P:-4,Q:-3,R:-3,S:-2,T:-2,V:-1,W:1,Y:3},
  G:{G:6,H:-2,I:-4,K:-2,L:-4,M:-3,N:0,P:-2,Q:-2,R:-2,S:0,T:-2,V:-3,W:-2,Y:-3},
  H:{H:8,I:-3,K:-1,L:-3,M:-2,N:1,P:-2,Q:0,R:0,S:-1,T:-2,V:-3,W:-2,Y:2},
  I:{I:4,K:-3,L:2,M:1,N:-3,P:-3,Q:-3,R:-3,S:-2,T:-1,V:3,W:-3,Y:-1},
  K:{K:5,L:-2,M:-1,N:0,P:-1,Q:1,R:2,S:0,T:-1,V:-2,W:-3,Y:-2},
  L:{L:4,M:2,N:-3,P:-3,Q:-2,R:-2,S:-2,T:-1,V:1,W:-2,Y:-1},
  M:{M:5,N:-2,P:-2,Q:0,R:-1,S:-1,T:-1,V:1,W:-1,Y:-1},
  N:{N:6,P:-2,Q:0,R:0,S:1,T:0,V:-3,W:-4,Y:-2},
  P:{P:7,Q:-1,R:-2,S:-1,T:-1,V:-2,W:-4,Y:-3},
  Q:{Q:5,R:1,S:0,T:-1,V:-2,W:-2,Y:-1},
  R:{R:5,S:-1,T:-1,V:-3,W:-3,Y:-2},
  S:{S:4,T:1,V:-2,W:-3,Y:-2},
  T:{T:5,V:0,W:-2,Y:-2},
  V:{V:4,W:-3,Y:-1},
  W:{W:11,Y:2},
  Y:{Y:7}
};
var BT=new Int8Array(26*26);
(function(){
  for (var a in B62){ var ai=a.charCodeAt(0)-65;
    for (var b in B62[a]){ var bi=b.charCodeAt(0)-65, v=B62[a][b];
      BT[ai*26+bi]=v; BT[bi*26+ai]=v; } }
})();
/* summed BLOSUM62 across the aligned 27-mer, skipping positions past either protein's end */
function blosum27(a,b,table=BT){
  var t=0;
  for (var i=0;i<a.length && i<b.length;i++){
    var ca=a.charCodeAt(i)-65, cb=b.charCodeAt(i)-65;
    if (ca<0||ca>25||cb<0||cb>25) continue;
    t+=table[ca*26+cb]||0;
  }
  return t;
}
 function at(a,b,targetStart,parentStart){
  const context=(sequence,start)=>Array.from({length:27},(_,i)=>sequence[start-10+i]||'.').join('');
  return blosum27(context(a,targetStart),context(b,parentStart));
 }
 function contextIdentityAt(a,b,q,p){
  if(typeof a!=='string'||typeof b!=='string')return null;
  let matches=0;
  for(let offset=-9;offset<18;offset++){
   const x=a[q-1+offset],y=b[p-1+offset];
   if(x===y&&/^[ACDEFGHIKLMNPQRSTVWY]$/.test(x||''))matches++;
  }
  return matches;
 }
 const api={table:BT,aligned:blosum27,at,identityAt:contextIdentityAt};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.MimicryContextScore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
