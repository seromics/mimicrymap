#!/usr/bin/env node
/* Retained offline snapshot-bundle runner for compatibility with earlier downloads.
 * The current editable-FASTA pipeline starts at pipeline-runner.cjs; see README.md.
 * This legacy entry keeps its original layout and checksum rules. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const packaged=path.basename(__dirname)==='run'&&fs.existsSync(path.join(__dirname,'../code/bundle-layout.json'));
const base=packaged?path.resolve(__dirname,'..'):__dirname;
const codeDir=packaged?path.join(base,'code'):__dirname;
const resolve=name=>{
 const file=path.resolve(base,name);
 if(!file.startsWith(base+path.sep))throw Error('Invalid manifest path: '+name);
 return file;
};
const read=name=>fs.readFileSync(resolve(name));
const parse=name=>JSON.parse(read(name));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const layout=packaged?parse('code/bundle-layout.json'):null;
const fileRole=(key,legacy)=>layout?layout.files[key].path:legacy;
const tableFiles=layout?Object.fromEntries(Object.entries(layout.files).filter(([,s])=>s.table).map(([key,s])=>[s.path,key])):
 {'matches.csv':'matchesCsv','selected-window.csv':'siteCsv','parents.csv':'parentsCsv','assay-mappings.csv':'mappingsCsv'};
let core;
function loadCore(){core=require(path.join(codeDir,'export-core.js'));}
function verifyFiles(manifest,sourceOnly=false){
 if(layout){
  if(!['mimicryone/reproducibility-layout/2','mimicryone/reproducibility-layout/3'].includes(layout.schema)||manifest.layout_schema!==layout.schema)throw Error('Unsupported reproducibility package layout');
  for(const spec of Object.values(layout.files)){
   if(sourceOnly&&(!spec.source||spec.bundle_only))continue;
   if(!spec.optional||fs.existsSync(resolve(spec.path))){
    if(!Object.prototype.hasOwnProperty.call(manifest.files_sha256,spec.path))throw Error('Required file missing from checksum manifest: '+spec.path);
   }
  }
 }
 for(const [name,expected]of Object.entries(manifest.files_sha256)){
  if(digest(read(name))!==expected)throw Error('Input or code checksum mismatch: '+name);
 }
}
function scan(query,targets,floor){
 const started=process.hrtime.bigint();let lastReport=started;
 function progress(message){
  const now=process.hrtime.bigint();
  if(message.completed!==0&&message.completed!==message.total&&now-lastReport<2_000_000_000n)return;
  lastReport=now;
  const percent=message.total?Math.floor(100*message.completed/message.total):100;
  console.error('  Parents: '+message.completed.toLocaleString()+'/'+message.total.toLocaleString()+' ('+percent+'%) · '+(Number(now-started)/1e9).toFixed(1)+' s elapsed');
 }
 const worker=fs.existsSync(path.join(codeDir,'custom-worker.js'))?path.join(codeDir,'custom-worker.js'):path.join(codeDir,'..','custom-worker.js');
 return require(path.join(codeDir,'parallel-scan.cjs')).scan(worker,query,targets,floor,progress);
}
async function scanNew(){
 const [queryPath,parentPath,threshold,outputPath]=process.argv.slice(3),floor=Number(threshold);
 if(!queryPath||!parentPath||!outputPath||!Number.isInteger(floor)||floor<5||floor>9)throw Error('Usage: node run/reproduce.cjs --scan antigen-target-records.json mimicry-parent-records.json 7 NEW_OUTPUT_DIRECTORY');
 function records(file){
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows)||!rows.length)throw Error('Expected a nonempty record array.');
  const seen=new Set();return rows.map((r,i)=>{
   const id=String(r.protein_id||r.source_id||r.antigen_id||'record-'+(i+1));
   if(seen.has(id))throw Error('Duplicate record ID: '+id);seen.add(id);
   if(typeof r.sequence!=='string'||!/^[ACDEFGHIKLMNPQRSTVWYX]*$/.test(r.sequence))throw Error('Supply normalized uppercase sequences (canonical residues or X); no normalization is silently performed.');
   const header=r.raw_header||r.header||r.seqid||id;
   return {...r,protein_id:id,length:r.sequence.length,header,raw_header:header,seqid:r.seqid||header};
  });
 }
 const queries=records(queryPath),parents=records(parentPath),output=path.resolve(outputPath);
 if(fs.existsSync(output))throw Error('Output directory already exists; choose a new directory.');
 const completed=[];
 const loci=require(path.join(codeDir,'residue-coverage.js')).overlapGroups;
 console.error('CPU-only complete comparisons. Ctrl+C cancels. Distinct input IDs are retained; no self-exclusion is inferred.');
 for(const query of queries){
  const summaries=await scan(query,parents,floor),catalogue=summaries.map(s=>({...parents[s.protein_index],protein_idx:s.protein_index}));
  const positional=summaries.map(s=>({protein_idx:s.protein_index,protein_id:s.protein_id,best_identity:s.best_identity,hits_columns:['target_start','source_start','identity','source_9mer'],hits:s.hits}));
  const ranked=summaries.map(s=>{const qs=s.hits.map(h=>h[0]),ps=s.hits.map(h=>h[1]);return {protein_index:s.protein_index,protein_id:s.protein_id,floors:{['m'+floor]:{pairs:s.hits.length,target_windows:new Set(qs).size,source_windows:new Set(ps).size,target_loci:loci(qs),source_loci:loci(ps)}}};});
  ranked.forEach((r,i)=>{r.best_identity=summaries[i].best_identity;});
  const result={schema:'mimicryone/result/1',origin:'custom',complete_in_memory:true,
   protein:query,source_catalog:catalogue,positional_matches:positional,ranked_matches:ranked,available_floors:[floor],
   parameters:{floor,source_scope:'explicit JSON input population',window:9,coordinates:'1-based window starts, inclusive interval ends'},result_id:'cpu:'+query.protein_id,
   inputs:{reproduction_parents:parents,query_fasta:[query]},
   provenance:{execution:'offline CPU; shared browser worker'},statistics_status:{state:'descriptive_only',p_values:false,q_values:false}};
  completed.push({query,result,data:core.tables(result,floor,1)});
 }
 fs.mkdirSync(output,{recursive:false});
 completed.forEach(({query,result,data},i)=>{const dir=path.join(output,String(i+1));fs.mkdirSync(dir);for(const [name,text]of Object.entries({'matches.csv':data.matchesCsv,'selected-window.csv':data.siteCsv,'parents.csv':data.parentsCsv,'assay-mappings.csv':data.mappingsCsv}))fs.writeFileSync(path.join(dir,name),text);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));});
 fs.writeFileSync(path.join(output,'run.json'),JSON.stringify({schema:core.version,floor,queries:queries.length,parent_records:parents.length,parent_windows:parents.reduce((n,r)=>n+Math.max(0,r.length-8),0),target_sha256:digest(fs.readFileSync(queryPath)),parent_sha256:digest(fs.readFileSync(parentPath)),self_policy:'none; exact supplied records retained',statistics:'descriptive only'},null,2));
 console.log('Completed '+completed.length+' target(s): '+output);
}
async function main(){
 if(process.argv.includes('--help')||process.argv.includes('-h')){
  console.log('Reproduce a frozen comparison: node run/reproduce.cjs [--rescan]\nOptional wrappers: python run/reproduce.py, Rscript run/reproduce.R\nNew FASTA/settings run: node run.cjs (or node run/reproduce.cjs --config settings.json)\nNew explicit-input run: node run/reproduce.cjs --scan antigen-target-records.json mimicry-parent-records.json 7 NEW_OUTPUT_DIRECTORY\nSee README.md and docs/RUNNING.md.');
  return;
 }
 if(process.argv[2]==='--config'){
  if(packaged)verifyFiles(parse(fs.existsSync(resolve('source-manifest.json'))?'source-manifest.json':'manifest.json'),fs.existsSync(resolve('source-manifest.json')));
  loadCore();await require(path.join(codeDir,'pipeline.cjs')).run({configPath:process.argv[3],base,codeDir,layout,core,scan,digest});return;
 }
 if(process.argv[2]==='--scan'){
  if(packaged)verifyFiles(parse(fs.existsSync(resolve('source-manifest.json'))?'source-manifest.json':'manifest.json'),fs.existsSync(resolve('source-manifest.json')));
  loadCore();await scanNew();return;
 }
 if(process.argv.slice(2).some(arg=>arg!=='--rescan'))throw Error('Unknown option. Run with --help for supported commands.');
 if(!fs.existsSync(resolve(fileRole('snapshot','snapshot.json'))))throw Error('This is the public CPU pipeline. Fill the two FASTA files, edit settings.json, then run node run.cjs from the package root. See README.md.');
 const manifest=parse('manifest.json');
 verifyFiles(manifest);
 loadCore();
 const snapshot=parse(fileRole('snapshot','snapshot.json'));
 let rescanVerification='not_requested';
 const data=core.tables(snapshot.result,snapshot.floor,snapshot.viewState.selected_start,snapshot.viewState.ranking);
 if(data.matches.length!==manifest.counts.matched_pairs||data.parents.length!==manifest.counts.matched_parents)throw Error('Manifest row counts disagree.');
 if(manifest.summary&&JSON.stringify(core.comparisonSummary(snapshot.result,snapshot.floor,data))!==JSON.stringify(manifest.summary))throw Error('Reproduced comparison summary differs.');
 const outputs=Object.fromEntries(Object.entries(tableFiles).map(([name,key])=>[name,data[key]]));
 for(const [name,value]of Object.entries(outputs))if(digest(Buffer.from(value))!==manifest.files_sha256[name])throw Error('Reproduced output differs: '+name);
 if(process.argv.includes('--rescan')){
  const mappedFile=resolve(fileRole('projection','projection-inputs.json'));
  if(fs.existsSync(mappedFile)){
   const plan=parse(fileRole('projection','projection-inputs.json'));
   if(plan.query.sequence!==snapshot.result.protein.sequence)throw Error('Reproduction target differs from displayed target');
   const supplied=parse(fileRole('parentRecords','parent-records.json')).map(r=>String(r.antigen_id)).sort();
   const mapped=plan.parent_children.map(r=>String(r.record.antigen_id)).sort();
   if(JSON.stringify(supplied)!==JSON.stringify(mapped))throw Error('Reproduction mapping population differs from exported inputs');
   const windowCount=rows=>rows.reduce((n,r)=>n+Math.max(0,r.record.sequence.length-8),0);
   console.error('CPU mapped scan: at most '+(windowCount(plan.query_children)*windowCount(plan.parent_children)).toLocaleString()+' tile-window comparisons. Ctrl+C cancels.');
   const groups=await require(path.join(codeDir,'projected-events.js')).computeAsync(plan,scan,snapshot.floor);
   const rebuilt=structuredClone(snapshot.result),used=new Set();
   const coverage=require(path.join(codeDir,'residue-coverage.js'));
   for(const row of rebuilt.positional_matches){
    const events=groups.get(String(row.protein_idx))||[];used.add(String(row.protein_idx));
    row.hits=events.map(e=>e.hit);
    row.hit_provenance=events.map((e,i)=>({projection:{hit_index:i,contributions:[...e.contributions.values()]}}));
    const rank=rebuilt.ranked_matches.find(r=>r.protein_index===row.protein_idx);
    for(let f=snapshot.floor;f<=9;f++){
     const hits=row.hits.filter(h=>h[2]>=f),qs=new Set(hits.map(h=>h[0])),ps=new Set(hits.map(h=>h[1]));
     rank.floors['m'+f]={pairs:hits.length,target_windows:qs.size,source_windows:ps.size,
      target_loci:coverage.overlapGroups(qs),source_loci:coverage.overlapGroups(ps)};
    }
   }
   if([...groups.keys()].some(key=>!used.has(key)))throw Error('Independent scan found an unexpected mapped parent');
   const regenerated=core.tables(rebuilt,snapshot.floor,snapshot.viewState.selected_start,snapshot.viewState.ranking);
   for(const [name,key]of Object.entries(tableFiles))
    if(regenerated[key]!==outputs[name])throw Error('Independent mapped rescan differs: '+name);
   rescanVerification='mapped_inputs_and_exported_csvs_byte_identical';
   console.error('CPU mapped rescan: all exported CSVs agree byte-for-byte.');
  }else{
  if(snapshot.result.positional_matches.some(r=>(r.hit_provenance||[]).some(p=>p?.projection?.contributions?.length)) &&
     snapshot.result.inputs?.analysis_scan?.execution_mode==='precomputed_player')
   throw Error('This older bundle lacks complete selected input mappings. Download a new bundle; saved-result table reproduction remains available.');
  const records=parse(fileRole('parentRecords','parent-records.json')),query=snapshot.result.protein;
  if(records.some(r=>typeof r.sequence!=='string')){
   const parsed=require(path.join(codeDir,'fasta-input.js')).parse(read(fileRole('parents','parents.fasta')).toString('utf8'),'target');
   if(parsed.errors.length||parsed.records.length!==records.length)throw Error('Parent FASTA and metadata disagree.');
   records.forEach((r,i)=>{r.sequence=parsed.records[i].sequence;if(r.length!==r.sequence.length)throw Error('Parent length and FASTA disagree.');});
  }
  const catalogue=new Map(snapshot.result.source_catalog.map(r=>[String(r.antigen_id??r.protein_id),r]));
  const targets=records.map((r,index)=>({...r,protein_id:catalogue.get(String(r.antigen_id??r.protein_id??r.source_id))?.protein_id||r.protein_id||r.source_id||'input:'+r.antigen_id||index}));
  const work=Math.max(0,query.sequence.length-8)*targets.reduce((sum,r)=>sum+Math.max(0,r.sequence.length-8),0);
  console.error('CPU scan: '+work.toLocaleString()+' window comparisons. Ctrl+C cancels; no partial outputs are written.');
  const summaries=await scan(query,targets,snapshot.floor);
  const keys=(rows)=>rows.map(r=>[r.parent_id,r.target_start,r.parent_start,r.identity,r.parent_9mer].join('\t')).sort();
  const actual=keys(summaries.flatMap(s=>s.hits.map(h=>({parent_id:s.protein_id,target_start:h[0],parent_start:h[1],identity:h[2],parent_9mer:h[3]}))));
  const expected=keys(data.matches);
  if(actual.length!==expected.length||actual.some((key,i)=>key!==expected[i]))throw Error('CPU event parity failed. This projected/filtered comparison cannot be claimed equivalent to a flat FASTA rescan. Existing outputs are unchanged.');
  rescanVerification='direct_inputs_coordinate_pair_identity_and_core_parity';
  console.error('CPU rescan: every coordinate pair and identity agrees.');
  }
 }
 const output=path.join(base,'reproduced');fs.mkdirSync(output,{recursive:true});
 const verifiedOutputs=Object.entries(outputs).map(([name,value])=>({
  expected:name,reproduced:'reproduced/'+path.basename(name),expected_sha256:manifest.files_sha256[name],
  reproduced_sha256:digest(Buffer.from(value)),byte_identical:true}));
 const report={verified:true,mode:process.argv.includes('--rescan')?'independent_cpu_rescan':'frozen_table_reproduction',
  files_verified:Object.keys(manifest.files_sha256).length,table_verification:'exported_csvs_byte_identical',
  independent_rescan:rescanVerification,outputs:verifiedOutputs,
  matched_pairs:data.matches.length,matched_parents:data.parents.length,
  selected_start:snapshot.viewState.selected_start,selected_window_pairs:data.site.length,
  scope_label:snapshot.scope_label??manifest.scope_label??null,threshold:snapshot.floor,
  antigen_target_coverage_all_matching_records:data.coverage.target,
  ...(core.comparisonSummary?{summary:core.comparisonSummary(snapshot.result,snapshot.floor,data)}:{}),
  record_mappings:manifest.files_sha256[fileRole('recordMappings','record-mappings.json')]?'checksum_verified_frozen_reference_not_regenerated':'not_included',output};
 for(const [name,value]of Object.entries(outputs))fs.writeFileSync(path.join(output,path.basename(name)),value);
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
