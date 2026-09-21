/* Shared command-line entry point for example-filled and selection-filled packages. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const codeDir=__dirname,base=path.basename(codeDir)==='code'?path.dirname(codeDir):path.resolve(codeDir,'../../reproducibility');
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Run the FASTAs in inputs/ using settings.json:\n  python run.py\n  Rscript run.R\n  node run.cjs\n\nRun as supplied or replace the two FASTAs and edit settings.json. See README.md.');}
else{
 const configPath=args[0]||path.join(base,'settings.json');
 const worker=fs.existsSync(path.join(codeDir,'custom-worker.js'))?path.join(codeDir,'custom-worker.js'):path.join(codeDir,'../custom-worker.js');
 const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const scan=(query,parents,floor)=>{
  const started=process.hrtime.bigint();let last=started;
  return require('./parallel-scan.cjs').scan(worker,query,parents,floor,message=>{
   const now=process.hrtime.bigint();if(message.completed&&message.completed!==message.total&&now-last<2_000_000_000n)return;last=now;
   console.error('  Parents: '+message.completed.toLocaleString()+'/'+message.total.toLocaleString()+' ('+(message.total?Math.floor(100*message.completed/message.total):100)+'%) · '+(Number(now-started)/1e9).toFixed(1)+' s elapsed');
  });
 };
 require('./pipeline.cjs').run({configPath,base,codeDir,core:require('./export-core.js'),scan,digest}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
