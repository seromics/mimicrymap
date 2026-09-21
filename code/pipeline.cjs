/* Editable FASTA/settings entry point. Uses the existing CPU worker and export contract. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const elapsed=started=>Number(((performance.now()-started)/1000).toFixed(3));
function parseFasta(bytes,label,digest,role='query'){
 const input=require('./fasta-input.js'),text=bytes.toString('utf8');
 const parsed=role==='target'?input.parseParents(text):input.parse(text,role,1);
 if(parsed.errors.length)throw Error(label+': '+parsed.errors.join(' '));
 return parsed.records.map((record,index)=>({...record,
  ...(role==='target'?require('./fasta-input.js').parentRecord(record):{}),
  input_record:index+1}));
}

async function run({configPath,base,codeDir,layout,core,scan,digest}){
 const runStarted=performance.now();
 if(!configPath)throw Error('Use node run.cjs with settings.json in the package root.');
 const file=path.resolve(configPath),configRoot=path.dirname(file),settings=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const required=['schema','antigen_target_fasta','mimicry_parents_fasta','min_identity','output_directory'];
 if(Object.keys(settings).some(k=>![...required,'selected_target_start'].includes(k))||required.some(k=>!Object.hasOwn(settings,k)))throw Error('settings.json requires: '+required.join(', ')+'. selected_target_start is optional.');
 if(settings.schema!=='mimicryone/pipeline-settings/1')throw Error('Unsupported settings schema.');
 for(const key of ['antigen_target_fasta','mimicry_parents_fasta','output_directory'])if(typeof settings[key]!=='string'||!settings[key].trim())throw Error(key+' must be a nonempty path.');
 const floor=settings.min_identity,start=settings.selected_target_start??null;
 if(!Number.isInteger(floor)||floor<5||floor>9)throw Error('min_identity must be an integer from 5 through 9.');
 if(start!==null&&(!Number.isInteger(start)||start<1))throw Error('selected_target_start must be null or a positive 1-based coordinate.');
 const output=path.resolve(configRoot,settings.output_directory),relative=path.relative(configRoot,output);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('output_directory must be a subfolder of the package.');
 for(let current=output;current!==configRoot;current=path.dirname(current))if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Output paths cannot use symbolic links.');
 const targetPath=path.resolve(configRoot,settings.antigen_target_fasta),parentPath=path.resolve(configRoot,settings.mimicry_parents_fasta);
 if([file,targetPath,parentPath,codeDir].some(p=>p===output||p.startsWith(output+path.sep)))throw Error('Output cannot contain settings, input files, or calculation code.');
 function inventory(folder,prefix=''){
  return fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
   const rel=prefix+entry.name,full=path.join(folder,entry.name);
   if(entry.isSymbolicLink()||(!entry.isFile()&&!entry.isDirectory()))throw Error('Output contains an unmanaged file: '+rel);
   return entry.isDirectory()?inventory(full,rel+'/'):[rel];
  }).sort();
 }
 function managedOutput(){
  if(!fs.existsSync(output))return null;
  const marker=path.join(output,'run.json');
  if(!fs.existsSync(marker))throw Error('Existing output is not a managed MimicryMap run. Choose another output_directory.');
  const bytes=fs.readFileSync(marker),record=JSON.parse(bytes);
  if(!['mimicryone/pipeline-run/2','mimicryone/pipeline-run/3'].includes(record.schema)||(!record.files&&!record.files_sha256))throw Error('Existing output uses an earlier format. Choose a fresh output_directory once.');
  const expected=[...(record.files||Object.keys(record.files_sha256)),'run.json'].sort(),actual=inventory(output);
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Output contains added or missing files. Choose another output_directory to preserve them.');
  return bytes.toString('utf8');
 }
 const previousRun=managedOutput();
 const targetBytes=fs.readFileSync(targetPath),parentBytes=fs.readFileSync(parentPath);
 let queries=parseFasta(targetBytes,settings.antigen_target_fasta,digest),parents=parseFasta(parentBytes,settings.mimicry_parents_fasta,digest,'target');
 const selectionHelper=require('./pipeline-selection.js'),selectionPath=path.join(configRoot,'inputs/selection.json');
 const savedSelection=fs.existsSync(selectionPath)?JSON.parse(fs.readFileSync(selectionPath,'utf8')):null;
 const referencePath=path.join(configRoot,'inputs/mapped-records.fasta');
 const references=savedSelection?.input_signatures?.references&&fs.existsSync(referencePath)?parseFasta(fs.readFileSync(referencePath),'Mapped records FASTA',digest,'target'):[];
 const selected=await selectionHelper.restore(savedSelection,queries,parents,references);
 if(selected){queries=[selected.query];parents=selected.parents;}
 else if(savedSelection)console.error('Using the supplied FASTA records without the previous library mappings.');
 const annotationPath=path.join(configRoot,'inputs/residue-annotations.json');
 const annotations=selected&&fs.existsSync(annotationPath)?JSON.parse(fs.readFileSync(annotationPath,'utf8')):null;
 const identity=require(fs.existsSync(path.join(codeDir,'mimicryone-identity.js'))?path.join(codeDir,'mimicryone-identity.js'):path.join(codeDir,'../mimicryone-identity.js'));
 const publicId=q=>identity.publicText(q.display_accession||q.source_accession||q.protein_id)||identity.resolve(q).primaryLine;
 for(const q of queries)if(start!==null&&start>q.length-8)throw Error('selected_target_start exceeds the last complete 9-mer start for '+q.protein_id+'.');
 const work=queries.reduce((n,q)=>n+Math.max(0,q.length-8),0)*parents.reduce((n,p)=>n+Math.max(0,p.length-8),0);
 console.error('Inputs: '+queries.length+' Antigen Target record(s), '+parents.length+' Mimicry Parent record(s).');
 console.error('Min Identity: '+floor+'/9; '+work.toLocaleString()+' window comparisons. CPU only; no network.');
 const captured=new Date().toISOString(),completed=[],writtenFiles=[],summaryRows=[];let summaryFormat;
 const scanFloor=Math.min(floor,7),sameLibrary=targetBytes.equals(parentBytes);
 console.error('Summary: 7/9, 8/9, 9/9; paired coverage (%) Parent|Target, listed when either side reaches 10% before rounding.');
 const loci=require(path.join(codeDir,'residue-coverage.js')).overlapGroups;
 const json=value=>JSON.stringify(value,null,2)+'\n';
 const parent=path.dirname(output);fs.mkdirSync(parent,{recursive:true});
 const pending=fs.mkdtempSync(path.join(parent,'.mimicry-pending-'));
 console.error('Staging output (in progress): '+pending);
 const put=(name,value)=>{const destination=path.join(pending,name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,value);writtenFiles.push(name);};
 const removeManagedTemp=folder=>{if(path.dirname(folder)!==parent||!/^\.mimicry-(pending|previous)-/.test(path.basename(folder)))throw Error('Invalid temporary output path.');fs.rmSync(folder,{recursive:true,force:true});};
 try{
  if(annotations)put('inputs/residue-annotations.json',json(annotations));
  put('inputs/antigen-target.fasta',targetBytes);put('inputs/mimicry-parents.fasta',parentBytes);
  const metadata=records=>records.map(({sequence,...record})=>record);
  put('records.json',json({antigen_targets:metadata(queries),mimicry_parents:metadata(parents)}));
  for(const [i,query]of queries.entries()){
   console.error('Target '+(i+1)+'/'+queries.length+': '+publicId(query));
   const targetStarted=performance.now();
   let result;
   if(selected?.projection){
    const groups=await require('./projected-events.js').computeAsync(selected.projection,scan,scanFloor);
    result=selectionHelper.resultFromEvents(query,selected.projection.parent_entities,groups,scanFloor,selected.parameters,require('./residue-coverage.js'));
   }else{
    const scanParents=sameLibrary?parents.filter((p,j)=>j!==i):parents;
    const hits=await scan(query,scanParents,scanFloor);
  const source_catalog=hits.map(s=>({...scanParents[s.protein_index],protein_idx:s.protein_index}));
  const positional_matches=hits.map(s=>({protein_idx:s.protein_index,protein_id:s.protein_id,best_identity:s.best_identity,hits_columns:['target_start','source_start','identity','source_9mer'],hits:s.hits}));
  const ranked_matches=hits.map(s=>{const qs=s.hits.map(h=>h[0]),ps=s.hits.map(h=>h[1]);return {protein_index:s.protein_index,protein_id:s.protein_id,best_identity:s.best_identity,floors:{['m'+floor]:{pairs:s.hits.length,target_windows:new Set(qs).size,source_windows:new Set(ps).size,target_loci:loci(qs),source_loci:loci(ps)}}};});
  result={schema:'mimicryone/result/1',origin:'custom',complete_in_memory:true,protein:{...require('./fasta-input.js').targetRecord(query),library_id:query.library_id,organism:query.organism},source_catalog,positional_matches,ranked_matches,available_floors:[floor],
   parameters:{floor,source_scope:'custom',source_scope_label:'Supplied Mimicry Parent FASTA',source_entity_level:'parent_record',source_entity_label:'parent records',window:9,coordinates:'1-based starts and inclusive ends'},result_id:'cpu:'+query.protein_id,
   inputs:{execution:'offline_fasta_pipeline',input_source:selected?selected.scope_label:'Supplied FASTA'},
   provenance:{execution:'offline CPU; shared browser worker'},statistics_status:{state:'descriptive_only',p_values:false,q_values:false}};

    if(selected){result.protein=query;result.parameters={...selected.parameters,...result.parameters,source_scope:selected.parameters.source_scope,source_scope_label:selected.scope_label};}
   }
   const windowCount=Math.max(0,query.sequence.length-8),coverageCore=require('./residue-coverage.js');
   const testedWindows=selected?.projection?selected.projection.query_children.flatMap(c=>c.mappings.filter(m=>m.end0-m.start0>=9).map(m=>[m.start0+1,m.end0-8])):(windowCount?[[1,windowCount]]:[]);
   result.parameters.summary_query_windows_complete=coverageCore.size(coverageCore.union(testedWindows,windowCount))===windowCount;
   // One complete scan at the lowest needed floor supports every higher threshold.
   result.available_floors=Array.from({length:10-scanFloor},(_,i)=>scanFloor+i);
   const byIndex=new Map(result.positional_matches.map(r=>[r.protein_idx,r]));
   for(const rank of result.ranked_matches){
    const source=byIndex.get(rank.protein_index);
    for(const t of result.available_floors){const hits=source.hits.filter(h=>h[2]>=t),qs=hits.map(h=>h[0]),ps=hits.map(h=>h[1]);rank.floors['m'+t]={pairs:hits.length,target_windows:new Set(qs).size,source_windows:new Set(ps).size,target_loci:loci(qs),source_loci:loci(ps)};}
   }
   const timings={scan:elapsed(targetStarted)},exportStarted=performance.now();
   console.error('  Preparing export tables…');
   const data=core.tables(result,floor,start,selected?.ranking),summary=core.comparisonSummary(result,floor,data);
   timings.export=elapsed(exportStarted);
   const writeStarted=performance.now();
   const targetDir='targets/'+String(i+1).padStart(3,'0')+'-'+publicId(query).replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').slice(0,60);
   put(targetDir+'/all-matches.csv',data.matchesCsv);put(targetDir+'/overall-mimicry-parents.csv',data.parentsCsv);
   if(start!==null)put(targetDir+'/current-window-slice.csv',data.siteCsv);
   const nativeSummary=core.summaryTable(result,[7,8,9],annotations);summaryFormat=nativeSummary;summaryRows.push(nativeSummary.row);
   put(targetDir+'/comparison_summary.csv',nativeSummary.csv);
   timings.write=elapsed(writeStarted);timings.total=elapsed(targetStarted);
   completed.push({id:publicId(query),path:targetDir,summary,timings_seconds:timings,...(start!==null?{selected_window_pairs:data.site.length}:{})});
   console.error('  Saved tables: '+path.join(pending,targetDir));
   console.error('  Target complete: '+timings.total+' s (scan '+timings.scan+' s; export '+timings.export+' s; write '+timings.write+' s).');
  }
  if(summaryFormat)put('library_summary.csv',summaryFormat.serialize(summaryRows));
  put('README.md','# MimicryMap Results\n\nlibrary_summary.csv has one row per target at 7/9, 8/9 and 9/9, with Shared and Uncovered Residue Regions, All Matching Parent Count, and paired Parent|Target coverage lists (one decimal; at least 10% on either side before rounding). Each targets/ folder contains comparison_summary.csv, All Matches and Overall Mimicry Parents. A Current window slice appears only when selected_target_start is set. run.json captures settings and summaries; records.json contains all input record metadata. The two original FASTA inputs are captured once in inputs/.\n\nRerunning the launcher refreshes this managed output folder. Choose another output_directory in settings.json to keep a separate run. Calculation code stays in the tool package.\n');
  const record={schema:'mimicryone/pipeline-run/3',export_schema:core.version,captured_utc:captured,settings:{...settings,selected_target_start:start},
   target_records:queries.length,parent_records:parents.length,window_comparisons:work,
   summary:{schema:"mimicryone/native-summary/6",identity_min:[7,8,9],suggested_coverage_cutoffs:[10,20,40,60,80],scan_floor:scanFloor,self_record_exclusion:sameLibrary},
   input_source:selected?selected.scope_label:'Supplied FASTA records',
   runtime:process.version,cpu_workers:require('./parallel-scan.cjs').workerCount(parents.length),files:writtenFiles,targets:completed};
  fs.writeFileSync(path.join(pending,'run.json'),json(record));
  if(managedOutput()!==previousRun)throw Error('Output changed during the run; previous results were preserved.');
  let previous=null;
  if(previousRun){previous=fs.mkdtempSync(path.join(parent,'.mimicry-previous-'));fs.rmdirSync(previous);fs.renameSync(output,previous);}
  try{fs.renameSync(pending,output);}catch(error){if(previous)fs.renameSync(previous,output);throw error;}
  if(previous)removeManagedTemp(previous);
 }catch(error){if(fs.existsSync(pending))removeManagedTemp(pending);throw error;}
 console.error('Completed in '+elapsed(runStarted)+' s. Output: '+output);
 console.log(JSON.stringify({completed:true,output,target_records:queries.length,parent_records:parents.length,targets:completed},null,2));
}
module.exports={run,parseFasta};
