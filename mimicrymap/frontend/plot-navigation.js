/* Viewing magnification is local to a figure. It never changes saved geometry. */
(function(root){
 'use strict';
 if(!root.document||root.SeroMapPlotNavigation)return;
 const states=new Map(),layers=new WeakMap();
 const enabled=()=>root.SeroMapPlotPalette?.snapshot().plotZoom!==false;
 // Only main analysis figures opt in. The same renderers also appear in
 // inspectors, protein pages and documentation, where scrolling stays native.
 const permitted=figure=>!!figure.closest('[data-plot-zoom-scope]')&&!figure.closest('button,a,[role="button"],[data-plot-no-zoom],.desktop-inspector');
 function target(event){
  if(!enabled())return null;
  let svg=layers.get(event.target)?.svg||event.target?.closest?.('svg,canvas#viz');
  while(svg?.ownerSVGElement)svg=svg.ownerSVGElement;
  if(!svg||!permitted(svg))return null;
  const box=svg.getBoundingClientRect(),vb=svg.viewBox?.baseVal;
  return (svg.tagName==='CANVAS'||vb?.width>60&&vb.height>40)&&box.width>60&&box.height>40?svg:null;
 }
 function state(svg){
  if(states.has(svg))return states.get(svg);
  const canvas=svg.tagName==='CANVAS',v=canvas?{x:0,y:0,width:svg.clientWidth,height:svg.clientHeight}:svg.viewBox.baseVal,s={svg,canvas,base:[v.x,v.y,v.width,v.height],original:svg.getAttribute('viewBox'),originalStyle:svg.getAttribute('style'),scale:1,x:v.x,y:v.y,pointers:new Map()};
  states.set(svg,s);return s;
 }
 const css=(node,values)=>{for(const [key,value] of Object.entries(values))node.style.setProperty(key,String(value),'important');};
 const restoreAttribute=(node,name,value)=>value==null?node.removeAttribute(name):node.setAttribute(name,value);
 function authoredStyle(s){
  if(!s.paintedStyle||s.svg.getAttribute('style')===s.paintedStyle)return s.originalStyle;
  // React may change the source figure while it is magnified. Retain those
  // changes when removing our temporary positioning and size overrides.
  const old=document.createElement('div').style,base=document.createElement('div').style,current=s.svg.style;
  old.cssText=s.paintedStyle;base.cssText=s.originalStyle||'';
  for(const key of new Set([...old,...current]))if(current.getPropertyValue(key)!==old.getPropertyValue(key)||current.getPropertyPriority(key)!==old.getPropertyPriority(key)){
   if(current.getPropertyValue(key))base.setProperty(key,current.getPropertyValue(key),current.getPropertyPriority(key));else base.removeProperty(key);
  }
  return base.cssText||(s.originalStyle==null?null:'');
 }
 function areaBounds(s){
  const r=s.area?.getBoundingClientRect()||{left:0,top:0,right:innerWidth,bottom:innerHeight};
  const left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
  return {left,top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
 }
 function openCamera(s){
  // Keep the live element in its React/DOM parent. A placeholder preserves the
  // original layout while fixed positioning escapes the nested scroll clips.
  for(const other of [...states.keys()])if(other!==s.svg)reset(other);
  const svg=s.svg,box=svg.getBoundingClientRect(),style=getComputedStyle(svg),matrix=s.canvas?null:svg.getScreenCTM();
  s.area=svg.closest('[data-plot-zoom-area],.desktop-analysis-scroll,.desktop-canvas-stack')||svg.closest('main,[role="main"]');
  s.bounds=areaBounds(s);if(!s.bounds.width||!s.bounds.height)return false;
  s.unitX=s.canvas?box.width/s.base[2]:matrix.a;s.unitY=s.canvas?box.height/s.base[3]:matrix.d;
  if(!(s.unitX>0&&s.unitY>0))return false;
  s.x=(s.bounds.left-(s.canvas?box.left:matrix.e))/s.unitX;
  s.y=(s.bounds.top-(s.canvas?box.top:matrix.f))/s.unitY;
  s.scene=[Math.min(s.base[0],s.x),Math.min(s.base[1],s.y),Math.max(s.base[0]+s.base[2],s.x+s.bounds.width/s.unitX),Math.max(s.base[1]+s.base[3],s.y+s.bounds.height/s.unitY)];
  const placeholder=document.createElement('div');placeholder.setAttribute('data-plot-zoom-placeholder','');placeholder.setAttribute('aria-hidden','true');
  css(placeholder,{display:style.display==='inline'?'inline-block':style.display,width:box.width+'px',height:box.height+'px','min-width':box.width+'px','min-height':box.height+'px',margin:style.margin,flex:'none',visibility:'hidden','pointer-events':'none'});
  s.placeholder=placeholder;svg.before(placeholder);
  const layer=document.createElement('div');layer.setAttribute('data-plot-camera-backdrop','');layer.setAttribute('aria-hidden','true');
  css(layer,{position:'fixed',margin:0,padding:0,border:0,'z-index':38,background:'var(--c-bg,var(--mm-bg,#fff))'});
  s.layer=layer;layers.set(layer,s);svg.before(layer);
  svg.setAttribute('data-plot-original-style',JSON.stringify(s.originalStyle));
  css(svg,{position:'fixed',margin:0,padding:0,border:0,'box-sizing':'border-box','z-index':39,'max-width':'none','max-height':'none','min-width':0,'min-height':0,display:'block',transform:'none','transform-origin':'0 0'});
  s.paintedStyle=svg.getAttribute('style');
  s.camera=true;
  let scheduled=0;
  const update=()=>{scheduled=0;if(!states.has(svg)||!s.camera)return;const next=areaBounds(s);if(!next.width||!next.height){reset(svg);return;}
   s.x+=(next.left-s.bounds.left)/(s.unitX*s.scale);s.y+=(next.top-s.bounds.top)/(s.unitY*s.scale);s.bounds=next;paint(s);};
  const schedule=()=>{if(!scheduled)scheduled=requestAnimationFrame(update)};
  const observer=new ResizeObserver(schedule);if(s.area)observer.observe(s.area);
  // Header collapse can move the pane without changing its own dimensions.
  for(let node=s.area;node;node=node.parentElement)for(let prev=node.previousElementSibling;prev;prev=prev.previousElementSibling)observer.observe(prev);
  root.addEventListener('resize',schedule);root.addEventListener('scroll',schedule,true);
  s.closeCamera=()=>{observer.disconnect();cancelAnimationFrame(scheduled);root.removeEventListener('resize',schedule);root.removeEventListener('scroll',schedule,true);placeholder.remove();layer.remove();};
  return true;
 }
 function reset(svg,{restore=true}={}){
  const s=states.get(svg);if(!s)return;
  states.delete(svg);s.closeCamera?.();
  if(restore&&!s.canvas)restoreAttribute(svg,'viewBox',s.original);
  if(s.camera)restoreAttribute(svg,'style',authoredStyle(s));
  svg.removeAttribute('data-plot-original-viewbox');svg.removeAttribute('data-plot-original-style');svg.removeAttribute('data-plot-zoom');
  if(dragging===s)dragging=null;
  svg.dispatchEvent(new Event('seromap:plot-zoom',{bubbles:true}));
 }
 function resetAll(){for(const svg of states.keys())reset(svg);}
 function paint(s){
  if(s.scale<=1.0001){reset(s.svg);return;}
  const [bx,by,bw,bh]=s.base,r=s.bounds,w=r.width/(s.unitX*s.scale),h=r.height/(s.unitY*s.scale);
  // A pane wider than the figure may contain margins. Bound panning without
  // forcing that figure to jump to a different alignment at the first zoom.
  const clamp=(v,lo,span,visible)=>Math.max(Math.min(lo,lo+span-visible),Math.min(Math.max(lo,lo+span-visible),v));
  s.x=clamp(s.x,s.scene[0],s.scene[2]-s.scene[0],w);s.y=clamp(s.y,s.scene[1],s.scene[3]-s.scene[1],h);
  s.originalStyle=authoredStyle(s);s.svg.setAttribute('data-plot-original-style',JSON.stringify(s.originalStyle));
  s.expected=`${s.x} ${s.y} ${w} ${h}`;
  states.set(s.svg,s);
  css(s.layer,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
  s.svg.setAttribute('data-plot-zoom',String(s.scale));
  if(s.canvas){
   const kx=s.unitX*s.scale,ky=s.unitY*s.scale;
   css(s.svg,{left:(r.left-s.x*kx)+'px',top:(r.top-s.y*ky)+'px',width:bw+'px',height:bh+'px',transform:`scale(${kx},${ky})`,'clip-path':`polygon(${s.x}px ${s.y}px,${s.x+w}px ${s.y}px,${s.x+w}px ${s.y+h}px,${s.x}px ${s.y+h}px)`});
  }else{
   css(s.svg,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
   s.svg.setAttribute('data-plot-original-viewbox',s.original);
   s.svg.setAttribute('viewBox',s.expected);
  }
  s.paintedStyle=s.svg.getAttribute('style');
  s.svg.dispatchEvent(new Event('seromap:plot-zoom',{bubbles:true}));
 }
 function point(s,x,y){if(s.canvas){const b=s.svg.getBoundingClientRect();return {x:(x-b.left)/b.width*s.base[2],y:(y-b.top)/b.height*s.base[3]};}return new DOMPoint(x,y).matrixTransform(s.svg.getScreenCTM().inverse());}
 function zoom(s,factor,x,y){
  const p=point(s,x,y),next=Math.max(1,Math.min(12,s.scale*factor));
  if(next<=1.0001){reset(s.svg);return;}
  if(!s.camera&&!openCamera(s)){reset(s.svg);return;}
  const ratio=s.scale/next;
  s.x=p.x-(p.x-s.x)*ratio;s.y=p.y-(p.y-s.y)*ratio;s.scale=next;paint(s);
 }
 document.addEventListener('wheel',event=>{
  const svg=target(event);if(!svg)return;
  // At the lower stop, ordinary downward scrolling still scrolls the page.
  if(!states.has(svg)&&event.deltaY>=0&&!event.ctrlKey)return;
  event.preventDefault();event.stopPropagation();
  zoom(state(svg),Math.exp(-event.deltaY*(event.deltaMode===1?.035:.002)),event.clientX,event.clientY);
 },{passive:false,capture:true});
 let dragging=null,suppressClick=false,touchGesture=false;
 document.addEventListener('pointerdown',event=>{
  const svg=target(event);if(!svg||event.button>0)return;
  if(event.pointerType!=='touch'&&!states.has(svg))return;
  const s=state(svg);s.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(event.pointerType==='touch'&&s.pointers.size>1)touchGesture=true;
  if(event.pointerType==='touch'||s.scale>1){
   dragging=s;svg.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();
  }
 },true);
 document.addEventListener('pointermove',event=>{
  const s=dragging,old=s?.pointers.get(event.pointerId);if(!old)return;
  const other=[...s.pointers.entries()].find(([id])=>id!==event.pointerId)?.[1];
  if(other){
   const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y);
   if(before>0)zoom(s,after/before,(event.clientX+other.x)/2,(event.clientY+other.y)/2);
  }else if(s.scale>1){
   const a=point(s,old.x,old.y),b=point(s,event.clientX,event.clientY);s.x+=a.x-b.x;s.y+=a.y-b.y;paint(s);
  }
  if(Math.hypot(event.clientX-old.x,event.clientY-old.y)>2){suppressClick=true;if(event.pointerType==='touch')touchGesture=true;}
  s.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});event.preventDefault();event.stopPropagation();
 },true);
 const release=event=>{if(!dragging)return;dragging.pointers.delete(event.pointerId);if(!dragging.pointers.size){if(dragging.scale===1)reset(dragging.svg);dragging=null;}};
 document.addEventListener('pointerup',release,true);document.addEventListener('pointercancel',release,true);
 // Volcanoes also support tap-to-inspect. A completed pinch/pan must not
 // become a tap on a point or its enclosing comparison panel.
 const finishTouch=event=>{if(!touchGesture)return;event.preventDefault();event.stopImmediatePropagation();if(!event.touches.length){touchGesture=false;suppressClick=false;}};
 document.addEventListener('touchend',finishTouch,{capture:true,passive:false});
 document.addEventListener('touchcancel',finishTouch,{capture:true,passive:false});
 document.addEventListener('click',event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopPropagation();}},true);
 document.addEventListener('dblclick',event=>{const svg=target(event);if(svg&&states.has(svg)){reset(svg);event.preventDefault();event.stopPropagation();}},true);
 root.addEventListener('keydown',event=>{if(event.key==='Escape'&&[...states.values()].some(s=>s.camera)){resetAll();event.preventDefault();event.stopImmediatePropagation();}},true);
 function mark(node){
  if(node.nodeType!==1)return;
  const list=node.matches('svg,canvas#viz')?[node]:node.querySelectorAll('svg[viewBox],canvas#viz');
  for(const svg of list){
   const v=svg.viewBox?.baseVal,interactive=!svg.ownerSVGElement&&(svg.tagName==='CANVAS'||v?.width>60&&v.height>40)&&permitted(svg);
   if(svg.hasAttribute('data-plot-interactive')!==interactive)svg.toggleAttribute('data-plot-interactive',interactive);
  }
 }
 const observer=new MutationObserver(records=>{
  for(const [svg,s] of states){
   if(!svg.isConnected||!permitted(svg)){reset(svg);continue;}
   if(!svg.checkVisibility({visibilityProperty:true})){reset(svg);continue;}
   if(!s.canvas&&svg.getAttribute('viewBox')!==s.expected&&s.scale>1)reset(svg,{restore:false});
   else if(records.some(r=>svg.contains(r.target)&&!r.target.parentElement?.closest('[data-windowed-rows],[data-export-omit],title,desc')&&!r.target.closest?.('[data-windowed-rows],[data-export-omit],title,desc')&&!(r.type==='attributes'&&(r.oldValue===r.target.getAttribute(r.attributeName)||r.attributeName==='transform'&&r.target.closest('[data-figure-legend],[data-scatter-legend]')||['fill','stroke','opacity','class','style','data-page-find-active'].includes(r.attributeName)||r.target===svg&&['viewBox','data-plot-original-viewbox','data-plot-original-style','data-plot-zoom','data-plot-interactive'].includes(r.attributeName)))))reset(svg);
  }
  for(const r of records){
   if(r.type==='childList')for(const n of r.addedNodes)mark(n);
   else if(['data-plot-zoom-scope','data-plot-no-zoom','viewBox'].includes(r.attributeName))mark(r.target);
  }
 });
 function install(){
  const style=document.createElement('style');style.textContent='html:not([data-plot-zoom-disabled]) :is(svg[data-plot-interactive],svg[data-plot-interactive] svg,canvas[data-plot-interactive]){touch-action:none!important}[data-plot-zoom]{cursor:grab}';document.head.append(style);
  document.documentElement.toggleAttribute('data-plot-zoom-disabled',!enabled());
  mark(document.documentElement);observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true});
 }
 root.addEventListener('seromap:plot-palette',()=>{document.documentElement.toggleAttribute('data-plot-zoom-disabled',!enabled());if(!enabled())resetAll();});
 root.addEventListener('popstate',resetAll);root.addEventListener('hashchange',resetAll);
 root.addEventListener('mimicryone:navigation-state',resetAll);
 root.addEventListener('seromap:before-figure-export',resetAll);
 root.addEventListener('seromap:reset-plot-zoom',resetAll);
 root.SeroMapPlotNavigation={reset:resetAll,viewport:svg=>states.get(svg)?.camera?states.get(svg).bounds:null};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(globalThis);
