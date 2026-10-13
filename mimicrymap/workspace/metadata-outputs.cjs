'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const meta=require('./metadata.cjs'),core=require('../frontend/reproduce/export-core.js');
const regions=require('./pair-regions.cjs');
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
  const summary=writer('library_summary.csv'),pairs=writer('pair_coverage.csv'),keys=comparison.summarySource||comparison.derivedFromSummary?writer('summary-keys.jsonl'):null;
  const hasRegions=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='pair_regions'").get();
  const getRegions=hasRegions?db.prepare('SELECT payload FROM pair_regions WHERE target=? AND parent=? AND identity=?'):null;
  try{
    const ids=db.prepare('SELECT id FROM results ORDER BY id').iterate();
    // SQLite spills the ordered stream to disk when needed; no copy of full positions.
    db.exec('PRAGMA temp_store=FILE; PRAGMA cache_size=-8192');
    const pairRows=db.prepare('SELECT target,parent,identity,tc,pc,pairs FROM pairs ORDER BY target').iterate();
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
      const pairKeys={};
      for(const f of comparison.floors||Array.from({length:10-Math.max(7,comparison.floor)},(_,i)=>Math.max(7,comparison.floor)+i)){
        const list=matches.filter(p=>p.identity===f&&(p.tc>=10||p.pc>=10)).map(p=>({...p,record:parentAt(p.parent)}));
        list.sort((a,b)=>b.tc-a.tc||b.pc-a.pc||((a.record.assay_id||a.record.protein_id)<(b.record.assay_id||b.record.protein_id)?-1:(a.record.assay_id||a.record.protein_id)>(b.record.assay_id||b.record.protein_id)?1:0));
        pairKeys[f]=list.map(p=>[p.parent,p.pairs??null]);
        const label='Mimicry Parents at '+f+'/9 with Coverage (%) Parent|Target (>=10% either)';
        r[label]=list.map(p=>core.summaryParentLabel(p.record)+'@'+core.summaryPairPercent(Math.round(p.pc*p.record.length/100),p.record.length)+'|'+core.summaryPairPercent(Math.round(p.tc*q.length/100),q.length)).join(';');
        const regionLabel='Mimicry Parent Regions at '+f+'/9 Parent|Target (>=10% either)';
        if(headers.includes(regionLabel))r[regionLabel]=list.map(p=>{
          const stored=getRegions?.get(source.id,p.parent,f);if(!stored)throw Error('Saved pair ranges are missing.');
          const value=regions.unpack(stored.payload);
          return core.summaryParentLabel(p.record)+'@'+regions.text(value.parent_ranges)+'|'+regions.text(value.target_ranges);
        }).join(';');
      }
      summary.append(meta.csvLine(headers.map(h=>r[h])));
      keys?.append(JSON.stringify({target:source.id,parents:pairKeys})+'\n');
      if(++done%1000===0)report({phase:'Updating saved annotations',done,total:comparison.targets});
    }if(!ids.next().done)throw Error('Summary is missing saved targets.');}finally{pairRows.return?.();}
    pairs.append(meta.csvLine(['Target record','Target ID','Parent record','Parent ID','Organism','Reference set','Core identity ≥','Target coverage (%)',...(hasRegions?['Target regions (>=10% either)']:[]),'Parent coverage (%)',...(hasRegions?['Parent regions (>=10% either)']:[]),'Window pairs']));
    for(const r of db.prepare('SELECT * FROM pairs ORDER BY rowid').iterate()){
      const p=parentAt(r.parent),group=p.reference_set||p.organism||comparison.parent.name;
      const saved=getRegions?.get(r.target,r.parent,r.identity),value=saved?regions.unpack(saved.payload):null;
      pairs.append(meta.csvLine([r.target,r.source,r.parent,r.protein,p.organism||'',group,r.identity,r.tc,...(hasRegions?[value?regions.text(value.target_ranges):'']:[]),r.pc,...(hasRegions?[value?regions.text(value.parent_ranges):'']:[]),r.pairs]));
    }
  }finally{summary.close();pairs.close();keys?.close();tdb.close();pdb.close();ta.close();pa.close();db.close();}
  }
  for(const [side,file] of [['targets',targetAnnotations],['parents',parentAnnotations]])if(file){
    fs.copyFileSync(file,path.join(output,side+'.annotations.sqlite'));
    fs.copyFileSync(meta.csvFor(file),path.join(output,side+'.annotations.csv'));
  }
  if(comparison.summarySource||comparison.derivedFromSummary){
    const source=path.join(output,'.summary-source'),rebuilt=path.join(output,'.summary-rebuilt');fs.mkdirSync(path.join(source,'inputs'),{recursive:true});
    const link=(from,to)=>{try{fs.linkSync(from,to);}catch{fs.copyFileSync(from,to);}};
    for(const file of ['library_summary.csv','summary-keys.jsonl'])link(labelsUnchanged?filePath(directory,comparison,file):path.join(output,file),path.join(source,file));
    for(const side of ['targets','parents'])link(filePath(directory,comparison,'inputs/'+side+'.fasta'),path.join(source,'inputs',side+'.fasta'));
    for(const [side,file]of [['targets',targetAnnotations],['parents',parentAnnotations]])if(file)link(meta.csvFor(file),path.join(source,'inputs',side+'.annotations.csv'));
    await require('./summary-native.cjs').writeSource({manifest:comparison,directory:source,targetDirectory,parentDirectory,targetAnnotations,parentAnnotations,previousRecords:filePath(directory,comparison,'summary-records.jsonl')});
    const summaryPackage=require('../frontend/reproduce/summary-package.cjs'),old=JSON.parse(fs.readFileSync(filePath(directory,comparison,'summary.json'),'utf8')),current=JSON.parse(fs.readFileSync(path.join(source,'summary.json'),'utf8'));
    await summaryPackage.seal(source,{...current,membershipCoverage:old.membershipCoverage});
    await require('../frontend/reproduce/summary-index.cjs').build({source,directory:rebuilt,linkInputs:true},report);
    const files=['summary.json','summary-records.jsonl','summary-keys.jsonl','record-matches/comparison.sqlite','record-matches/comparison.json'];
    for(const name of files){fs.mkdirSync(path.dirname(path.join(output,name)),{recursive:true});fs.copyFileSync(path.join(rebuilt,name),path.join(output,name));}
    fs.copyFileSync(path.join(rebuilt,'comparison.sqlite'),path.join(output,comparison.candidateFile||'comparison.sqlite'));
    for(const folder of [source,rebuilt]){if(path.dirname(path.resolve(folder))!==path.resolve(output))throw Error('Invalid annotation staging folder');fs.rmSync(folder,{recursive:true,force:true});}
  }
  const files={};async function collect(folder=''){for(const name of fs.readdirSync(path.join(output,folder))){const key=folder?folder+'/'+name:name,f=path.join(output,key);if(fs.statSync(f).isDirectory())await collect(key);else files[key]={bytes:fs.statSync(f).size,sha256:await meta.hash(f)};}}await collect();
  return files;
}
module.exports={refresh,filePath};
