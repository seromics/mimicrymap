#!/usr/bin/env node
'use strict';
// Research CLI around the exact Workspace engine. No Electron or study required.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path');
const {fork, spawnSync} = require('node:child_process');
const {parseArgs} = require('node:util');
const HELP = `MimicryMap library builder — Node.js 24+

node build.cjs --targets targets.fasta --parents parents.fasta --out results
node build.cjs --targets targets.fasta --parents parents.fasta --out results-gpu --engine gpu --python /path/to/python

--floor 7                    Minimum identity, 5–9 on CPU; 7–9 on NVIDIA GPU
--retain-positions           Save full sequence lookups as well as unified mappings
--bidirectional              Save compact complete lookups and summaries in both directions
--target-annotations file    Optional record metadata CSV
--parent-annotations file    Optional record metadata CSV
--target-name name           Display name (default: FASTA filename)
--parent-name name           Display name (default: FASTA filename)
--target-library id          Canonical identity preset; see docs/BUILD.md
--parent-library id          Canonical identity preset; see docs/BUILD.md
--probe-gpu --python path    Check the optional CUDA environment, without a build

All target records are compared. Unified mapping indexes and summaries are the default.
Output must be a new directory. Inputs are retained; completed output is never overwritten.
Import a completed result through SeroMap Workspace → MimicryMap Libraries → Import Mapping Database.
`;
const strings = ['targets','parents','out','floor','engine','python','target-annotations','parent-annotations','target-name','parent-name','target-library','parent-library'];
const booleans = ['help','retain-positions','bidirectional','probe-gpu'];
function options(argv) {
  const {values} = parseArgs({args:argv,options:Object.fromEntries([...strings.map(k=>[k,{type:'string'}]),...booleans.map(k=>[k,{type:'boolean'}])])});
  return values;
}
const presets = new Set(['builtin-human','builtin-viral120','builtin-exposure','builtin-nonvertebrate','builtin-huprot','builtin-huscan','builtin-virscan']);
function validate(input) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('The library builder requires Node.js 24 or later.');
  const config = {...input, floor:Number(input.floor ?? 7), engine:input.engine ?? 'cpu'};
  if (!['cpu','gpu'].includes(config.engine)) throw Error('--engine must be cpu or gpu.');
  if (!Number.isInteger(config.floor) || config.floor<5 || config.floor>9) throw Error('--floor must be an integer from 5 through 9.');
  if (config.engine==='gpu' && (config.floor<7 || !config.python)) throw Error('GPU builds require --floor 7, 8 or 9 and --python pointing to the optional CUDA environment.');
  for (const side of ['target','parent']) {
    const kind=config[side+'-library'];
    if (kind && !presets.has(kind)) throw Error('Unknown '+side+' library preset. Omit it for a custom FASTA.');
  }
  for (const key of ['targets','parents','out']) if (!config[key]) throw Error('Required: --targets, --parents and --out. Use --help.');
  for (const key of ['targets','parents','target-annotations','parent-annotations']) if (config[key]) {
    config[key]=path.resolve(config[key]);
    if (!fs.statSync(config[key]).isFile()) throw Error(key+' must name a file.');
  }
  config.out=path.resolve(config.out);
  if (fs.existsSync(config.out)) throw Error('Output already exists. Choose a new --out directory; completed runs are never overwritten.');
  return config;
}
async function build(input, report = () => {}) {
  const config=validate(input), parent=path.dirname(config.out);
  await fsp.mkdir(parent,{recursive:true});
  const pending=await fsp.mkdtemp(path.join(parent,'.mimicry-build-'));
  let child;
  try {
    const result=await new Promise((resolve,reject)=>{
      let failure, completed;
      child=fork(path.join(__dirname,'tools/build-worker.cjs'),[],{stdio:['ignore','inherit','inherit','ipc'],serialization:'json'});
      const cancel=()=>{failure=Error('Build canceled. No partial result was installed.');child.kill();};
      process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
      child.on('error',error=>{failure=error;});
      child.on('message',message=>{
        if(message.progress)report(message.progress);
        if(message.complete)completed=message.complete;
        if(message.error)failure=Error(message.error);
      });
      child.on('exit',code=>{
        process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
        if(failure)reject(failure);
        else if(code!==0||!completed)reject(Error('Builder stopped before completing (status '+code+').'));
        else resolve(completed);
      });
      child.send({config,pending});
    });
    // Reserve the user-selected name exclusively, including against concurrent builds.
    await fsp.mkdir(config.out);
    try { for(const entry of await fsp.readdir(path.join(pending,'comparison'))) await fsp.rename(path.join(pending,'comparison',entry),path.join(config.out,entry)); }
    catch(error) { await fsp.rm(config.out,{recursive:true,force:true});throw error; }
    return {...result,directory:config.out};
  } finally {
    // pending is created by this process as a direct sibling of the requested output.
    if(path.dirname(pending)!==parent||!path.basename(pending).startsWith('.mimicry-build-'))throw Error('Invalid temporary build directory.');
    await fsp.rm(pending,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
}
async function main() {
  const opts=options(process.argv.slice(2));
  if(opts.help){console.log(HELP);return;}
  if(opts['probe-gpu']) {
    if(!opts.python)throw Error('Supply --python for the optional CUDA environment.');
    const probe=spawnSync(opts.python,['-I',path.join(__dirname,'mimicrymap/workspace/gpu_worker.py'),'--probe'],{stdio:'inherit',windowsHide:true});
    if(probe.error)throw probe.error;
    process.exitCode=probe.status ?? 1;return;
  }
  let last=0,lastPhase='';
  const result=await build(opts,p=>{
    if(p.phase===lastPhase&&Date.now()-last<1000&&p.done!==p.total)return;
    last=Date.now();lastPhase=p.phase;
    const count=Number.isFinite(p.total)&&p.total>0?' · '+Number(p.done||0).toLocaleString()+'/'+p.total.toLocaleString():'';
    console.log((p.phase||'Working')+count+(p.detail?' · '+p.detail:''));
  });
  console.log('Complete: '+result.directory+'\n'+result.output+' · '+result.targets.toLocaleString()+' targets');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={build,validate,options};
