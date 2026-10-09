/* Bounded, verified compressed public packages; no user FASTA storage. */
(function(root){
 'use strict';
 const NAME='mimicryone-compressed-inputs-v1',LIMIT=536*1024*1024;
 async function open(){try{return await caches.open(NAME);}catch(error){return null;}}
 async function entries(cache){
  const rows=[];
  for(const request of await cache.keys()){
   const response=await cache.match(request);
   if(response)rows.push({request,bytes:Number(response.headers.get('content-length'))||0,
    library:response.headers.get('x-mimicry-library'),release:response.headers.get('x-mimicry-release'),
    records:Number(response.headers.get('x-mimicry-records'))||0,storedAt:Number(response.headers.get('x-mimicry-stored-at'))||0,storage:'compressed'});
  }
  return rows;
 }
 async function store(cache,url,bytes,meta){
  if(!cache||bytes.byteLength>LIMIT)return false;
  try{
   const write=async()=>{
    await cache.put(url,new Response(bytes,{headers:{'content-type':'application/gzip','content-length':String(bytes.byteLength),
     'x-mimicry-library':meta.library,'x-mimicry-release':meta.release_fingerprint,
     'x-mimicry-records':String(meta.manifest.download_records),'x-mimicry-stored-at':String(Date.now())}}));
    const rows=(await entries(cache)).sort((a,b)=>a.storedAt-b.storedAt);
    let used=rows.reduce((n,row)=>n+row.bytes,0);
    for(const row of rows){if(used<=LIMIT)break;await cache.delete(row.request);used-=row.bytes;}
   };
   if(root.navigator&&navigator.locks)await navigator.locks.request(NAME,write);else await write();
   return true;
  }catch(error){return false;}
 }
 async function read(url,meta,onHeaders){
  const timings={},started=performance.now(),cache=await open();let response;
  try{response=cache&&await cache.match(url);}catch(error){}
  const stored=!!response;
  timings.cache_read_ms=performance.now()-started;
  let cacheHit=stored;
  if(!response){const start=performance.now();response=await fetch(url);timings.wait_headers_ms=performance.now()-start;}
  else timings.wait_headers_ms=0;
  if(!response.ok)throw Error('Input package HTTP '+response.status);
  if(onHeaders)onHeaders(Number(response.headers.get('content-length'))||0);
  const bodyStarted=performance.now();let buffer=await response.arrayBuffer();
  timings.transfer_ms=performance.now()-bodyStarted;
  const integrityStarted=performance.now();
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(buffer.byteLength!==meta.compressed_bytes||await digest(buffer)!==meta.sha256){
   if(!stored)throw Error('Input package checksum mismatch');
   try{await cache.delete(url);}catch(error){}
   response=await fetch(url,{cache:'reload'});if(!response.ok)throw Error('Input package HTTP '+response.status);
   buffer=await response.arrayBuffer();cacheHit=false;
   if(buffer.byteLength!==meta.compressed_bytes||await digest(buffer)!==meta.sha256)throw Error('Input package checksum mismatch');
  }
  timings.integrity_ms=performance.now()-integrityStarted;
  const server=/prepare;dur=([0-9.]+)/.exec(response.headers.get('server-timing')||'');
  timings.server_prepare_ms=!cacheHit&&server?Number(server[1]):null;
  timings.cache_source=cacheHit?'compressed_cache':'network_or_http_cache';
  timings.encoded_bytes=buffer.byteLength;
  const writeStarted=performance.now();
  timings.persisted=cacheHit||await store(cache,url,buffer,meta);
  timings.cache_write_ms=performance.now()-writeStarted;
  return {buffer,timings};
 }
 root.MimicryInputTransport={read,limit:LIMIT,
  list:async()=>{try{const cache=await open();return cache?(await entries(cache)).map(({request,...row})=>row):[];}catch(error){return [];}},
  clear:async()=>{try{await caches.delete(NAME);return true;}catch(error){return false;}}};
})(typeof globalThis!=='undefined'?globalThis:this);
