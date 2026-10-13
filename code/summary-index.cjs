'use strict';
// Both indexes are derived from verified CSV residue unions. No matcher is used.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{deflateSync}=require('node:zlib');
const pkg=require('./summary-package.cjs'),coverage=require('./residue-coverage.js'),regions=require('./pair-regions.cjs');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
async function checkFasta(file,records){
 const parser=require('./fasta-input.js'),lines=require('node:readline').createInterface({input:fs.createReadStream(file),crlfDelay:Infinity}),ordered=records.values();let header='',sequence='',count=0;
 const check=()=>{if(!header)return;const r=ordered.next();const parsed=parser.parse('>'+header+'\n'+sequence,'query',1);if(parsed.errors.length||r.done||parsed.records[0]?.sequence.length!==r.value.length||digest(parsed.records[0].sequence)!==(r.value.normalizedSha256||r.value.sha256))throw Error('Summary record metadata differs from its FASTA sequence');count++;};
 for await(const raw of lines){const line=raw.replace(/^\uFEFF/,'').trim();if(line.startsWith('>')){check();header=line.slice(1);sequence='';}else sequence+=line;}
 check();if(!ordered.next().done||count!==records.size)throw Error('FASTA and metadata record rosters differ');
}
function split(value,delimiter){
 const out=[];let start=0,escaped=false;
 for(let i=0;i<value.length;i++){if(escaped){escaped=false;continue;}if(value[i]==='\\'){escaped=true;continue;}if(value[i]===delimiter){out.push(value.slice(start,i));start=i+1;}}
 if(escaped)throw Error('Incomplete escaped summary label');out.push(value.slice(start));return out;
}
function entries(value){return value?split(value,';').map(s=>{const parts=split(s,'@');if(parts.length!==2)throw Error('Invalid summary pair');return parts;}):[];}
function ranges(value,length){
 if(!value||!/^\d+\.\.\d+(,\d+\.\.\d+)*$/.test(value))throw Error('Invalid summary residue ranges');
 const listed=value.split(',').map(s=>s.split('..').map(Number)),merged=coverage.union(listed,length);
 if(JSON.stringify(listed)!==JSON.stringify(merged)||merged.some(([a,b])=>b-a+1<9))throw Error('Expected independent merged nine-residue core unions');return merged;
}
function pageTables(db){db.exec(`
 CREATE TABLE sequence_records(side INTEGER,id INTEGER,source TEXT,metadata TEXT,length INTEGER,sha256 TEXT,PRIMARY KEY(side,id)) WITHOUT ROWID;
 CREATE TABLE neighbours(side INTEGER,id INTEGER,identity INTEGER,count INTEGER,payload BLOB,PRIMARY KEY(side,id,identity)) WITHOUT ROWID;
 CREATE TABLE region_lists(side INTEGER,id INTEGER,identity INTEGER,reference_ranges TEXT,payload BLOB,PRIMARY KEY(side,id,identity)) WITHOUT ROWID;`);}
function putPage(db,side,id,floor,rows,records){
 const length=records[side].get(id).length;
 for(const r of rows){r.ranges=regions.unpack(r.payload,!!side);r.tc=100*coverage.size(r.ranges.target_ranges)/length;r.pc=100*coverage.size(r.ranges.parent_ranges)/records[1-side].get(r.other).length;}
 rows.sort((a,b)=>b.tc-a.tc||b.pc-a.pc||a.other-b.other);
 const packed=Buffer.allocUnsafe(rows.length*20),chunks=[],union=[];
 rows.forEach((r,i)=>{
  packed.writeUInt32LE(r.other,i*20);packed.writeDoubleLE(r.tc,i*20+4);packed.writeDoubleLE(r.pc,i*20+12);
  const value=r.ranges,blob=regions.pack(value.target_ranges,value.parent_ranges),head=Buffer.allocUnsafe(8);
  head.writeUInt32LE(r.other);head.writeUInt32LE(blob.length,4);chunks.push(head,blob);union.push(...value.target_ranges);
 });
 db.prepare('INSERT INTO neighbours VALUES(?,?,?,?,?)').run(side,id,floor,rows.length,deflateSync(packed));
 db.prepare('INSERT INTO region_lists VALUES(?,?,?,?,?)').run(side,id,floor,JSON.stringify(coverage.union(union,length)),deflateSync(Buffer.concat(chunks)));
}
async function annotationDatabase(source,directory,manifest,side,records){
 const key=manifest.inputs?.[side+'Annotations'];
 const filename='inputs/'+(side==='target'?'targets':'parents')+'.annotations',byToken=key?new Map([...records.values()].map(r=>[r.token,r])):null;
 const db=new DatabaseSync(path.join(directory,filename+'.sqlite'));
 try{
  db.exec('CREATE TABLE base(id INTEGER PRIMARY KEY,token TEXT UNIQUE,gene TEXT,accession TEXT,description TEXT,organism TEXT,taxid TEXT,reference_set TEXT);CREATE TABLE records AS SELECT * FROM base WHERE 0;CREATE UNIQUE INDEX record_ids ON records(id);CREATE UNIQUE INDEX record_tokens ON records(token);BEGIN;');
  const put=db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?)');let header,count=0;
  if(key)for await(const row of pkg.csvRows(pkg.safeFile(source,key))){
   if(!header){header=row;if(header.join(',')!=='record_id,gene,accession,description,organism,taxid,reference_set')throw Error('Unsupported annotation CSV');continue;}
   const r=byToken.get(row[0]);if(!r||row.length!==7)throw Error('Annotation identity mismatch');put.run(r.id,r.token,...row.slice(1));count++;
  }
  if(!key){
   const file=fs.openSync(path.join(directory,filename+'.csv'),'wx');let buffer=pkg.csvLine(['record_id','gene','accession','description','organism','taxid','reference_set']);
   try{for(const r of records.values()){
    const m=r.metadata,values=[r.token,m.gene||'',m.accession||m.source_accession||'',m.protein_name||m.name||'',m.organism||'',String(m.taxid||''),m.reference_set||''];
    put.run(r.id,...values);buffer+=pkg.csvLine(values);count++;
    if(buffer.length>1048576){fs.writeSync(file,buffer);buffer='';}
   }if(buffer)fs.writeSync(file,buffer);}finally{fs.closeSync(file);}
  }
  if(count!==records.size)throw Error('Incomplete annotation roster');db.exec('INSERT INTO base SELECT * FROM records;COMMIT;');
 }finally{db.close();}
 if(key)fs.copyFileSync(pkg.safeFile(source,key),path.join(directory,filename+'.csv'));
}
async function build({source,directory,linkInputs=false},report=()=>{}){
 source=path.resolve(source);if(fs.statSync(source).isFile())source=path.dirname(source);
 directory=path.resolve(directory);if(fs.existsSync(directory))throw Error('Index output already exists; choose a new directory');
 const m=await pkg.validate(source),records=[new Map(),new Map()];
 for await(const r of pkg.jsonLines(pkg.safeFile(source,m.recordsFile))){
  if(![0,1].includes(r.side)||!Number.isSafeInteger(r.id)||r.id<0||r.id>0xffffffff||!Number.isSafeInteger(r.length)||r.length<0||!r.source||!r.token||!r.metadata||!Array.isArray(r.aliases)||!/^[a-f0-9]{64}$/.test(r.sha256)||records[r.side].has(r.id))throw Error('Invalid or duplicate summary record');
  if(r.id!==records[r.side].size+1)throw Error('Summary IDs must follow the complete FASTA record order, starting at 1');
  records[r.side].set(r.id,r);
 }
 for(const [side,name]of [[0,'target'],[1,'parent']])if(records[side].size!==m[name]?.records)throw Error('Incomplete '+name+' library roster');
 for(const [side,name]of [[0,'target'],[1,'parent']])await checkFasta(pkg.safeFile(source,m.inputs[name]),records[side]);
 fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(path.join(directory,'inputs'));fs.mkdirSync(path.join(directory,'record-matches'));
 const db=new DatabaseSync(path.join(directory,'comparison.sqlite')),pages=new DatabaseSync(path.join(directory,'record-matches/comparison.sqlite'));
 let pairCount=0,rowCount=0;
 try{
  db.exec(`PRAGMA journal_mode=DELETE;PRAGMA synchronous=OFF;
   CREATE TABLE results(id INTEGER PRIMARY KEY,token TEXT,source TEXT,name TEXT,result BLOB,sequence_hash TEXT);
   CREATE TABLE pairs(target INTEGER,source TEXT,parent INTEGER,protein TEXT,organism TEXT,identity INTEGER,tc REAL,pc REAL,pairs INTEGER);
   CREATE TABLE aliases(alias TEXT,target INTEGER,PRIMARY KEY(alias,target));
   CREATE TABLE pair_regions(target INTEGER,parent INTEGER,identity INTEGER,payload BLOB,PRIMARY KEY(target,parent,identity)) WITHOUT ROWID;
   CREATE TABLE sequence_records(side INTEGER,id INTEGER,source TEXT,metadata TEXT,length INTEGER,sha256 TEXT,PRIMARY KEY(side,id)) WITHOUT ROWID;BEGIN;`);
  pages.exec('PRAGMA journal_mode=DELETE;PRAGMA synchronous=OFF;');pageTables(pages);pages.exec('BEGIN;');
  const recordSql='INSERT INTO sequence_records VALUES(?,?,?,?,?,?)',putRecord=db.prepare(recordSql),putPageRecord=pages.prepare(recordSql);
  for(const side of [0,1])for(const r of records[side].values()){
   const values=[side,r.id,r.source,JSON.stringify(r.metadata),r.length,r.sha256];putRecord.run(...values);putPageRecord.run(...values);
  }
  pages.exec('COMMIT;');
  const putResult=db.prepare('INSERT INTO results VALUES(?,?,?,?,NULL,?)'),alias=db.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?)'),putPair=db.prepare('INSERT INTO pairs VALUES(?,?,?,?,?,?,?,?,?)'),putRanges=db.prepare('INSERT INTO pair_regions VALUES(?,?,?,?)');
  const keys=pkg.jsonLines(pkg.safeFile(source,m.keysFile))[Symbol.asyncIterator](),seen=new Set();let header,columns;
  const pairCsv=fs.openSync(path.join(directory,'pair_coverage.csv'),'wx');
  try{
   fs.writeSync(pairCsv,pkg.csvLine(['Target record','Target ID','Parent record','Parent ID','Organism','Reference set','Core identity ≥','Target coverage (%)','Target regions (>=10% either)','Parent coverage (%)','Parent regions (>=10% either)','Window pairs']));let buffer='';
   for await(const row of pkg.csvRows(pkg.safeFile(source,m.csv))){
    if(!header){
     header=row;columns=m.floors.map(f=>({f,p:header.indexOf('Mimicry Parents at '+f+'/9 with Coverage (%) Parent|Target (>=10% either)'),r:header.indexOf('Mimicry Parent Regions at '+f+'/9 Parent|Target (>=10% either)')}));
     if(new Set(header).size!==header.length||columns.some(c=>c.p<0||c.r!==c.p+1))throw Error('Missing or reordered paired summary fields');continue;
    }
    if(row.length!==header.length)throw Error('Wrong CSV field count');
    const key=await keys.next(),target=records[0].get(key.value?.target);
    if(key.done||!target||seen.has(target.id))throw Error('Missing or duplicate target row key');seen.add(target.id);
    const seq=row[header.indexOf('Antigen Target Full Sequence')],length=Number(row[header.indexOf('Antigen Target Length (AA)')]);
    if(typeof seq!=='string'||length!==target.length||seq.length!==length||digest(seq)!==target.sha256)throw Error('Target CSV sequence differs from metadata');
    putResult.run(target.id,target.token,target.source,target.metadata.gene||target.metadata.name||target.metadata.protein_id,target.sha256);
    for(const value of new Set(target.aliases))alias.run(String(value),target.id);
    for(const {f,p,r}of columns){
     const pairs=entries(row[p]),rangePairs=entries(row[r]),pairKeys=key.value.parents?.[f];
     if(!Array.isArray(pairKeys)||pairKeys.length!==pairs.length||rangePairs.length!==pairs.length)throw Error('CSV pairs and stable record keys disagree');
     const parents=new Set();
     for(let i=0;i<pairs.length;i++){
      const [id,count]=pairKeys[i],parent=records[1].get(id);
      if(!parent||parents.has(id)||count!==null&&(!Number.isSafeInteger(count)||count<1))throw Error('Invalid or duplicate parent key');parents.add(id);
      if(pairs[i][0]!==rangePairs[i][0]||parent.label!==undefined&&pairs[i][0]!==parent.label)throw Error('Parent label differs from its stable key');
      const a=split(rangePairs[i][1],'|'),display=split(pairs[i][1],'|');if(a.length!==2||display.length!==2)throw Error('Invalid parent/target fields');
      const pr=ranges(a[0],parent.length),tr=ranges(a[1],target.length),tc=100*coverage.size(tr)/target.length,pc=100*coverage.size(pr)/parent.length;
      if(tc<10&&pc<10||!display.every(v=>/^\d+(\.\d+)?$/.test(v))||Math.abs(Number(display[0])-pc)>.056||Math.abs(Number(display[1])-tc)>.056)throw Error('Coverage differs from exact ranges');
      const protein=parent.metadata.protein_id||parent.source,organism=parent.metadata.reference_set||parent.metadata.organism||m.parent.name;
      const policy=typeof m.membershipCoverage==='object'?m.membershipCoverage[f]:m.membershipCoverage;
      putPair.run(target.id,target.source,parent.id,protein,organism,f,policy==='csv-pair-percent'?Number(display[1]):tc,policy==='csv-pair-percent'?Number(display[0]):pc,count);
      putRanges.run(target.id,parent.id,f,regions.pack(tr,pr));pairCount++;
      buffer+=pkg.csvLine([target.id,target.source,parent.id,protein,parent.metadata.organism||'',organism,f,tc,regions.text(tr),pc,regions.text(pr),count]);
      if(buffer.length>1048576){fs.writeSync(pairCsv,buffer);buffer='';}
     }
    }
    rowCount++;if(rowCount%1000===0){db.exec('COMMIT;BEGIN;');report({phase:'Indexing summary CSV',done:rowCount,total:m.rows});}
   }
   if(buffer)fs.writeSync(pairCsv,buffer);
   if(!(await keys.next()).done||rowCount!==m.rows||m.complete&&seen.size!==records[0].size)throw Error('Incomplete target population');
  }finally{fs.closeSync(pairCsv);}
  db.exec('COMMIT;CREATE INDEX target_sequence ON results(sequence_hash);CREATE INDEX target_source ON results(source);CREATE INDEX memberships ON pairs(identity,organism,source);CREATE UNIQUE INDEX pair_ids ON pairs(target,parent,identity);CREATE INDEX parent_memberships ON pairs(identity,parent,tc,pc,target);');
  for(const side of [0,1])for(const floor of m.floors){
   const one=side?'parent':'target',other=side?'target':'parent',tc=side?'pc':'tc',pc=side?'tc':'pc';let id,rows=[];
   pages.exec('BEGIN;');const flush=()=>{if(rows.length)putPage(pages,side,id,floor,rows,records);rows=[];};
   for(const r of db.prepare(`SELECT p.${one} id,p.${other} other,p.${tc} tc,p.${pc} pc,r.payload FROM pairs p JOIN pair_regions r USING(target,parent,identity) WHERE p.identity=? ORDER BY p.${one},p.${other}`).iterate(floor)){
    if(id!==r.id){flush();id=r.id;}rows.push(r);
   }
   flush();pages.exec('COMMIT;');report({phase:'Building protein-page index',done:side*m.floors.length+m.floors.indexOf(floor)+1,total:2*m.floors.length});
  }
  pages.exec('CREATE INDEX sequence_digest ON sequence_records(side,sha256);CREATE INDEX sequence_sources ON sequence_records(side,source);ANALYZE;');
  db.exec(`CREATE VIEW reverse_pairs AS SELECT p.parent target,s.source source,p.target parent,coalesce(json_extract(t.metadata,'$.protein_id'),t.source) protein,coalesce(nullif(json_extract(t.metadata,'$.reference_set'),''),json_extract(t.metadata,'$.organism')) organism,p.identity,p.pc tc,p.tc pc,p.pairs FROM pairs p JOIN sequence_records s ON s.side=1 AND s.id=p.parent JOIN sequence_records t ON t.side=0 AND t.id=p.target;`);
 }finally{db.close();pages.close();}
 const copy=(from,to)=>{if(linkInputs){try{fs.linkSync(from,to);return;}catch(error){if(error.code==='EEXIST')return;}}fs.copyFileSync(from,to);};
 for(const [side,name]of [['target','targets'],['parent','parents']]){
  if(!m.inputs?.[side])throw Error('Both original FASTA inputs are required');
  copy(pkg.safeFile(source,m.inputs[side]),path.join(directory,'inputs',name+'.fasta'));
  await annotationDatabase(source,directory,m,side,records[side==='target'?0:1]);
 }
 for(const [file,name]of [[m.csv,'library_summary.csv'],[m.recordsFile,'summary-records.jsonl'],[m.keysFile,'summary-keys.jsonl']])copy(pkg.safeFile(source,file),path.join(directory,name));
 const inputs={target:'inputs/targets.fasta',parent:'inputs/parents.fasta'};
 for(const [side,name]of [['target','targets'],['parent','parents']])inputs[side+'Annotations']='inputs/'+name+'.annotations.csv';
 await pkg.seal(directory,{...m,csv:'library_summary.csv',recordsFile:'summary-records.jsonl',keysFile:'summary-keys.jsonl',inputs});
 const scopes={};for(const side of records)for(const r of side.values())if(Number.isSafeInteger(r.metadata.scope_mask))scopes[r.metadata.accession||r.source]=r.metadata.scope_mask;
 if(Object.keys(scopes).length)fs.writeFileSync(path.join(directory,'exposure-scopes.json'),JSON.stringify(scopes)+'\n');
 const base={id:m.id||crypto.randomUUID(),name:m.name||m.target.name+' → '+m.parent.name,method:'complete-nine-residue-identity/1',window:9,floor:Math.min(...m.floors),floors:m.floors,coverageFloor:10,coverageSide:'either',membershipCoverage:m.membershipCoverage,target:m.target,parent:m.parent,targetId:m.targetId??null,complete:m.complete,targets:rowCount,pairs:pairCount,retainsPositions:false,retainsPairRegions:true,pairRegionStorage:regions.FORMAT,sourceSummary:{schema:m.schema,sha256:await pkg.hash(path.join(source,'summary.json')),files:m.files},createdAt:new Date().toISOString()};
 const pageFile=path.join(directory,'record-matches/comparison.sqlite'),pageManifest={...base,schema:'seromap.record-matches/1',storage:'record-neighbours/1',relationshipsOnly:true,featureOnly:true,bidirectional:true,output:'record-matches',files:{'comparison.sqlite':{bytes:fs.statSync(pageFile).size,sha256:await pkg.hash(pageFile)}}};
 fs.writeFileSync(path.join(directory,'record-matches/comparison.json'),JSON.stringify(pageManifest,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'settings.json'),JSON.stringify({floor:base.floor,targetId:base.targetId,retainPositions:false,bidirectional:false,targetName:m.target.name,parentName:m.parent.name})+'\n');
 const files={};function collect(folder=''){for(const e of fs.readdirSync(path.join(directory,folder),{withFileTypes:true})){const name=folder?folder+'/'+e.name:e.name;if(e.isDirectory())collect(name);else files[name]=null;}}
 collect();for(const name of Object.keys(files)){const file=path.join(directory,name);files[name]={bytes:fs.statSync(file).size,sha256:await pkg.hash(file)};}
 const manifest={...base,schema:'seromap.mimicry-comparison/1',output:'candidate-index',bidirectional:false,summarySchema:'mimicryone/native-summary/7',pairFocusedSummary:true,derivedFromSummary:true,files};
 fs.writeFileSync(path.join(directory,'comparison.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
module.exports={build,split,entries,ranges};
if(require.main===module){const [source,directory]=process.argv.slice(2);if(!source||!directory){console.error('Usage: node summary-index.cjs summary-package-folder new-output-folder');process.exitCode=1;}else build({source,directory},p=>console.error(p.phase,p.done??'',p.total??'')).then(m=>console.log(JSON.stringify({targets:m.targets,pairs:m.pairs}))).catch(e=>{console.error(e.stack);process.exitCode=1;});}
