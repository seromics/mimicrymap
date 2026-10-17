/* Frozen publication exports. Packaging and metadata reads only; no server matching. */
(function(){
 'use strict';
 const core=window.MimicryExportCore, encoder=new TextEncoder();
 const json=value=>JSON.stringify(value,null,2)+'\n';
 function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
 async function zip(files,compress=false){
  let offset=0,centralSize=0;const chunks=[],central=[];
  for(const [name,content] of Object.entries(files)){
   const filename=encoder.encode(name),bytes=typeof content==='string'?encoder.encode(content):new Uint8Array(content);
   if(bytes.length+offset>0xffffffff)throw Error((/*@copy publication-exports.this-bundle-exceeds-the-zip.8ac81e7*/`This bundle exceeds the ZIP size supported in this browser. Export smaller scopes.`/*@endcopy*/));
   let packed=bytes,method=0;
   if(compress&&typeof CompressionStream==='function'){
    let stream;try{stream=new CompressionStream('deflate-raw');}catch(error){/* This browser retains the uncompressed ZIP fallback. */}
    if(stream){const candidate=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());if(candidate.length<bytes.length){packed=candidate;method=8;}}
   }
   const local=new Uint8Array(30+filename.length),lv=new DataView(local.buffer),crc=crc32(bytes);
   lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(8,method,true);lv.setUint32(14,crc,true);lv.setUint32(18,packed.length,true);lv.setUint32(22,bytes.length,true);lv.setUint16(26,filename.length,true);local.set(filename,30);
   const record=new Uint8Array(46+filename.length),rv=new DataView(record.buffer);
   rv.setUint32(0,0x02014b50,true);rv.setUint16(4,20,true);rv.setUint16(6,20,true);rv.setUint16(8,0x800,true);rv.setUint16(10,method,true);rv.setUint32(16,crc,true);rv.setUint32(20,packed.length,true);rv.setUint32(24,bytes.length,true);rv.setUint16(28,filename.length,true);rv.setUint32(42,offset,true);record.set(filename,46);
   chunks.push(local,packed);central.push(record);centralSize+=record.length;offset+=local.length+packed.length;
  }
  const end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,central.length,true);view.setUint16(10,central.length,true);view.setUint32(12,centralSize,true);view.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
 }
 function save(name,content,type){const blob=content instanceof Blob?content:new Blob([content],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=String(name).replace(/virscan_exposome_current/g,'virscan_exposome').replace(/human_current/g,'huscan').replace(/_+/g,'_');document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 async function get(url,signal){const r=await fetch(url,{signal});if(!r.ok)throw Error((/*@copy publication-exports.export-input-unavailable-http.2c0918c*/`Export input unavailable (HTTP ${r.status}).`/*@endcopy*/));return r;}
 async function inputs(snapshot,api,signal,progress){
  const result=snapshot.result, analysis=result.inputs?.analysis_scan;
  if(!analysis){
   const rows=result.inputs?.reproduction_parents||result.inputs?.comparison_fasta||await api.legacyInputs(result);
   return {records:rows,manifest:{mode:'captured_selected_population',population_records:rows.length,source:result.inputs}};
  }
  const target=analysis.request?.target||analysis.target;
  if(target?.kind!=='library')throw Error((/*@copy publication-exports.this-comparison-does-not-retain.fc63d63*/`This comparison does not retain a complete portable parent population. CSV and figure exports remain available; no incomplete pipeline package was produced.`/*@endcopy*/));
  const query=analysis.query_identity||{}, params=new URLSearchParams({library:target.library,filters:JSON.stringify(target.filters||{}),floor:String(snapshot.floor),population_only:'true',release:analysis.release_fingerprint});
  if(query.antigen_id && query.library){params.set('query_id',query.antigen_id);params.set('query_library',query.library);}
  const mapped=['precomputed_player','browser_local_mapped'].includes(analysis.execution_mode);
  if(mapped){
   params.set('projection_inputs','true');
   const selectedQuery=analysis.request?.query;
   if(selectedQuery?.kind==='portable_protein'){
    params.delete('query_id');params.delete('query_library');
    params.set('query_portable_id',selectedQuery.portable_id);
    params.set('query_projection_library',selectedQuery.projection_library);
   }
  }
  // A browser-local run has already downloaded this exact release-bound population.
  // Reuse it rather than fetching the whole library a second time. Mapped/projection
  // bundles still download, because they additionally need projection_inputs.
  if(!mapped&&window.MimicryOne&&typeof window.MimicryOne.loadCachedInputs==='function'){
   try{
    progress('Reusing the downloaded parent population…');
    const shared=await window.MimicryOne.loadCachedInputs({
     library:target.library,floor:snapshot.floor,filters:target.filters||{},
     component:analysis.component_key||null,release:analysis.release_fingerprint||null});
    if(shared&&shared.manifest&&shared.manifest.mode==='full_selected_library'
       &&shared.records.length===shared.manifest.download_records){
     return {records:shared.records,manifest:shared.manifest,scope_hash:shared.scopeHash,projectionPlan:null};
    }
   }catch(error){/* fall through to the authoritative download */}
  }
  const records=[],seen=new Set(),entities=new Map();let cursor=null,scopeHash=null,manifest,projectionPlan=null;
  do{
   if(cursor!=null)params.set('after_id',cursor);
   const page=await(await get('/api/analysis/local-inputs?'+params,signal)).json();
   if(page.manifest?.mode!=='full_selected_library')throw Error((/*@copy publication-exports.input-endpoint-returned-a-hit.20fe549*/`Input endpoint returned a hit shortlist, not the full population.`/*@endcopy*/));
   if(scopeHash&&scopeHash!==page.scope_hash)throw Error((/*@copy publication-exports.input-scope-changed-while-downloading.2b628df*/`Input scope changed while downloading.`/*@endcopy*/));
   scopeHash=page.scope_hash;manifest=page.manifest;
   if(mapped){
    const plan=page.projection_inputs;
    if(!plan||plan.selection_basis!=='complete_selected_input_page_not_hit_candidates')throw Error((/*@copy publication-exports.complete-reproduction-mappings-were-not.08d225d*/`Complete reproduction mappings were not provided.`/*@endcopy*/));
    if(!projectionPlan)projectionPlan={...plan,parent_children:[],parent_entities:[],complete:false};
    if(JSON.stringify(plan.query_children)!==JSON.stringify(projectionPlan.query_children)||plan.comparison!==projectionPlan.comparison)throw Error((/*@copy publication-exports.reproduction-query-mapping-changed-during.16c2c83*/`Reproduction query mapping changed during download.`/*@endcopy*/));
    projectionPlan.parent_children.push(...plan.parent_children);
    for(const row of plan.parent_entities){const key=String(row.protein_idx);if(entities.has(key)&&JSON.stringify(entities.get(key))!==JSON.stringify(row))throw Error((/*@copy publication-exports.conflicting-reproduction-parent-metadata.81ec06e*/`Conflicting reproduction parent metadata.`/*@endcopy*/));entities.set(key,row);}
   }
   for(const row of page.source_catalog){if(seen.has(row.antigen_id))throw Error((/*@copy publication-exports.duplicate-input-page-record.b6fabb6*/`Duplicate input page record.`/*@endcopy*/));seen.add(row.antigen_id);records.push(row);}
   if(page.next_after_id!=null&&Number(page.next_after_id)<=Number(cursor||0))throw Error((/*@copy publication-exports.input-pagination-did-not-advance.4f5514e*/`Input pagination did not advance.`/*@endcopy*/));
   cursor=page.next_after_id;progress(`Packaging parent inputs · ${records.length.toLocaleString()} / ${manifest.download_records.toLocaleString()} records`);
  }while(cursor!=null);
  if(records.length!==manifest.download_records)throw Error((/*@copy publication-exports.the-parent-population-download-is.eaf3f6d*/`The parent population download is incomplete.`/*@endcopy*/));
  if(projectionPlan){
   if(projectionPlan.parent_children.length!==records.length)throw Error((/*@copy publication-exports.reproduction-mappings-do-not-cover.2b6cb09*/`Reproduction mappings do not cover the downloaded population.`/*@endcopy*/));
   projectionPlan.parent_entities=[...entities.values()];projectionPlan.complete=true;
  }
  return {records,manifest,scope_hash:scopeHash,projectionPlan};
 }
 async function bundle(snapshot,data,api,signal,progress){
  const annotations=api.annotationMetadata?await api.annotationMetadata(snapshot,signal):null;
  const population=await inputs(snapshot,api,signal,progress);
  const layoutText=await(await get('/reproduce/pipeline-layout.json',signal)).text(),layout=JSON.parse(layoutText);
  if(layout.schema!=='mimicryone/pipeline-package/1')throw Error('Unsupported pipeline package layout');
  const files={};
  for(const spec of Object.values(layout.files))if(spec.source){
   if(signal.aborted)throw new DOMException('Canceled','AbortError');
   files[spec.path]=spec.source==='/reproduce/pipeline-layout.json'?layoutText:new Uint8Array(await(await get(spec.source,signal)).arrayBuffer());
  }
  Object.assign(files,await window.MimicryPipelineSelection.prepare(snapshot,population,window.MimicryOneIdentity));
  if(annotations)files['inputs/residue-annotations.json']=json(annotations);
  return zip(files,true);
 }

 async function png(svg){
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  try{
   const image=new Image();image.src=url;await image.decode();
   const scale=Math.min(2,32760/image.width,32760/image.height,Math.sqrt(64000000/(image.width*image.height)));
   const c=document.createElement('canvas');c.width=Math.max(1,Math.floor(image.width*scale));c.height=Math.max(1,Math.floor(image.height*scale));
   const context=c.getContext('2d');if(!context)throw Error((/*@copy publication-exports.unable-to-allocate-png-canvas.4300d97*/`Unable to allocate PNG canvas`/*@endcopy*/));
   context.drawImage(image,0,0,c.width,c.height);
   const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error((/*@copy publication-exports.png-encoding-failed.3397749*/`PNG encoding failed.`/*@endcopy*/))),'image/png'));
   const result={blob,width:c.width,height:c.height,scale};c.width=c.height=1;return result;
  }finally{URL.revokeObjectURL(url);}
 }
 function nativeFigureCaption(snapshot,panel,highlight,layout){
  const target=window.MimicryOneIdentity.resolve(snapshot.result.protein).primaryLine;
  const scope=snapshot.scope_label||snapshot.result.parameters.source_scope_label||snapshot.result.parameters.source_scope;
  const grouped=snapshot.result.source_catalog.some(r=>r.record_identity?.unit==='exact_sequence_group');
  return (/*@copy publication-exports.native-figure-caption*/`${target} versus ${scope} at ≥${snapshot.floor}/9 core identity. ${panel==='target' ? 'The sequence view uses the target’s stored coordinates. Colors and annotation marks follow the displayed keys.' : panel==='window' ? 'Rows show qualifying window pairs at the selected target start. Each alignment places the target above its parent; core and context identity use denominators of nine and 27 positions. Rows follow the captured ranking and display limit.' : panel==='parents' ? 'Each row summarizes one matching parent entry across the full target. Target and parent coverage use the respective full stored sequence lengths. Overlapping core residues count once, including mismatching positions; context flanks are excluded. Best Core and Best Context are independent maxima and may occur at different sites. Rows follow the captured ranking and display limit.' : 'The predicted structure uses the captured assembly and pose. Colors follow the displayed key.'} ${grouped && (panel==='window'||panel==='parents') ? 'Parent entries are exact-sequence groups of records with identical full stored sequences.' : ''} ${highlight && (panel==='target'||panel==='structure') ? 'Highlights mark the selected core and its surrounding context.' : ''}
`/*@endcopy*/);
 }
 async function figureBundle(snapshot,data,signal,progress){
  const files={},items=[];
  const panels=[['compact-highlighted','target',true,'compact'],['compact-unhighlighted','target',false,'compact'],
   ['full-highlighted','target',true,'full'],['full-unhighlighted','target',false,'full'],
   ['full-window-highlighted','target',true,'full-window'],['full-window-unhighlighted','target',false,'full-window'],
   ['current-window','window',true],['mimicry-parents','parents',false]];
  if(snapshot.structure?.highlighted&&snapshot.structure?.plain)panels.push(['structure-highlighted','structure',true],['structure-unhighlighted','structure',false]);
  for(const [name,panel,highlight,layout,residueStart,tableStart] of panels){
   if(signal.aborted)throw new DOMException('Canceled','AbortError');
   progress('Preparing figures · '+name);
   const frozen={...snapshot,playerPlot:snapshot.playerPlots?.[layout]?.highlighted,playerPlotPlain:snapshot.playerPlots?.[layout]?.plain,
    figure:{...snapshot.figure,panel,highlight,rows:10,tableStart,layout:layout||'compact'}};
   const svg=core.figure(frozen,data),raster=await png(svg);
   if(signal.aborted)throw new DOMException('Canceled','AbortError');
   files['svg/'+name+'.svg']=svg;files['png/'+name+'.png']=new Uint8Array(await raster.blob.arrayBuffer());
   files['legends/'+name+'.txt']=nativeFigureCaption(snapshot, panel, highlight, layout);
   items.push({name,panel,highlight,layout:frozen.figure.layout,residueStart,tableStart,
    ...(panel==='structure'?{accession:snapshot.structure.accession,assembly:snapshot.structure.assembly,pose:snapshot.structure.pose}:{}),
    png:{width:raster.width,height:raster.height,scale:raster.scale},
    ...(layout==='full'||layout==='full-window'?{complete:true,residue_count:frozen.playerPlot.residueCount,band_count:frozen.playerPlot.bandCount,band_height:frozen.playerPlot.bandHeight,native_height:frozen.playerPlot.height,active_tracks:frozen.playerPlot.activeTracks,
     ...(layout==='full-window'?{range_start:frozen.playerPlot.range_start,range_end:frozen.playerPlot.range_end,core_start:frozen.playerPlot.core_start,core_end:frozen.playerPlot.core_end}: {})}: {})});
  }
  if(!snapshot.coverageFigure)throw Error('The selected comparison coverage figure was not captured.');
  const coverage=snapshot.coverageFigure,svg=coverage.svg.replace('>','><style>'+snapshot.font_css+'</style>'),raster=await png(svg);
  files['svg/target-parent-coverage.svg']=svg;files['png/target-parent-coverage.png']=new Uint8Array(await raster.blob.arrayBuffer());
  files['csv/target-parent-coverage.csv']=coverage.csv;
  files['legends/target-parent-coverage.txt']=coverage.legend+'\n';
  items.push({name:'target-parent-coverage',panel:'coverage',complete:true,points:data.parents.length,legend:coverage.legend,png:{width:raster.width,height:raster.height,scale:raster.scale}});
  files['README.txt']='MimicryMap figure bundle\n\nSeparate native Compact and Full player plots, structure images when available, and tables. Full plots include every residue row and every active track, not just the selected-site viewport. Highlighted and unhighlighted versions have identical dimensions.\n\nSVG retains the full logical dimensions. PNG is normally 2x, reduced uniformly when necessary to stay within 32,760 pixels per dimension and 64 million pixels total; no rows are cropped. Actual PNG dimensions and scale are recorded in figure-settings.json. Native canvas tracks and structure images are raster content inside SVG; table text is vector. Animation glow and fading are suppressed.\n\n'+(/*@copy publication-exports.figure-table-guide*/`Tables show up to 10 rows. Use All matches CSV and Overall Mimicry Parents CSV for the complete tables. Core identity uses nine positions; context identity uses a fixed span of 27 positions.`/*@endcopy*/)+' Context BLOSUM62 is summed over available aligned residues in that same 27-position span; it is not percent identity. Missing terminal positions do not count as identical.\n\nFigures use transparent backgrounds and the light palette. Tracks and highlights are retained.\n';
  files['README.txt']+='\nFull-window plots show only the selected core and its available flanking context (up to 27 residues), using the native Full renderer and original protein coordinates. All active annotation tracks are retained. Range and core bounds are recorded in figure-settings.json. Missing terminal context is not padded or invented.\n';
  files['figure-settings.json']=json({captured_utc:snapshot.captured_utc,target:snapshot.result.protein.display_accession||snapshot.result.protein.protein_id,
   floor:snapshot.floor,selected_start:snapshot.viewState.selected_start,view:snapshot.viewState,scope:snapshot.scope_label,summary:core.comparisonSummary(snapshot.result,snapshot.floor,data),ranking:window.MimicryRanking.describe(snapshot.viewState.ranking),panels:items});
  files['README.txt']+='\n'+window.MimicryRanking.describe(snapshot.viewState.ranking).window_rules+'\n'+window.MimicryRanking.describe(snapshot.viewState.ranking).parent_rules+'\nAll eligible rows are sorted before the top-ten cutoff. Changing order does not change inclusion or coverage.\n';
  files['README.txt']+='\nSelected comparison coverage: target-parent-coverage.svg/.png and csv/target-parent-coverage.csv contain all matching parents, with no top-ten limit. The numeric summary and denominators are recorded in figure-settings.json.\n'+coverage.legend+'\n';
  return zip(files);
 }
 function install(api){
  const host=document.querySelector('.repro');
  host.innerHTML=(/*@copy publication-exports.data-matches-csvselected-window-csvparents.be4cd00*/`<span class="rt">Data:</span><div class="seg"><button id="expWin" type="button" data-tooltip="Matching target–parent window pairs across the target at the selected core identity threshold.">Matches CSV</button><button id="expSite" type="button" data-tooltip="Matching target–parent window pairs at the selected target window and core identity threshold.">Selected window CSV</button><button id="expRank" type="button" data-tooltip="Ranked matching parents, with coverage and match counts for the current comparison.">Parents CSV</button><button id="expSummary" type="button" data-tooltip="One target row with Unmatched Target Regions for the complete comparison population, then pair coverage and matched residue ranges at the selected core identity threshold.">Summary CSV</button></div><span class="rt">Code:</span><div class="seg"><button id="reproBtn" type="button" data-tooltip="A ready-to-run pipeline ZIP with the current comparison’s sequences, settings and supporting record metadata.">Current Comparison</button></div><span class="rt">Figure:</span><select id="exportPanel" aria-label="Figure panel"><option value="combined">Target + tables</option><option value="target">Target tracks</option><option value="window">Window matches</option><option value="parents">Overall parents</option><option value="structure">Structure</option></select><label class="export-highlight"><input id="exportHighlight" type="checkbox" checked> Site highlight</label><label>Rows <select id="exportRows" aria-label="Figure table rows"><option>5</option><option selected>10</option><option>20</option><option>50</option></select></label><div class="seg"><button id="expSvg" type="button">SVG</button><button id="expPng" type="button">PNG</button></div><button id="exportCancel" type="button" data-tooltip="Cancel preparation of this download." hidden>Cancel export</button><span id="exportStatus" role="status" aria-live="polite" aria-atomic="true" hidden><span>Preparing<span class="export-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></span></span>`/*@endcopy*/);
  // One figure action: supported panels and variants travel together.
  document.getElementById('exportPanel').remove();
  document.getElementById('exportHighlight').closest('label').remove();
  document.getElementById('exportRows').closest('label').remove();
  document.getElementById('expPng').remove();
  document.getElementById('expSvg').id='figureBundle';
  document.getElementById('figureBundle').textContent=(/*@copy publication-exports.figure-bundle.0170c12*/`Figure bundle`/*@endcopy*/);
  document.getElementById('figureBundle').setAttribute('data-tooltip',(/*@copy publication-exports.all-supported-figure-panels-as.f7071e0*/`All supported figure panels as SVG and PNG, with highlighted and unhighlighted target tracks and loaded structures.`/*@endcopy*/));
  document.getElementById('expWin').textContent=(/*@copy publication-exports.all-matches-csv.272edf4*/`All matches CSV`/*@endcopy*/);
  document.getElementById('expSite').textContent=(/*@copy publication-exports.current-window-slice-csv.82bffee*/`Current window slice CSV`/*@endcopy*/);
  document.getElementById('expSite').setAttribute('data-tooltip',(/*@copy publication-exports.all-matches-at-the-current.e15bf8a*/`Matching target–parent window pairs at the selected target window and core identity threshold.`/*@endcopy*/));
  let controller=null;
  const indicator=document.getElementById('exportStatus');
  // Keep progress outside the toolbar flow. Only measure when starting or resizing,
  // never for each prepared row; the dots animate through CSS opacity.
  const positionStatus=()=>{
   if(indicator.hidden)return;
   const box=host.getBoundingClientRect(),last=document.getElementById('figureBundle').getBoundingClientRect();
   const style=getComputedStyle(host),left=last.right-box.left-host.clientLeft+8;
   const right=host.clientWidth-parseFloat(style.paddingRight);
   const labelWidth=indicator.firstElementChild.getBoundingClientRect().width;
   // At tight desktop widths, use the existing top-right padding instead of
   // overlapping the final link or reserving a new row.
   const fits=right-left>=labelWidth+4;
   indicator.style.left=(fits?left:right-labelWidth)+'px';
   indicator.style.width=(fits?right-left:labelWidth)+'px';
   indicator.style.top=(fits?last.top-box.top-host.clientTop+last.height/2:parseFloat(style.paddingTop)/2)+'px';
  };
  const status=message=>{
   const active=Boolean(message);
   if(active===!indicator.hidden)return;
   indicator.hidden=!active;
   if(active)positionStatus();
  };
  new ResizeObserver(positionStatus).observe(host);
  const options=()=>{
   const style=getComputedStyle(document.querySelector('.stage')||document.documentElement);
   const color=(name,fallback)=>style.getPropertyValue(name).trim()||fallback;
   return {panel:'combined',highlight:true,rows:10,palette:{background:'none',body:window.SeroMapPlotPalette.raw('printInk',{export:true}),ink:window.SeroMapPlotPalette.raw('printInk',{export:true}),border:window.SeroMapPlotPalette.raw('printInk',{export:true})}};
  };
  for(const id of ['expWin','expSite','expRank','expSummary','figureBundle','reproBtn'])document.getElementById(id).addEventListener('click',async()=>{
   if(controller)return;controller=new AbortController();const current=controller;
   const controls=[...host.querySelectorAll('button,select,input')].filter(e=>e.id!=='exportCancel');controls.forEach(e=>e.disabled=true);
   const clicked=document.getElementById(id);clicked.setAttribute('aria-busy','true');status(true);
   try{
    if(['expWin','expSite','expRank'].includes(id)){
     const snapshot=api.captureCsv();if(!snapshot)throw Error('No completed comparison is available for export.');
     const kind=id==='expWin'?'matches':id==='expSite'?'site':'parents';
     const stem=(snapshot.result.protein.display_accession||snapshot.result.protein.protein_id).replace(/[^a-z0-9._-]/gi,'_')+'.m'+snapshot.floor;
     const name=stem+(kind==='matches'?'.matches.csv':kind==='parents'?'.parents.csv':'.window-'+snapshot.viewState.selected_start+'.csv');
     if(current.signal.aborted)return;
     document.getElementById('exportCancel').hidden=false;
     const captured=await api.completeCsv(snapshot,current.signal);
     const output=await window.MimicryCsvDownload.write(captured,kind,null,{signal:current.signal,onProgress:()=>status(true)});
     if(output.blob)save(name,output.blob);
     return;
    }
    if(id==='expSummary'){
     const snapshot=api.captureCsv();if(!snapshot)throw Error('No completed comparison is available for export.');
     document.getElementById('exportCancel').hidden=false;
     const captured=await api.completeCsv(snapshot,current.signal);if(current.signal.aborted)return;
     const annotations=api.annotationMetadata?await api.annotationMetadata(snapshot,current.signal):null;
     if(current.signal.aborted)return;
     const summaryResult={...captured.result,parameters:{...captured.result.parameters,source_scope_label:captured.scopeLabel||snapshot.scopeLabel||captured.result.parameters?.source_scope_label}};
     const data=core.summaryTable(summaryResult,[captured.floor],annotations);
     const name=(snapshot.result.protein.display_accession||snapshot.result.protein.protein_id).replace(/[^a-z0-9._-]/gi,'_');
     save(name+'_summary_m'+captured.floor+'.csv',data.csv,'text/csv;charset=utf-8');return;
    }
    if(id==='reproBtn'){
     const captured=api.captureCsv();if(!captured)throw Error('No completed comparison is available for export.');
     const snapshot={...captured,scope_label:captured.scopeLabel},identity=window.MimicryOneIdentity.resolve(snapshot.result.protein);
     const name=window.MimicryOneIdentity.publicText(captured.fileId)||identity.accession||identity.assayId||identity.primaryLine||'comparison';
     const stem=name.replace(/[^a-z0-9._-]/gi,'_')+'.m'+snapshot.floor;
     const archive=await bundle(snapshot,null,api,current.signal,status);if(current.signal.aborted)return;
     save(stem+'.pipeline.zip',archive);return;
    }
    const snapshot=await api.capture({...options(),capturePlots:id==='figureBundle',signal:current.signal});if(current.signal.aborted)return;
    const data=id==='figureBundle'?core.tables(snapshot.result,snapshot.floor,snapshot.viewState.selected_start,snapshot.viewState.ranking):null,stem=(snapshot.result.protein.display_accession||snapshot.result.protein.protein_id).replace(/[^a-z0-9._-]/gi,'_')+'.m'+snapshot.floor;
    if(id==='figureBundle'){const archive=await figureBundle(snapshot,data,current.signal,status);if(current.signal.aborted)return;save(stem+'.figures.zip',archive);}
    status('');
   }catch(error){if(!current.signal.aborted&&error.name!=='AbortError'){console.error('Export stopped:',error);window.alert(`Export stopped: ${error.message}`);}}
   finally{status(false);clicked.removeAttribute('aria-busy');controller=null;controls.forEach(e=>e.disabled=false);document.getElementById('exportCancel').hidden=true;}
  });
  document.getElementById('exportCancel').addEventListener('click',()=>{controller?.abort();});
 }
 window.MimicryPublicationExports={install};
})();
