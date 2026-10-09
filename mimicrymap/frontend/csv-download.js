/* Chunked CSV preparation for ordinary downloads or a supplied file stream. */
(function(root){
 'use strict';
 const encoder=new TextEncoder();
 async function write(snapshot,kind,handle,{signal,onProgress=()=>{}}={}){
  let stream=null,parts=[],bytes=0,rows=0,lastYield=performance.now();
  try{
   if(signal?.aborted)throw new DOMException('Canceled.','AbortError');
   if(handle)stream=await handle.createWritable();
   for(const part of root.MimicryExportCore.csvChunks(snapshot.result,snapshot.floor,snapshot.viewState.selected_start,snapshot.viewState.ranking,kind)){
    if(signal?.aborted)throw new DOMException('Canceled.','AbortError');
    if(part.text!==undefined){
     rows=part.completed;
     if(stream){
      const chunk=encoder.encode(part.text);bytes+=chunk.byteLength;
      await stream.write(chunk);
     }else{
      // Blob parts release each formatted string without retaining encoded arrays
      // in JavaScript. The browser manages their backing storage and download.
      const chunk=new Blob([part.text]);bytes+=chunk.size;parts.push(chunk);
     }
    }
    if(performance.now()-lastYield>=12){
     onProgress({...part,bytes,text:undefined});
     await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();
    }
   }
   if(signal?.aborted)throw new DOMException('Canceled.','AbortError');
   if(stream){await stream.close();stream=null;}
   onProgress({completed:rows,total:rows,bytes});
   return {blob:handle?null:new Blob(parts,{type:'text/csv;charset=utf-8'}),bytes,rows};
  }catch(error){
   if(stream)try{await stream.abort();}catch(ignored){}
   throw error;
  }
 }
 root.MimicryCsvDownload={write};
})(typeof globalThis!=='undefined'?globalThis:this);
