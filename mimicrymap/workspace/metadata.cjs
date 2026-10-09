'use strict';
// Optional, versioned record annotations. Sequence IDs and matching caches never change.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const identity=require('../frontend/mimicryone-identity.js');
const FIELDS=['record_id','gene','accession','description','organism','taxid','reference_set'];
const VERSION=1;
const {STEMS,packaged}=require('./annotation-source.cjs');
const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const csvLine=values=>values.map(quote).join(',')+'\r\n';
async function* csvRows(file) {
  let row=[],field='',quoted=false,afterQuote=false,first=true,cr=false;
  for await(let chunk of fs.createReadStream(file,{encoding:'utf8'})) {
    if(first){chunk=chunk.replace(/^\uFEFF/,'');first=false;}
    for(const c of chunk){
      if(cr){cr=false;if(c==='\n')continue;}
      if(quoted){if(c==='"'){quoted=false;afterQuote=true;}else field+=c;continue;}
      if(afterQuote&&c==='"'){field+='"';quoted=true;afterQuote=false;continue;}
      if(c===','){row.push(field);field='';afterQuote=false;}
      else if(c==='\r'||c==='\n'){row.push(field);if(row.some(v=>v!==''))yield row;row=[];field='';afterQuote=false;cr=c==='\r';}
      else if(c==='"'&&!field&&!afterQuote)quoted=true;
      else {if(afterQuote)throw Error('Unexpected text after a quoted CSV field.');field+=c;}
    }
  }
  if(quoted)throw Error('Unclosed quoted CSV field.');
  if(field||row.length){row.push(field);yield row;}
}
function baseRecord(row,library) {
  const r={...JSON.parse(row.metadata),record_id:row.id,sequence:row.sequence};
  const canonical={'builtin-human':'canonical_human','builtin-huprot':'huprot4','builtin-huscan':'human_current','builtin-virscan':'virscan_exposome_current','builtin-exposure':'canonical_exposure','builtin-nonvertebrate':'canonical_exposure','builtin-viral120':'atlas_120_viruses'}[library];
  if(canonical){
    r.library_id=canonical;
    // Published reference FASTAs use accession | gene | description (not UniProt sp| syntax).
    const parts=(r.raw_header||'').split(/\s+\|\s+/);
    if(parts.length>=3&&!/^(sp|tr)\|/.test(parts[0])) {
      r.source_accession=parts[0];r.gene=parts[1];r.protein_name=parts.slice(2).join(' | ');
    }
    if(['canonical_human','huprot4','human_current'].includes(canonical)){r.organism='Homo sapiens';r.taxid='9606';}
  }
  r.identity=identity.resolve(r);
  return r;
}
function values(record) {
  const i=identity.resolve(record),header=record.raw_header||record.header||'';
  return {gene:i.gene,accession:i.accession,description:i.proteinName,organism:i.organism,
    taxid:String(record.taxid||record.organism_taxid||header.match(/(?:^|\s)OX=(\d+)/)?.[1]||''),reference_set:record.reference_set||''};
}
function apply(record,fields) {
  if(!fields)return record;
  const r={...record,gene:fields.gene,primary_gene:fields.gene,gene_symbol:fields.gene,
    source_accession:fields.accession,display_accession:fields.accession,accession:fields.accession,
    protein_name:fields.description,name:fields.description,description:fields.description,
    organism:fields.organism,species:fields.organism,taxid:fields.taxid,organism_taxid:fields.taxid,
    organism_taxon_label:'',reference_set:fields.reference_set};
  r.identity=identity.resolve(r);return r;
}
function open(file) {
  if(!file)return {apply:r=>r,close(){}};
  const db=new DatabaseSync(file,{readOnly:true}),get=db.prepare('SELECT * FROM records WHERE id=?');
  return {apply:r=>apply(r,get.get(r.record_id)),get:id=>get.get(id),close:()=>db.close()};
}
async function hash(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
function canonicalFile(root,library) {
  const prefix={'builtin-human':'human_swissprot','builtin-viral120':'atlas_120_viruses','builtin-exposure':'canonical_exposure','builtin-nonvertebrate':'canonical_exposure_no_vertebrates','builtin-huprot':'huprot4','builtin-huscan':'huscan','builtin-virscan':'virscan_exposome'}[library];
  const folder=root&&path.join(root,'mimicrymap/frontend/source-downloads/mimicry-summaries');
  if(!prefix||!folder||!fs.existsSync(folder))return null;
  return fs.readdirSync(folder).filter(n=>n.startsWith(prefix+'_vs_')&&n.endsWith('_comprehensive.csv')).map(n=>path.join(folder,n)).sort((a,b)=>fs.statSync(a).size-fs.statSync(b).size)[0]||null;
}
async function prepare({directory,output,library,source,previous,canonical},report=()=>{}) {
  fs.mkdirSync(output,{recursive:true});
  const input=new DatabaseSync(path.join(directory,'library.sqlite'),{readOnly:true});
  const db=new DatabaseSync(path.join(output,'records.sqlite'));
  db.exec('CREATE TABLE base(id INTEGER PRIMARY KEY,token TEXT UNIQUE,gene TEXT,accession TEXT,description TEXT,organism TEXT,taxid TEXT,reference_set TEXT);CREATE TABLE records AS SELECT * FROM base WHERE 0;CREATE UNIQUE INDEX record_ids ON records(id);CREATE UNIQUE INDEX record_tokens ON records(token);');
  let customRows=0,matched=0,canonicalRows=0;
  const bundled=packaged(canonical?.moduleRoot,library),curated=bundled?null:canonicalFile(canonical?.moduleRoot,library);
  try {
    if(previous){db.prepare('ATTACH DATABASE ? AS previous').run(previous);db.exec('INSERT INTO base SELECT * FROM previous.base;DETACH DATABASE previous;');}
    else {
      if(bundled){
        // The distributed CSV already contains every resolved field. Copy only
        // stable keys instead of parsing/resolving all FASTA identities again.
        db.prepare('ATTACH DATABASE ? AS sequences').run(path.join(directory,'library.sqlite'));
        db.exec("INSERT INTO base SELECT id,token,'','','','','','' FROM sequences.records;DETACH DATABASE sequences;");
        matched=db.prepare('SELECT count(*) n FROM base').get().n;
      }else{
      const put=db.prepare('INSERT INTO base VALUES(?,?,?,?,?,?,?,?)');db.exec('BEGIN');
      let batch=[];
      const write=()=>{
        if(!bundled&&!curated&&canonical?.python&&canonical.moduleRoot)require('./annotations.cjs').annotate([{library,records:batch.map(b=>b.record)}],canonical);
        for(const {row,record} of batch){const v=values(record);put.run(row.id,row.token,...FIELDS.slice(1).map(k=>v[k]));matched++;}
        report({phase:'Reading library annotations',done:matched,total:input.prepare('SELECT count(*) n FROM records').get().n});batch=[];
      };
      for(const row of input.prepare('SELECT * FROM records ORDER BY id').iterate()){
        batch.push({row,record:baseRecord(row,library)});if(batch.length===4096)write();
      }
      if(batch.length)write();db.exec('COMMIT');
      }
      if(bundled){
        const saved=JSON.parse(fs.readFileSync(path.join(directory,'library.json'),'utf8'));
        if(saved.sha256!==bundled.fastaSha256||await hash(bundled.file)!==bundled.sha256)throw Error('Library annotations do not match this FASTA release.');
        const update=db.prepare('UPDATE base SET gene=?,accession=?,description=?,organism=?,taxid=?,reference_set=? WHERE token=?');
        let headers;db.exec('BEGIN');
        for await(const row of csvRows(bundled.file)){
          if(!headers){headers=row;if(headers.join(',')!==FIELDS.join(','))throw Error('Invalid packaged annotation columns');continue;}
          if(row.length!==FIELDS.length||update.run(...row.slice(1),row[0]).changes!==1)throw Error('Invalid packaged annotation record: '+row[0]);
          canonicalRows++;
          if(canonicalRows%10000===0)report({phase:'Loading record annotations',done:canonicalRows,total:matched});
        }
        if(canonicalRows!==matched||canonicalRows!==bundled.records)throw Error('Incomplete packaged library annotations');
        db.exec('COMMIT');
      }
      if(curated){
        const lookup=input.prepare('SELECT id,sequence FROM records WHERE source=? OR token=?');
        const update=db.prepare('UPDATE base SET gene=?,accession=?,description=?,organism=?,taxid=? WHERE id=?');
        let headers;db.exec('BEGIN');
        for await(const row of csvRows(curated)){
          if(!headers){headers=row;continue;}
          const r=Object.fromEntries(headers.map((h,i)=>[h,row[i]])),acc=r['Antigen Target Accession']||'',description=r['Antigen Target Protein Description']||'';
          const key=description.match(/^(JHU\S+|CDI\S+)(?:\s+\/|$)/)?.[1]||acc;
          const hits=lookup.all(key,key).filter(v=>v.sequence===(r['Antigen Target Full Sequence']||'').toUpperCase().replace(/[BXZJUO]/g,'X').replace(/\*/g,''));
          if(hits.length!==1)continue;
          const taxon=r['Antigen Target Organism (TaxID)']||'',tax=taxon.match(/\[TaxID:\s*(\d+)\]/)?.[1]||'';
          const organism=taxon.includes(';')?taxon:taxon.replace(/\s*\[TaxID:[^\]]+\]/,'');
          update.run(r['Antigen Target Gene']||'',acc,description.replace(/^(JHU\S+|CDI\S+)(?:\s+\/\s*|$)/,''),organism,taxon.includes(';')?'':tax,hits[0].id);canonicalRows++;
          if(canonicalRows%10000===0)report({phase:'Joining curated annotations',done:canonicalRows,total:matched});
        }
        db.exec('COMMIT');
      }
    }
    db.exec('INSERT INTO records SELECT * FROM base;');
    if(source){
      const seen=new Set(),unknown=[],duplicates=[];let headers,rowNum=0;
      const find=db.prepare('SELECT * FROM records WHERE token=?');
      const update=db.prepare('UPDATE records SET gene=?,accession=?,description=?,organism=?,taxid=?,reference_set=? WHERE id=?');
      db.exec('BEGIN');
      for await(const row of csvRows(source)){
        rowNum++;
        if(!headers){headers=row.map(v=>v.trim().toLowerCase());if(new Set(headers).size!==headers.length||!headers.includes('record_id')||headers.some(k=>!FIELDS.includes(k)))throw Error('Use record_id and optional gene, accession, description, organism, taxid, reference_set columns.');continue;}
        if(row.length!==headers.length)throw Error('CSV row '+rowNum+' has the wrong number of fields.');
        const fields=Object.fromEntries(headers.map((k,i)=>[k,row[i].trim()])),id=fields.record_id;
        if(!id)throw Error('CSV row '+rowNum+' needs a FASTA record_id.');
        if(seen.has(id)){duplicates.push(id);continue;}seen.add(id);
        const current=find.get(id);if(!current){unknown.push(id);continue;}
        if(fields.taxid&&!/^[1-9]\d*$/.test(fields.taxid))throw Error('Invalid taxid for '+id+'. Use a positive NCBI TaxID or leave it blank.');
        for(const k of FIELDS.slice(1)){if(fields[k]?.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fields[k]||''))throw Error('Invalid '+k+' for '+id);if(fields[k])current[k]=fields[k];}
        update.run(...FIELDS.slice(1).map(k=>current[k]),current.id);customRows++;
      }
      if(duplicates.length||unknown.length)throw Error([duplicates.length?duplicates.length+' duplicate record IDs: '+duplicates.slice(0,5).join(', '):'',unknown.length?unknown.length+' unmatched record IDs: '+unknown.slice(0,5).join(', '):''].filter(Boolean).join('. ')+'. Nothing was imported.');
      if(!customRows)throw Error('No matching annotation rows. Nothing was imported.');
      db.exec('COMMIT');fs.copyFileSync(source,path.join(output,'imported.csv'));
    }
    const fd=fs.openSync(path.join(output,'annotations.csv'),'w');
    try{fs.writeSync(fd,'\uFEFF'+csvLine(FIELDS));let buffer='';for(const r of db.prepare('SELECT * FROM records ORDER BY id').iterate()){buffer+=csvLine([r.token,...FIELDS.slice(1).map(k=>r[k])]);if(buffer.length>1048576){fs.writeSync(fd,buffer);buffer='';}}if(buffer)fs.writeSync(fd,buffer);}finally{fs.closeSync(fd);}
    const records=db.prepare('SELECT count(*) n FROM records').get().n;
    db.close();input.close();
    return {version:VERSION,records,customRows,canonicalRows,parsedDefaults:!STEMS[library]&&!source&&!previous,canonicalSource:bundled?path.basename(bundled.file):curated?path.basename(curated):null,defaultsRevision:bundled?.sha256||null,revision:await hash(path.join(output,'annotations.csv'))};
  }catch(e){try{db.close();}catch{}input.close();throw e;}
}
const csvFor=file=>path.basename(file)==='records.sqlite'?path.join(path.dirname(file),'annotations.csv'):file.replace(/\.sqlite$/,'.csv');
module.exports={VERSION,FIELDS,STEMS,packaged,csvRows,csvLine,values,apply,baseRecord,open,prepare,hash,csvFor};
