'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const pkg=require('./summary-package.cjs'),unified=require('./unified-mapping.cjs');
async function build({source,manifest,destination,product='both'},report=()=>{}){
 source=path.resolve(source);destination=path.resolve(destination);
 const m=manifest||JSON.parse(fs.readFileSync(path.join(source,'comparison.json'),'utf8'));
 const resolve=name=>pkg.safeFile(source,(m.overrides?.[name]||name).replaceAll('\\','/'));
 const database=resolve(m.candidateFile||'comparison.sqlite'),inputs=[resolve('inputs/targets.fasta'),resolve('inputs/parents.fasta')];
 if(!['mapping','summaries','both'].includes(product))throw Error('Choose a mapping database or summary bundle');
 fs.mkdirSync(destination,{recursive:true});const temporary=fs.mkdtempSync(path.join(destination,'.mapping-bundle-')),outputs=[];
 try{
  if(product==='summaries'||product==='both'){
   const folder=path.join(temporary,'summaries');
   const names=await require('./mapping-csv.cjs').write({database,directory:folder,manifest:m,inputs},report);
   for(const [i,name]of ['targets.fasta','parents.fasta'].entries()){
    if(i&&m.target.sha256===m.parent.sha256)continue;
    fs.copyFileSync(inputs[i],path.join(folder,name));names.push(name);
   }
   fs.writeFileSync(path.join(folder,'README.txt'),`MimicryMap Summary Tables\n\n${m.target.name} ↔ ${m.parent.name}\n\nOne CSV per direction (one for a self-comparison), including records without qualifying pairs. Each identity threshold retains pairs covering at least 10% of either sequence, with independent one-based inclusive residue ranges beside the Parent|Target coverage values. Overlapping core residues count once; context flanks are excluded. These ranges do not specify alignment correspondence. Unmatched Target Regions precedes each pair block and describes the whole stated comparison library before the pair-list cutoff. None means no unmatched residues; Not available means complete unions were not retained; Not evaluated applies below nine residues.\n\nThe FASTAs are the original inputs: targets.fasta = ${m.target.name}; ${m.target.sha256===m.parent.sha256?'the same FASTA is used on both sides':'parents.fasta = '+m.parent.name}. Labels and annotations in the CSV reflect the saved mapping records.\n\n${m.complete?'The comparison covers both complete input libraries.':'This is a selected-target comparison; the FASTAs retain the complete input records.'}\n\nFor installation, use the separate SeroMap Mapping Database ZIP. These CSVs are standalone readable exports. Sequence similarity does not establish shared antibody binding.\n`);names.push('README.txt');
   outputs.push(await require('./zip-files.cjs').write(path.join(destination,'summaries.zip'),names.map(n=>[n,path.join(folder,n)]),report));
  }
  if(product==='mapping'||product==='both'){
   const folder=path.join(temporary,'mapping');fs.mkdirSync(path.join(folder,'inputs'),{recursive:true});
   const db=new DatabaseSync(path.join(folder,'comparison.sqlite'));let count,pairs;
   try{
    db.exec('PRAGMA journal_mode=OFF;PRAGMA synchronous=OFF;PRAGMA cache_size=-131072');
    require('./mapping-writer.cjs').create(db);
    db.prepare('ATTACH DATABASE ? AS saved').run(database);
    db.exec('BEGIN');
    for(const table of ['sequence_records','record_aliases','mapping_pairs','overviews']){report({phase:'Preparing '+table,done:0,total:0});db.exec(`INSERT INTO ${table} SELECT * FROM saved.${table}`);}
    for(const table of ['library_unions','library_union_scopes'])if(db.prepare("SELECT 1 FROM saved.sqlite_master WHERE type='table' AND name=?").get(table))db.exec(`INSERT INTO ${table} SELECT * FROM saved.${table}`);
    db.exec('COMMIT;DETACH DATABASE saved');count=db.prepare('SELECT count(*) n FROM sequence_records WHERE side=0').get().n;pairs=db.prepare('SELECT count(*) n FROM mapping_pairs').get().n;
   }finally{db.close();}
   const names=['comparison.sqlite','inputs/targets.fasta','inputs/parents.fasta','settings.json'];
   for(const [i,name]of names.slice(1,3).entries())fs.copyFileSync(inputs[i],path.join(folder,name));
   fs.writeFileSync(path.join(folder,'settings.json'),JSON.stringify({floor:m.floor,targetId:m.targetId??null,retainPositions:false,bidirectional:false,targetName:m.target.name,parentName:m.parent.name})+'\n');
   const files={};for(const name of names)files[name]={bytes:fs.statSync(path.join(folder,name)).size,sha256:await pkg.hash(path.join(folder,name))};
   const fields=['schema','method','window','id','name','floor','floors','target','parent','targetId','complete','platforms','createdAt','membershipCoverage'];
   const saved=Object.fromEntries(fields.filter(k=>m[k]!==undefined).map(k=>[k,m[k]]));
   Object.assign(saved,{targetId:m.targetId??null,targets:m.complete?count:m.targets,pairs,files,storage:unified.FORMAT,mappingStorage:unified.FORMAT,preparation:unified.FORMAT,mappingBidirectional:true,bidirectional:false,retainsPositions:false,retainsPairRegions:true,pairRegionStorage:'merged-residue-ranges/1',coverageFloor:10,relationshipsOnly:true,featureOnly:false,output:'unified-mapping'});
   fs.writeFileSync(path.join(folder,'comparison.json'),JSON.stringify(saved,null,2)+'\n');names.push('comparison.json');
   fs.writeFileSync(path.join(folder,'README.txt'),'SeroMap Mapping Database\n\nExtract this ZIP and choose its folder under Workspace → MimicryMap Libraries → Import Mapping Database. One SQLite database supplies saved ranges and statistical memberships in both directions. Installation prepares local query indexes without sequence matching. The original FASTAs let this package install its input libraries on a new computer. CSV summaries are available separately. Full positional lookups are not included.\n');names.push('README.txt');
   outputs.push(await require('./zip-files.cjs').write(path.join(destination,'mapping-database.zip'),names.map(n=>[n,path.join(folder,n)]),report));
  }
 }finally{
  if(path.dirname(temporary)!==destination||!path.basename(temporary).startsWith('.mapping-bundle-'))throw Error('Invalid bundle staging folder');
  fs.rmSync(temporary,{recursive:true,force:true});
 }
 return {outputs};
}
module.exports={build};
if(require.main===module){const [source,destination,product='both']=process.argv.slice(2);if(!source||!destination)throw Error('Usage: node mapping-bundles.cjs comparison-folder output-folder [both|mapping|summaries]');build({source,destination,product},p=>console.error(p.phase)).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});}
