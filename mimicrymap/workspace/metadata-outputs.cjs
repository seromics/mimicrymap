'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const meta=require('./metadata.cjs'),core=require('../frontend/reproduce/export-core.js');
const regions=require('./pair-regions.cjs');
const filePath=(directory,c,name)=>path.join(directory,c.overrides?.[name]||name);
async function refresh({directory,output,comparison,targetDirectory,parentDirectory,targetAnnotations,parentAnnotations,labelsUnchanged=false},report=()=>{}){
  fs.mkdirSync(output,{recursive:true});
  if(!labelsUnchanged&&comparison.files?.['library_summary.csv']){
  const tdb=new DatabaseSync(path.join(targetDirectory,'library.sqlite'),{readOnly:true}),pdb=new DatabaseSync(path.join(parentDirectory,'library.sqlite'),{readOnly:true});
  const ta=meta.open(targetAnnotations),pa=meta.open(parentAnnotations),db=new DatabaseSync(filePath(directory,comparison,'comparison.sqlite'),{readOnly:true});
  const target=tdb.prepare('SELECT * FROM records WHERE id=?'),parent=pdb.prepare('SELECT * FROM records WHERE id=?');
  const cachedAt=(query,overlay,library)=>{const cache=new Map();return id=>{if(!cache.has(id)){if(cache.size>=4096)cache.delete(cache.keys().next().value);const r=query.get(id);if(!r)throw Error('Annotation record is missing');cache.set(id,overlay.apply(meta.baseRecord(r,library)));}return cache.get(id);};};
  const targetAt=cachedAt(target,ta,comparison.target.id),parentAt=cachedAt(parent,pa,comparison.parent.id);
  const writer=name=>{const fd=fs.openSync(path.join(output,name),'w');let buffer='';return {append:s=>{buffer+=s;if(buffer.length>1048576){fs.writeSync(fd,buffer);buffer='';}},close:()=>{if(buffer)fs.writeSync(fd,buffer);fs.closeSync(fd);}};};
  const pairs=writer('pair_coverage.csv');
  const hasRegions=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='pair_regions'").get();
  const getRegions=hasRegions?db.prepare('SELECT payload FROM pair_regions WHERE target=? AND parent=? AND identity=?'):null;
  try{
    // SQLite spills the ordered stream to disk when needed; no copy of full positions.
    db.exec('PRAGMA temp_store=FILE; PRAGMA cache_size=-8192');
    async function refreshSummary(reverse){
    const name=reverse?'reverse_summary.csv':'library_summary.csv',summary=writer(name);
    const ids=db.prepare(reverse?'SELECT id FROM sequence_records WHERE side=1 ORDER BY id':'SELECT id FROM results ORDER BY id').iterate();
    const pairRows=db.prepare('SELECT target,parent,identity,tc,pc,pairs FROM '+(reverse?'reverse_pairs':'pairs')+' ORDER BY target').iterate();
    const queryAt=reverse?parentAt:targetAt,matchAt=reverse?targetAt:parentAt;
    let pair=pairRows.next();
    let headers,done=0;
    try{for await(const row of meta.csvRows(filePath(directory,comparison,name))){
      if(!headers){headers=row;summary.append('\uFEFF'+meta.csvLine(headers));continue;}
      const next=ids.next();if(next.done)throw Error('Summary records do not match saved targets.');
      const q=queryAt(next.value.id),r=Object.fromEntries(headers.map((h,i)=>[h,row[i]]));
      Object.assign(r,core.summaryIdentity(q));
      const matches=[];
      while(!pair.done&&pair.value.target<=next.value.id){if(pair.value.target===next.value.id)matches.push(pair.value);pair=pairRows.next();}
      const pairKeys={};
      for(const f of comparison.floors||Array.from({length:10-Math.max(7,comparison.floor)},(_,i)=>Math.max(7,comparison.floor)+i)){
        const list=matches.filter(p=>p.identity===f&&(p.tc>=10||p.pc>=10)).map(p=>({...p,record:matchAt(p.parent)}));
        list.sort((a,b)=>b.tc-a.tc||b.pc-a.pc||((a.record.assay_id||a.record.protein_id)<(b.record.assay_id||b.record.protein_id)?-1:(a.record.assay_id||a.record.protein_id)>(b.record.assay_id||b.record.protein_id)?1:0));
        pairKeys[f]=list.map(p=>[p.parent,p.pairs??null]);
        const label='Mimicry Parents at '+f+'/9 with Coverage (%) Parent|Target (>=10% either)';
        r[label]=list.map(p=>core.summaryParentLabel(p.record)+'@'+core.summaryPairPercent(Math.round(p.pc*p.record.length/100),p.record.length)+'|'+core.summaryPairPercent(Math.round(p.tc*q.length/100),q.length)).join(';');
        const regionLabel='Mimicry Parent Regions at '+f+'/9 Parent|Target (>=10% either)';
        if(headers.includes(regionLabel))r[regionLabel]=list.map(p=>{
          const stored=getRegions?.get(reverse?p.parent:next.value.id,reverse?next.value.id:p.parent,f);if(!stored)throw Error('Saved pair ranges are missing.');
          const value=regions.unpack(stored.payload,reverse);
          return core.summaryParentLabel(p.record)+'@'+regions.text(value.parent_ranges)+'|'+regions.text(value.target_ranges);
        }).join(';');
      }
      summary.append(meta.csvLine(headers.map(h=>r[h])));
      if(++done%1000===0)report({phase:'Updating saved annotations',done,total:reverse?comparison.parent.records:comparison.targets});
    }if(!ids.next().done)throw Error('Summary is missing saved targets.');}finally{pairRows.return?.();ids.return?.();summary.close();}
    }
    await refreshSummary(false);
    if(comparison.bidirectional)await refreshSummary(true);
    pairs.append(meta.csvLine(['Target record','Target ID','Parent record','Parent ID','Organism','Reference set','Core identity ≥','Target coverage (%)',...(hasRegions?['Target regions (>=10% either)']:[]),'Parent coverage (%)',...(hasRegions?['Parent regions (>=10% either)']:[]),'Window pairs']));
    for(const r of db.prepare('SELECT * FROM pairs ORDER BY target,identity,parent').iterate()){
      const p=parentAt(r.parent),group=p.reference_set||p.organism||comparison.parent.name;
      const saved=getRegions?.get(r.target,r.parent,r.identity),value=saved?regions.unpack(saved.payload):null;
      pairs.append(meta.csvLine([r.target,r.source,r.parent,r.protein,p.organism||'',group,r.identity,r.tc,...(hasRegions?[value?regions.text(value.target_ranges):'']:[]),r.pc,...(hasRegions?[value?regions.text(value.parent_ranges):'']:[]),r.pairs]));
    }
  }finally{pairs.close();tdb.close();pdb.close();ta.close();pa.close();db.close();}
  }
  for(const [side,file] of [['targets',targetAnnotations],['parents',parentAnnotations]])if(file){
    fs.copyFileSync(file,path.join(output,side+'.annotations.sqlite'));
    fs.copyFileSync(meta.csvFor(file),path.join(output,side+'.annotations.csv'));
  }
  if((comparison.storage||comparison.mappingStorage)==='unified-mapping/1'){
    const name=comparison.candidateFile||'comparison.sqlite';
    fs.copyFileSync(filePath(directory,comparison,name),path.join(output,name));
    const mapping=new DatabaseSync(path.join(output,name));
    try{
      const update=mapping.prepare('UPDATE sequence_records SET metadata=?,name=? WHERE side=? AND id=?');
      mapping.exec('BEGIN');
      for(const [side,folder,annotation]of [[0,targetDirectory,targetAnnotations],[1,parentDirectory,parentAnnotations]]){
        const library=new DatabaseSync(path.join(folder,'library.sqlite'),{readOnly:true}),overlay=meta.open(annotation);
        const record=library.prepare('SELECT * FROM records WHERE id=?');
        try{for(const saved of mapping.prepare('SELECT * FROM sequence_records WHERE side=? ORDER BY id').iterate(side)){
          const row=record.get(saved.id),prior=JSON.parse(saved.metadata);
          const digest=row&&require('node:crypto').createHash('sha256').update(row.sequence).digest('hex');
          if(!row||row.sequence.length!==saved.length||digest!==(prior.normalized_sequence_sha256||saved.sha256))throw Error('Annotation update changed a mapping sequence');
          const value=overlay.apply({...prior,...meta.baseRecord(row,comparison[side?'parent':'target'].id)});
          delete value.sequence;
          update.run(JSON.stringify(value),value.gene||value.name||value.protein_id||saved.source,side,saved.id);
        }}finally{library.close();overlay.close();}
      }
      // Pair coverage, statistical cutoffs, residue unions and aliases remain unchanged.
      mapping.exec('COMMIT');
    }finally{mapping.close();}
  }
  const files={};async function collect(folder=''){for(const name of fs.readdirSync(path.join(output,folder))){const key=folder?folder+'/'+name:name,f=path.join(output,key);if(fs.statSync(f).isDirectory())await collect(key);else files[key]={bytes:fs.statSync(f).size,sha256:await meta.hash(f)};}}await collect();
  return files;
}
module.exports={refresh,filePath};
