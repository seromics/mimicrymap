'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const directory=root=>path.join(root,'CustomEnrichment');
const cache=new Map();
const valid=id=>{if(!/^[a-z0-9-]{1,100}$/i.test(id||''))throw Error('Choose an installed custom collection');return id};
function list(root){
 const dir=directory(root);if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir).filter(n=>n.endsWith('.meta.json')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'))).sort((a,b)=>a.name.localeCompare(b.name));
}
function read(root,id){const file=path.join(directory(root),valid(id)+'.json.gz');if(!fs.existsSync(file))throw Error('This custom enrichment collection is no longer installed. Choose another reference collection.');const stamp=fs.statSync(file).mtimeMs,saved=cache.get(file);if(saved?.stamp===stamp)return saved.value;const value=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));if(cache.size>=2)cache.delete(cache.keys().next().value);cache.set(file,{stamp,value});return value;}
function save(root,value){
 const id=value.id||crypto.randomUUID(),dir=directory(root);valid(id);fs.mkdirSync(dir,{recursive:true});
 const revision=crypto.createHash('sha256').update(JSON.stringify({...value,id,revision:undefined})).digest('hex'),out={...value,id,revision};
 const file=path.join(dir,id+'.json.gz'),meta=path.join(dir,id+'.meta.json'),tmp=file+'.'+crypto.randomUUID()+'.partial',mtmp=meta+'.partial';
 try{fs.writeFileSync(tmp,zlib.gzipSync(JSON.stringify(out)));fs.renameSync(tmp,file);cache.delete(file);const {name,base,sourceRevision,layerNames,floor,terms,records,refinements=[]}=out;fs.writeFileSync(mtmp,JSON.stringify({id,name,base,revision,sourceRevision,layerNames,floor,categories:terms.length,proteins:records.length,refinements:refinements.map(({id,name})=>({id,name}))}));fs.renameSync(mtmp,meta)}finally{for(const f of [tmp,mtmp])if(fs.existsSync(f))fs.unlinkSync(f)}return out;
}
function remove(root,id){const value=read(root,id),file=path.join(directory(root),valid(id)+'.json.gz');fs.unlinkSync(file);cache.delete(file);fs.rmSync(path.join(directory(root),id+'.meta.json'),{force:true});return {removed:value.name};}
module.exports={list,read,save,remove};
