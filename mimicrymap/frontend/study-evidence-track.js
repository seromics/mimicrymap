/* Study evidence decorates the native sequence player. No tests run here. */
(function(){
 'use strict';
 if(!window.MimicryMapViewer?.options.trackOnly)return;
 const viewer=window.MimicryMapViewer,parts=viewer.parts(),fig=parts.track,tables=parts.tables;
 const host=document.createElement('div');host.id='studyEvidenceWindow';
 host.append(parts.controls,fig,tables);document.body.append(host);document.body.classList.add('mimicry-native-root','study-track-ready');
 const annotationLegend=document.getElementById('variantlegend')?.closest('.legend');
 if(annotationLegend){annotationLegend.classList.add('study-annotation-legend');host.append(annotationLegend);}
 let mainTrack='mimicry';
 const mainControl=document.createElement('label');mainControl.className='study-main-track';mainControl.textContent='Main Track';
 const mainSelect=document.createElement('select');mainSelect.setAttribute('aria-label','Main Track');mainControl.append(mainSelect);parts.controls.append(mainControl);
 const paintTracks=new Set(['surface','topology','rsasa','plddt','cleavage_epitope']);
 viewer.hooks.mainResidueColor=index=>mainTrack!=='mimicry'&&trackHasData(mainTrack)?annColor(mainTrack,index):null;
 const nativeActive=activeTracks;
 activeTracks=()=>nativeActive().filter(t=>t.key!==mainTrack||t.key==='mimicry');
 const nativeLegends=updateTrackLegends;
 updateTrackLegends=function(){nativeLegends();const key=mainTrack!=='mimicry'&&trackHasData(mainTrack)?mainTrack:null;if(key)document.querySelector(`[data-track-legend="${key}"]`)?.removeAttribute('hidden');};
 function updateMainControl(resetMissing=false){
  const available=TRACKS.filter(t=>paintTracks.has(t.key)&&trackHasData(t.key));
  if(resetMissing&&mainTrack!=='mimicry'&&!available.some(t=>t.key===mainTrack))mainTrack='mimicry';
  mainSelect.replaceChildren(...[{key:'mimicry',label:'Study Evidence'},...available].map(t=>{const option=document.createElement('option');option.value=t.key;option.textContent=t.label;return option;}));
  mainSelect.value=mainTrack;mainControl.hidden=!available.length;
 }
 function labelMainTrack(){const text=parts.track.querySelector('.target-track-identity .identity-secondary');if(text&&mainTrack!=='mimicry'&&trackHasData(mainTrack))text.textContent+= ' · '+TRACKS.find(t=>t.key===mainTrack).label;}
 const nativeBuildCols=buildCols;
 buildCols=function(){nativeBuildCols();labelMainTrack();};
 mainSelect.onchange=()=>{mainTrack=mainSelect.value;updateTrackLegends();render();showAxes();};
 let evidence=null,histogram=true,mode='compact',region=null,onRegion=null,highlight=null;
 let histogramLayers='assay',appearance=null,series=[],histMax=1;
 const axes=document.createElementNS('http://www.w3.org/2000/svg','svg');axes.classList.add('study-histogram-axes');fig.append(axes);
 const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const layers=()=>histogramLayers==='assay'&&series.length>1?series:[{values:evidence?.values,label:evidence?.platforms.length===1?(evidence.platformLabels||evidence.platforms)[0]:'All Assays'}];
 const axisWidth=()=>Math.max(0,parts.canvas.getBoundingClientRect().left-fig.getBoundingClientRect().left);
 function axesContent(width){
  if(!histHeight()||!evidence)return '';
  const x=width-1,ink=PLOT.raw('ink'),out=[];
  layers().forEach((layer,index)=>{
   const y=index*64,top=y+18,bottom=y+56,zero=evidence.signed?(top+bottom)/2:bottom;
   out.push(`<text x="${x-42}" y="${(top+bottom)/2+4}" text-anchor="end" font-size="11" font-weight="600" fill="${ink}">${escape(layer.label)}</text><path d="M${x} ${top}V${bottom}" stroke="${ink}" fill="none"/>`);
   for(const [v,cy] of [[histMax,top],[0,zero],...(evidence.signed?[[-histMax,bottom]]:[])])out.push(`<path d="M${x-4} ${cy}h4" stroke="${ink}"/><text x="${x-7}" y="${cy+3}" text-anchor="end" font-size="10" fill="${ink}">${Number(v.toPrecision(3))}</text>`);
  });return out.join('');
 }
 let opened=null,sort={core:null,overall:null},catalog=new Map(),emittedRegion=null;
 const studyRow=(row,type)=>evidence?.studyRows[type==='core'?row?.r.acc:row?.protein_id];
 const value=(r,key)=>!r?null:key==='hits'?r.a?.hits+(r.b?.hits||0)+(r.other?.a.hits||0)+(r.other?.b.hits||0):r.reactive_weight;
 for(const type of ['core','overall'])viewer.hooks[type==='core'?'orderCore':'orderOverall']=rows=>{
  const order=sort[type];if(!order)return rows;
  return [...rows].sort((a,b)=>{const x=value(studyRow(a,type),order.key),y=value(studyRow(b,type),order.key);return x==null?(y==null?0:1):y==null?-1:(y-x)*order.direction;});
 };
 viewer.hooks.nativeSort=()=>{sort.overall=null;};
 document.getElementById('windowSort').addEventListener('click',()=>{sort.core=null;viewer.hooks.refreshCore(false);});
 const callText=c=>!c?.measured?'-':`${c.hits}/${c.measured}`;
 const percent=v=>v==null?'-':Number((100*v).toPrecision(3)).toString();
 const sortCaption=type=>{
  const order=sort[type];if(!order)return;
  const label=order.key==='hits'?'Recorded Hits':evidence?.contrast?'Δ Reactive %':'Reactive %',caption=document.querySelector(type==='core'?'#motifCount':'#ematches .rank-count');
  if(caption){caption.textContent=(type==='core'?caption.textContent.replace(/ · Sorted by.*$/,''):caption.textContent.split(' · ')[0])+` · ${label} ${order.direction===1?'↓':'↑'}`;caption.dataset.tooltip=`Sorted by ${label.toLowerCase()}; sequence quality breaks ties.`;}
  if(type==='overall')document.querySelectorAll('#ersub .parent-sort').forEach(n=>{n.setAttribute('aria-pressed','false');n.textContent=n.textContent.replace(/ [↑↓]$/,'');});
 };
 viewer.hooks.coreCaption=()=>sortCaption('core');
 viewer.hooks.decorateTable=(type,rows)=>{
  if(!evidence)return;
  const header=document.getElementById(type==='core'?'emsub':'ersub'),body=document.getElementById(type==='core'?'emotifs':'ematches');
  const contrast=evidence.contrast,columns=[['hits',contrast?'Hits / N · A | B':'Hits / N'],['fraction',contrast?'Δ Reactive %':'Reactive %']];
  const arms=evidence.contrastLabels,contrastDescription=arms?`A: ${arms.a}; B: ${arms.b}. Δ = A − B. ${arms.calls}. `:'';
  for(const [id,title] of columns){const button=document.createElement('button');button.type='button';button.className='study-heading';button.dataset.studyColumn=id;button.textContent=title+(sort[type]?.key===id?(sort[type].direction===1?' ↓':' ↑'):'');button.setAttribute('aria-pressed',sort[type]?.key===id?'true':'false');button.dataset.tooltip=id==='hits'?`Recorded hits / measured calls in ${evidence.population}. ${contrastDescription}Counts repeat for each aligned window of the same assay unit; they are not independent events.`:contrast?contrastDescription+'Difference in measured reactive percentage.':'Recorded hits divided by measured calls for this assay antigen in the selected population.';button.onclick=()=>{sort[type]={key:id,direction:sort[type]?.key===id?-sort[type].direction:1};viewer.hooks[type==='core'?'refreshCore':'refreshOverall'](true);};header.append(button);}
  if(type==='core'){const title=document.getElementById('ehdmotif');title.querySelectorAll('.study-value').forEach(n=>n.remove());for(let i=0;i<2;i++){const blank=document.createElement('span');blank.className='study-value';title.append(blank);}}
  body.querySelectorAll(':scope>.erow').forEach((node,i)=>{
   const row=studyRow(rows[i],type);if(!row)return;
   node.dataset.studyId=type==='core'?rows[i].r.acc:rows[i].protein_id;
   const calls=callText(row.a)+(row.b?' | '+callText(row.b):'')+(row.other?' − ('+callText(row.other.a)+' | '+callText(row.other.b)+')':'');
   for(const text of [calls,percent(row.reactive_weight)]){const cell=document.createElement('span');cell.className='study-value';cell.textContent=text;node.append(cell);}
   const identity=node.querySelector('.identity-cell');if(identity){
    const record=catalog.get(node.dataset.studyId),label=window.MimicryOneIdentity.resolve({...record,protein_id:row.source_id});
    identity.querySelector('.identity-primary').textContent=label.primaryLine;
    identity.querySelector('.identity-secondary').textContent=(evidence.platforms.length>1?row.platform+' · ':'')+row.source_id;
    identity.classList.remove('single-line');identity.dataset.tooltip=label.tooltip+'\n'+row.platform+' · '+row.source_id;identity.dataset.tooltipMono='true';
   }
  });
  if(type==='overall')sortCaption(type);
 };
 const baseLayout=layout,baseWrapped=drawWrapped,baseDraw=draw,baseBand=fullBandY,baseDens=buildResDens,baseColor=mainDensColor;
 const histHeight=()=>evidence&&histogram?layers().length*64:0;
 buildResDens=function(){baseDens();if(evidence&&evidence.mode!=='density'){resDens=evidence.values;resMax=resDens.reduce((m,v)=>Math.max(m,Math.abs(v)),0);}};
 mainDensColor=function(v,max){
  if(!evidence||evidence.mode==='density')return baseColor(v,max);
  if(!v)return PLOT.raw('surface');
  return PLOT.registry.mix(PLOT.raw('surface'),PLOT.raw(evidence.signed?(v>0?'up':'down'):'singleSeries'),.18+.82*Math.min(1,Math.abs(v)/Math.max(max,1e-12)));
 };
 layout=function(){
  AXH=22+(isFull()?0:histHeight());AXY=AXH-4;
  let h=baseLayout();
  if(isFull()&&histHeight()){
   BANDH+=histHeight();FULLH=8+BANDS*BANDH+6;
   h=Math.min(window.MimicryMapViewer.options.sequenceViewportHeight,FULLH);
   document.getElementById('spacer').style.height=FULLH+'px';cv.style.height=h+'px';
  }
  return h;
 };
 fullBandY=b=>baseBand(b)+histHeight();
 function paintHistogram(first,last,x,width,y){
  if(!histHeight()||!evidence)return;
  const step=width/(last-first),signed=evidence.signed,max=histMax;
  ctx.save();ctx.globalAlpha=1;ctx.font="10px Inter,system-ui,sans-serif";ctx.textAlign='left';
  layers().forEach((layer,index)=>{
   const y0=y+index*64,top=y0+18,bottom=y0+56,zero=signed?(top+bottom)/2:bottom,amp=signed?(bottom-top)/2:bottom-top;
   ctx.fillStyle=PLOT.raw('ink');ctx.fillText((signed?'Δ ':'')+evidence.label,x+3,y0+11);
   if(isFull()){
    ctx.textAlign='right';ctx.fillText(layer.label,x-7,y0+11,x-10);
    ctx.strokeStyle=PLOT.raw('ink');ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);
    for(const [v,cy] of [[max,top],[0,zero],...(signed?[[-max,bottom]]:[])]){ctx.moveTo(x-4,cy);ctx.lineTo(x,cy);ctx.fillText(Number(v.toPrecision(3)),x-7,cy+3);}
    ctx.stroke();ctx.textAlign='left';
   }
   ctx.strokeStyle=PLOT.raw('line');ctx.beginPath();ctx.moveTo(x,zero+.5);ctx.lineTo(x+width,zero+.5);ctx.stroke();
   for(let i=first;i<last;i++){const v=layer.values[i]||0;if(!v)continue;ctx.fillStyle=evidence.mode==='density'?PLOT.raw('density4'):PLOT.raw(signed?(v>0?'up':'down'):'singleSeries');const y2=zero-v/max*amp;ctx.fillRect(x+(i-first)*step,Math.min(zero,y2),Math.max(.3,step*.95),Math.abs(zero-y2));}
   if(highlight){ctx.strokeStyle=PLOT.raw('mimicryCore');ctx.lineWidth=2;for(const [a,b] of highlight){const lo=Math.max(first,a-1),hi=Math.min(last,b);if(hi<=lo)continue;ctx.beginPath();ctx.moveTo(x+(lo-first)*step,bottom+3);ctx.lineTo(x+(hi-first)*step,bottom+3);ctx.stroke();}}
  });
  ctx.restore();
 }
 drawWrapped=function(range){baseWrapped(range);if(!evidence)return;const off=range?0:fullOff(),lo=range?0:Math.max(0,Math.floor((off-8)/BANDH)),hi=range?1:Math.min(BANDS,Math.ceil((off+H-8)/BANDH));for(let b=lo;b<hi;b++){const a=range?range.start0:b*PER,z=range?range.end0:Math.min(T.len,a+PER);paintHistogram(a,z,POSW,(z-a)*CELL,fullBandY(b)-off-histHeight());}};
 draw=function(){baseDraw();if(!isFull())paintHistogram(0,T.len,0,W,0);};
 // Study evidence is static; its intensity cannot depend on playback position.
 const nativeWave=wave;wave=p=>evidence?1:nativeWave(p);
 const oldBuckets=buildBuckets;buildBuckets=function(){oldBuckets();if(evidence)for(const b of BK)b.i=-100000;};
 window.addEventListener('mimicryone:theme',()=>{if(evidence)buildBuckets();});
 function render(){buildResDens();BK=[];setPaused(true);stop();ambientStop();buildCols();recompute();paintStatic();document.body.dataset.studyReady='true';}
 function showAxes(){const width=axisWidth();axes.setAttribute('width',width);axes.setAttribute('height',histHeight());axes.innerHTML=isFull()?'':axesContent(width);axes.style.display=isFull()?'none':'block';}
 function theme(config,dark){document.documentElement.classList.toggle('dark',dark);document.body.classList.toggle('dark',dark);PLOT.registry.configure(config);window.dispatchEvent(new Event('seromap:plot-palette'));}
 window.StudyEvidenceTrack={
  async set(payload,options={}){
   const nextAppearance=JSON.stringify([options.palette,!!options.dark]),appearanceChanged=appearance!==nextAppearance;
   const changed=opened!==payload.native,shapeChanged=mode!==(options.layout||'compact')||histogram!==(options.histogram!==false)||histogramLayers!==(options.histogramLayers||'assay');
   evidence=payload;histogram=options.histogram!==false;histogramLayers=options.histogramLayers||'assay';mode=options.layout||'compact';onRegion=options.onRegion;highlight=options.highlight||null;
   series=payload.histogramSeries||[];
   histMax=payload.histogramLimit||Math.max(1,...(histogramLayers==='assay'&&series.length>1?series:[payload]).map(s=>s.values.reduce((m,v)=>Math.max(m,Math.abs(v||0)),0)));
   if(appearanceChanged){theme(options.palette||{},!!options.dark);appearance=nextAppearance;}
   if(changed)catalog=new Map(payload.native.source_catalog.map(r=>[r.protein_id,r]));host.classList.toggle('study-contrast',payload.contrast);
   const ownSelection=emittedRegion&&emittedRegion.start===options.region?.start&&emittedRegion.end===options.region?.end;
   const regionChanged=changed||!ownSelection&&(region?.start!==options.region?.start||region?.end!==options.region?.end);emittedRegion=null;
   if(changed){
    ANN=null;indexAnnotationVariants();
    sort={core:payload.mode==='density'?null:{key:'hits',direction:1},overall:payload.mode==='density'?null:{key:'hits',direction:1}};window.MimicryOne.openResult(payload.native,payload.native.source_catalog,mode==='full'?'residues':'explorer');opened=payload.native;
    updateMainControl(!payload.native.protein.annotation_portable_id);buildTrackToggles();
    if(!T.custom&&payload.native.protein.annotation_portable_id){
     const owner=T;
     loadAnnots(T.acc,()=>{if(T!==owner)return;updateMainControl(true);buildTrackToggles();render();showAxes();});
    }
   }
   else if(shapeChanged)setView(mode==='full'?'residues':'explorer');
   region=options.region;
   const center=region?(region.start+region.end)/2:1;
   let best=null,score=-Infinity;
   if(regionChanged)for(const source of payload.native.positional_matches)for(const h of source.hits){
    if(region&&(h[0]>region.end||h[0]+8<region.start))continue;
    const value=payload.values.slice(h[0]-1,h[0]+8).reduce((n,v)=>n+Math.abs(v||0),0)-Math.abs(h[0]+4-center)*1e-7;
    if(value>score){score=value;best=h[0]-1;}
   }
   if(regionChanged)scan=Math.max(0,Math.min(N-1,best??(region?.start||1)-1));
   if(changed||shapeChanged||appearanceChanged){render();viewer.hooks.refreshOverall(false);}
   else {recompute();paintStatic();}
   showAxes();
   if(isFull()&&region)document.getElementById('cvwrap').scrollTop=Math.floor((region.start-1)/PER)*BANDH;
   return host.getBoundingClientRect().height;
  },
  async capture(variant){
   const dark=document.body.classList.contains('dark');document.body.classList.toggle('dark',(variant?.mode||PLOT.snapshot(variant).mode)==='dark');
   try{
    const snap=await viewer.hooks.captureNative({capturePlots:true,exportVariant:variant}),plot=snap.playerPlots[mode==='full'?'full':'compact'].plain;
    const palette=PLOT.snapshot(variant),wasDark=document.documentElement.classList.contains('dark'),restore=PLOT.beginExport({...palette,export:true});
    try{
     document.documentElement.classList.toggle('dark',palette.mode==='dark');
     const table=captureElements(tables),offset=plot.height+16,key=annotationLegend?captureElements(annotationLegend):{height:0,content:''};
     return {width:plot.width,height:offset+table.height+key.height+12,content:plot.content+(mode==='compact'?axesContent(axisWidth()):'')+`<g transform="translate(0 ${offset})">${table.content}</g><g transform="translate(0 ${offset+table.height+8})">${key.content}</g>`};
    }finally{document.documentElement.classList.toggle('dark',wasDark);restore();}
   }
   finally{document.body.classList.toggle('dark',dark);}
  },
  state(){return {length:T.len,values:evidence?.values,rows:rows.length,mode,expanded:EXPANDED,fullHeight:FULLH,bandHeight:BANDH,histogramLayers,histogramHeight:histHeight(),histogramSeries:series.map(s=>({platform:s.platform,values:s.values})),histogramMax:histMax,mainTrack,availableTracks:TRACKS.filter(t=>trackHasData(t.key)).map(t=>t.key),visibleTracks:activeTracks().map(t=>t.key)};}
 };
 // Export the actual paginated native tables, including literal residue colors,
 // rather than reconstructing a second table layout or recalculating statistics.
 function captureElements(root){
  const bounds=root.getBoundingClientRect(),escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),out=[];
  const color=c=>c&&c!=='transparent'&&!/rgba\([^)]*,\s*0\)$/.test(c);
  for(const element of root.querySelectorAll('*')){
   if(element.closest('#sbox')||element.closest('.rank-controls button'))continue;
   const rect=element.getBoundingClientRect(),style=getComputedStyle(element);if(!rect.width||!rect.height||style.visibility==='hidden'||style.display==='none')continue;
   const x=rect.left-bounds.left,y=rect.top-bounds.top;
   if(color(style.backgroundColor))out.push(`<rect x="${x}" y="${y}" width="${rect.width}" height="${rect.height}" fill="${style.backgroundColor}"/>`);
   const stops=style.backgroundImage?.match(/rgba?\([^)]+\)/g);
   if(stops?.length){const id='study-gradient-'+out.length;out.push(`<defs><linearGradient id="${id}">${stops.map((c,i)=>`<stop offset="${100*i/(stops.length-1)}%" stop-color="${c}"/>`).join('')}</linearGradient></defs><rect x="${x}" y="${y}" width="${rect.width}" height="${rect.height}" fill="url(#${id})"/>`);}
   if(parseFloat(style.borderBottomWidth)>0&&color(style.borderBottomColor))out.push(`<path d="M${x} ${y+rect.height}h${rect.width}" stroke="${style.borderBottomColor}" stroke-width="${style.borderBottomWidth}"/>`);
   for(const node of element.childNodes){if(node.nodeType!==3||!node.textContent.trim())continue;
    const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();if(!r.width||!r.height)continue;
    const clip=element.closest('.identity-cell,.ehd')?.getBoundingClientRect(),id='study-text-'+out.length;
    if(clip)out.push(`<defs><clipPath id="${id}"><rect x="${clip.left-bounds.left}" y="${clip.top-bounds.top}" width="${clip.width}" height="${clip.height}"/></clipPath></defs>`);
    // Preserve the measured run width, whitespace and font metrics. Individual
    // glyph placement loses kerning and paints context badges off-center in PNG.
    out.push(`<text ${clip?`clip-path="url(#${id})"`:''} xml:space="preserve" x="${r.left-bounds.left}" y="${r.bottom-bounds.top-parseFloat(style.fontSize)*.19}" textLength="${r.width}" lengthAdjust="spacing" fill="${style.color}" font-family="${escape(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}">${escape(node.textContent)}</text>`);
   }
  }
  return {height:bounds.height,content:out.join('')};
 }
 cv.addEventListener('click',event=>{
  if(!onRegion)return;
  const box=cv.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
  const position=isFull()?Math.floor((y+fullOff()-8)/BANDH)*PER+Math.floor((x-POSW)/CELL)+1:Math.floor(x/PXR)+1;
  if(position<1||position>T.len)return;
  const span=(region?.end||60)-(region?.start||1)+1,start=Math.max(1,Math.min(T.len-span+1,position-Math.floor(span/2)));
  emittedRegion={start,end:Math.min(T.len,start+span-1)};onRegion(emittedRegion);
 });
 setPaused(true);stop();ambientStop();
})();
