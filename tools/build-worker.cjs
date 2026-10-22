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
      retainPositions:!!config['retain-positions'],bidirectional:!!config.bidirectional,targetAnnotations:annotations.target,parentAnnotations:annotations.parent,
      machine:{platform:process.platform,arch:process.arch,node:process.versions.node,cpu:os.cpus()[0]?.model,cpus:os.availableParallelism(),memoryBytes:os.totalmem(),sourceCommit:source.commit},
    },report);
    await engine.exportBundle({source:path.join(pending,'comparison'),destination:path.join(pending,'comparison'),product:'both'},report);
    fs.writeFileSync(path.join(pending,'comparison','README.txt'),
      'MimicryMap Comparison\n\nsummaries.zip: readable CSVs in both directions, original FASTAs and README.\nmapping-database.zip: SeroMap mapping database, original FASTAs and installation settings.\n\nWorking files:\nlibrary_summary.csv: target summaries at the computed identity thresholds.\npair_coverage.csv: unrounded pair coverage at every computed threshold.\ncomparison.sqlite: unified residue ranges, statistical memberships and identities, or optional complete positions with a separate membership-index.sqlite.\ninputs/: exact FASTAs and effective record annotations.\n\nExtract mapping-database.zip and install its folder in SeroMap Workspace > MimicryMap Libraries > Import Mapping Database. This working directory is also accepted. Bind target libraries to assay platforms to use it in Reactivity Enrichment.\n\nReproduce with the MimicryMap research repository: node build.cjs --targets inputs/targets.fasta --parents inputs/parents.fasta --target-annotations inputs/targets.annotations.csv --parent-annotations inputs/parents.annotations.csv --floor '+config.floor+' --out ../reproduced'+(config.bidirectional?' --bidirectional':config['retain-positions']?' --retain-positions':'')+'\nFor NVIDIA acceleration add --engine gpu --python /path/to/CUDA/python.\n\nSequence resemblance is descriptive and does not establish antibody binding or disease causation.\n');
    process.send({complete:{output:result.output,targets:result.targets,pairs:result.pairs,positions:result.positions}},()=>process.disconnect());
  } catch(error) {
    process.exitCode=1;
    process.send({error:error.message},()=>process.disconnect());
  }
});
