/* Presentation only. Palette changes repaint retained results without recomputation. */
(function(){
 'use strict';
 const registry=window.SeroMapPlotPalette;
 const initial=window.seromapDesktop?.appearanceInitial;
 if(initial)registry.configure({brand:'seromap',overrides:initial.plotPalette});
 let exportOptions=null;
 const raw=key=>registry.raw(key,exportOptions||{});
 const aliases={'--hl-sel':'mimicryCore','--hl-hover':'mimicryCoreHover','--hl-ext':'mimicryContext','--hl-exth':'mimicryContextHover','--lj0':'density1','--lj33':'density2','--lj66':'density3','--lj100':'density4'};
 const rules=Object.entries(aliases).map(([variable,key])=>variable+':'+registry.ref(key)).join(';');
 const style=document.createElement('style');style.id='native-plot-palette';document.head.append(style);
 const dot=options=>registry.mix(registry.raw('mimicryContext',options),registry.raw('ink',options),.35);
 const derived=options=>'--plot-dot:'+dot(options)+';--plot-solvent-gradient:'+registry.gradient('solventNative',options)+';--plot-identity-gradient:linear-gradient(90deg,'+registry.alpha('mimicryIdentity',.3,options)+','+registry.alpha('mimicryIdentity',1,options)+');';
 function apply(){style.textContent=registry.css()+'html:root,html:root.dark,html:root:not(.dark){'+rules+';'+derived()+'}';document.head.append(style);}
 function repaint(){window.dispatchEvent(new Event('mimicryone:theme'));}
 function beginExport(options={mode:registry.mode(),export:true}){
  const previous=exportOptions;exportOptions=options;
  const sheet=document.createElement('style');
  sheet.textContent='html:root,html:root.dark,html:root:not(.dark){'+registry.declarations(registry.colors(options))+';'+rules+';'+derived(options)+'}';
  document.head.append(sheet);repaint();
  return ()=>{sheet.remove();exportOptions=previous;repaint();};
 }
 function capture(fn,options){const restore=beginExport(options);try{return fn();}finally{restore();}}
 function snapshot(){return {schema:registry.schema,configuration:registry.snapshot(),mode:registry.snapshot().brand==='seromap'?'light':registry.mode(),sourceMode:registry.mode(),colors:{...registry.colors({export:true})}};}
 function variables({print=false}={}){
  const values=registry.colors({export:true}),out=Object.fromEntries(Object.entries(values).map(([key,value])=>[registry.cssName(key),value]));
  for(const [variable,key] of Object.entries(aliases))out[variable]=values[key];
  for(const [variable,key] of Object.entries({'--mm-ink':print?'printInk':'ink','--mm-body':print?'printBody':'body','--mm-muted':print?'printMuted':'muted','--mm-border':print?'printLine':'line','--mm-surface':'surface'}))out[variable]=values[key];
  out['--plot-dot']=dot({export:true});return out;
 }
 function freezeSVG(svg,options){
  const values=variables(options);
  for(const node of [svg,...svg.querySelectorAll('*')]){
   node.removeAttribute('tabindex');node.removeAttribute('data-tooltip');
   for(const attr of ['fill','stroke','color','stop-color','style'])if(node.hasAttribute(attr))
    node.setAttribute(attr,registry.resolveColor(node.getAttribute(attr),values));
  }
  const metadata=document.createElementNS('http://www.w3.org/2000/svg','metadata');metadata.textContent=JSON.stringify({plotPalette:snapshot()});svg.append(metadata);return svg;
 }
 window.MimicryPlotPalette={registry,raw,ramp:(name,t)=>registry.ramp(name,t,exportOptions||{}),alpha:(key,a)=>registry.alpha(key,a,exportOptions||{}),beginExport,capture,snapshot,
  variables,freezeSVG,object:roles=>new Proxy({}, {get:(_,key)=>roles[key]?raw(roles[key]):undefined})};
 apply();
 window.addEventListener('seromap:plot-palette',()=>{apply();repaint();});
 window.addEventListener('seromap:theme',apply);
 window.addEventListener('mimicryone:theme',()=>{if(!exportOptions)apply();});
})();
