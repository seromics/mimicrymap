'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const meta=require('./metadata.cjs'),core=require('../frontend/reproduce/export-core.js');
const filePath=(directory,c,name)=>path.join(directory,c.overrides?.[name]||name);
async function refresh({directory,output,comparison,targetDirectory,parentDirectory,targetAnnotations,parentAnnotations,labelsUnchanged=false},report=()=>{}){
  fs.mkdirSync(output,{recursive:true});
  if(!labelsUnchanged){
  const tdb=new DatabaseSync(path.join(targetDirectory,'library.sqlite'),{readOnly:true}),pdb=new DatabaseSync(path.join(parentDirectory,'library.sqlite'),{readOnly:true});
  const ta=meta.open(targetAnnotations),pa=meta.open(parentAnnotations),db=new DatabaseSync(path.join(directory,'comparison.sqlite'),{readOnly:true});
  const target=tdb.prepare('SELECT * FROM records WHERE id=?'),parent=pdb.prepare('SELECT * FROM records WHERE id=?');
  const parentCache=new Map();
  const parentAt=id=>{if(!parentCache.has(id)){if(parentCache.size>=4096)parentCache.delete(parentCache.keys().next().value);const r=parent.get(id);if(!r)throw Error('Annotation parent is missing');parentCache.set(id,pa.apply(meta.baseRecord(r,comparison.parent.id)));}return parentCache.get(id);};
  const writer=name=>{const fd=fs.openSync(path.join(output,name),'w');let buffer='';return {append:s=>{buffer+=s;if(buffer.length>1048576){fs.writeSync(fd,buffer);buffer='';}},close:()=>{if(buffer)fs.writeSync(fd,buffer);fs.closeSync(fd);}};};
  const summary=writer('library_summary.csv'),pairs=writer('pair_coverage.csv');
  try{
    const ids=db.prepare('SELECT id FROM results ORDER BY id').iterate();
    // SQLite spills the ordered stream to disk when needed; no copy of full positions.
    db.exec('PRAGMA temp_store=FILE; PRAGMA cache_size=-8192');
    const pairRows=db.prepare('SELECT target,parent,identity,tc,pc FROM pairs ORDER BY target').iterate();
    let pair=pairRows.next();
    let headers,done=0;
    try{for await(const row of meta.csvRows(filePath(directory,comparison,'library_summary.csv'))){
      if(!headers){headers=row;summary.append('\uFEFF'+meta.csvLine(headers));continue;}
      const next=ids.next();if(next.done)throw Error('Summary records do not match saved targets.');
      const source=target.get(next.value.id);if(!source)throw Error('Annotation target is missing');
      const q=ta.apply(meta.baseRecord(source,comparison.target.id)),r=Object.fromEntries(headers.map((h,i)=>[h,row[i]]));
      Object.assign(r,core.summaryIdentity(q));
      const matches=[];
      while(!pair.done&&pair.value.target<=source.id){if(pair.value.target===source.id)matches.push(pair.value);pair=pairRows.next();}
      for(let f=Math.max(7,comparison.floor);f<=9;f++){
        const list=matches.filter(p=>p.identity===f&&(p.tc>=10||p.pc>=10)).map(p=>({...p,record:parentAt(p.parent)}));
        list.sort((a,b)=>b.tc-a.tc||b.pc-a.pc||((a.record.assay_id||a.record.protein_id)<(b.record.assay_id||b.record.protein_id)?-1:(a.record.assay_id||a.record.protein_id)>(b.record.assay_id||b.record.protein_id)?1:0));
        const label='Mimicry Parents at '+f+'/9 with Coverage (%) Parent|Target (>=10% either)';
        r[label]=list.map(p=>core.summaryParentLabel(p.record)+'@'+core.summaryPairPercent(Math.round(p.pc*p.record.length/100),p.record.length)+'|'+core.summaryPairPercent(Math.round(p.tc*q.length/100),q.length)).join(';');
      }
      summary.append(meta.csvLine(headers.map(h=>r[h])));
      if(++done%1000===0)report({phase:'Updating saved annotations',done,total:comparison.targets});
    }if(!ids.next().done)throw Error('Summary is missing saved targets.');}finally{pairRows.return?.();}
    pairs.append(meta.csvLine(['Target record','Target ID','Parent record','Parent ID','Organism','Reference set','Core identity ≥','Target coverage (%)','Parent coverage (%)','Window pairs']));
    for(const r of db.prepare('SELECT * FROM pairs ORDER BY rowid').iterate()){
      const p=parentAt(r.parent),group=p.reference_set||p.organism||comparison.parent.name;
      pairs.append(meta.csvLine([r.target,r.source,r.parent,r.protein,p.organism||'',group,r.identity,r.tc,r.pc,r.pairs]));
    }
  }finally{summary.close();pairs.close();tdb.close();pdb.close();ta.close();pa.close();db.close();}
  }
  for(const [side,file] of [['targets',targetAnnotations],['parents',parentAnnotations]])if(file){
    fs.copyFileSync(file,path.join(output,side+'.annotations.sqlite'));
    fs.copyFileSync(meta.csvFor(file),path.join(output,side+'.annotations.csv'));
  }
  const files={};for(const name of fs.readdirSync(output)){const f=path.join(output,name);files[name]={bytes:fs.statSync(f).size,sha256:await meta.hash(f)};}
  return files;
}
module.exports={refresh,filePath};
