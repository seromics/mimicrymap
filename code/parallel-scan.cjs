/* Node execution adapter for the unchanged browser scanner. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),os=require('node:os');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread){
 global.self={postMessage:message=>parentPort.postMessage(message)};
 require(workerData.scanner);
 self.onmessage({data:workerData.request});
}else{
 function workerCount(count){
  const requested=process.env.MIMICRY_WORKERS;
  if(requested!==undefined&&(!/^[1-9][0-9]*$/.test(requested)||!Number.isSafeInteger(Number(requested))))throw Error('MIMICRY_WORKERS must be a positive safe integer.');
  const available=os.availableParallelism?os.availableParallelism():os.cpus().length;
  const limit=Math.max(1,Math.min(count,requested===undefined?Math.max(1,available-Math.ceil(available/8)):Number(requested)));
  return count?Math.ceil(count/Math.ceil(count/limit)):1;
 }
 async function scan(scanner,query,targets,floor,progress=()=>{}){
  const count=workerCount(targets.length);
  console.error('  CPU workers: '+count);
  progress({completed:0,total:targets.length});
  if(!targets.length)return [];
  if(count===1){
   let summaries;
   const context={self:{postMessage(message){
    if(message.type==='progress')progress(message);
    else if(message.type==='complete')summaries=message.summaries;
   }}};
   vm.createContext(context);vm.runInContext(fs.readFileSync(scanner,'utf8'),context,{filename:'custom-worker.js'});
   context.self.onmessage({data:{type:'scan',query,targets,floor,chunkOffset:0}});
   if(!summaries)throw Error('CPU scanner did not complete.');
   return summaries;
  }
  const size=Math.ceil(targets.length/count),workers=[],results=[],completed=[];
  let finish=0,settled=false;
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);};
   const fail=error=>{
    if(settled)return;settled=true;cleanup();
    Promise.allSettled(workers.map(worker=>worker.terminate())).then(()=>reject(error));
   };
   const cancel=()=>fail(Error('CPU scan canceled.'));
   process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
   try{
    for(let start=0;start<targets.length;start+=size){
     const index=workers.length;completed[index]=0;
     const request={type:'scan',query,targets:targets.slice(start,start+size),floor,chunkOffset:start};
     const worker=new Worker(__filename,{workerData:{scanner,request}});workers.push(worker);
     worker.on('error',fail);
     worker.on('message',message=>{
      if(settled||results[index]!==undefined)return;
      if(message.type==='progress'){
       completed[index]=message.completed;
       progress({completed:completed.reduce((a,b)=>a+b,0),total:targets.length});
      }else if(message.type==='complete'){
       results[index]=message.summaries;
       worker.terminate().catch(fail);
       if(++finish===workers.length){settled=true;cleanup();resolve(results.flat());}
      }
     });
     worker.on('exit',code=>{
      if(!settled&&results[index]===undefined)fail(Error('CPU worker exited before completing (status '+code+').'));
     });
    }
   }catch(error){fail(error);}
  });
 }
 module.exports={scan,workerCount};
}
