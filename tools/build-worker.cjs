'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const engine=require('../mimicrymap/workspace/engine.cjs');
process.once('message',async({config,pending})=>{
  try {
    const report=progress=>process.send?.({progress});
    const directories={targets:path.join(pending,'targets'),parents:path.join(pending,'parents')};
    const annotations={};
    for(const [plural,singular] of [['targets','target'],['parents','parent']]) {
      const library=config[singular+'-library']||plural;
      await engine.importFasta({source:config[plural],directory:directories[plural],id:library,name:config[singular+'-name']||path.basename(config[plural],path.extname(config[plural]))},report);
      const output=path.join(pending,plural+'-annotations');
      await engine.prepareAnnotations({directory:directories[plural],output,library,source:config[singular+'-annotations']},report);
      annotations[singular]=path.join(output,'records.sqlite');
    }
    const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../source-manifest.json')));
    const result=await engine.buildComparison({
      targetDirectory:directories.targets,parentDirectory:directories.parents,directory:path.join(pending,'comparison'),
      id:crypto.randomUUID(),floor:config.floor,backend:config.engine,gpuPython:config.python,
      retainPositions:!!config['retain-positions'],targetAnnotations:annotations.target,parentAnnotations:annotations.parent,
      machine:{platform:process.platform,arch:process.arch,node:process.versions.node,cpu:os.cpus()[0]?.model,cpus:os.availableParallelism(),memoryBytes:os.totalmem(),sourceCommit:source.commit},
    },report);
    fs.writeFileSync(path.join(pending,'comparison','README.txt'),
      'MimicryMap comparison\n\nlibrary_summary.csv: target summaries at the available 7/9–9/9 thresholds.\npair_coverage.csv: unrounded pair coverage at every computed threshold.\ncomparison.sqlite: candidate memberships, identities, and optional complete positions.\ninputs/: exact FASTAs and effective record annotations.\n\nInstall this directory in SeroMap Workspace > MimicryMap Libraries > Install comparison. Bind target libraries to assay platforms to use it in Mimicry candidates.\n\nReproduce with the private MimicryMap research repository: node build.cjs --targets inputs/targets.fasta --parents inputs/parents.fasta --target-annotations inputs/targets.annotations.csv --parent-annotations inputs/parents.annotations.csv --floor '+config.floor+' --out ../reproduced'+(config['retain-positions']?' --retain-positions':'')+'\nFor NVIDIA acceleration add --engine gpu --python /path/to/CUDA/python.\n\nSequence resemblance is descriptive and does not establish antibody binding or disease causation.\n');
    process.send({complete:{output:result.output,targets:result.targets,pairs:result.pairs,positions:result.positions}},()=>process.disconnect());
  } catch(error) {
    process.exitCode=1;
    process.send({error:error.message},()=>process.disconnect());
  }
});
