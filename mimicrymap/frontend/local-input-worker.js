/* Fetch, parse, and prepare public input records away from the UI thread. */
"use strict";
importScripts('/mimicryone-identity.js', '/local-input-records.js', '/input-package-transport.js');
let acknowledge;
self.onmessage=async function(event){
 const data=event.data;
 if(data.type==='ack'){if(acknowledge){const resolve=acknowledge;acknowledge=null;resolve();}return;}
 if(data.type!=='load')return;
 try{
  const started=performance.now(),timings={};
  const wire=await self.MimicryInputTransport.read(data.url,data.metadata,bytes=>self.postMessage({type:'progress',stage:'download',bytes}));
  Object.assign(timings,wire.timings);
  if(timings.cache_source==='compressed_cache')self.postMessage({type:'progress',stage:'cached',total:data.metadata.manifest.download_records});
  const decodeStarted=performance.now();
  let text=await new Response(new Response(wire.buffer).body.pipeThrough(new DecompressionStream('gzip'))).text();
  wire.buffer=null;
  timings.decompress_decode_ms=performance.now()-decodeStarted;
  const parse=performance.now(),payload=JSON.parse(text);
  text=null;
  timings.parse_ms=performance.now()-parse;
  const model=self.MimicryLocalInputRecords,meta=data.metadata,scope=data.scope,options=data.options;
  if(payload.schema!=='mimicryone/local-input-package/1'||payload.release_fingerprint!==scope.release||payload.library!==options.library||
     JSON.stringify(payload.row_columns)!==JSON.stringify(meta.row_columns)||
     JSON.stringify(payload.membership_fields||[])!==JSON.stringify(meta.membership_fields||[])||
     payload.rows.length!==meta.manifest.download_records)throw Error('Input package metadata disagrees');
  const selected = model.scopeMask(scope, options.library);
  if(!selected && !model.answerable(options.filters,scope.filterColumns,new Set(payload.membership_fields||[])))throw Error('Input package cannot resolve this scope');
  self.postMessage({type:'progress',stage:'prepare',total:payload.rows.length});
  const columns=payload.row_columns,annotationAt=columns.indexOf('annotation'),idAt=columns.indexOf('antigen_id');
  if(idAt<0||annotationAt<0)throw Error('Input package identity columns are missing');
  const prepared=performance.now();let admitted=0,batch=[],recordCount=0,transferMs=0;
  async function sendBatch(){
   if(!batch.length)return;
   const start=performance.now();
   const ready=new Promise(resolve=>{acknowledge=resolve;});
   self.postMessage({type:'batch',records:batch,compact:!!data.compactRecords});batch=[];
   await ready;transferMs+=performance.now()-start;
  }
  for(let index=0;index<payload.rows.length;index++){
   const row=payload.rows[index];payload.rows[index]=null;
   if(selected && !selected(row[idAt]))continue;
   const record={};
   for(let i=0;i<columns.length;i++)if(i!==annotationAt)record[columns[i]]=row[i];
   const annotation=payload.annotations[row[annotationAt]];
   if(!annotation)throw Error('Input package references a missing annotation');
   Object.assign(record,annotation);
   if(!selected && !model.matches(record,options.filters,scope.filterColumns))continue;
   admitted++;
   const resolved=model.row(record);
   batch.push(data.compactRecords ? model.pack(resolved) : resolved);recordCount++;
   if(batch.length===1024){
    await sendBatch();
    if(recordCount%16384===0)self.postMessage({type:'progress',stage:'prepare_progress',completed:recordCount});
   }
  }
  await sendBatch();
  if(scope.populationRecords!==null&&admitted!==scope.populationRecords)throw Error('Input package scope count disagrees');
  timings.worker_delivery_ms=transferMs;
  timings.prepare_ms=performance.now()-prepared-transferMs;
  timings.total_ms=performance.now()-started;
  self.postMessage({type:'complete',manifest:scope.manifest || Object.assign({},payload.manifest,{filters:options.filters||null,download_records:recordCount}),
   scopeHash:scope.scopeHash || scope.release+':'+options.library+':'+JSON.stringify(options.filters||{}),timings});
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
