'use strict';
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {queryScanner}=require('../frontend/reproduce/seed-match.cjs');
const record=row=>({...JSON.parse(row.metadata),sequence:row.sequence,record_id:row.id});

// The same positional matcher serves protein comparisons and cumulative
// evidence. Index one query, then stream candidates instead of indexing an assay.
function scanOneTarget(parentDirectory,query,floor=7,report=()=>{},candidateIds=null){
 const scan=queryScanner(query.sequence,floor),matches=[];
 const db=new DatabaseSync(path.join(parentDirectory,'library.sqlite'),{readOnly:true});
 try{
  let done=0,last=0;const total=candidateIds?candidateIds.length:db.prepare('SELECT count(*) n FROM records').get().n;
  const checkpoint=()=>{const now=Date.now();if(now-last>=100){last=now;report({phase:'Mapping target',done,total});}};
  const get=db.prepare('SELECT * FROM records WHERE id=?');
  function* selected(){for(const id of candidateIds){const row=get.get(id);if(!row)throw Error('Saved mapping refers to a missing assay sequence');yield row;}}
  for(const row of candidateIds?selected():db.prepare('SELECT * FROM records ORDER BY id').iterate()){
   const hits=[];
   scan(row.sequence,(q,p,identity)=>hits.push([q,p,identity,row.sequence.slice(p-1,p+8)]),checkpoint);
   if(hits.length){hits.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);matches.push({parent:record(row),hits});}
   done++;
  }
  report({phase:'Mapping target',done,total});return matches;
 }finally{db.close();}
}
module.exports={record,scanOneTarget};
