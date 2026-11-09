/* Presentation only. Palette changes repaint retained results without recomputation. */
(function(){
 'use strict';
 const registry=window.SeroMapPlotPalette;
 const assetBase=document.currentScript.src;
 const navigation=document.createElement('script');navigation.src=new URL('plot-navigation.js',document.currentScript.src);document.head.append(navigation);
 window.seromapDesktop?.onAppearanceChanged?.(value=>{registry.configure({exportMode:value.exportTheme,exportBackground:value.exportBackground,plotZoom:value.plotZoom});window.dispatchEvent(new Event('seromap:plot-palette'));});
 const initial=window.seromapDesktop?.appearanceInitial;
 if(initial)registry.configure({brand:'seromap',overrides:initial.plotPalette,exportMode:initial.exportTheme,exportBackground:initial.exportBackground,plotZoom:initial.plotZoom});
 let exportOptions=null;
 const raw=key=>registry.raw(key,exportOptions||{});
 const aliases={'--hl-sel':'mimicryCore','--hl-hover':'mimicryCoreHover','--hl-ext':'mimicryContext','--hl-exth':'mimicryContextHover','--lj0':'density1','--lj33':'density2','--lj66':'density3','--lj100':'density4'};
 const rules=Object.entries(aliases).map(([variable,key])=>variable+':'+registry.ref(key)).join(';');
 const style=document.createElement('style');style.id='native-plot-palette';document.head.append(style);
 const dot=options=>registry.mix(registry.raw('mimicryContext',options),registry.raw('ink',options),.35);
 const derived=options=>'--plot-dot:'+dot(options)+';--plot-solvent-gradient:'+registry.gradient('solventNative',options)+';--plot-identity-gradient:linear-gradient(90deg,'+registry.alpha('mimicryIdentity',.3,options)+','+registry.alpha('mimicryIdentity',1,options)+');';
 function apply(){style.textContent=registry.css()+'html:root,html:root.dark,html:root:not(.dark){'+rules+';'+derived()+'}';document.head.append(style);}
 function repaint(){window.dispatchEvent(new Event('mimicryone:theme'));}
 function beginExport(options={export:true}){
  const previous=exportOptions;exportOptions=options;
  const sheet=document.createElement('style');
  sheet.textContent='html:root,html:root.dark,html:root:not(.dark){'+registry.declarations(registry.colors(options))+';'+rules+';'+derived(options)+'}';
  document.head.append(sheet);repaint();
  return ()=>{sheet.remove();exportOptions=previous;repaint();};
 }
 function capture(fn,options){const restore=beginExport(options);try{return fn();}finally{restore();}}
 function snapshot(variant){const selected=variant||exportOptions||registry.exportVariants()[0];return {schema:registry.schema,configuration:registry.snapshot(),mode:selected.mode||registry.exportVariants()[0].mode,background:selected.background||registry.exportVariants()[0].background,sourceMode:registry.mode(),colors:{...registry.colors({...selected,export:true})}};}
 function variables({print=false,...options}={}){
  const values=registry.colors({...exportOptions,...options,export:true}),out=Object.fromEntries(Object.entries(values).map(([key,value])=>[registry.cssName(key),value]));
  for(const [variable,key] of Object.entries(aliases))out[variable]=values[key];
  for(const [variable,key] of Object.entries({'--mm-ink':print?'printInk':'ink','--mm-body':print?'printBody':'body','--mm-muted':print?'printMuted':'muted','--mm-border':print?'printLine':'line','--mm-surface':'surface'}))out[variable]=values[key];
  out['--plot-dot']=dot({...exportOptions,...options,export:true});return out;
 }
 function freezeSVG(svg,options={}){
  const selected={...snapshot(options),...options},values=variables(selected);
  const original=svg.getAttribute('data-plot-original-viewbox');if(original)svg.setAttribute('viewBox',original);
  if(svg.hasAttribute('data-plot-original-style')){const style=JSON.parse(svg.getAttribute('data-plot-original-style'));if(style==null)svg.removeAttribute('style');else svg.setAttribute('style',style);}
  svg.removeAttribute('data-plot-original-viewbox');svg.removeAttribute('data-plot-original-style');svg.removeAttribute('data-plot-zoom');
  svg.style.removeProperty('background');svg.style.removeProperty('background-color');
  svg.querySelectorAll('[data-figure-background],[data-export-background]').forEach(n=>n.remove());
  if(selected.background!=='transparent'){
   const rect=document.createElementNS('http://www.w3.org/2000/svg','rect'),v=svg.viewBox.baseVal;
   for(const [k,vv] of Object.entries({x:v.x,y:v.y,width:v.width,height:v.height,fill:selected.colors.bg,'data-export-background':'solid'}))rect.setAttribute(k,vv);
   svg.insertBefore(rect,svg.firstChild);
  }
  for(const node of [svg,...svg.querySelectorAll('*')]){
   node.removeAttribute('tabindex');node.removeAttribute('data-tooltip');
   node.removeAttribute('data-page-find-active');
   for(const attr of ['fill','stroke','color','stop-color','style'])if(node.hasAttribute(attr))
    node.setAttribute(attr,registry.resolveColor(node.getAttribute(attr),values));
  }
  const metadata=document.createElementNS('http://www.w3.org/2000/svg','metadata');metadata.textContent=JSON.stringify({plotPalette:snapshot(selected)});svg.append(metadata);return svg;
 }
 // Standalone atlas downloads must carry the same fonts as the player and app.
 let embeddedFonts;
 function fontCSS(){
  if(!embeddedFonts)embeddedFonts=Promise.all([['Inter','inter-latin.woff2','300 700'],['JetBrains Mono','jetbrains-mono-latin.woff2','400 600']].map(async([family,file,weight])=>{
   const response=await fetch(new URL('fonts/'+file,assetBase));
   if(!response.ok)throw Error('Cannot load the figure font '+family+'. Please retry.');
   const bytes=new Uint8Array(await response.arrayBuffer());let binary='';
   for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
   return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2')}`;
  })).then(parts=>parts.join('')).catch(error=>{embeddedFonts=null;throw error});
  return embeddedFonts;
 }
 function cloneSVG(source){
  const copy=source.cloneNode(true),live=[source,...source.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
  live.forEach((node,i)=>{
   if(!node.isConnected||!['svg','text','tspan','textPath'].includes(node.localName))return;
   const style=node.ownerDocument.defaultView.getComputedStyle(node);
   for(const key of ['font-family','font-size','font-weight','font-style','font-stretch','font-variant','font-kerning','letter-spacing','word-spacing'])copies[i].style.setProperty(key,style.getPropertyValue(key));
  });
  return copy;
 }
 async function downloadFigure(source,filename,kind,caption){
  const variants=registry.exportVariants(),files={},frozen=typeof source==='function'?source:cloneSVG(source),fonts=await fontCSS();
  for(const variant of variants){
   const svg=typeof frozen==='function'?cloneSVG(await frozen(variant)):frozen.cloneNode(true);
   freezeSVG(svg,variant);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
   const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.setAttribute('data-export-fonts','embedded');style.textContent=fonts;svg.prepend(style);
   const v=svg.viewBox.baseVal;svg.setAttribute('width',v.width);svg.setAttribute('height',v.height);
   let blob=new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'});
   if(kind==='png'){
    const url=URL.createObjectURL(blob);
    try{
     const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas'),scale=Math.min(2,16384/v.width,16384/v.height,Math.sqrt(64000000/(v.width*v.height)));
     c.width=Math.round(v.width*scale);c.height=Math.round(v.height*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);
     blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Unable to render figure.')),'image/png'));
    }finally{URL.revokeObjectURL(url);}
   }
   files[filename+(variants.length>1?'_'+variant.key:'')+'.'+kind]=new Uint8Array(await blob.arrayBuffer());
  }
  let blob,name;
  if(variants.length>1){
   if(!window.MimicryPublicationExports)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('publication-exports.js',assetBase);script.onload=resolve;script.onerror=reject;document.head.append(script);});
   files['README.txt']=(caption?caption+'\n\n':'')+'Figure Variants\n'+variants.map(v=>v.key).join('\n')+'\nAll variants retain the same figure geometry and data.\n';
   blob=await window.MimicryPublicationExports.zip(files);name=filename+'_'+kind+'.zip';
  }else{blob=new Blob([Object.values(files)[0]],{type:kind==='svg'?'image/svg+xml':'image/png'});name=Object.keys(files)[0];}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 window.MimicryPlotPalette={registry,raw,ramp:(name,t)=>registry.ramp(name,t,exportOptions||{}),alpha:(key,a)=>registry.alpha(key,a,exportOptions||{}),beginExport,capture,snapshot,
  variables,freezeSVG,cloneSVG,downloadFigure,object:roles=>new Proxy({}, {get:(_,key)=>roles[key]?raw(roles[key]):undefined})};
 apply();
 window.addEventListener('seromap:plot-palette',()=>{apply();repaint();});
 window.addEventListener('seromap:theme',apply);
 window.addEventListener('mimicryone:theme',()=>{if(!exportOptions)apply();});
})();
