/* Embeddable native viewer contract. The scientific engine and saved results
   retain their existing owners; hosts provide selection, styling and optional
   table decorations through this interface. No cohort data enters the engine. */
(function(root){
 'use strict';
 const options={embedded:false,pageSize:10,libraryAllowed:()=>true},hooks={},nodes=new Map();
 let controller=null,request=0;
 const node=id=>nodes.get(id)||document.getElementById(id);
 root.MimicryMapViewer={
  version:1,options,hooks,node,
  configure(next){Object.assign(options,next);return this;},
  // Presentation only: repaginate the current result without selecting or computing.
  setPageSize(value){
   const next=Math.max(1,Math.min(50,Math.floor(Number(value))||10)),previous=options.pageSize;
   if(next===previous)return;
   options.pageSize=next;
   hooks.resizeCore?.(next,previous);hooks.resizeOverall?.(next,previous);
  },
  register(value){controller=value;},
  cancelSelection(){request++;controller?.cancel();root.MimicryOne?.cancelLocalRun();},
  async select(record,settings={}){
   const version=++request;controller?.cancel();
   await root.MimicryOneAnalysisBootstrap;
   if(version!==request)throw new DOMException('Superseded selection','AbortError');
   if(!controller)throw new Error('Viewer selection is unavailable.');
   await controller.select(record,settings);
   if(version!==request)throw new DOMException('Superseded selection','AbortError');
  },
  parts(){return {controls:document.querySelector('.player-control-row')?.parentElement,
   track:node('fig'),canvas:node('cvwrap'),tables:node('ebottom'),core:node('emotifs'),
   overall:node('ematches'),structure:node('sbox'),parentLibrary:node('entryTargetLibrary')};},
  retainStructure(){for(const id of ['sbox','viz3d','s3meta','s3cap','s3color','s3shape','s3asm','s3asmdiv']){const element=node(id);if(element)nodes.set(id,element);}return node('sbox');},
  // Only the structure panel supports cross-document mounting. Tracks and tables
  // still use their original document; hosts position them through their adapter.
  mountStructure(target){
   const structure=this.retainStructure();if(!structure||!target)return ()=>{};
   const home=structure.parentNode,next=structure.nextSibling;target.appendChild(structure);
   let frame=0;const resize=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;root.size3d?.();root.draw3d?.();});};
   const observer=new ResizeObserver(resize);observer.observe(target);resize();
   return ()=>{observer.disconnect();cancelAnimationFrame(frame);if(structure.parentNode===target)home.insertBefore(structure,next);};
  }
 };
 root.addEventListener('pagehide',()=>root.MimicryMapViewer.cancelSelection());
})(window);
