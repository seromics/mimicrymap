'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
function catalog(moduleRoot,override=process.env.SERO_SEQUENCE_PAIRS_ROOT,purpose='matches'){
 const root=override||(moduleRoot&&path.join(moduleRoot,'analysis'));
 if(!root||!fs.existsSync(root))return {root,pairs:[]};
 const entries=[];
 for(const prefix of override?['']:['sequence-pairs','sequence-matches']){
  const folder=path.join(root,prefix);if(!fs.existsSync(folder))continue;
  const cat=path.join(folder,'catalog.json');
  const add=p=>entries.push({...p,file:path.join(prefix,p.file),...(p.lookupFile?{lookupFile:path.join(prefix,p.lookupFile)}:{})});
  if(fs.existsSync(cat))JSON.parse(fs.readFileSync(cat,'utf8')).pairs.forEach(add);
  for(const dir of fs.readdirSync(folder,{withFileTypes:true}))if(dir.isDirectory()){
   const f=path.join(folder,dir.name,'reference.json');if(fs.existsSync(f))add(JSON.parse(fs.readFileSync(f,'utf8')));
  }
 }
 if(purpose==='candidate'){
  const usable=entries.flatMap(p=>!p.featureOnly?[p]:p.candidateFile?[{...p,file:p.candidateFile,featureOnly:false,relationshipsOnly:false}]:[]);
  return {root,pairs:[...new Map(usable.filter(p=>fs.existsSync(file(root,p))).map(p=>[p.id,p])).values()]};
 }
 const merged=new Map();
 for(const p of entries){
  if(!fs.existsSync(file(root,p)))continue;
  const old=merged.get(p.id);
  if(!old){merged.set(p.id,p);continue;}
  if(p.storage==='unified-mapping/1'){merged.set(p.id,p);continue;}
  if(old.storage==='unified-mapping/1')continue;
  const light=p.relationshipsOnly?p:old.relationshipsOnly?old:null,full=p.relationshipsOnly?old:p;
  merged.set(p.id,light?{...light,...(!full.relationshipsOnly?{lookupFile:full.lookupFile||full.file,candidateFile:full.file}:{})}:p);
 }
 return {root,pairs:[...merged.values()]};
}
function file(root,pair){const f=path.resolve(root,pair.file);if(!f.startsWith(path.resolve(root)+path.sep))throw Error('Invalid reference pair path');return f;}
function find(moduleRoot,{sequence,parentHash,targetHash,floor,source}){
 const c=catalog(moduleRoot),sha=createHash('sha256').update(sequence).digest('hex');
 for(const p of c.pairs){
  if(p.relationshipsOnly&&!p.lookupFile)continue;
  if(floor<p.floor)continue;
  const reverse=p.target.sha256===parentHash&&p.parent.sha256!==parentHash;
  if(!reverse&&p.parent.sha256!==parentHash)continue;
  const target=reverse?p.parent:p.target,parent=reverse?p.target:p.parent;
  if((target.sha256===parent.sha256)!==(targetHash===parentHash))continue;
  const lookup=file(c.root,{...p,file:p.lookupFile||p.file});
  const db=new DatabaseSync(lookup,{readOnly:true});
  try{
   const rows=db.prepare('SELECT id,source,metadata FROM sequence_records WHERE side=? AND sha256=?').all(reverse?1:0,sha);
   const exact=rows.find(r=>r.source===source||JSON.parse(r.metadata).protein_id===source);
   const match=exact||(rows.length===1?rows[0]:null);if(!match)continue;
   return {directory:path.dirname(lookup),targetId:match.id,reverse,referenceId:p.id};
  }finally{db.close()}
 }
 return null;
}
module.exports={catalog,file,find};
