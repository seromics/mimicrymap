'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {build}=require('../build.cjs');
const engine=require('../mimicrymap/workspace/engine.cjs');
const input=require('../mimicrymap/frontend/reproduce/fasta-input.js');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mimicrymap-research-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200}));
  const targets=path.join(dir,'targets.fasta'),parents=path.join(dir,'parents.fasta');
  fs.writeFileSync(targets,'>target1\nACDEFGHIKLMNPQACDEFGHIK\n>target2\nACDEXGHIK\n>short\nACD\n>unmatched\nWWWWWWWWW\n');
  fs.writeFileSync(parents,'>parent1\nACDEFGHIKLMNPQ\n>duplicate\nACDEFGHIKLMNPQ\n>parent2\nACDEXGHIK\n');
  const annotation=path.join(dir,'parents.csv');
  fs.writeFileSync(annotation,'record_id,gene,accession,description,organism,taxid,reference_set\nparent1,GENE1,PARENT1,Example protein,Example organism,9606,Example set\n');
  return {dir,targets,parents,annotation};
}
function rows(directory,table) {
  const db=new DatabaseSync(path.join(directory,'comparison.sqlite'),{readOnly:true});
  try{return db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>row.result?{...row,result:JSON.parse(zlib.gunzipSync(row.result))}:row);}finally{db.close();}
}
function events(result) {
  return result.positional_matches.flatMap(row=>row.hits.map(hit=>[result.source_catalog.find(p=>p.protein_idx===row.protein_idx).raw_header,...hit.slice(0,3)]));
}
test('fresh FASTAs and annotations produce installable candidate and full-lookup packages with the same scientific CSVs',async t=>{
  const f=fixture(t),base={targets:f.targets,parents:f.parents,'parent-annotations':f.annotation};
  const candidate=await build({...base,out:path.join(f.dir,'candidate')});
  const full=await build({...base,out:path.join(f.dir,'full'),'retain-positions':true});
  const manifest=await engine.validateComparison(candidate.directory);
  assert.equal(manifest.complete,true);assert.equal(manifest.retainsPositions,false);assert.equal(manifest.targets,4);
  assert.equal((await engine.validateComparison(full.directory)).retainsPositions,true);
  for(const file of ['library_summary.csv','pair_coverage.csv'])assert.deepEqual(fs.readFileSync(path.join(candidate.directory,file)),fs.readFileSync(path.join(full.directory,file)));
  const memberships=rows(candidate.directory,'pairs');
  assert(memberships.length>0);assert(memberships.some(row=>row.organism==='Example set'));
  assert(rows(candidate.directory,'results').every(row=>row.result===null));
  assert.equal(fs.readFileSync(path.join(candidate.directory,'inputs/parents.fasta'),'utf8'),fs.readFileSync(f.parents,'utf8'));
  await assert.rejects(build({...base,out:candidate.directory}),/already exists/);
  assert.equal((await engine.validateComparison(candidate.directory)).targets,4);
  assert(!fs.readdirSync(f.dir).some(name=>name.startsWith('.mimicry-build-')));

  // Independent browser worker comparison: duplicated records and X mismatches survive.
  const queries=input.parse(fs.readFileSync(f.targets,'utf8'),'query',1).records;
  const parents=input.parseParents(fs.readFileSync(f.parents,'utf8')).records;
  const stored=rows(full.directory,'results');
  for(let i=0;i<queries.length;i++) {
    let matches;
    const context={self:{postMessage:m=>{if(m.type==='complete')matches=m.summaries;}}};
    vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../mimicrymap/frontend/custom-worker.js'),'utf8'),context);
    context.self.onmessage({data:{type:'scan',query:queries[i],targets:parents,floor:7,chunkOffset:0}});
    const expected=JSON.parse(JSON.stringify(matches.flatMap(row=>row.hits.map(hit=>[parents[row.protein_index].raw_header,...hit.slice(0,3)]))));
    assert.deepEqual(events(stored[i].result),expected);
  }
});
test('invalid metadata and unsupported GPU settings leave no completed or temporary output',async t=>{
  const f=fixture(t),out=path.join(f.dir,'invalid');
  fs.writeFileSync(f.annotation,'record_id,gene\nunknown,NOPE\n');
  await assert.rejects(build({targets:f.targets,parents:f.parents,out,'parent-annotations':f.annotation}),/unmatched record IDs/);
  assert(!fs.existsSync(out));assert(!fs.readdirSync(f.dir).some(name=>name.startsWith('.mimicry-build-')));
  await assert.rejects(build({targets:f.targets,parents:f.parents,out,engine:'gpu',floor:'6',python:'python'}),/GPU builds require/);
});
test('NVIDIA and CPU retain equivalent scientific CSVs, memberships and all coordinates, including self exclusion',{skip:!process.env.MIMICRY_GPU_PYTHON},async t=>{
  const f=fixture(t),base={targets:f.targets,parents:f.targets,'retain-positions':true};
  const cpu=await build({...base,out:path.join(f.dir,'cpu')});
  const gpu=await build({...base,out:path.join(f.dir,'gpu'),engine:'gpu',python:process.env.MIMICRY_GPU_PYTHON});
  for(const file of ['library_summary.csv','pair_coverage.csv'])assert.deepEqual(fs.readFileSync(path.join(cpu.directory,file)),fs.readFileSync(path.join(gpu.directory,file)));
  assert.deepEqual(rows(cpu.directory,'pairs'),rows(gpu.directory,'pairs'));
  assert.deepEqual(rows(cpu.directory,'aliases'),rows(gpu.directory,'aliases'));
  const a=rows(cpu.directory,'results'),b=rows(gpu.directory,'results');
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++)assert.deepEqual(events(a[i].result),events(b[i].result));
  await engine.validateComparison(gpu.directory);
});
