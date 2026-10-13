'use strict';
// Lossless runs of consecutive windows on one alignment diagonal. Record IDs,
// repeated placements and individual core identities survive round trips.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const metadata=require('./metadata.cjs');
const crypto=require('node:crypto');

function pack(hits){
  const ordered=hits.map(h=>h.slice(0,3)).sort((a,b)=>(a[1]-a[0])-(b[1]-b[0])||a[0]-b[0]||a[2]-b[2]);
  const runs=[];
  for(const [q,p,n] of ordered){
    const last=runs.at(-1);
    if(last&&last[0]+last[2]-1===q&&last[1]+last[2]-1===p){
      if(last[3]!==n)throw Error('Conflicting identity at the same coordinates');
      continue;
    }
    if(last&&last[0]+last[2]===q&&last[1]+last[2]===p&&last[3]===n)last[2]++;
    else runs.push([q,p,1,n]);
  }
  const bytes=Buffer.allocUnsafe(runs.length*16);
  runs.forEach((r,i)=>r.forEach((n,j)=>bytes.writeUInt32LE(n,i*16+j*4)));
  return bytes;
}
function runs(blob,floor=7,reverse=false){
  const b=Buffer.from(blob.buffer,blob.byteOffset,blob.byteLength),out=[];
  if(b.length%16)throw Error('Invalid positional runs');
  for(let i=0;i<b.length;i+=16){const q=b.readUInt32LE(i),p=b.readUInt32LE(i+4),count=b.readUInt32LE(i+8),identity=b.readUInt32LE(i+12);
    if(identity>=floor)out.push({target_start:reverse?p:q,parent_start:reverse?q:p,windows:count,identity});
  }
  return out;
}
function unpack(blob,sequence,floor=7,reverse=false){
  const hits=[];
  for(const r of runs(blob,floor,reverse))for(let i=0;i<r.windows;i++){
    const q=r.target_start+i,p=r.parent_start+i;hits.push([q,p,r.identity,sequence.slice(p-1,p+8)]);
  }
  return hits.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}
function initialize(db,inputs){
  db.exec('CREATE TABLE sequence_records(side INTEGER,id INTEGER,token TEXT,source TEXT,metadata TEXT,sequence TEXT,sha256 TEXT,PRIMARY KEY(side,id)) WITHOUT ROWID; CREATE TABLE positions(target INTEGER,parent INTEGER,runs BLOB,PRIMARY KEY(target,parent)) WITHOUT ROWID;');
  const put=db.prepare('INSERT INTO sequence_records VALUES(?,?,?,?,?,?,?)');
  for(const [side,directory,annotations] of inputs){
    const source=new DatabaseSync(path.join(directory,'library.sqlite'),{readOnly:true}),overlay=metadata.open(annotations);
    try{db.exec('BEGIN');for(const row of source.prepare('SELECT * FROM records ORDER BY id').iterate()){
      const r=overlay.apply({...JSON.parse(row.metadata),record_id:row.id});
      put.run(side,row.id,row.token,row.source,JSON.stringify(r),row.sequence,crypto.createHash("sha256").update(row.sequence).digest("hex"));
    }db.exec('COMMIT');}finally{source.close();overlay.close();}
  }
  const putMatch=db.prepare('INSERT INTO positions VALUES(?,?,?)');
  return (id,matches)=>{for(const m of matches)putMatch.run(id,m.parent.record_id,pack(m.hits));};
}
function record(db,side,id){const r=db.prepare('SELECT * FROM sequence_records WHERE side=? AND id=?').get(side,id);return r?{...JSON.parse(r.metadata),record_id:r.id,sequence:r.sequence}:null;}
function matches(db,id,floor=7,reverse=false){
  const column=reverse?'parent':'target',other=reverse?'target':'parent',side=reverse?0:1;
  // Start with the matching positions, not every record in the other library.
  // CROSS JOIN preserves this selective lookup even before SQLite has statistics.
  const rows=db.prepare(`SELECT p.runs,r.id,r.metadata,r.sequence FROM positions p ${reverse?'INDEXED BY positions_parent':''} CROSS JOIN sequence_records r ON r.side=${side} AND r.id=p.${other} WHERE p.${column}=? ORDER BY p.${other}`).iterate(id);
  const out=[];
  for(const r of rows){const hits=unpack(r.runs,r.sequence,floor,reverse);if(hits.length)out.push({parent:{...JSON.parse(r.metadata),record_id:r.id,sequence:r.sequence},hits});}
  return out;
}
function finish(db,directory,{floor,id,target,parent,resultFor,summaryTable,report}){
  db.exec('CREATE INDEX IF NOT EXISTS positions_parent ON positions(parent,target); CREATE INDEX IF NOT EXISTS sequence_sources ON sequence_records(side,source); CREATE INDEX IF NOT EXISTS sequence_digest ON sequence_records(side,sha256); CREATE INDEX IF NOT EXISTS reverse_memberships ON pairs(identity,parent,target);');
  // The reverse view shares all pair rows, swapping the two coverage denominators.
  db.exec("CREATE VIEW IF NOT EXISTS reverse_pairs AS SELECT p.parent target,r.source source,p.target parent,t.source protein,json_extract(t.metadata,'$.organism') organism,p.identity,p.pc tc,p.tc pc,p.pairs FROM pairs p JOIN sequence_records r ON r.side=1 AND r.id=p.parent JOIN sequence_records t ON t.side=0 AND t.id=p.target;");
  // Publish only the complete reverse summary; interrupted finalization can restart.
  const pending=path.join(directory,'reverse_summary.csv.partial');
  const fd=fs.openSync(pending,'w');let header=true,done=0,complete=false;
  try{report({phase:'Writing reverse summaries',done:0,total:parent.records});for(const row of db.prepare('SELECT id FROM sequence_records WHERE side=1 ORDER BY id').iterate()){
    const query=record(db,1,row.id),found=matches(db,row.id,floor,true);
    const result=resultFor(query,found,{floor,id:id+':reverse',targetName:parent.name,parentName:target.name,summaryOnly:true});
    const csv=summaryTable(result,[7,8,9].filter(f=>f>=floor)).csv;
    fs.writeSync(fd,header?csv:csv.slice(csv.indexOf('\n')+1));header=false;
    if(++done%100===0)report({phase:'Writing reverse summaries',done,total:parent.records});
  }complete=true;}finally{fs.closeSync(fd);}
  if(complete)fs.renameSync(pending,path.join(directory,'reverse_summary.csv'));
}
module.exports={pack,runs,unpack,initialize,record,matches,finish};
